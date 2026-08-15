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

### Logica di INVIO pagamenti = CONGELATA (aggiunto 2026-08-15)

Dopo una serie di bug critici risolti con fatica (double-spend, loop "Conferma blockchain…", float→wei precision), l'utente ha dichiarato la logica di invio pagamenti **CONGELATA**.

Nessun intervento sui seguenti file senza autorizzazione esplicita dell'utente:

- `artifacts/alpha-chat-web/src/components/usda/SendPaymentSheet.tsx`
- qualsiasi hook/utility che governa il flusso di firma e invio USDA
- la state machine di firma in-flight (`ac_sign_inflight_*` in localStorage)

Un fix che riguarda detectDeposit, verifica receipt, scheduler o backend può toccare `chat-payment.service.ts` e i relativi test **senza** toccare il frontend di invio. Se un fix richiede di entrare in `SendPaymentSheet.tsx` → **fermarsi e chiedere approvazione esplicita**.

---

**Why:** La logica di invio ha richiesto tre wave di fix + review architetturale per raggiungere la stabilità (sign lock idempotente, confirmOrAbort, float→wei string-based). Ogni regressione in quel modulo produce double-charge o loop irreversibili visibili dall'utente in produzione.

**How to apply:** Prima di ogni edit, verificare che il file rientri nel perimetro consentito dal task assegnato. In caso di dubbio, fermarsi e chiedere.
