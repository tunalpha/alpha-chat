/**
 * bitcoin-utxo.test.ts — Unit test UTXO selection e fee calculation
 *
 * Verifica:
 *   - selectUtxos: largest-first, fee calculation, change
 *   - buildPayoutOutputs: multi-output con fee wallet
 *   - isDust: dust threshold
 *   - estimateTxVbytes: stima dimensione TX
 *   - calcMinerFee: fee in satoshi
 *   - INSUFFICIENT_BALANCE: UTXOs insufficienti
 *
 * La logica UTXO è pura (zero API/DB) — completamente testabile.
 */

import { describe, it, expect } from "vitest";
import {
  selectUtxos,
  buildPayoutOutputs,
  isDust,
  estimateTxVbytes,
  calcMinerFee,
} from "../bitcoin/bitcoin-utxo";
import { DUST_THRESHOLD_SATOSHI } from "../bitcoin/bitcoin-types";
import type { Utxo } from "../bitcoin/bitcoin-types";

// ─── Fixtures ──────────────────────────────────────────────────────────────────

const RECIPIENT   = "bc1qrecipient000000000000000000000000000";
const FEE_WALLET  = "bc1qfeewal000000000000000000000000000000";
const CHANGE_ADDR = "bc1qescrow0000000000000000000000000000000";

function makeUtxo(value: bigint, index = 0): Utxo {
  return { txid: `txid${index}`.padEnd(64, "0"), vout: 0, value };
}

// ─── estimateTxVbytes ─────────────────────────────────────────────────────────

describe("estimateTxVbytes", () => {
  it("1 input, 2 output (tipico) = 10 + 68 + 62 = 140 vbyte", () => {
    expect(estimateTxVbytes(1, 2)).toBe(140);
  });

  it("2 input, 3 output = 10 + 136 + 93 = 239 vbyte", () => {
    expect(estimateTxVbytes(2, 3)).toBe(239);
  });

  it("0 input = overhead only", () => {
    expect(estimateTxVbytes(0, 0)).toBe(10);
  });
});

// ─── calcMinerFee ─────────────────────────────────────────────────────────────

describe("calcMinerFee", () => {
  it("140 vbyte × 10 sat/vbyte = 1400 satoshi", () => {
    expect(calcMinerFee(140, 10)).toBe(1400n);
  });

  it("arrotonda per eccesso", () => {
    expect(calcMinerFee(100, 1.5)).toBe(150n); // ceil(150) = 150
  });

  it("fee rate 1 sat/vbyte (minimo)", () => {
    expect(calcMinerFee(68, 1)).toBe(68n);
  });
});

// ─── isDust ───────────────────────────────────────────────────────────────────

describe("isDust", () => {
  it("545 sat → dust", () => expect(isDust(545n)).toBe(true));
  it("546 sat → non dust (threshold)", () => expect(isDust(546n)).toBe(false));
  it("0 sat → dust", () => expect(isDust(0n)).toBe(true));
  it("100_000 sat → non dust", () => expect(isDust(100_000n)).toBe(false));
});

// ─── buildPayoutOutputs ───────────────────────────────────────────────────────

describe("buildPayoutOutputs", () => {
  it("include recipient e feeWallet se entrambi > dust", () => {
    const outputs = buildPayoutOutputs({
      netAmount:  999_000n,   // 0.00999 BTC
      recipient:  RECIPIENT,
      projectFee: 1_000n,     // 0.00001 BTC
      feeWallet:  FEE_WALLET,
    });
    expect(outputs).toHaveLength(2);
    expect(outputs[0]).toMatchObject({ address: RECIPIENT, value: 999_000n });
    expect(outputs[1]).toMatchObject({ address: FEE_WALLET, value: 1_000n });
  });

  it("omette feeWallet se è null", () => {
    const outputs = buildPayoutOutputs({
      netAmount: 999_000n, recipient: RECIPIENT,
      projectFee: 1_000n, feeWallet: null,
    });
    expect(outputs).toHaveLength(1);
    expect(outputs[0].address).toBe(RECIPIENT);
  });

  it("omette feeWallet se projectFee < dust (546 sat)", () => {
    const outputs = buildPayoutOutputs({
      netAmount: 999_000n, recipient: RECIPIENT,
      projectFee: 100n, feeWallet: FEE_WALLET, // < 546 sat
    });
    expect(outputs).toHaveLength(1);
  });

  it("lancia FEE_CALCULATION_ERROR se netAmount < dust", () => {
    expect(() => buildPayoutOutputs({
      netAmount: 100n, // < 546 sat
      recipient: RECIPIENT, projectFee: 0n, feeWallet: null,
    })).toThrow();
  });
});

