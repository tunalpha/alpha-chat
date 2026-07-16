/**
 * CallContext — Global WebRTC call state — Sprint 23
 *
 * Gestisce tutta la logica WebRTC + signaling WS per chiamate audio/video.
 * Montato una sola volta in App.tsx sopra la chat.
 */

import {
  createContext, useContext, useRef, useState, useCallback,
  type ReactNode,
} from "react";
import {
  getUserMedia, createPeerConnection, addTracksToPC,
  closePeerConnection, type CallType,
} from "../lib/webrtc";

// ── Tipi ─────────────────────────────────────────────────────────────────────

export type CallState = "idle" | "calling" | "incoming" | "active";

export interface IncomingCallInfo {
  fromUserId: string;
  fromDisplayName: string;
  sdp: RTCSessionDescriptionInit;
  callType: CallType;
}

interface CallContextValue {
  callState: CallState;
  callType: CallType | null;
  remoteUserId: string | null;
  remoteDisplayName: string | null;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  incomingCall: IncomingCallInfo | null;
  callDuration: number; // secondi
  isMuted: boolean;
  isCameraOff: boolean;
  /** Chiamato da ChatPage quando si clicca 📞/📹 */
  initiateCall: (toUserId: string, displayName: string, type: CallType) => Promise<void>;
  acceptCall: () => Promise<void>;
  rejectCall: () => void;
  endCall: () => void;
  toggleMute: () => void;
  toggleCamera: () => void;
  /** Chiamato da useWebSocket per iniettare il WS sender */
  setWsSend: (fn: (msg: object) => void) => void;
  /** Chiamato da App.tsx quando arrivano eventi WS relativi alle chiamate */
  handleWsCallEvent: (type: string, payload: Record<string, unknown>) => void;
}

// ── Context ───────────────────────────────────────────────────────────────────

const CallContext = createContext<CallContextValue | null>(null);

export function useCall(): CallContextValue {
  const ctx = useContext(CallContext);
  if (!ctx) throw new Error("useCall must be used within CallProvider");
  return ctx;
}

// ── Provider ──────────────────────────────────────────────────────────────────

