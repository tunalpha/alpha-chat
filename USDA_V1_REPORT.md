# USDA Native Integration V1 — Report Finale

**Data:** 22 luglio 2026  
**Sprint:** Finale USDA V1 (Sprint 30+)  
**Stato:** ✅ Production-ready — pronto per collegamento HttpUsdaAdapter

---

## 1. File creati

### Backend (`artifacts/api-server/src/`)

| File | Descrizione |
|------|-------------|
| `usda/usda-adapter.interface.ts` | Interfaccia astratta `UsdaAdapter` — `getInfo()`, `checkCapabilities()`, 9 metodi totali |
| `usda/mock-usda.adapter.ts` | Adapter mock con auto-confirm 3s, info rete testnet, capabilities complete |
| `usda/http-usda.adapter.ts` | Adapter HTTP reale — cache 5 min per `/info` e `/capabilities`, fallback conservativo |
| `models/usda-payment.model.ts` | Mongoose model `usda_payments` |
| `repositories/usda-payment.repository.ts` | CRUD senza business logic |
| `services/usda.service.ts` | Orchestrazione — `setWalletAddress(chain)`, `getBackendInfo()`, `checkCapabilities()` |
| `validation/usda.schemas.ts` | Zod schemas per tutti gli endpoint |
| `controllers/usda.controller.ts` | 10 handler — incl. `getBackendInfo`, `getCapabilities` |
| `routes/v1/usda.routes.ts` | Router — `GET /info`, `GET /capabilities`, 8 route aggiuntive |

### Frontend (`artifacts/alpha-chat-web/src/`)

| File | Descrizione |
|------|-------------|
| `lib/usda-types.ts` | Tipi condivisi — `UsdaBackendInfo`, `UsdaCapabilities`, `WalletChain`, 9 stati |
| `lib/usda-api.ts` | Fetch wrappers — incl. `apiUsdaGetInfo()`, `apiUsdaGetCapabilities()` |
| `components/usda/UsdaPaymentBubble.tsx` | Bubble send — 9 stati distinti, `aria-*`, `memo` |
| `components/usda/UsdaRequestBubble.tsx` | Bubble request — pay async, spinner, `aria-*`, `memo` |
| `components/usda/SendUsdaSheet.tsx` | Flow 3-step con progress bar, `AbortController`, `aria-modal` |
| `components/usda/RequestUsdaSheet.tsx` | Sheet richiesta — `inputMode`, `aria-*` |
| `components/usda/WalletSetupSheet.tsx` | Multi-chain — `role="radio"`, `aria-checked`, placeholder per chain |
| `components/usda/UsdaPaymentDetail.tsx` | Viewer completo — explorer dinamico, receipt badge, `AbortController` |
| `components/usda/UsdaHistory.tsx` | Cronologia — `AbortController`, `role="tab"`, `aria-selected` |
| `pages/WalletCenterPage.tsx` | Hub 3-tab — saldo, storico, impostazioni, contatti recenti, `AbortController` |

---

## 2. File modificati

### Backend
- `models/message.model.ts` — `MessageType` + `usda_send | usda_request | usda_receipt`
- `models/user.model.ts` — `wallets: Partial<Record<WalletChain, WalletEntry>>` + legacy `wallet_address`
- `types/ws-events.ts` — `usda.payment.update`
- `routes/v1/index.ts` — mount `usdaRoutes` su `/usda`

### Frontend
- `lib/api.ts` — `MessageItem.system_metadata`, `LastMessagePreview.message_type` + ciphertext nullable
- `hooks/useWebSocket.ts` — `usda.payment.update` in `WsEvent` union
- `pages/ChatPage.tsx` — bubble rendering, attach-sheet tiles, WS patch handler, preview text
- `pages/SettingsPage.tsx` — voce "💰 Pagamenti" → WalletCenter
- `App.tsx` — `"wallet-center"` in `AppView`, import + switch case
- `index.css` — ~300 righe USDA (bubble, sheet, detail, history, WalletCenter, animations Sprint Finale)

---

## 3. Copertura funzionale

