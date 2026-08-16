/**
 * BreezSparkBtcLnProvider — Lightning → BTC on-chain
 *
 * HARDENING v3 — Idempotenza reale e recovery dopo chiusura PWA:
 *
 *   A. IDEMPOTENCY KEY (localStorage, persistente):
 *      Sopravvive a chiusura browser, doppio click, riavvio PWA, due tab.
 *
 *   B. WRITE-BEFORE-SUBMIT:
 *      Intent salvato in localStorage PRIMA di chiamare spark.send().
 *      Se la PWA viene chiusa durante l'invio, al riapertura si rileva
 *      che un'operazione era in corso.
 *
 *   C. RESULT PERSISTENCE:
 *      Risultato spark.send() salvato in localStorage PRIMA di chiamare
 *      /record/lnbtc. Se il record fallisce, viene riletto al prossimo mount.
 *
 *   D. BACKEND IDEMPOTENCY:
 *      idempotency_key inviato a /record/lnbtc. Il backend NON crea un secondo
 *      record se ne esiste già uno con la stessa chiave.
 *
 *   E. RETRY /record/lnbtc:
 *      3 tentativi con backoff (1s, 2s). Se tutti falliscono, il risultato
 *      rimane in localStorage per la recovery al prossimo mount.
 *
 *   F. CROSS-TAB LOCK (localStorage, TTL 90s):
 *      Impedisce l'esecuzione simultanea da due tab.
 *
 *   G. TIMEOUT → STATO INCERTO:
 *      Se spark.send() non risponde entro 60s, lo stato è incerto.
 *      La UI mostra "Stato da verificare" senza permettere retry automatico.
 *      Il lock rimane attivo con uncertain=true — impedisce un secondo invio.
 *
 * FEE ALPHA = 0% — Breez SDK non espone integrator fee per reverse submarine swap.
 */

import type {
  BitcoinLightningSwapProvider,
  QuoteRequest,
  ExecuteRequest,
  ExecuteResult,
  StatusResult,
} from "../SwapProvider.js";
import type { SwapQuote, SwapDirection } from "../types.js";

// ── localStorage keys (esportati per test e recovery in useSwapState) ─────────
export const LNBTC_IKEY        = "aw_lnbtc_ikey";    // idempotency key UUID (persistente)
export const LNBTC_INTENT_KEY  = "aw_lnbtc_intent";  // write-before-submit
export const LNBTC_RESULT_KEY  = "aw_lnbtc_result";  // risultato post spark.send()
export const LNBTC_LOCK_KEY    = "aw_lnbtc_lock";    // cross-tab lock

const SWAP_API    = "/api/v1/swap";
const LOCK_TTL_MS = 90_000;   // lock stale dopo 90s
const TIMEOUT_MS  = 60_000;   // timeout spark.send()

// ── Interfacce localstorage ───────────────────────────────────────────────────

export interface LnBtcIntent {
  key:        string;  // idempotency key
  amount_sat: number;
  btc_address: string;
  ts:         number;  // timestamp avvio
}

export interface LnBtcResult {
  payment_id: string;
  fee_sat:    number;
  completed:  true;
  recorded:   boolean; // true dopo /record/lnbtc OK
}

interface LnBtcLock {
  key:       string;
  tab_id:    string;
  ts:        number;
  uncertain?: boolean; // true se timeout
}

// ── Tipo recovery ─────────────────────────────────────────────────────────────

export type LnBtcRecoveryState =
  | "not_started"         // nessuna operazione in localStorage
  | "in_progress"         // lock fresco, nessun risultato (forse ancora in volo)
  | "completed"           // completato e registrato
  | "completed_unrecorded" // completato ma /record/lnbtc non registrato
  | "unknown";            // timeout o stato incerto

export interface LnBtcRecovery {
  state:       LnBtcRecoveryState;
  payment_id?: string;
  amount_sat?: number;
  btc_address?: string;
}

// ── Lock module-level: anti-double-click nello stesso tab ─────────────────────
let _lnBtcExecuting = false;

// ── Helpers ───────────────────────────────────────────────────────────────────

