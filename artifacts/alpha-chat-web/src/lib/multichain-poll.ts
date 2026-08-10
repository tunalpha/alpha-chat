/**
 * multichain-poll.ts
 *
 * Logica di polling BTC estratta dal componente per poterla testare in isolamento.
 *
 * CLASSIFICAZIONE ERRORI:
 *   DEPOSIT_TX_NOT_DETECTED  → transitorio  (riprova)
 *   Network error nativo     → transitorio  (riprova) — iOS "Load failed", Chrome "Failed to fetch"
 *   Qualsiasi altro errore   → fatale       (rilancia) — ADAPTER_NOT_FOUND, FEATURE_DISABLED, ecc.
 */

/**
 * Identifica errori di rete nativi del browser (fetch rejection a livello TCP/TLS/DNS).
 *
 * Restituisce true SOLO per `TypeError` con messaggi noti:
 *  - iOS Safari / WebKit PWA : "Load failed"
 *  - Chrome / Edge           : "Failed to fetch"
 *  - Firefox                 : "NetworkError when attempting to fetch resource."
 *
 * NON classifica come network error gli errori applicativi (Error con .code,
 * eccezioni custom, ecc.) anche quando privi di codice, evitando falsi positivi.
 */
export function isNetworkError(err: unknown): boolean {
  if (!(err instanceof TypeError)) return false;
  const msg = (err as TypeError).message ?? "";
  return (
    msg === "Load failed" ||         // iOS Safari / WebKit PWA
    msg === "Failed to fetch" ||     // Chrome / Edge
    msg.startsWith("NetworkError")   // Firefox
  );
}

/**
 * Loop di polling puro — da usare nei test e riutilizzabile in futuro.
 *
 * Chiama `detect(transferId)` ogni `intervalMs` finché:
 *  - il deposito è confermato (status ≠ "awaiting_deposit")  → risolve;
 *  - abort.aborted === true                                   → risolve silenziosamente;
 *  - errore applicativo non transiente                        → rigetta;
 *  - timeout (maxMs)                                          → rigetta con messaggio di timeout.
 *
 * @param transferId   ID del transfer da monitorare.
 * @param detect       Funzione che chiama l'endpoint /detect e restituisce il transfer.
 * @param abort        Ref condiviso: se aborted=true il loop si ferma silenziosamente.
 * @param opts         Override degli intervalli (usato nei test per velocizzare).
 */
export async function runPollDetect(
  transferId: string,
  detect: (id: string) => Promise<{ status: string }>,
  abort?: { aborted: boolean },
  opts?: { intervalMs?: number; maxMs?: number; firstDelayMs?: number },
): Promise<void> {
  const POLL_INTERVAL_MS = opts?.intervalMs    ?? 10_000;
  const POLL_MAX_MS      = opts?.maxMs         ?? 10 * 60 * 1000;
  const FIRST_DELAY_MS   = opts?.firstDelayMs  ?? 2_000;
  const pollStart        = Date.now();
  let   first            = true;

  while (Date.now() - pollStart < POLL_MAX_MS) {
    await new Promise<void>(r => setTimeout(r, first ? FIRST_DELAY_MS : POLL_INTERVAL_MS));
    first = false;

    if (abort?.aborted) return;

    try {
      const t = await detect(transferId);
      // Backend risponde 200 anche quando il deposito è assente ("awaiting_deposit").
      // Avanzare solo se il deposito è stato realmente confermato.
      if (t.status === "awaiting_deposit") continue;
      if (abort?.aborted) return;
      return; // deposito rilevato ✓
    } catch (pollErr: unknown) {
      const code = (pollErr as Error & { code?: string })?.code;

      // Deposito non ancora trovato dalla blockchain — transitorio, riprova.
      if (code === "DEPOSIT_TX_NOT_DETECTED") continue;

      // Errore di rete transitorio (iOS Safari "Load failed", Chrome "Failed to fetch", …):
      // non terminare il monitor — il deposito è comunque in attesa, riprova al prossimo ciclo.
      if (isNetworkError(pollErr)) continue;

      // Qualsiasi altro errore (ADAPTER_NOT_FOUND, FEATURE_DISABLED, errori applicativi): fatale.
      throw pollErr;
    }
  }

  throw new Error("Timeout: deposito non rilevato in 10 minuti.");
}
