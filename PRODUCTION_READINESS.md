# Alpha Wallet — Production Readiness Checklist

**Versione:** Phase G #91  
**Prerequisiti:** Phase G #90 (fee reliability) completata ✅  
**Stato:** 🔴 Da eseguire prima dell'apertura utenti

---

## Pipeline da verificare

```
Chat
↓
Quote (fee_bps, quote_validity_sec dal backend)
↓
Platform Fee (calcolata e congelata nella frozenQuote)
↓
Network/Miner Fee (~stima; reale calcolata in fase di firma)
↓
Conferma (UI mostra: Destinatario / Platform fee / Network fee / Totale)
↓
PIN / Face ID (onAuthRequired callback — sempre richiesta)
↓
Firma locale (mnemonic decriptato, key derivata, TX firmata offline)
↓
Broadcast (backend proxy — solo tx hex, mai private key)
↓
Blockchain (on-chain confirmation)
↓
Fee collection (atomica per BTC; separata con retry per EVM)
↓
Confirmation bubble (ChatWalletPaymentBubble)
↓
History (tx-store IDB)
```

---

## Checklist Testnet

### A. Setup ambiente testnet

| Operazione | Rete | Stato |
|---|---|---|
| Configura `POLYGON_CHAIN_ID=80002` (Amoy) | Polygon | ⬜ |
| Configura `BTC_NETWORK=testnet` | Bitcoin | ⬜ |
| Ottieni test USDT su Polygon Amoy da faucet | Polygon | ⬜ |
| Ottieni test BTC da faucet Blockstream | Bitcoin | ⬜ |
| Verifica `POLYGON_FEE_WALLET` configurato | Polygon | ⬜ |
| Verifica `BTC_FEE_WALLET` configurato (bc1q...) | Bitcoin | ⬜ |

### B. EVM — Polygon USDT (priorità massima)

| Test case | Risultato atteso | Stato |
|---|---|---|
| **B1.** Chat → seleziona utente → attach → "Paga con Wallet" | ChatWalletPaySheet si apre | ⬜ |
| **B2.** Seleziona Polygon, USDT, importo 1.00 | Quote mostra: destinatario, platform fee (0.10%), network fee (~POL), totale | ⬜ |
| **B3.** Timer countdown visibile (30s default) | Countdown funziona, quote scade dopo timeout | ⬜ |
| **B4.** Conferma → inserisci PIN → firma | TX firmata e broadcaster | ⬜ |
| **B5.** Verifica TX on Polygon Amoy PolygonScan | TX con 2 output: destinatario + fee wallet | ⬜ |
| **B6.** Fee wallet riceve platform fee (0.001 USDT su 1 USDT) | Saldo fee wallet aumenta di 0.001 USDT | ⬜ |
| **B7.** Bubble appare nella chat (entrambi i lati) | `ChatWalletPaymentBubble` con status "sent" | ⬜ |
| **B8.** History wallet aggiornata | TX appare in AlphaWalletPage → History | ⬜ |
| **B9.** Backend `alpha_wallet_fee_records` → record "success" | MongoDB ha un record per mainTxHash | ⬜ |

### C. EVM — Native (POL/ETH/BNB)

| Test case | Risultato atteso | Stato |
|---|---|---|
| **C1.** Invia 0.01 POL (native Polygon) | TX on-chain, fee separata in POL | ⬜ |
| **C2.** Invia 0.001 ETH (Ethereum Sepolia) | TX su Sepolia, fee in ETH | ⬜ |
| **C3.** Invia 0.001 BNB (BSC testnet) | TX su BSC testnet, fee in BNB | ⬜ |

### D. Bitcoin testnet

| Test case | Risultato atteso | Stato |
|---|---|---|
| **D1.** Chat → "Paga con Wallet" → seleziona Bitcoin | PaySheet mostra rete Bitcoin | ⬜ |
| **D2.** Importo 0.0001 BTC (~10,000 sat) | Quote: importo + platform fee (sat) + miner fee | ⬜ |
| **D3.** Firma e broadcast | TX su testnet3 Blockstream | ⬜ |
| **D4.** Verifica TX: 2 output (recipient + fee wallet) | PSBT atomico: ambedue gli output in 1 TX | ⬜ |
| **D5.** Platform fee zero/sotto dust → 1 solo output | Se fee < 546 sat → solo recipient output | ⬜ |

### E. Scenari di fallimento

| Test case | Risultato atteso | Stato |
|---|---|---|
| **E1.** Quote scade durante inserimento PIN | Errore "Quote scaduta" — nessuna TX inviata | ⬜ |
| **E2.** PIN errato | "PIN errato" — nessuna TX inviata | ⬜ |
| **E3.** PIN cancellato (tap fuori modale) | `status: "cancelled"` — nessuna TX | ⬜ |
| **E4.** Saldo insufficiente USDT | Errore `INSUFFICIENT_BALANCE` — nessuna TX | ⬜ |
| **E5.** Destinatario non valido | Errore nella validazione before sign | ⬜ |
| **E6.** Disconetti rete dopo firma EVM, prima broadcast | `NETWORK_ERROR` — nonce non consumato → retry sicuro | ⬜ |
| **E7.** Due tap veloci su "Conferma" | Solo 1 TX inviata — `DOUBLE_SEND_PREVENTED` sul 2° tap | ⬜ |
| **E8.** Wallet bloccato tra apertura sheet e conferma | Auth richiesta → PIN resetta il blocco | ⬜ |