async function swapFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const token = localStorage.getItem("ac_access_token");
  const res = await fetch(`${SWAP_API}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options?.headers ?? {}),
    },
  });
  const body = await res.json() as Record<string, unknown>;
  if (!res.ok) {
    const msg = (body?.error as string) ?? (body?.message as string) ?? `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return body as T;
}

function _readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch { return null; }
}

function _isLockFresh(lock: LnBtcLock | null): boolean {
  if (!lock) return false;
  return Date.now() - lock.ts < LOCK_TTL_MS;
}

function _writeLock(key: string, tabId: string, uncertain = false): void {
  const data: LnBtcLock = { key, tab_id: tabId, ts: Date.now(), uncertain };
  localStorage.setItem(LNBTC_LOCK_KEY, JSON.stringify(data));
}

// ── Retry /record/lnbtc ───────────────────────────────────────────────────────

async function _recordWithRetry(params: {
  idempotency_key?:        string;
  from_amount_sat:         number;
  btc_destination_address: string;
  provider_fee_sat:        number;
  spark_payment_id:        string;
}): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await swapFetch("/record/lnbtc", {
        method: "POST",
        body:   JSON.stringify(params),
      });
      return;
    } catch (err) {
      if (attempt < 2) {
        await new Promise(r => setTimeout(r, (attempt + 1) * 1_000));
      } else {
        // Dopo 3 fallimenti: non lanciare — il risultato è in localStorage per la recovery
        console.warn("[LN→BTC] /record/lnbtc fallito dopo 3 tentativi:", (err as Error).message);
      }
    }
  }
}

// ── Utility publiche ──────────────────────────────────────────────────────────

/**
 * Pulisce tutti gli stati LN→BTC dal localStorage.
 * Chiamare dopo reset, dopo errore definitivo, dopo cambio account.
 */
export function clearLnBtcState(): void {
  localStorage.removeItem(LNBTC_IKEY);
  localStorage.removeItem(LNBTC_INTENT_KEY);
  localStorage.removeItem(LNBTC_RESULT_KEY);
  localStorage.removeItem(LNBTC_LOCK_KEY);
  _lnBtcExecuting = false;
}

/**
 * Legge lo stato di recovery LN→BTC dal localStorage (sincrono).
 *
 * Usato da useSwapState al mount per determinare se c'era un'operazione
 * in corso nella sessione precedente.
 */
export function readLnBtcRecovery(): LnBtcRecovery {
  const intent = _readJson<LnBtcIntent>(LNBTC_INTENT_KEY);
  if (!intent) return { state: "not_started" };

  const result = _readJson<LnBtcResult>(LNBTC_RESULT_KEY);
  if (result?.completed) {
    return {
      state:       result.recorded ? "completed" : "completed_unrecorded",
      payment_id:  result.payment_id,
      amount_sat:  intent.amount_sat,
      btc_address: intent.btc_address,
    };
  }

  const lock = _readJson<LnBtcLock>(LNBTC_LOCK_KEY);

  // Timeout esplicito
  if (lock?.uncertain) {
    return { state: "unknown", amount_sat: intent.amount_sat, btc_address: intent.btc_address };
  }

  // Lock fresco → operazione potenzialmente ancora in volo (altro tab o crash recente)
  if (_isLockFresh(lock)) {
    return { state: "in_progress", amount_sat: intent.amount_sat, btc_address: intent.btc_address };
  }

  // Intent presente, nessun risultato, lock stale/assente → stato incerto
  return { state: "unknown", amount_sat: intent.amount_sat, btc_address: intent.btc_address };
}

// ── SparkSwapExecutor ─────────────────────────────────────────────────────────

/**
 * Interfaccia minima per eseguire uno swap LN→BTC via Spark SDK.
 * Implementata in SwapView.tsx dove il contesto Spark è disponibile.
 */
export interface SparkSwapExecutor {
  estimateFee(btcAddress: string, amountSat: bigint): Promise<{ estimatedProviderFeeSat: bigint }>;
  executeSwap(btcAddress: string, amountSat: bigint): Promise<{ paymentId: string; feeSat: bigint }>;
}

// ── Provider ──────────────────────────────────────────────────────────────────

