/**
 * spark-send-guard — timeout + riconciliazione per l'invio Lightning.
 *
 * PROBLEMA (incidente 2026-08-15): sdk.sendPayment (WASM Breez/Spark) non ha
 * timeout. Se iOS Safari congela la rete (app in background, 4G instabile),
 * la Promise resta pending per sempre → spinner "Firma e broadcast in corso…"
 * infinito, nessun errore, nessun log server (il pagamento è tutto client-side).
 *
 * SOLUZIONE (stesso principio del fix walletRequest 30s, ma SENZA rischio di
 * doppio pagamento): dopo il timeout NON dichiariamo fallito il pagamento —
 * potrebbe essere partito comunque.
 *
 * GARANZIA SINGLE-OWNER: il guard produce UN SOLO esito terminale:
 * - `sent` (il send primario ha risposto — anche in ritardo, durante il polling);
 * - `reconciled` (l'invoice risulta completata nello storico SDK);
 * - errore SDK del send primario (anche se arriva durante il polling:
 *   un errore SDK = pagamento NON partito → retry sicuro);
 * - SparkSendUncertainError. SOLO in questo caso viene armata la continuation
 *   one-shot `onLateResolve` sulla Promise originale — quindi non può mai
 *   esserci doppia persistenza (o esito del guard, o continuation, mai entrambi).
 *
 * LOCK PERSISTENTE: l'esito incerto viene marcato in localStorage
 * (setUncertainMarker) — sopravvive a unmount/riapertura della pagina Send.
 * Il chiamante DEVE verificare il marker con resolveUncertainMarker() prima
 * di consentire un nuovo invio.
 */

import type { SparkPayment, SparkListPaymentsRequest, SparkSendResult } from "./spark-types";

/** Errore "esito incerto": il pagamento POTREBBE essere partito. NON riprovare. */
export class SparkSendUncertainError extends Error {
  readonly code = "SPARK_SEND_UNCERTAIN";
  constructor() {
    super(
      "La rete non risponde e l'esito del pagamento è incerto. " +
      "NON ripetere l'invio: controlla lo Storico tra qualche minuto — " +
      "il blocco si sbloccherà da solo appena l'esito sarà verificato.",
    );
    this.name = "SparkSendUncertainError";
  }
}

/** True se la stringa è un'invoice BOLT11 (mainnet/testnet/regtest). */
export function isBolt11Invoice(s: string): boolean {
  return /^ln(bc|tb|bcrt)[0-9]/i.test(s.trim());
}

interface GuardDeps {
  /** Esegue l'invio reale (spark.send già parametrizzato). */
  send: () => Promise<SparkSendResult>;
  /** Legge lo storico SDK (spark.listPayments). */
  listPayments: (req: SparkListPaymentsRequest) => Promise<SparkPayment[]>;
  /**
   * Payment request che stiamo pagando. La riconciliazione per invoice è
   * possibile SOLO se è una BOLT11 (identità stabile e verificabile).
   */
  invoice: string;
  /**
   * Continuation one-shot: armata SOLO dopo SparkSendUncertainError.
   * Chiamata se il send originale completa con successo più tardi.
   */
  onLateResolve?: (result: SparkSendResult) => void;
  /** Timeout sull'invio primario (default 60s). */
  sendTimeoutMs?: number;
  /** Tentativi di riconciliazione post-timeout (default 6 × 5s = 30s). */
  reconcileAttempts?: number;
  reconcileIntervalMs?: number;
  /** Timeout per singola chiamata listPayments (default 10s). */
  listTimeoutMs?: number;
  /** Finestra storico per la riconciliazione (default 200, come history). */
  reconcileWindow?: number;
}

export type GuardedSendOutcome =
  | { outcome: "sent"; result: SparkSendResult }
  | { outcome: "reconciled"; payment: SparkPayment };

const SENT_TYPES = new Set(["btc_lightning_sent", "spark_sent"]);

function matchesInvoice(p: SparkPayment, invoice: string): boolean {
  return (
    SENT_TYPES.has(p.paymentType) &&
    !!p.bolt11 &&
    p.bolt11.toLowerCase() === invoice.trim().toLowerCase()
  );
}

// ── Primitive interne ─────────────────────────────────────────────────────────

