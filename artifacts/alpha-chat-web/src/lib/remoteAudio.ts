/**
 * remoteAudio — Singleton per l'audio remoto delle chiamate.
 *
 * Routing audio:
 *  - Chrome/Edge (hasSinkId): <audio>.srcObject → play() → setSinkId(earpiece) per auricolare
 *  - iOS Safari / tutti senza setSinkId: <audio>.srcObject → play()
 *    Con getUserMedia attivo iOS è in PlayAndRecord → receiver (auricolare) è il default port.
 *    Non usiamo AudioContext per il routing su iOS: il cambio di sessione audio
 *    Playback→PlayAndRecord sospende il ctx e ctx.resume() richiede un gesture che
 *    a quel punto non è più disponibile → silenzio totale.
 *
 * IMPORTANTE: primeRemoteAudio() deve essere chiamato DOPO getUserMedia() (iOS) per
 * sbloccare l'<audio> element nel contesto della sessione PlayAndRecord corretta.
 */

import { diagLog } from "./diagnosticLogger";

let _el: HTMLAudioElement | null = null;
let _audioCtx: AudioContext | null = null;      // usato SOLO da primeRemoteAudio su Chrome
let _currentStream: MediaStream | null = null;
let _speakerMode = true;
let _playRetryTimer: ReturnType<typeof setTimeout> | null = null;

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

// ── AudioContext singleton (solo per primeRemoteAudio, non per routing iOS) ──

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

// ── Retry play ────────────────────────────────────────────────────────────────
// Annulla il timer di retry attivo (chiamato su reset/routing-change).

function cancelPlayRetry(): void {
  if (_playRetryTimer !== null) {
    clearTimeout(_playRetryTimer);
    _playRetryTimer = null;
  }
}

/**
 * Prova el.play() e, se fallisce, ritenta ogni `delayMs` ms per `attemptsLeft` volte.
 * Utile su iOS quando primeRemoteAudio() non ha ancora completato al momento
 * dell'arrivo del primo remote stream (race condition nel setup della chiamata).
 */
function schedulePlayRetry(el: HTMLAudioElement, delayMs: number, attemptsLeft: number): void {
  cancelPlayRetry();
  if (attemptsLeft <= 0 || !_currentStream) return;
  _playRetryTimer = setTimeout(() => {
    _playRetryTimer = null;
    if (!_currentStream) return; // chiamata terminata nel frattempo
    void el.play()
      .then(() => console.info('[remoteAudio] ✓ retry el.play() OK (tentativi rimasti=%d)', attemptsLeft))
      .catch(() => schedulePlayRetry(el, delayMs, attemptsLeft - 1));
  }, delayMs);
}

// ── Routing ───────────────────────────────────────────────────────────────────

function applyRouting(): void {
  const el = getEl();
  if (!el) return;

  cancelPlayRetry();

  // Nessuno stream → silenzia tutto
  if (!_currentStream) {
    el.srcObject = null;
    el.pause();
    console.log('[remoteAudio] applyRouting: nessun stream — in attesa');
    return;
  }

  const hasSinkId = typeof (el as HTMLAudioElement & { setSinkId?: unknown }).setSinkId === "function";
  console.log('[remoteAudio] applyRouting: speakerMode=%s hasSinkId=%s elMuted=%s volume=%s',
    _speakerMode, hasSinkId, el.muted, el.volume);

  // Garantisce che l'elemento non sia mai muto
  el.muted  = false;
  el.volume = 1;

  if (_speakerMode || !hasSinkId) {
    // ── Speaker  ─  OPPURE  ─  iOS/Safari (no setSinkId) ────────────────────
    //
    // iOS con getUserMedia attivo (PlayAndRecord): il <audio> element va al
    // receiver (auricolare) per default. Il pulsante vivavoce su iOS non
    // cambia il routing perché non esistono web API per forzare lo speaker
    // in PlayAndRecord senza setSinkId. L'audio viene comunque riprodotto. ✓
    //
    // Chrome speaker mode: <audio> → default output device.
    if (el.srcObject !== _currentStream) el.srcObject = _currentStream;

    void el.play()
      .then(() => console.info('[remoteAudio] ✓ el.play() OK (speaker/iOS path)'))
      .catch((err) => {
        console.warn('[remoteAudio] el.play() FAILED (attempt 1):', err, '— retry ogni 400ms');
        // Retry progressivo: primeRemoteAudio potrebbe non aver ancora sbloccato l'elemento
        schedulePlayRetry(el, 400, 6); // max 2.4s di tentativi
      });

    if (hasSinkId && !_speakerMode) {
      // questo ramo non si raggiunge (hasSinkId=false in iOS), ma è sicuro lasciarlo
    } else if (hasSinkId && _speakerMode) {
      // Chrome speaker: reset eventuale setSinkId verso earpiece
      const elS = el as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };
      void elS.setSinkId!("").catch(() => {});
    }

  } else {
    // ── Auricolare su Chrome/Edge (hasSinkId=true, speakerMode=false) ────────
    if (el.srcObject !== _currentStream) el.srcObject = _currentStream;

    void (async () => {
      try {
        await el.play();
        console.info('[remoteAudio] ✓ earpiece el.play() OK');
      } catch (err) {
        console.warn('[remoteAudio] earpiece el.play() FAILED:', err);
        schedulePlayRetry(el, 400, 4);
        return;
      }
      try {
        const elS = el as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };
        const devices = await navigator.mediaDevices.enumerateDevices();
        const earpiece = devices.find(
          (d) =>
            d.kind === "audiooutput" &&
            (d.label.toLowerCase().includes("earpiece") ||
              d.label.toLowerCase().includes("communications") ||
              d.label.toLowerCase().includes("auricolare")),
        );
        if (earpiece) {
          await elS.setSinkId!(earpiece.deviceId);
          console.info('[remoteAudio] ✓ setSinkId → earpiece device %s', earpiece.label);
        } else {
          console.log('[remoteAudio] nessun earpiece device trovato — default output');
        }
      } catch (e) { console.warn('[remoteAudio] setSinkId error:', e); }
    })();
  }
}

