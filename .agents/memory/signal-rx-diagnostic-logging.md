---
name: Signal RX Diagnostic Logging
description: Logging diagnostico aggiunto ai path di decrypt Signal — attivo in produzione, visibile nei deployment logs
---

## Dove si trova il logging

### `signal-messenger.ts` — `signalDecrypt()`
- Tag: `[SIGNAL-RX] pre-decrypt` — stato PRIMA della decrypt: sessionKey, sessionFound, localIkFp, remoteIkFp, ciphertextType, sender/recipient IDs, bodyLen
- Tag: `[SIGNAL-RX] DECRYPT FAILED` — su errore: errName, errMsg, errStack + tutti i campi sopra
- Tag: `[SIGNAL-RX] decrypt OK` — su successo (info)
- Tag: `[SIGNAL-RX] recovery FAILED` — se il rebuild-session fallisce

### `multi-device.ts` — `signalDecryptFromDeviceCiphertexts()`
- Tag: `[SIGNAL-RX-DC] pre-decrypt` — stessa struttura di [SIGNAL-RX], più entryDeviceId e senderDeviceIdInt (hash del deviceId recipient)
- Tag: `[SIGNAL-RX-DC] DECRYPT FAILED` — errore completo con stack
- Tag: `[SIGNAL-RX-DC] decrypt OK` — su successo

### `ChatPage.tsx` — catch esterno 1:1
- Tag: `[SIGNAL-RX] signalDecryptFromDeviceCiphertexts 1:1 FAILED (outer catch)` — include msgId, senderId, convId, myUserId, myDeviceId, dcEntries

## Come leggere i log in produzione

Deployment logs → filtra per `[SIGNAL-RX]`

**Why:** Logging è necessario perché il problema (`[Messaggio non decifrabile]`) si manifesta solo su device reali iOS e le eccezioni Signal (NoSessionError, BadMacError, IdentityKeyChangedError ecc.) non erano mai visibili senza devtools.

**How to apply:** Il logging è SEMPRE attivo (non solo DEV). Una volta diagnosticato il problema, si può ridurre a DEV-only o rimuovere.
