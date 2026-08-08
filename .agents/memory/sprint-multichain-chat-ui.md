---
name: Multi-Chain Chat UI Integration
description: Integrazione UI chat per il Multi-Chain Payment Engine — sheet, bubble, backend, i18n
---

## Cosa è stato costruito

### Backend (api-server)
- `multichain-payment.service.ts`: aggiunto `recipientId` a `MultiChainTransferInfo` + `setTransferMessageId()`
- `multichain-payment.controller.ts`: aggiunti `_mcMsgMeta`, `_createMCMessage`, `_broadcastMCMessage`; `handleCreateTransfer` ora crea il messaggio chat post-transfer; aggiunto `handleRequestTransfer` (payer dal body, recipient=req.user); `getOwnedTransfer` aggiornato a permettere accesso a sender E recipient
- `multichain-payment.routes.ts`: aggiunto `POST /transfers/request` (prima di `/:id`)
- `multichain.schemas.ts`: aggiunto `RequestMultiChainTransferSchema` con `payerId` invece di `recipientId`

### Frontend (alpha-chat-web)
- `src/lib/multichain-api.ts`: client API completo (apiMCCreate, apiMCRequest, apiMCGet, apiMCDetect), tipi MCTransfer/MCSystemMeta/MCNetwork/MCStatus, helpers toSmallestUnit/fromSmallestUnit
- `src/components/multichain/MultiChainSendSheet.tsx`: 3 step (form → confirm → address), 4 reti, copy-to-clipboard
- `src/components/multichain/MultiChainRequestSheet.tsx`: 1 step, chiama /transfers/request
- `src/components/multichain/MultiChainPaymentBubble.tsx`: bubble con polling 30s, indirizzo escrow (copy) per il payer, link explorer, badge stato
- `src/multichain.css`: styles bubble + sheet (importato da main.tsx)
- `src/pages/ChatPage.tsx`: +2 state (showMCPay/showMCRequest), +2 pulsanti in attach sheet, +2 modali, +1 case bubble renderer per `message_type: "mc_payment"`
- Tutte 10 lingue i18n aggiornate (chat.attachSendMultichain, chat.attachRequestMultichain, "multichain" namespace completo)

## Pattern system message mc_payment

```typescript
// is_request=false: isMine=true → payer vede escrow address
// is_request=true:  isMine=false → payer vede escrow address
const isPayer = isRequest ? !isMine : isMine;
```

**Why:** il `sender_id` del messaggio chat è sempre chi ha avviato l'azione (send o request). Il payer deve vedere l'indirizzo escrow, ma in un request chi paga è il !isMine.

## Decimali per rete
- Polygon USDT: 6 dec
- Ethereum USDT: 6 dec
- BSC USDT: 18 dec
- Bitcoin BTC: 8 dec

## Ownership check aggiornato
`getOwnedTransfer` ora accetta sia `senderId` che `recipientId` — necessario per il flow request dove il richiedente (recipientId) deve poter leggere lo stato.
