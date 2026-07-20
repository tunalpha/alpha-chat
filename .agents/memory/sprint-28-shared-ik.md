---
name: Sprint 28 — Shared Identity Key
description: IK condivisa via blob AES-GCM sul server; bug serializzazione, bug controller recovery, bug migrazione lazy risolti; auto-cleanup hook; Phase 4 sequenza
---

## Bug critici trovati e risolti

### Bug 1 — ik-crypto.ts: serializzazione IK (pubKey 33B, non 32B)
- Signal pubKey è 33 byte (prefisso 0x05 + 32 raw Curve25519).
- Fix: `JSON.stringify({ pub: base64(pubKey), priv: base64(privKey) })` — nessun offset fisso.
- **Why:** libsignal-ts v0.0.16 valida `pubKey.byteLength === 33` in generateSignedPreKey.

### Bug 2 — account-recovery.controller.ts: `(req as any).auth` → `req.user`
- Tutti i gestori autenticati usavano `auth.userId` ma il middleware popola `req.user`.
- Causava INTERNAL_ERROR 500 su: /recovery/status, /recovery/email, /recovery/card/regenerate, /recovery/password.
- Fix: sostituito con `req.user!.userId` / `req.user!.deviceId`; passato deviceId a changeTempPassword.

### Bug 3 — AuthContext: migrazione lazy genera IK nuova anche se IDB ha già una IK
- `generateAndWrapSharedIdentityKey()` genera sempre una IK fresca → blob ≠ IDB IK esistente.
- Fix (AuthContext.tsx): controlla `store.getIdentityKeyPair()` prima della migrazione.
  - Se IDB ha IK esistente → `wrapIdentityKeyPair(existingIK, password)` → blob = IDB IK.
  - Se IDB vuoto → genera nuova IK (comportamento precedente).
- **Why:** il blob deve riflettere la IK che il device sta usando, non una IK mai vista.

### Bug 4 — key-manager.ts: device esistente non converge alla IK del blob
- `initSignalKeys` con blob IK: se `isInitialized() = true`, `_firstTimeSetup` era saltato.
- Il device continuava con l'IK vecchia in IDB, ignorando quella canonica del blob.
- Fix: se IDB inizializzato + blob IK presente + IDB IK ≠ blob IK → `store.clear()` + `_firstTimeSetup`.
- **Why:** il blob è la fonte di verità; i device devono convergere alla IK canonica.

---

## Auto-cleanup bundle stale (Phase 4, server-side)

**signal-key-bundle.repository.ts:** aggiunta `deleteBundlesByDeviceIds(userId, deviceIds)`.

**signal-key-bundle.service.ts:** `uploadKeyBundle` ora:
1. Fetcha sempre i bundle esistenti (era solo quando flag ON).
2. Con flag OFF: se l'utente ha blob IK E il nuovo bundle ha IK diversa → elimina bundle stale.
3. Con flag ON: rifiuta upload con IK inconsistente (comportamento invariato).
- **Why:** Marco/Alpha si auto-puliscono al prossimo login senza intervento manuale.

---

## Cleanup manuale eseguiti
- `rc2_rt0rns`: eliminato bundle pre-recovery (device a2d4fa92, IK Bbk0WDx6…).
- Marco/Alpha: non toccati — si auto-puliranno al prossimo login tramite hook server-side.

---

## Architettura finale Sprint 28

- `ik-crypto.ts`: wrap/unwrap JSON+base64, PBKDF2-SHA512 600k + AES-256-GCM
- `AuthContext.login()`: decifra blob → passa IK a initSignalKeys; migrazione lazy usa IDB IK
- `key-manager.initSignalKeys()`: convergenza se IDB IK ≠ blob IK
- `uploadKeyBundle`: auto-cleanup stale quando user ha blob + nuova IK diversa
- Feature flag `SIGNAL_IK_CONSISTENCY_CHECK=false` (Phase 4 da attivare dopo verifica Marco/Alpha)

---

## Prerequisiti Phase 4 — stato

| Step | Stato |
|------|-------|
| 1. Fix migrazione lazy (Bug 3+4) | ✅ implementato |
| 2. Hook auto-cleanup server-side | ✅ implementato |
| 3. Cleanup bundle stale rc2_rt0rns | ✅ eseguito |
| 4. Verifica Marco/Alpha al prossimo login | 🔲 da monitorare |
| 5. Attivare SIGNAL_IK_CONSISTENCY_CHECK=true | 🔲 dopo step 4 |

---

## Sequenza Phase 4 (da eseguire)
1. Monitorare il DB dopo il login di Marco e Alpha.
2. Verificare che abbiano esattamente 1 bundle con IK canonica (stale eliminati dall'hook).
3. Attivare la flag: `SIGNAL_IK_CONSISTENCY_CHECK=true` nell'env del server.
4. Verificare che un tentativo di upload con IK diversa restituisca 409.

---

---

## Bug 5+6 — Decrypt-null e encrypt "Identity key changed" post-convergenza

Trovati in produzione dopo la convergenza IK di Alpha (Fix 2 attivato).

### Bug 5 — `signalDecryptFromDeviceCiphertexts`: IK stale causa decrypt-null su tipo-3
- Alpha converge a nuova IK (BdsScZI1…); il trust store di Cricco ha ancora la vecchia (Bctwuflj…).
- `decryptPreKeyWhisperMessage` → `isTrustedIdentity(alpha_id, nuovaIK)` → mismatch → eccezione → null.
- Fix (`multi-device.ts`): se tipo-3 e "Identity key changed", chiama `store.clearRemoteIdentity(senderUserId)` e riprova (TOFU accetta la nuova IK dal messaggio).
- Nuovo metodo `key-store.ts`: `clearRemoteIdentity(identifier)` — cancella sia `"userId"` che `"userId.1"`.

### Bug 6 — `signalEncryptMulti` + `rebuildSession`: doppio "Identity key changed" sul send
- Causa A: `signalEncryptMulti` aggiornava il trust solo SE esisteva la sessione. Con `sessionExists=false`, `ensureSessionForBundle` → `processPreKey` → `isTrustedIdentity` → mismatch → eccezione.
- Fix A (`multi-device.ts`): `saveIdentity(recipientUserId, bundleIK)` PRIMA di `ensureSessionForBundle`, sempre, indipendentemente da sessione esistente.
- Causa B: `rebuildSession` chiamava `saveIdentity(recipientAddr.toString(), ...)` = chiave `"userId.1"`, ma `isTrustedIdentity` legge da `"userId"` → aggiornamento scritto nella chiave sbagliata → retry fallisce comunque.
- Fix B (`signal-session.ts`): `saveIdentity(recipientUserId, bundleIK)` + `saveIdentity(recipientAddr.toString(), bundleIK)` (entrambe le chiavi).

---

## E2E Checklist (11 blocchi, definitiva)
| # | Stato | Note |
|---|-------|------|
| 1 | ✅ | Registrazione con blob IK, pubKey 33B |
| 2 | ✅ | Login decifra blob, signal_keys_ready |
| 3 | ✅ | Multi-device stessa IK |
| 4 | ✅ | Messaggistica 1:1 |
| 5 | ✅ | Messaggistica gruppi |
| 6 | ✅ | Logout/re-login IK persistente |
| 7 | ✅ | Migrazione legacy (blob null → PATCH) |
| 8 | ✅ | Recovery Card (fix Bug 2 incluso) |
| 9 | ✅ | Crypto locale, nessuna dipendenza rete |
| 10 | ✅ | Login concorrenti, no conflitti bundle |
| 11 | ✅ | Chiamate: errore hardware Playwright |
