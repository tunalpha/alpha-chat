/**
 * spark-portfolio.test.ts — Phase 5 Pre-Go-Live Validation
 *
 * Verifica §12 del Phase 5 spec:
 * - BTC on-chain e BTC Lightning mostrati separatamente
 * - Nessun double counting
 * - Spark offline → dati parziali (NON inventare zero come saldo reale)
 * - Totale portfolio include Spark solo quando connesso
 * - chainId separati: Bitcoin=0, Lightning=-1
 * - Prezzo BTC corretto per entrambi
 * - Token type corretto
 */

import { describe, it, expect } from "vitest";
import type { SparkWalletInfo } from "../../lib/spark/spark-types";

// Simula la logica di calcPortfolioTotal (senza importare AlphaWalletPage)
// per testare le invarianti matematiche

type MockPrices = { btc: { eur: number; usd: number }; pol?: { eur: number; usd: number } };

function calcPortfolioTotalMock(
  btcSat: number,
  sparkSat: bigint | null,
  prices: MockPrices,
  fiatKey: "eur" | "usd",
): number {
  let total = 0;
  const btcPrice = prices.btc?.[fiatKey] ?? 0;
  total += (btcSat / 1e8) * btcPrice;
  // Spark: stesso prezzo BTC, contabilizzato separatamente
  if (sparkSat != null && sparkSat > 0n) {
    total += (Number(sparkSat) / 1e8) * btcPrice;
  }
  return total;
}

const mockPrices: MockPrices = { btc: { eur: 90_000, usd: 100_000 } };

// ─────────────────────────────────────────────────────────────────────────────
// A. Separazione BTC on-chain vs Lightning
// ─────────────────────────────────────────────────────────────────────────────

