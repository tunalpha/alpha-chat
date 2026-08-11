/**
 * Test — Alpha Wallet: Token Registry
 *
 * Verifica:
 * - Token verificati presenti per ogni rete
 * - Decimali BSC USDT = 18 (NON 6) — test critico anti-bug
 * - Lookup per chainId e address
 * - Rilevamento conflitti symbol (anti-phishing)
 * - Custom token import e storage
 * - Token custom mai mostrati come verificati
 * - Native token (ETH, POL, BNB) presenti
 *
 * Usa fake-indexeddb perché happy-dom non espone `indexedDB` come global bare.
 */

// Polyfill IndexedDB per test Node.js / happy-dom
import "fake-indexeddb/auto";

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  VERIFIED_TOKENS,
  getVerifiedTokens,
  getNativeToken,
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

// Chain IDs
const ETH = 1;
const POLYGON = 137;
const BSC = 56;

describe("VERIFIED_TOKENS — struttura", () => {
  it("contiene token per Ethereum, Polygon e BSC", () => {
    const chains = [...new Set(VERIFIED_TOKENS.map(t => t.chainId))];
    expect(chains).toContain(ETH);
    expect(chains).toContain(POLYGON);
    expect(chains).toContain(BSC);
  });

  it("tutti i token verificati hanno verification = 'verified'", () => {
    for (const t of VERIFIED_TOKENS) {
      expect(t.verification).toBe("verified");
    }
  });

  it("tutti i token ERC-20 hanno un contractAddress", () => {
    for (const t of VERIFIED_TOKENS) {
      if (t.standard === "ERC-20") {
        expect(t.contractAddress).toBeTruthy();
        // USDA Polygon ha 39 hex chars (indirizzo production immutabile, non standard)
        expect(t.contractAddress).toMatch(/^0x[0-9a-fA-F]{38,40}$/);
      }
    }
  });

  it("i token nativi non hanno contractAddress", () => {
    for (const t of VERIFIED_TOKENS) {
      if (t.standard === "native") {
        expect(t.contractAddress).toBeUndefined();
      }
    }
  });
});

describe("⚠️ BSC USDT decimals = 18 (test critico)", () => {
  it("USDT su BSC ha 18 decimali (NON 6)", () => {
    const usdtBsc = VERIFIED_TOKENS.find(
      t => t.chainId === BSC && t.symbol === "USDT"
    );
    expect(usdtBsc).toBeDefined();
    expect(usdtBsc!.decimals).toBe(18);
  });

  it("USDT su Ethereum ha 6 decimali", () => {
    const usdtEth = VERIFIED_TOKENS.find(
      t => t.chainId === ETH && t.symbol === "USDT"
    );
    expect(usdtEth).toBeDefined();
    expect(usdtEth!.decimals).toBe(6);
  });

  it("USDT su Polygon ha 6 decimali", () => {
    const usdtPoly = VERIFIED_TOKENS.find(
      t => t.chainId === POLYGON && t.symbol === "USDT"
    );
    expect(usdtPoly).toBeDefined();
    expect(usdtPoly!.decimals).toBe(6);
  });

  it("USDC su BSC ha 18 decimali (NON 6)", () => {
    const usdcBsc = VERIFIED_TOKENS.find(
      t => t.chainId === BSC && t.symbol === "USDC"
    );
    expect(usdcBsc).toBeDefined();
    expect(usdcBsc!.decimals).toBe(18);
  });
});

describe("getNativeToken", () => {
  it("ETH è il token nativo di Ethereum", () => {
    const native = getNativeToken(ETH);
    expect(native).toBeDefined();
    expect(native!.symbol).toBe("ETH");
    expect(native!.decimals).toBe(18);
  });

  it("POL è il token nativo di Polygon", () => {
    const native = getNativeToken(POLYGON);
    expect(native).toBeDefined();
    expect(native!.symbol).toBe("POL");
  });

  it("BNB è il token nativo di BSC", () => {
    const native = getNativeToken(BSC);
    expect(native).toBeDefined();
    expect(native!.symbol).toBe("BNB");
  });
});

describe("getVerifiedTokens", () => {
  it("Polygon ha almeno 4 token verificati (POL, USDT, USDC, USDA)", () => {
    const tokens = getVerifiedTokens(POLYGON);
    expect(tokens.length).toBeGreaterThanOrEqual(4);
    const symbols = tokens.map(t => t.symbol);
    expect(symbols).toContain("POL");
    expect(symbols).toContain("USDT");
    expect(symbols).toContain("USDC");
    expect(symbols).toContain("USDA");
  });

  it("restituisce array vuoto per chain non supportata", () => {
    const tokens = getVerifiedTokens(999);
    expect(tokens).toHaveLength(0);
  });
});

