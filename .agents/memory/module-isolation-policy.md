---
name: Module isolation policy
description: Regola di sviluppo obbligatoria — modulo Messaggi congelato, modulo Chiamate completamente separato.
---

## Regola

### Modulo Messaggi = CONGELATO

Nessun intervento sui seguenti file senza autorizzazione esplicita dell'utente:

- `artifacts/alpha-chat-web/src/pages/ChatPage.tsx`
- qualsiasi componente del rendering messaggi
- `artifacts/alpha-chat-web/src/lib/signal/` (tutti i file)
- encrypt / decrypt / sessioni / ratchet / OTPK
- hook condivisi della chat (`useWebSocket`, ecc.)

### Modulo Chiamate = COMPLETAMENTE SEPARATO

Un bug delle chiamate si corregge modificando **solo**:

- `artifacts/alpha-chat-web/src/components/IncomingCallModal.tsx`
- `artifacts/alpha-chat-web/src/components/ActiveCallScreen.tsx`
- `artifacts/alpha-chat-web/src/components/BusyCallScreen.tsx`
- `artifacts/alpha-chat-web/src/contexts/CallContext.tsx`
- `artifacts/alpha-chat-web/src/lib/webrtc.ts`
- `artifacts/alpha-chat-web/src/lib/notifSound.ts` (solo se legato alle chiamate)
- CSS delle chiamate in `index.css` (sezioni Sprint 23/24/25)

### Procedura di blocco

Se durante un fix delle chiamate emerge la necessità di modificare **qualsiasi file del sistema messaggi**, il lavoro deve **fermarsi immediatamente** e richiedere approvazione esplicita prima di procedere.

**Why:** Una regressione critica ([Messaggio non decifrabile]) è comparsa durante un intervento alla chat (swipe-to-reply). Non è stato possibile determinare con certezza se fosse il bug Signal pre-esistente o una nuova regressione, perché mancavano log DECRYPT-FAILURE / SESSION-SELECTION al momento dell'occorrenza. La policy elimina alla radice il rischio di contaminazione tra moduli.

**How to apply:** Prima di ogni edit, verificare che il file rientri nel perimetro consentito dal task assegnato. In caso di dubbio, fermarsi e chiedere.
