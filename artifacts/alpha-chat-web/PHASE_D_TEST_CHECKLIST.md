# Phase D — Test Checklist (Testnet / Piccoli Importi Reali)

> **⚠️ IMPORTANTE: Usare ESCLUSIVAMENTE importi minimi (< 1 USD equivalente) durante i test.**
> Non testare mai su mainnet con fondi significativi prima del completamento di questa checklist.

---

## Prerequisiti

- [ ] Wallet creato con mnemonic fresca (non "abandon abandon...")
- [ ] Indirizzo EVM: annotare l'indirizzo Polygon/ETH
- [ ] Indirizzo BTC: annotare l'indirizzo bc1q...
- [ ] RPC configurati: POLYGON_RPC_URL, ETHEREUM_RPC_URL, BSC_RPC_URL
- [ ] Alchemy API key configurata (per EVM history)
- [ ] Saldo minimo di test disponibile su almeno una chain

---

## 1. EVM — Native Tokens

### 1.1 Ethereum (ETH)
- [ ] **Receive ETH**: inviare ~0.001 ETH all'indirizzo dal wallet. Verificare che il saldo si aggiorni entro 60s (auto-refresh).
- [ ] **Send ETH**: inviare 0.0001 ETH a un secondo indirizzo di test. Verificare: gas stimato corretto, nonce corretto, TX broadcast con successo, saldo aggiornato.
- [ ] **TX hash**: copiare il TX hash e verificare su Etherscan che corrisponda.
- [ ] **Recovery**: aprire MetaMask con la stessa seed phrase → stesso indirizzo → stesso saldo.

### 1.2 Polygon (POL)
- [ ] **Receive POL**: inviare ~1 POL.
- [ ] **Send POL**: inviare 0.1 POL, verificare gas (< 0.001 POL), TX su PolygonScan.
- [ ] **Gas insufficiente**: tentare invio con importo che lascia meno del gas necessario → deve apparire errore chiaro prima della firma.

### 1.3 BSC (BNB)
- [ ] **Receive BNB**: inviare ~0.001 BNB.
- [ ] **Send BNB**: inviare 0.0005 BNB.
- [ ] **ATTENZIONE**: BSC USDT ha 18 decimali — verificare che il display mostri il valore corretto.

---

## 2. EVM — Token ERC-20

### 2.1 USDT su Polygon (6 decimali)
- [ ] **Balance**: verificare che 1 USDT mostri "1 USDT" (non 0.000001 USDT).
- [ ] **Receive USDT**: ricevere 0.5 USDT, verificare saldo.
- [ ] **Send USDT**: inviare 0.1 USDT, verificare calldata su PolygonScan (function: transfer).
- [ ] **Fake USDT**: NON inviare a/da contratti non verificati (verifica contract address nella schermata di conferma).

### 2.2 USDC su Polygon (6 decimali)
- [ ] **Balance**: verificare display corretto.
- [ ] **Send USDC**: inviare 0.1 USDC, verificare su PolygonScan.

### 2.3 USDA su Polygon (18 decimali)
- [ ] **Balance**: verificare che 1 USDA mostri "1 USDA" (18 decimali).
- [ ] **Contract address**: verificare che sia `0x23396cf899ca06c4472205fc903bdb4de249d6f`.

### 2.4 USDT su BSC (18 decimali)
- [ ] **Balance display**: 1 USDT BSC = 10^18 units → deve mostrare "1 USDT" (non 10^12 USDT).
- [ ] **Send USDT BSC**: verificare su BSCScan.

### 2.5 Custom Token Import
- [ ] **Token verificato**: importare USDT Polygon → deve mostrare badge "Verificato".
- [ ] **Token custom**: importare un token minore → badge "Custom", warning phishing.
- [ ] **Fake token**: importare un contratto con simbolo "USDT" ma address diverso → `symbolConflict: true` → warning visibile.
- [ ] **Decimali sbagliati**: verificare che l'app usi i decimali on-chain (da `decimals()` su contratto), non quelli hard-coded.
- [ ] **Network sbagliata**: importare un contratto ETH su Polygon → deve fallire o avvertire.

---

## 3. Bitcoin (BTC)

