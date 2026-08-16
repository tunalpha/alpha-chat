/**
 * spark-fee-wallet-executor.ts — Server-side Spark SDK connector
 *
 * Gestisce le operazioni Spark per il fee wallet lato server (sweep).
 *
 * SICUREZZA:
 * - Legge ALPHA_SPARK_FEE_MNEMONIC ESCLUSIVAMENTE da process.env
 * - Il mnemonic non viene mai loggato, mai incluso in errori, mai esposto
 * - Solo paymentId (pubblico) viene restituito come prova della transazione
 *
 * DESIGN:
 * - Connessione lazy per ogni sweep (connect → send → disconnect)
 * - No singleton persistente: ogni sweep è stateless rispetto alla sessione
 * - storageDir: /tmp/spark-fee-wallet-srv (persistente tra riavvii del processo)
 *
 * ISOLAMENTO:
 * - NON importa da payment engine, MultiChain, USDA, main wallet
 * - Usa esclusivamente il Node.js build del Breez Spark SDK
 */

import path from "path";
import { createRequire } from "module";
import { logger } from "../lib/logger.js";

// Supporta sia ESM (tsx, Node.js ESM) che CJS (esbuild bundle)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const _require: NodeRequire = typeof require !== "undefined"
  ? require
  : createRequire(import.meta.url);

// ─── Tipi di risposta ─────────────────────────────────────────────────────────

export interface SweepExecutionResult {
  paymentId:    string;
  feeSat:       number;
  netAmountSat: number;
}

export interface FeeWalletBalanceResult {
  balanceSat:       bigint;
  pendingReceiveSat: bigint;
}

export interface FeeWalletPaymentEntry {
  paymentId:  string;
  amountSat:  number;
  timestamp:  number;
  status:     string;
}

// ─── Costanti ─────────────────────────────────────────────────────────────────

const STORAGE_DIR  = process.env["SPARK_EXECUTOR_STORAGE_DIR"] ?? "/tmp/spark-fee-wallet-srv";
const SDK_TIMEOUT  = 60_000; // 60s timeout per connect + send

// ─── Utility: leggi mnemonic da env (MAI loggare) ────────────────────────────

function getMnemonicFromEnv(): string {
  const m = process.env["ALPHA_SPARK_FEE_MNEMONIC"];
  if (!m || m.trim().length === 0) {
    throw new Error("[SparkExecutor] ALPHA_SPARK_FEE_MNEMONIC non configurato");
  }
  // Validazione minima: 24 parole BIP39
  if (m.trim().split(/\s+/).length !== 24) {
    throw new Error("[SparkExecutor] ALPHA_SPARK_FEE_MNEMONIC formato invalido (attese 24 parole)");
  }
  return m.trim();
}

function getApiKey(): string {
  const k = process.env["VITE_BREEZ_API_KEY"] ?? process.env["BREEZ_API_KEY"];
  if (!k || k.trim().length === 0) {
    throw new Error("[SparkExecutor] BREEZ_API_KEY non configurato (VITE_BREEZ_API_KEY o BREEZ_API_KEY)");
  }
  return k.trim();
}

// ─── Caricamento SDK Node.js (lazy, con require CJS) ─────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function loadSparkSdk(): any {
  // Silenzia i warning informativi del SDK Node.js storage
  const origWarn = console.warn;
  console.warn = (msg: unknown, ...rest: unknown[]) => {
    const s = String(msg);
    if (s.includes("Breez SDK") || s.includes("Node.js storage")) return;
    origWarn(msg, ...rest);
  };
  try {
    const sdk = _require("@breeztech/breez-sdk-spark/nodejs");
    return sdk;
  } finally {
    console.warn = origWarn;
  }
}

// ─── Timeout helper ───────────────────────────────────────────────────────────

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`[SparkExecutor] Timeout dopo ${ms}ms: ${label}`)), ms);
    promise.then(v => { clearTimeout(timer); resolve(v); }, e => { clearTimeout(timer); reject(e); });
  });
}

// ─── Connessione SDK ──────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function connectFeeWalletSdk(): Promise<any> {
  const mnemonic = getMnemonicFromEnv(); // lancia se assente — MAI loggare
  const apiKey   = getApiKey();
  const sdk      = loadSparkSdk();

  const config    = sdk.defaultConfig("mainnet");
  config.apiKey   = apiKey;

  const storageDir = path.resolve(STORAGE_DIR);

  logger.info({ storageDir }, "[SparkExecutor] Connessione SDK fee wallet");

  // Usa connect() con Seed (non connectWithSigner + defaultExternalSigner):
  // defaultExternalSigner non implementa eciesEncrypt nel build Node.js WASM.
  const breezSdk = await withTimeout(
    sdk.connect({
      config,
      seed:       { type: "mnemonic", mnemonic, passphrase: "" },
      storageDir,
    }),
    SDK_TIMEOUT,
    "connect",
  );

  return breezSdk;
}

