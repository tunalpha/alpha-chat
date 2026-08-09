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
 *   BTC_API_URL=https://...             (primary — default: https://blockstream.info/api)
 *   BTC_RPC_URL=https://...             (opzionale — legacy secondario, usato solo se BTC_API_URL assente)
 *   BTC_RPC_FALLBACK_URLS=https://...   (opzionale — fallback aggiuntivi)
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

/**
 * Costruisce l'URL Alchemy per un network EVM usando ALCHEMY_API_KEY.
 * Restituisce null se la chiave non è configurata.
 * Alchemy NON supporta BSC — per BSC usare dRPC.
 */
function buildAlchemyUrl(network: "polygon" | "ethereum"): string | null {
  const key = env("ALCHEMY_API_KEY");
  if (!key) return null;
  const host = network === "polygon"
    ? "polygon-mainnet.g.alchemy.com"
    : "eth-mainnet.g.alchemy.com";
  return `https://${host}/v2/${key}`;
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

/**
 * Costruisce RpcConfig con Alchemy come primario (se ALCHEMY_API_KEY presente)
 * e il valore del secret come fallback. Per BSC usa solo dRPC.
 */
function alchemyFirstConfig(
  alchemyNetwork: "polygon" | "ethereum" | null,
  secretEnvKey: string,
  extraFallbackKey?: string,
): RpcConfig {
  const alchemyUrl = alchemyNetwork ? buildAlchemyUrl(alchemyNetwork) : null;
  const secretUrl  = env(secretEnvKey) ?? null;

  const primary   = alchemyUrl ?? secretUrl ?? null;
  const rawExtra  = extraFallbackKey ? env(extraFallbackKey) : undefined;
  const extra     = rawExtra ? rawExtra.split(",").map((s) => s.trim()).filter(Boolean) : [];

  // Se Alchemy è primario, aggiungi il secret come primo fallback
  const fallbacks = alchemyUrl && secretUrl
    ? [secretUrl, ...extra]
    : extra;

  return { primary, fallbacks };
}

export const RPC_CONFIGS: Record<NetworkId, RpcConfig> = {
  // Polygon: Alchemy primario → POLYGON_RPC_URL (dRPC) fallback → POLYGON_RPC_FALLBACK_URLS
  polygon:  alchemyFirstConfig("polygon",  "POLYGON_RPC_URL",  "POLYGON_RPC_FALLBACK_URLS"),
  // Ethereum: Alchemy primario → ETHEREUM_RPC_URL (dRPC) fallback
  ethereum: alchemyFirstConfig("ethereum", "ETHEREUM_RPC_URL", "ETHEREUM_RPC_FALLBACK_URLS"),
  // BSC: Alchemy non supporta BSC → dRPC (BSC_RPC_URL) come primario
  bsc:      parseRpcConfig("BSC_RPC_URL", "BSC_RPC_FALLBACK_URLS"),
  // Bitcoin: Blockstream REST API primario, fallback opzionali
  bitcoin:  parseRpcConfig("BTC_API_URL", "BTC_RPC_FALLBACK_URLS", "BTC_RPC_URL"),
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

// ─── EVM Flat Network Fee ─────────────────────────────────────────────────────

/**
 * Commissione flat addebitata al cliente per coprire il costo gas delle TX EVM.
 *
 * Configurabile via env in base units dell'asset (USDT):
 *   POLYGON_FLAT_NETWORK_FEE_USDT  — override Polygon-specifico; fallback a
 *                                     ETHEREUM_FLAT_NETWORK_FEE_USDT (backwards compat);
 *                                     default 10_000 = 0.01 USDT (Polygon gas costa ~$0.001)
 *   ETHEREUM_FLAT_NETWORK_FEE_USDT — Ethereum; default 15_000_000 = 15.00 USDT
 *   BSC_FLAT_NETWORK_FEE_USDT      — BSC 18 dec; default 1e18 = 1.00 USDT
 *
 * IMPORTANTE — BSC USDT ha 18 decimali (non 6):
 *   1 USDT BSC = 1_000_000_000_000_000_000 raw units
 *
 * La funzione usa BigInt() direttamente sulla stringa env per evitare perdita di
 * precisione float con valori > 2^53 (necessario per BSC 18-dec).
 *
 * Il valore viene letto al create time e salvato nel transfer.
 * Cambi successivi all'env non modificano transfer già creati (immutabile per record).
 *
 * BTC: restituisce 0n — il costo miner è incluso nel buffer di minDepositAmount.
 */
export function getEVMFlatNetworkFee(network: NetworkId): bigint {
  /** Legge un env come BigInt con fallback stringa. Più sicuro di parseIntEnv per valori > 2^53. */
  function envBigInt(key: string, defaultStr: string): bigint {
    const v = env(key);
    if (!v) return BigInt(defaultStr);
    try {
      const n = BigInt(v);
      return n > 0n ? n : BigInt(defaultStr);
    } catch {
      return BigInt(defaultStr);
    }
  }

  switch (network) {
    // Polygon: 6 decimali, gas ~$0.001 per TX → default 0.01 USDT = 10_000 raw
    // Override: POLYGON_FLAT_NETWORK_FEE_USDT (env var dedicato Polygon)
    case "polygon":  return envBigInt("POLYGON_FLAT_NETWORK_FEE_USDT",  "10000");
    // Ethereum: 6 decimali, default 15.00 USDT (anti-loss check è il safety net)
    // Override: ETHEREUM_FLAT_NETWORK_FEE_USDT
    case "ethereum": return envBigInt("ETHEREUM_FLAT_NETWORK_FEE_USDT", "15000000");
    // BSC: 18 decimali! default 1.00 USDT = 1e18 raw units
    case "bsc":      return envBigInt("BSC_FLAT_NETWORK_FEE_USDT",      "1000000000000000000");
    case "bitcoin":  return 0n;
    default:         return 0n;
  }
}

// ─── Anti-Loss Check configuration ───────────────────────────────────────────

/**
 * Gas units totali stimati per un release EVM completo (TX1 + TX2).
 *
 * Formula: MC_GAS_LIMIT_PER_TX × MC_GAS_TX_COUNT × MC_GAS_STATION_BUFFER + GAS_NATIVE_TX
 *   = 80_000 × 2 × 2 + 21_000 = 341_000
 *
 * Usato dall'anti-loss check in _releaseEvm per stimare il costo blockchain
 * al momento del release (gasPrice live × questo valore).
 */
export const MC_ANTI_LOSS_GAS_UNITS = 341_000n;

/**
 * Prezzo del token nativo (BNB o ETH) in USDT, configurato dall'admin.
 *
 * Usato dall'anti-loss check per convertire il costo gas (in native wei) in USDT
 * e confrontarlo con il networkFeeCharged incassato dal cliente.
 *
 * Configurabile via env (aggiornare periodicamente o al cambio significativo del prezzo):
 *   BSC_NATIVE_PRICE_USDT  — prezzo BNB in USDT (es. 800 per BNB a $800)
 *   ETH_NATIVE_PRICE_USDT  — prezzo ETH in USDT (es. 5000 per ETH a $3500 + buffer)
 *
 * Consiglio: impostare il 30-50% sopra il prezzo di mercato corrente per avere
 * un margine di sicurezza contro volatilità del prezzo nativo.
 *
 * Se non configurato: l'anti-loss check è skippato (warning log). Il sistema rimane
 * operativo ma senza protezione automatica contro gas spike + price spike.
 *
 * NON disponibile per Polygon (gas trascurabile) e Bitcoin (miner fee nel buffer BTC).
 *
 * @returns prezzo intero in USDT, o null se non configurato
 */
export function getNativePriceUSDT(network: NetworkId): number | null {
  switch (network) {
    case "bsc":      return parseIntEnv("BSC_NATIVE_PRICE_USDT",  0) || null;
    case "ethereum": return parseIntEnv("ETH_NATIVE_PRICE_USDT",  0) || null;
    default:         return null;
  }
}

/**
 * Asset nativo usato per pagare il gas su ogni network.
 * Usato come valore informativo in DB/API (network_fee_asset).
 */
export const NATIVE_ASSET_SYMBOL: Record<NetworkId, string> = {
  polygon:  "POL",
  ethereum: "ETH",
  bsc:      "BNB",
  bitcoin:  "BTC",
};

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