### F. Fee collection failure scenarios

| Test case | Risultato atteso | Stato |
|---|---|---|
| **F1.** Fee wallet EVM non configurato | Fee ignorata silenziosamente, pagamento completato | ⬜ |
| **F2.** Fee wallet BTC non configurato | PSBT con solo 1 output (recipient), pagamento completato | ⬜ |
| **F3.** Fee TX EVM fallisce (nonce conflitto) | Retry con nonce+1 entro 1.5s | ⬜ |
| **F4.** Entrambi i retry EVM falliti | Record `failed_permanent` in DB, alert pino WARN | ⬜ |
| **F5.** Fee BTC atomica — se main TX fallisce | Nessun addebito a nessuno (sia recipient che fee wallet non pagati) | ⬜ |

### G. Payment Engine isolation

| Test case | Risultato atteso | Stato |
|---|---|---|
| **G1.** Pagamento Alpha Wallet → verifica no effetto su mc_transfers | Collezione `mc_transfers` inalterata | ⬜ |
| **G2.** Pagamento custodial USDT → verifica no effetto su alpha_wallet_fee_records | Collezione `alpha_wallet_fee_records` inalterata | ⬜ |
| **G3.** Entrambi i sistemi funzionano in parallelo (stesso utente) | Nessuna interferenza | ⬜ |

---

## Limitazioni note (da documentare agli utenti)

### L1. EVM: Broadcast success senza risposta
**Scenario:** TX firmata, broadcast inviato, risposta di rete persa (timeout).  
**Effetto:** L'app mostra `NETWORK_ERROR` ma la TX potrebbe già essere in mempool.  
**Mitigazione:** L'utente deve verificare on-chain prima di ritentare.  
**Fix futuro:** Salva il tx hash PRIMA del broadcast, poll on-chain per conferma.

### L2. EVM fee collection non atomica
**Scenario:** Main TX confermata, fee TX fallisce anche dopo retry.  
**Effetto:** Platform perde la fee. Record `failed_permanent` in DB.  
**Mitigazione:** Admin riceve alert pino WARN, può intervenire manualmente.  
**Fix futuro:** TX multi-output via smart contract batch (gasToken model).

### L3. BTC fee sotto dust (< 546 sat)
**Scenario:** Importo molto piccolo → platform fee < 546 sat.  
**Effetto:** Fee output non aggiunto al PSBT (sotto dust limit Bitcoin).  
**Mitigazione:** Documentato — fee minima BTC = max(0.10%, 546 sat).

### L4. Stima network fee approssimativa in quote
**Scenario:** La quote mostra `~0.002 POL` per EVM, `~0.00001 BTC` per BTC.  
**Effetto:** La fee reale potrebbe differire durante gas spike.  
**Mitigazione:** Il pagamento usa la fee reale calcolata al momento della firma; la quote è un'indicazione.

---

## Comandi di verifica backend

```bash
# Verifica record fee (super_admin)
curl -H "Authorization: Bearer $TOKEN" \
  $API_BASE/api/v1/alpha-wallet/fee-records?status=failed_permanent

# Verifica configurazione fee corrente
curl -H "Authorization: Bearer $TOKEN" \
  $API_BASE/api/v1/alpha-wallet/fee-config

# Conta fee permanentemente fallite
curl -H "Authorization: Bearer $TOKEN" \
  "$API_BASE/api/v1/alpha-wallet/fee-records?status=failed_permanent&limit=1" \
  | jq '.data.summary'
```

---

## Criteri di apertura utenti (gate)

Tutti i seguenti devono essere ✅ prima dell'apertura pubblica:

- [ ] Tutti i test B1-B9 (Polygon USDT) superati su testnet
- [ ] Almeno D1-D4 (Bitcoin) superati su testnet  
- [ ] Tutti gli scenari E1-E8 (failure) verificati
- [ ] F4 verificato: alert pino WARN su permanent fee failure
- [ ] G1-G3 verificati: Payment Engine isolato
- [ ] Almeno 10 TX reali complete (end-to-end, piccoli importi)
- [ ] Fee wallet ha ricevuto fondi reali per almeno 5 TX
- [ ] Nessun record `failed_permanent` non spiegato in alpha_wallet_fee_records
- [ ] Build CI pulito (596+ test verdi)
- [ ] Codice review da un secondo sviluppatore su btc-signer.ts + platform-fee-collector.ts

---

*Documento generato automaticamente da Phase G #91 Production Readiness Audit*
