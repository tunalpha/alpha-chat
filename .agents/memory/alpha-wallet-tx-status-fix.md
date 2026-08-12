---
name: Alpha Wallet TX status stuck pending
description: Diagnosi e fix del bug "In attesa di conferma..." permanente sulla bolla chat Alpha Wallet
---

## Il problema
La bolla `ChatWalletPaymentBubble` rimaneva bloccata su "In attesa di conferma..." perché tre bug si sovrapponevano.

## Bug 1 — `_reconcilePendingEvm` skip silenzioso (root cause principale)
`tx-monitor.ts`: `_reconcilePendingEvm` faceva `continue` se il tx hash NON appariva nella risposta Alchemy del round corrente. Questo succede sempre quando la TX è già stata inclusa in un blocco precedente al `lastProcessedBlock` del monitor. Risultato: il record `pending` scritto dalla bridge non veniva **mai** aggiornato.

**Fix**: per ogni pending EVM non trovato nel round corrente, chiama `eth_getTransactionReceipt` via backend (`apiWalletGetEvmReceipt`). Se confirmed/failed → `updateTxStatus`. Se pending → lascia invariato (in mempool).

## Bug 2 — ID discrepancy bridge vs monitor
La bridge scrive IDB con ID `${chainId}:${txHash}:out:chat`, il monitor scrive `buildDedupKey(chainId, hash, type, logIndex)` = es. `137:0x...:sent:0`. Due record separati, quello della bridge rimaneva pending per sempre anche se il monitor aveva già scritto il suo come confirmed.

**Fix**: la nuova `_reconcilePendingEvm` aggiorna **tutti** i record con lo stesso `txHash` in un solo ciclo.

## Bug 3 — Nessun `forcePoll` dopo broadcast
Dopo `sendPayment`, il primo poll arriva 30s dopo (o più con backoff). La TX era già confermata ma nessuno controllava.

**Fix**: in `ChatWalletBridgeProvider.sendPayment()`, dopo `saveTxRecord`, schedule `txMonitor.forcePoll()` a 15s e 45s per EVM (non BTC).

## Bug 4 — Stale closure in `useLiveTxStatus`
Il `liveStatus` catturato nell'interval era stale → `clearInterval` non scattava mai dopo confirmation.

**Fix**: usa `useRef<WalletPaymentBubbleStatus>` che riflette sempre il valore corrente.

## File modificati
- `artifacts/api-server/src/controllers/alpha-wallet.controller.ts` — `getEvmReceipt()` con viem `getTransactionReceipt`
- `artifacts/api-server/src/routes/v1/alpha-wallet.routes.ts` — `GET /evm/receipt`
- `artifacts/alpha-chat-web/src/lib/alpha-wallet-api.ts` — `apiWalletGetEvmReceipt(chainId, txHash)`
- `artifacts/alpha-chat-web/src/wallet/monitoring/tx-monitor.ts` — `_reconcilePendingEvm` con receipt fallback
- `artifacts/alpha-chat-web/src/wallet/bridge/chat-wallet-bridge-context.tsx` — `forcePoll` 15s+45s post-broadcast
- `artifacts/alpha-chat-web/src/components/chat/ChatWalletPaymentBubble.tsx` — `useRef` per stale closure

**Why**: il pattern `continue` in reconciliation era un TODO non implementato (il commento diceva "assumed confirmed" ma il codice non lo faceva mai).

**How to apply**: qualsiasi futura modifica alla reconciliation deve considerare che Alchemy `getAssetTransfers` non ritorna TX fuori dal range `fromBlock..latestBlock`; usare sempre receipt diretto come fallback per i pending.
