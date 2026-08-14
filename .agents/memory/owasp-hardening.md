---
name: OWASP Top 10 Hardening
description: Misure implementate e gap residui dopo l'audit OWASP Top 10 (agosto 2026)
---

# OWASP Top 10 — Stato dopo hardening

## Misure implementate

### A07 — Auth Rate Limiting (auth.routes.ts)
- Login: 10 req/15 min per IP, `skipSuccessfulRequests: true`
- Register: 5 req/ora per IP
- Refresh: 60 req/15 min per IP
- Change-temporary-password: 5 req/15 min per IP
- Account lockout DB-based già esistente in auth.service.ts (failed_login_attempts + locked_until)
- Audit log su LOGIN_FAILED e ACCOUNT_LOCKED già esistente

### DEP CVE-2026-69192 — ip-address (SSRF bypass)
- Fix via pnpm override in root package.json: `"ip-address": ">=10.3.1"`
- Versione installata: 10.5.0

### A07/A01 — broadcastLimiter IPv6 fix (alpha-wallet.routes.ts)
- keyGenerator usava req.ip come fallback → rimosso, ora usa solo userId
- standardHeaders: "draft-8"

### SAST — hardcoded MongoDB placeholder (db-manager)
- Placeholder cambiato da stringa URL-like a testo generico (falso positivo)

### HoundDog — username in stdout (idb-diagnostic.js)
- Username redactato con [REDACTED]

## Stato scanner post-fix
- DEP: 0 critical, 0 high (ip-address → 10.5.0)
- SAST: 0 critical, 0 high (placeholder rimosso)
- HoundDog: 0 critical, 0 high (username redactato)

## Già esistenti ✅
- Helmet (app.ts) con CSP in produzione
- CORS configurato con allowedOrigins
- argon2id per password
- JWT ES256 (asymmetric)
- authenticate middleware su tutte le route protette
- Zod validation su tutti gli endpoint pubblici
- GeoIP + ipHash per audit
- JTI blocklist per token revocation
- Signal E2E encryption (messaggi illeggibili anche per admin)

## Gap residui (non implementati in questo sprint)
- CSP reporting mode in dev (non critico)
- Body limit per-route su endpoint non-media (body limit globale 145MB per multer)
- Penetration test esterno / DAST scan (ZAP/Burp)
- HTTP security headers test con securityheaders.io
- Dependency audit automatizzato in CI

**Why:** Raccogliere in un unico file le decisioni per evitare di riauditare le stesse aree.
**How to apply:** Prima di aggiungere nuovi endpoint pubblici, verificare che abbiano rateLimit + validate middleware.
