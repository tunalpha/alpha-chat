/**
 * WebRTC peer connection manager — Alpha Chat Sprint 23/25
 *
 * Sprint 25 additions:
 *  - switchCamera(): scambia camera frontale/posteriore senza ricreare il PC
 *  - onIceStateChange callback separato per ICE restart
 *  - ICE restart support via pc.restartIce()
 */

import { diagLog } from "./diagnosticLogger";

export type CallType = "audio" | "video";
export type FacingMode = "user" | "environment";

// Configurazione ICE — caricata dal server (supporta STUN+TURN da env).
// Fallback ai server STUN pubblici Google se l'API non risponde.
let _iceServers: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];

/**
 * Preleva la configurazione ICE dal backend (STUN + eventuale TURN).
 * NON cachata — viene chiamata una volta per call setup, così ogni chiamata usa
 * sempre la configurazione aggiornata (inclusi eventuali nuovi server TURN).
 */
export async function loadIceConfig(): Promise<void> {
  try {
    const res = await fetch("/api/v1/calls/ice-config");
    if (res.ok) {
      const json = await res.json() as { iceServers: RTCIceServer[] };
      if (Array.isArray(json.iceServers) && json.iceServers.length > 0) {
        _iceServers = json.iceServers;
        diagLog('ice.config.loaded', { count: json.iceServers.length, hasRelay: json.iceServers.some(s => String(s.urls).includes('turn:') || (Array.isArray(s.urls) && s.urls.some(u => u.startsWith('turn:')))) });
      }
    }
  } catch (e) {
    // Fallback silenzioso ai server Google
    diagLog('ice.config.error', { err: String(e) });
  }
}

export async function getUserMedia(callType: CallType, facingMode: FacingMode = "user"): Promise<MediaStream> {
  const constraints: MediaStreamConstraints =
    callType === "video"
      ? { audio: true, video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode } }
      : { audio: true, video: false };
  console.log('[webrtc] getUserMedia constraints=%o', constraints);
  diagLog('getUserMedia.start', { callType });
  const stream = await navigator.mediaDevices.getUserMedia(constraints);
  console.log('[webrtc] getUserMedia ✓ audioTracks=%d videoTracks=%d',
    stream.getAudioTracks().length, stream.getVideoTracks().length);
  diagLog('getUserMedia.ok', { audioTracks: stream.getAudioTracks().length, videoTracks: stream.getVideoTracks().length });
  stream.getAudioTracks().forEach((t) =>
    console.log('[webrtc]   localAudio id=%s enabled=%s readyState=%s', t.id, t.enabled, t.readyState));
  return stream;
}

