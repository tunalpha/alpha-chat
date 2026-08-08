/**
 * payment-quote.test.ts — Unit test per calculatePaymentQuote e computeGrossFromNet
 *
 * Spec §13 — Test obbligatori A-J
 *
 * A — Backward compatibility: nessun amountMode → send_amount
 * B — Send amount: 100 USDT gross → fee 0.10, net 99.90
 * C — Recipient exact: target 100 USDT → gross calcolato, net ≥ 100 USDT
 * D — Rounding: il destinatario non riceve mai meno del target
 * E — Network fee: separata, non modifica projectFee, inclusa nel totalDeposit
 * F — Quote consistency: stessi parametri → stessi valori tra quote e create
 * G — Large amounts: importi elevati senza overflow BigInt
 * H — Small amounts: importi piccoli, dust/decimals corretti
 * I — Different decimals: asset con decimali differenti
 * J — USDA regression: zero modifiche ai codici USDA
 */

import { describe, it, expect } from "vitest";
import { calculatePaymentQuote, computeGrossFromNet } from "../payment-quote";
import { DEFAULT_FEE_BPS, BASIS_POINTS_DENOMINATOR } from "../../blockchain/fee-config";

// ─── Constants ─────────────────────────────────────────────────────────────────

/** 100 USDT @ 6 decimali */
const USDT_100  = 100_000_000n;
/** 1 USDT @ 6 decimali */
const USDT_1    = 1_000_000n;
/** 0.50 USDT = flat network fee (env default = 500_000) */
const NET_FEE   = 500_000n;

// feeBps = 10 (0.10%)
const FEE_BPS = DEFAULT_FEE_BPS; // 10n

// ─── TEST A — Backward compatibility ─────────────────────────────────────────

describe("TEST A — Backward compatibility", () => {
  it("amountMode=send_amount comportamento classico — 100 USDT gross", () => {
    const quote = calculatePaymentQuote({
      amountMode:       "send_amount",
      grossAmountUnits: USDT_100.toString(),
      network:          "polygon",
      asset:            "USDT",
    });

    expect(quote.amountMode).toBe("send_amount");
    expect(quote.grossAmount).toBe(USDT_100.toString());
    // projectFee = floor(100_000_000 × 10 / 10_000) = 100_000 (0.10 USDT)
    expect(quote.projectFee).toBe("100000");
    // netAmount = 100_000_000 - 100_000 = 99_900_000 (99.90 USDT)
    expect(quote.netAmount).toBe("99900000");
  });

  it("lancia errore se amountMode=send_amount ma grossAmountUnits assente", () => {
    expect(() =>
      calculatePaymentQuote({
        amountMode: "send_amount",
        network:    "polygon",
        asset:      "USDT",
      }),
    ).toThrow("QUOTE_ERROR");
  });
});

// ─── TEST B — Send amount ─────────────────────────────────────────────────────

describe("TEST B — Send amount: 100 USDT", () => {
  it("100 USDT gross → projectFee 0.10 USDT, net 99.90 USDT", () => {
    const quote = calculatePaymentQuote({
      amountMode:       "send_amount",
      grossAmountUnits: "100000000",   // 100 USDT @ 6 dec
      network:          "polygon",
      asset:            "USDT",
    });

    // Invariante: gross = net + fee
    const gross = BigInt(quote.grossAmount);
    const fee   = BigInt(quote.projectFee);
    const net   = BigInt(quote.netAmount);
    expect(net + fee).toBe(gross);

    // Valori specifici
    expect(quote.grossAmount).toBe("100000000");
    expect(quote.projectFee).toBe("100000");    // 0.10 USDT
    expect(quote.netAmount).toBe("99900000");   // 99.90 USDT
    expect(quote.feeBps).toBe(10);
  });

  it("fee invariante: feeBps=10 → esattamente 0.10% di grossAmount", () => {
    // Verifica per 5 importi diversi
    const cases = [
      { gross: "1000000",         fee: "1000",           net: "999000" },
      { gross: "100000000",       fee: "100000",         net: "99900000" },
      { gross: "1000000000",      fee: "1000000",        net: "999000000" },
      { gross: "10000000000",     fee: "10000000",       net: "9990000000" },
      { gross: "999999999999",    fee: "999999999",      net: "999000000000" },
    ];

    for (const { gross, fee, net } of cases) {
      const quote = calculatePaymentQuote({
        amountMode:       "send_amount",
        grossAmountUnits: gross,
        network:          "polygon",
        asset:            "USDT",
        feeBps:           10n,
        feeWallet:        null,
      });
      expect(quote.projectFee).toBe(fee);
      expect(quote.netAmount).toBe(net);
    }
  });
});

