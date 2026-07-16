/**
 * remoteAudio — Singleton per l'audio remoto delle chiamate.
 *
 * Su iOS Safari, HTMLMediaElement.play() deve essere chiamato durante un
 * user gesture. Il problema con l'approccio useRef in ActiveCallScreen è che
 * l'elemento viene creato DOPO il gesture (dopo che acceptCall() aggiorna lo
 * stato e il componente si monta).
 *
 * Soluzione: creare l'elemento a livello di modulo (al caricamento del JS),
 * primarlo durante il gesture con primeRemoteAudio(), poi quando il remoteStream
 * arriva setRemoteStream() può chiamare play() senza problemi.
 */

let _el: HTMLAudioElement | null = null;

function getEl(): HTMLAudioElement | null {
  if (typeof document === "undefined") return null;
  if (!_el) {
    _el = document.createElement("audio");
    (_el as HTMLVideoElement & HTMLAudioElement).playsInline = true;
    _el.autoplay    = false;
    // Non serve aggiungerlo al DOM per l'audio
  }
  return _el;
}

/**
 * Chiama DURANTE un user gesture (tap su "Accetta" o pulsante chiamata).
 * Sblocca l'elemento audio per tutti i play() futuri su iOS Safari.
 */
export async function primeRemoteAudio(): Promise<void> {
  const el = getEl();
  if (!el) return;
  const prevVolume = el.volume;
  el.volume = 0;
  try {
    await el.play();
    el.pause();
  } catch {
    // ignora: alcuni browser rifiutano play() su un elemento senza src
  }
  el.currentTime = 0;
  el.volume = prevVolume > 0 ? prevVolume : 1;
}

/**
 * Imposta lo stream audio remoto e avvia la riproduzione.
 * Chiamato quando il remoteStream WebRTC arriva (ontrack).
 */
export function setRemoteStream(stream: MediaStream | null): void {
  const el = getEl();
  if (!el) return;
  el.srcObject = stream;
  if (stream) {
    void el.play().catch(() => {});
  } else {
    el.pause();
  }
}

/** Accede all'elemento per uso in ActiveCallScreen (speaker toggle, etc.) */
export function getRemoteAudioEl(): HTMLAudioElement | null {
  return getEl();
}