type PrimaryTag =
  | { kind: "ok"; result: SparkSendResult }
  | { kind: "err"; error: unknown };

/** Race di `p` contro un timer: "TIMEOUT" se scade prima. */
function raceTimeout<T>(p: Promise<T>, ms: number): Promise<T | "TIMEOUT"> {
  return Promise.race([
    p,
    new Promise<"TIMEOUT">((r) => setTimeout(() => r("TIMEOUT"), ms)),
  ]);
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ── Lock persistente (localStorage) ───────────────────────────────────────────

const LS_UNCERTAIN_KEY = "aw_ln_uncertain_v1";
/** Marker non-BOLT11 o non verificabile: auto-scadenza (l'esito LN si assesta in minuti). */
const UNCERTAIN_MAX_AGE_MS = 15 * 60_000;

export interface UncertainMarker { invoice: string; ts: number; }

export function setUncertainMarker(invoice: string): void {
  try {
    localStorage.setItem(LS_UNCERTAIN_KEY, JSON.stringify({ invoice, ts: Date.now() }));
  } catch { /* storage pieno/privato — degrada al lock in-memory */ }
}

export function getUncertainMarker(): UncertainMarker | null {
  try {
    const raw = localStorage.getItem(LS_UNCERTAIN_KEY);
    if (!raw) return null;
    const m = JSON.parse(raw) as UncertainMarker;
    return typeof m?.invoice === "string" && typeof m?.ts === "number" ? m : null;
  } catch { return null; }
}

export function clearUncertainMarker(): void {
  try { localStorage.removeItem(LS_UNCERTAIN_KEY); } catch { /* noop */ }
}

export type UncertainResolution =
  /** Nessun marker, o verificato che il pagamento NON è partito → invio consentito. */
  | { status: "clear" }
  /** Il pagamento risulta COMPLETATO nello storico → non ripagare. */
  | { status: "confirmed_paid"; payment: SparkPayment }
  /** Esito ancora non verificabile → invio BLOCCATO. */
  | { status: "still_uncertain" };

/**
 * Verifica del marker "incerto" prima di un nuovo invio.
 * - BOLT11: interroga lo storico SDK (finestra 200):
 *   - invoice completata → confirmed_paid (marker rimosso: esito noto);
 *   - invoice pending / lettura fallita o congelata → still_uncertain;
 *   - invoice ASSENTE da una lettura riuscita → NON è prova di non-pagamento
 *     (sync SDK in ritardo, send ancora in volo): still_uncertain finché il
 *     marker è fresco; sblocco solo oltre UNCERTAIN_MAX_AGE_MS (risk policy
 *     esplicita, documentata inline).
 * - Non-BOLT11 (richiesta dinamica, non verificabile): still_uncertain per
 *   sempre — si sblocca solo tramite l'esito del send originale.
 */
export async function resolveUncertainMarker(
  listPayments: (req: SparkListPaymentsRequest) => Promise<SparkPayment[]>,
  opts?: { listTimeoutMs?: number; reconcileWindow?: number },
): Promise<UncertainResolution> {
  const marker = getUncertainMarker();
  if (!marker) return { status: "clear" };

  if (!isBolt11Invoice(marker.invoice)) {
    // Richiesta dinamica (LNURL/Lightning Address/BOLT12): NON verificabile
    // per invoice e un retry può risolvere una NUOVA invoice → doppio
    // pagamento. Il lock NON scade mai col solo passare del tempo: si
    // sblocca solo tramite onLateResolve (esito del send originale).
    // NOTA: la UI impone BOLT11-only al boundary, quindi questo marker
    // non dovrebbe mai esistere — difesa in profondità.
    return { status: "still_uncertain" };
  }

  try {
    const payments = await raceTimeout(
      listPayments({ limit: opts?.reconcileWindow ?? 200 }),
      opts?.listTimeoutMs ?? 10_000,
    );
    if (payments === "TIMEOUT") return { status: "still_uncertain" };
    const match = payments.find((p) => matchesInvoice(p, marker.invoice));
    if (!match) {
      // L'ASSENZA dallo storico NON è prova di non-pagamento: la sync SDK può
      // essere in ritardo e il send originale può essere ancora in volo.
      // RISK POLICY esplicita: sblocco solo se il marker ha superato la
      // finestra massima (15 min — Lightning si assesta in secondi/minuti)
      // E la lettura dello storico è riuscita senza traccia dell'invoice.
      // Difesa aggiuntiva: il retry riguarda la STESSA BOLT11 — se il
      // pagamento originale fosse comunque andato a buon fine, la rete
      // rifiuta il secondo pagamento di un'invoice già saldata.
      if (Date.now() - marker.ts > UNCERTAIN_MAX_AGE_MS) {
        clearUncertainMarker();
        return { status: "clear" };
      }
      return { status: "still_uncertain" };
    }
    if (match.status === "completed") {
      clearUncertainMarker();
      return { status: "confirmed_paid", payment: match };
    }
    return { status: "still_uncertain" }; // pending
  } catch {
    return { status: "still_uncertain" };
  }
}

// ── Guard principale ──────────────────────────────────────────────────────────

/**
 * Invio Lightning con timeout, riconciliazione e continuation single-owner.
 * Vedi header del file per il contratto completo.
 */
export async function sendLightningGuarded(deps: GuardDeps): Promise<GuardedSendOutcome> {
  const {
    send,
    listPayments,
    invoice,
    onLateResolve,
    sendTimeoutMs       = 60_000,
    reconcileAttempts   = 6,
    reconcileIntervalMs = 5_000,
    listTimeoutMs       = 10_000,
    reconcileWindow     = 200,
  } = deps;

  const primaryPromise = send();
  primaryPromise.catch(() => {}); // mai unhandled rejection
  // Tag della Promise primaria: usata nelle race del polling.
  const primaryTagged: Promise<PrimaryTag> = primaryPromise.then(
    (result) => ({ kind: "ok", result }),
    (error)  => ({ kind: "err", error }),
  );

  const first = await raceTimeout(primaryTagged, sendTimeoutMs);
  if (first !== "TIMEOUT") {
    if (first.kind === "ok") return { outcome: "sent", result: first.result };
    throw first.error; // errore SDK entro il timeout → retry sicuro
  }

  const reconcilable = isBolt11Invoice(invoice);

  if (reconcilable) {
    for (let i = 0; i < reconcileAttempts; i++) {
      // Il send primario resta in gara anche durante il polling: se risponde
      // qui, è LUI l'esito (single-owner) — mai contemporaneamente al reconciled.
      const tick = await Promise.race([
        sleep(reconcileIntervalMs).then(() => "TICK" as const),
        primaryTagged,
      ]);
      if (tick !== "TICK") {
        if (tick.kind === "ok") return { outcome: "sent", result: tick.result };
        throw tick.error; // errore SDK tardivo = pagamento NON partito → retry sicuro
      }
      // primaryTagged non rigetta mai (tag esplicito), quindi il try/catch
      // qui intercetta SOLO errori transitori di listPayments.
      let raced: SparkPayment[] | "TIMEOUT" | PrimaryTag;
      try {
        raced = await Promise.race([
          raceTimeout(listPayments({ limit: reconcileWindow }), listTimeoutMs),
          primaryTagged,
        ]);
      } catch {
        continue; // errore lettura storico — non è un esito, riprova
      }
      if (raced !== "TIMEOUT" && !Array.isArray(raced)) {
        // Il send primario ha risposto durante la lettura storico.
        if (raced.kind === "ok") return { outcome: "sent", result: raced.result };
        throw raced.error; // errore SDK = pagamento NON partito → retry sicuro
      }
      if (raced === "TIMEOUT") continue; // SDK congelato — riprova
      const match = raced.find((p) => matchesInvoice(p, invoice));
      if (match && match.status === "completed") {
        return { outcome: "reconciled", payment: match };
      }
      // pending o assente → continua il polling
    }
  }

  // Esito incerto DEFINITIVO: marca il lock persistente e SOLO ORA arma la
  // continuation one-shot (nessun altro esito può più essere prodotto qui).
  setUncertainMarker(invoice);
  if (onLateResolve) {
    primaryPromise.then((r) => {
      clearUncertainMarker();
      onLateResolve(r);
    }).catch(() => {
      // Errore tardivo del send = pagamento NON partito → sblocca il lock.
      clearUncertainMarker();
    });
  }
  throw new SparkSendUncertainError();
}