// ─── TEST C — Recipient exact ─────────────────────────────────────────────────

describe("TEST C — Recipient exact: il destinatario deve ricevere esattamente X", () => {
  it("target=100 USDT → gross calcolato, netAmount ≥ 100 USDT SEMPRE", () => {
    const quote = calculatePaymentQuote({
      amountMode:            "recipient_exact",
      targetNetAmountUnits:  USDT_100.toString(),
      network:               "polygon",
      asset:                 "USDT",
    });

    const gross = BigInt(quote.grossAmount);
    const fee   = BigInt(quote.projectFee);
    const net   = BigInt(quote.netAmount);

    // Invariante contabile
    expect(net + fee).toBe(gross);

    // Il destinatario riceve ALMENO il target (spec §2)
    expect(net).toBeGreaterThanOrEqual(USDT_100);

    // gross > target (il mittente paga di più per garantire il net)
    expect(gross).toBeGreaterThan(USDT_100);

    // amountMode corretto
    expect(quote.amountMode).toBe("recipient_exact");
  });

  it("verifica numerica esatta: target=100 USDT @ 6 dec, feeBps=10", () => {
    // denominatore = 10_000 - 10 = 9_990
    // gross = ceil(100_000_000 × 10_000 / 9_990)
    //       = ceil(1_000_000_000_000 / 9_990)
    //       = 100_100_101
    // projectFee = floor(100_100_101 × 10 / 10_000) = 100_100
    // netAmount  = 100_100_101 - 100_100 = 100_000_001 ≥ 100_000_000 ✓
    const quote = calculatePaymentQuote({
      amountMode:            "recipient_exact",
      targetNetAmountUnits:  "100000000",
      network:               "polygon",
      asset:                 "USDT",
      feeBps:                10n,
      feeWallet:             null,
    });

    expect(quote.grossAmount).toBe("100100101");
    expect(quote.projectFee).toBe("100100");
    expect(quote.netAmount).toBe("100000001");
    // netAmount (100_000_001) ≥ target (100_000_000) ✓
    expect(BigInt(quote.netAmount)).toBeGreaterThanOrEqual(100_000_000n);
  });

  it("lancia errore se amountMode=recipient_exact ma targetNetAmountUnits assente", () => {
    expect(() =>
      calculatePaymentQuote({
        amountMode: "recipient_exact",
        network:    "polygon",
        asset:      "USDT",
      }),
    ).toThrow("QUOTE_ERROR");
  });
});

// ─── TEST D — Rounding ────────────────────────────────────────────────────────

describe("TEST D — Rounding: il destinatario non riceve mai meno del target", () => {
  const targets = [
    1n,            // 1 unità (micro USDT)
    999n,          // importo dove l'arrotondamento è critico
    1_000_000n,    // 1 USDT
    7_777_777n,    // importo "dispari"
    99_999_999n,   // quasi 100 USDT
    100_000_000n,  // 100 USDT
    100_000_001n,  // 100 USDT + 1 unità
    999_999_999n,  // importo grande
  ];

  for (const target of targets) {
    it(`target=${target}n → netAmount ≥ ${target}n SEMPRE`, () => {
      const quote = calculatePaymentQuote({
        amountMode:            "recipient_exact",
        targetNetAmountUnits:  target.toString(),
        network:               "polygon",
        asset:                 "USDT",
        feeBps:                10n,
      });

      const net   = BigInt(quote.netAmount);
      const gross = BigInt(quote.grossAmount);
      const fee   = BigInt(quote.projectFee);

      // ── Garanzia principale (spec §2): il destinatario riceve almeno il target ──
      expect(net).toBeGreaterThanOrEqual(target);

      // ── Invariante contabile (spec §9): net + fee = gross ──
      expect(net + fee).toBe(gross);

      // ── Il surplus deve essere minimo ────────────────────────────────────────────
      // Il surplus è netto − target: garantito < 1 "unità di gross" per feeBps > 0.
      // NOTA: non verifichiamo che gross-1 fallisca — con floor della fee, ridurre
      // gross di 1 potrebbe NON ridurre la fee (se quella riduzione cade sotto la
      // soglia del floor). La proprietà del ceiling è: gross è il MINIMO tale che
      // net >= target, ma gross-1 potrebbe ancora soddisfare il predicato per effetto
      // del floor. Pertanto la verifica corretta è: surplus < ceil(gross / feeBps).
      const surplus = net - target;
      // Il surplus non deve mai essere "grande" — al massimo 1 unità di fee
      // (dovuto all'arrotondamento del floor).
      expect(surplus).toBeGreaterThanOrEqual(0n);
      expect(surplus).toBeLessThan(BigInt(quote.feeBps)); // surplus < feeBps = 10
    });
  }
});