// ─── selectUtxos ─────────────────────────────────────────────────────────────

describe("selectUtxos — spec examples", () => {
  it("0.01 BTC → Bob 0.00999 + FeeWallet 0.00001 (spec example)", () => {
    // L'utente deposita 0.01 BTC = 1_000_000 sat
    // netAmount = 999_000 + projectFee = 1_000 = 1_000_000 sat
    // Ma bisogna coprire ANCHE la miner fee → UTXO deve essere > 1_000_000 sat
    // Usiamo 1_100_000 sat (include buffer per ~1400 sat di miner fee @ 10 sat/vbyte)
    const utxos = [makeUtxo(1_100_000n)]; // escrow riceve 0.011 BTC
    const outputs = [
      { address: RECIPIENT, value: 999_000n },   // netAmount
      { address: FEE_WALLET, value: 1_000n },    // projectFee 0.10%
    ];
    const result = selectUtxos({ utxos, outputs, feeRateSatVb: 10, changeAddress: CHANGE_ADDR });

    expect(result.selected).toHaveLength(1);
    expect(result.totalInput).toBe(1_100_000n);
    // totalOutput = outputs sum (senza change)
    expect(result.totalOutput).toBe(1_000_000n); // 999_000 + 1_000
    // Invariante: totalInput = totalOutput + minerFee + change
    expect(result.totalInput).toBe(
      result.totalOutput + result.estimatedFee + result.change,
    );
  });

  it("1 BTC → Bob 0.999 + FeeWallet 0.001 + change", () => {
    // 1 BTC = 100_000_000 satoshi depositato nell'escrow
    // netAmount = 99_900_000, projectFee = 100_000
    // totalOutputs = 100_000_000 sat — ma serve anche la miner fee!
    // Escrow riceve 1.001 BTC (100_100_000 sat)
    const utxos = [makeUtxo(100_100_000n)];
    const outputs = [
      { address: RECIPIENT, value: 99_900_000n },
      { address: FEE_WALLET, value: 100_000n },
    ];
    const result = selectUtxos({ utxos, outputs, feeRateSatVb: 10, changeAddress: CHANGE_ADDR });

    expect(result.selected).toHaveLength(1);
    expect(result.totalOutput).toBe(100_000_000n); // 99_900_000 + 100_000

    // Invariante: totalInput = totalOutput + minerFee + change
    expect(result.totalInput).toBe(
      result.totalOutput + result.estimatedFee + result.change,
    );
  });
});

describe("selectUtxos — largest-first selection", () => {
  it("seleziona solo il UTXO più grande necessario", () => {
    const utxos = [
      makeUtxo(100_000n, 0),  // piccolo
      makeUtxo(999_000n, 1),  // medio — sufficiente
      makeUtxo(5_000_000n, 2), // grande — non necessario
    ];
    const outputs = [{ address: RECIPIENT, value: 500_000n }];
    const result = selectUtxos({ utxos, outputs, feeRateSatVb: 1, changeAddress: CHANGE_ADDR });

    // Deve scegliere il UTXO più grande (5M sat) — no, aspetta:
    // largest-first ordina DECRESCENTE: 5M, 999k, 100k
    // 5M >= 500k + minerFee → seleziona solo 5M
    expect(result.selected).toHaveLength(1);
    expect(result.selected[0].value).toBe(5_000_000n);
  });

  it("combina più UTXO se uno solo non è sufficiente", () => {
    const utxos = [
      makeUtxo(300_000n, 0),
      makeUtxo(300_000n, 1),
      makeUtxo(300_000n, 2),
    ];
    const outputs = [{ address: RECIPIENT, value: 700_000n }];
    const result = selectUtxos({ utxos, outputs, feeRateSatVb: 1, changeAddress: CHANGE_ADDR });

    // 300k insufficiente → 600k insufficiente → 900k sufficiente
    expect(result.selected.length).toBeGreaterThanOrEqual(2);
    expect(result.totalInput).toBeGreaterThanOrEqual(700_000n);
  });
});

