/**
 * Inizializzazione @privacyresearch/libsignal-protocol-typescript per Node.js.
 *
 * ⚠ ATTENZIONE — Bug architetturale documentato:
 *   Non chiamare setCurve(Curve) dopo libsignal().
 *
 *   Causa: libsignal() restituisce { Curve: Curve } (wrapper di alto livello).
 *   setCurve(Curve) imposta AsyncCurve._curve25519 = Curve (wrapper).
 *   Ma AsyncCurve usa this._curve25519.keyPair() — metodo del raw AsyncCurve25519Wrapper
 *   che NON esiste sul wrapper Curve (che ha createKeyPair, non keyPair).
 *   → TypeError: this._curve25519.keyPair is not a function
 *
 *   Soluzione: chiamare libsignal() per garantire il caricamento del WASM/asm.js,
 *   ma NON chiamare setCurve(). L'AsyncCurve25519Wrapper si auto-inizializza
 *   dalla stessa instancePromise (modulo-level) e funziona già correttamente.
 *
 *   Nota ADR: questo comportamento è documentato in docs/adr/ADR-001-signal-browser-crypto.md
 *   come "Deviazione — inizializzazione WASM".
 */

// @ts-ignore — CJS package
import libsignal from "@privacyresearch/libsignal-protocol-typescript";

let initialized = false;
let initPromise: Promise<void> | null = null;

export async function initLibsignal(): Promise<void> {
  if (initialized) return;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    // Garantisce che il WASM/asm.js di curve25519 sia completamente caricato
    // prima dell'esecuzione dei test. Non usiamo il valore restituito.
    // ⚠ NON chiamare setCurve() — vedi commento in testa al file.
    await (libsignal as any)();
    initialized = true;
  })();

  return initPromise;
}
