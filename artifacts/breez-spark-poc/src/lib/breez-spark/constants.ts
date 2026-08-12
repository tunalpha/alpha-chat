/**
 * BREEZ SPARK — COSTANTI
 * Separazione netta da BTC on-chain e da qualsiasi store Alpha esistente.
 */

// ─── Derivation paths ─────────────────────────────────────────────────────────

/**
 * Purpose field Spark: ultimi 3 byte di SHA256("spark") = 0x863d73 = 8797555
 * Standard BIP43 con purpose custom — completamente separato da BIP84 (purpose=84)
 *
 * BTC on-chain Alpha Wallet:  m/84'/0'/0'/0/{idx}   ← NON MODIFICARE
 * Spark Identity (mainnet):   m/8797555'/1'/0'       ← purpose DIVERSO, nessuna collisione
 * Spark Signing (mainnet):    m/8797555'/1'/1'
 * Spark Deposit (mainnet):    m/8797555'/1'/2'
 * Spark Static Deposit:       m/8797555'/1'/3'
 * Spark HTLC Preimage:        m/8797555'/1'/4'
 */
export const SPARK_DERIVATION = {
  PURPOSE: 8797555,
  PURPOSE_HEX: '0x863d73',
  PURPOSE_ORIGIN: "SHA256('spark') last 3 bytes",

  // Account number per network (default ufficiale Spark)
  ACCOUNT_NUMBER: {
    mainnet: 1, // mainnet default = 1 (backward compat legacy wallets)
    regtest: 0,
  },

  // Key types (indice hardened)
  KEY_TYPE: {
    identity: 0,      // m/8797555'/n'/0'  — identificatore primario + Spark Address
    signing: 1,       // m/8797555'/n'/1'  — base per leaf key derivation
    deposit: 2,       // m/8797555'/n'/2'  — depositi L1 Bitcoin
    staticDeposit: 3, // m/8797555'/n'/3'  — indirizzi statici riusabili
    htlcPreimage: 4,  // m/8797555'/n'/4'  — HTLC preimage Lightning
  },

  // Percorsi completi per mainnet (account=1)
  FULL_PATHS: {
    identity: "m/8797555'/1'/0'",
    signing: "m/8797555'/1'/1'",
    deposit: "m/8797555'/1'/2'",
    staticDeposit: "m/8797555'/1'/3'",
    htlcPreimage: "m/8797555'/1'/4'",
  },

  // BTC on-chain (solo documentazione — NON usato in questo modulo)
  BTC_ON_CHAIN_PATH: "m/84'/0'/0'/0/{index}",
} as const;

// ─── IndexedDB — namespace isolato ───────────────────────────────────────────

/**
 * IMPORTANTE: questi nomi di database sono COMPLETAMENTE SEPARATI
 * da qualsiasi store esistente di Alpha Wallet (keystore BTC, Signal IDB, ecc.)
 */
export const SPARK_IDB = {
  /** Database principale Spark (stato, pagamenti, leaves) */
  DB_NAME: 'breez-spark-alpha-v1',

  /** Database per metadati e recovery */
  META_DB_NAME: 'breez-spark-meta-v1',

  /** Prefisso per database specifici dell'utente (aggiunge fingerprint identity pubkey) */
  USER_DB_PREFIX: 'breez-spark-user-',

  /** Object store names */
  STORES: {
    payments: 'payments',
    metadata: 'metadata',
    cached: 'cached_items',
    contacts: 'contacts',
  },
} as const;

// ─── Network ──────────────────────────────────────────────────────────────────

export const SPARK_NETWORK = {
  /** Supportati dall'SDK v0.15.1 — NO signet/testnet */
  SUPPORTED: ['mainnet', 'regtest'] as const,

  /** Default per produzione */
  DEFAULT: 'mainnet' as const,

  /** Operatori Spark su mainnet */
  OPERATORS: [
    { id: '0', name: 'LightSpark', address: 'https://0.spark.lightspark.com' },
    { id: '1', name: 'Breez', address: 'https://spark-operator.breez.technology' },
    { id: '2', name: 'Flashnet', address: 'https://2.spark.flashnet.xyz' },
  ],

  /** SSP (Spark Service Provider) */
  SSP: {
    name: 'LightSpark SSP',
    baseUrl: 'https://api.lightspark.com',
  },

  /** Status endpoint — CORS blocked dal browser, deve essere proxied */
  STATUS_ENDPOINT: 'https://spark.money/api/v1/status',
  STATUS_CORS_BLOCKED_IN_BROWSER: true,
} as const;