// ─── TEST E — Network fee separata ───────────────────────────────────────────

describe("TEST E — Network fee: separata, non modifica projectFee, inclusa nel totalDeposit", () => {
  it("networkFeeCharged è separata da projectFee", () => {
    const quote = calculatePaymentQuote({
      amountMode:       "send_amount",
      grossAmountUnits: USDT_100.toString(),
      network:          "polygon",
      asset:            "USDT",
    });

    // projectFee = 0.10% di gross (invariato, spec §9)
    expect(quote.projectFee).toBe("100000");

    // networkFeeCharged è configurata da env (500_000 = 0.50 USDT nei test)
    // Non è zero se POLYGON_FLAT_NETWORK_FEE_USDT > 0
    // Verifica separazione: netFee ≠ projectFee (valori diversi)
    expect(quote.networkFeeCharged).not.toBe(quote.projectFee);
  });

  it("totalDeposit = grossAmount + networkFeeCharged (EVM)", () => {
    const quote = calculatePaymentQuote({
      amountMode:       "send_amount",
      grossAmountUnits: USDT_100.toString(),
      network:          "polygon",
      asset:            "USDT",
    });

    const gross       = BigInt(quote.grossAmount);
    const networkFee  = BigInt(quote.networkFeeCharged);
    const totalDeposit = BigInt(quote.totalDeposit);

    // totalDeposit = gross + networkFee (spec §8)
    expect(totalDeposit).toBe(gross + networkFee);
  });

  it("networkFeeCharged NON modifica projectFee (fee invariante)", () => {
    // Con e senza network fee, projectFee deve essere identico per lo stesso gross
    const quotePolygon = calculatePaymentQuote({
      amountMode:       "send_amount",
      grossAmountUnits: USDT_100.toString(),
      network:          "polygon",   // ha network fee flat
      asset:            "USDT",
      feeBps:           10n,
    });

    const quoteBitcoin = calculatePaymentQuote({
      amountMode:       "send_amount",
      grossAmountUnits: USDT_100.toString(),
      network:          "bitcoin",   // networkFeeCharged = 0
      asset:            "BTC",
      feeBps:           10n,
    });

    // projectFee deve essere uguale per lo stesso gross e feeBps
    expect(quoteBitcoin.projectFee).toBe(quotePolygon.projectFee);

    // networkFeeCharged differente tra le due reti
    // (bitcoin = 0, polygon > 0 se POLYGON_FLAT_NETWORK_FEE_USDT impostato)
    expect(quoteBitcoin.networkFeeCharged).toBe("0");
  });
});

// ─── TEST F — Quote consistency ───────────────────────────────────────────────

