/**
 * multichain-config.ts — Configurazione del Multi-Chain Payment Engine
 *
 * SICUREZZA: Feature flags DEFAULT = false.
 * Nessuna nuova funzionalità diventa operativa senza configurazione esplicita.
 *
 * IMPORTANTE: L'USDA Polygon esistente NON dipende da queste variabili.
 * Il sistema USDA legge le proprie env (USDA_POLYGON_RPC, USDA_CONTRACT_ADDRESS, ecc.)
 * e continua a funzionare indipendentemente da questi flag.
 *
 * Queste variabili controllano ESCLUSIVAMENTE il nuovo Multi-Chain Payment Engine.
 *
 * ─── Environment variables ───────────────────────────────────────────────────
 *
 * Feature flags (default: false = sicuro):
 *   ENABLE_POLYGON_USDT=true|false
 *   ENABLE_BITCOIN=true|false
 *   ENABLE_ETHEREUM_USDT=true|false
 *   ENABLE_BSC_USDT=true|false
 *
 * Fee configuration:
 *   PROJECT_FEE_BPS=10          (10 basis points = 0.10%, priorità su RATE)
 *   PROJECT_FEE_RATE=0.001      (alternativa decimale, convertita in bps)
 *
 * Fee wallets (solo indirizzi pubblici — mai private key):
 *   POLYGON_FEE_WALLET=0x...
 *   ETHEREUM_FEE_WALLET=0x...
 *   BSC_FEE_WALLET=0x...
 *   BTC_FEE_WALLET=bc1...
 *
 * RPC URLs (primary + fallback opzionali separati da virgola):
 *   POLYGON_RPC_URL=https://...         (fallback a USDA_POLYGON_RPC se assente)
 *   POLYGON_RPC_FALLBACK_URLS=https://...,https://...
 *   ETHEREUM_RPC_URL=https://...
 *   ETHEREUM_RPC_FALLBACK_URLS=https://...
 *   BSC_RPC_URL=https://...
 *   BSC_RPC_FALLBACK_URLS=https://...
 *   BTC_RPC_URL=https://...
 *   BTC_RPC_FALLBACK_URLS=https://...
 *
 * Token contracts (override degli indirizzi di default):
 *   POLYGON_USDT_CONTRACT=0x...
 *   ETHEREUM_USDT_CONTRACT=0x...
 *   BSC_USDT_CONTRACT=0x...
 *   USDA_CONTRACT_ADDRESS=0x...         (già usato da USDA esistente)
 */

import { FeeConfigRegistry, DEFAULT_FEE_BPS } from "./fee-config";
import type { NetworkId } from "./adapter.interface";

// ─── Feature flags ────────────────────────────────────────────────────────────

/**
 * Feature flags per il Multi-Chain Payment Engine.
 * Tutti disabilitati di default — abilitare esplicitamente per deployment.
 *
 * USDA Polygon esistente NON è controllato da questi flag.
 */
export const FEATURE_FLAGS = {
  /** Polygon USDT (USDA Polygon esistente non è influenzato) */
  ENABLE_POLYGON_USDT:   env("ENABLE_POLYGON_USDT")  === "true",
  /** Bitcoin BTC nativo (UTXO, Phase 3) */
  ENABLE_BITCOIN:        env("ENABLE_BITCOIN")        === "true",
  /** Ethereum Mainnet USDT ERC-20 (Phase 4) */
  ENABLE_ETHEREUM_USDT:  env("ENABLE_ETHEREUM_USDT") === "true",
  /** BNB Smart Chain USDT BEP-20 (Phase 5) */
  ENABLE_BSC_USDT:       env("ENABLE_BSC_USDT")      === "true",
} as const;

// ─── RPC configuration ────────────────────────────────────────────────────────

export interface RpcConfig {
  primary:   string | null;
  fallbacks: string[];
}

function parseRpcConfig(primaryEnvKey: string, fallbackEnvKey?: string, fallbackPrimaryEnvKey?: string): RpcConfig {
  const primary =
    env(primaryEnvKey) ??
    (fallbackPrimaryEnvKey ? env(fallbackPrimaryEnvKey) : null) ??
    null;

  const fallbackRaw = fallbackEnvKey ? env(fallbackEnvKey) : undefined;
  const fallbacks = fallbackRaw
    ? fallbackRaw.split(",").map((s) => s.trim()).filter(Boolean)
    : [];

  return { primary, fallbacks };
}

export const RPC_CONFIGS: Record<NetworkId, RpcConfig> = {
  // Polygon: fallback a USDA_POLYGON_RPC (env già esistente) se POLYGON_RPC_URL assente
  polygon:  parseRpcConfig("POLYGON_RPC_URL",  "POLYGON_RPC_FALLBACK_URLS",  "USDA_POLYGON_RPC"),
  ethereum: parseRpcConfig("ETHEREUM_RPC_URL", "ETHEREUM_RPC_FALLBACK_URLS"),
  bsc:      parseRpcConfig("BSC_RPC_URL",      "BSC_RPC_FALLBACK_URLS"),
  bitcoin:  parseRpcConfig("BTC_RPC_URL",      "BTC_RPC_FALLBACK_URLS"),
};

// ─── Fee wallets ──────────────────────────────────────────────────────────────

/**
 * Indirizzi pubblici dei fee wallet per network.
 * Solo indirizzi pubblici — mai private key o seed phrase.
 * Configurabili a runtime via admin panel (Phase 2+).
 *
 * GAS WALLET ≠ FEE WALLET — non confondere:
 *   - FEE WALLET: riceve la commissione 0.10%
 *   - GAS WALLET (ESCROW_MASTER_KEY / GAS_STATION_PRIVATE_KEY): paga le network fee
 */
