---
name: Sprint 16 Fase 3 — Media E2E + Bug Fix Upload + Idempotenza
description: AES-256-GCM per blob media, key wrapping Signal, pipeline upload/decrypt, fix HTTP 500, idempotenza upload

## Architettura Fase 3

### Primitiva crittografica
AES-256-GCM via Web Crypto API. IV 96-bit fresco per ogni file. GCM tag 128-bit per integrità.

### File creati
- `artifacts/alpha-chat-web/src/lib/signal/media-crypto.ts` — AES-256-GCM encrypt/decrypt
- `packages/signal-interop-tests/src/tests/12-media-e2e.test.ts` — 17 test
- `docs/zero-knowledge-audit-fase3.md` e `docs/performance-report-fase3.md`

### Nuovo pattern E2E media

1. `encryptMediaBlob(blob)` → `{ encryptedBlob, keyBase64, ivBase64 }`
2. `apiUploadEncryptedMedia(convId, encryptedBlob, mimeType, opts)` — upload blob opaco
3. `JSON.stringify({ e2e: true, type, media_id, key, iv, ... })` = metaJson
4. `signalEncrypt(metaJson)` = Signal ciphertext (chiave AES nel ciphertext, MAI in chiaro)
5. `apiSendMediaMessage(convId, mediaId, signal, clientMessageId)` — invia messaggio

### Download / decrypt

1. Signal decrypt → metaJson con `key` e `iv`
2. `apiFetchAndDecryptMediaBlob(mediaId, keyBase64, ivBase64, mimeType)` — download + AES decrypt → ObjectURL

### Compatibilità legacy

- `decodeVoiceMeta(text)` e `decodeMediaMeta(text)`: prova JSON.parse diretto (Fase 3), fallback a atob (legacy)
- `decryptSingleMsg`: per media da altri → Signal decrypt; se fallisce → raw ciphertext (legacy)
- `VoiceMessage` e `MediaMessage`: usano `apiFetchAndDecryptMediaBlob` se `encryptedKey+encryptedIv` presenti, altrimenti `apiFetchMediaBlob` (legacy)

### TypeScript fix
`Uint8Array<ArrayBufferLike>` non assegnabile a `BufferSource` in AES-GCM iv.
Fix: `{ name: "AES-GCM", iv: new Uint8Array(iv) }` — crea copia con ArrayBuffer.

### Secure Destroy (media)
- Componenti unmountano → ObjectURL revocato automaticamente
- `message.destroyed` WS handler: `decryptedTexts.delete(message_id)` → chiave AES rimossa dalla memoria
- Il blob cifrato sul server viene cancellato dalla server API (cascade)

### Limitazioni Fase 3
- Thumbnail NON cifrate (low-res, non contenuto completo) → Fase 4
- Propri media post-reload non decifrabili (sentCacheRef in-memory) → Fase 4 local store
- deviceId fisso 1 per destinatario → Fase 4 multi-device

**Why:** Il server deve essere zero-knowledge completo per il contenuto dei file,
non solo per i messaggi testuali. AES-256-GCM + Signal key wrapping è il pattern
standard Signal Protocol per i media attachment.
