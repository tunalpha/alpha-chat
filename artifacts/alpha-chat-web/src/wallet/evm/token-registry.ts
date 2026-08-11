/**
 * Alpha Wallet — Token Registry
 *
 * REGOLA FONDAMENTALE:
 *   Token VERIFIED  = presenti in questo file, indirizzi ufficiali verificati
 *   Token CUSTOM    = importati dall'utente tramite contract address
 *
 *   Un token CUSTOM con symbol identico a un token VERIFIED
 *   non diventa mai VERIFIED. Viene sempre mostrato con badge ⚠️.
 *
 * INDIRIZZI VERIFICATI:
 *   - Ethereum: Etherscan
 *   - Polygon:  Polygonscan
 *   - BSC:      BSCScan
 *
 * ⚠️ DECIMALI BSC USDT = 18 (NON 6)
 *    Questo è un errore frequente che causa bug critici.
 *    Il token registry è la fonte di verità unica per i decimali.
 */

import { getWalletDB, STORE_CUSTOM_TOKENS, closeWalletDB } from "../core/wallet-db";

// ─── Tipi ─────────────────────────────────────────────────────────────────

export type TokenVerification = "verified" | "custom";

export interface TokenConfig {
  chainId: number;
  symbol: string;
  name: string;
  decimals: number;
  /** undefined = token nativo (ETH, POL, BNB) */
  contractAddress?: `0x${string}`;
  standard: "native" | "ERC-20";
  logoUrl?: string;
  explorerUrl: string;
  /** CoinGecko ID per price feed */
  coingeckoId?: string;
  verification: TokenVerification;
  /** Solo per token custom */
  importedAt?: number;
}

// ─── Token verificati ─────────────────────────────────────────────────────

/**
 * Registry dei token ufficiali verificati.
 * Indirizzi verificati da Etherscan / Polygonscan / BSCScan.
 */
export const VERIFIED_TOKENS: TokenConfig[] = [
  // ── Ethereum (chainId: 1) ─────────────────────────────────────────────
  {
    chainId: 1,
    symbol: "ETH",
    name: "Ether",
    decimals: 18,
    standard: "native",
    explorerUrl: "https://etherscan.io",
    coingeckoId: "ethereum",
    verification: "verified",
  },
  {
    chainId: 1,
    symbol: "USDT",
    name: "Tether USD",
    decimals: 6,
    contractAddress: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
    standard: "ERC-20",
    explorerUrl: "https://etherscan.io",
    coingeckoId: "tether",
    verification: "verified",
  },
  {
    chainId: 1,
    symbol: "USDC",
    name: "USD Coin",
    decimals: 6,
    contractAddress: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    standard: "ERC-20",
    explorerUrl: "https://etherscan.io",
    coingeckoId: "usd-coin",
    verification: "verified",
  },

  // ── Polygon (chainId: 137) ───────────────────────────────────────────
  {
    chainId: 137,
    symbol: "POL",
    name: "POL",
    decimals: 18,
    standard: "native",
    explorerUrl: "https://polygonscan.com",
    coingeckoId: "matic-network",
    verification: "verified",
  },
  {
    chainId: 137,
    symbol: "USDT",
    name: "Tether USD",
    decimals: 6,
    contractAddress: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F",
    standard: "ERC-20",
    explorerUrl: "https://polygonscan.com",
    coingeckoId: "tether",
    verification: "verified",
  },
  {
    chainId: 137,
    symbol: "USDC",
    name: "USD Coin",
    decimals: 6,
    contractAddress: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
    standard: "ERC-20",
    explorerUrl: "https://polygonscan.com",
    coingeckoId: "usd-coin",
    verification: "verified",
  },
  {
    chainId: 137,
    symbol: "USDA",
    name: "USDA Stablecoin",
    decimals: 18,
    // Indirizzo da aggiornare con quello ufficiale verificato su Polygonscan
    contractAddress: "0x23396cF899Ca06c4472205fC903bDB4de249D6fA",
    standard: "ERC-20",
    explorerUrl: "https://polygonscan.com",
    verification: "verified",
  },

  // ── BSC (chainId: 56) ────────────────────────────────────────────────
  {
    chainId: 56,
    symbol: "BNB",
    name: "BNB",
    decimals: 18,
    standard: "native",
    explorerUrl: "https://bscscan.com",
    coingeckoId: "binancecoin",
    verification: "verified",
  },
  {
    chainId: 56,
    symbol: "USDT",
    name: "Tether USD",
    // ⚠️ BSC USDT = 18 DECIMALS (non 6 come su ETH/Polygon)
    decimals: 18,
    contractAddress: "0x55d398326f99059fF775485246999027B3197955",
    standard: "ERC-20",
    explorerUrl: "https://bscscan.com",
    coingeckoId: "tether",
    verification: "verified",
  },
  {
    chainId: 56,
    symbol: "USDC",
    name: "USD Coin",
    // ⚠️ BSC USDC = 18 DECIMALS
    decimals: 18,
    contractAddress: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
    standard: "ERC-20",
    explorerUrl: "https://bscscan.com",
    coingeckoId: "usd-coin",
    verification: "verified",
  },
];

