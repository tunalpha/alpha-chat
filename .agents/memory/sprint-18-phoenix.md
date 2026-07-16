---
name: Sprint 18 — Phoenix Protocol
description: argon2id Phoenix Code, one-time email token, Lock Mode vs destroy, Emergency Portal /emergency, WS events
---

## Stato
Implementato e committato su branch `sprint-18-phoenix-protocol`. Tutti i test passano (58/58, tsc clean).

## Architettura

### Backend (api-server)
- `models/phoenix-token.model.ts` — token monouso (SHA-256, TTL 15min, TTL MongoDB index)
- `models/user.model.ts` — +`phoenix_code_hash` (argon2id), +`emergency_id` (XXXX-XXXX)
- `services/email.service.ts` — Nodemailer; se SMTP_HOST non configurato → console fallback (dev mode)
- `services/phoenix.service.ts` — 4 fasi: setup, initiate, validate, execute
- `routes/v1/phoenix.routes.ts` — monta su /api/v1/phoenix
- Rate limiting: initiate 5/15min, execute 3/1h

### AppError signature
`new AppError(code: string, httpStatus: number, field?, details?)` — NON prende message come 2° arg.

### validate middleware signature
`validate("body" | "query" | "params", zodSchema)` — NON `validate(z.object({body:...}))`.

### Distinzione critica Lock vs Destroy
- **Emergency Lock** (phoenix:lock WS): revoca sessioni + chiavi locali, account recuperabile
- **Phoenix Protocol** (phoenix:destroy WS): distrugge sessions, SignalKeyBundle, UserPrekeys, conversations, messages + anonimizza user; IRREVERSIBILE
- Il client deve ricevere il WS event PRIMA che il server esegua la delete (500ms delay)

### Frontend
- `pages/EmergencyPage.tsx` — accessibile SENZA auth su `/emergency` (rilevato da `window.location.pathname`)
- `pages/PhoenixSetupPage.tsx` — setup Phoenix Code (≥20 chars), Recovery Card, link portale
- `components/RecoveryCard.tsx` — QR via api.qrserver.com (nessuna dipendenza extra)
- App.tsx controlla `isEmergencyPath()` PRIMA del check auth
- ChatPage gestisce phoenix:lock (logout) e phoenix:destroy (localStorage.clear + logout)

### Email
- Variabili d'ambiente richieste: SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS, SMTP_FROM, PUBLIC_URL
- Senza SMTP_HOST → link stampato a console (dev), nessun errore

### Emergency ID format
Charset: `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (no O, I, 0, 1 ambigui). Formato: XXXX-XXXX.

**Why:** Anti-confusione visiva per utenti in stato di stress.

## Merge sequence
1. Audit Sprint 16 (Scenari B-E) → merge Sprint 16 → main
2. Commit Panic Mode fix già su sprint-18 (incluso nel branch) → merge Sprint 17 → main
3. Merge Sprint 18 → main
4. Deploy + smoke test in produzione
5. Configurare SMTP env vars in produzione prima del deploy

## Prossimi step aperti
- Audit Sprint 16 Scenari B-E (Playwright stabile)
- Configurare variabili SMTP in produzione (nodemailer)
- Considerare `emergency.alphachat.sbs` subdomain redirect → `/emergency`
