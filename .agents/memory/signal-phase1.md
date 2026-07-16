---
name: Sprint 16 Fase 1 — Signal Key Management
description: Decisioni architetturali, dipendenze, formato chiavi e punti aperti per le fasi successive
---

## Librerie installate

**Backend (api-server):**
- `@signalapp/libsignal-client` — Node.js native bindings. Installato e pronto per Fase 2 (X3DH session + firma verification). NON ancora usato in Fase 1 (solo infrastruttura key store).

**Frontend (alpha-chat-web):**
- `@noble/curves` v2.2.0 — Curve25519/Ed25519. Subpath import: `@noble/curves/ed25519.js` (con .js extension).
  - API: `ed25519.utils.randomSecretKey()` (NON randomPrivateKey — rinominata in v2)
  - `ed25519` e `x25519` sono nello STESSO modulo (`ed25519.js`)
- `idb` — wrapper tipizzato IndexedDB per storage chiavi private locali.

## Formato chiavi scelto

| Chiave | Algoritmo | Byte | Formato server |
|---|---|---|---|
| Identity Key | Ed25519 | 32 | base64 raw |
| Signed PreKey | X25519 | 32 | base64 raw |
| SPK Signature | Ed25519 sig | 64 | base64 raw |
| One-Time PreKey | X25519 | 32 | base64 raw |

Nota: Signal usa XEdDSA (Curve25519 → Ed25519 per signing). Noi usiamo Ed25519 separato per Fase 1. In Fase 2, con libsignal nel loop, valutare se allineare al formato XEdDSA nativo di Signal.

## API backend (tutti auth-protected)

```
POST /api/v1/keys/bundle              — upload bundle completo (post-login)
GET  /api/v1/keys/bundle/:userId      — fetch bundle per X3DH (pop atomico OTPK)
GET  /api/v1/keys/count               — livello OTPK corrente
POST /api/v1/keys/one-time-pre-keys   — rifornimento OTPK
PUT  /api/v1/keys/signed-pre-key      — rotazione SPK
```

## IndexedDB schema (DB: "alpha-chat-signal-v1")

- Store `identity` — keyed by userId
- Store `signed-pre-keys` — keyed by [userId, keyId], index byUser
- Store `one-time-pre-keys` — keyed by [userId, keyId], index byUser
- Store `metadata` — key pattern `${userId}:${field}` (registrationId, nextOtpkId)

## Integrazione nel login flow

`initSignalKeys(userId, deviceId)` chiamato in background (void, non bloccante) dopo login E registrazione in AuthContext.tsx. Idempotente: se le chiavi esistono, controlla solo il rifornimento OTPK.

`clearSignalKeys(userId)` chiamato al logout (pulizia IndexedDB).

## Punti aperti per Fase 2

1. **Verifica firma SPK lato server** — il server NON verifica ancora la firma della Signed PreKey contro l'Identity Key. Aggiungere in Fase 2 usando `@signalapp/libsignal-client` Node.js.
2. **Formato chiavi e XEdDSA** — valutare allineamento con libsignal key format (33 byte con 0x05 prefix per Public Keys) prima di Fase 2.
3. **SPK rotation** — il client non ruota ancora la Signed PreKey automaticamente (ogni ~settimana). Da aggiungere in Fase 2 o come hook periodico.
4. **OTPK exhaustion handling** — se il server non ha OTPKs per un utente, restituisce bundle senza OTPK. X3DH funziona ugualmente ma con minor forward secrecy. UI warning da aggiungere.

## Zero Plaintext Rule — verificata in Fase 1

- Il server riceve SOLO chiavi pubbliche (base64) e firma
- Le chiavi private rimangono esclusivamente in IndexedDB
- Nessun log, nessun plaintext nei payload