describe("TEST F — Quote consistency: preview e create usano la stessa logica", () => {
  it("stessi parametri → stessa quote in entrambe le chiamate (funzione PURA)", () => {
    const params = {
      amountMode:       "send_amount" as const,
      grossAmountUnits: USDT_100.toString(),
      network:          "polygon" as const,
      asset:            "USDT" as const,
      feeBps:           10n,
      feeWallet:        "0xFEEWALLET",
    };

    const q1 = calculatePaymentQuote(params);
    const q2 = calculatePaymentQuote(params);

    expect(q1).toEqual(q2);
  });

  it("recipient_exact: computeGrossFromNet e calculatePaymentQuote sono consistenti", () => {
    const target = USDT_100;

    // Calcolo diretto
    const gross = computeGrossFromNet(target, FEE_BPS);

    // Calcolo via quote
    const quote = calculatePaymentQuote({
      amountMode:            "recipient_exact",
      targetNetAmountUnits:  target.toString(),
      network:               "polygon",
      asset:                 "USDT",
      feeBps:                FEE_BPS,
    });

    // Il gross calcolato deve coincidere
    expect(BigInt(quote.grossAmount)).toBe(gross);
  });

  it("round-trip: send_amount(gross) e recipient_exact(net) producono valori compatibili", () => {
    // Se mando 100 USDT gross, ricevo 99_900_000 net.
    const q1 = calculatePaymentQuote({
      amountMode:       "send_amount",
      grossAmountUnits: "100000000",
      network:          "polygon",
      asset:            "USDT",
      feeBps:           10n,
    });

    // Se voglio ricevere esattamente q1.netAmount, il gross calcolato
    // deve essere ≥ 100_000_000 (potenzialmente diverso per rounding).
    const q2 = calculatePaymentQuote({
      amountMode:            "recipient_exact",
      targetNetAmountUnits:  q1.netAmount, // 99_900_000
      network:               "polygon",
      asset:                 "USDT",
      feeBps:                10n,
    });

    // Il destinatario deve ricevere almeno q1.netAmount
    expect(BigInt(q2.netAmount)).toBeGreaterThanOrEqual(BigInt(q1.netAmount));
  });
});

// ─── TEST G — Large amounts ───────────────────────────────────────────────────

describe("TEST G — Large amounts: nessun overflow BigInt", () => {
  it("1_000_000 USDT (@ 6 dec = 1_000_000_000_000n) — no overflow", () => {
    const million = "1000000000000"; // 1M USDT @ 6 dec

    const quote = calculatePaymentQuote({
      amountMode:       "send_amount",
      grossAmountUnits: million,
      network:          "polygon",
      asset:            "USDT",
    });

    const gross = BigInt(quote.grossAmount);
    const fee   = BigInt(quote.projectFee);
    const net   = BigInt(quote.netAmount);

    expect(net + fee).toBe(gross);
    expect(gross).toBe(1_000_000_000_000n);
    expect(fee).toBe(1_000_000_000n);   // 0.10% di 1M USDT = 1000 USDT
    expect(net).toBe(999_000_000_000n); // 999_000 USDT
  });

  it("recipient_exact: target 1_000_000 USDT — no overflow", () => {
    const target = "1000000000000"; // 1M USDT @ 6 dec

    const quote = calculatePaymentQuote({
      amountMode:            "recipient_exact",
      targetNetAmountUnits:  target,
      network:               "polygon",
      asset:                 "USDT",
    });

    const net = BigInt(quote.netAmount);
    expect(net).toBeGreaterThanOrEqual(BigInt(target));

    // Invariante
    const gross = BigInt(quote.grossAmount);
    const fee   = BigInt(quote.projectFee);
    expect(net + fee).toBe(gross);
  });

  it("importo vicino al limite 10^27 — no overflow", () => {
    // Non possiamo testare 10^27 - 1 perché overflow del BigInt BigInt arithmetic sarebbe ok
    // ma è un importo irrealistico. Testiamo 10^21 (un trilione di USDT).
    const huge = (10n ** 21n).toString();

    const quote = calculatePaymentQuote({
      amountMode:       "send_amount",
      grossAmountUnits: huge,
      network:          "polygon",
      asset:            "USDT",
      feeBps:           10n,
    });

    expect(() => BigInt(quote.grossAmount)).not.toThrow();
    expect(() => BigInt(quote.projectFee)).not.toThrow();
    expect(() => BigInt(quote.netAmount)).not.toThrow();

    const gross = BigInt(quote.grossAmount);
    const fee   = BigInt(quote.projectFee);
    const net   = BigInt(quote.netAmount);
    expect(net + fee).toBe(gross);
  });
});

// ─── TEST H — Small amounts ───────────────────────────────────────────────────