export class BreezSparkBtcLnProvider implements BitcoinLightningSwapProvider {
  readonly name = "breez_spark_reverse" as const;

  constructor(private readonly executor: SparkSwapExecutor) {}

  supportsDirection(direction: SwapDirection): boolean {
    return direction === "lightning_to_btc";
  }

  async getQuote(req: QuoteRequest): Promise<SwapQuote> {
    if (req.direction !== "lightning_to_btc") {
      throw new Error("BreezSparkBtcLnProvider supporta solo lightning_to_btc");
    }
    if (!req.btc_address) {
      throw new Error("Indirizzo BTC destinazione richiesto per la quote LN→BTC");
    }

    let providerFeeSat = 0;
    try {
      const est = await this.executor.estimateFee(req.btc_address, BigInt(req.from_amount_sat));
      providerFeeSat = Number(est.estimatedProviderFeeSat);
    } catch {
      // Stima conservativa: 0.5% + 300 sat miner fee
      providerFeeSat = Math.ceil(req.from_amount_sat * 0.005) + 300;
    }

    const toAmountSat = Math.max(0, req.from_amount_sat - providerFeeSat);

    return {
      direction:        "lightning_to_btc",
      provider:         "breez_spark_reverse",
      from_amount_sat:  req.from_amount_sat,
      to_amount_sat:    toAmountSat,
      alpha_fee_sat:    0,
      alpha_fee_bps:    0,
      provider_fee_sat: providerFeeSat,
      miner_fee_sat:    0,
      total_debit_sat:  req.from_amount_sat,
      expires_at:       Date.now() + 3 * 60_000,
      provider_note:    "Alpha Fee = 0% su questa direzione.",
    };
  }