export const FEE_WALLETS: Record<NetworkId, string | null> = {
  polygon:  env("POLYGON_FEE_WALLET")  ?? null,
  ethereum: env("ETHEREUM_FEE_WALLET") ?? null,
  bsc:      env("BSC_FEE_WALLET")      ?? null,
  bitcoin:  env("BTC_FEE_WALLET")      ?? null,
};

// ─── Token contracts ──────────────────────────────────────────────────────────

/**
 * Indirizzi contratti token con override via env.
 * USDA contract riutilizza USDA_CONTRACT_ADDRESS (env già esistente).
 */
export const TOKEN_CONTRACTS = {
  polygon: {
    /** USDA su Polygon (già usato da USDA esistente) */
    USDA: env("USDA_CONTRACT_ADDRESS")   ?? "0xe714655fD1B3ba96B887DF1F94336c2A78E24001",
    /** USDT su Polygon (Tether USD, 6 decimali) */
    USDT: env("POLYGON_USDT_CONTRACT")  ?? "0xc2132D05D31c914a87C6611C10748AEb04B58e8F",
  },
  ethereum: {
    /** USDT su Ethereum Mainnet (Tether USD, 6 decimali) */
    USDT: env("ETHEREUM_USDT_CONTRACT") ?? "0xdAC17F958D2ee523a2206206994597C13D831ec7",
  },
  bsc: {
    /** BSC-Peg USDT (18 decimali — diverso da ETH/Polygon USDT) */
    USDT: env("BSC_USDT_CONTRACT")      ?? "0x55d398326f99059fF775485246999027B3197955",
  },
} as const;

/** Decimali per indirizzo contratto (lower-case) */
export const TOKEN_DECIMALS: Readonly<Record<string, number>> = {
  [TOKEN_CONTRACTS.polygon.USDA.toLowerCase()]:     18,
  [TOKEN_CONTRACTS.polygon.USDT.toLowerCase()]:      6,
  [TOKEN_CONTRACTS.ethereum.USDT.toLowerCase()]:     6,
  [TOKEN_CONTRACTS.bsc.USDT.toLowerCase()]:         18,
};

// ─── BTC fee rate configuration ───────────────────────────────────────────────

/**
 * Parametri configurabili per la gestione del fee rate BTC (M-3).
 * Tutti i valori sono letti da env vars con fallback sicuri.
 *
 * ESTIMATE_RATE — tasso usato per stimare min_deposit_amount alla creazione (sat/vbyte)
 * MAX_RATE      — cap massimo accettato da Blockstream (evita fee spike inattesi)
 * MIN_RATE      — floor minimo (evita TX non-relay per fee troppo bassa)
 * BUFFER_SAT    — buffer aggiuntivo sopra la miner fee stimata per min_deposit
 */
function parseIntEnv(key: string, defaultVal: number): number {
  const v = env(key);
  if (!v) return defaultVal;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : defaultVal;
}

export const BTC_FEE_CONFIG = {
  /** Tasso stimato per minDepositAmount (sat/vbyte) — default 20 */
  ESTIMATE_RATE: parseIntEnv("BTC_ESTIMATE_FEE_RATE_SAT_VB", 20),
  /** Cap massimo fee rate da Blockstream (sat/vbyte) — default 200 */
  MAX_RATE:      parseIntEnv("BTC_MAX_FEE_RATE_SAT_VB", 200),
  /** Floor minimo fee rate (sat/vbyte) — default 2 */
  MIN_RATE:      parseIntEnv("BTC_MIN_FEE_RATE_SAT_VB", 2),
  /** Buffer sicurezza per min_deposit (sat) — default 5000 */
  BUFFER_SAT:    BigInt(parseIntEnv("BTC_MINER_FEE_BUFFER_SAT", 5_000)),
} as const;

// ─── Default fee registry ─────────────────────────────────────────────────────

/**
 * Costruisce il FeeConfigRegistry con le configurazioni di default.
 * Tutte le reti: 0.10% fee, wallet da FEE_WALLETS.
 * Aggiornabile a runtime dall'admin panel (Phase 2+).
 */
export function buildDefaultFeeRegistry(): FeeConfigRegistry {
  const feeBps = parseFeeRate();
  const registry = new FeeConfigRegistry();

  const networks: NetworkId[] = ["polygon", "ethereum", "bsc", "bitcoin"];
  for (const network of networks) {
    registry.set(network, "*", {
      feeBps,
      feeWallet: FEE_WALLETS[network],
      enabled:   true,
    });
  }

  return registry;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Legge fee rate dall'env.
 * Priorità: PROJECT_FEE_BPS → PROJECT_FEE_RATE → default (10 bps = 0.10%)
 */
function parseFeeRate(): bigint {
  const bpsStr = env("PROJECT_FEE_BPS");
  if (bpsStr) {
    try {
      const bps = BigInt(bpsStr);
      if (bps >= 0n && bps <= 10_000n) return bps;
    } catch { /* invalid, try next */ }
  }

  const rateStr = env("PROJECT_FEE_RATE");
  if (rateStr) {
    const rate = parseFloat(rateStr);
    if (!isNaN(rate) && rate >= 0 && rate <= 1) {
      return BigInt(Math.round(rate * 10_000));
    }
  }

  return DEFAULT_FEE_BPS; // 10 bps = 0.10%
}

/** Legge process.env in modo type-safe (undefined se assente o stringa vuota) */
function env(key: string): string | undefined {
  const val = process.env[key];
  return val && val.trim() !== "" ? val.trim() : undefined;
}
