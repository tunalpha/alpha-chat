/**
 * CallContext — Global WebRTC call state — Sprint 23/24/25
 *
 * Sprint 25 additions:
 * - ICE restart automatico su disconnessione (riconnessione intelligente)
 * - Camera switch frontale/posteriore senza ricreare il PC
 * - isBusy state per "Utente occupato" UI
 * - isReconnecting state + overlay
 * - callEndReason per cronologia chiamate
 * - Log chiamata a backend al termine
 */

import {
  createContext, useContext, useRef, useState, useCallback,
  type ReactNode,
} from "react";
import {
  getUserMedia, createPeerConnection, addTracksToPC,
  closePeerConnection, switchCameraTrack,
  type CallType, type FacingMode,
} from "../lib/webrtc";
import { apiLogCall } from "../lib/api";

// ── Tipi ─────────────────────────────────────────────────────────────────────

export type CallState = "idle" | "calling" | "incoming" | "active";
export type CallEndReason = "normal" | "missed" | "declined" | "failed" | "busy" | "cancelled" | "reconnect_failed";

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
  callDuration: number;
  isMuted: boolean;
  isCameraOff: boolean;
  isSpeaker: boolean;
  isBusy: boolean;
  isReconnecting: boolean;
  facingMode: FacingMode;
  /** RTCPeerConnection esposto per getStats() in ActiveCallScreen */
  peerConnection: RTCPeerConnection | null;
  initiateCall: (toUserId: string, displayName: string, type: CallType) => Promise<void>;
  acceptCall: () => Promise<void>;
  rejectCall: () => void;
  endCall: () => void;
  toggleMute: () => void;
  toggleCamera: () => void;
  toggleSpeaker: () => void;
  switchCamera: () => Promise<void>;
  dismissBusy: () => void;
  setWsSend: (fn: (msg: object) => void) => void;
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
  const [callState, setCallState]             = useState<CallState>("idle");
  const [callType, setCallType]               = useState<CallType | null>(null);
  const [remoteUserId, setRemoteUserId]       = useState<string | null>(null);
  const [remoteDisplayName, setRemoteDisplayName] = useState<string | null>(null);
  const [localStream, setLocalStream]         = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream]       = useState<MediaStream | null>(null);
  const [incomingCall, setIncomingCall]       = useState<IncomingCallInfo | null>(null);
  const [callDuration, setCallDuration]       = useState(0);
  const [isMuted, setIsMuted]                 = useState(false);
  const [isCameraOff, setIsCameraOff]         = useState(false);
  const [isSpeaker, setIsSpeaker]             = useState(false);
  const [isBusy, setIsBusy]                   = useState(false);
  const [isReconnecting, setIsReconnecting]   = useState(false);
  const [facingMode, setFacingMode]           = useState<FacingMode>("user");
  const [peerConnection, setPeerConnection]   = useState<RTCPeerConnection | null>(null);

  const pcRef              = useRef<RTCPeerConnection | null>(null);
  const localStreamRef     = useRef<MediaStream | null>(null);
  const wsSendRef          = useRef<((msg: object) => void) | null>(null);
  const timerRef           = useRef<ReturnType<typeof setInterval> | null>(null);
  const callTimeoutRef     = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const callStartedAtRef   = useRef<Date | null>(null);
  const callAnsweredAtRef  = useRef<Date | null>(null);
  const callRoleRef        = useRef<"caller" | "callee">("caller");
  const peerIdRef          = useRef<string | null>(null);
  const callTypeRef        = useRef<CallType | null>(null);

  // ── Helpers ────────────────────────────────────────────────────────────

  const setWsSend = useCallback((fn: (msg: object) => void) => {
    wsSendRef.current = fn;
  }, []);

  function wsSend(msg: object) {
    wsSendRef.current?.(msg);
  }

  function startDurationTimer() {
    timerRef.current = setInterval(() => setCallDuration((d) => d + 1), 1000);
  }

  function stopDurationTimer() {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  }

  function clearCallTimeout() {
    if (callTimeoutRef.current) { clearTimeout(callTimeoutRef.current); callTimeoutRef.current = null; }
  }

  function clearReconnectTimer() {
    if (reconnectTimerRef.current) { clearTimeout(reconnectTimerRef.current); reconnectTimerRef.current = null; }
  }

  /** Logga la chiamata al backend. Non critico — fallisce silenziosamente. */
  async function logCall(status: CallEndReason, endedAt: Date) {
    const peerId   = peerIdRef.current;
    const cType    = callTypeRef.current;
    const startAt  = callStartedAtRef.current;
    if (!peerId || !cType || !startAt) return;
    const apiStatus =
      status === "normal"            ? "completed" :
      status === "missed"            ? "missed"    :
      status === "declined"          ? "declined"  :
      status === "cancelled"         ? "cancelled" :
      status === "reconnect_failed"  ? "failed"    : "failed";
    const durationSec = callAnsweredAtRef.current
      ? Math.round((endedAt.getTime() - callAnsweredAtRef.current.getTime()) / 1000)
      : undefined;
    try {
      await apiLogCall({
        peer_id:      peerId,
        call_type:    cType,
        status:       apiStatus,
        started_at:   startAt.toISOString(),
        answered_at:  callAnsweredAtRef.current?.toISOString(),
        ended_at:     endedAt.toISOString(),
        duration_sec: durationSec,
        role:         callRoleRef.current,
      });
    } catch { /* non-critical */ }
  }

  function cleanup(reason: CallEndReason = "normal") {
    clearCallTimeout();
    clearReconnectTimer();
    stopDurationTimer();
    closePeerConnection(pcRef.current, localStreamRef.current);
    pcRef.current         = null;
    localStreamRef.current = null;
    const endedAt = new Date();
    void logCall(reason, endedAt);
    callStartedAtRef.current  = null;
    callAnsweredAtRef.current = null;
    peerIdRef.current         = null;
    callTypeRef.current       = null;
    setLocalStream(null);
    setRemoteStream(null);
    setPeerConnection(null);
    setCallState("idle");
    setCallType(null);
    setRemoteUserId(null);
    setRemoteDisplayName(null);
    setIncomingCall(null);
    setCallDuration(0);
    setIsMuted(false);
    setIsCameraOff(false);
    setIsSpeaker(false);
    setIsReconnecting(false);
    setFacingMode("user");
  }

  function buildPC(toUserId: string) {
    const pc = createPeerConnection(
      (candidate) => {
        wsSend({ type: "call.ice_candidate", payload: { to_user_id: toUserId, candidate: candidate.toJSON() } });
      },
      (stream) => setRemoteStream(stream),
      (state) => {
        // connectionState change — failed/closed → cleanup
        if (state === "failed" || state === "closed") {
          if (isReconnecting) {
            // Già in riconnessione — abbandona
            cleanup("reconnect_failed");
          } else {
            cleanup("failed");
          }
        }
      },
      (iceState) => {
        // ICE connection state — riconnessione intelligente
        if (iceState === "disconnected") {
          setIsReconnecting(true);
          // Dopo 15s senza recupero → abbandona
          reconnectTimerRef.current = setTimeout(() => {
            cleanup("reconnect_failed");
          }, 15_000);
        } else if (iceState === "connected" || iceState === "completed") {
          setIsReconnecting(false);
          clearReconnectTimer();
        } else if (iceState === "failed") {
          cleanup("reconnect_failed");
        }
      },
    );
    pcRef.current = pc;
    setPeerConnection(pc);
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
      callStartedAtRef.current = new Date();
      callRoleRef.current      = "caller";
      peerIdRef.current        = toUserId;
      callTypeRef.current      = type;

      const pc = buildPC(toUserId);
      addTracksToPC(pc, stream);

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      wsSend({
        type: "call.offer",
        payload: { to_user_id: toUserId, sdp: offer, call_type: type, from_display_name: displayName },
      });

      // Timeout 30s — se nessuno risponde
      callTimeoutRef.current = setTimeout(() => {
        wsSend({ type: "call.end", payload: { to_user_id: toUserId, reason: "timeout" } });
        cleanup("missed");
      }, 30_000);

    } catch (err) {
      console.error("[Call] initiateCall error", err);
      cleanup("failed");
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

      callAnsweredAtRef.current = new Date();
      callRoleRef.current       = "callee";
      peerIdRef.current         = incomingCall.fromUserId;
      callTypeRef.current       = incomingCall.callType;
      if (!callStartedAtRef.current) callStartedAtRef.current = new Date();

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
      cleanup("failed");
    }
  }, [incomingCall]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Reject call ────────────────────────────────────────────────────────────

  const rejectCall = useCallback(() => {
    if (incomingCall) {
      wsSend({ type: "call.reject", payload: { to_user_id: incomingCall.fromUserId, reason: "declined" } });
    }
    cleanup("declined");
  }, [incomingCall]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── End call ───────────────────────────────────────────────────────────────

  const endCall = useCallback(() => {
    const peerId = peerIdRef.current ?? remoteUserId;
    if (peerId) wsSend({ type: "call.end", payload: { to_user_id: peerId } });
    cleanup("normal");
  }, [remoteUserId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Mute / Camera / Speaker ────────────────────────────────────────────────

  const toggleMute = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const enabled = !isMuted;
    stream.getAudioTracks().forEach((t) => { t.enabled = !enabled; });
    setIsMuted(enabled);
  }, [isMuted]);

  const toggleCamera = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const enabled = !isCameraOff;
    stream.getVideoTracks().forEach((t) => { t.enabled = !enabled; });
    setIsCameraOff(enabled);
  }, [isCameraOff]);

  const toggleSpeaker = useCallback(() => {
    setIsSpeaker((prev) => !prev);
  }, []);

  // ── Camera switch (front ↔ back) ───────────────────────────────────────────

  const switchCamera = useCallback(async () => {
    const pc = pcRef.current;
    const stream = localStreamRef.current;
    if (!pc || !stream) return;
    const result = await switchCameraTrack(pc, stream, facingMode);
    if (result) {
      setLocalStream(result.stream);
      setFacingMode(result.facing);
    }
  }, [facingMode]);

  const dismissBusy = useCallback(() => setIsBusy(false), []);

  // ── WS event handler ───────────────────────────────────────────────────────

  const handleWsCallEvent = useCallback((type: string, payload: Record<string, unknown>) => {
    switch (type) {
      case "call.incoming": {
        if (callState !== "idle") {
          // Già in chiamata — il server avrebbe già inviato call.busy; dismissiamo silenziosamente
          break;
        }
        callStartedAtRef.current = new Date();
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
        const pc = pcRef.current;
        if (!pc) return;
        clearCallTimeout();
        callAnsweredAtRef.current = new Date();
        pc.setRemoteDescription(new RTCSessionDescription(payload["sdp"] as RTCSessionDescriptionInit))
          .then(() => { setCallState("active"); startDurationTimer(); })
          .catch((e) => { console.error("[Call] setRemoteDescription answer error", e); cleanup("failed"); });
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
        cleanup("declined");
        break;
      }

      case "call.ended": {
        cleanup("normal");
        break;
      }

      case "call.busy": {
        // Cleanup senza loggare (non era ancora una vera chiamata)
        clearCallTimeout();
        closePeerConnection(pcRef.current, localStreamRef.current);
        pcRef.current = null;
        localStreamRef.current = null;
        setLocalStream(null);
        setRemoteStream(null);
        setPeerConnection(null);
        setCallState("idle");
        setCallType(null);
        setIncomingCall(null);
        setCallDuration(0);
        // Mostra UI "occupato"
        setIsBusy(true);
        break;
      }

      case "call.missed":
      case "call.ended_elsewhere": {
        // Altro device ha risposto o il caller ha annullato — dismetti squillo
        cleanup("missed");
        break;
      }
    }
  }, [callState]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <CallContext.Provider value={{
      callState, callType, remoteUserId, remoteDisplayName,
      localStream, remoteStream, incomingCall,
      callDuration, isMuted, isCameraOff, isSpeaker,
      isBusy, isReconnecting, facingMode, peerConnection,
      initiateCall, acceptCall, rejectCall, endCall,
      toggleMute, toggleCamera, toggleSpeaker, switchCamera, dismissBusy,
      setWsSend, handleWsCallEvent,
    }}>
      {children}
    </CallContext.Provider>
  );
}
