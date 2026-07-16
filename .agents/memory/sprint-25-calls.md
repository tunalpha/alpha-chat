---
name: Sprint 25 — Chiamate Secure Pro + bug fix persistenti
description: Architettura chiamate, busy detection, ICE restart, cronologia, suonerie, avatar fix, sessione E2E reset, archivio
---

## Sprint 25 — Chiamate Secure Pro (implementato)

### Backend
- **CallLogModel** (`artifacts/api-server/src/models/call-log.model.ts`): caller_id, callee_id, call_type, status, started_at/answered_at/ended_at/duration_sec
- **Routes** `GET /api/v1/calls/history`, `POST /api/v1/calls/log` — AppError usa `(code: string, statusCode: number)` (non `(statusCode, message)`)
- **WsManager** aggiornato: `sendToUserExcept(userId, excludeConn, event)`, `setInCall/clearInCall/isInCall`
- **ws-server**: busy check su `call.offer` (isInCall), DND su `allow_calls_from`, multi-device ring dismissal via `call.ended_elsewhere` su `call.answer`/`call.reject`, `call.missed` su `reason=timeout/cancelled`

### Frontend CallContext
- ICE restart: onIceStateChange → "disconnected" → isReconnecting=true + timer 15s → cleanup("reconnect_failed"); "connected" → clearReconnectTimer
- Camera switch: `switchCameraTrack(pc, stream, facingMode)` → replaceTrack sender, aggiorna localStream
- isBusy state: esposto per BusyCallScreen; dismissBusy() per resettarlo
- callStartedAt/callAnsweredAt/callRole per logCall() al backend al termine
- `logCall()` asincrono non bloccante, fallisce silenziosamente

### Frontend nuovi file
- `BusyCallScreen.tsx`: overlay occupato
- `CallVerifyModal.tsx`: usa `apiGetKeyBundle(userId)` per entrambi + `generateSafetyNumber(localId, localIK, remoteId, remoteIK)` + `markVerified`
- `CallHistoryPage.tsx`: GET /api/v1/calls/history
- `CallSettingsPage.tsx`: allow_calls_from + RINGTONES picker

### notifSound.ts suonerie
- `RINGTONES = ["classica", "digitale", "militare", "silenziosa"]`
- Tutti e tre i WAV generati sincronamente al module load
- `getRingtone()/setRingtone()` via localStorage key `alpha_ringtone`
- `startRing()` usa `_currentRingEl()` basato su preferenza; `stopRing()` ferma tutti
- `playRingPreview(id)` — loop=false, poi ripristina loop dopo 1.5s
- `unlockNotifAudio()` aggiornato per sbloccare tutti i ring elements + audio context

## Bug fix persistenti (dopo Sprint 25)

### [Messaggio non decifrabile] — Session Reset
**Root cause**: Signal WhisperMessage (tipo 1) non ha recovery automatico. Se la sessione IDB va persa (logout, altro device, IDB cleared), tutti i messaggi ricevuti successivi falliscono silenziosamente.

**Fix implementato**:
- `SignalProtocolStore.deleteSession(encodedAddress)` aggiunto a key-store.ts
- `resetAndRebuildSession(userId, deviceId, remoteUserId)` in signal-session.ts: cancella sessione corrotta + ricostruisce quella uscente con bundle fresco
- ChatPage.tsx: menu ⋮ → "Resetta sessione E2E" → toast "Invia un messaggio per confermare"

**Limite**: vecchi messaggi con "[Messaggio non decifrabile]" rimangono irrecuperabili (design E2E). Solo messaggi nuovi funzioneranno dopo il reset.

### Avatar non persistito al login
**Root cause**: `authResultToStored()` in AuthContext.tsx non includeva `avatar_url`. Avatar perso ad ogni login/refresh token.

**Fix**: `authResultToStored` include `avatarUrl: result.user.avatar_url ?? null`. `AuthUserProfile` interface aggiornata con `avatar_url?: string | null`. SidebarMenu mostra `<img>` se `avatarUrl` presente.

### Chiamate mute su iOS (audio context bloccato)
**Root cause**: `acceptCall()` e `initiateCall()` vengono chiamati asincronamente dopo il tap. iOS Safari blocca `HTMLMediaElement.play()` se non eseguito entro ~1s dal user gesture.

**Fix**: `unlockNotifAudio()` chiamato DENTRO l'onClick del pulsante Accetta (IncomingCallModal) e dei bottoni chiamata (ChatPage onCallAudio/onCallVideo). Sblocca il contesto audio iOS prima di tutto il resto.

### Archivio vuoto (no modo per archiviare)
**Root cause**: non c'era nessun handler long press/context menu sui conv-item nel sidebar. La funzione `archiveConversation()` esisteva in ArchivioPage.tsx ma non era collegata.

**Fix**: Long press 600ms + `onContextMenu` su ogni conv-item → action sheet bottom "Archivia conversazione" → chiama `archiveConversation(convId)`, rimuove dalla lista, mostra toast.

## Decisioni chiave

**Why sendToUser già invia a tutti i device?** WsManager.sendToUser itera su `Set<ClientConnection>` → multi-device ring era già funzionante. `sendToUserExcept` aggiunto solo per dismissal altri device su answer/reject.

**Why apiGetKeyBundle per CallVerifyModal?** `signal-store` non è un modulo esportato; il public IK è nel key bundle sul server — più semplice e più clean.

**Why busy check in-memory?** Evita un read MongoDB su ogni `call.offer`; `wsManager.setInCall/clearInCall` gestisce lo stato in RAM. Reset automatico se il server si riavvia (accettabile).

**AppError signature**: `new AppError(code: string, httpStatus: number, field?: string, details?: Record<string,unknown>)` — NON `(statusCode, message)`.

**Archivio in localStorage**: IDs archiviati in `alpha_archived_convs` — device-specific, non sincronizzato. Normale per una PWA offline-first.
