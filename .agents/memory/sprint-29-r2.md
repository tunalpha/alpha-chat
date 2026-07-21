---
name: Sprint 29 — Cloudflare R2 Object Storage
description: Migrazione da MongoDB binary a R2 per tutti i file media. Architettura, decisioni, sequenza di deploy.
---

# Sprint 29 — Cloudflare R2 Object Storage

## Stato
Implementazione completa lato backend e frontend. Segreti R2 NON ancora impostati (richiesti ma non forniti dall'utente). Il backend gira in modalità stub (warn al boot, operazioni R2 falliscono).

## File nuovi
- `artifacts/api-server/src/lib/r2-client.ts` — S3Client per Cloudflare R2
- `artifacts/api-server/src/services/storage.service.ts` — uploadFile, deleteFile, getSignedDownloadUrl, cleanupTempObjects
- `artifacts/api-server/src/schedulers/temp-cleanup.scheduler.ts` — cleanup temp/ ogni ora

## File modificati (backend)
- `src/config/index.ts` — aggiunto r2 + upload config blocks
- `src/models/media.model.ts` — rimossi data:Buffer + thumbnail:Buffer; aggiunti storageKey, thumbnailKey, bucket, sha256, ciphertextSize, encryptionVersion, uploadedAt
- `src/validation/media.schemas.ts` — rimosso campo data base64; UploadMediaMetaSchema per multipart text fields; z.coerce per duration_ms; z.preprocess per waveform JSON string
- `src/repositories/media.repository.ts` — create() con nuovi parametri; topUploaders(), topConversations(), globalStats() per admin
- `src/services/media.service.ts` — upload R2-first → MongoDB → rollback; getMediaSignedUrl(); getThumbnailSignedUrl(); deleteMediaFiles() per Secure Destroy
- `src/controllers/media.controller.ts` — req.file da multer; download ritorna JSON con signed URL
- `src/routes/v1/media.routes.ts` — multer.single("file") sul POST; validate body (non data field)
- `src/services/message.service.ts` — usa deleteMediaFiles() (R2+MongoDB) invece di mediaRepo.hardDeleteById
- `src/index.ts` — avvia startTempCleanupScheduler()
- `src/routes/v1/admin.routes.ts` — /admin/storage ora include r2 stats (file_count, total_mb, top_uploaders, top_conversations)

## File modificati (frontend)
- `artifacts/alpha-chat-web/src/lib/api.ts`:
  - apiUploadMedia → FormData (era base64 JSON)
  - apiUploadEncryptedMedia → FormData
  - apiUploadFile → FormData
  - apiFetchMediaBlob → prima GET signed URL, poi fetch R2 diretto
  - apiFetchAndDecryptMediaBlob → prima GET signed URL, poi fetch R2 diretto
  - apiUploadGroupAvatar → fix localStorage.getItem("accessToken") → getAccessToken()

## Admin panel
- `artifacts/admin-panel/src/pages/storage.tsx` — aggiunta sezione R2 con card file_count, total_mb, avg size; tabelle top uploaders e top conversations

## Architettura (decisioni chiave)
- R2 PRIMA, MongoDB DOPO; se MongoDB fallisce → rollback delete R2
- `ciphertextSize` (non `size`) — server archivia blob cifrati
- `encryptionVersion: 1` = AES-256-GCM
- `uploadedAt` separato da createdAt
- HEAD prima di DELETE (evita errori su oggetti già assenti)
- Signed URL TTL configurabile via R2_SIGNED_URL_TTL (default 300s)
- Virus scan hook stub (disabilitato, punto estensione futuro)
- Multipart/form-data stream (non base64 JSON)
- Campo "file" nel multipart per tutti gli upload
- Limit multer: 100MB + 16B (max di tutti i tipi)
- Per-tipo validazione in storage.service (non nel multer limit)
- temp/ cleanup scheduler: ogni ora, elimina oggetti > 24h

## Segreti da impostare
R2_ACCOUNT_ID, R2_BUCKET, R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY
→ Endpoint formato: https://<ACCOUNT_ID>.r2.cloudflarestorage.com

**Why:** MongoDB non può contenere blob binari grandi (16MB limite BSON, performance). R2 è il tier di storage Cloudflare integrato con il piano.
**How to apply:** Per aggiungere nuovi tipi di media, aggiungere MIME al ALLOWED_MIMES set in storage.service.ts.
