/**
 * Test — Alpha Wallet: Custom Token Import
 *
 * Verifica:
 * - Autodiscovery (buildCustomTokenPreview)
 * - Token verificato vs non verificato
 * - Fake USDT / USDC / USDA (phishing detection)
 * - Import e storage token custom
 * - Rimozione token custom
 * - Token custom mai classificato come verificato
 * - USDA address è uguale a quello in thirdweb.ts
 */

import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  VERIFIED_TOKENS,
  USDA_POLYGON_ADDRESS,
  getVerifiedTokens,
  findVerifiedByAddress,
  isVerifiedAddress,
  isSymbolConflict,
  buildCustomTokenPreview,
  saveCustomToken,
  loadCustomTokens,
  removeCustomToken,
  getAllTokensForChain,
  closeWalletDB,
} from "@/wallet/evm/token-registry";

const POLYGON = 137;
const ETH = 1;
const BSC = 56;

// Address USDA in thirdweb.ts — fonte di verità del sistema esistente
const THIRDWEB_USDA_ADDRESS = "0x23396cF899Ca06c4472205fC903bDB4de249D6f";

// ─── USDA address verification ────────────────────────────────────────────

describe("⚠️ USDA contract address — anti-placeholder test", () => {
  it("USDA_POLYGON_ADDRESS non è un placeholder inventato", () => {
    // Verifica che l'indirizzo non sia il placeholder errato con 'A' finale
    expect(USDA_POLYGON_ADDRESS).not.toBe("0x23396cF899Ca06c4472205fC903bDB4de249D6fA");
    // Verifica che corrisponda all'indirizzo usato da thirdweb.ts
    expect(USDA_POLYGON_ADDRESS.toLowerCase()).toBe(THIRDWEB_USDA_ADDRESS.toLowerCase());
  });

  it("USDA nel token registry usa USDA_POLYGON_ADDRESS", () => {
    const usda = VERIFIED_TOKENS.find(
      t => t.chainId === POLYGON && t.symbol === "USDA"
    );
    expect(usda).toBeDefined();
    expect(usda!.contractAddress?.toLowerCase()).toBe(USDA_POLYGON_ADDRESS.toLowerCase());
  });

  it("USDA è trovato tramite findVerifiedByAddress", () => {
    const found = findVerifiedByAddress(POLYGON, USDA_POLYGON_ADDRESS);
    expect(found).toBeDefined();
    expect(found!.verification).toBe("verified");
  });
});

// ─── Anti-phishing ────────────────────────────────────────────────────────

describe("Token custom — rilevamento phishing", () => {
  it("fake USDT (address diverso) → symbolConflict = true su Ethereum", () => {
    const p = buildCustomTokenPreview(
      ETH, "USDT", "Fake Tether", 6,
      "0x1111111111111111111111111111111111111111"
    );
    expect(p.symbolConflict).toBe(true);
    expect(p.token.verification).toBe("custom");
  });

  it("fake USDC (address diverso) → symbolConflict = true su Polygon", () => {
    const p = buildCustomTokenPreview(
      POLYGON, "USDC", "Fake USDC", 6,
      "0x2222222222222222222222222222222222222222"
    );
    expect(p.symbolConflict).toBe(true);
    expect(p.token.verification).toBe("custom");
  });

  it("fake USDA (address diverso) → symbolConflict = true su Polygon", () => {
    const p = buildCustomTokenPreview(
      POLYGON, "USDA", "Fake USDA", 18,
      "0x3333333333333333333333333333333333333333"
    );
    expect(p.symbolConflict).toBe(true);
    expect(p.token.verification).toBe("custom");
  });

  it("un token custom con symbol identico NON diventa mai verificato", () => {
    const p = buildCustomTokenPreview(
      ETH, "USDT", "Fake Tether", 6,
      "0x1111111111111111111111111111111111111111"
    );
    expect(p.token.verification).toBe("custom");
    expect(p.symbolConflict).toBe(true);
    // Il conflictWith mostra il token verificato
    expect(p.conflictWith?.verification).toBe("verified");
  });

  it("token con symbol sconosciuto → nessun conflitto", () => {
    const p = buildCustomTokenPreview(
      ETH, "NEWCOIN", "New Coin", 18,
      "0x4444444444444444444444444444444444444444"
    );
    expect(p.symbolConflict).toBe(false);
    expect(p.token.verification).toBe("custom");
  });

  it("isSymbolConflict case-insensitive", () => {
    expect(isSymbolConflict(ETH, "usdt")).toBe(true);
    expect(isSymbolConflict(ETH, "USDT")).toBe(true);
    expect(isSymbolConflict(ETH, "Usdt")).toBe(true);
  });
});