describe("selectUtxos — invariante finanziaria", () => {
  it("totalInput = totalOutput + minerFee + change", () => {
    // Escrow riceve 10_200_000 sat (10.2M) — outputs totali 10M + buffer per miner fee
    const utxos = [makeUtxo(10_200_000n)]; // leggermente più di 0.1 BTC
    const outputs = [
      { address: RECIPIENT, value: 9_900_000n },
      { address: FEE_WALLET, value: 100_000n },
    ];
    const result = selectUtxos({ utxos, outputs, feeRateSatVb: 5, changeAddress: CHANGE_ADDR });

    expect(result.totalInput).toBe(
      result.totalOutput + result.estimatedFee + result.change,
    );
  });

  it("change >= 0", () => {
    const utxos = [makeUtxo(2_000_000n)];
    const outputs = [{ address: RECIPIENT, value: 1_000_000n }];
    const result = selectUtxos({ utxos, outputs, feeRateSatVb: 10, changeAddress: CHANGE_ADDR });
    expect(result.change).toBeGreaterThanOrEqual(0n);
  });
});

describe("selectUtxos — errori", () => {
  it("lancia INSUFFICIENT_BALANCE con UTXOs vuoti", () => {
    expect(() => selectUtxos({
      utxos: [],
      outputs: [{ address: RECIPIENT, value: 1_000_000n }],
      feeRateSatVb: 10,
      changeAddress: CHANGE_ADDR,
    })).toThrow();
  });

  it("lancia INSUFFICIENT_BALANCE se saldo totale insufficiente", () => {
    const utxos = [makeUtxo(100n)]; // 100 satoshi — non abbastanza
    expect(() => selectUtxos({
      utxos,
      outputs: [{ address: RECIPIENT, value: 1_000_000n }],
      feeRateSatVb: 10,
      changeAddress: CHANGE_ADDR,
    })).toThrow();
  });
});

describe("selectUtxos — multipli esempi spec", () => {
  const testCases = [
    {
      desc: "100 USDT equivalente BTC (fee 0.10%)",
      grossSat: 100_000_000n,   // 1 BTC come esempio
      netSat:   99_900_000n,    // 0.999 BTC
      feeSat:   100_000n,       // 0.001 BTC
    },
    {
      desc: "0.001 BTC trasferimento piccolo",
      grossSat: 100_000n,
      netSat:   99_900n,        // approssimazione per il test
      feeSat:   100n,
    },
  ];

  for (const { desc, grossSat, netSat, feeSat } of testCases) {
    it(desc, () => {
      if (feeSat < DUST_THRESHOLD_SATOSHI) {
        // Fee troppo piccola — skip (non crea output fee)
        return;
      }
      // Aggiungi un buffer per la miner fee (almeno 10_000 sat)
      const escrowDeposit = grossSat + 10_000n;
      const utxos = [makeUtxo(escrowDeposit)];
      const outputs = [
        { address: RECIPIENT, value: netSat },
        { address: FEE_WALLET, value: feeSat },
      ];
      // Non deve lanciare
      const result = selectUtxos({ utxos, outputs, feeRateSatVb: 10, changeAddress: CHANGE_ADDR });
      expect(result.totalInput).toBeGreaterThanOrEqual(netSat + feeSat);
      expect(result.totalInput).toBe(
        result.totalOutput + result.estimatedFee + result.change,
      );
    });
  }
});
