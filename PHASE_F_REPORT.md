# Alpha Wallet — Phase F Report
**Data completamento:** 11 agosto 2026  
**Test risultato:** 563/563 ✅ (27 file test)

---

## Obiettivo Phase F

Finalizzare Alpha Wallet senza toccare Payment Engine, USDA, ThirdWeb, WalletConnect, escrow, o Gas Station.

---

## Deliverable completati

### 1. Storico transazioni persistente (`tx-store.ts`)
- **Nuova store IDB `tx-history`** (wallet-db v2 → v3 con upgrade path)
- **`WalletTxRecord`** interface: id, chainId, network, txHash, direction, asset, amount, fromAddress, toAddress, blockNumber, fee, logIndex, timestamp, status, updatedAt
- API completa: `saveTxRecord` (idempotente, no status downgrade), `updateTxStatus`, `loadTxHistory` (paginata, ordine DESC), `loadTxHistoryByChain`, `loadPendingTxRecords`, `getTxRecord`, `countTxRecords`, `clearTxHistory`

### 2. Transaction Monitor potenziato (`tx-monitor.ts`)
- **Scrittura su tx-store** ad ogni poll (EVM + BTC)
- **Reconciliation** `pending → confirmed/failed` tramite confronto poll-over-poll
- **Visibility-aware**: pausa automatica su `document.hidden`, poll immediato al ritorno in foreground
- **Exponential backoff** su errori consecutivi: 30s → 1min → 2min → 4min → 8min (cap)
- **`AbortController`** per cleanup safe
- **`forcePoll()`** per refresh manuale
- **`onNewTransaction(cb)`** callback ora aggiorna anche `txHistory` nel context

### 3. WalletContext aggiornato
- **`txHistory: WalletTxRecord[]`** state esposto nel context
- **`refreshTxHistory()`** ricarica lo store (max 100 record)
- Monitor callback aggiornato per chiamare `refreshTxHistory()` su ogni nuova TX
- **`forgetWallet()`** chiama `clearTxHistory()` + azzera lo state

### 4. AlphaWalletPage — nuove views (Phase F)

#### HistoryView (`"history"`)
- Lista scrollabile delle TX con filtri (Tutto / Ricevuto / Inviato / In attesa)
- Paginazione lazy ("Carica altri…", 30 per pagina)
- Empty state con CTA
- `TxListItem`: icona colorata per stato/direzione, amount colorato, hash abbreviato, data/ora

#### TxDetailView (inline in HistoryView)
- Header con back button
- Importo prominente (+/- colore per direzione)
- Card con: Stato, Data, TX Hash, Da, A, Blocco, Fee
- Azioni: copia hash, link explorer (Etherscan/PolygonScan/Blockstream)
- Gestures: `Enter` su keyboard per aprire item

#### SeedExportView (`"seed-export"`)
- Autenticazione PIN prima di mostrare la phrase
- PIN azzera dalla memoria React dopo l'uso (`setPin("")`)
- Grid 3 colonne con indice + parola
- "Copia recovery phrase" (3 secondi feedback)
- Avvisi visivi su rischi di sicurezza
- Navigabile da SecurityView

#### SecurityView aggiornata
- Sezione "Recovery Phrase" con CTA → `seed-export`
- Nessuna rimozione del codice precedente (lock/forget invariati)

#### OverviewView aggiornata
- Pulsante "📋 Storico" tra Ricevi e Notifiche (sostituisce "Token" nelle actions)
- Section header "Asset" con link "+ Aggiungi" inline
- **Backup reminder potenziato**: CTA "Vedi recovery phrase →" navigabile

#### AssetList — remove custom token
- Per ogni token con `verification === "custom"`: bottone ✕ visibile su hover
- Chiama `wallet.removeToken(chainId, address)` senza propagazione click

### 5. CSS Phase F
- Aggiunte ~250 righe a `AlphaWalletPage.css`
- Classi: `.aw-history-*`, `.aw-filter-chip*`, `.aw-tx-item`, `.aw-tx-icon--*`, `.aw-tx-amount--*`, `.aw-tx-status-badge--*`, `.aw-tx-detail-*`, `.aw-asset-remove-btn`, `.aw-backup-warning-content`, `.aw-backup-warning-btn`, `.aw-section-header`, `.aw-section-link`, `.aw-history-empty`, `.aw-seed-export-*`

---

## Test scritti (Phase F)

| File | Test | Copertura |
|------|------|-----------|
| `phase-f-tx-store.test.ts` | 17 | saveTxRecord (idempotenza, no-downgrade), updateTxStatus, loadTxHistory (paginazione, ordine), loadTxHistoryByChain, loadPendingTxRecords, clearTxHistory, invarianti sicurezza |
| `phase-f-tx-monitor.test.ts` | 13 | Scrittura tx-store (EVM/BTC), reconciliation pending→confirmed, dedup ID, lifecycle (start/stop/isRunning/forcePoll), onNewTransaction callback, backoff no-crash, record integrità post-errore |
| `phase-f-polish.test.ts` | 17 | wallet-db v3 store names backward compat, sicurezza record (no seed/key), USDA address corretto, clearTxHistory idempotente, paginazione 200 TX <500ms, API surface completa |

**Totale Phase F:** 47 nuovi test  
**Totale suite:** 563 test (27 file) — tutti verdi ✅

---

## Audit sicurezza

| Check | Risultato |
|-------|-----------|
| Seed/privateKey mai nel tx-store | ✅ Verificato da test |
| PIN azzerato dalla memoria dopo SeedExportView | ✅ `setPin("")` dopo `decryptSeed` |
| SeedExportView richiede PIN valido prima di mostrare phrase | ✅ |
| `forgetWallet()` chiama `clearTxHistory()` | ✅ |
| TX hash/address pubblici solo (no key material) | ✅ Struttura WalletTxRecord senza campi privati |
| USDA contract address corretto (42 chars EVM) | ✅ `0xe714655fD1B3ba96B887DF1F94336c2A78E24001` |

---

## Fix inclusi in Phase F (produzione)

1. **BSC USDT payment bubble stuck** — `releaseMultiChainTransfer()` cascading wallet lookup; `setWalletAddress()` trigger immediato `processNewPendingTransfers()`
2. **USDA contract address** — sostituito `0x23396...` (39 chars, Invalid Token) con `0xe714655...` (AlphaBit USDA su PolygonScan)

---

## STOP CONDITION

**Phase F è completa. Phase G (chat/payment integration) rimane BLOCCATA.**  
Attendere approvazione esplicita prima di procedere con qualsiasi integrazione wallet ↔ Payment Engine.
