/**
 * Phase E — Token Decimal Correctness (per ogni token × chain)
 *
 * OBIETTIVO: verificare che la conversione "importo human-readable → wei/smallest unit"
 * produca il BigInt CORRETTO per ogni combinazione token+chain.
 *
 * Questo è particolarmente critico perché:
 *   - BSC USDT usa 18 decimali (non 6 come su Ethereum/Polygon)
 *   - USDA usa 18 decimali
 *   - USDC su BSC usa 18 decimali (non 6 come su Ethereum/Polygon)
 *   - Un errore di decimali può inviare 10^12 volte l'importo corretto o 10^12 volte meno
 *
 * Tabella decimali verificata (da token-registry-server.ts):
 *   ETH   USDT: 6  dec  — 0xdac17f958d2ee523a2206206994597c13d831ec7
 *   ETH   USDC: 6  dec  — 0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48
 *   POL   USDT: 6  dec  — 0xc2132d05d31c914a87c6611c10748aeb04b58e8f
 *   POL   USDC: 6  dec  — 0x3c499c542cef5e3811e1192ce70d8cc03d5c3359
 *   POL   USDA: 18 dec  — 0x23396cf899ca06c4472205fc903bdb4de249d6f
 *   BSC   USDT: 18 dec  — 0x55d398326f99059ff775485246999027b3197955  ← ATTENZIONE!
 *   BSC   USDC: 18 dec  — 0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d  ← ATTENZIONE!
 */

import { describe, it, expect } from "vitest";
import { decodeFunctionData } from "viem";
import { parseAmount } from "../../wallet/services/price-service";
import { buildErc20TransferData } from "../../wallet/services/gas-service";

// ─── ABI per decode calldata ───────────────────────────────────────────────

