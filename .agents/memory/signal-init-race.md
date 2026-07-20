---
name: Signal init race condition
description: initSignalKeys era fire-and-forget → race condition con decryptBatch al login
---

## Problema
Dopo login/logout, tutti i messaggi mostravano "[Messaggio non decifrabile]" / "🔒 Messaggio cifrato".

## Causa radice
`initSignalKeys(uid, devId, ...)` in AuthContext.tsx era chiamato con `void` (fire-and-forget) in 3 punti:
1. `login()` — line ~142
2. `register()` — line ~170  
3. useEffect di restore sessione — line ~62

ChatPage.decryptBatch() partiva non appena activeConvId cambiava, SENZA attendere che Signal IDB fosse pronto. Se Signal non era inizializzato, signal-messenger.ts ritornava "[cifrato]" / "🔒 Messaggio cifrato".

## Fix (AuthContext.tsx)
Cambiato da `void initSignalKeys(...).then(...)` a `try { await initSignalKeys(...) } catch {}` in tutti e 3 i punti. Poi setLocalStorage + dispatchEvent avvengono sincronamente dopo l'await.

**Why:** login() ora non risolve finché Signal IDB non è pronto → ChatPage non può caricare messaggi finché le chiavi non ci sono. Zero impatto sulla messaggistica (ChatPage non modificata).

## File modificati
- `artifacts/alpha-chat-web/src/contexts/AuthContext.tsx` — unico file toccato
