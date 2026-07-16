---
name: Sprint 16 Fase 1 — Signal Key Management
description: Decisioni architetturali, dipendenze, formato chiavi e punti aperti per le fasi successive
---

## Librerie installate (post-revisione architetturale)

**Backend (api-server):**
- `@signalapp/libsignal-client` v0.97.3 — Node.js native (AGPL-3.0-only). Mantenuto come relay infrastruttura; NON usato per operazioni crittografiche sui messaggi (Phases 1-5). Rivalutare in Phase 6 dopo verifica legale licenza.

**Frontend (alpha-chat-web):**
- `@workspace/libsignal-ts` — fork interno (packages/libsignal-ts/). Wrapper di `@privacyresearch/libsignal-protocol-typescript` v0.0.16 (versione CONGELATA — no auto-update).
- `idb` — wrapper tipizzato IndexedDB per storage chiavi private locali.

## Decisione architetturale (ADR-001)

- `@signalapp/libsignal-client` ha licenza AGPL-3.0-only (incompatibile con prodotto proprietario) e NON ha build WASM (confermato: rust/bridge/ = ffi, jni, node, shared — no wasm).
- Unica opzione browser senza crypto custom: `@privacyresearch/libsignal-protocol-typescript` v0.0.16.
- ADR completo: `docs/adr/ADR-001-signal-browser-crypto.md`.

## Formato chiavi (post-revisione — Signal-compatible)

| Chiave | Algoritmo | Byte | Formato server |
|---|---|---|---|
| Identity Key | Curve25519 XEdDSA | 33 (con 0x05 prefix) | base64 |
| Signed PreKey | Curve25519 DH | 32 | base64 |
| SPK Signature | XEdDSA | 64 | base64 |
| One-Time PreKey | Curve25519 DH | 32 | base64 |

Nota: @privacyresearch usa XEdDSA nativo via curve25519-typescript (WASM/asm.js). Non custom crypto.

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