// ─── API pubblica ─────────────────────────────────────────────────────────────

/**
 * Deriva il Spark address del fee wallet dall'ALPHA_SPARK_FEE_MNEMONIC.
 *
 * SICUREZZA:
 * - Legge il mnemonic da env, MAI loggato o esposto
 * - Ritorna solo l'address pubblico (sp1...)
 * - Connette → getInfo() → disconnette (lazy, stateless)
 *
 * @throws se ALPHA_SPARK_FEE_MNEMONIC non è configurato o il SDK fallisce
 */
export async function getFeeWalletSparkAddress(): Promise<string> {
  let sdk: ReturnType<typeof connectFeeWalletSdk> extends Promise<infer T> ? T : never = null;
  try {
    sdk = await connectFeeWalletSdk();
    // La Spark address si ottiene via receivePayment (non getInfo).
    // receivePayment({ paymentMethod: { type: "sparkAddress" } }) → { sparkAddress: "sp1..." }
    const raw = await withTimeout(
      (sdk as { receivePayment: (r: unknown) => Promise<Record<string, unknown>> })
        .receivePayment({ paymentMethod: { type: "sparkAddress" } }),
      60_000,
      "receivePayment(sparkAddress)",
    ) as Record<string, unknown>;
    // Il SDK restituisce { paymentRequest: "sp1...", fee: bigint }
    // (il campo si chiama "paymentRequest" per tutti i tipi, incluso sparkAddress)
    const addr: unknown = raw?.sparkAddress ?? raw?.spark_address ?? raw?.paymentRequest;
    if (typeof addr !== "string" || addr.length < 10) {
      throw new Error(
        `[SparkExecutor] receivePayment non ha restituito indirizzo (keys: ${Object.keys(raw ?? {}).join(", ")})`,
      );
    }
    // Indirizzi Spark validi: sp1... (legacy), spark1... (mainnet), sprt1... (testnet)
    if (!addr.startsWith("sp1") && !addr.startsWith("spark1") && !addr.startsWith("sprt")) {
      throw new Error(
        `[SparkExecutor] sparkAddress formato non riconosciuto (ottenuto: ${addr.slice(0, 20)}…)`,
      );
    }
    return addr;
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "[SparkExecutor] getFeeWalletSparkAddress fallito");
    throw err;
  } finally {
    if (sdk) { try { await sdk.disconnect(); } catch { /* ignore */ } }
  }
}

/**
 * Deriva il Spark address da un mnemonic arbitrario (es. per il treasury).
 *
 * SICUREZZA:
 * - mnemonic passato in memoria, MAI loggato
 * - Usa storageDir separato (/tmp/spark-treasury-derive) — eliminato dopo l'uso
 * - Ritorna solo l'address pubblico (sp1...)
 *
 * @param mnemonic  BIP39 24 parole (plaintext, in memoria)
 * @throws se il mnemonic non è valido o il SDK fallisce
 */
export async function getSparkAddressFromMnemonic(mnemonic: string): Promise<string> {
  const words = mnemonic.trim().split(/\s+/);
  if (words.length !== 12 && words.length !== 24) {
    throw new Error("[SparkExecutor] mnemonic deve avere 12 o 24 parole");
  }

  const apiKey = getApiKey();
  const sdk    = loadSparkSdk();

  const config  = sdk.defaultConfig("mainnet");
  config.apiKey = apiKey;

  // Usa connect() con Seed (non connectWithSigner): defaultExternalSigner
  // non implementa eciesEncrypt nel build Node.js WASM.
  const storageDir = path.resolve("/tmp/spark-treasury-derive-tmp");

  let derivedSdk: unknown = null;
  try {
    derivedSdk = await withTimeout(
      sdk.connect({
        config,
        seed:       { type: "mnemonic", mnemonic: mnemonic.trim(), passphrase: "" },
        storageDir,
      }),
      SDK_TIMEOUT,
      "connect(treasury)",
    );

    const raw2 = await withTimeout(
      (derivedSdk as { receivePayment: (r: unknown) => Promise<Record<string, unknown>> })
        .receivePayment({ paymentMethod: { type: "sparkAddress" } }),
      60_000,
      "receivePayment(sparkAddress,treasury)",
    ) as Record<string, unknown>;

    const addr: unknown = raw2?.sparkAddress ?? raw2?.spark_address ?? raw2?.paymentRequest;
    if (typeof addr !== "string" || addr.length < 10) {
      throw new Error(
        `[SparkExecutor] treasury receivePayment non ha restituito indirizzo (keys: ${Object.keys(raw2 ?? {}).join(", ")})`,
      );
    }
    if (!addr.startsWith("sp1") && !addr.startsWith("spark1") && !addr.startsWith("sprt")) {
      throw new Error(
        `[SparkExecutor] treasury sparkAddress formato non riconosciuto (ottenuto: ${addr.slice(0, 20)}…)`,
      );
    }
    return addr;
  } finally {
    if (derivedSdk) {
      try {
        await (derivedSdk as { disconnect: () => Promise<void> }).disconnect();
      } catch { /* ignore */ }
    }
  }
}

