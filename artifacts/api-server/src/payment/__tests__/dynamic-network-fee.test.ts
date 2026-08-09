/**
 * dynamic-network-fee.test.ts — Test suite per la fee dinamica EVM (§21+ test spec)
 *
 * Testa:
 *   A. Formula BigInt: conversione gasPrice × nativePrice → USDT raw units
 *   B. Safety margin: applicazione ceiling
 *   C. Decimali: Polygon/ETH (6 dec) vs BSC (18 dec)
 *   D. TX1: fallback 80k quando non è possibile stimare live
 *   E. Fail-closed: RPC unavailable, CoinGecko unavailable
 *   F. MAX_NETWORK_FEE: NETWORK_COST_TOO_HIGH quando superato
 *   G. Integrazione quote: networkFeeCharged iniettato in calculatePaymentQuote
 *   H. Invarianti: netAmount + projectFee = grossAmount (con fee dinamica)
 *   I. Totali: totalDeposit = grossAmount + networkFeeCharged
 *   J. BTC: fee dinamica sempre 0n, calculatePaymentQuote invariata
 *
 * Mock: viem (createPublicClient), getNativePriceUsd, getNetworkFeeConfig
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { calculatePaymentQuote } from "../payment-quote";

// ─── vi.hoisted: le variabili mock devono essere create PRIMA del hoisting ────
//
// vi.mock è "hoisted" in cima al file — non può referenziare variabili definite
// con const/let nel corpo del modulo. La soluzione è vi.hoisted() che esegue
// la factory prima di tutto il resto.

const { mockGetGasPrice, mockEstimateGas, mockGetNativePriceUsd, mockGetNetworkFeeConfig } =
  vi.hoisted(() => ({
    mockGetGasPrice:          vi.fn(),
    mockEstimateGas:          vi.fn(),
    mockGetNativePriceUsd:    vi.fn(),
    mockGetNetworkFeeConfig:  vi.fn(),
  }));

// ─── Mock: viem ───────────────────────────────────────────────────────────────

vi.mock("viem", async (importOriginal) => {
  const actual = await importOriginal<typeof import("viem")>();
  return {
    ...actual,
    createPublicClient: vi.fn(() => ({
      getGasPrice:  mockGetGasPrice,
      estimateGas:  mockEstimateGas,
    })),
  };
});

// ─── Mock: native-price-provider ─────────────────────────────────────────────

vi.mock("../../blockchain/native-price-provider", () => ({
  getNativePriceUsd:     mockGetNativePriceUsd,
  PriceUnavailableError: class PriceUnavailableError extends Error {
    readonly code       = "PRICE_UNAVAILABLE" as const;
    readonly httpStatus = 503;
    constructor(network: string, reason: string) {
      super(`[NativePrice] ${network}: ${reason}`);
      this.name = "PriceUnavailableError";
    }
  },
}));

// ─── Mock: mc-network-fee-config ─────────────────────────────────────────────

vi.mock("../../models/mc-network-fee-config.model", () => ({
  getNetworkFeeConfig:     mockGetNetworkFeeConfig,
  DEFAULT_SAFETY_MARGIN_BPS: 12_000,
  McNetworkFeeConfigModel: { findOne: vi.fn() },
}));

// ─── Import dopo i mock ───────────────────────────────────────────────────────

import {
  estimateDynamicNetworkFee,
  TX0_GAS_UNITS,
  TX2_GAS_UNITS,
  TX3_GAS_UNITS,
  TX1_FALLBACK_GAS,
  DynamicFeeError,
} from "../../blockchain/dynamic-fee-estimator";

// ─── Costanti di test ─────────────────────────────────────────────────────────

// Polygon USDT (6 dec)
const POLYGON_USDT = "0xc2132d05d31c914a87c6611c10748aeb04b58e8f";
const POL_PRICE    = 0.30;   // $0.30 per POL
const POL_GAS      = 30_000_000_000n; // 30 gwei

// BSC USDT (18 dec)
const BSC_USDT    = "0x55d398326f99059ff775485246999027b3197955";
const BNB_PRICE   = 600;     // $600 per BNB
const BSC_GAS     = 3_000_000_000n;  // 3 gwei

// ETH USDT (6 dec)
const ETH_USDT    = "0xdac17f958d2ee523a2206206994597c13d831ec7";
const ETH_PRICE   = 2500;    // $2500 per ETH
const ETH_GAS     = 15_000_000_000n; // 15 gwei

// Indirizzi di test — devono essere Ethereum checksummed validi (40 hex chars dopo 0x)
const FEE_WALLET  = "0x1111111111111111111111111111111111111111";
const RECIPIENT   = "0x2222222222222222222222222222222222222222";

// Default safety margin: 12000 bps = ×1.20
const DEFAULT_MARGIN = { safetyMarginBps: 12_000, maxNetworkFeeRaw: null };

// ─── Helper ───────────────────────────────────────────────────────────────────

/** Calcola la fee attesa con la formula esatta dell'estimator */
function expectedFee(
  gasPrice:     bigint,
  tx1Gas:       bigint,
  nativePrice:  number,
  tokenDecimals: number,
  safetyBps:    number,
): bigint {
  const totalGas    = TX0_GAS_UNITS + tx1Gas + TX2_GAS_UNITS + TX3_GAS_UNITS;
  const nativeWei   = totalGas * gasPrice;
  const priceScaled = BigInt(Math.round(nativePrice * 1_000_000));
  const tokenDec    = 10n ** BigInt(tokenDecimals);
  const rawFee      = (nativeWei * priceScaled * tokenDec) / (10n ** 18n) / 1_000_000n;
  // ceiling division: ceil(rawFee × safetyBps / 10000)
  return (rawFee * BigInt(safetyBps) + 9_999n) / 10_000n;
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  // Default: usa fallback (no live estimate) per semplicità nei test unitari
  mockEstimateGas.mockRejectedValue(new Error("estimateGas mock: non configurato"));
  mockGetNetworkFeeConfig.mockResolvedValue(DEFAULT_MARGIN);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
// A. Formula BigInt — decimali Polygon (6)
// ─────────────────────────────────────────────────────────────────────────────

describe("A. Formula BigInt — Polygon (6 dec)", () => {
  it("A-1: calcola fee corretta con gasPrice 30 gwei e POL=$0.30", async () => {
    mockGetGasPrice.mockResolvedValue(POL_GAS);
    mockGetNativePriceUsd.mockResolvedValue(POL_PRICE);

    const result = await estimateDynamicNetworkFee({
      network:      "polygon",
      assetAddress: POLYGON_USDT,
      grossAmount:  1_000_000n,
    });

    const expected = expectedFee(POL_GAS, TX1_FALLBACK_GAS, POL_PRICE, 6, 12_000);
    expect(result.networkFeeCharged).toBe(expected);
    expect(result.networkFeeCharged).toBeGreaterThan(0n);
  });

  it("A-2: formula è BigInt-safe (nessun float intermedio)", async () => {
    // POL a $0.30 = 300000 microunits — senza float: BigInt(Math.round(0.30 × 1e6)) = 300000
    mockGetGasPrice.mockResolvedValue(POL_GAS);
    mockGetNativePriceUsd.mockResolvedValue(0.30);

    const result = await estimateDynamicNetworkFee({
      network:      "polygon",
      assetAddress: POLYGON_USDT,
      grossAmount:  1_000_000n,
    });

    // La fee deve essere positiva e non zero (test che il prezzo non sia arrotondato a 0)
    expect(result.networkFeeCharged).toBeGreaterThan(0n);
    // Verifica struttura audit trail
    expect(result.gasPriceWei).toBe(POL_GAS);
    expect(result.nativePriceUsd).toBe(0.30);
    expect(result.tx0Gas).toBe(Number(TX0_GAS_UNITS));
    expect(result.tx2Gas).toBe(Number(TX2_GAS_UNITS));
    expect(result.tx3Gas).toBe(Number(TX3_GAS_UNITS));
  });

  it("A-3: gas spike ×10 → fee scala proporzionalmente", async () => {
    mockGetNativePriceUsd.mockResolvedValue(POL_PRICE);

    mockGetGasPrice.mockResolvedValue(POL_GAS);
    const resultNormal = await estimateDynamicNetworkFee({
      network: "polygon", assetAddress: POLYGON_USDT, grossAmount: 1_000_000n,
    });

    mockGetGasPrice.mockResolvedValue(POL_GAS * 10n);
    const resultSpike = await estimateDynamicNetworkFee({
      network: "polygon", assetAddress: POLYGON_USDT, grossAmount: 1_000_000n,
    });

    // Spike ×10 deve dare fee ×10 (± ceiling rounding)
    const ratio = Number(resultSpike.networkFeeCharged) / Number(resultNormal.networkFeeCharged);
    expect(ratio).toBeCloseTo(10, 0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B. BSC (18 dec) — decimali diversi
// ─────────────────────────────────────────────────────────────────────────────

describe("B. BSC — 18 decimali USDT", () => {
  it("B-1: calcola fee con BNB=$600 e 3 gwei", async () => {
    mockGetGasPrice.mockResolvedValue(BSC_GAS);
    mockGetNativePriceUsd.mockResolvedValue(BNB_PRICE);

    const result = await estimateDynamicNetworkFee({
      network:      "bsc",
      assetAddress: BSC_USDT,
      grossAmount:  100_000_000_000_000_000n, // 0.1 USDT in 18 dec
    });

    const expected = expectedFee(BSC_GAS, TX1_FALLBACK_GAS, BNB_PRICE, 18, 12_000);
    expect(result.networkFeeCharged).toBe(expected);
  });

  it("B-2: fee BSC positiva e non triviale (BNB costoso)", async () => {
    mockGetGasPrice.mockResolvedValue(BSC_GAS);
    mockGetNativePriceUsd.mockResolvedValue(BNB_PRICE);

    const result = await estimateDynamicNetworkFee({
      network:      "bsc",
      assetAddress: BSC_USDT,
      grossAmount:  1_000_000_000_000_000_000n, // 1 USDT
    });

    // BSC: 157000 gas × 3 gwei × $600 × 10^18 / 10^18 / 10^6 × 1.20 ≈ 0.34 USDT (18 dec → ~340000000000000000)
    expect(result.networkFeeCharged).toBeGreaterThan(100_000_000_000_000_000n); // > 0.1 USDT
  });

  it("B-3: fee BSC usa getNativePriceUsd('bsc')", async () => {
    mockGetGasPrice.mockResolvedValue(BSC_GAS);
    mockGetNativePriceUsd.mockResolvedValue(BNB_PRICE);

    await estimateDynamicNetworkFee({
      network:      "bsc",
      assetAddress: BSC_USDT,
      grossAmount:  100_000_000_000_000_000n,
    });

    expect(mockGetNativePriceUsd).toHaveBeenCalledWith("bsc");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// C. Ethereum (6 dec)
// ─────────────────────────────────────────────────────────────────────────────

describe("C. Ethereum — 6 decimali, gas alto", () => {
  it("C-1: fee ETH con 15 gwei e $2500 significativamente più alta di Polygon", async () => {
    mockGetNativePriceUsd.mockResolvedValue(ETH_PRICE);
    mockGetGasPrice.mockResolvedValue(ETH_GAS);

    const ethResult = await estimateDynamicNetworkFee({
      network: "ethereum", assetAddress: ETH_USDT, grossAmount: 1_000_000n,
    });

    mockGetNativePriceUsd.mockResolvedValue(POL_PRICE);
    mockGetGasPrice.mockResolvedValue(POL_GAS);

    const polResult = await estimateDynamicNetworkFee({
      network: "polygon", assetAddress: POLYGON_USDT, grossAmount: 1_000_000n,
    });

    // ETH fee deve essere molto più alta di Polygon
    expect(ethResult.networkFeeCharged).toBeGreaterThan(polResult.networkFeeCharged);
  });

  it("C-2: audit trail Ethereum corretto", async () => {
    mockGetGasPrice.mockResolvedValue(ETH_GAS);
    mockGetNativePriceUsd.mockResolvedValue(ETH_PRICE);

    const result = await estimateDynamicNetworkFee({
      network: "ethereum", assetAddress: ETH_USDT, grossAmount: 1_000_000n,
    });

    expect(result.gasPriceWei).toBe(ETH_GAS);
    expect(result.nativePriceUsd).toBe(ETH_PRICE);
    expect(result.safetyMarginBps).toBe(12_000);
    expect(result.isLiveEstimate).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// D. TX1 live estimate vs fallback
// ─────────────────────────────────────────────────────────────────────────────

describe("D. TX1 — live estimate vs fallback", () => {
  it("D-1: senza recipientWallet → usa fallback 80k", async () => {
    mockGetGasPrice.mockResolvedValue(POL_GAS);
    mockGetNativePriceUsd.mockResolvedValue(POL_PRICE);

    const result = await estimateDynamicNetworkFee({
      network: "polygon", assetAddress: POLYGON_USDT, grossAmount: 1_000_000n,
      // recipientWallet assente
    });

    expect(result.tx1Gas).toBe(Number(TX1_FALLBACK_GAS));
    expect(result.isLiveEstimate).toBe(false);
  });

  it("D-2: con recipientWallet e feeWallet → chiama estimateGas live", async () => {
    mockGetGasPrice.mockResolvedValue(POL_GAS);
    mockGetNativePriceUsd.mockResolvedValue(POL_PRICE);
    mockEstimateGas.mockResolvedValue(65_000n); // stima live

    const result = await estimateDynamicNetworkFee({
      network:         "polygon",
      assetAddress:    POLYGON_USDT,
      grossAmount:     1_000_000n,
      recipientWallet: RECIPIENT,
      feeWallet:       FEE_WALLET,
    });

    // TX1 = 65000 + 10% buffer = 71500
    expect(result.tx1Gas).toBe(71_500);
    expect(result.isLiveEstimate).toBe(true);
    expect(result.networkFeeCharged).toBe(
      expectedFee(POL_GAS, 71_500n, POL_PRICE, 6, 12_000)
    );
  });

  it("D-3: estimateGas fallisce → fallback silenzioso (non blocca il pagamento)", async () => {
    mockGetGasPrice.mockResolvedValue(POL_GAS);
    mockGetNativePriceUsd.mockResolvedValue(POL_PRICE);
    mockEstimateGas.mockRejectedValue(new Error("execution reverted"));

    const result = await estimateDynamicNetworkFee({
      network:         "polygon",
      assetAddress:    POLYGON_USDT,
      grossAmount:     1_000_000n,
      recipientWallet: RECIPIENT,
      feeWallet:       FEE_WALLET,
    });

    // Deve usare fallback, non lanciare
    expect(result.tx1Gas).toBe(Number(TX1_FALLBACK_GAS));
    expect(result.isLiveEstimate).toBe(false);
  });

  it("D-4: live estimate < fallback → fee minore (risparmio per recipient esistente)", async () => {
    mockGetGasPrice.mockResolvedValue(POL_GAS);
    mockGetNativePriceUsd.mockResolvedValue(POL_PRICE);
    mockEstimateGas.mockResolvedValue(45_000n); // recipient esistente: gas basso

    const live = await estimateDynamicNetworkFee({
      network: "polygon", assetAddress: POLYGON_USDT, grossAmount: 1_000_000n,
      recipientWallet: RECIPIENT, feeWallet: FEE_WALLET,
    });

    const fallback = await estimateDynamicNetworkFee({
      network: "polygon", assetAddress: POLYGON_USDT, grossAmount: 1_000_000n,
      // no recipient
    });

    expect(live.networkFeeCharged).toBeLessThan(fallback.networkFeeCharged);
    expect(live.isLiveEstimate).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// E. Safety margin
// ─────────────────────────────────────────────────────────────────────────────

describe("E. Safety margin", () => {
  it("E-1: default 12000 bps = ×1.20 esatto", async () => {
    mockGetGasPrice.mockResolvedValue(POL_GAS);
    mockGetNativePriceUsd.mockResolvedValue(POL_PRICE);

    const result = await estimateDynamicNetworkFee({
      network: "polygon", assetAddress: POLYGON_USDT, grossAmount: 1_000_000n,
    });

    // Verifica che safetyMarginBps=12000 sia stato usato
    expect(result.safetyMarginBps).toBe(12_000);
  });

  it("E-2: safety margin 11000 (×1.10) → fee 10% più bassa del default (×1.20)", async () => {
    mockGetGasPrice.mockResolvedValue(POL_GAS);
    mockGetNativePriceUsd.mockResolvedValue(POL_PRICE);
    mockGetNetworkFeeConfig.mockResolvedValue({ safetyMarginBps: 11_000, maxNetworkFeeRaw: null });

    const result110 = await estimateDynamicNetworkFee({
      network: "polygon", assetAddress: POLYGON_USDT, grossAmount: 1_000_000n,
    });

    mockGetNetworkFeeConfig.mockResolvedValue({ safetyMarginBps: 12_000, maxNetworkFeeRaw: null });
    const result120 = await estimateDynamicNetworkFee({
      network: "polygon", assetAddress: POLYGON_USDT, grossAmount: 1_000_000n,
    });

    // 11000/12000 = 0.9167; fee×1.10 deve essere ~8.33% inferiore a fee×1.20
    const ratio = Number(result110.networkFeeCharged) / Number(result120.networkFeeCharged);
    expect(ratio).toBeCloseTo(11_000 / 12_000, 1);
  });

  it("E-3: safetyMarginBpsOverride sovrascrive il DB", async () => {
    mockGetGasPrice.mockResolvedValue(POL_GAS);
    mockGetNativePriceUsd.mockResolvedValue(POL_PRICE);
    // DB restituirebbe 12000, ma l'override è 10000 (nessun margine)

    const result = await estimateDynamicNetworkFee({
      network: "polygon", assetAddress: POLYGON_USDT, grossAmount: 1_000_000n,
      safetyMarginBpsOverride: 10_000n,
    });

    expect(result.safetyMarginBps).toBe(10_000);
    // Con override, getNetworkFeeConfig non deve essere chiamata per il margin
    // (il DB è ignorato per il margin quando c'è l'override)
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// F. Fail-closed
// ─────────────────────────────────────────────────────────────────────────────

describe("F. Fail-closed", () => {
  it("F-1: RPC getGasPrice fallisce → lancia DynamicFeeError", async () => {
    mockGetGasPrice.mockRejectedValue(new Error("RPC timeout"));
    mockGetNativePriceUsd.mockResolvedValue(POL_PRICE);

    await expect(
      estimateDynamicNetworkFee({
        network: "polygon", assetAddress: POLYGON_USDT, grossAmount: 1_000_000n,
      })
    ).rejects.toThrow(DynamicFeeError);
  });

  it("F-2: DynamicFeeError ha httpStatus 503", async () => {
    mockGetGasPrice.mockRejectedValue(new Error("RPC down"));
    mockGetNativePriceUsd.mockResolvedValue(POL_PRICE);

    try {
      await estimateDynamicNetworkFee({
        network: "polygon", assetAddress: POLYGON_USDT, grossAmount: 1_000_000n,
      });
    } catch (err) {
      expect((err as DynamicFeeError).httpStatus).toBe(503);
      expect((err as DynamicFeeError).code).toBe("DYNAMIC_FEE_ERROR");
    }
  });

  it("F-3: CoinGecko stale → PriceUnavailableError propagata (503)", async () => {
    mockGetGasPrice.mockResolvedValue(POL_GAS);
    const { PriceUnavailableError } = await import("../../blockchain/native-price-provider");
    mockGetNativePriceUsd.mockRejectedValue(
      new PriceUnavailableError("polygon", "cache scaduta")
    );

    await expect(
      estimateDynamicNetworkFee({
        network: "polygon", assetAddress: POLYGON_USDT, grossAmount: 1_000_000n,
      })
    ).rejects.toMatchObject({ code: "PRICE_UNAVAILABLE", httpStatus: 503 });
  });

  it("F-4: bitcoin → lancia DynamicFeeError (non supportato da questo estimator)", async () => {
    await expect(
      estimateDynamicNetworkFee({
        network: "bitcoin" as any, assetAddress: "native", grossAmount: 100_000n,
      })
    ).rejects.toThrow(DynamicFeeError);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// G. MAX_NETWORK_FEE cap
// ─────────────────────────────────────────────────────────────────────────────

describe("G. MAX_NETWORK_FEE — NETWORK_COST_TOO_HIGH", () => {
  it("G-1: fee entro il cap → nessun errore", async () => {
    mockGetGasPrice.mockResolvedValue(POL_GAS);
    mockGetNativePriceUsd.mockResolvedValue(POL_PRICE);
    // Cap enorme: 1000 USDT
    mockGetNetworkFeeConfig.mockResolvedValue({ safetyMarginBps: 12_000, maxNetworkFeeRaw: 1_000_000_000n });

    await expect(
      estimateDynamicNetworkFee({
        network: "polygon", assetAddress: POLYGON_USDT, grossAmount: 1_000_000n,
      })
    ).resolves.toBeDefined();
  });

  it("G-2: fee supera il cap → AppError NETWORK_COST_TOO_HIGH (503)", async () => {
    mockGetGasPrice.mockResolvedValue(POL_GAS);
    mockGetNativePriceUsd.mockResolvedValue(POL_PRICE);
    // Cap microscopico: 1 micro-USDT
    mockGetNetworkFeeConfig.mockResolvedValue({ safetyMarginBps: 12_000, maxNetworkFeeRaw: 1n });

    const { AppError } = await import("../../errors/AppError");
    await expect(
      estimateDynamicNetworkFee({
        network: "polygon", assetAddress: POLYGON_USDT, grossAmount: 1_000_000n,
      })
    ).rejects.toMatchObject({ code: "NETWORK_COST_TOO_HIGH", httpStatus: 503 });
  });

  it("G-3: max null (default) → nessun cap applicato", async () => {
    mockGetGasPrice.mockResolvedValue(POL_GAS * 100n); // gas molto alto
    mockGetNativePriceUsd.mockResolvedValue(POL_PRICE);
    mockGetNetworkFeeConfig.mockResolvedValue({ safetyMarginBps: 12_000, maxNetworkFeeRaw: null });

    await expect(
      estimateDynamicNetworkFee({
        network: "polygon", assetAddress: POLYGON_USDT, grossAmount: 1_000_000n,
      })
    ).resolves.toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// H. Integrazione calculatePaymentQuote — invarianti contabili
// ─────────────────────────────────────────────────────────────────────────────

describe("H. Integrazione calculatePaymentQuote — invarianti", () => {
  it("H-1: netAmount + projectFee = grossAmount con fee dinamica iniettata", () => {
    const networkFee  = 5_000n; // 0.005 USDT
    const grossAmount = 100_000_000n;

    const quote = calculatePaymentQuote(
      {
        amountMode:       "send_amount",
        grossAmountUnits: grossAmount.toString(),
        network:          "polygon",
        asset:            "USDT",
      },
      networkFee,
    );

    const net  = BigInt(quote.netAmount);
    const fee  = BigInt(quote.projectFee);
    const gross = BigInt(quote.grossAmount);

    expect(net + fee).toBe(gross);
  });

  it("H-2: totalDeposit = grossAmount + networkFeeCharged", () => {
    const networkFee  = 5_000n;
    const grossAmount = 100_000_000n;

    const quote = calculatePaymentQuote(
      {
        amountMode:       "send_amount",
        grossAmountUnits: grossAmount.toString(),
        network:          "polygon",
        asset:            "USDT",
      },
      networkFee,
    );

    const total = BigInt(quote.totalDeposit);
    const gross = BigInt(quote.grossAmount);
    const nfc   = BigInt(quote.networkFeeCharged);

    expect(total).toBe(gross + nfc);
  });

  it("H-3: networkFeeCharged nel quote = esattamente il valore iniettato", () => {
    const networkFee = 7_500n;

    const quote = calculatePaymentQuote(
      {
        amountMode:       "send_amount",
        grossAmountUnits: "100000000",
        network:          "polygon",
        asset:            "USDT",
      },
      networkFee,
    );

    expect(BigInt(quote.networkFeeCharged)).toBe(networkFee);
  });

  it("H-4: BTC — networkFeeCharged sempre 0n indipendentemente dall'input", () => {
    const quote = calculatePaymentQuote(
      {
        amountMode:       "send_amount",
        grossAmountUnits: "1000000",
        network:          "bitcoin",
        asset:            "BTC",
      },
      99_999n, // ignorato per BTC
    );

    expect(quote.networkFeeCharged).toBe("0");
  });

  it("H-5: recipient_exact — netAmount = target inserito dall'utente", () => {
    const networkFee  = 5_000n;
    const targetNet   = 50_000_000n;

    const quote = calculatePaymentQuote(
      {
        amountMode:          "recipient_exact",
        targetNetAmountUnits: targetNet.toString(),
        network:             "polygon",
        asset:               "USDT",
      },
      networkFee,
    );

    // netAmount deve essere ≥ targetNet (può avere arrotondamento ceiling)
    expect(BigInt(quote.netAmount)).toBeGreaterThanOrEqual(targetNet);
    // Invariante: net + fee = gross
    expect(BigInt(quote.netAmount) + BigInt(quote.projectFee)).toBe(BigInt(quote.grossAmount));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// I. Audit trail
// ─────────────────────────────────────────────────────────────────────────────

describe("I. Audit trail", () => {
  it("I-1: tutte le proprietà audit trail sono presenti nel risultato", async () => {
    mockGetGasPrice.mockResolvedValue(POL_GAS);
    mockGetNativePriceUsd.mockResolvedValue(POL_PRICE);

    const result = await estimateDynamicNetworkFee({
      network: "polygon", assetAddress: POLYGON_USDT, grossAmount: 1_000_000n,
    });

    expect(result).toHaveProperty("networkFeeCharged");
    expect(result).toHaveProperty("gasPriceWei");
    expect(result).toHaveProperty("nativePriceUsd");
    expect(result).toHaveProperty("tx0Gas");
    expect(result).toHaveProperty("tx1Gas");
    expect(result).toHaveProperty("tx2Gas");
    expect(result).toHaveProperty("tx3Gas");
    expect(result).toHaveProperty("safetyMarginBps");
    expect(result).toHaveProperty("isLiveEstimate");

    // Valori fissi sempre presenti
    expect(result.tx0Gas).toBe(21_000);
    expect(result.tx2Gas).toBe(50_000);
    expect(result.tx3Gas).toBe(21_000);
  });

  it("I-2: gasPriceWei restituisce il valore esatto dell'RPC", async () => {
    const testGasPrice = 42_000_000_000n;
    mockGetGasPrice.mockResolvedValue(testGasPrice);
    mockGetNativePriceUsd.mockResolvedValue(POL_PRICE);

    const result = await estimateDynamicNetworkFee({
      network: "polygon", assetAddress: POLYGON_USDT, grossAmount: 1_000_000n,
    });

    expect(result.gasPriceWei).toBe(testGasPrice);
  });

  it("I-3: nativePriceUsd restituisce il valore esatto del provider", async () => {
    mockGetGasPrice.mockResolvedValue(POL_GAS);
    const testPrice = 0.42;
    mockGetNativePriceUsd.mockResolvedValue(testPrice);

    const result = await estimateDynamicNetworkFee({
      network: "polygon", assetAddress: POLYGON_USDT, grossAmount: 1_000_000n,
    });

    expect(result.nativePriceUsd).toBe(testPrice);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// J. Consistenza fee: quote (TX1=80k) vs create (live estimate)
// ─────────────────────────────────────────────────────────────────────────────

describe("J. Quote vs Create — stima conservativa", () => {
  it("J-1: fee quote (fallback 80k) > fee create (live 45k per recipient esistente)", async () => {
    mockGetGasPrice.mockResolvedValue(POL_GAS);
    mockGetNativePriceUsd.mockResolvedValue(POL_PRICE);

    // Quote: nessun recipient → TX1 = 80k
    const quoteResult = await estimateDynamicNetworkFee({
      network: "polygon", assetAddress: POLYGON_USDT, grossAmount: 1_000_000n,
    });

    // Create: recipient esistente → TX1 = 45k (+ 10% = 49.5k)
    mockEstimateGas.mockResolvedValue(45_000n);
    const createResult = await estimateDynamicNetworkFee({
      network: "polygon", assetAddress: POLYGON_USDT, grossAmount: 1_000_000n,
      recipientWallet: RECIPIENT, feeWallet: FEE_WALLET,
    });

    expect(quoteResult.networkFeeCharged).toBeGreaterThan(createResult.networkFeeCharged);
    expect(quoteResult.isLiveEstimate).toBe(false);
    expect(createResult.isLiveEstimate).toBe(true);
  });
});
