/**
 * remoteAudio — Singleton per l'audio remoto delle chiamate.
 *
 * Routing audio:
 *  - Speaker (vivavoce):   <audio>.srcObject = stream  → iOS usa speaker, Chrome usa default output
 *  - Auricolare:           AudioContext → destination  → iOS usa auricolare quando getUserMedia attivo
 *                          + setSinkId() su Chrome Android/Desktop per selezionare device "earpiece/communications"
 *
 * IMPORTANTE: primeRemoteAudio() deve essere chiamato durante un user gesture per
 * sbloccare sia l'<audio> element sia l'AudioContext su iOS Safari.
 */

let _el: HTMLAudioElement | null = null;
let _audioCtx: AudioContext | null = null;
let _sourceNode: MediaStreamAudioSourceNode | null = null;
let _currentStream: MediaStream | null = null;
let _speakerMode = true; // default speaker; aggiornato da setSpeakerMode() all'inizio di ogni chiamata

// ── Element singleton ─────────────────────────────────────────────────────────

function getEl(): HTMLAudioElement | null {
  if (typeof document === "undefined") return null;
  if (!_el) {
    _el = document.createElement("audio");
    (_el as HTMLAudioElement & { playsInline: boolean }).playsInline = true;
    _el.autoplay    = false;
    // iOS Safari richiede che l'elemento sia nel DOM per riprodurre MediaStream
    _el.style.cssText = "position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;top:-2px;left:-2px;";
    document.body.appendChild(_el);
  }
  return _el;
}

// ── AudioContext singleton ────────────────────────────────────────────────────

function getOrCreateAudioCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AC =
    (typeof AudioContext !== "undefined" && AudioContext) ||
    ((window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
  if (!AC) return null;
  if (!_audioCtx || _audioCtx.state === "closed") {
    _audioCtx = new AC();
  }
  return _audioCtx;
}

// ── Routing ───────────────────────────────────────────────────────────────────

function applyRouting(): void {
  const el = getEl();
  if (!el) return;

  // Nessuno stream → silenzia tutto
  if (!_currentStream) {
    _sourceNode?.disconnect();
    _sourceNode = null;
    el.srcObject = null;
    el.pause();
    return;
  }

  if (_speakerMode) {
    // ── Vivavoce: <audio>.srcObject → speaker ────────────────────────────────
    _sourceNode?.disconnect();
    _sourceNode = null;
    if (el.srcObject !== _currentStream) el.srcObject = _currentStream;
    void el.play().catch(() => {});

    // Chrome: resetta eventuale setSinkId verso earpiece
    const elS = el as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };
    if (typeof elS.setSinkId === "function") {
      void elS.setSinkId("").catch(() => {});
    }
  } else {
    // ── Auricolare ────────────────────────────────────────────────────────────
    const elS = el as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };

    if (typeof elS.setSinkId === "function") {
      // Chrome Android / Desktop: cerca device "earpiece" o "communications"
      if (el.srcObject !== _currentStream) el.srcObject = _currentStream;
      void el.play().catch(() => {});
      void (async () => {
        try {
          const devices = await navigator.mediaDevices.enumerateDevices();
          const earpiece = devices.find(
            (d) =>
              d.kind === "audiooutput" &&
              (d.label.toLowerCase().includes("earpiece") ||
                d.label.toLowerCase().includes("communications") ||
                d.label.toLowerCase().includes("auricolare")),
          );
          if (earpiece) await elS.setSinkId!(earpiece.deviceId);
        } catch { /* non-critico */ }
      })();
    } else {
      // iOS Safari: AudioContext.destination → auricolare (quando getUserMedia è attivo
      // iOS mappa automaticamente il destination all'auricolare in contesto chiamata)
      el.srcObject = null;
      el.pause();
      const ctx = getOrCreateAudioCtx();
      if (ctx && ctx.state !== "closed") {
        if (ctx.state === "suspended") void ctx.resume();
        _sourceNode?.disconnect();
        _sourceNode = ctx.createMediaStreamSource(_currentStream);
        _sourceNode.connect(ctx.destination);
      } else {
        // Fallback: audio element (potrebbe rimanere su speaker)
        el.srcObject = _currentStream;
        void el.play().catch(() => {});
      }
    }
  }
}

// ── API pubblica ──────────────────────────────────────────────────────────────

/**
 * Chiama DURANTE un user gesture (tap su "Accetta" / "Chiama").
 * Sblocca <audio> element E AudioContext su iOS Safari.
 */
export async function primeRemoteAudio(): Promise<void> {
  const el = getEl();
  if (el) {
    const prev = el.volume;
    el.volume = 0;
    try { await el.play(); el.pause(); } catch { /* ignora */ }
    el.currentTime = 0;
    el.volume = prev > 0 ? prev : 1;
  }
  // AudioContext deve essere creato/ripreso durante un gesture
  const ctx = getOrCreateAudioCtx();
  if (ctx?.state === "suspended") {
    try { await ctx.resume(); } catch { /* ignora */ }
  }
}

/**
 * Imposta lo stream audio remoto e applica subito il routing corrente.
 * Chiamato quando il remoteStream WebRTC arriva (ontrack).
 */
export function setRemoteStream(stream: MediaStream | null): void {
  _currentStream = stream;
  _sourceNode?.disconnect();
  _sourceNode = null;
  applyRouting();
}

/**
 * Imposta la modalità audio:
 *   false = auricolare (default per chiamate audio)
 *   true  = vivavoce (default per videochiamate)
 * Applica immediatamente il routing anche se lo stream è già attivo.
 */
export function setSpeakerMode(enabled: boolean): void {
  _speakerMode = enabled;
  applyRouting();
}

/** Resetta tutto a fine chiamata. */
export function resetRemoteAudio(): void {
  _sourceNode?.disconnect();
  _sourceNode = null;
  _currentStream = null;
  _speakerMode = true;
  const el = getEl();
  if (el) {
    el.srcObject = null;
    el.pause();
    // Resetta sinkId su Chrome
    const elS = el as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };
    if (typeof elS.setSinkId === "function") void elS.setSinkId("").catch(() => {});
  }
  if (_audioCtx && _audioCtx.state !== "closed") {
    void _audioCtx.close().catch(() => {});
    _audioCtx = null;
  }
}

/** Accede all'elemento <audio> (usato da ActiveCallScreen per debug/stats). */
export function getRemoteAudioEl(): HTMLAudioElement | null {
  return getEl();
}