### 3.1 Receive
- [ ] **Indirizzo**: copiare bc1q... dall'app, inviare 0.0001 BTC (10,000 sat).
- [ ] **Balance aggiornato**: verificare saldo confermato entro 1 blocco (~10 min).
- [ ] **TX su Blockstream**: verificare txid su `blockstream.info/tx/<txid>`.

### 3.2 Send
- [ ] **UTXO selection**: verificare che l'app selezioni UTXOs correttamente (greedy largest-first).
- [ ] **Fee calculation**: verificare fee rate, vbytes stimati, fee totale mostrata prima della firma.
- [ ] **Change**: se change > 546 sat, deve apparire un output change al proprio indirizzo.
- [ ] **Dust**: tentare invio di 545 sat → errore "importo inferiore al dust limit".
- [ ] **Importo = saldo**: tentare invio dell'intero saldo → deve calcolare fee e rifiutare se non ci sono fondi per la fee.
- [ ] **Fee spike**: simulare fee rate molto alto (modifica manuale) → app deve mostrare errore se saldo insufficiente.

### 3.3 UTXO Edge Cases
- [ ] **Multiple UTXO**: frammentare il saldo in 3+ UTXO piccoli, poi inviare un importo che richiede la combinazione.
- [ ] **Confirmed only**: verificare che solo UTXO confermati vengano usati per la firma.
- [ ] **RBF**: verificare che le transazioni abbiano `sequence: 0xfffffffd` (RBF enabled).

---

## 4. Recovery Interoperability

### 4.1 EVM BIP-44 (m/44'/60'/0'/0/0)
- [ ] Alpha Wallet → Settings → Export Phrase → annotare 12 parole
- [ ] MetaMask: import seed → verificare address (deve coincidere)
- [ ] Ledger Live: import seed → verificare address (deve coincidere)
- [ ] Balance: deve coincidere in tutti i wallet

### 4.2 BTC BIP-84 (m/84'/0'/0'/0/0)
- [ ] Alpha Wallet → Settings → Export Phrase → annotare 12 parole
- [ ] BlueWallet: import seed → verificare address bc1q... (deve coincidere)
- [ ] Trezor Suite: import seed → Native SegWit → verificare address (deve coincidere)
- [ ] Balance: deve coincidere

---

## 5. PWA / iOS Edge Cases

Testare i seguenti scenari e documentare il risultato:

- [ ] **App chiusa durante firma**: PIN inserito, processing → swipe-up/close → riaprire. La TX è stata inviata?
- [ ] **Safari sospeso**: app in background 30 min → riaprire → balance corretto?
- [ ] **Schermo di conferma già mostrato**: app sospesa dopo confirm → riaprire → deve tornare allo stato "confirm"?
- [ ] **RPC cade durante broadcast**: simulare fallimento del backend → deve mostrare errore, NON silenziosamente perdere la TX.
- [ ] **Broadcast fallisce dopo firma**: la TX è firmata localmente ma il broadcast fallisce. Documentare se c'è un modo per ri-inviare.

---

## 6. Notifiche

- [ ] **Incoming EVM**: ricevere ETH → notifica "Ricevuto ETH"
- [ ] **Incoming BTC**: ricevere BTC → notifica "Ricevuto BTC"
- [ ] **Confirmed**: dopo conferma → notifica "Confermato"
- [ ] **Anti-duplicate**: stessa TX non deve generare due notifiche
- [ ] **No PII**: verificare che nessuna notifica contenga seed/PIN/private key

---

## 7. Firma e Schermata di Conferma

Per ogni transazione verificare che la schermata di conferma mostri:

- [ ] Chain / Network
- [ ] Recipient address (completo)
- [ ] Asset (symbol + contract address per ERC-20)
- [ ] Amount
- [ ] Fee / gas
- [ ] Nonce (solo per EVM, opzionale in UI ma deve essere nella TX firmata)
- [ ] Totale detratto dal saldo

---

## Risultati da riportare nel Phase D Report

| Test | Risultato | TX Hash | Note |
|------|-----------|---------|------|
| ETH receive | | | |
| ETH send | | | |
| POL receive | | | |
| POL send | | | |
| USDT Polygon send | | | |
| BTC receive | | | |
| BTC send | | | |
| Recovery EVM | | | |
| Recovery BTC | | | |