export function CallProvider({ children }: { children: ReactNode }) {
  const [callState, setCallState] = useState<CallState>("idle");
  const [callType, setCallType] = useState<CallType | null>(null);
  const [remoteUserId, setRemoteUserId] = useState<string | null>(null);
  const [remoteDisplayName, setRemoteDisplayName] = useState<string | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [incomingCall, setIncomingCall] = useState<IncomingCallInfo | null>(null);
  const [callDuration, setCallDuration] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [isCameraOff, setIsCameraOff] = useState(false);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const wsSendRef = useRef<((msg: object) => void) | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const callTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Helpers ────────────────────────────────────────────────────────────────

  const setWsSend = useCallback((fn: (msg: object) => void) => {
    wsSendRef.current = fn;
  }, []);

  function wsSend(msg: object) {
    wsSendRef.current?.(msg);
  }

  function startDurationTimer() {
    timerRef.current = setInterval(() => setCallDuration((d) => d + 1), 1000);
  }

  function cleanup() {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (callTimeoutRef.current) { clearTimeout(callTimeoutRef.current); callTimeoutRef.current = null; }
    closePeerConnection(pcRef.current, localStreamRef.current);
    pcRef.current = null;
    localStreamRef.current = null;
    setLocalStream(null);
    setRemoteStream(null);
    setCallState("idle");
    setCallType(null);
    setRemoteUserId(null);
    setRemoteDisplayName(null);
    setIncomingCall(null);
    setCallDuration(0);
    setIsMuted(false);
    setIsCameraOff(false);
  }

  function buildPC(toUserId: string) {
    const pc = createPeerConnection(
      (candidate) => {
        wsSend({ type: "call.ice_candidate", payload: { to_user_id: toUserId, candidate: candidate.toJSON() } });
      },
      (stream) => setRemoteStream(stream),
      (state) => {
        if (state === "failed" || state === "disconnected" || state === "closed") {
          cleanup();
        }
      },
    );
    pcRef.current = pc;
    return pc;
  }

  // ── Initiate call (caller side) ────────────────────────────────────────────

  const initiateCall = useCallback(async (toUserId: string, displayName: string, type: CallType) => {
    if (callState !== "idle") return;
    try {
      const stream = await getUserMedia(type);
      localStreamRef.current = stream;
      setLocalStream(stream);
      setCallState("calling");
      setCallType(type);
      setRemoteUserId(toUserId);
      setRemoteDisplayName(displayName);

      const pc = buildPC(toUserId);
      addTracksToPC(pc, stream);

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      wsSend({
        type: "call.offer",
        payload: {
          to_user_id: toUserId,
          sdp: offer,
          call_type: type,
          from_display_name: displayName, // overridden by server with actual name
        },
      });

      // Timeout 30s se nessuna risposta
      callTimeoutRef.current = setTimeout(() => {
        wsSend({ type: "call.end", payload: { to_user_id: toUserId } });
        cleanup();
      }, 30_000);

    } catch (err) {
      console.error("[Call] initiateCall error", err);
      cleanup();
    }
  }, [callState]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Accept call (callee side) ──────────────────────────────────────────────

  const acceptCall = useCallback(async () => {
    if (!incomingCall) return;
    try {
      const stream = await getUserMedia(incomingCall.callType);
      localStreamRef.current = stream;
      setLocalStream(stream);

      const pc = buildPC(incomingCall.fromUserId);
      addTracksToPC(pc, stream);

      await pc.setRemoteDescription(new RTCSessionDescription(incomingCall.sdp));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      wsSend({
        type: "call.answer",
        payload: { to_user_id: incomingCall.fromUserId, sdp: answer },
      });

      setCallState("active");
      setCallType(incomingCall.callType);
      setRemoteUserId(incomingCall.fromUserId);
      setRemoteDisplayName(incomingCall.fromDisplayName);
      setIncomingCall(null);
      startDurationTimer();

    } catch (err) {
      console.error("[Call] acceptCall error", err);
      if (incomingCall) {
        wsSend({ type: "call.reject", payload: { to_user_id: incomingCall.fromUserId, reason: "error" } });
      }
      cleanup();
    }
  }, [incomingCall]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Reject call ────────────────────────────────────────────────────────────

  const rejectCall = useCallback(() => {
    if (incomingCall) {
      wsSend({ type: "call.reject", payload: { to_user_id: incomingCall.fromUserId, reason: "declined" } });
    }
    cleanup();
  }, [incomingCall]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── End call ───────────────────────────────────────────────────────────────

  const endCall = useCallback(() => {
    const toId = remoteUserId;
    cleanup();
    if (toId) wsSend({ type: "call.end", payload: { to_user_id: toId } });
  }, [remoteUserId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Toggle mute / camera ──────────────────────────────────────────────────

  const toggleMute = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    stream.getAudioTracks().forEach((t) => { t.enabled = !t.enabled; });
    setIsMuted((v) => !v);
  }, []);

  const toggleCamera = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    stream.getVideoTracks().forEach((t) => { t.enabled = !t.enabled; });
    setIsCameraOff((v) => !v);
  }, []);

  // ── Handle incoming WS call events ────────────────────────────────────────

  const handleWsCallEvent = useCallback((type: string, payload: Record<string, unknown>) => {
    switch (type) {
      case "call.incoming": {
        if (callState !== "idle") {
          // Già in chiamata → busy
          wsSend({ type: "call.reject", payload: { to_user_id: payload["from_user_id"], reason: "busy" } });
          return;
        }
        setIncomingCall({
          fromUserId:      payload["from_user_id"] as string,
          fromDisplayName: payload["from_display_name"] as string,
          sdp:             payload["sdp"] as RTCSessionDescriptionInit,
          callType:        (payload["call_type"] as CallType) ?? "audio",
        });
        setCallState("incoming");
        break;
      }

      case "call.answered": {
        // Caller riceve risposta
        const pc = pcRef.current;
        if (!pc) return;
        if (callTimeoutRef.current) { clearTimeout(callTimeoutRef.current); callTimeoutRef.current = null; }
        pc.setRemoteDescription(new RTCSessionDescription(payload["sdp"] as RTCSessionDescriptionInit))
          .then(() => {
            setCallState("active");
            startDurationTimer();
          })
          .catch((e) => { console.error("[Call] setRemoteDescription answer error", e); cleanup(); });
        break;
      }

      case "call.ice_candidate": {
        const pc = pcRef.current;
        if (!pc) return;
        pc.addIceCandidate(new RTCIceCandidate(payload["candidate"] as RTCIceCandidateInit))
          .catch((e) => console.warn("[Call] addIceCandidate error", e));
        break;
      }

      case "call.rejected": {
        cleanup();
        break;
      }

      case "call.ended": {
        cleanup();
        break;
      }

      case "call.busy": {
        cleanup();
        break;
      }
    }
  }, [callState]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <CallContext.Provider value={{
      callState, callType, remoteUserId, remoteDisplayName,
      localStream, remoteStream, incomingCall,
      callDuration, isMuted, isCameraOff,
      initiateCall, acceptCall, rejectCall, endCall,
      toggleMute, toggleCamera,
      setWsSend, handleWsCallEvent,
    }}>
      {children}
    </CallContext.Provider>
  );
}