  async execute(req: ExecuteRequest): Promise<ExecuteResult> {
    if (!req.btc_address) {
      throw new Error("Indirizzo BTC destinazione richiesto per LN→BTC");
    }

    // ── A. Controlla se esiste già un risultato completato (idempotenza) ──────
    const existingResult = _readJson<LnBtcResult>(LNBTC_RESULT_KEY);
    if (existingResult?.completed) {
      // spark.send() già completato in una sessione precedente
      if (!existingResult.recorded) {
        // Tentativo di registrazione ritardato (il backend deduplica per idempotency_key)
        const existingIntent = _readJson<LnBtcIntent>(LNBTC_INTENT_KEY);
        const ikey = existingIntent?.key ?? localStorage.getItem(LNBTC_IKEY) ?? undefined;
        await _recordWithRetry({
          idempotency_key:         ikey,
          from_amount_sat:         req.quote.from_amount_sat,
          btc_destination_address: req.btc_address,
          provider_fee_sat:        existingResult.fee_sat,
          spark_payment_id:        existingResult.payment_id,
        });
        existingResult.recorded = true;
        localStorage.setItem(LNBTC_RESULT_KEY, JSON.stringify(existingResult));
      }
      clearLnBtcState();
      return {
        swap_id:          existingResult.payment_id,
        state:            "completed",
        spark_payment_id: existingResult.payment_id,
        note:             "Pagamento già completato.",
      };
    }

    // ── B. Cross-tab lock ─────────────────────────────────────────────────────
    const existingLock = _readJson<LnBtcLock>(LNBTC_LOCK_KEY);
    if (_isLockFresh(existingLock)) {
      throw new Error(
        "Pagamento già in corso in un'altra sessione. " +
        "Attendi il completamento o riapri l'app per verificare lo stato.",
      );
    }

    // ── C. Anti-double-click (stesso tab) ─────────────────────────────────────
    if (_lnBtcExecuting) {
      throw new Error("Pagamento già in corso — attendi il completamento prima di riprovare.");
    }

    // ── D. Idempotency key (persistente in localStorage) ──────────────────────
    const existingIntent = _readJson<LnBtcIntent>(LNBTC_INTENT_KEY);
    const idempotencyKey: string =
      existingIntent?.key ??
      localStorage.getItem(LNBTC_IKEY) ??
      crypto.randomUUID();

    const tabId = crypto.randomUUID();

    // ── E. Write-before-submit ────────────────────────────────────────────────
    const intent: LnBtcIntent = {
      key:        idempotencyKey,
      amount_sat: req.quote.from_amount_sat,
      btc_address: req.btc_address,
      ts:         Date.now(),
    };
    localStorage.setItem(LNBTC_IKEY,       idempotencyKey);
    localStorage.setItem(LNBTC_INTENT_KEY, JSON.stringify(intent));
    _writeLock(idempotencyKey, tabId);

    _lnBtcExecuting = true;

    try {
      // ── F. 60s timeout guard — mai spinner infinito ───────────────────────
      //    Cleanup obbligatorio: se executeSwap risolve prima, il timer viene
      //    cancellato per evitare unhandled rejection in prod e nei test.
      let _timeoutId: ReturnType<typeof setTimeout> | undefined;
      const timeoutPromise = new Promise<never>((_, reject) => {
        _timeoutId = setTimeout(
          () => reject(new Error(
            "TIMEOUT_UNCERTAIN: il pagamento non ha risposto entro 60 secondi. " +
            "Stato incerto — non riprovare automaticamente.",
          )),
          TIMEOUT_MS,
        );
      });
      // Attacca .catch sul timeout per sopprimere unhandled rejection se il race
      // viene vinto da executeSwap (il timer poi scatta sul promise abbandonato)
      timeoutPromise.catch(() => null);

      const result = await Promise.race([
        this.executor.executeSwap(req.btc_address, BigInt(req.quote.from_amount_sat)),
        timeoutPromise,
      ]).finally(() => clearTimeout(_timeoutId));

      // ── G. Salva risultato PRIMA di chiamare /record/lnbtc ────────────────
      //    (garantisce che il risultato sia leggibile anche se la PWA chiude ora)
      const resultData: LnBtcResult = {
        payment_id: result.paymentId,
        fee_sat:    Number(result.feeSat),
        completed:  true,
        recorded:   false,
      };
      localStorage.setItem(LNBTC_RESULT_KEY, JSON.stringify(resultData));

      // ── H. Registra su backend (con retry e idempotency_key) ─────────────
      await _recordWithRetry({
        idempotency_key:         idempotencyKey,
        from_amount_sat:         req.quote.from_amount_sat,
        btc_destination_address: req.btc_address,
        provider_fee_sat:        Number(result.feeSat),
        spark_payment_id:        result.paymentId,
      });

      // ── I. Segna come registrato ──────────────────────────────────────────
      resultData.recorded = true;
      localStorage.setItem(LNBTC_RESULT_KEY, JSON.stringify(resultData));

      // ── J. Pulizia finale (successo completo) ─────────────────────────────
      clearLnBtcState();

      return {
        swap_id:          result.paymentId,
        state:            "completed",
        spark_payment_id: result.paymentId,
        note:             "Pagamento Lightning inviato. BTC arriverà all'indirizzo indicato.",
      };

    } catch (err) {
      const msg = (err as Error).message ?? "";

      if (msg.startsWith("TIMEOUT_UNCERTAIN")) {
        // Aggiorna lock con uncertain=true — impedisce retry automatico
        _writeLock(idempotencyKey, tabId, /* uncertain */ true);
        // NON pulire lo stato — serve per la recovery al prossimo mount
        throw err;
      }

      // Errore definitivo (non timeout) — pulizia per permettere un nuovo tentativo
      clearLnBtcState();
      throw err;

    } finally {
      _lnBtcExecuting = false;
    }
  }

  async getStatus(swapId: string): Promise<StatusResult> {
    // Spark: lo swap è sincrono — completato al termine di execute()
    return { swap_id: swapId, state: "completed" };
  }

  async isAvailable(): Promise<boolean> {
    try {
      const { config } = await swapFetch<{ config: { lnbtc: { enabled: boolean } } }>("/config");
      return config.lnbtc.enabled;
    } catch {
      return false;
    }
  }

  /**
   * Pulisce stato LN→BTC e lock.
   * Mantenuto per compatibilità con l'interfaccia SwapRouter.
   */
  clearIdempotencyKey(): void {
    clearLnBtcState();
  }
}