// ─── Token verificato vs custom ──────────────────────────────────────────

describe("Verified vs custom classification", () => {
  it("USDT ufficiale Ethereum → isVerified = true", () => {
    expect(isVerifiedAddress(ETH, "0xdAC17F958D2ee523a2206206994597C13D831ec7")).toBe(true);
  });

  it("USDT ufficiale Polygon → isVerified = true", () => {
    expect(isVerifiedAddress(POLYGON, "0xc2132D05D31c914a87C6611C10748AEb04B58e8F")).toBe(true);
  });

  it("indirizzo sconosciuto → isVerified = false", () => {
    expect(isVerifiedAddress(ETH, "0x0000000000000000000000000000000000000001")).toBe(false);
  });

  it("indirizzo valido su chain sbagliata → isVerified = false", () => {
    // USDT ETH address non è verificato su Polygon
    const usdtEth = "0xdAC17F958D2ee523a2206206994597C13D831ec7";
    expect(isVerifiedAddress(POLYGON, usdtEth)).toBe(false);
  });
});

// ─── Storage custom token ─────────────────────────────────────────────────

describe("Custom token storage (IndexedDB)", () => {
  const CUSTOM = {
    chainId: ETH,
    symbol: "MYTOKEN",
    name: "My Token",
    decimals: 18,
    contractAddress: "0xCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC" as `0x${string}`,
    standard: "ERC-20" as const,
    explorerUrl: "https://etherscan.io",
    verification: "custom" as const,
    importedAt: Date.now(),
  };

  afterEach(() => { closeWalletDB(); });
  beforeEach(async () => {
    closeWalletDB();
    try { await removeCustomToken(ETH, CUSTOM.contractAddress!); } catch {}
  });

  it("saveCustomToken + loadCustomTokens roundtrip", async () => {
    await saveCustomToken(CUSTOM);
    const tokens = await loadCustomTokens(ETH);
    const found = tokens.find(t => t.contractAddress === CUSTOM.contractAddress);
    expect(found).toBeDefined();
    expect(found!.symbol).toBe("MYTOKEN");
    expect(found!.verification).toBe("custom");
  });

  it("removeCustomToken elimina il token", async () => {
    await saveCustomToken(CUSTOM);
    await removeCustomToken(ETH, CUSTOM.contractAddress!);
    const tokens = await loadCustomTokens(ETH);
    expect(tokens.find(t => t.contractAddress === CUSTOM.contractAddress)).toBeUndefined();
  });

  it("getAllTokensForChain: verificati prima dei custom", async () => {
    await saveCustomToken(CUSTOM);
    const all = await getAllTokensForChain(ETH);
    const firstCustomIdx = all.findIndex(t => t.verification === "custom");
    const lastVerifiedIdx = all.map(t => t.verification).lastIndexOf("verified");
    expect(lastVerifiedIdx).toBeLessThan(firstCustomIdx);
  });

  it("saveCustomToken rifiuta token con verification=verified", async () => {
    const fake = { ...CUSTOM, verification: "verified" as const };
    await expect(saveCustomToken(fake)).rejects.toThrow();
  });

  it("token custom non contamina i token verificati", async () => {
    await saveCustomToken(CUSTOM);
    const verified = getVerifiedTokens(ETH);
    expect(verified.every(t => t.verification === "verified")).toBe(true);
    expect(verified.find(t => t.contractAddress === CUSTOM.contractAddress)).toBeUndefined();
  });

  it("loadCustomTokens filtra per chainId", async () => {
    await saveCustomToken(CUSTOM); // ETH
    const polyTokens = await loadCustomTokens(POLYGON);
    expect(polyTokens.find(t => t.contractAddress === CUSTOM.contractAddress)).toBeUndefined();
  });
});
