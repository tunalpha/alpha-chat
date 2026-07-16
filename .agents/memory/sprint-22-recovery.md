---
name: Sprint 22 — Account Recovery (Privacy First)
description: Recovery Card auto-generata alla registrazione, Recovery Page pubblica, dashboard impostazioni recovery.
---

## Design decisions
- `recovery_emergency_id` è SEPARATO da `emergency_id` (Phoenix Protocol). Due campi distinti su user.model.ts.
- Recovery Secret: 32 byte random → Base58 encode (lib/base58.ts senza dipendenze esterne) → hashed argon2id in DB, mai salvato in chiaro.
- `argon2.verify(hash, secret)` — NON passare ARGON2_OPTS come terzo argomento: il tipo è incompatibile con la firma TypeScript. argon2 lo auto-detecta dall'hash.
- `validate("body", Schema)` — signature corretta del middleware validate (target + schema), NON `validate({ body: Schema })`.
- `revokeAllSessions` è in `services/refresh-token.service`, NON in `repositories/session.repository`.
- `AppError` è in `errors/AppError`, NON in `lib/errors`.
- Email recovery: backend completo, invio email stubbed (token loggato in dev). Anti-enumeration: risposta sempre identica.
- Temp password: 20 chars, charset senza ambiguità (no 0/O/I/l/1), 15 min TTL, one-time.
- Recovery Card mostrata UNA SOLA VOLTA: `register()` in auth.service chiama `generateRecoveryCard()` e include `recovery_card` nella AuthResult. Il campo è opzionale (`recovery_card?`).
- LandingPage (NON AuthPage) è il punto d'ingresso auth: recovery card modal e link "Recupera account" sono in LandingPage.tsx.
- RecoveryPage è un overlay full-screen mostrato dentro LandingPage (state `showRecovery`), non una rotta separata.
- RecoverySettingsPage: si ottiene username da `useAuth().auth.username` per costruire RecoveryCardData con username incluso.

## Nuovi campi user.model.ts (11)
recovery_secret_hash, recovery_emergency_id, recovery_card_version, recovery_card_generated_at, recovery_email, recovery_email_token, recovery_email_token_expires_at, temp_password_hash, temp_password_expires_at, require_password_change, last_recovery_at.

## Nuovi audit event types (6)
RECOVERY_CARD_GENERATED, RECOVERY_CARD_REGENERATED, ACCOUNT_RECOVERED_CARD, ACCOUNT_RECOVERED_EMAIL, RECOVERY_EMAIL_SET, RECOVERY_EMAIL_REQUESTED.

## Routes montate
- `/auth/recover` → recoveryAuthRouter (public)
- `/account/recovery` → recoveryAccountRouter (authenticated)

## Test count dopo Sprint 22
261 test totali (15 file).

**Why:** `require_password_change` enforcement lato frontend (forzare cambio password dopo login con temp_password) non è ancora implementato — è il prossimo step se richiesto.