/**
 * Ottieni il saldo live dal SDK.
 * Connette, legge, disconnette.
 * Ritorna null se SDK non raggiungibile.
 */
export async function getFeeWalletLiveBalance(): Promise<FeeWalletBalanceResult | null> {
  let sdk: ReturnType<typeof connectFeeWalletSdk> extends Promise<infer T> ? T : never = null;
  try {
    sdk = await connectFeeWalletSdk();
    const info = await withTimeout(sdk.getInfo({}), 30_000, "getInfo");
    const bal  = info?.walletInfo ?? info;
    return {
      balanceSat:        BigInt(bal?.balanceSat ?? bal?.balance_sat ?? 0),
      pendingReceiveSat: BigInt(bal?.pendingReceiveSat ?? bal?.pending_receive_sat ?? 0),
    };
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "[SparkExecutor] getBalance fallito");
    return null;
  } finally {
    if (sdk) { try { await sdk.disconnect(); } catch { /* ignore */ } }
  }
}

/**
 * Esegue uno sweep dal fee wallet verso il treasury Spark address.
 *
 * SICUREZZA:
 * - mnemonic letto da env, mai esposto
 * - Solo paymentId (pubblico) viene restituito
 *
 * Lancia in caso di errore (il chiamante gestisce il recovery).
 */
export async function sweepFeeWalletTo(
  treasuryAddress: string,
  amountSat:       bigint,
): Promise<SweepExecutionResult> {
  if (!treasuryAddress || !treasuryAddress.startsWith("sp")) {
    throw new Error(`[SparkExecutor] Treasury address non valido: ${treasuryAddress.slice(0, 10)}…`);
  }
  if (amountSat <= 0n) {
    throw new Error("[SparkExecutor] amountSat deve essere > 0");
  }

  let sdk: ReturnType<typeof connectFeeWalletSdk> extends Promise<infer T> ? T : never = null;

  try {
    sdk = await connectFeeWalletSdk();

    // Prepara il pagamento (ottiene fee stimata)
    const prepResp = await withTimeout(
      sdk.prepareSendPayment({ paymentRequest: treasuryAddress, amountSat }),
      30_000,
      "prepareSendPayment",
    );

    logger.info(
      { treasuryAddress: `${treasuryAddress.slice(0, 12)}…`, amountSat: amountSat.toString() },
      "[SparkExecutor] prepareSendPayment OK — avvio sendPayment",
    );

    // Esegui il pagamento
    const sendResp = await withTimeout(
      sdk.sendPayment({ prepareResponse: prepResp }),
      SDK_TIMEOUT,
      "sendPayment",
    );

    const payment     = sendResp?.payment ?? sendResp;
    const paymentId   = String(payment?.paymentId ?? payment?.payment_id ?? "");
    const feeSat      = Number(payment?.feeSat ?? payment?.fee_sat ?? 0);
    const netAmountSat = Number(amountSat) - feeSat;

    if (!paymentId) throw new Error("[SparkExecutor] sendPayment non ha restituito paymentId");

    logger.info(
      { paymentId, feeSat, netAmountSat },
      "[SparkExecutor] Sweep completato con successo",
    );

    return { paymentId, feeSat, netAmountSat };

  } finally {
    if (sdk) { try { await sdk.disconnect(); } catch { /* ignore */ } }
  }
}

/**
 * Lista i pagamenti recenti del fee wallet (per reconciliazione).
 * Connette, lista, disconnette.
 * Ritorna array vuoto se SDK non raggiungibile.
 */
export async function listFeeWalletRecentPayments(limit = 20): Promise<FeeWalletPaymentEntry[]> {
  let sdk: ReturnType<typeof connectFeeWalletSdk> extends Promise<infer T> ? T : never = null;
  try {
    sdk = await connectFeeWalletSdk();
    const resp = await withTimeout(
      sdk.listPayments({ limit }),
      30_000,
      "listPayments",
    );
    const payments = resp?.payments ?? resp ?? [];
    return (payments as Record<string, unknown>[]).map(p => ({
      paymentId: String(p.paymentId ?? p.payment_id ?? ""),
      amountSat: Number(p.amountSat ?? p.amount_sat ?? 0),
      timestamp: Number(p.timestamp ?? p.createdAt ?? 0),
      status:    String(p.status ?? "unknown"),
    }));
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "[SparkExecutor] listPayments fallito");
    return [];
  } finally {
    if (sdk) { try { await sdk.disconnect(); } catch { /* ignore */ } }
  }
}
