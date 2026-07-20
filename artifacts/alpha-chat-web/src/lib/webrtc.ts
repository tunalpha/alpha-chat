/**
 * WebRTC peer connection manager — Alpha Chat Sprint 23/25
 *
 * Sprint 25 additions:
 *  - switchCamera(): scambia camera frontale/posteriore senza ricreare il PC
 *  - onIceStateChange callback separato per ICE restart
 *  - ICE restart support via pc.restartIce()
 */

export type CallType = "audio" | "video";
export type FacingMode = "user" | "environment";

// Configurazione ICE — caricata dal server (supporta STUN+TURN da env).
// Fallback ai server STUN pubblici Google se l'API non risponde.
let _iceServers: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];
let _iceLoaded = false;

/** Preleva la configurazione ICE dal backend (STUN + eventuale TURN). */
export async function loadIceConfig(): Promise<void> {
  if (_iceLoaded) return;
  try {
    const res = await fetch("/api/v1/calls/ice-config");
    if (res.ok) {
      const json = await res.json() as { iceServers: RTCIceServer[] };
      if (Array.isArray(json.iceServers) && json.iceServers.length > 0) {
        _iceServers = json.iceServers;
      }
    }
  } catch {
    // Fallback silenzioso ai server Google
  }
  _iceLoaded = true;
}

export async function getUserMedia(callType: CallType, facingMode: FacingMode = "user"): Promise<MediaStream> {
  const constraints: MediaStreamConstraints =
    callType === "video"
      ? { audio: true, video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode } }
      : { audio: true, video: false };
  console.log('[webrtc] getUserMedia constraints=%o', constraints);
  const stream = await navigator.mediaDevices.getUserMedia(constraints);
  console.log('[webrtc] getUserMedia ✓ audioTracks=%d videoTracks=%d',
    stream.getAudioTracks().length, stream.getVideoTracks().length);
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
  const pc = new RTCPeerConnection({ iceServers: _iceServers });

  // Fallback stream per iOS Safari — e.streams[] può essere vuoto anche
  // quando il sender ha chiamato addTrack(track, stream) correttamente.
  let _remoteStream: MediaStream | null = null;

  pc.onicecandidate = (e) => {
    if (e.candidate) {
      console.log('[webrtc] onicecandidate → candidate=%s', e.candidate.type);
      onIceCandidate(e.candidate);
    } else {
      console.log('[webrtc] onicecandidate → gathering complete');
    }
  };

  pc.ontrack = (e) => {
    console.log('[webrtc] ontrack: kind=%s id=%s enabled=%s readyState=%s streams=%d',
      e.track.kind, e.track.id, e.track.enabled, e.track.readyState, e.streams?.length ?? 0);

    let stream: MediaStream;
    if (e.streams && e.streams.length > 0) {
      // Percorso standard: il sender ha associato il track a un MediaStream
      stream = e.streams[0];
      console.log('[webrtc] ontrack: usando e.streams[0] id=%s, audioTracks=%d',
        stream.id, stream.getAudioTracks().length);
    } else {
      // iOS Safari bug: e.streams vuoto anche con addTrack(track, stream) — costruiamo noi
      console.warn('[webrtc] ontrack: e.streams vuoto — fallback MediaStream manuale (iOS Safari bug)');
      if (!_remoteStream) _remoteStream = new MediaStream();
      _remoteStream.addTrack(e.track);
      stream = _remoteStream;
      console.log('[webrtc] ontrack: fallback stream audioTracks=%d', stream.getAudioTracks().length);
    }

    // Log dettaglio tracce audio
    stream.getAudioTracks().forEach((t) => {
      console.log('[webrtc] audioTrack: id=%s enabled=%s muted=%s readyState=%s', t.id, t.enabled, t.muted, t.readyState);
    });

    onRemoteStream(stream);
  };

  pc.onconnectionstatechange = () => {
    console.log('[webrtc] connectionState → %s', pc.connectionState);
    onConnectionStateChange(pc.connectionState);
  };

  if (onIceStateChange) {
    pc.oniceconnectionstatechange = () => {
      console.log('[webrtc] iceConnectionState → %s', pc.iceConnectionState);
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
