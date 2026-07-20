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
let _audioCtx: AudioContext | null = null;      // usato SOLO da primeRemoteAudio su Chrome (MAI su iOS)
let _currentStream: MediaStream | null = null;
let _speakerMode = true;
let _playRetryTimer: ReturnType<typeof setTimeout> | null = null;
let _silenceBlobUrl: string | null = null;      // WAV silenzioso per blessing iOS (no AudioContext)

// ── iOS detection ─────────────────────────────────────────────────────────────
// iOS Safari non supporta setSinkId e il suo AudioContext interferisce con
// la sessione PlayAndRecord di getUserMedia, forzando l'audio sullo speaker.
// Su iOS evitiamo completamente AudioContext durante le chiamate.

function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

/**
 * Restituisce un blob URL per un WAV di silenzio (46 byte).
 * Usato su iOS per "benedire" l'<audio> element senza AudioContext.
 * Creato una sola volta e riutilizzato per tutta la vita della pagina.
 */
function getSilenceBlobUrl(): string {
  if (_silenceBlobUrl) return _silenceBlobUrl;
  // WAV PCM mono 8000 Hz, 1 sample di silenzio (= 46 byte totali)
  const buf  = new ArrayBuffer(46);
  const view = new DataView(buf);
  const str  = (offset: number, s: string) =>
    [...s].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  str(0,  "RIFF");
  view.setUint32(4,  38,    true);  // chunk size = 46 - 8
  str(8,  "WAVE");
  str(12, "fmt ");
  view.setUint32(16, 16,    true);  // PCM subchunk size
  view.setUint16(20, 1,     true);  // PCM format
  view.setUint16(22, 1,     true);  // mono
  view.setUint32(24, 8000,  true);  // sample rate
  view.setUint32(28, 16000, true);  // byte rate
  view.setUint16(32, 2,     true);  // block align
  view.setUint16(34, 16,    true);  // bits per sample
  str(36, "data");
  view.setUint32(40, 2,     true);  // 1 sample × 2 byte
  view.setInt16(44,  0,     true);  // campione = silenzio
  _silenceBlobUrl = URL.createObjectURL(new Blob([buf], { type: "audio/wav" }));
  return _silenceBlobUrl;
}

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

// ── AudioContext singleton (solo per primeRemoteAudio, NON su iOS) ───────────
// Su iOS, AudioContext.create() interferisce con la sessione AVAudioSession
// aperta da getUserMedia (PlayAndRecord) e forza l'output sullo speaker.
// Restituisce null su iOS → il chiamante usa il path blob-URL al posto suo.

function getOrCreateAudioCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (isIOS()) return null;   // ← iOS: niente AudioContext durante le chiamate
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
  console.log('[ROUTING-DIAG] t=applyRouting abs=%d speakerMode=%s hasSinkId=%s stream=%s',
    Date.now(), _speakerMode, hasSinkId, _currentStream ? 'yes' : 'null');
  diagLog('routing.applyRouting', { abs: Date.now(), speakerMode: _speakerMode, hasSinkId, hasStream: !!_currentStream });
  console.log('[remoteAudio] applyRouting: speakerMode=%s hasSinkId=%s elMuted=%s volume=%s',
    _speakerMode, hasSinkId, el.muted, el.volume);

  // Garantisce che l'elemento non sia mai muto
  el.muted  = false;
  el.volume = 1;

  if (_speakerMode || !hasSinkId) {
    // ── Speaker  ─  OPPURE  ─  iOS/Safari (no setSinkId) ────────────────────
    //
    // Su iOS getSinkId non esiste → questo branch è sempre preso.
    // Il routing fisico dipende dalla porta di uscita dell'AVAudioSession:
    //
    //   speakerMode=false (default auricolare):
    //     <audio srcObject> in PlayAndRecord → iOS usa il receiver (auricolare)
    //     a patto che nessun <audio src> stia giocando contemporaneamente.
    //     Non servono API aggiuntive: il default di PlayAndRecord è earpiece.
    //
    //   speakerMode=true (vivavoce):
    //     iOS non espone setSinkId né API per forzare lo speaker lato web.
    //     Usiamo il "speaker trick": riproduzione brevissima di un <audio src>
    //     silenzioso → iOS sovrascrive la porta di uscita su speaker → poi
    //     el.play() con srcObject va sullo speaker. Questo switch è ONE-WAY
    //     durante la chiamata: per tornare all'auricolare serve riavviare la
    //     sessione audio (limitazione platform iOS Safari PWA).
    //
    // Chrome speaker mode: <audio> → default output device.

    // ── iOS vivavoce: forza speaker port prima di assegnare srcObject ─────
    // Il trick DEVE precedere el.pause()/el.play() perché iOS determina la
    // porta di uscita al momento del play(). Usiamo un elemento temporaneo
    // (NON l'elemento principale) per non interrompere il flusso audio.
    if (isIOS() && _speakerMode) {
      const silEl = document.createElement("audio");
      silEl.src    = getSilenceBlobUrl();
      silEl.volume = 0;
      void silEl.play().then(() => { silEl.pause(); }).catch(() => {});
      diagLog('applyRouting.ios.speakertrick', { triggered: true });
    }

    const srcChanged = el.srcObject !== _currentStream;
    // iOS routing fix: il routing audio è fissato al primo play() riuscito.
    // Se l'elemento è già in play (srcChanged=false, routing change) dobbiamo
    // pause() prima di play() per forzare iOS a rivalutare l'uscita audio.
    // Stessa logica se srcObject cambia: pause → assign → play.
    if (!el.paused) el.pause();
    if (srcChanged) el.srcObject = _currentStream;
    // ── diagLog: srcObject assegnato + esito el.play() ────────────────────
    diagLog('applyRouting', {
      path:              isIOS() ? (_speakerMode ? 'ios_speaker' : 'ios_earpiece') : 'chrome_speaker',
      srcChanged,
      hasSinkId,
      speakerMode:       _speakerMode,
      elPaused:          el.paused,
      elMuted:           el.muted,
      streamAudioTracks: _currentStream?.getAudioTracks().length ?? 0,
    });
    // ──────────────────────────────────────────────────────────────────────

    void el.play()
      .then(() => {
        console.info('[remoteAudio] ✓ el.play() OK path=%s', isIOS() ? (_speakerMode ? 'ios_speaker' : 'ios_earpiece') : 'chrome_speaker');
        diagLog('applyRouting.play.ok', { path: isIOS() ? (_speakerMode ? 'ios_speaker' : 'ios_earpiece') : 'chrome_speaker' });
      })
      .catch((err: unknown) => {
        console.warn('[remoteAudio] el.play() FAILED (attempt 1):', err, '— retry ogni 400ms');
        diagLog('applyRouting.play.fail', { path: 'ios_routing', err: String(err) });
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
      // L'elemento deve essere "blessed" nel gesture context prima che arrivi
      // il remote stream, altrimenti iOS blocca silenziosamente el.play() da ontrack.
      //
      // ── Path iOS (PlayAndRecord, niente AudioContext) ─────────────────────
      // Su iOS creare AudioContext durante una sessione getUserMedia interferisce
      // con AVAudioSession e forza l'uscita audio sullo SPEAKER anche se il modo
      // corretto (PlayAndRecord) userebbe l'auricolare per default.
      // Fix: usiamo un blob URL WAV silenzioso come srcObject temporaneo per il
      // blessing → nessun AudioContext creato → la sessione PlayAndRecord rimane
      // intatta → l'audio del remoto arriverà all'auricolare come atteso.
      //
      // ── Path Chrome/Edge (AudioContext + MediaStreamDestination) ──────────
      // Su browser con AudioContext disponibile, il path precedente rimane: il
      // ctx è già in PlayAndRecord e il MediaStreamDestination è la scelta migliore.
      if (isIOS()) {
        // iOS: salta completamente il blessing.
        //
        // Qualsiasi play() preventivo — blob WAV, AudioContext dest, o altro —
        // "colora" la sessione AVAudioSession come media/playback e forza
        // lo speaker anche in modalità PlayAndRecord (che di default usa l'auricolare).
        //
        // getUserMedia ha già sbloccato l'audio nella sessione PlayAndRecord corretta.
        // Il play() in applyRouting() (chiamato da ontrack) funziona senza ulteriore
        // gesture perché la sessione PlayAndRecord è attiva — e iOS instrada
        // l'audio all'auricolare automaticamente fin dal primo play().
        //
        // TIMING CRITICO: setSpeakerMode() deve essere chiamato PRIMA di
        // setRemoteDescription() (che triggerà ontrack → applyRouting).
        // Se _speakerMode=true al primo applyRouting, iOS inizia in speaker mode
        // e le chiamate play() successive sono no-op → audio bloccato sullo speaker.
        // Questo è corretto in CallContext.tsx (setSpeakerMode spostato prima di step 4).
        dlog('prime.skip', { reason: 'ios_no_blessing', note: 'PlayAndRecord already active' });
        el.muted  = false;
        el.volume = prev > 0 ? prev : 1;
        return; // ← uscita anticipata: niente AudioContext, niente play() preventivo
      } else {
        // Chrome/Edge: blessing via MediaStreamDestination (AudioContext)
        const ctxForBlessing = getOrCreateAudioCtx();
        if (ctxForBlessing) {
          try {
            if (ctxForBlessing.state === 'suspended') {
              await Promise.race([
                ctxForBlessing.resume(),
                new Promise<void>(r => setTimeout(r, 500)),
              ]);
            }
            const dest = ctxForBlessing.createMediaStreamDestination();
            el.srcObject = dest.stream;
            let blessed = false;
            await Promise.race([
              el.play().then(() => { blessed = true; }),
              new Promise<void>(r => setTimeout(r, 1500)),
            ]);
            dlog('prime.play.after', { ok: blessed, method: 'silent_dest' });
            if (blessed) el.pause();
          } catch (err) {
            dlog('prime.play.error', { err: String(err), method: 'silent_dest' });
          } finally {
            el.srcObject = null;
          }
        } else {
          dlog('prime.play.skip', { reason: 'no_audioCtx' });
        }
      }
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
  // ── diagLog: conferma che ontrack ha propagato lo stream fino a qui ──────
  diagLog('setRemoteStream', {
    hasStream:   !!stream,
    audioTracks: stream?.getAudioTracks().length ?? 0,
    tracks:      stream?.getAudioTracks().map(t => ({
      id: t.id, enabled: t.enabled, muted: t.muted, readyState: t.readyState,
    })) ?? [],
  });
  // ──────────────────────────────────────────────────────────────────────────
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
