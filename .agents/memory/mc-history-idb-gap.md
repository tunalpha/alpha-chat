---
name: MC History IDB gap
description: TX MultiChain (Trust Wallet/WalletConnect) assenti dalla History view Alpha Wallet — fix completo con WS handler, backfill endpoint e utility testabile
---

## Problema

I pagamenti MultiChain (Trust Wallet, WalletConnect) non apparivano nella History view di Alpha Wallet.

## Root cause

`ChatPage.tsx`, `case "mc_payment.state_changed"`: il handler WS aggiornava solo `system_metadata` della bolla chat (`setMessages()`) ma non chiamava mai `saveTxRecord()`. La History view legge **solo** dall'IDB `alpha-wallet-v1/tx-history`; il tx-monitor non può coprire il gap perché scansiona l'Alpha Wallet address, non il Trust Wallet address usato per il deposit.

**Punto esatto di perdita**: il WS payload arrivava al client con `tx_hash_deposit` e `tx_hash_release` reali, ma questi hash non venivano mai scritti nell'IDB.

## Fix applicato (3 strati)

### 1. WS handler (ChatPage.tsx)
Quando `status === "released"`, costruisce e salva `WalletTxRecord` al tx-store IDB:
- Sender: `tx_hash_deposit`, direction `"out"`, amount = `gross_amount`
- Receiver: `tx_hash_release`, direction `"in"`, amount = `net_amount`
- ID key: `${chainId}:${txHash}:${dir}:` — upsert idempotente

### 2. Backend backfill endpoint
`GET /api/v1/multichain/transfers/history` — ritorna tutti i trasferimenti released/refunded dell'utente autenticato con tx_hash_deposit, tx_hash_release, amounts, senderId.
Route registrata PRIMA di `/transfers/:id` per evitare conflitti Express.

### 3. Frontend backfill al mount HistoryView (AlphaWalletPage.tsx)
Chiamata `backfillMCHistory(items, userId)` su ogni accesso alla History. Recupera le TX storiche già completate e le inserisce nell'IDB. Per la TX `0xcd5b3e97...` del 14 agosto: comparirà appena l'utente apre la History.

## Utility mc-history-backfill.ts

Centralizza:
- `MC_ASSET_DECIMALS` — chiave composita `"${network}:${asset}"` (BSC+USDT=18, Polygon+USDT=6, Polygon+USDA=18, ETH+USDT=6)
- `mcDecimalsFor(network, asset)` — lookup con fallback
- `formatMCAmount(rawUnits, decimals)` — conversione base units → human-readable
- `backfillMCHistory(items, userId)` — pura, testabile, idempotente

## Verifica sender_id vs auth.userId

`sender_id` nel payload WS è MongoDB ObjectId del User (`ref: "User"`), stesso tipo di `auth.userId`. Il confronto `sender_id === auth.userId` è corretto (H-06).

## Test: 29 nuovi test in 23-mc-history-backfill.test.ts

Coprono: decimali per rete+asset, amount conversion, direction sender/receiver, idempotenza, edge case (txHash null, Bitcoin skip, stato non released), multi-network, non interferenza con tx-monitor, TX originale `0xcd5b3e97`.

**Why:** senza la utility testabile separata, la logica decimali BSC+USDT=18 (non 6) sarebbe rimasta implicita e rotta silenziosamente su ogni refactor.
