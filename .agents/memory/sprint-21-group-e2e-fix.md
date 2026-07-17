---
name: Sprint 21 Group E2E decrypt fix
description: Root cause and definitive fix for group messages showing "Messaggio cifrato"
---

## Tipo di cifratura: B (fan-out 1:1)
Ogni messaggio di gruppo viene cifrato separatamente per ogni membro con sessioni Signal 1:1.
Non si usa il Sender Keys del protocollo Signal.

## Bug 1 — Race condition su isGroupMsg
`isGroupMsg` controllava `conversations.find(...)?.type === "group"` (React state).
Se conversations non caricato → isGroupMsg=false → path 1:1 → device_id sbagliato → null → "🔒".

**Fix**: `hasGroupStyleEntry = msg.device_ciphertexts?.some(d => d.device_id === auth.userId)`.
Non dipende dallo state React, legge i dati del messaggio direttamente.

## Bug 2 — forceNewSession: false è corretto
`forceNewSession: true` per ogni messaggio consumava 1 OTPK per membro per messaggio.
Con OTPK_BATCH=100 e ripristino solo al login, il pool si svuotava in ~100 messaggi.

**Fix**: rimosso. Il ciclo Signal corretto è tipo-3 solo alla prima sessione (X3DH),
poi tipo-1 (Double Ratchet). Aggiunto `maybeReplenishOtpks()` mid-session dopo ogni gruppo.

## Bug 3 — IDB cancellato senza logout
Se B cancella IDB senza fare logout, A ha ancora la sessione → manda tipo-1 → B non può decifrare.
`initSignalKeys` veniva chiamato solo al login, non al page load.

**Fix**: `initSignalKeys` chiamato anche nel primo useEffect di AuthContext (page load).
È idempotente (no-op se chiavi esistono). Se IDB è vuoto: rigenera chiavi, le carica sul server.
A's next message fetches new bundle → tipo-3 → B può decifrare.
Il messaggio corrente (già tipo-1 con vecchie chiavi) è irrecuperabile — comportamento atteso di Signal.

## Logging aggiunto
- `console.error` con stack trace reale in `signalDecryptFromDeviceCiphertexts`
- `console.debug` su ogni tentativo decrypt/encrypt di gruppo
- Nessun catch silenzioso rimasto

## File modificati
- multi-device.ts: logging reale invece di catch silenzioso
- ChatPage.tsx: hasGroupStyleEntry + rimozione forceNewSession + maybeReplenishOtpks
- AuthContext.tsx: initSignalKeys al page load
