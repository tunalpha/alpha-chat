# Alpha Chat

App di messaggistica end-to-end encrypted (Signal Protocol) con chiamate WebRTC, gruppi cifrati e funzionalità di sicurezza avanzate.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — avvia l'API server
- `pnpm --filter @workspace/alpha-chat-web run dev` — avvia il frontend PWA
- `pnpm run typecheck` — typecheck completo su tutti i package
- `pnpm run build` — typecheck + build tutti i package
- Required env: `MONGODB_URI`, `SESSION_SECRET`, `SMTP_PASS`

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React 18 + Vite, PWA (Service Worker + Web Push)
- API: Fastify (api-server)
- DB: MongoDB
- Crypto: libsignal-protocol (Signal Protocol — X3DH + Double Ratchet)
- Media E2E: AES-256-GCM con key wrapping Signal
- Chiamate: WebRTC + ICE + STUN/TURN

## Where things live

- `artifacts/alpha-chat-web/src/pages/ChatPage.tsx` — UI principale chat
- `artifacts/alpha-chat-web/src/lib/signal/` — Signal Protocol (key-manager, signal-messenger, signal-session, trust-manager)
- `artifacts/alpha-chat-web/src/contexts/CallContext.tsx` — stato globale chiamate
- `artifacts/alpha-chat-web/src/components/IncomingCallModal.tsx` — schermata chiamata in arrivo
- `artifacts/api-server/src/` — backend API + WS server

---

## ⚠️ REGOLA DI ISOLAMENTO MODULI (OBBLIGATORIA)

### Modulo Messaggi — LOCKED 🔒

Questa parte è considerata stabile. È **vietato** modificarla durante fix di altri moduli.

Comprende i seguenti file e funzionalità:

- Signal Protocol (X3DH, Double Ratchet, OTPK, Identity Key, SPK)
- Encrypt / Decrypt (`signalEncrypt`, `signalDecrypt`, `decryptSingleMsg`)
- Session Store, Trust Manager, Key Manager
- Rendering messaggi e chat timeline (`ChatPage.tsx`)
- Media messages (upload, decrypt, thumbnail)
- Reply e Swipe Reply
- Hook condivisi della chat (`useWebSocket`, ecc.)
- WebSocket messaggi

**Qualsiasi modifica a questi file richiede autorizzazione esplicita.**

---

### Modulo Chiamate — perimetro consentito

I bug delle chiamate si risolvono modificando **esclusivamente**:

- `IncomingCallModal.tsx`
- `ActiveCallScreen.tsx`
- `BusyCallScreen.tsx`
- `CallContext.tsx`
- `webrtc.ts`
- `notifSound.ts` (solo per audio delle chiamate)
- Sezioni CSS Sprint 23/24/25 in `index.css`

È **vietato** modificare il sistema messaggi per correggere un bug delle chiamate.

---

### Procedura obbligatoria prima di ogni fix

Prima di iniziare qualsiasi intervento, l'agente deve dichiarare:

1. file che intende modificare;
2. motivazione di ogni modifica;
3. conferma esplicita che nessun file del Modulo Messaggi verrà toccato.

**Se durante il lavoro emerge la necessità di modificare un file del Modulo Messaggi → il lavoro si interrompe e viene richiesta una nuova autorizzazione.**

---

## User preferences

- Interventi chirurgici: modificare solo ciò che è strettamente necessario per il task assegnato.
- Nessun refactoring, nessuna nuova feature, nessun cambio architetturale senza richiesta esplicita.
- Prima di dichiarare una causa come "bug pre-esistente", fornire log a supporto (es. `DECRYPT-FAILURE`, `SESSION-SELECTION`).
- Le regressioni sui messaggi sono critiche: in caso di dubbio, rollback immediato.

## Gotchas

- `onTouchMove` come listener React è **passivo** su iOS — per gesture swipe usare listener DOM nativo `{ passive: false }` sul container.
- `e.currentTarget` in React 17+ event delegation può essere inaffidabile per DOM query dirette durante touch gesture — preferire `document.querySelector('[data-msg-id]')`.
- Signal OTPK: ogni sessione fallita consuma la chiave prima del MAC verify — vedi `.agents/memory/signal-otpk-cache-bug.md`.
- Path C double-decrypt: senza cache guard `getMetaByMessageId`, WS reconnect può decifrare lo stesso messaggio due volte — vedi `.agents/memory/path-c-double-decrypt-bug.md`.

## Pointers

- Vedi `.agents/memory/MEMORY.md` per tutte le decisioni architetturali e i bug documentati nelle sessioni precedenti.
- Vedi il file `.agents/memory/module-isolation-policy.md` per la policy di isolamento moduli completa.
- Vedi la `pnpm-workspace` skill per struttura workspace, TypeScript setup e dettagli package.
