---
name: Spark IDB Analysis
description: Contenuto reale del database IndexedDB creato dal Breez SDK WASM dopo connect() su mainnet. Analisi cifatura e sicurezza.
---

## Database

- Nome: `breez-poc-live-v1/mainnet/d2ea863c` (schema v15)
- Creato da: `connect()` con `storageDir: "breez-poc-live-v1"`

## Store presenti (10 totali)

| Store | Count | Note |
|-------|-------|------|
| contacts | 0 | vuoto |
| lnurl_receive_metadata | 15 | record con paymentHash, nostrZapRequest/Receipt, senderComment |
| payment_metadata | 0 | vuoto |
| payments | 282 | storico pagamenti da seed pubblica condivisa |
| settings | 7 | account_info, last_sync_time, lightning_address, etc. |
| sync_incoming | 0 | vuoto |
| sync_outgoing | 0 | vuoto |
| sync_revision | 1 | `{"id":1,"revision":"42"}` |
| sync_state | 1 | tipo LightningAddress |
| unclaimed_deposits | 0 | vuoto |

## ⚠️ FINDING CRITICO: IDB NON CIFRATA

I valori sono **plain JSON leggibile** — NON cifrati:
- `lnurl_receive_metadata`: paymentHash in chiaro, senderComment in chiaro
- `payments`: invoice Lightning leggibili, htlcDetails con paymentHash e **preimage HTLC** in chiaro
- `settings`: `{"key":"account_info","value":"{\"balance_sats\":0,\"token_balances\":{}}"}`

**Preimage HTLC**: è la "password" che prova il pagamento Lightning. Se un attaccante legge l'IDB, può accedere allo storico dei pagamenti con tutti i dettagli. Tuttavia, il preimage è necessario solo per reclaim — non per muovere fondi futuri.

## ⚠️ 282 pagamenti sul test mnemonic

Il mnemonic "abandon x11 about" è condiviso → altri dev hanno pagato con la stessa seed → 282 record nel DB. Nei sample non appaiono mnemonic né chiavi private, solo dati di pagamento.

## Chiavi private / mnemonic: NON trovati nell'IDB

Il seed/mnemonic NON è persistito nell'IDB da Breez SDK. Confermato: ExternalSigner deriva le chiavi in memoria.

## Implicazioni per produzione

1. **IDB leggibile**: un utente su un device condiviso o con accesso al browser DevTools può leggere lo storico pagamenti.
2. **Alpha Wallet già cifra Signal IDB** (AES-256-GCM) — lo stesso deve essere valutato per Spark IDB.
3. **Breez SDK non supporta custom storage encryption** — l'IDB è gestita internamente dal WASM. Cifratura layer aggiuntivo richiede intercettare le API IDB.
4. **RACCOMANDAZIONE**: Nella fase di go-live, valutare se cifrare l'IDB Spark è necessario o se la policy di Alpha è sufficiente (mnemonic non presente → rischio ridotto).
5. **NON modificare il database interno SDK** senza supporto ufficiale Breez.

## iPhone simulation (390×844 viewport, Safari UA)

- connect() PASS, syncWallet() PASS (10374ms), listPayments() PASS
- crossOriginIsolated = true anche su UA iPhone (proxy Replit mantiene COOP/COEP)
- SharedArrayBuffer disponibile su UA mobile (test Replit env — su iPhone Safari reale da verificare)
- NOTA: questo era un test simulato su desktop con UA modificato. Test reale su device fisico iOS è ancora necessario per verificare il comportamento WebSocket in background.