export function createPeerConnection(
  onIceCandidate: (candidate: RTCIceCandidate) => void,
  onRemoteStream: (stream: MediaStream) => void,
  onConnectionStateChange: (state: RTCPeerConnectionState) => void,
  onIceStateChange?: (state: RTCIceConnectionState) => void,
): RTCPeerConnection {
  // Log completo dei server ICE passati al PC — conferma che TURN sia incluso.
  const _serverSummary = _iceServers.map(s => ({
    urls: s.urls,
    hasCredentials: !!(s.username),
  }));
  diagLog('rtc.pc.create', { serverCount: _iceServers.length, servers: _serverSummary });
  console.log('[webrtc] createPeerConnection iceServers=%o', _serverSummary);

  const pc = new RTCPeerConnection({ iceServers: _iceServers });

  // Fallback stream per iOS Safari — e.streams[] può essere vuoto anche
  // quando il sender ha chiamato addTrack(track, stream) correttamente.
  let _remoteStream: MediaStream | null = null;

  pc.onicecandidate = (e) => {
    if (e.candidate) {
      console.log('[webrtc] onicecandidate → candidate=%s', e.candidate.type);
      diagLog('ice.candidate.local', { type: e.candidate.type, protocol: e.candidate.protocol });
      onIceCandidate(e.candidate);
    } else {
      console.log('[webrtc] onicecandidate → gathering complete');
      diagLog('ice.gathering.complete', {});
    }
  };

  // FIX: onRemoteStream deve essere chiamato UNA SOLA VOLTA.
  // Il browser pre-popola e.streams[0] con TUTTI i track prima di sparare qualsiasi
  // ontrack (confermato dai diagLog: audioTracksInStream=1 anche quando video arriva
  // per primo). Chiamare onRemoteStream due volte (audio + video) provoca:
  //   1. video.srcObject = streamA  → video.play() parte (Promise pending)
  //   2. video.srcObject = streamB  → play() precedente abortisce (AbortError silenzioso)
  //   3. video.play() chiamato di nuovo → può fallire su iOS per stato transitorio
  // Risultato: video nero sporadico sul chiamante.
  let _onRemoteStreamCalled = false;

  pc.ontrack = (e) => {
    console.log('[webrtc] ontrack: kind=%s id=%s enabled=%s muted=%s readyState=%s streams=%d',
      e.track.kind, e.track.id, e.track.enabled, e.track.muted, e.track.readyState, e.streams?.length ?? 0);

    diagLog('ontrack', {
      kind:                e.track.kind,
      trackId:             e.track.id,
      enabled:             e.track.enabled,
      muted:               e.track.muted,
      readyState:          e.track.readyState,
      streamsCount:        e.streams?.length ?? 0,
      audioTracksInStream: e.streams?.[0]?.getAudioTracks().length ?? 0,
      videoTracksInStream: e.streams?.[0]?.getVideoTracks().length ?? 0,
    });

    // Costruisce sempre un nuovo oggetto MediaStream così React vede sempre
    // un riferimento diverso e il useEffect si ri-scatta.
    let stream: MediaStream;
    if (e.streams && e.streams.length > 0) {
      // Percorso standard. e.streams[0] è già popolato con tutti i track
      // dal browser al momento in cui ontrack scatta (verificato sui log).
      stream = new MediaStream(e.streams[0].getTracks());
      console.log('[webrtc] ontrack: new MediaStream da e.streams[0] tracks=%d audio=%d video=%d',
        stream.getTracks().length,
        stream.getAudioTracks().length,
        stream.getVideoTracks().length);
      diagLog('ontrack.newStream', {
        kind:        e.track.kind,
        tracks:      stream.getTracks().length,
        audioTracks: stream.getAudioTracks().length,
        videoTracks: stream.getVideoTracks().length,
      });
    } else {
      // iOS Safari bug: e.streams vuoto — costruiamo manualmente.
      console.warn('[webrtc] ontrack: e.streams vuoto — fallback MediaStream manuale');
      diagLog('ontrack.streams_empty_fallback', { kind: e.track.kind });
      if (!_remoteStream) _remoteStream = new MediaStream();
      _remoteStream.addTrack(e.track);
      stream = new MediaStream(_remoteStream.getTracks());
      diagLog('ontrack.fallback.newStream', {
        kind:        e.track.kind,
        tracks:      stream.getTracks().length,
        audioTracks: stream.getAudioTracks().length,
        videoTracks: stream.getVideoTracks().length,
      });
    }

    // Log dettaglio tracce
    stream.getAudioTracks().forEach((t) => {
      console.log('[webrtc] audioTrack: id=%s enabled=%s muted=%s readyState=%s', t.id, t.enabled, t.muted, t.readyState);
      diagLog('ontrack.audioTrack', { id: t.id, enabled: t.enabled, muted: t.muted, readyState: t.readyState });
    });
    stream.getVideoTracks().forEach((t) => {
      console.log('[webrtc] videoTrack: id=%s enabled=%s muted=%s readyState=%s', t.id, t.enabled, t.muted, t.readyState);
      diagLog('ontrack.videoTrack', { id: t.id, enabled: t.enabled, muted: t.muted, readyState: t.readyState });
    });

    // Chiama onRemoteStream UNA SOLA VOLTA: la prima volta che un track arriva.
    // Poiché e.streams[0] è già completo, la prima chiamata porta già tutto.
    // Chiamate successive (secondo track) saltano per evitare il double-srcObject
    // change che su iOS aborta il play() in corso → video nero.
    if (!_onRemoteStreamCalled) {
      _onRemoteStreamCalled = true;
      onRemoteStream(stream);
    } else {
      console.log('[webrtc] ontrack: secondo track (%s) — onRemoteStream già chiamato, skip', e.track.kind);
      diagLog('ontrack.skip.alreadyCalled', { kind: e.track.kind });
    }
  };

  pc.onconnectionstatechange = () => {
    console.log('[webrtc] connectionState → %s', pc.connectionState);
    diagLog('pc.state', { state: pc.connectionState });
    onConnectionStateChange(pc.connectionState);
  };

  if (onIceStateChange) {
    pc.oniceconnectionstatechange = () => {
      console.log('[webrtc] iceConnectionState → %s', pc.iceConnectionState);
      diagLog('ice.state', { state: pc.iceConnectionState });
      onIceStateChange(pc.iceConnectionState);
    };
  }

  return pc;
}

export function addTracksToPC(pc: RTCPeerConnection, stream: MediaStream): void {
  stream.getTracks().forEach((track) => {
    console.log('[webrtc] addTrack: kind=%s id=%s enabled=%s', track.kind, track.id, track.enabled);
    pc.addTrack(track, stream);
  });
}

/**
 * Scambia la camera (frontale ↔ posteriore) senza ricreare il PeerConnection.
 * Aggiorna anche il localStream con il nuovo video track.
 * @returns Il nuovo MediaStream aggiornato, o null se fallisce.
 */
export async function switchCameraTrack(
  pc: RTCPeerConnection,
  currentStream: MediaStream,
  currentFacing: FacingMode,
): Promise<{ stream: MediaStream; facing: FacingMode } | null> {
  const newFacing: FacingMode = currentFacing === "user" ? "environment" : "user";
  try {
    const newStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: newFacing, width: { ideal: 1280 }, height: { ideal: 720 } },
    });
    const newVideoTrack = newStream.getVideoTracks()[0];
    if (!newVideoTrack) return null;

    // Trova il sender video nel PC e sostituisci il track
    const sender = pc.getSenders().find((s) => s.track?.kind === "video");
    if (sender) {
      await sender.replaceTrack(newVideoTrack);
    }

    // Aggiorna il localStream: rimuovi vecchio video, aggiungi nuovo
    currentStream.getVideoTracks().forEach((t) => { t.stop(); currentStream.removeTrack(t); });
    currentStream.addTrack(newVideoTrack);

    return { stream: currentStream, facing: newFacing };
  } catch {
    return null;
  }
}

export function closePeerConnection(pc: RTCPeerConnection | null, stream: MediaStream | null): void {
  if (stream) {
    stream.getTracks().forEach((t) => t.stop());
  }
  if (pc) {
    pc.onicecandidate = null;
    pc.ontrack = null;
    pc.onconnectionstatechange = null;
    pc.oniceconnectionstatechange = null;
    pc.close();
  }
}
