/**
 * WebRTC peer connection manager — Alpha Chat Sprint 23
 *
 * Gestisce:
 *  - RTCPeerConnection lifecycle
 *  - getUserMedia (audio/video)
 *  - ICE candidate collection
 *  - Stream management
 *
 * Non gestisce la segnalazione WS — quella è delegata a CallContext.
 */

export type CallType = "audio" | "video";

// STUN pubblico Google — gratuito, nessuna API key necessaria
const ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];

export async function getUserMedia(callType: CallType): Promise<MediaStream> {
  const constraints: MediaStreamConstraints =
    callType === "video"
      ? { audio: true, video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" } }
      : { audio: true, video: false };
  return navigator.mediaDevices.getUserMedia(constraints);
}

export function createPeerConnection(
  onIceCandidate: (candidate: RTCIceCandidate) => void,
  onRemoteStream: (stream: MediaStream) => void,
  onConnectionStateChange: (state: RTCPeerConnectionState) => void,
): RTCPeerConnection {
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

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

  return pc;
}

export function addTracksToPC(pc: RTCPeerConnection, stream: MediaStream): void {
  stream.getTracks().forEach((track) => pc.addTrack(track, stream));
}

export function closePeerConnection(pc: RTCPeerConnection | null, stream: MediaStream | null): void {
  if (stream) {
    stream.getTracks().forEach((t) => t.stop());
  }
  if (pc) {
    pc.onicecandidate = null;
    pc.ontrack = null;
    pc.onconnectionstatechange = null;
    pc.close();
  }
}