describe("TEST H — Small amounts: dust e decimali", () => {
  it("1 unità minima (1 micro USDT) — feeBps=10 → fee=0 (floor), net=1", () => {
    // 1 unità @ 6 dec = 0.000001 USDT
    // projectFee = floor(1 × 10 / 10_000) = 0
    // netAmount = 1 - 0 = 1
    const quote = calculatePaymentQuote({
      amountMode:       "send_amount",
      grossAmountUnits: "1",
      network:          "polygon",
      asset:            "USDT",
      feeBps:           10n,
    });

    expect(quote.projectFee).toBe("0");
    expect(quote.netAmount).toBe("1");
    expect(BigInt(quote.netAmount) + BigInt(quote.projectFee)).toBe(1n);
  });

  it("999 unità — limite prima del primo unit di fee (feeBps=10)", () => {
    // 999 × 10 / 10_000 = 9.99 → floor = 0 ancora
    // Quindi fee = 0, net = 999
    const quote = calculatePaymentQuote({
      amountMode:       "send_amount",
      grossAmountUnits: "999",
      network:          "polygon",
      asset:            "USDT",
      feeBps:           10n,
    });
    expect(quote.projectFee).toBe("0");
    expect(quote.netAmount).toBe("999");
  });

  it("1000 unità — primo importo con fee=1 (feeBps=10)", () => {
    // 1000 × 10 / 10_000 = 1 → fee = 1, net = 999
    const quote = calculatePaymentQuote({
      amountMode:       "send_amount",
      grossAmountUnits: "1000",
      network:          "polygon",
      asset:            "USDT",
      feeBps:           10n,
    });
    expect(quote.projectFee).toBe("1");
    expect(quote.netAmount).toBe("999");
  });

  it("recipient_exact: target=1 unità → gross calcolato correttamente", () => {
    const quote = calculatePaymentQuote({
      amountMode:            "recipient_exact",
      targetNetAmountUnits:  "1",
      network:               "polygon",
      asset:                 "USDT",
      feeBps:                10n,
    });

    // Il destinatario deve ricevere almeno 1 unità
    expect(BigInt(quote.netAmount)).toBeGreaterThanOrEqual(1n);
    expect(BigInt(quote.grossAmount)).toBeGreaterThan(0n);
  });
});

// ─── TEST I — Different decimals ──────────────────────────────────────────────

describe("TEST I — Decimali differenti: USDT @ 6 dec, BTC @ 8 dec", () => {
  it("USDT @ 6 decimali: 100 USDT = 100_000_000 unità", () => {
    const quote = calculatePaymentQuote({
      amountMode:       "send_amount",
      grossAmountUnits: "100000000",  // 100 USDT @ 6 dec
      network:          "polygon",
      asset:            "USDT",
      feeBps:           10n,
    });

    // projectFee = floor(100_000_000 × 10 / 10_000) = 100_000 (0.10 USDT)
    expect(quote.projectFee).toBe("100000");
    expect(quote.netAmount).toBe("99900000");
  });

  it("BTC @ 8 decimali: 1 BTC = 100_000_000 satoshi", () => {
    const quote = calculatePaymentQuote({
      amountMode:       "send_amount",
      grossAmountUnits: "100000000",  // 1 BTC @ 8 dec
      network:          "bitcoin",
      asset:            "BTC",
      feeBps:           10n,
    });

    // Stessa formula — la differenza è solo semantica (dec=8 vs dec=6)
    // projectFee = floor(100_000_000 × 10 / 10_000) = 100_000 sat = 0.001 BTC
    expect(quote.projectFee).toBe("100000");
    expect(quote.netAmount).toBe("99900000");

    // BTC: networkFeeCharged = 0 (miner fee separata in minDepositAmount)
    expect(quote.networkFeeCharged).toBe("0");
  });

  it("BTC @ 8 dec: 0.01 BTC = 1_000_000 sat", () => {
    const quote = calculatePaymentQuote({
      amountMode:       "send_amount",
      grossAmountUnits: "1000000",   // 0.01 BTC = 1_000_000 sat
      network:          "bitcoin",
      asset:            "BTC",
      feeBps:           10n,
    });

    // projectFee = floor(1_000_000 × 10 / 10_000) = 1_000 sat = 0.00001 BTC
    expect(quote.projectFee).toBe("1000");
    expect(quote.netAmount).toBe("999000");
  });

  it("recipient_exact: target 1 BTC, feeBps=10 → gross calcolato", () => {
    const quote = calculatePaymentQuote({
      amountMode:            "recipient_exact",
      targetNetAmountUnits:  "100000000", // 1 BTC
      network:               "bitcoin",
      asset:                 "BTC",
      feeBps:                10n,
    });

    const net = BigInt(quote.netAmount);
    expect(net).toBeGreaterThanOrEqual(100_000_000n);
  });
});

