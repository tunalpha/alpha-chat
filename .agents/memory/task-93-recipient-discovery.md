---
name: Task #93 — Recipient Wallet Discovery
description: Alpha Wallet recipient address auto-resolution in ChatWalletPaySheet — architettura, decisioni, vincoli
---

# Task #93 — Recipient Wallet Discovery

## Decisioni architetturali

**Storage indirizzi**: `UserModel.alpha_wallet_evm_address` + `UserModel.alpha_wallet_btc_address` — campi dedicati, separati da `wallets` (usato dal multichain Payment Engine) per evitare conflitti.

**Persistenza**: WalletContext chiama `apiWalletRegisterAddress()` fire-and-forget dopo `createWallet` e `importWallet`. Il pagamento funziona anche se il backend non ha ancora l'indirizzo (Caso C manuale).

**Sicurezza endpoint GET /recipient/:userId**:
- Richiede JWT
- Verifica conversazione condivisa via ConversationMemberModel (left_at=null, deleted_at=null)
- 403 se non c'è conversazione comune — no lookup arbitrario
- Response contiene SOLO hasAlphaWallet + evmAddress + btcAddress (mai seed/PIN/keystore)

**Why:** address EVM identico su Polygon/Ethereum/BSC — la UI mostra sempre la rete selezionata accanto all'address per evitare invii sulla rete sbagliata (spec §4).

## 3 casi UX in ChatWalletPaySheet

- **Caso A** (`recipientMode="found"`): address auto-risolto, campo locked, riepilogo mostra rete+address espliciti
- **Caso B** (`recipientMode="not-found"`): form bloccato, messaggio invito, pulsante "Usa indirizzo esterno"
- **Caso C** (`recipientMode="manual"`): campo libero + avviso rete nel riepilogo pre-firma

**New props**: `recipientUserId?: string` (userId destinatario) + `recipientName?: string` (nome display). Il fetch avviene in `useEffect` al mount se `recipientUserId` è fornito.

## File modificati

- `artifacts/api-server/src/models/user.model.ts` — aggiunto alpha_wallet_evm/btc_address
- `artifacts/api-server/src/controllers/alpha-wallet.controller.ts` — handler registerAlphaWalletAddress + getAlphaWalletRecipient
- `artifacts/api-server/src/routes/v1/alpha-wallet.routes.ts` — POST /register-address + GET /recipient/:userId
- `artifacts/alpha-chat-web/src/lib/alpha-wallet-api.ts` — apiWalletRegisterAddress + apiWalletGetRecipient
- `artifacts/alpha-chat-web/src/wallet/context/WalletContext.tsx` — register dopo create/import
- `artifacts/alpha-chat-web/src/components/chat/ChatWalletPaySheet.tsx` — riscrittura completa 3 casi
- `artifacts/alpha-chat-web/src/components/chat/ChatWalletPaySheet.css` — stili nuovi elementi
- `artifacts/alpha-chat-web/src/pages/ChatPage.tsx` — passa recipientUserId + recipientName

## Test

- Backend: `src/__tests__/alpha-wallet-recipient.test.ts` — 15 test (register + recipient)
- Frontend: `src/tests/wallet/alpha-wallet-recipient-api.test.ts` — 15 test (API + security + regression)
- Totale post-task: 641 frontend + backend pass (4 pre-esistenti falliscono su JWT timing + USDA)

## Vincolo modulo isolamento

Payment Engine, USDA, USDT, BTC, escrow, Gas Station — invariati. ChatWalletBridge non toccato.
