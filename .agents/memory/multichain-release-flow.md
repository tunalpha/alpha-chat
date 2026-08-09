---
name: MultiChain Release Flow — Auto-release & recipient_wallet resolution
description: Architettura completa del release EVM: chi chiama releaseMultiChainTransfer, come viene risolto recipient_wallet, safety-net scheduler.
---

## Flusso release (aggiornato)

**Chi chiama releaseMultiChainTransfer:**
1. **handleDetectDeposit controller** (fire-and-forget) — se `transfer.status === "pending"` dopo `detectMultiChainDeposit`, avvia subito il release (`void releaseMultiChainTransfer(...).catch(...)`)
2. **processNewPendingTransfers scheduler** (ogni 2 min + startup via _runAll) — safety-net: raccoglie transfer "pending" con `tx_hash_release: null` e `expires_at > now`, li rilascia
3. **processWaitingForGasTransfers scheduler** — retry per transfer in waiting_for_gas

**PRIMA del fix:** nessuno chiamava il release automaticamente. Il transfer restava "pending" indefinitamente (l'unico trigger era un endpoint `/release` manuale mai chiamato dal frontend).

## recipient_wallet null — risoluzione

Se `recipient_wallet` è null al momento del release EVM, il service:
1. Lookup `UserModel.findOne({ _id: locked.recipient_id }, { wallet_address: 1 })`
2. Se trovato → persiste `recipient_wallet` nel transfer + usa l'indirizzo (stesso indirizzo EVM valido su Polygon/BSC/Ethereum)
3. Se non trovato → rollback a "pending" + throw `RECIPIENT_WALLET_REQUIRED_FOR_RELEASE`

**Why:** L'indirizzo EVM del destinatario non viene sempre inviato alla creazione del transfer (il destinatario può essere offline). `wallet_address` nel user model è l'unico posto dove è memorizzato.

## Errori di design precedenti

- `sendTransaction({ chainId })` come switch implicito → "Missing or invalid chainId" su Trust Wallet iOS via WalletConnect. **Fix: `await switchChain(polygon)` PRIMA di sendTransaction** (pattern in MultiChainSendSheet e ora in SendPaymentSheet).
- Null check hard-fail in `releaseMultiChainTransfer` → loop infinito pending↔releasing. **Fix: lookup utente prima del throw.**
