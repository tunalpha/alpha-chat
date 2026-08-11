---
name: MultiChain Release Flow — Auto-release & recipient_wallet resolution
description: Architettura completa del release EVM: chi chiama releaseMultiChainTransfer, come viene risolto recipient_wallet, safety-net scheduler.
---

## Flusso release (aggiornato)

**Chi chiama releaseMultiChainTransfer:**
1. **handleDetectDeposit controller** (fire-and-forget) — se `transfer.status === "pending"` dopo `detectMultiChainDeposit`, avvia subito il release (`void releaseMultiChainTransfer(...).catch(...)`)
2. **processNewPendingTransfers scheduler** (ogni 2 min + startup via _runAll) — safety-net: raccoglie transfer "pending" con `tx_hash_release: null` e `expires_at > now`, li rilascia
3. **processWaitingForGasTransfers scheduler** — retry per transfer in waiting_for_gas
4. **setWalletAddress hook** (agosto 2026) — trigger immediato di `processNewPendingTransfers()` ogni volta che un utente registra/aggiorna il proprio wallet, per rilasciare subito i transfer bloccati con `RECIPIENT_WALLET_REQUIRED_FOR_RELEASE`

**PRIMA del fix:** nessuno chiamava il release automaticamente. Il transfer restava "pending" indefinitamente (l'unico trigger era un endpoint `/release` manuale mai chiamato dal frontend).

## recipient_wallet null — risoluzione (aggiornata agosto 2026)

Se `recipient_wallet` è null al momento del release EVM, il service cerca a cascata:
1. `wallet_address` (campo legacy)
2. `wallets.polygon.address` (struttura multi-chain nuova)
3. `wallets.ethereum.address`
4. `wallets.usda.address`

**Why:** L'indirizzo EVM è intercambiabile su tutte le chain EVM (BSC, Polygon, Ethereum — stessa derivazione BIP-44). Il vecchio codice guardava SOLO `wallet_address` (legacy), mancando i wallet registrati via struttura nuova.

Se nessun indirizzo trovato → rollback a "pending" + throw `RECIPIENT_WALLET_REQUIRED_FOR_RELEASE`. Lo scheduler riproverà al prossimo ciclo (max 2 min). Con il hook su `setWalletAddress`, il retry è immediato non appena l'utente registra il wallet.

## Incidente reale BSC USDT (agosto 2026)

Transfer bloccato ~6 min perché il destinatario non aveva wallet al momento del deposito.
Timeline: deposit detectato → release fallisce 3× → utente registra USDA wallet → `setWalletAddress` trigger immediato → release OK → WS `mc_payment.state_changed` emesso → bolla aggiornata.

## Errori di design precedenti

- `sendTransaction({ chainId })` come switch implicito → "Missing or invalid chainId" su Trust Wallet iOS via WalletConnect. **Fix: `await switchChain(polygon)` PRIMA di sendTransaction** (pattern in MultiChainSendSheet e ora in SendPaymentSheet).
- Null check hard-fail in `releaseMultiChainTransfer` → loop infinito pending↔releasing. **Fix: lookup utente prima del throw.**
