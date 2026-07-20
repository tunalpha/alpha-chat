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
  closePeerConnection, switchCameraTrack, loadIceConfig,
  type CallType, type FacingMode,
} from "../lib/webrtc";
import {
  setRemoteStream as setRemoteAudioStream,
  setSpeakerMode,
  resetRemoteAudio,
  primeRemoteAudio,
} from "../lib/remoteAudio";
import { startRing, stopRing, startRingback, stopRingback, unlockNotifAudio } from "../lib/notifSound";
import { apiLogCall } from "../lib/api";
import { diagLog, diagLogger } from "../lib/diagnosticLogger";

// ── Tipi ─────────────────────────────────────────────────────────────────────

export type CallState = "idle" | "calling" | "incoming" | "active";
export type CallEndReason = "normal" | "missed" | "declined" | "failed" | "busy" | "cancelled" | "reconnect_failed";

export interface IncomingCallInfo {
  fromUserId: string;
  fromDisplayName: string;
  sdp: RTCSessionDescriptionInit;
  callType: CallType;
  /** Identificatore univoco della chiamata, generato dal caller (UUID v4). */
  callId: string;
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
  // Buffer ICE candidate ricevuti prima che il PC esista (callee non ha ancora premuto Accept).
  // Svuotato in buildPC() subito dopo la creazione del PC; azzerato in cleanup().
  const iceCandidateBufferRef = useRef<RTCIceCandidateInit[]>([]);
  const timerRef           = useRef<ReturnType<typeof setInterval> | null>(null);
  const callTimeoutRef     = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const callStartedAtRef   = useRef<Date | null>(null);
  const callAnsweredAtRef  = useRef<Date | null>(null);
  const callRoleRef        = useRef<"caller" | "callee">("caller");
  const peerIdRef          = useRef<string | null>(null);
  const callTypeRef        = useRef<CallType | null>(null);
  // Guard contro tap multipli sul verde: true mentre acceptCall() è in volo.
  const acceptingRef       = useRef<boolean>(false);
  /** Identificatore univoco della chiamata corrente (UUID v4).
   *  Generato dal caller in initiateCall(); copiato dal payload in call.incoming.
   *  Azzerato in cleanup(). Usato come chiave per dedup/ACK (M4/M2). */
  const callIdRef          = useRef<string>("");
  /** M3 — Timer ACK per call.offer: se l'ACK non arriva entro 2s → un solo retry. */
  const ackTimerRef        = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** M3 — true dopo il primo retry: impedisce un secondo retry automatico. */
  const retryAttemptedRef  = useRef<boolean>(false);
  /** M3 — Timestamp (ms) dell'invio originale di call.offer: usato per RTT nel log CALL_RETRY. */
  const offerSentAtRef     = useRef<number>(0);

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

  /** M3 — Cancella il timer ACK (chiamato all'arrivo di qualsiasi call.signal_ack o in cleanup). */
  function clearAckTimer() {
    if (ackTimerRef.current) { clearTimeout(ackTimerRef.current); ackTimerRef.current = null; }
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
    console.log('[Call] cleanup reason=%s', reason);
    diagLog('call.cleanup', { reason });
    diagLogger.clearCurrentCall();
    stopRing();     // ferma suoneria callee
    stopRingback(); // ferma ringback chiamante
    clearCallTimeout();
    clearReconnectTimer();
    stopDurationTimer();
    iceCandidateBufferRef.current = []; // azzera candidati bufferizzati pre-Accept
    closePeerConnection(pcRef.current, localStreamRef.current);
    pcRef.current         = null;
    localStreamRef.current = null;
    const endedAt = new Date();
    void logCall(reason, endedAt);
    callStartedAtRef.current  = null;
    callAnsweredAtRef.current = null;
    peerIdRef.current         = null;
    callTypeRef.current       = null;
    callIdRef.current         = "";
    // M3 — azzera stato retry
    clearAckTimer();
    retryAttemptedRef.current = false;
    offerSentAtRef.current    = 0;
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
    resetRemoteAudio(); // disconnette AudioContext e resetta routing
  }

