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
  return navigator.mediaDevices.getUserMedia(constraints);
}

export function createPeerConnection(
  onIceCandidate: (candidate: RTCIceCandidate) => void,
  onRemoteStream: (stream: MediaStream) => void,
  onConnectionStateChange: (state: RTCPeerConnectionState) => void,
  onIceStateChange?: (state: RTCIceConnectionState) => void,
): RTCPeerConnection {
  const pc = new RTCPeerConnection({ iceServers: _iceServers });

  pc.onicecandidate = (e) => {
    if (e.candidate) onIceCandidate(e.candidate);
  };

  pc.ontrack = (e) => {
    if (e.streams && e.streams[0]) {
      onRemoteStream(e.streams[0]);
    }
  };

  pc.onconnectionstatechange = () => {
    onConnectionStateChange(pc.connectionState);
  };

  if (onIceStateChange) {
    pc.oniceconnectionstatechange = () => {
      onIceStateChange(pc.iceConnectionState);
    };
  }

  return pc;
}

export function addTracksToPC(pc: RTCPeerConnection, stream: MediaStream): void {
  stream.getTracks().forEach((track) => pc.addTrack(track, stream));
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
