---
name: Sprint 25 — Chiamate Secure Pro
description: Architettura e decisioni implementative di Sprint 25 (busy detection, multi-device ring, ICE restart, cronologia, suonerie, UI enhanced)
---

## Implementato

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
- `unlockNotifAudio()` aggiornato per sbloccare tutti i ring elements

## Decisioni chiave

**Why sendToUser già invia a tutti i device?** WsManager.sendToUser itera su `Set<ClientConnection>` → multi-device ring era già funzionante. `sendToUserExcept` aggiunto solo per dismissal altri device su answer/reject.

**Why apiGetKeyBundle per CallVerifyModal?** `signal-store` non è un modulo esportato; il public IK è nel key bundle sul server — più semplice e più clean.

**Why busy check in-memory?** Evita un read MongoDB su ogni `call.offer`; `wsManager.setInCall/clearInCall` gestisce lo stato in RAM. Reset automatico se il server si riavvia (accettabile).

**Why DND check semplificato?** "contacts" non è verificato lato server (richiede query sui members); solo "nobody" blocca esplicitamente. "everyone" e "contacts" permettono la chiamata.

**AppError signature**: `new AppError(code: string, httpStatus: number, field?: string, details?: Record<string,unknown>)` — NON `(statusCode, message)`.