  function buildPC(toUserId: string) {
    const pc = createPeerConnection(
      (candidate) => {
        wsSend({ type: "call.ice_candidate", payload: { to_user_id: toUserId, candidate: candidate.toJSON() } });
      },
      (stream) => {
        setRemoteStream(stream);        // React state → UI
        setRemoteAudioStream(stream);   // singleton <audio> element → audio reale
      },
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

    // Flush dei candidati ICE ricevuti prima che il PC esistesse (callee: arrivano
    // tra call.incoming e il click su Accept). Li applichiamo ora che il PC è pronto.
    const buffered = iceCandidateBufferRef.current.splice(0);
    if (buffered.length > 0) {
      console.log('[Call] buildPC: flush %d ICE candidates bufferizzati', buffered.length);
      for (const cand of buffered) {
        pc.addIceCandidate(new RTCIceCandidate(cand))
          .catch((e) => console.warn('[Call] addIceCandidate (buffered) error', e));
      }
    }

    return pc;
  }

  // ── Initiate call (caller side) ────────────────────────────────────────────

  const initiateCall = useCallback(async (toUserId: string, displayName: string, type: CallType) => {
    if (callState !== "idle") return;
    try {
      // iOS Safari: getUserMedia DEVE essere il primo await nel gesture context.
      // Ogni await che lo precede consuma il contesto e iOS può consegnare il
      // microfono in stato muto permanente per tutta la chiamata.
      const stream = await getUserMedia(type);
      localStreamRef.current = stream;
      setLocalStream(stream);

      // Imposta callState IMMEDIATAMENTE dopo getUserMedia, prima di loadIceConfig.
      // Senza questo, callState resta "idle" durante il fetch ICE → se l'utente tocca
      // nuovamente il pulsante chiama in quel momento, una seconda initiateCall parte.
      setCallState("calling");
      setCallType(type);
      setRemoteUserId(toUserId);
      setRemoteDisplayName(displayName);
      callStartedAtRef.current = new Date();
      callRoleRef.current      = "caller";
      peerIdRef.current        = toUserId;
      callTypeRef.current      = type;

      // ICE config dopo getUserMedia e dopo setCallState
      await loadIceConfig();

      // Imposta modalità audio iniziale: auricolare per chiamate vocali, speaker per video
      const defaultSpeaker = type === "video";
      setIsSpeaker(defaultSpeaker);
      setSpeakerMode(defaultSpeaker);

      // primeRemoteAudio: fire-and-forget DOPO getUserMedia.
      // iOS è ora in PlayAndRecord — l'<audio> element viene sbloccato nella
      // sessione audio corretta. Non await: il remote stream arriva più tardi
      // (ICE + negotiate), dando tempo sufficiente al priming di completarsi.
      void primeRemoteAudio().catch(() => {});

      // ── Ringback lato chiamante ───────────────────────────────────────────
      // Il chiamante sente un tono di ringback (425 Hz, 1s on/3s off) che indica
      // che il telefono del destinatario sta squillando — diverso dalla suoneria
      // personalizzata del callee (startRing) per evitare confusione.
      console.log('[Call] initiateCall → startRingback() per caller');
      void startRingback().catch(() => {});

      const pc = buildPC(toUserId);
      addTracksToPC(pc, stream);

      console.log('[Call] createOffer...');
      const offer = await pc.createOffer();
      console.log('[Call] setLocalDescription offer type=%s', offer.type);
      await pc.setLocalDescription(offer);

      // Genera call_id univoco per questa chiamata (M1 — prerequisito dedup/ACK).
      callIdRef.current         = crypto.randomUUID();
      offerSentAtRef.current    = Date.now();
      retryAttemptedRef.current = false;
      diagLogger.setCurrentCall(callIdRef.current, offerSentAtRef.current);

      const offerPayload = {
        to_user_id:        toUserId,
        sdp:               offer,
        call_type:         type,
        from_display_name: displayName,
        call_id:           callIdRef.current,
        sent_at:           offerSentAtRef.current,   // M3 — timestamp per RTT futuro
      };

      wsSend({ type: "call.offer", payload: offerPayload });
      console.log('[Call] call.offer inviato → call_id=%s sent_at=%d', callIdRef.current, offerSentAtRef.current);
      diagLog('call.offer.sent', { to: toUserId, call_type: type, call_id: callIdRef.current });

      // M3 — Timer ACK (2s): un solo retry automatico se call.signal_ack non arriva.
      // Cancellato immediatamente in handleWsCallEvent case "call.signal_ack" per
      // delivered=true (consegnato) E per delivered=false (server senza socket OPEN —
      // push/pendingCalls attivi, retry WS non utile).
      const capturedCallId = callIdRef.current;     // snapshot per guard nel closure
      const capturedSentAt = offerSentAtRef.current;
      ackTimerRef.current = setTimeout(() => {
        ackTimerRef.current = null;
        // Guard: stessa chiamata ancora attiva (callIdRef azzerato da cleanup o sostituito da nuova call)
        if (!callIdRef.current || callIdRef.current !== capturedCallId) return;
        if (retryAttemptedRef.current) return; // extra guard: mai un secondo retry
        retryAttemptedRef.current = true;
        const elapsed = Date.now() - capturedSentAt;
        console.warn('[CALL_RETRY] call_id=%s attempt=2 reason=no_ack elapsed=%dms', capturedCallId, elapsed);
        diagLog('call.offer.retry', { call_id: capturedCallId, elapsed_ms: elapsed });
        wsSend({ type: "call.offer", payload: { ...offerPayload, sent_at: Date.now() } });
        // Nessun nuovo ackTimer — un solo retry. Il 30s callTimeoutRef gestisce il cleanup finale.
      }, 2_000);

      // Timeout 30s — se nessuno risponde
      callTimeoutRef.current = setTimeout(() => {
        wsSend({ type: "call.end", payload: { to_user_id: toUserId, reason: "timeout", call_id: callIdRef.current } });
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
    // Guard anti-re-entry: blocca tap multipli sul verde prima che il primo completi.
    if (acceptingRef.current) {
      console.log('[DIAG-ACCEPT] acceptCall() IGNORATO — già in corso');
      return;
    }
    acceptingRef.current = true;
    // Annulla il timeout di squillo del callee (35s safety net in handleWsCallEvent).
    clearCallTimeout();
    console.log('[DIAG-ACCEPT] acceptCall() entered — callType=%s from=%s', incomingCall.callType, incomingCall.fromUserId);

    // ── Snapshot del call_id all'inizio del flusso ────────────────────────────
    // cleanup() può essere chiamato da un WS handler (call.ended / call.rejected)
    // mentre acceptCall() è sospeso a un await. Questo azzera callIdRef.current a ""
    // e chiama diagLogger.clearCurrentCall(), rendendo orfani tutti i diagLog
    // successivi (call_id: null → non appaiono nel Diagnostics Center filtrato per call).
    // Lo snapshot garantisce che:
    //   1. tutti i diagLog mantengano il call_id corretto indipendentemente da cleanup()
    //   2. call.answer e call.reject inviati con il call_id originale, non con ""
    const _acceptCallId = callIdRef.current;

    // ── Timeout totale di 15s su TUTTO il flusso acceptCall ────────────────────
    // Copre ogni singolo await: getUserMedia, primeRemoteAudio, loadIceConfig,
    // setRemoteDescription, createAnswer, setLocalDescription.
    // Su iOS qualsiasi step può bloccarsi per sessione audio in conflitto, rete
    // assente, o bug WebKit. Senza questo timeout il spinner gira per sempre.
    // [DIAG-ACCEPT] step tracker: aggiornato prima di ogni await, letto nel timeout
    let _currentStep = 0;
    let _stepStart   = Date.now();

    let totalTimeoutId: ReturnType<typeof setTimeout> | null = null;
    const totalTimeout = new Promise<never>((_, reject) => {
      totalTimeoutId = setTimeout(
        () => {
          const elapsed = Date.now() - _stepStart;
          console.error('[DIAG-ACCEPT] timeout 15s scattato — step bloccato: step=%d elapsed=%dms', _currentStep, elapsed);
          diagLog('accept.timeout', { step: _currentStep, elapsed_ms: elapsed }, _acceptCallId);
          reject(new Error(`[acceptCall] timeout 15s — step ${_currentStep} bloccato`));
        },
        15_000,
      );
    });
    // Helper: applica il timeout totale a qualsiasi promise
    // Nota: virgola dopo T necessaria in .tsx per disambiguare da JSX tag
    const raceTimeout = <T,>(p: Promise<T>): Promise<T> => Promise.race([p, totalTimeout]);

    try {
      // iOS Safari: getUserMedia DEVE venire prima di qualsiasi await di rete.
      // stopRing() è sync, quindi non consuma il gesture context.
      stopRing();

      _currentStep = 1; _stepStart = Date.now();
      console.log('[DIAG-ACCEPT] step 1 — getUserMedia()');
      const stream = await raceTimeout(getUserMedia(incomingCall.callType));
      console.log('[DIAG-ACCEPT] step 1 OK — tracks=%d elapsed=%dms', stream.getTracks().length, Date.now() - _stepStart);
      diagLog('accept.step', { step: 1, ok: true, elapsed_ms: Date.now() - _stepStart }, _acceptCallId);

      // FIX: assegna il ref IMMEDIATAMENTE dopo getUserMedia, prima di qualsiasi
      // await successivo. Se un'eccezione viene lanciata nei passi seguenti,
      // cleanup() trova localStreamRef non-null e chiama track.stop(), evitando
      // il leak del microfono che causa il prompt "Vuoi interrompere registrazione?"
      localStreamRef.current = stream;
      setLocalStream(stream);

      // getUserMedia OK → iOS è ora in sessione PlayAndRecord.
      void unlockNotifAudio().catch(() => {});

      _currentStep = 2; _stepStart = Date.now();
      console.log('[DIAG-ACCEPT] step 2 — primeRemoteAudio()');
      await raceTimeout(primeRemoteAudio().catch(() => {}));
      console.log('[DIAG-ACCEPT] step 2 OK elapsed=%dms', Date.now() - _stepStart);
      diagLog('accept.step', { step: 2, ok: true, elapsed_ms: Date.now() - _stepStart }, _acceptCallId);

      _currentStep = 3; _stepStart = Date.now();
      console.log('[DIAG-ACCEPT] step 3 — loadIceConfig()');
      await raceTimeout(loadIceConfig());
      console.log('[DIAG-ACCEPT] step 3 OK elapsed=%dms', Date.now() - _stepStart);
      diagLog('accept.step', { step: 3, ok: true, elapsed_ms: Date.now() - _stepStart }, _acceptCallId);

      _currentStep = 4; _stepStart = Date.now();
      console.log('[DIAG-ACCEPT] step 4 — buildPC + setRemoteDescription');
      const pc = buildPC(incomingCall.fromUserId);
      addTracksToPC(pc, stream);
      await raceTimeout(pc.setRemoteDescription(new RTCSessionDescription(incomingCall.sdp)));
      console.log('[DIAG-ACCEPT] step 4 OK elapsed=%dms', Date.now() - _stepStart);
      diagLog('accept.step', { step: 4, ok: true, elapsed_ms: Date.now() - _stepStart }, _acceptCallId);

      _currentStep = 5; _stepStart = Date.now();
      console.log('[DIAG-ACCEPT] step 5 — createAnswer');
      const answer = await raceTimeout(pc.createAnswer());
      console.log('[DIAG-ACCEPT] step 5 OK — type=%s elapsed=%dms', answer.type, Date.now() - _stepStart);
      diagLog('accept.step', { step: 5, ok: true, elapsed_ms: Date.now() - _stepStart }, _acceptCallId);

      _currentStep = 6; _stepStart = Date.now();
      console.log('[DIAG-ACCEPT] step 6 — setLocalDescription');
      await raceTimeout(pc.setLocalDescription(answer));
      console.log('[DIAG-ACCEPT] step 6 OK elapsed=%dms', Date.now() - _stepStart);
      diagLog('accept.step', { step: 6, ok: true, elapsed_ms: Date.now() - _stepStart }, _acceptCallId);

      _currentStep = 7;
      const wsReady = wsSendRef.current !== null;
      console.log('[DIAG-ACCEPT] step 7 — send call.answer → to=%s wsReady=%s callId=%s', incomingCall.fromUserId, wsReady, _acceptCallId);
      diagLog('accept.ws.ready', { wsReady, step: 7 }, _acceptCallId);
      wsSend({
        type: "call.answer",
        payload: { to_user_id: incomingCall.fromUserId, sdp: answer, call_id: _acceptCallId },
      });
      diagLog('call.answer.sent', { to: incomingCall.fromUserId, wsReady, call_id: _acceptCallId }, _acceptCallId);

      // Imposta modalità audio iniziale: auricolare per chiamate vocali, speaker per video
      const defaultSpeaker = incomingCall.callType === "video";
      setIsSpeaker(defaultSpeaker);
      setSpeakerMode(defaultSpeaker);

      callAnsweredAtRef.current = new Date();
      callRoleRef.current       = "callee";
      peerIdRef.current         = incomingCall.fromUserId;
      callTypeRef.current       = incomingCall.callType;
      if (!callStartedAtRef.current) callStartedAtRef.current = new Date();

      console.log('[DIAG-ACCEPT] callState = active');
      setCallState("active");
      setCallType(incomingCall.callType);
      setRemoteUserId(incomingCall.fromUserId);
      setRemoteDisplayName(incomingCall.fromDisplayName);
      setIncomingCall(null);
      diagLog('accept.complete', { call_id: _acceptCallId }, _acceptCallId);
      startDurationTimer();

    } catch (err) {
      console.error("[Call] acceptCall error —", err);
      diagLog('accept.error', {
        step:    _currentStep,
        name:    err instanceof Error ? err.name                       : 'unknown',
        message: err instanceof Error ? err.message                    : String(err),
        stack:   err instanceof Error ? (err.stack ?? '').slice(0, 500) : '',
      }, _acceptCallId);
      if (incomingCall) {
        wsSend({ type: "call.reject", payload: { to_user_id: incomingCall.fromUserId, reason: "error", call_id: _acceptCallId } });
      }
      cleanup("failed");
    } finally {
      if (totalTimeoutId !== null) clearTimeout(totalTimeoutId);
      acceptingRef.current = false;
    }
  }, [incomingCall]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Reject call ────────────────────────────────────────────────────────────

  const rejectCall = useCallback(() => {
    if (incomingCall) {
      wsSend({ type: "call.reject", payload: { to_user_id: incomingCall.fromUserId, reason: "declined", call_id: callIdRef.current } });
      diagLog('call.reject.sent', { to: incomingCall.fromUserId, call_id: callIdRef.current });
    }
    cleanup("declined");
  }, [incomingCall]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── End call ───────────────────────────────────────────────────────────────

  const endCall = useCallback(() => {
    const peerId = peerIdRef.current ?? remoteUserId;
    if (peerId) {
      wsSend({ type: "call.end", payload: { to_user_id: peerId, call_id: callIdRef.current } });
      diagLog('call.end.sent', { to: peerId, call_id: callIdRef.current });
    }
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
    setIsSpeaker((prev) => {
      const next = !prev;
      setSpeakerMode(next); // applica routing audio reale
      return next;
    });
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
        console.log('[DIAG-CP2] CallContext handleWsCallEvent: call.incoming, callState attuale=', callState);
        if (callState !== "idle") {
          // Già in chiamata — il server avrebbe già inviato call.busy; dismissiamo silenziosamente
          console.log('[DIAG-CP2] BLOCCATO: callState non è idle, setIncomingCall NON chiamato');
          break;
        }
        callStartedAtRef.current = new Date();
        console.log('[DIAG-CP2] setIncomingCall() in esecuzione, from=', payload["from_user_id"]);
        // Estrai e memorizza il call_id generato dal caller (M1).
        callIdRef.current = (payload["call_id"] as string | undefined) ?? crypto.randomUUID();
        diagLogger.setCurrentCall(callIdRef.current, callStartedAtRef.current?.getTime() ?? Date.now());
        diagLog('call.incoming.received', { from: payload["from_user_id"] as string, call_type: payload["call_type"] as string });
        setIncomingCall({
          fromUserId:      payload["from_user_id"] as string,
          fromDisplayName: payload["from_display_name"] as string,
          sdp:             payload["sdp"] as RTCSessionDescriptionInit,
          callType:        (payload["call_type"] as CallType) ?? "audio",
          callId:          callIdRef.current,
        });
        setCallState("incoming");
        // ── Suoneria lato callee ──────────────────────────────────────────────
        // Il callee sente la sua suoneria personalizzata (startRing) — diversa
        // dal ringback del caller (startRingback).
        console.log('[Call] call.incoming → startRing() per callee');
        void startRing().catch(() => {});
        // Safety net: se il callee non interagisce entro 35s, forza cleanup.
        // Il server invia call.missed al callee ~30s dopo l'offer (caller timeout);
        // i 5s extra servono da buffer per garantire che call.missed arrivi prima.
        // Se cleanup() viene già chiamato (pulsante premuto o call.missed/ended
        // arrivato), clearCallTimeout() azzera questo timer in anticipo.
        callTimeoutRef.current = setTimeout(() => { cleanup("missed"); }, 35_000);
        break;
      }

      case "call.answered": {
        const pc = pcRef.current;
        if (!pc) return;
        clearCallTimeout();
        stopRingback(); // callee ha risposto → stop ringback lato caller
        console.log('[Call] call.answered → stopRingback(), primeRemoteAudio(), setRemoteDescription');
        diagLog('call.answer.received', { call_id: payload["call_id"] as string | undefined ?? '' });
        callAnsweredAtRef.current = new Date();
        // Re-prime AudioContext nel contesto corrente (il caller è in ascolto attivo)
        void primeRemoteAudio().catch(() => {});
        pc.setRemoteDescription(new RTCSessionDescription(payload["sdp"] as RTCSessionDescriptionInit))
          .then(() => {
            console.log('[Call] setRemoteDescription answer OK → active');
            setCallState("active");
            startDurationTimer();
          })
          .catch((e) => { console.error("[Call] setRemoteDescription answer error", e); cleanup("failed"); });
        break;
      }

      case "call.ice_candidate": {
        const pc = pcRef.current;
        const cand = payload["candidate"] as RTCIceCandidateInit;
        if (!pc) {
          // PC non ancora creato (callee non ha ancora premuto Accept).
          // Bufferizza il candidato: verrà applicato in buildPC() appena il PC esiste.
          console.log('[Call] ice_candidate: PC non pronto — bufferizzato (%d in coda)',
            iceCandidateBufferRef.current.length + 1);
          iceCandidateBufferRef.current.push(cand);
          return;
        }
        pc.addIceCandidate(new RTCIceCandidate(cand))
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
        stopRing(); // utente occupato → stop squillo
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

      case "call.signal_ack": {
        // M3 — ACK di consegna dal server (M2) + logica retry (M3).
        const ackCallId = payload["call_id"]    as string | undefined;
        const eventType = payload["event_type"] as string | undefined;
        const delivered = payload["delivered"]  as boolean | undefined;

        // Solo call.offer gestito da M3; gli altri event_type sono solo diagnostici.
        if (eventType !== "call.offer" || ackCallId !== callIdRef.current) {
          console.log('[Call] call.signal_ack passthrough — call_id=%s event_type=%s delivered=%s', ackCallId, eventType, delivered);
          diagLog('call.signal_ack.passthrough', { call_id: ackCallId ?? '', event_type: eventType ?? '', delivered: delivered ?? null });
          break;
        }

        // Condizione 2: timer cancellato IMMEDIATAMENTE, sia per delivered=true che false.
        clearAckTimer();

        const rtt = offerSentAtRef.current ? Date.now() - offerSentAtRef.current : -1;

        if (delivered === true) {
          // Consegnato a ≥1 socket OPEN del callee — chiamata in corso normalmente.
          console.log('[Call] call.signal_ack delivered=true — call_id=%s rtt=%dms', ackCallId, rtt);
          diagLog('call.signal_ack', { delivered: true, call_id: ackCallId ?? '', rtt_ms: rtt });
        } else {
          // Condizione 3: delivered=false è già un ACK.
          // Il server ha ricevuto l'offer ma non aveva socket OPEN → push + pendingCalls attivi.
          // Non bisogna ritentare via WS; il 30s callTimeoutRef gestisce il cleanup se nessuno risponde.
          console.warn('[Call] call.signal_ack delivered=false — call_id=%s rtt=%dms; push/pendingCalls in corso, nessun retry WS', ackCallId, rtt);
          diagLog('call.signal_ack', { delivered: false, call_id: ackCallId ?? '', rtt_ms: rtt });
        }
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
