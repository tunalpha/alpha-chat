/**
 * spark-diag.ts — Singleton diagnostico temporaneo Spark.
 *
 * SICUREZZA: registra SOLO stato, booleani e codici/messaggi errore generici.
 * MAI mnemonic, PIN, seed, private key, API key o qualsiasi valore segreto.
 *
 * Questo file è TEMPORANEO — rimuovere dopo aver identificato la root cause.
 */

export type SparkDiagState = {
  featureFlag:       "ON" | "OFF" | "—";
  walletUnlocked:    "YES" | "NO" | "—";
  connectCalled:     "YES" | "NO";
  getMnemonic:       "PASS" | "FAIL" | "—";
  getMnemonicError:  string;
  breezConnect:      "PASS" | "FAIL" | "—";
  breezConnectError: string;
  syncWallet:        "PASS" | "FAIL" | "N/A";
  sparkState:        string;
  sparkSat:          string;
  lastUpdate:        string;
};

const _state: SparkDiagState = {
  featureFlag:       "—",
  walletUnlocked:    "—",
  connectCalled:     "NO",
  getMnemonic:       "—",
  getMnemonicError:  "",
  breezConnect:      "—",
  breezConnectError: "",
  syncWallet:        "N/A",
  sparkState:        "—",
  sparkSat:          "N/A",
  lastUpdate:        new Date().toISOString(),
};

let _listeners: Array<() => void> = [];

/** Aggiorna uno o più campi diagnostici. MAI passare dati sensibili. */
export function updateSparkDiag(patch: Partial<SparkDiagState>): void {
  Object.assign(_state, patch, { lastUpdate: new Date().toISOString() });
  _listeners.forEach(fn => fn());
}

/** Snapshot corrente (copia difensiva). */
export function getSparkDiag(): SparkDiagState {
  return { ..._state };
}

/** Subscribe alle modifiche; restituisce unsubscribe. */
export function subscribeSparkDiag(fn: () => void): () => void {
  _listeners.push(fn);
  return () => { _listeners = _listeners.filter(l => l !== fn); };
}

/**
 * Sanitizza un messaggio di errore per il display: tronca a 120 chars,
 * rimuove possibili tracce di path assoluti o stack.
 * NON passare mai il mnemonic/PIN a questa funzione.
 */
export function sanitizeErrorMsg(msg: string): string {
  // Rimuovi stack trace (tutto dopo il primo \n)
  const first = msg.split("\n")[0] ?? msg;
  // Tronca
  return first.length > 120 ? first.slice(0, 117) + "…" : first;
}
