---
name: Investor Secure Access
description: VDR-style access gate per investor-book + admin management + backend completo
---

## Architettura

**Backend** (`artifacts/api-server`):
- Modelli: `investor-access-request.model.ts`, `investor-access-code.model.ts`, `investor-access-log.model.ts`
- Controller: `investor.controller.ts` — verifica codice (argon2id), richiesta accesso, CRUD admin
- Route: `routes/v1/investor.routes.ts` — registrate in `v1/index.ts`
- Email: `sendInvestorCodeEmail()` aggiunta a `email.service.ts`
- Endpoint pubblici: `POST /api/v1/investor/verify`, `POST /api/v1/investor/request`
- Endpoint admin (requireAdmin): `/api/v1/investor/admin/requests|codes|log`

**Frontend gate** (`artifacts/investor-book`):
- `src/components/InvestorGate.tsx` — wrapper che blocca il Book
- `src/components/investor-gate.css` — design dark premium (Apple × Palantir × OpenAI)
- `App.tsx` wrappa `<WouterRouter>` con `<InvestorGate>`
- Session in `sessionStorage` (`ib_secure_session`), persiste fino a chiusura tab
- API calls a `/api-server/api/v1/investor/...`
- Flow: GateCover → DecryptingScreen (2.8s, steps animati) → UnlockAnimation (2.4s) → Book

**Admin Panel** (`artifacts/admin-panel`):
- Pagina: `src/pages/investor-access.tsx` — 3 tab (Requests / Codes / Log)
- Sidebar aggiornata con `BookLock` icon → `/investor-access`
- `apiFetch` ora è `export async function` (era privata)

## Decisioni

**Why argon2id per i codici:** i codici sono brevi (12 char alfanumerico), hash obbligatorio lato server; verifica via loop su tutti gli `active` codes (lista piccola, max ~100).

**Why sessionStorage:** i documenti investor sono confidenziali; chiudendo il browser si perde la sessione e si deve re-verificare. Non usare localStorage.

**Why no client-side code validation:** codice verificato solo lato server, mai nel frontend. Il frontend non vede mai l'hash.
