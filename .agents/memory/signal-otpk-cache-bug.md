---
name: Signal OTPK cache bug (🔒 permanente)
description: Due bug architetturali in decryptSingleMsg che causano 🔒 anche per nuovi account
---

## Il bug fondamentale

Il `decryptPreKeyWhisperMessage` (Signal tipo-3) consuma l'OTPK al primo decrypt e la rimuove dall'IDB.
Se il plaintext non viene cachato PRIMA che l'utente navighi via, al reload si ripete il decrypt →
OTPK non trovata → null/throw → 🔒 permanente. Il plaintext è perso per sempre.

## Quattro sub-bug che causano la perdita della cache

### Bug A0 — `useEffect` di ripristino sessione (reload) NON chiamava mai `initMediaCache`
- Il path più comune (ricarica pagina con sessione già in localStorage) chiama `void initSignalKeys`
  ma NON chiama `initMediaCache` → `_ready=false` per tutta la sessione → ogni cacheDecryptedMeta è no-op
- login() e register() avevano già il fix, ma il reload no → bug persiste post-deploy
- **Fix**: async IIFE in useEffect — `await initMediaCache` PRIMA di `void initSignalKeys`
- `media-cache.ts`: aggiunto `_initPromise` — cacheDecryptedMeta/getMetaByMessageId attendono
  l'init in volo invece di restituire null/no-op durante la finestra di apertura IDB

### Bug A1 — `initMediaCache` era fire-and-forget in login()/register()
- `void initMediaCache(...)` veniva chiamato in parallelo a `void initSignalKeys(...)`
- Il primo messaggio WS poteva arrivare mentre `_ready = false`
- `cacheDecryptedMeta` ha guard `if (!_ready) return` → silently no-op
- **Fix**: `await initMediaCache(uid, devId)` PRIMA di `void initSignalKeys(...)` in login() e register()

### Bug B — path GRUPPO: `cacheDecryptedMeta` era fire-and-forget (`void`)
- `void cacheDecryptedMeta(msg.id, found)` → scrittura IDB non awaited
- Navigazione rapida via → reload → `getMetaByMessageId` → null → secondo decrypt → OTPK consumata → 🔒
- **Fix**: `await cacheDecryptedMeta(msg.id, found)`

### Bug C — path 1:1: NESSUNA protezione OTPK
- La path 1:1 (linee ~850-874) non aveva né cache check iniziale né cache write per testi
- Solo i messaggi `message_type === "media"` venivano cachati (con `void`)
- Tutti i messaggi di testo 1:1 tipo-3: OTPK consumata, nessun backup → 🔒 al reload
- **Fix**: aggiunto `getMetaByMessageId` check + `await cacheDecryptedMeta` per TUTTI i tipi

### Bug D — errori non-IK inghiottiti silenziosamente
- `signalDecryptFromDeviceCiphertexts` ritornava `null` per QUALSIASI errore non-IK
- L'errore finiva solo in `console.error` (browser), mai in AUDIT server
- Impossibile diagnosticare il tipo di fallimento dai log di produzione
- **Fix**: `throw err` invece di `return null` per errori non-IK → `AUDIT-6-decrypt-error` viene reportato

## Come applicare

**Per ogni nuovo decrypt path** (gruppo, 1:1, futuro):
1. Sempre `await getMetaByMessageId(msg.id)` PRIMA di tentare Signal
2. Sempre `await cacheDecryptedMeta(msg.id, plaintext)` DOPO il decrypt OK
3. `initMediaCache` deve completare PRIMA che qualsiasi decrypt possa essere tentato

**Why**: Signal PreKey è one-shot. Se non catture il plaintext al primo decrypt, è perso.

## File modificati
- `artifacts/alpha-chat-web/src/contexts/AuthContext.tsx` — await initMediaCache in login() e register()
- `artifacts/alpha-chat-web/src/pages/ChatPage.tsx` — path gruppo: await cache; path 1:1: cache check + await cache write
- `artifacts/alpha-chat-web/src/lib/signal/multi-device.ts` — throw non-IK errors per visibilità AUDIT