// ─── Fee model ────────────────────────────────────────────────────────────────

export const SPARK_FEE = {
  /**
   * Alpha platform fee: 0.10% dell'importo inviato
   * Separata dalle fee Spark/Lightning (ancora sconosciute da Breez)
   */
  ALPHA_PLATFORM_FEE_BPS: 10, // basis points = 0.10%

  /**
   * Fee Spark/Lightning: NON ANCORA NOTA — in attesa risposta Breez
   * NON fare stime. Mostrare come "TBD" nell'UI.
   */
  SPARK_OPERATOR_FEE: null as null,

  /**
   * Modalità fee: sempre feesExcluded = recipient_exact
   * Il destinatario riceve esattamente l'importo; il mittente paga fee extra.
   */
  FEE_POLICY: 'feesExcluded' as const,

  /** Importo minimo per un pagamento Lightning (dust limit) */
  MIN_PAYMENT_SATS: 1n,

  /** Exit on-chain: bond richiesto */
  UNILATERAL_EXIT_BOND_SATS: 10_000n,
  UNILATERAL_EXIT_LOCKTIME_BLOCKS: 1000,
} as const;

// ─── Portfolio types ──────────────────────────────────────────────────────────

/**
 * Tipi asset per il portfolio — SEPARATI da btc (on-chain)
 * NON sommare automaticamente btc + btc_lightning nell'UI senza distinzione.
 */
export const SPARK_PORTFOLIO_TYPES = {
  BTC_ONCHAIN: 'btc' as const,            // esistente — NON MODIFICARE
  BTC_LIGHTNING: 'btc_lightning' as const, // Lightning (BOLT11/BOLT12 send)
  SPARK: 'spark' as const,                 // Spark-to-Spark
} as const;

// ─── Transaction types ────────────────────────────────────────────────────────

/**
 * Tipi transazione Spark — SEPARATI da btc_sent/btc_received esistenti.
 * Non modificare lo storico production finché l'integrazione non è approvata.
 */
export const SPARK_TX_TYPES = {
  // Esistenti (BTC on-chain) — NON MODIFICARE
  BTC_SENT: 'btc_sent' as const,
  BTC_RECEIVED: 'btc_received' as const,

  // Nuovi tipi Lightning/Spark
  LIGHTNING_SENT: 'btc_lightning_sent' as const,
  LIGHTNING_RECEIVED: 'btc_lightning_received' as const,
  SPARK_SENT: 'spark_sent' as const,
  SPARK_RECEIVED: 'spark_received' as const,
} as const;

// ─── API Key ──────────────────────────────────────────────────────────────────

/**
 * La API key NON è hardcoded qui.
 * Viene letta da variabile d'ambiente VITE_BREEZ_API_KEY.
 * Se non presente → adapter usa MockBreezAdapter automaticamente.
 *
 * Procedura per inserire la key:
 * 1. Aggiungere VITE_BREEZ_API_KEY come secret Replit nel PoC
 * 2. NON mai esporla nei log o nel frontend
 * 3. Verificare con validateApiKey() che non sia visibile
 */
export const SPARK_API_KEY_ENV = 'VITE_BREEZ_API_KEY' as const;

export function getSparkApiKey(): string | null {
  const key = import.meta.env[SPARK_API_KEY_ENV];
  if (!key || key.trim() === '') return null;
  return key.trim();
}

export function isApiKeyConfigured(): boolean {
  return getSparkApiKey() !== null;
}

// ─── Storage dir ─────────────────────────────────────────────────────────────

/** Storage dir per SDK (browser = prefisso IDB, Node.js = directory) */
export const SPARK_STORAGE_DIR = 'breez-spark-alpha-v1' as const;

// ─── Timeout ──────────────────────────────────────────────────────────────────

export const SPARK_TIMEOUTS = {
  CONNECT_MS: 45_000,
  SYNC_MS: 30_000,
  RECEIVE_INVOICE_EXPIRY_SEC: 3600,
  WEBHOOK_REGISTER_MS: 10_000,
} as const;
