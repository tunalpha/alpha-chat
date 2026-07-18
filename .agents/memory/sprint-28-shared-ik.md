---
name: Sprint 28 — Shared Identity Key
description: Architettura e implementazione IK condivisa tra device. Fase 1 completata (server-side, retrocompatibile).
---

## Problema risolto
`isTrustedIdentity(userId, IK)` nella libreria Signal usa userId come chiave: se device diversi hanno IK diverse, il trust check fallisce dal 2° device in poi. La libreria non è modificabile.

## Soluzione scelta: Opzione B — IK cifrata sul server
- IK privata cifrata con `AES-256-GCM(wrap_key, IK.privKey)`
- `wrap_key = HKDF-SHA256(Argon2id(password, ik_salt), "alpha-chat-ik-wrap-v1", 32)`
- Server conserva blob opaco (60 byte: iv||ct||tag, base64) — mai la chiave privata
- `ik_salt` distinto dal sale password (sicurezza aggiuntiva)

## Invarianti post-migrazione
- Tutti i bundle `signal_key_bundles` dello stesso utente hanno la stessa `identity_key`
- `isTrustedIdentity` sempre true per device dello stesso utente
- Chiamate non impattate (WebRTC, nessun legame con Signal IK)

## Fase 1 completata — file modificati (server-side, retrocompatibili)
- `user.model.ts` — campi `encrypted_identity_key`, `ik_salt` (nullable, default null)
- `validation/auth.schemas.ts` — RegisterSchema + UpdateIdentityKeySchema + ChangeTempPasswordAuthSchema aggiornati
- `services/auth.service.ts` — register() salva blob, login() restituisce blob, updateIdentityKey() nuovo
- `services/account-recovery.service.ts` — changeTempPassword() accetta `newEncryptedIdentityKey`
- `controllers/auth.controller.ts` — passa new_encrypted_identity_key a changeTempPassword; nuovo handler updateIdentityKey
- `routes/v1/auth.routes.ts` — PATCH /auth/identity-key aggiunto
- `services/signal-key-bundle.service.ts` — IK consistency check con feature flag `SIGNAL_IK_CONSISTENCY_CHECK`
- `lib/audit.ts` — aggiunto evento IDENTITY_KEY_UPDATED

## Feature flag
`SIGNAL_IK_CONSISTENCY_CHECK=true` in env → rifiuta bundle con IK diversa da quella già registrata.
Tenere a `false` durante la migrazione. Attivare solo dopo migrazione completa di tutti gli utenti.

## Recovery Card — conseguenza obbligatoria
Recovery = IK reset (utente non conosce vecchia password → non può decriptare blob).
Il client in recovery genera nuova IK e chiama PATCH /auth/identity-key.
Safety Number cambia → key-change banner per i contatti (già implementato Sprint 16 Phase 5).

## Fase 2 completata — file modificati (client)
- `lib/signal/ik-crypto.ts` (NUOVO) — wrapIdentityKeyPair, unwrapIdentityKeyPair, generateAndWrapSharedIdentityKey (PBKDF2-SHA512 600k iter + AES-256-GCM, WebCrypto nativo)
- `lib/signal/key-manager.ts` — initSignalKeys(userId, deviceId, ikKeyPair?) e _firstTimeSetup accettano IK pre-risolta
- `lib/signal/index.ts` — export wrapIdentityKeyPair, unwrapIdentityKeyPair, generateAndWrapSharedIdentityKey
- `lib/api.ts` — AuthResult type con encrypted_identity_key/ik_salt; apiRegister invia blob; apiChangeTempPasswordAuth passa new_encrypted_identity_key; apiUpdateIdentityKey (PATCH /auth/identity-key) aggiunto
- `contexts/AuthContext.tsx` — login decifra IK dal blob (o migrazione lazy); register genera IK+blob prima della chiamata server

## Fasi successive
- Fase 3: migrazione lazy utenti esistenti (già implementata in AuthContext: blob null → generateAndWrapSharedIdentityKey + apiUpdateIdentityKey)
- Fase 4: attivare SIGNAL_IK_CONSISTENCY_CHECK, cleanup bundle incoerenti

## Note crittografia frontend
- PBKDF2-SHA512 scelto su Argon2id per evitare dipendenze WASM aggiuntive
- 600_000 iter = standard OWASP 2023 per PBKDF2-SHA512
- blob = iv(12) || AES-GCM(pubKey(32)||privKey(32)) || tag(16) = 92 byte → base64 124 char
- ik_salt 32 byte random, distinto dal sale password — in user.encrypted_identity_key + user.ik_salt

**Why:** il modello per-device-IK è incompatibile con la libreria Signal senza modificarla.
**How to apply:** mai attivare SIGNAL_IK_CONSISTENCY_CHECK prima che tutti gli utenti abbiano migrato.
