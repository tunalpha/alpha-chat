---
name: Call fixes batch 1
description: Stream leak in acceptCall, callee ring timeout, pending call re-delivery on WS reconnect, push.openCall handler
---

## Stream audio leak fix (acceptCall)
**Rule:** Assign `localStreamRef.current = stream` immediately after `await getUserMedia()`, before any subsequent `await`. If an exception fires between getUserMedia and the old assignment position (e.g. in loadIceConfig), cleanup() found localStreamRef=null and could not stop the track → iOS kept microphone open → "Vuoi interrompere registrazione vocale?" prompt.
**Why:** cleanup() calls `closePeerConnection(pcRef.current, localStreamRef.current)` — tracks only stopped if ref is non-null.

## Callee ring timeout (callState safety net)
**Rule:** When call.incoming is processed, set `callTimeoutRef.current = setTimeout(() => cleanup("missed"), 35_000)`. The caller's ring timeout fires at 30s → call.end → server → call.missed → cleanup("missed") clears callTimeoutRef. 35s is a safety net if call.missed is delayed or lost.
**Why:** Without this, if call.missed is dropped (WS reconnect window), callState stays "incoming" forever, silently blocking all subsequent call.incoming events via the `if (callState !== "idle") break` guard.
**How to apply:** Also add `clearCallTimeout()` at the start of acceptCall() to cancel the timeout when the user accepts.

## Pending call re-delivery on WS reconnect
**Rule:** On call.offer, store payload in WsManager.pendingCalls (35s TTL key=calleeId). On auth.ok (WS reconnect), getPendingCall(userId) → if found, safeSend(ws, { type: "call.incoming", payload }) to the new socket. Clear on call.answer, call.reject, call.end.
**Why:** iOS backgrounds app → WS dies → server sends call.incoming once (fails) → push notification → user taps → WS reconnects → server does NOT re-send call.incoming → modal never shows.
**How to apply:** push.openCall in App.tsx does nothing special; server re-delivery handles it.

## safeSend type cast for re-delivery
Use `as unknown as Parameters<typeof safeSend>[1]` when passing pendingCall (Record<string,unknown>) to safeSend with type "call.incoming" (discriminated union).