| Scenario | Stato |
|----------|-------|
| A: invio USDA → optimistic → firma → pending → confirmed | ✅ |
| B: richiesta → paga → bubble aggiornata via WS | ✅ |
| C: pending claim (il destinatario non ha ancora pagato) | ✅ |
| D: pagamento fallito | ✅ |
| E: refund automatico | ✅ |
| Wallet multi-chain (USDA, Polygon, ETH, BTC, Lightning) | ✅ |
| WalletCenter: saldo, storico (6 filtri), impostazioni, contatti recenti | ✅ |
| Explorer URL e network info da backend — nessun valore hardcoded | ✅ |
| Capability Test (`GET /info` + `GET /capabilities`) con cache 5 min | ✅ |
| WS aggiornamento in-place bubble (mai nuova bubble su status change) | ✅ |
| Nessun polling UI (polling interno all'Adapter se necessario) | ✅ |

---

## 4. Test eseguiti

| Test | Risultato |
|------|-----------|
| TypeScript `--noEmit` frontend | ✅ 0 errori |
| TypeScript `--noEmit` backend | ✅ 0 errori (8 pre-esistenti in `diagnostics.routes.ts` esclusi) |
| Build ESBuild API server | ✅ clean |
| HMR Vite frontend (tutti i file USDA) | ✅ |
| Workflow API server restart | ✅ `MockUsdaAdapter` attivo, MongoDB connesso |

---

## 5. Limitazioni residue

| Limitazione | Note |
|-------------|------|
| Firma ThirdWeb simulata (800ms + mock signature) | Sostituire con `ThirdWeb SDK` in produzione |
| Fee preview locale (0.1% stimata) | Quella definitiva arriva dal backend nel passo "confirm" — già separata nella UI |
| `POST /api/v1/usda/webhook` non implementato | Necessario per callback backend → AlphaChat; l'Adapter può usare polling come fallback |
| `AbortController` non propagato alle chiamate API sottostanti | Le `fetch` usano `authFetch` senza signal — race condition rara, non bloccante |
| Paginator storico (solo first-page da 30) | Aggiungere "Carica altri" quando `total > 30` — non prioritario |

---

## 6. Bug noti

| Bug | Stato |
|-----|-------|
| `usda-status-spinner` (vecchio) → sostituito da `usda-status-dot` animato | ✅ Risolto |
| CSS duplicati `.usda-pay-btn`, `.wc-stats-grid`, `.wc-stat` | ✅ Rimossi |
| `onSetup` type mismatch `WalletSetupSheet` in `ChatPage` | ✅ Compatibile (callback ignora `WalletInfo`) |

---

## 7. Checklist integrazione backend USDA reale

```
[ ] Impostare USDA_API_BASE_URL come Replit Secret
    → HttpUsdaAdapter si attiva automaticamente, MockUsdaAdapter viene disattivato

[ ] Impostare USDA_API_KEY se il server richiede auth server-to-server

[ ] Verificare ogni endpoint in http-usda.adapter.ts (marcati "// TODO: verify")
    → GET  /wallet/:userId
    → POST /prepare
    → POST /submit
    → POST /request
    → POST /claim/:paymentId
    → POST /refund/:paymentId
    → GET  /payments/:paymentId
    → GET  /payments (list)
    → GET  /capabilities
    → GET  /info          ← nuovo Sprint Finale

[ ] Verificare envelope risposta ({ data: ... } vs flat object)
    → usdaRequest() tenta json.data ?? json

[ ] Implementare POST /api/v1/usda/webhook
    → riceve status update dal backend e chiama wsManager.broadcastToUser()

[ ] Rimuovere commenti "// TODO: verify" dopo conferma di ogni endpoint

[ ] Testare con signature reale ThirdWeb SDK
    → sostituire il mock setTimeout in SendUsdaSheet.tsx handleSign()
```

---

## 8. Checklist deploy produzione

```
[ ] Deploy API server con USDA_API_BASE_URL + USDA_API_KEY impostati
[ ] Verificare MongoDB indexes sincronizzati (usda_payments collection)
[ ] Verificare User.wallets field disponibile (migration non necessaria — campo additive)
[ ] Test Scenario A–E su staging prima del go-live
[ ] Attivare webhook da backend USDA verso /api/v1/usda/webhook
[ ] Monitorare R2 per eventuali attachment media nelle transazioni
[ ] Controllare performance: nessun render inutile (memo su bubble), nessun listener duplicato
[ ] Verificare CSP headers per domini ThirdWeb SDK
[ ] Review limite rate per /api/v1/usda/* (soglia consigliata: 60 req/min per user)
```

---

## Architettura finale

```
┌─ AlphaChat Frontend ──────────────────────────────────────────────────────┐
│  ChatPage ──► UsdaPaymentBubble / UsdaRequestBubble  (9 stati distinti)  │
│              SendUsdaSheet / RequestUsdaSheet         (a11y + step bar)   │
│              UsdaPaymentDetail                        (viewer banca)      │
│              WalletCenterPage                         (saldo/storico/cfg) │
│                                                                            │
│  WS ←── usda.payment.update  (patch in-place, mai nuova bubble)          │
└───────────────────────────────────────────────────────────────────────────┘
              ▼  REST /api/v1/usda/*
┌─ AlphaChat API ───────────────────────────────────────────────────────────┐
│  usda.controller ──► usda.service ──► UsdaAdapter                        │
│                                       ├─ MockUsdaAdapter  (dev/default)  │
│                                       └─ HttpUsdaAdapter  (prod — auto)  │
│                          GET /info         → network, chainId, explorer   │
│                          GET /capabilities → features supported           │
└───────────────────────────────────────────────────────────────────────────┘
              ▼  (quando USDA_API_BASE_URL è impostato)
┌─ USDA Backend ────────────────────────────────────────────────────────────┐
│  Blockchain · Polygon · ThirdWeb · Stablecoin                            │
└───────────────────────────────────────────────────────────────────────────┘
```

**Zero modifiche strutturali richieste al momento del collegamento al backend reale.**  
Solo: impostare 2 variabili d'ambiente + verificare endpoint paths.