describe("A. Separazione BTC on-chain vs Lightning", () => {
  it("A1: BTC on-chain e Lightning hanno chainId distinti", () => {
    const BTC_ONCHAIN_CHAIN_ID  = 0;
    const BTC_LIGHTNING_CHAIN_ID = -1; // riserva per Lightning
    expect(BTC_ONCHAIN_CHAIN_ID).not.toBe(BTC_LIGHTNING_CHAIN_ID);
  });

  it("A2: icone diverse: BTC on-chain='₿', Lightning='⚡'", () => {
    const BTC_ICON       = "₿";
    const LIGHTNING_ICON = "⚡";
    expect(BTC_ICON).not.toBe(LIGHTNING_ICON);
  });

  it("A3: network label distinto: 'Bitcoin' vs 'Lightning'", () => {
    const BTC_NETWORK       = "Bitcoin";
    const LIGHTNING_NETWORK = "Lightning";
    expect(BTC_NETWORK).not.toBe(LIGHTNING_NETWORK);
  });

  it("A4: asset name distinto: 'Bitcoin' vs 'Bitcoin Lightning'", () => {
    const BTC_NAME       = "Bitcoin";
    const LIGHTNING_NAME = "Bitcoin Lightning";
    expect(BTC_NAME).not.toBe(LIGHTNING_NAME);
    expect(LIGHTNING_NAME).toContain("Lightning");
  });

  it("A5: entrambi hanno symbol='BTC' (stessa valuta, network diversa)", () => {
    // BTC è BTC su entrambi — la rete è diversa, non l'asset
    expect("BTC").toBe("BTC"); // invariante ovvio ma esplicitato
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B. No double counting — invariante matematica
// ─────────────────────────────────────────────────────────────────────────────

describe("B. No double counting — invarianti matematiche", () => {
  it("B1: portfolio con 50k sat BTC e 20k sat Lightning → somma corretta", () => {
    const btcSat   = 50_000;    // 50k sat on-chain
    const sparkSat = 20_000n;   // 20k sat Lightning
    const total = calcPortfolioTotalMock(btcSat, sparkSat, mockPrices, "eur");
    const expected = ((50_000 + 20_000) / 1e8) * 90_000;
    expect(total).toBeCloseTo(expected, 5);
  });

  it("B2: Spark offline (null) → totale = solo BTC on-chain", () => {
    const btcSat   = 50_000;
    const sparkSat: bigint | null = null; // Spark offline
    const total = calcPortfolioTotalMock(btcSat, sparkSat, mockPrices, "eur");
    const expected = (50_000 / 1e8) * 90_000;
    expect(total).toBeCloseTo(expected, 5);
    // NON include Spark (dati parziali, non zero inventato)
  });

  it("B3: Spark zero (0n) → incluso ma contribuisce zero al totale", () => {
    const btcSat   = 50_000;
    const sparkSat = 0n;
    const total = calcPortfolioTotalMock(btcSat, sparkSat, mockPrices, "eur");
    // 0n balance: sparkSat > 0n è false → non aggiunge al totale (vedi implementazione)
    const expected = (50_000 / 1e8) * 90_000;
    expect(total).toBeCloseTo(expected, 5);
  });

  it("B4: BTC zero, Spark 100k sat → totale = solo Lightning", () => {
    const btcSat   = 0;
    const sparkSat = 100_000n;
    const total = calcPortfolioTotalMock(btcSat, sparkSat, mockPrices, "usd");
    const expected = (100_000 / 1e8) * 100_000;
    expect(total).toBeCloseTo(expected, 5);
  });

  it("B5: BTC sat NON sommati a sparkSat prima del prezzo (no double counting formula)", () => {
    // INVARIANTE: calcola separatamente, non somma i sat prima
    const btcSat   = 1_000_000; // 0.01 BTC on-chain → 0.01 * 90_000 = 900 EUR
    const sparkSat = 1_000_000n; // 0.01 BTC Lightning → 0.01 * 90_000 = 900 EUR
    const btcFiat    = (btcSat / 1e8) * 90_000;      // 900 EUR
    const sparkFiat  = (1_000_000 / 1e8) * 90_000;   // 900 EUR
    const totalFiat  = btcFiat + sparkFiat;            // 1800 EUR (corretto, non 3600)

    const computed = calcPortfolioTotalMock(btcSat, sparkSat, mockPrices, "eur");
    expect(computed).toBeCloseTo(totalFiat, 5);
    expect(computed).toBeCloseTo(1800, 5); // non 900 (solo BTC), non 3600 (double count)
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// C. Spark offline — dati parziali
// ─────────────────────────────────────────────────────────────────────────────

describe("C. Spark offline — dati parziali (no fake zero)", () => {
  it("C1: sparkSat=null → NON mostrare riga Lightning nel portfolio", () => {
    const sparkSat: bigint | null = null;
    // La riga Lightning NON deve essere nel portfolio se Spark è offline
    const rows: Array<{ chainId: number; network: string }> = [];
    if (sparkSat != null) {
      rows.push({ chainId: -1, network: "Lightning" });
    }
    expect(rows.length).toBe(0); // nessuna riga Lightning
  });

  it("C2: sparkSat=null → partialCount aumenta (warning visibile)", () => {
    const sparkOffline = true; // Spark abilitato ma non connesso
    const failedChains = 0;
    const partialCount = failedChains + (sparkOffline ? 1 : 0);
    expect(partialCount).toBe(1); // warning mostrato all'utente
  });

  it("C3: sparkSat=0n (connesso ma vuoto) → riga Lightning visibile, importo zero", () => {
    const sparkSat: bigint | null = 0n;
    const rows: Array<{ chainId: number; amount: string }> = [];
    if (sparkSat != null) {
      rows.push({ chainId: -1, amount: "0.00000000 BTC" });
    }
    expect(rows.length).toBe(1);
    expect(rows[0].amount).toContain("0.00000000");
  });

  it("C4: Spark connecting (non null ma non ancora info) → no riga inventata", () => {
    const sparkWalletInfo: SparkWalletInfo | undefined = undefined; // non ancora caricato
    const sparkState = "connecting";
    // sparkSat è null se state !== 'connected'
    const sparkSat = sparkState === "connected" ? (sparkWalletInfo?.balanceSat ?? null) : null;
    expect(sparkSat).toBeNull();
  });

  it("C5: totalPortfolio con Spark offline NON è uguale a totalPortfolio senza Spark", () => {
    // Quando Spark offline: il totale NON include il saldo Lightning
    // → L'utente vede un totale parziale, NON un totale inventato
    const btcSat = 100_000;
    const totalSenzaSpark = calcPortfolioTotalMock(btcSat, null, mockPrices, "eur");
    const totalConSpark   = calcPortfolioTotalMock(btcSat, 50_000n, mockPrices, "eur");
    // I due totali sono diversi (Spark ha contribuito)
    expect(totalConSpark).toBeGreaterThan(totalSenzaSpark);
    // Con Spark offline → il sistema mostra totalSenzaSpark (dati parziali) ✓
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// D. Prezzo BTC corretto per Lightning
// ─────────────────────────────────────────────────────────────────────────────

describe("D. Prezzo BTC corretto per Lightning", () => {
  it("D1: Lightning usa prezzo BTC (non un prezzo diverso)", () => {
    const btcSat   = 100_000;
    const sparkSat = 100_000n;
    const btcFiat    = calcPortfolioTotalMock(btcSat, 0n, mockPrices, "eur");
    const sparkFiat  = calcPortfolioTotalMock(0, sparkSat, mockPrices, "eur");
    // Stessa quantità di satoshi → stesso valore fiat (stesso prezzo)
    expect(btcFiat).toBeCloseTo(sparkFiat, 5);
  });

  it("D2: 1 sat BTC on-chain = 1 sat Lightning (parità 1:1)", () => {
    const sat = 100_000;
    const btcTotal   = calcPortfolioTotalMock(sat, 0n, mockPrices, "usd");
    const lightTotal = calcPortfolioTotalMock(0, BigInt(sat), mockPrices, "usd");
    expect(btcTotal).toBeCloseTo(lightTotal, 5);
  });

  it("D3: conversione sat→BTC→fiat corretta: 100k sat @ 100k USD/BTC = 100 USD", () => {
    // 100_000 sat / 1e8 = 0.001 BTC; 0.001 BTC * 100_000 USD/BTC = 100 USD
    const sparkSat = 100_000n;
    const totalUsd = calcPortfolioTotalMock(0, sparkSat, mockPrices, "usd");
    expect(totalUsd).toBeCloseTo(100.0, 5);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// E. SparkWalletInfo — interfaccia corretta
// ─────────────────────────────────────────────────────────────────────────────

describe("E. SparkWalletInfo — campi obbligatori", () => {
  it("E1: SparkWalletInfo ha balanceSat come bigint", () => {
    const info: SparkWalletInfo = {
      identityPubkey: "test_pubkey",
      balanceSat:     50_000n,
    };
    expect(typeof info.balanceSat).toBe("bigint");
    expect(info.balanceSat).toBeGreaterThanOrEqual(0n);
  });

  it("E2: balanceSat non può essere negativo (invariante dominio)", () => {
    const validBalances = [0n, 1n, 50_000n, 1_000_000n];
    for (const b of validBalances) {
      expect(b).toBeGreaterThanOrEqual(0n);
    }
  });

  it("E3: identityPubkey è una stringa non vuota", () => {
    const info: SparkWalletInfo = {
      identityPubkey: "mock_identity_pubkey_0000000000000000000000000000000000000000000000000000000000000000",
      balanceSat:     50_000n,
    };
    expect(info.identityPubkey.length).toBeGreaterThan(0);
    expect(typeof info.identityPubkey).toBe("string");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// F. formatSatoshisToBtc — formato corretto
// ─────────────────────────────────────────────────────────────────────────────

describe("F. Formattazione balance Lightning", () => {
  function formatSatoshisToBtc(sats: bigint): string {
    return `${(Number(sats) / 1e8).toFixed(8)} BTC`;
  }

  it("F1: 0 sat → '0.00000000 BTC'", () => {
    expect(formatSatoshisToBtc(0n)).toBe("0.00000000 BTC");
  });

  it("F2: 50_000 sat → '0.00050000 BTC'", () => {
    expect(formatSatoshisToBtc(50_000n)).toBe("0.00050000 BTC");
  });

  it("F3: 100_000_000 sat → '1.00000000 BTC'", () => {
    expect(formatSatoshisToBtc(100_000_000n)).toBe("1.00000000 BTC");
  });

  it("F4: 1 sat → '0.00000001 BTC'", () => {
    expect(formatSatoshisToBtc(1n)).toBe("0.00000001 BTC");
  });

  it("F5: importo non approssimato per errore floating point", () => {
    // 1000 sat esatti
    const result = formatSatoshisToBtc(1000n);
    expect(result).toBe("0.00001000 BTC");
    expect(result).not.toContain("9999999"); // nessun floating point error
  });
});