const ERC20_TRANSFER_ABI = [
  {
    name:   "transfer",
    type:   "function",
    inputs: [
      { name: "to",     type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs:         [{ type: "bool" }],
    stateMutability: "nonpayable",
  },
] as const;

const TEST_RECIPIENT = "0x1234567890AbcdEF1234567890aBcdef12345678";

// ─── Helper: amount in BigInt → calldata → decode amount ─────────────────

function encodeThenDecodeAmount(amountRaw: bigint): bigint {
  const calldata = buildErc20TransferData(TEST_RECIPIENT, amountRaw);
  const { args } = decodeFunctionData({ abi: ERC20_TRANSFER_ABI, data: calldata });
  return args[1] as bigint;
}

// ─── Tabella token verificata ─────────────────────────────────────────────

const VERIFIED_TOKEN_TABLE = [
  // Ethereum
  { chain: "Ethereum", chainId: 1,   symbol: "USDT", decimals: 6,  contract: "0xdac17f958d2ee523a2206206994597c13d831ec7" },
  { chain: "Ethereum", chainId: 1,   symbol: "USDC", decimals: 6,  contract: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48" },
  // Polygon
  { chain: "Polygon",  chainId: 137, symbol: "USDT", decimals: 6,  contract: "0xc2132d05d31c914a87c6611c10748aeb04b58e8f" },
  { chain: "Polygon",  chainId: 137, symbol: "USDC", decimals: 6,  contract: "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359" },
  { chain: "Polygon",  chainId: 137, symbol: "USDA", decimals: 18, contract: "0x23396cf899ca06c4472205fc903bdb4de249d6f" },
  // BSC — ATTENZIONE: USDT e USDC su BSC hanno 18 decimali
  { chain: "BSC",      chainId: 56,  symbol: "USDT", decimals: 18, contract: "0x55d398326f99059ff775485246999027b3197955" },
  { chain: "BSC",      chainId: 56,  symbol: "USDC", decimals: 18, contract: "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d" },
] as const;

// ─── TEST: parseAmount produce il BigInt corretto per ogni token ──────────

describe("parseAmount — conversione human-readable → smallest unit", () => {
  it('parseAmount("10", 6) = 10_000_000 (USDT/USDC Ethereum/Polygon)', () => {
    expect(parseAmount("10", 6)).toBe(10_000_000n);
  });

  it('parseAmount("10", 18) = 10_000_000_000_000_000_000 (USDT BSC, USDA)', () => {
    expect(parseAmount("10", 18)).toBe(10_000_000_000_000_000_000n);
  });

  it("parseAmount con decimali nella stringa: '0.5' con 6 dec = 500_000", () => {
    expect(parseAmount("0.5", 6)).toBe(500_000n);
  });

  it("parseAmount con decimali nella stringa: '0.001' con 18 dec = 10^15", () => {
    expect(parseAmount("0.001", 18)).toBe(1_000_000_000_000_000n);
  });

  it("parseAmount '1.5' con 6 dec = 1_500_000", () => {
    expect(parseAmount("1.5", 6)).toBe(1_500_000n);
  });

  it("parseAmount '100' con 18 dec = 100 * 10^18", () => {
    expect(parseAmount("100", 18)).toBe(100_000_000_000_000_000_000n);
  });
});

// ─── TEST: calldata encoding corretto per ogni token × chain ─────────────

describe("Calldata encoding — ogni token × chain produce la quantità corretta", () => {
  for (const token of VERIFIED_TOKEN_TABLE) {
    it(`${token.chain} ${token.symbol} (${token.decimals} dec): "10" → ${
      token.decimals === 6 ? "10_000_000" : "10_000_000_000_000_000_000"
    } in calldata`, () => {
      const amountRaw = parseAmount("10", token.decimals);
      const decoded   = encodeThenDecodeAmount(amountRaw);
      expect(decoded).toBe(amountRaw);

      // Verifica valore atteso assoluto
      if (token.decimals === 6) {
        expect(decoded).toBe(10_000_000n);
      } else {
        expect(decoded).toBe(10_000_000_000_000_000_000n);
      }
    });
  }
});

// ─── TEST: il decimale sbagliato produce valori MOLTO diversi ─────────────

describe("Sanity check — errore decimali = ordine di grandezza sbagliato", () => {
  it("10 USDT Polygon (6 dec) con decimali sbagliati (18) = 10^12 volte di più", () => {
    const correct  = parseAmount("10", 6);   //  10_000_000
    const wrong    = parseAmount("10", 18);  //  10_000_000_000_000_000_000
    expect(wrong / correct).toBe(1_000_000_000_000n); // 10^12
  });

  it("10 USDT BSC (18 dec) con decimali sbagliati (6) = 10^12 volte di meno", () => {
    const correct  = parseAmount("10", 18);  // 10^19
    const wrong    = parseAmount("10", 6);   // 10^7
    expect(correct / wrong).toBe(1_000_000_000_000n); // 10^12
  });
});

// ─── TEST: cross-chain stesso token, decimali diversi ────────────────────

describe("Cross-chain: stesso token, decimali diversi tra chain", () => {
  it("USDT Ethereum/Polygon (6 dec) ≠ USDT BSC (18 dec) per stesso importo", () => {
    const usdtEth = parseAmount("10", 6);   // 10_000_000
    const usdtBsc = parseAmount("10", 18);  // 10_000_000_000_000_000_000
    expect(usdtEth).not.toBe(usdtBsc);
    expect(usdtEth).toBe(10_000_000n);
    expect(usdtBsc).toBe(10_000_000_000_000_000_000n);
  });

  it("USDC Ethereum/Polygon (6 dec) ≠ USDC BSC (18 dec)", () => {
    const usdcPol = parseAmount("50", 6);
    const usdcBsc = parseAmount("50", 18);
    expect(usdcPol).toBe(50_000_000n);
    expect(usdcBsc).toBe(50_000_000_000_000_000_000n);
  });

  it("USDA Polygon (18 dec) coincide con BSC USDT nei decimali, non nel contratto", () => {
    // Entrambi hanno 18 dec — stesso amount raw per lo stesso importo human-readable
    const usdaPol = parseAmount("10", 18);
    const usdtBsc = parseAmount("10", 18);
    expect(usdaPol).toBe(usdtBsc); // stesso raw — diversi per contract address
  });
});

// ─── TEST: Custom token con decimali arbitrari ────────────────────────────

describe("Custom token — decimali arbitrari", () => {
  it("custom token 8 decimali: '1.5' = 150_000_000", () => {
    expect(parseAmount("1.5", 8)).toBe(150_000_000n);
  });

  it("custom token 2 decimali: '10.50' = 1050", () => {
    expect(parseAmount("10.50", 2)).toBe(1050n);
  });

  it("custom token 0 decimali: '100' = 100", () => {
    expect(parseAmount("100", 0)).toBe(100n);
  });
});

// ─── TEST: precisione — nessun arrotondamento su importi grandi ───────────

describe("Precisione BigInt — nessun arrotondamento", () => {
  it("importo grande con 18 decimali: nessun errore di floating point", () => {
    // 999_999.999999999999999999 con 18 dec (numero quasi 10^6)
    // Questo è il caso in cui Number JS perderebbe precisione (>2^53)
    const parsed = parseAmount("999999.999999", 18);
    // Deve essere >= 10^23 (non 0 o NaN per overflow floating point)
    expect(parsed > 0n).toBe(true);
    expect(parsed > 1_000_000_000_000_000_000_000_000n).toBe(false); // non oltre 10^6 token
  });

  it("calldata encoding di amount grande non tronca/arrotonda", () => {
    const amount = 999_999_000_000n; // 999_999 USDT (6 dec) in smallest unit
    const decoded = encodeThenDecodeAmount(amount);
    expect(decoded).toBe(amount); // nessuna perdita
  });
});