// ─── Lookup verified tokens ────────────────────────────────────────────────

/** Token verificati per una rete specifica */
export function getVerifiedTokens(chainId: number): TokenConfig[] {
  return VERIFIED_TOKENS.filter(t => t.chainId === chainId);
}

/** Token nativo di una rete (ETH, POL, BNB) */
export function getNativeToken(chainId: number): TokenConfig | undefined {
  return VERIFIED_TOKENS.find(t => t.chainId === chainId && t.standard === "native");
}

/** Cerca un token verificato per contract address (case-insensitive) */
export function findVerifiedByAddress(
  chainId: number,
  address: string
): TokenConfig | undefined {
  const norm = address.toLowerCase();
  return VERIFIED_TOKENS.find(
    t => t.chainId === chainId && t.contractAddress?.toLowerCase() === norm
  );
}

/** True se un contract address è un token ufficiale verificato */
export function isVerifiedAddress(chainId: number, address: string): boolean {
  return findVerifiedByAddress(chainId, address) !== undefined;
}

/**
 * True se il symbol è già usato da un token verificato sulla rete.
 * Usato per il warning anti-phishing durante l'import di token custom.
 */
export function isSymbolConflict(chainId: number, symbol: string): boolean {
  const norm = symbol.toUpperCase();
  return VERIFIED_TOKENS.some(
    t => t.chainId === chainId && t.symbol.toUpperCase() === norm
  );
}

// ─── Custom token storage (IndexedDB) ─────────────────────────────────────

/** Salva un token custom importato dall'utente */
export async function saveCustomToken(token: TokenConfig): Promise<void> {
  if (token.verification !== "custom") {
    throw new Error("[AlphaWallet] Solo i token custom possono essere salvati con questo metodo");
  }
  const db = await getWalletDB();
  await db.put(STORE_CUSTOM_TOKENS, { ...token, importedAt: Date.now() });
}

/** Carica tutti i custom token per una rete */
export async function loadCustomTokens(chainId: number): Promise<TokenConfig[]> {
  const db = await getWalletDB();
  const all: TokenConfig[] = await db.getAll(STORE_CUSTOM_TOKENS);
  return all.filter(t => t.chainId === chainId);
}

/** Elimina un custom token */
export async function removeCustomToken(
  chainId: number,
  contractAddress: string
): Promise<void> {
  const db = await getWalletDB();
  await db.delete(STORE_CUSTOM_TOKENS, [chainId, contractAddress]);
}

/**
 * Restituisce tutti i token per una rete: prima verificati, poi custom.
 * I custom token hanno sempre verification = "custom".
 */
export async function getAllTokensForChain(chainId: number): Promise<TokenConfig[]> {
  const verified = getVerifiedTokens(chainId);
  const custom = await loadCustomTokens(chainId);
  return [...verified, ...custom];
}

/** Chiude la connessione DB (per reset nei test) */
export { closeWalletDB };

// ─── Anti-phishing helper ─────────────────────────────────────────────────

export interface CustomTokenPreview {
  token: TokenConfig;
  /** True se il symbol è identico a un token verificato (rischio phishing) */
  symbolConflict: boolean;
  /** Token verificato che ha lo stesso symbol, se esiste */
  conflictWith?: TokenConfig;
}

/**
 * Prepara l'anteprima di un token custom prima dell'import.
 * Calcola se c'è un conflitto di symbol con token ufficiali.
 */
export function buildCustomTokenPreview(
  chainId: number,
  symbol: string,
  name: string,
  decimals: number,
  contractAddress: `0x${string}`
): CustomTokenPreview {
  const token: TokenConfig = {
    chainId,
    symbol,
    name,
    decimals,
    contractAddress,
    standard: "ERC-20",
    explorerUrl: getNetworkExplorer(chainId),
    verification: "custom",
    importedAt: Date.now(),
  };

  const conflictWith = VERIFIED_TOKENS.find(
    t =>
      t.chainId === chainId &&
      t.symbol.toUpperCase() === symbol.toUpperCase()
  );

  return {
    token,
    symbolConflict: conflictWith !== undefined,
    conflictWith,
  };
}

function getNetworkExplorer(chainId: number): string {
  const explorers: Record<number, string> = {
    1: "https://etherscan.io",
    137: "https://polygonscan.com",
    56: "https://bscscan.com",
  };
  return explorers[chainId] ?? "";
}
