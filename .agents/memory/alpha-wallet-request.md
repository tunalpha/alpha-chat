---
name: Alpha Wallet — Richiedi con Alpha Wallet
description: Feature completa per richiedere pagamenti tramite Alpha Wallet self-custodial
---

## Architettura

Nessun escrow: il backend traccia solo lo stato della richiesta. Il pagamento avviene direttamente on-chain dal payer all'indirizzo del requester.

## Formato messaggio

Il messaggio viaggia come testo Signal-encrypted con prefisso `🔐WALLETREQ:{JSON}` (identico a `🔐WALLETPAY:` per i pagamenti). Il JSON è `WalletRequestMeta` definito in `ChatWalletRequestBubble.tsx`.

## Backend (3 endpoint)
- `POST /api/v1/alpha-wallet/payment-requests` — crea richiesta, 24h TTL
- `GET /api/v1/alpha-wallet/payment-requests/:id` — stato (solo requester o payer)
- `PATCH /api/v1/alpha-wallet/payment-requests/:id/paid` — payer marca come pagata (emette WS)

**Why:** no escrow → nessun lock fondi, nessun rollback. Il backend è solo un tracker di stato + WS relay.

## WS event
`aw_payment_request.state_changed` con payload `{ requestId, status, txHash? }` — emesso da PATCH /paid.
Aggiunto in:
- `artifacts/api-server/src/types/ws-events.ts`
- `artifacts/alpha-chat-web/src/hooks/useWebSocket.ts`

## Frontend — flusso richiedente
`ChatWalletRequestSheet` (wizard network→asset→amount→confirm→sending→success):
1. Legge proprio indirizzo via `bridge.getReceiveAddress(network)` (no chiavi)
2. Chiama `apiCreateAlphaWalletPaymentRequest`
3. Chiama `onRequested(requestId, meta)` → ChatPage chiama `sendProgrammatic("🔐WALLETREQ:...")`

## Frontend — flusso pagante
`ChatWalletRequestBubble` mostra "Paga ora" button (solo se `!isMine && status=pending`).
Click → ChatPage setta `walletRequestPay` → apre `ChatWalletPaySheet` con `prefillRequest`.
`ChatWalletPaySheet.prefillRequest` monta direttamente a step "amount" con campi bloccati.
Dopo invio TX chiama `apiMarkAlphaWalletRequestPaid` fire-and-forget.

## Polling bubble
`ChatWalletRequestBubble` usa `useLiveRequestStatus`: poll GET /payment-requests/:id ogni 15s se pending.
Override immediato da prop `statusOverride` (settato da WS handler in ChatPage).

## ChatPage — attach sheet
"Richiedi con Alpha Wallet" aggiunto nel submenu `attachSubMenu === "request"` (visibile solo se `walletBridge.status !== "unavailable"` e conversazione non-group).
