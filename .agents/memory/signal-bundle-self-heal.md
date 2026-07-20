---
name: Signal bundle self-heal
description: Fix per signalkeybundles svuotata — il client rileva bundle assente e riesegue l'upload senza rigenerare l'IK
---

## Problema

La collection `signalkeybundles` può essere svuotata (reset DB, admin delete, sprint28 auto-cleanup fallito).
Quando ciò accade:
- `GET /keys/bundle/:userId/all` → 404 `SIGNAL_BUNDLE_NOT_FOUND` per tutti
- Il sender non può fare X3DH → usa sessione esistente → se desynced → DECRYPT-FAILURE

**Root cause secondaria**: `maybeReplenishOtpks` usava `appendOneTimePreKeys` (updateOne senza upsert) che è silente se il documento non esiste. Nessun errore, nessun bundle ricreato.

**Root cause terziaria**: `getOtpkCount` non filtrava per `deviceId` → restituiva 0 anche per un altro device, mascherando il vero stato del bundle.

## Fix applicato (chirurgico — non tocca decrypt/sessioni/ChatPage)

### Server
- `repository.appendOneTimePreKeys` → ritorna `boolean` (`matchedCount > 0`)
- `repository.getOtpkCount(userId, deviceId)` → aggiunto `deviceId`, ritorna `{ otpkCount, bundleExists }`
- `service.getKeyCount(userId, deviceId)` → propagato `deviceId`, espone `bundleExists` nella risposta
- `service.replenishOneTimePreKeys` → se `appendOneTimePreKeys` ritorna false → throw `SIGNAL_BUNDLE_NOT_FOUND` (defense-in-depth)
- `controller.getKeyCount` → passa `req.user!.deviceId`

### Client
- `ApiKeyCountResponse` → aggiunto `bundleExists: boolean`
- `maybeReplenishOtpks` → se `bundleExists === false`:
  1. Legge IK esistente dall'IDB (`store.getIdentityKeyPair()`)
  2. Chiama `_firstTimeSetup(store, userId, deviceId, existingIK)`
  3. Questo ricrea il bundle sul server con la **stessa IK** → Safety Numbers invariati

**Why:** Un wipe del DB non deve richiedere all'utente di resettare le sessioni. La IK è già in IDB cifrata, va solo riesposta sul server.

**How to apply:** Questo pattern (bundleExists check + re-upload con IK esistente) è il modo canonico di gestire un KDC reset senza cambiare IK.
