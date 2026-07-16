---
name: Sprint 21 — Gruppi E2E
description: Decisioni architetturali per il sistema di chat di gruppo E2E in Alpha Chat
---

## Fan-out Signal per gruppi

**Regola:** Per i messaggi di gruppo, si usa fan-out individuale (non Sender Key). Ogni membro riceve un ciphertext separato. Il ciphertext è memorizzato in `device_ciphertexts` con `device_id = recipientUserId` (non deviceId UUID).

**Why:** Semplice, compatibile con il modello esistente (nessuna modifica al MessageModel), funziona per gruppi ≤ 256.

**How to apply:** `encryptForGroup` in ChatPage.tsx chiama `signalEncryptMulti([bundle])` per ogni membro, poi sovrascrive `device_id = member.user_id`. Per il decrypt, cerca `device_id === auth.userId` *prima* della logica multi-device 1:1.

## signalEncrypt vs signalEncryptMulti per gruppo

**Regola:** Non usare `signalEncrypt(userId, deviceId, recipient, text, bundle)` — il 5° param è `recipientDeviceId: number`, non un bundle. Usare invece `signalEncryptMulti(userId, deviceId, recipient, text, [bundle])`.

**Why:** Errore TS2345 — `ApiReceivedKeyBundle` non assegnabile a `number`.

## ConversationRepository.create con name/description

**Regola:** I campi `name` e `description` del gruppo sono passati opzionalmente al `create()` del repository con spread condizionale (`...(params.name ? {...} : {})`).

**Why:** Il modello Mongoose non aveva i field tipizzati nel repository; aggiunto con optional params.

## AuditEventType — estensione

**Regola:** Nuovi eventi (es. `GROUP_*`) devono essere aggiunti all'union type in `artifacts/api-server/src/lib/audit.ts`.

**Why:** TS2322 se si usa un stringa non presente nell'union.

## GroupInfoPage — overlay in ChatPage, non view separata

**Regola:** GroupInfoPage è un overlay full-screen dentro ChatPage (state `showGroupInfo` + `groupInfoId`), non una view AppView separata con routing.

**Why:** Il tipo `AppView` non trasporta parametri extra (es. groupId); un overlay locale è più semplice e non richiede cambiare l'API di navigazione.

## findByIds — richiede ObjectId[]

**Regola:** `userRepo.findByIds()` accetta `mongoose.Types.ObjectId[]`. Convertire strings con `new mongoose.Types.ObjectId(id.toString())`.