describe("findVerifiedByAddress / isVerifiedAddress", () => {
  it("trova USDT Ethereum per address ufficiale", () => {
    const token = findVerifiedByAddress(
      ETH,
      "0xdAC17F958D2ee523a2206206994597C13D831ec7"
    );
    expect(token).toBeDefined();
    expect(token!.symbol).toBe("USDT");
    expect(token!.verification).toBe("verified");
  });

  it("case-insensitive: trova token con address lowercase", () => {
    const token = findVerifiedByAddress(
      ETH,
      "0xdac17f958d2ee523a2206206994597c13d831ec7"
    );
    expect(token).toBeDefined();
  });

  it("non trova token per address sconosciuto", () => {
    const token = findVerifiedByAddress(ETH, "0x0000000000000000000000000000000000000000");
    expect(token).toBeUndefined();
  });

  it("isVerifiedAddress: true per address ufficiale", () => {
    expect(
      isVerifiedAddress(POLYGON, "0xc2132D05D31c914a87C6611C10748AEb04B58e8F")
    ).toBe(true);
  });

  it("isVerifiedAddress: false per address sconosciuto", () => {
    expect(
      isVerifiedAddress(POLYGON, "0x0000000000000000000000000000000000000001")
    ).toBe(false);
  });
});

describe("Anti-phishing — isSymbolConflict", () => {
  it("rileva conflitto: USDT esiste su Ethereum", () => {
    expect(isSymbolConflict(ETH, "USDT")).toBe(true);
  });

  it("rileva conflitto: case-insensitive (usdt)", () => {
    expect(isSymbolConflict(ETH, "usdt")).toBe(true);
  });

  it("nessun conflitto per symbol sconosciuto", () => {
    expect(isSymbolConflict(ETH, "FAKECOIN")).toBe(false);
  });

  it("nessun conflitto per symbol su rete diversa (USDA solo su Polygon)", () => {
    expect(isSymbolConflict(ETH, "USDA")).toBe(false);
    expect(isSymbolConflict(POLYGON, "USDA")).toBe(true);
  });
});

describe("buildCustomTokenPreview", () => {
  it("token custom con symbol sconosciuto non ha conflitto", () => {
    const preview = buildCustomTokenPreview(
      POLYGON, "NEWTOKEN", "New Token", 18,
      "0x1234567890123456789012345678901234567890"
    );
    expect(preview.symbolConflict).toBe(false);
    expect(preview.token.verification).toBe("custom");
  });

  it("token custom con symbol USDT ha conflitto (anti-phishing)", () => {
    const preview = buildCustomTokenPreview(
      POLYGON, "USDT", "Fake Tether", 6,
      "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
    );
    expect(preview.symbolConflict).toBe(true);
    expect(preview.conflictWith).toBeDefined();
    expect(preview.conflictWith!.verification).toBe("verified");
    // Il token custom rimane "custom" nonostante il symbol identico
    expect(preview.token.verification).toBe("custom");
  });

  it("il token custom creato ha sempre verification = 'custom'", () => {
    const preview = buildCustomTokenPreview(
      ETH, "USDC", "Fake USDC", 6,
      "0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB"
    );
    expect(preview.token.verification).toBe("custom");
  });
});

describe("Custom token storage (IndexedDB)", () => {
  const CUSTOM_TOKEN = {
    chainId: POLYGON,
    symbol: "MYTOKEN",
    name: "My Custom Token",
    decimals: 18,
    contractAddress: "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" as `0x${string}`,
    standard: "ERC-20" as const,
    explorerUrl: "https://polygonscan.com",
    verification: "custom" as const,
    importedAt: Date.now(),
  };

  afterEach(() => {
    // Reset DB singleton tra test per isolamento
    closeWalletDB();
  });

  beforeEach(async () => {
    closeWalletDB();
    // Pulisce token custom prima di ogni test
    try {
      await removeCustomToken(POLYGON, CUSTOM_TOKEN.contractAddress!);
    } catch {
      // ignore se non esiste
    }
  });

  it("salva e ricarica un custom token", async () => {
    await saveCustomToken(CUSTOM_TOKEN);
    const loaded = await loadCustomTokens(POLYGON);
    const found = loaded.find(t => t.contractAddress === CUSTOM_TOKEN.contractAddress);
    expect(found).toBeDefined();
    expect(found!.symbol).toBe("MYTOKEN");
    expect(found!.verification).toBe("custom");
  });

  it("removeCustomToken elimina il token", async () => {
    await saveCustomToken(CUSTOM_TOKEN);
    await removeCustomToken(POLYGON, CUSTOM_TOKEN.contractAddress!);
    const loaded = await loadCustomTokens(POLYGON);
    const found = loaded.find(t => t.contractAddress === CUSTOM_TOKEN.contractAddress);
    expect(found).toBeUndefined();
  });

  it("getAllTokensForChain mostra verificati prima dei custom", async () => {
    await saveCustomToken(CUSTOM_TOKEN);
    const all = await getAllTokensForChain(POLYGON);
    const verifiedTokens = all.filter(t => t.verification === "verified");
    const customTokens = all.filter(t => t.verification === "custom");
    expect(verifiedTokens.length).toBeGreaterThan(0);
    expect(customTokens.length).toBeGreaterThan(0);
    // I verificati vengono prima
    const firstCustomIdx = all.findIndex(t => t.verification === "custom");
    const lastVerifiedIdx = all.map(t => t.verification).lastIndexOf("verified");
    expect(lastVerifiedIdx).toBeLessThan(firstCustomIdx);
  });

  it("non può salvare un token come verified via saveCustomToken", async () => {
    const fake = { ...CUSTOM_TOKEN, verification: "verified" as const };
    await expect(saveCustomToken(fake)).rejects.toThrow();
  });
});