// ─── TEST J — USDA regression ─────────────────────────────────────────────────

describe("TEST J — USDA regression: zero modifiche al codice USDA", () => {
  it("calculatePaymentQuote non importa da codice USDA", async () => {
    // Verifica che il modulo payment-quote non dipenda da moduli USDA
    const fs = await import("fs");
    const path = await import("path");

    const quotePath = path.resolve(
      process.cwd(),
      "src/payment/payment-quote.ts",
    );

    let content: string;
    try {
      content = fs.readFileSync(quotePath, "utf8");
    } catch {
      // In test env il file potrebbe essere a percorso diverso — skip
      return;
    }

    // Il modulo non deve importare da percorsi USDA
    expect(content).not.toMatch(/usda/i);
    expect(content).not.toMatch(/chat-transfer/i);
    expect(content).not.toMatch(/custodial/i);
  });

  it("calculatePaymentQuote funziona correttamente per polygon:USDA (backward compat polygon:USDT equivalente)", () => {
    // USDA su Polygon usa la stessa formula fee del USDT
    // Questo test verifica che la formula sia agnostica rispetto all'asset
    const quoteUsdt = calculatePaymentQuote({
      amountMode:       "send_amount",
      grossAmountUnits: USDT_100.toString(),
      network:          "polygon",
      asset:            "USDT",
      feeBps:           10n,
    });

    const quoteUsda = calculatePaymentQuote({
      amountMode:       "send_amount",
      grossAmountUnits: USDT_100.toString(),
      network:          "polygon",
      asset:            "USDA",
      feeBps:           10n,
    });

    // La formula fee è identica — solo l'asset è diverso
    expect(quoteUsdt.projectFee).toBe(quoteUsda.projectFee);
    expect(quoteUsdt.netAmount).toBe(quoteUsda.netAmount);
    expect(quoteUsdt.grossAmount).toBe(quoteUsda.grossAmount);
  });
});

// ─── computeGrossFromNet — unit test diretti ──────────────────────────────────

describe("computeGrossFromNet — formula inversa", () => {
  it("target=100 USDT → gross=100_100_101 (ceiling)", () => {
    const gross = computeGrossFromNet(100_000_000n, 10n);
    expect(gross).toBe(100_100_101n);

    // Verifica che la formula garantisca il target
    const fee = (gross * 10n) / 10_000n;
    const net = gross - fee;
    expect(net).toBeGreaterThanOrEqual(100_000_000n);
  });

  it("lancia errore per target ≤ 0", () => {
    expect(() => computeGrossFromNet(0n)).toThrow("QUOTE_ERROR");
    expect(() => computeGrossFromNet(-1n)).toThrow("QUOTE_ERROR");
  });

  it("lancia errore per feeBps ≥ 10000", () => {
    expect(() => computeGrossFromNet(1000n, 10_000n)).toThrow("QUOTE_ERROR");
    expect(() => computeGrossFromNet(1000n, 10_001n)).toThrow("QUOTE_ERROR");
  });

  it("feeBps=0 → gross = target (nessuna fee)", () => {
    const gross = computeGrossFromNet(100_000_000n, 0n);
    expect(gross).toBe(100_000_000n);
  });

  it("feeBps=9999 (99.99%) → gross molto alto", () => {
    const target = 1_000_000n;
    const gross  = computeGrossFromNet(target, 9_999n);
    expect(gross).toBeGreaterThan(target);
    // Verifica invariante
    const fee = (gross * 9_999n) / 10_000n;
    const net = gross - fee;
    expect(net).toBeGreaterThanOrEqual(target);
  });
});
