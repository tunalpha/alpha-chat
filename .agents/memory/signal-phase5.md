---
name: Sprint 16 Fase 5 — Identity Verification
description: Safety Number, TOFU trust manager, QR, key-change banner, ChatPage integration
---

## Deliverables implementati

### Nuovi file
- `artifacts/alpha-chat-web/src/lib/signal/safety-number.ts`
  - `generateSafetyNumber(localId, localIKBase64, remoteId, remoteIKBase64)` → 60-char string via FingerprintGenerator(5200)
  - `formatSafetyNumber(raw)` → `string[][]` (4 righe × 3 gruppi di 5 cifre)
  - `safetyNumberToQRPayload(fp, me, them)` → `alphachat-verify:{fp}:{me}:{them}` (no URL, privacy)
- `artifacts/alpha-chat-web/src/lib/signal/trust-manager.ts`
  - IDB separato `alpha-chat-trust-v1:{myUserId}` per non toccare schema Signal
  - `TrustStatus`: `"unverified" | "verified" | "key_changed"`
  - `checkAndUpdateTrust(myUserId, myDeviceId, theirUserId)` → legge IK da SignalStore locale (zero API call)
  - `updateTrustFromBundle(myUserId, theirUserId, theirIKBase64)` → chiamato da ensureSession
  - `markVerified / acceptKeyChange` → cambiano stato in IDB
- `artifacts/alpha-chat-web/src/components/SafetyNumberModal.tsx`
  - QR via `qrcode.toDataURL` (dark=#ffffff, light=#1e2030 per tema scuro)
  - Tab Numero/QR; badge trust status; warning cambio chiave

### File modificati
- `key-store.ts` → aggiunto `getRemoteIdentityKey(identifier)`:
  - Prova prima `identifier` (convenzione isTrustedIdentity), poi `identifier.1` (convenzione saveIdentity)
  - Copre entrambe le convenzioni della libreria Signal
- `signal-session.ts` → dopo `processPreKey` chiama `updateTrustFromBundle` (non fatale)
- `index.ts` → export Fase 5 (generateSafetyNumber, formatSafetyNumber, getTrustRecord, checkAndUpdateTrust, markVerified, acceptKeyChange, updateTrustFromBundle, TrustStatus, TrustRecord)
- `ChatPage.tsx`:
  - Stato: `trustStatus`, `showSafetyModal`, `myIKBase64`, `theirIKBase64`
  - useEffect su `activeConvId` → `checkAndUpdateTrust` + legge IK locale
  - `ChatHeader` ora accetta `trustStatus` e `onOpenSafetyNumber`
  - Trust badge 🟢/🟡/🔴 nel header (cliccabile)
  - "Numero di sicurezza" nel menu (senza `soon`)
  - Key-change banner 🔴 con link "Verifica identità →"
  - `SafetyNumberModal` in fondo al JSX
- `index.css` → stili per `.trust-badge-btn`, `.key-change-banner`, `.sn-modal`, `.sn-grid`, `.sn-group`, `.sn-qr-*`, ecc.
- `packages/signal-interop-tests/src/tests/18-trust-e2e.test.ts` → 26 test (7 suite)

### Test 18 — suite
- 18.1 Safety Number simmetrico, stabile (100 msg), specifico per coppia
- 18.2 QR payload deterministico, diverso per coppie diverse
- 18.3 TOFU Signal: prima sessione accettata, stessa chiave ancora fidata
- 18.4 Cambio IK rilevato: isTrustedIdentity=false, FP diverge, rivalidazione manuale funziona
- 18.5 MITM simulation: FP Alice≠FP Bob quando Mallory sostituisce le chiavi
- 18.6 Multi-device: stessa IK → stesso FP; IK diversa → FP diverso (rilevabile)
- 18.7 Ciclo E2E: TOFU → verifica → cambio IK → rilevazione → rivalidazione manuale

## Decisioni architetturali

**Why IDB separato per trust:**
Evita migration dello schema Signal IDB (`alpha-chat-signal-v2`). Nessun version bump, zero rischio per utenti esistenti.

**Why dual-key lookup in getRemoteIdentityKey:**
- `isTrustedIdentity` usa `remoteAddress.name` (solo userId) per la scrittura TOFU
- `saveIdentity` usa `encodedAddress` (userId.deviceId) per altri path
- Tentare entrambi è l'unico modo safe senza modificare la libreria Signal

**Why trust check on send path (updateTrustFromBundle in ensureSession):**
Rileva il cambio chiave nel momento in cui una nuova sessione X3DH viene stabilita, senza consumare OTPK extra (il bundle è già fetchato).

**Why trust check on conversation open (checkAndUpdateTrust in ChatPage):**
Legge la IK già in IDB locale (zero API) per aggiornare l'UI subito all'apertura.

**Why 17.1.2 accetta 200 o 201:**
AbortController non garantisce che il server non abbia scritto prima dell'abort. 
- 201 → abort precede la scrittura (ideale)
- 200 → server ha completato prima dell'abort → idempotenza corretta
Entrambi sono comportamenti validi; il test testava troppo rigidamente il timing.

## Stato finale
- TypeScript: 0 errori
- Suite: 182/182 verde (18 file test)
- `qrcode@^1.5.4` già presente in package.json
