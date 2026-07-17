---
name: Sprint 21 Group E2E decrypt fix
description: Root cause and fix for group messages showing "Messaggio cifrato" for all receivers
---

## Bug 1 — race condition con conversations state

isGroupMsg usava `conversations.find(...)?.type === "group"` (React state).
Se conversations non era ancora caricato al momento della decifratura → isGroupMsg=false
→ path 1:1 cercava device_id===auth.deviceId ma nei gruppi device_id===auth.userId → not found
→ fallback su msg.ciphertext (placeholder btoa("_grp_")) → Signal error → "🔒 Messaggio cifrato".

**Fix**: rilevare gruppi dal contenuto di device_ciphertexts:
```js
const hasGroupStyleEntry = msg.device_ciphertexts?.some(d => d.device_id === auth.userId) ?? false;
const isGroupMsg = hasGroupStyleEntry || conversations.find(...)?.type === "group";
```

## Bug 2 — session tipo-1 senza sessione sul receiver

signalEncryptMulti riutilizza sessioni esistenti → tipo-1 (WhisperMessage).
Se receiver non ha la sessione in IDB (nuovo device / IDB pulito), tipo-1 fallisce.
Solo tipo-3 (PreKeyWhisperMessage) è self-contained (include parametri X3DH).

**Fix**: encryptForGroup passa `{ forceNewSession: true }` a signalEncryptMulti.
signalEncryptMulti con forceNewSession=true elimina la sessione prima di cifrare
→ garantisce tipo-3 per ogni messaggio di gruppo.

**Why**: gruppo meno frequente di 1:1; consumo OTPK accettabile per affidabilità.
Alternativa futura: tipo-1 + "session reset" notification al sender se tipo-1 fallisce.

## File modificati
- multi-device.ts: opzione forceNewSession in signalEncryptMulti
- ChatPage.tsx: fix isGroupMsg + forceNewSession:true in encryptForGroup
