---
name: Alpha Wallet Phase F — Finalization
description: Storico TX (tx-store IDB v3), monitor enhanced, history/detail/seed-export views, 563 test. Phase G locked.
---

## Componenti nuovi

- `wallet/services/tx-store.ts` — STORE_TX_HISTORY = "tx-history"; wallet-db bumped v2→v3; API: saveTxRecord (no-downgrade idempotent), updateTxStatus, loadTxHistory(limit,offset), loadTxHistoryByChain, loadPendingTxRecords, getTxRecord, countTxRecords, clearTxHistory
- `wallet/monitoring/tx-monitor.ts` — REWRITTEN: scrive su tx-store, reconciliation pending→confirmed, visibility-aware, exponential backoff (30s→8min), AbortController, forcePoll(), onNewTransaction callback

## Cambiamenti WalletContext

- `txHistory: WalletTxRecord[]` state esposto
- `refreshTxHistory()` ricarica store (max 100)
- `forgetWallet()` chiama `clearTxHistory()` + azzera state

## Views nuove in AlphaWalletPage

- `"history"` → HistoryView (filtri, paginazione 30×, TxListItem)
- TxDetailView (inline, copia hash, link explorer)
- `"seed-export"` → SeedExportView (auth PIN, wipe PIN da state dopo uso)
- OverviewView: pulsante Storico, backup CTA navigabile
- AssetList: ✕ remove per custom token

## Test

- `phase-f-tx-store.test.ts` (17 test)
- `phase-f-tx-monitor.test.ts` (13 test) — usa clearTxHistory()+TxMonitor.resetState() in beforeEach (non IDBFactory reset — fake-indexeddb non ha costruttore esportabile)
- `phase-f-polish.test.ts` (17 test)
- **Suite totale: 563/563 ✅**

## Invarianti di sicurezza

- SeedExportView azzera PIN da state dopo decryptSeed
- WalletTxRecord non ha campi privati (verificato da test)
- forgetWallet() pulisce tx-history

**Why:** Phase F è il prerequisito di Phase G (chat/payment integration). Phase G rimane BLOCCATA fino ad approvazione esplicita.
