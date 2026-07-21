---
name: Sprint 29 — Cloudflare R2 Object Storage + Monitoring Center
description: Migrazione da MongoDB binary a R2 per tutti i file media. R2 Monitoring Center con 10 tab + StatusBar + Cost Forecast con prezzi configurabili.
---

# Sprint 29 — Cloudflare R2 + Monitoring Center

## Segreti R2 — TUTTI IMPOSTATI ✓
R2_ACCOUNT_ID, R2_BUCKET, R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY

## Architettura core (decisioni chiave)
- R2 PRIMA, MongoDB DOPO; se MongoDB fallisce → rollback delete R2
- `ciphertextSize` (non `size`) — server archivia blob cifrati
- `encryptionVersion: 1` = AES-256-GCM; HEAD prima di DELETE
- Signed URL TTL configurabile (default 300s = 5 min)
- Multipart/form-data stream (non base64 JSON), campo "file"
- Limit multer: 100MB; per-tipo validazione in storage.service

## Schedulers attivi
- `temp-cleanup.scheduler.ts` — cleanup temp/ ogni ora
- `r2-health.scheduler.ts` — HeadObject ping ogni 5m → log in R2EventModel

## Modelli nuovi
- `r2-event.model.ts` — TTL 7 giorni, events: UPLOAD/SIGNED_URL/DELETE/CLEANUP/HEALTH_CHECK/CONSISTENCY
- `r2-pricing-config.model.ts` — singleton "default", prezzi Cloudflare 2025 precaricati, modificabili via PUT /admin/r2/pricing

## Event logging in storage.service
- `logR2Event()` fire-and-forget su ogni operazione R2
- uploadFile: passa uploaderId/conversationId/filename da media.service

## Route /admin/r2/*
- GET /r2/dashboard — 60s cache, pricing dinamica da DB, cost forecast + forecast 30/90/365d
- GET /r2/health — ping + consecutive_errors + last_auto_check da R2EventModel
- GET /r2/encryption — audit AES-256-GCM: versioni, sha256 mancanti, verdict
- GET /r2/top-users — top 20 utenti per ciphertextSize con breakdown foto/video/audio
- GET /r2/activity — ultimi 50 eventi R2 (polling 3s frontend)
- GET /r2/errors — ultimi 50 errori R2 (polling 10s frontend)
- GET /r2/pricing — leggi config prezzi
- PUT /r2/pricing — aggiorna prezzi (super_admin), invalida cache dashboard
- POST /r2/cleanup — cleanup manuale temp/
- POST /r2/consistency — verifica MongoDB ↔ R2

## Admin Panel — r2-monitor.tsx
10 tab + StatusBar sempre visibile in cima:
- StatusBar: 4 badge (Bucket Healthy/Warning/Offline · Encryption OK/Issues · Storage X/10 GB · Cost $X/mese o Free Tier)
- Overview, Bucket Health, Encryption Audit, File Search, Cleanup, Consistency, Top Users, Live Activity, Error Center, **Cost Forecast**

## Cost Forecast tab (pricing configurabile)
- Progress bar free tier (verde <80%, giallo 80-100%, rosso >100%)
- Banner warning se oltre il free tier
- Breakdown tabella: Storage/Class A/Class B/Egress/Totale con formule
- Forecast 30d/90d/365d (trend da ultimi 7 gg di growth_30d)
- Editor prezzi in-page (solo super_admin): modifica e salva senza deploy → invalida cache 60s

**Why:** Cache 60s obbligatoria — 6 aggregazioni MongoDB in parallelo per singola request dashboard.
**Why:** R2PricingConfigModel singleton (id="default") aggiornato con upsert, non insert.
