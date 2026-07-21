---
name: Video callee race condition — ontrack before component mount
description: Video remoto nero su iOS per il callee; ontrack scatta prima che ActiveCallScreen monti.
---

## Il bug

Per il **callee** di una videochiamata:

1. `setRemoteDescription(offer)` → `ontrack` → `setRemoteStream(stream)` schedulato in React state
2. In quel momento `callState = "incoming"` → `ActiveCallScreen` non renderizza → `remoteVideoRef.current = null`
3. `useEffect([remoteStream])` scatta ma `video = null` → early exit, `srcObject` mai assegnato
4. Poi `setCallState("active")` + `setCallType("video")` → component monta, `<video>` monta
5. `remoteStream` non è cambiato → `useEffect([remoteStream])` NON ri-scatta → schermo nero permanente

## Fix

Aggiungere `callState` e `callType` alle dipendenze del `useEffect` che assegna `srcObject` al video remoto.
Con il guard `if (video.srcObject !== remoteStream)` per evitare riassegnazioni inutili.

```typescript
useEffect(() => {
  const video = remoteVideoRef.current;
  if (!video || !remoteStream) return;
  if (video.srcObject !== remoteStream) {
    video.srcObject = remoteStream;
  }
  void video.play().catch(() => {});
}, [remoteStream, callState, callType]); // callState/callType garantiscono re-fire al mount del <video>
```

**Why:** Il `<video>` remoto esiste nel DOM solo quando `isVideo && callState==="active"`. Se `remoteStream` arriva prima (via `ontrack`) e il `<video>` non è ancora montato, il ref è null. Senza `callState`/`callType` come dipendenze il effect non ri-scatta quando il `<video>` monta.

**How to apply:** Qualunque `useEffect` che accede a un `ref` condizionalmente renderizzato deve includere nelle dipendenze la condizione che governa il rendering del componente target.