// ── API pubblica ──────────────────────────────────────────────────────────────

/**
 * Chiama DURANTE (o immediatamente dopo) un user gesture E DOPO getUserMedia().
 * Sblocca l'<audio> element per iOS Safari (autoplay policy).
 * Su iOS: chiamare DOPO getUserMedia() per essere nella sessione PlayAndRecord corretta.
 */
/**
 * callId opzionale passato da acceptCall() per mantenere i log diagnostici
 * associati alla chiamata corretta anche se diagLogger.clearCurrentCall()
 * viene invocato da un WS handler concorrente.
 */
export async function primeRemoteAudio(callId?: string, source?: string): Promise<void> {
  // Tutti i checkpoint usano diagLog (non console.log) per essere visibili
  // nel Diagnostics Center senza Safari Web Inspector.
  const dlog = (event: string, payload: Record<string, unknown> = {}) =>
    diagLog(event, payload, callId);

  // "source" identifica il call site (es. "acceptCall", "modal", "startCall", "callAnswered")
  // così i log prime.* sono disambiguati senza ambiguità anche quando più flussi
  // chiamano primeRemoteAudio() in sequenza ravvicinata.
  dlog('prime.enter', { source: source ?? 'unknown' });

  const el = getEl();
  dlog('prime.el', { present: !!el });

  if (el) {
    el.muted  = false;
    const prev = el.volume;
    el.volume = 0;

    const srcNull = el.srcObject === null;
    dlog('prime.srcObject', { null: srcNull });

    if (srcNull) {
      // Nessuna sorgente ancora disponibile (il remote stream arriva solo dopo ontrack,
      // cioè dopo buildPC/setRemoteDescription — step 4 di acceptCall).
      // el.play() su un elemento senza srcObject su iOS Safari può restare pending
      // indefinitamente senza risolvere né rigettare → causa originale del blocco step 2.
      // Il priming reale avverrà in applyRouting() quando setRemoteStream() assegnerà lo stream.
      dlog('prime.play.skip', { reason: 'srcObject_null' });
    } else {
      // srcObject presente: tentiamo il play() con timeout bounded 1500ms.
      dlog('prime.play.before');
      try {
        let played = false;
        await Promise.race([
          el.play().then(() => { played = true; }),
          new Promise<void>(resolve => setTimeout(resolve, 1500)),
        ]);
        dlog('prime.play.after', { ok: played });
        if (played) el.pause();
      } catch (err) {
        dlog('prime.play.error', { err: String(err) });
      }
    }

    el.currentTime = 0;
    el.volume = prev > 0 ? prev : 1;
  }

  // ── AudioContext ──────────────────────────────────────────────────────────
  // Su iOS Safari, AudioContext.resume() in sessione PlayAndRecord può restare
  // pending indefinitamente, come el.play() senza srcObject.
  // Fix: timeout bounded 1500ms — se non risolve, si continua comunque.
  dlog('prime.ctx.before');
  const ctx = getOrCreateAudioCtx();
  const ctxState = ctx?.state ?? 'null';
  dlog('prime.ctx.state', { state: ctxState });

  if (ctx?.state === "suspended") {
    dlog('prime.ctx.resume.before');
    try {
      let resumed = false;
      await Promise.race([
        ctx.resume().then(() => { resumed = true; }),
        new Promise<void>(resolve => setTimeout(resolve, 1500)),
      ]);
      dlog('prime.ctx.resume.after', { ok: resumed });
    } catch (err) {
      dlog('prime.ctx.resume.error', { err: String(err) });
    }
  }

  dlog('prime.exit');
}

/**
 * Imposta lo stream audio remoto e applica subito il routing corrente.
 * Chiamato quando il remoteStream WebRTC arriva (ontrack).
 */
export function setRemoteStream(stream: MediaStream | null): void {
  console.log('[remoteAudio] setRemoteStream: stream=%s tracks=%s',
    !!stream, stream?.getAudioTracks().length ?? 0);
  if (stream) {
    const audioTracks = stream.getAudioTracks();
    audioTracks.forEach((t) =>
      console.log('[remoteAudio]   remoteAudioTrack id=%s enabled=%s muted=%s readyState=%s',
        t.id, t.enabled, t.muted, t.readyState));
  }
  _currentStream = stream;
  applyRouting();
}

/**
 * Imposta la modalità audio:
 *   true  = vivavoce / speaker
 *   false = auricolare (default per chiamate audio)
 * Applica immediatamente il routing anche se lo stream è già attivo.
 * NOTA: su iOS senza setSinkId, entrambe le modalità usano <audio> element;
 * il routing fisico è controllato dall'audio session iOS (PlayAndRecord → receiver).
 */
export function setSpeakerMode(enabled: boolean): void {
  _speakerMode = enabled;
  console.log('[remoteAudio] setSpeakerMode: %s', enabled);
  applyRouting();
}

/** Resetta tutto a fine chiamata. */
export function resetRemoteAudio(): void {
  cancelPlayRetry();
  _currentStream = null;
  _speakerMode   = true;
  const el = getEl();
  if (el) {
    el.srcObject = null;
    el.pause();
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
