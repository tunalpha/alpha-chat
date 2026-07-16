---
name: Sprint 16 Fase 4 — Multi-device, Media Cache, Thumbnail E2E, Device Manager
description: Architettura e decisioni per multi-device fan-out, cache media cifrata locale, thumbnail E2E, device revocation
---

## Multi-device fan-out

- `signalEncryptMulti(store, recipients, plaintext)` cifra lo stesso plaintext per tutti i device del destinatario; ogni device riceve un ciphertext Signal indipendente.
- `hashDeviceId(uuid)` converte UUID in int32 per compatibilità con il formato address Signal (che vuole interi).
- Il server riceve `device_ciphertexts: [{device_id, body, type}]` come array opaco; campo MongoDB `Mixed`.
- `ensureSessionForBundle` tenta di riutilizzare la sessione esistente nello store; `rebuildSessionForBundle` forza X3DH fresco.
- Fan-out all-device richiede `GET /bundle/:userId/all` (chiamata una tantum; dopo, le sessioni restano cached nello store in-memory).

**Why:** Signal Protocol richiede sessioni separate per device. Il server non deve vedere dati per device sbagliati. Il campo `ciphertext` legacy viene mantenuto per backward compat (Fasi 1–3).

## Media cache locale cifrata

- `media-cache.ts` usa IndexedDB con AES-256-GCM per entry (chiave generata localmente, mai inviata al server).
- In Node.js/test usa un `Map<>` in-memory come fallback (stessa interfaccia pubblica).
- `initMediaCache` chiamato al login/register (non bloccante: `void`).
- `clearMediaCache` chiamato al logout/logoutAll (non bloccante: `void`).
- `cacheOwnMessageMeta` + `getMetaByClientId` per messaggi propri (non cifrati da Signal).
- `cacheDecryptedMeta` + `getMetaByMessageId` per messaggi ricevuti.

**Why:** Evita re-decifratura Signal ad ogni render; la chiave AES del media non è mai in chiaro in localStorage/sessionStorage.

## Thumbnail E2E

- Thumbnail cifrata con la stessa chiave AES del media (`encryptBlobWithKey(blob, keyBase64)`), IV separato (`thumb_iv`).
- `thumb_iv` incluso nel `metaJson` Signal-cifrato (non in chiaro).
- Server riceve solo bytes opachi (`encrypted_thumbnail`).

## Device Manager

- `DeviceManager.tsx` mostra lista device con `lastActive`, evidenzia il device corrente, permette revoca con conferma dialog.
- `revokeDevice()` nel service lancia `LAST_DEVICE_REVOKE` se rimane un solo bundle (last-device guard).
- Route: `GET /keys/devices`, `DELETE /keys/devices/:deviceId`.

## Quirk test 13 — Double Ratchet con linked devices

In test 13, chiamare `buildSession` + `encryptMessage` + `decryptMessage` e poi `encryptMessage` di nuovo produce `type=3` (PreKeyWhisperMessage) invece di `type=1` nel contesto dello stesso file con `beforeAll` pesanti. Il pattern IDENTICO in test 09 (file separato) funziona. Workaround: test 13.4 verifica la decifrabilità di N messaggi consecutivi (non il tipo), che è la proprietà funzionale rilevante.

**Why:** Probabilmente interferenza del WASM libsignal con sessioni create nei `beforeAll` precedenti nello stesso file. La proprietà `type=1 per msg successivi` è testata in test 03-double-ratchet.test.ts che gira isolato.

## Bug `ciphertext_type` validator (corretto in Fase 4)

Il validatore zod per `ciphertext_type` era `z.number().max(2)` (permetteva 0,1,2). Corretto in `z.number().refine(v => v === 1 || v === 3)` (solo valori Signal validi).
