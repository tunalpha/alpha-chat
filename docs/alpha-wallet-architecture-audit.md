# ALPHA WALLET — Documento di Architettura (Fase 1 Audit)

> **STATO: SOLO AUDIT — NESSUN FILE MODIFICATO**
> Prodotto il: 2026-08-11
> Versione: 1.0

---

## 1. EXECUTIVE SUMMARY

Il progetto Alpha Wallet è fattibile come modulo completamente nuovo e isolato dentro Alpha Chat.

Il backend dispone già delle librerie necessarie (`viem`, `bitcoinjs-lib`, `tiny-secp256k1`). Il frontend necessita di nuove librerie crittografiche leggere. La sfida principale non è la crittografia ma la **sicurezza dello storage delle chiavi su PWA/iOS**, dove le limitazioni del browser impongono scelte architetturali specifiche.

Il Payment Engine esistente non viene toccato in nessun punto.

---

## 2. STATO ATTUALE — COSA ESISTE GIÀ

### 2.1 Frontend (`artifacts/alpha-chat-web`)

| Elemento | Stato | Note |
|---|---|---|
| `WalletCenterPage.tsx` | Esiste | Pagina stub USDA-oriented, badge "USDA" |
| `thirdweb` 5.x | Installato | Usato per USDA/payment. **NON toccare.** |
| `qrcode` + `jsqr` | Installati | Riutilizzabili per QR del wallet |
| RPC/signing frontend | Assente | Nessun viem/ethers/wagmi nel frontend |
| Navigazione | Custom state | `AppView` enum in `App.tsx`, nessun React Router |
| Design system | CSS custom | Dark purple/glassy, variabili CSS `--brand-1` |
| WebAuthn/biometria | Parziale | `LockContext` con Face ID per Phoenix Lock |

### 2.2 Backend (`artifacts/api-server`)

| Libreria | Versione | Usabile per Alpha Wallet |
|---|---|---|
| `viem` | ^2.55.4 | ✅ RPC reads, broadcast |
| `bitcoinjs-lib` | ^7.0.1 | ✅ BTC address derivation, PSBT |
| `ecpair` | ^3.0.1 | ✅ BTC key pairs |
| `tiny-secp256k1` | ^2.2.4 | ✅ EC primitives |
| `native-price-provider.ts` | esistente | ✅ CoinGecko ETH/MATIC/BNB — riutilizzabile |
| RPC infrastructure | esistente | ✅ Polygon/ETH/BSC/BTC già configurati |

### 2.3 MongoDB — Campi wallet già presenti in `user.model.ts`

```
user.wallets.{usda,polygon,ethereum,bitcoin,lightning}.address
user.wallet_address  (deprecated)
user.wallet_enabled
user.wallet_id
```

I nuovi campi del wallet Alpha saranno **separati** — in un nuovo modello `AlphaWallet`.

---

## 3. ARCHITETTURA COMPLETA

```
Alpha Chat
│
├── Payment Engine (NON TOCCARE)
│     ├── MultiChain Transfer (escrow, gas station, fee engine)
│     ├── USDA Payment Flow
│     ├── BTC Escrow
│     └── WalletConnect / ThirdWeb / Trust Wallet
│
└── Alpha Wallet (NUOVO — completamente isolato)
      │
      ├── Core
      │     ├── BIP-39 mnemonic generation
      │     ├── BIP-32/44/84 HD derivation
      │     ├── Key encryption (WebCrypto AES-256-GCM)
      │     └── WebAuthn / PIN auth
      │
      ├── EVM Module
      │     ├── Networks: Ethereum, Polygon, BSC
      │     ├── Token Registry (ETH/POL/BNB + USDT/USDC/USDA)
      │     ├── Balance reader (via RPC)
      │     ├── Transaction builder + signer (locale)
      │     └── Broadcaster
      │
      ├── Bitcoin Module
      │     ├── BIP-84 SegWit (bc1q...)
      │     ├── UTXO fetcher (Blockstream API)
      │     ├── Fee estimator
      │     ├── PSBT builder + signer (locale)
      │     └── Broadcaster
      │
      └── UI
            ├── WalletOverview
            ├── SendSheet (EVM + BTC)
            ├── ReceiveSheet (EVM + BTC)
            ├── SecurityPage (backup/export/import)
            └── TransactionHistory
```

---

## 4. STANDARD WALLET — DERIVATION PATHS

### 4.1 EVM (Ethereum / Polygon / BSC)

```
Standard:       BIP-39 + BIP-32 + BIP-44
Mnemonic:       12 o 24 parole inglesi (wordlist BIP-39 ufficiale)
Derivation:     m / 44' / 60' / 0' / 0 / index
Account 0:      m/44'/60'/0'/0/0
```

- Un solo seed → stessa chiave privata → stesso indirizzo su Ethereum, Polygon e BSC (tutte EVM)
- Compatibile con MetaMask, Trust Wallet, Ledger, Trezor, Rainbow

### 4.2 Bitcoin

```
Standard:       BIP-39 + BIP-32 + BIP-84
Tipo indirizzo: Native SegWit (P2WPKH) → bc1q...
Derivation:     m / 84' / 0' / 0' / 0 / index
Account 0:      m/84'/0'/0'/0/0
```

- `bc1q...` = bech32 = fee più basse, compatibilità moderna
- Stesso seed EVM → `BIP-84` path → Bitcoin address diverso (corretto per design)
- Compatibile con BlueWallet, Electrum (BIP-84), Bitcoin Core

### 4.3 Test di compatibilità obbligatorio

```
Alpha Wallet → export seed → MetaMask (EVM) → stesso address ✓
Alpha Wallet → export seed → BlueWallet (BTC, BIP-84) → stesso address ✓
```

---

## 5. KEY MANAGEMENT — STORAGE E SICUREZZA

### 5.1 Modello di minaccia PWA

| Vettore | Rischio |
|---|---|
| `localStorage` chiaro | ❌ Critico — accessibile da XSS, da qualsiasi JS |
| `IndexedDB` chiaro | ❌ Critico — stessa esposizione |
| `IndexedDB` cifrato | ⚠️ Accettabile — sicuro se la chiave di cifratura è protetta correttamente |
| `sessionStorage` | ❌ Non persistente, non utilizzabile |
| iOS Keychain | ✅ Solo via native app (Capacitor) — non accessibile da PWA |
| Secure Enclave | ✅ Solo via native app |
| WebCrypto + WebAuthn | ✅ Soluzione ottimale per PWA |

### 5.2 Architettura di storage consigliata

```
┌─────────────────────────────────────────────────────────┐
│                     ALPHA WALLET                        │
│                                                         │
│  Seed phrase / private key                              │
│         ↓                                               │
│  Cifratura AES-256-GCM (WebCrypto)                     │
│  usando una chiave derivata in due modi alternativi:    │
│                                                         │
│  Opzione A (WebAuthn disponibile — iOS 16+, Chrome):   │
│    WebAuthn credential → largeBlob / prf extension      │
│    → chiave di cifratura deterministica                 │
│                                                         │
│  Opzione B (fallback — PIN):                            │
│    PIN utente → PBKDF2 (100k iter, SHA-256)             │
│    + salt casuale (salvato in IndexedDB non cifrato)    │
│    → chiave di cifratura                                │
│                                                         │
│  Wallet cifrato → IndexedDB                             │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### 5.3 Limitazione critica su iOS PWA

**Problema**: Su iOS Safari PWA, IndexedDB ha una quota di storage e può essere svuotato dal sistema operativo dopo 7 giorni di inattività o in caso di pressione memoria.

**Conseguenza**: L'utente potrebbe perdere il wallet cifrato senza perdere i fondi on-chain (recuperabili via seed).

**Soluzione**: Warning esplicito durante il setup + obbligare il backup seed prima di qualsiasi deposito.

**Soluzione definitiva (futura)**: App nativa iOS/Android via Capacitor → accesso a iOS Keychain e Secure Enclave.

### 5.4 Cosa NON deve mai succedere

```
❌  seed_phrase → fetch() / API request
❌  private_key → MongoDB / log / Sentry / analytics
❌  seed_phrase → localStorage in chiaro
❌  private_key → window object / globalThis
❌  seed_phrase → console.log() anche in sviluppo
```

### 5.5 Cosa il backend può ricevere/sapere

```
✅  EVM address (0x...)
✅  BTC address (bc1q...)
✅  transaction hash
✅  balance (lettura pubblica da RPC)
✅  UTXO set (lettura pubblica)
✅  confirmation status
✅  network identifier
```

---

## 6. LIBRERIE CONSIGLIATE

### 6.1 Frontend (nuove dipendenze)

| Libreria | Versione | Scopo | Perché |
|---|---|---|---|
| `@scure/bip39` | ^1.5.x | Generazione e validazione mnemonic | Audit sicurezza eccellente, zero dipendenze |
| `@scure/bip32` | ^1.6.x | HD derivation BIP-32/44/84 | Stessa famiglia, audit Cure53 |
| `@noble/secp256k1` | ^2.x | EC operations EVM | Puro JS, 0 deps, performante |
| `@noble/hashes` | ^1.x | SHA256, RIPEMD160, PBKDF2 | Stesso autore, già dipendenza transitiva |
| `viem` | ^2.x | Signing EVM, encoding calldata, broadcast | Già nel backend, API moderna |
| `bitcoinjs-lib` | ^7.x | BTC address derivation, PSBT | Già nel backend |
| `tiny-secp256k1` | ^2.x | EC BTC (peer di bitcoinjs-lib) | Già nel backend |

> **Nota**: Usare le librerie `@scure/*` e `@noble/*` dello stesso autore (Paulmillr) garantisce coerenza e minimizza la surface d'attacco. Sono le stesse usate internamente da viem e wagmi.

### 6.2 Backend (nessuna nuova dipendenza)

Il backend Alpha Wallet userà solo:
- `viem` (già installato) — per leggere balance EVM e fare broadcast
- `bitcoinjs-lib` + `ecpair` + `tiny-secp256k1` (già installati) — per BTC
- `native-price-provider.ts` (esistente) — per fiat valuation

---

## 7. TOKEN REGISTRY

### 7.1 Struttura

```typescript
interface TokenConfig {
  chainId: number;
  symbol: string;
  name: string;
  decimals: number;
  contractAddress?: `0x${string}`;  // undefined = native
  standard: "native" | "ERC-20";
  logoUrl: string;
  explorerUrl: string;
  coingeckoId: string;  // per price feed
}
```

### 7.2 Token ufficiali verificati

**Ethereum (chainId: 1)**

| Symbol | Contract Address (verificato Etherscan) | Decimals |
|---|---|---|
| ETH | native | 18 |
| USDT | `0xdAC17F958D2ee523a2206206994597C13D831ec7` | 6 |
| USDC | `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48` | 6 |

**Polygon (chainId: 137)**

| Symbol | Contract Address (verificato Polygonscan) | Decimals |
|---|---|---|
| POL | native | 18 |
| USDT | `0xc2132D05D31c914a87C6611C10748AEb04B58e8F` | 6 |
| USDC | `0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359` | 6 |
| USDA | `0x23396cF899Ca06c4472205fC903bDB4de249D6f` | 18 |

**BSC (chainId: 56)**

| Symbol | Contract Address (verificato BSCScan) | Decimals |
|---|---|---|
| BNB | native | 18 |
| USDT | `0x55d398326f99059fF775485246999027B3197955` | 18 |
| USDC | `0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d` | 18 |

> ⚠️ **NOTA CRITICA**: USDT su BSC ha 18 decimali, non 6. Questo è un errore comune che causa bug critici di amount display.

**Bitcoin (mainnet)**

| Symbol | Type | Derivation |
|---|---|---|
| BTC | UTXO native | BIP-84 m/84'/0'/0'/0/0 |

### 7.3 Anti-confusion

Il token registry è la fonte di verità. Qualsiasi token non presente nel registry viene rifiutato dall'UI. Nessun "custom token" nella versione iniziale — previene phishing.

---

## 7b. CUSTOM EVM TOKEN IMPORT — Requisito V1

### 7b.1 Motivazione

Un wallet professionale deve permettere all'utente di aggiungere token ERC-20 non presenti nel registry ufficiale. Questa funzionalità deve essere implementata in V1 con protezioni anti-phishing esplicite.

### 7b.2 Flusso import

```
User → "Importa Token"
         ↓
Seleziona rete (Ethereum / Polygon / BSC)
         ↓
Inserisce contract address (0x...)
         ↓
Backend legge dal contratto via viem multicall:
  - name()     → es. "Tether USD"
  - symbol()   → es. "USDT"
  - decimals() → es. 6
         ↓
Frontend mostra anteprima:
  ⚠️ Token personalizzato
  Name: Tether USD
  Symbol: USDT
  Decimals: 6
  Network: Polygon
  Contract: 0xabcd...efgh
         ↓
Verifica anti-phishing:
  Se symbol === token verificato (USDT/USDC/USDA) → warning rosso:
  "⚠️ Un token con questo simbolo è già presente nel registro ufficiale.
   Verifica l'indirizzo prima di aggiungere."
         ↓
User conferma → salvato in IndexedDB come token "custom"
```

### 7b.3 Struttura dati

```typescript
type TokenVerification = "verified" | "custom";

interface TokenConfig {
  chainId: number;
  symbol: string;
  name: string;
  decimals: number;
  contractAddress?: `0x${string}`;  // undefined = native
  standard: "native" | "ERC-20";
  logoUrl?: string;
  explorerUrl: string;
  coingeckoId?: string;
  verification: TokenVerification;  // OBBLIGATORIO
  importedAt?: Date;                 // solo per custom
}
```

### 7b.4 Regola anti-phishing — OBBLIGATORIA

```
Token VERIFIED:
  ├── Badge verde: ✅ Verificato
  ├── Da VERIFIED_TOKENS registry
  └── Mai sovrascrivibile da token custom

Token CUSTOM:
  ├── Badge arancione: ⚠️ Personalizzato
  ├── Symbol identico a token verificato → warning rosso + conferma doppia
  ├── Mai mostrato senza il badge ⚠️
  └── Salvato in IndexedDB separato da VERIFIED_TOKENS
```

### 7b.5 Backend endpoint necessario

```
GET /api/v1/alpha-wallet/evm/token-info?address=0x...&chainId=137
→ { name, symbol, decimals, totalSupply, isVerified }
```

Il backend usa viem `readContract` per leggere i campi ERC-20 standard.
Restituisce anche `isVerified: true` se l'address corrisponde a un token nel VERIFIED_TOKENS registry.

### 7b.6 Gestione custom tokens

```typescript
// IndexedDB store separato: "alpha-wallet-custom-tokens"
interface CustomTokenStore {
  chainId: number;
  contractAddress: string;
  symbol: string;
  name: string;
  decimals: number;
  addedAt: number;  // timestamp
}
```

I custom token vengono sempre mostrati **dopo** i token verificati nella lista asset.

---

## 8. EVM NETWORK REGISTRY

```typescript
interface EvmNetwork {
  chainId: number;
  name: string;
  shortName: string;
  nativeToken: string;
  rpcUrls: string[];
  explorerUrl: string;
  gasConfig: {
    maxFeePerGas?: bigint;
    maxPriorityFeePerGas?: bigint;
  };
  tokens: TokenConfig[];
}
```

| Network | chainId | RPC primary |
|---|---|---|
| Ethereum | 1 | Alchemy (ALCHEMY_API_KEY) |
| Polygon | 137 | POLYGON_RPC_URL |
| BSC | 56 | BSC_RPC_URL |

I RPC esistenti in `multichain-config.ts` vengono riutilizzati **in lettura** dal backend Alpha Wallet senza modificare multichain-config.ts (che appartiene al Payment Engine).

---

## 9. SIGNING — FLUSSO COMPLETO

### 9.1 EVM Send

```
User → Wallet UI
         ↓
1. Costruire tx parameters (to, value, data)
         ↓
2. Stimare gas (RPC eth_estimateGas via backend proxy)
         ↓
3. Mostrare schermata di conferma anti-phishing:
   Asset / Network / Amount / To / Gas fee / Total
         ↓
4. User conferma → WebAuthn / PIN challenge
         ↓
5. Decriptare private key da IndexedDB (solo in memoria)
         ↓
6. Firmare tx localmente (viem signTransaction o @noble/secp256k1)
         ↓
7. Eliminare private key dalla memoria
         ↓
8. Inviare tx firmata al backend /api/v1/alpha-wallet/broadcast
         ↓
9. Backend → eth_sendRawTransaction → RPC → blockchain
         ↓
10. Tornare tx hash → storico locale
```

### 9.2 BTC Send

```
User → Wallet UI
         ↓
1. Fetch UTXO (Blockstream API via backend)
         ↓
2. Coin selection (priorità UTXO più vecchi)
         ↓
3. Calcolare fee (sat/vbyte via mempool.space o Blockstream)
         ↓
4. Schermata conferma: BTC / Destination / Fee / Change / Total
         ↓
5. WebAuthn / PIN challenge
         ↓
6. Decriptare private key da IndexedDB (solo in memoria)
         ↓
7. Costruire e firmare PSBT (bitcoinjs-lib)
         ↓
8. Eliminare private key dalla memoria
         ↓
9. Inviare tx raw al backend /api/v1/alpha-wallet/btc/broadcast
         ↓
10. Backend → Blockstream broadcast → mempool
         ↓
11. Tornare tx hash → storico locale
```

---

## 10. AUTENTICAZIONE LOCALE DEL WALLET

Il wallet richiede autenticazione specifica indipendente dall'account Alpha Chat.

### 10.1 Gerarchia

```
Livello 1: WebAuthn (Face ID, Touch ID, Passkey) — preferito
Livello 2: PIN 6 cifre → PBKDF2 → chiave AES — fallback
```

### 10.2 Quando richiesta

- Ogni firma di transazione (Send EVM / Send BTC)
- Ogni esportazione seed phrase
- Ogni esportazione private key
- Prima apertura del wallet (setup o unlock)

### 10.3 Timeout sessione

Dopo autenticazione, la private key decifrata rimane in memoria solo per il tempo necessario alla firma. Non viene mai salvata in variabili globali o state React.

---

## 11. BACKUP E RECOVERY

### 11.1 Flusso di setup obbligatorio

```
Create Alpha Wallet
         ↓
Genera mnemonic 12 parole (BIP-39)
         ↓
⚠️ AVVISO: "Alpha Chat non può recuperare il tuo wallet se perdi
           la recovery phrase. Sei l'unico responsabile del backup."
         ↓
Mostra seed phrase (24 parole o 12)
         ↓
Verifica: l'utente deve inserire 3 parole casuali in posizione corretta
         ↓
Solo dopo la verifica → wallet attivo
```

### 11.2 Export successivo

```
Wallet → Security → Backup Wallet
         ↓
WebAuthn / PIN challenge
         ↓
Scelta: "Show Recovery Phrase" | "Export Private Key"
         ↓
Mostra in overlay non copiabile-da-screenshot
(o copia esplicita con avviso)
         ↓
Auto-chiude dopo 60 secondi
```

### 11.3 Import / Recovery

```
Restore Wallet
├── Recovery Phrase → inserire 12 o 24 parole
└── Private Key → inserire hex o WIF (BTC)
         ↓
Derivare address → verificare on-chain che ci siano fondi
         ↓
Cifrare e salvare in IndexedDB
```

---

## 12. TRANSACTION HISTORY

Storico completamente indipendente dal Payment Engine.

### 12.1 Storage

Due livelli:
1. **Cache locale (IndexedDB)** — transazioni recenti per accesso rapido offline
2. **Backend MongoDB** — `AlphaWalletTxModel` — solo metadata pubblici (no chiavi)

```typescript
interface AlphaWalletTx {
  userId: ObjectId;
  network: "ethereum" | "polygon" | "bsc" | "bitcoin";
  asset: string;         // "USDT", "ETH", "BTC"...
  type: "send" | "receive";
  amount: string;        // stringa per BigInt safety
  amountFiat: number;    // calcolato al momento tx
  from: string;
  to: string;
  txHash: string;
  fee: string;
  status: "pending" | "confirmed" | "failed";
  blockNumber?: number;
  confirmations?: number;
  timestamp: Date;
  explorerUrl: string;
}
```

### 12.2 Fonti

- **EVM**: polling `eth_getTransactionReceipt` + Alchemy `alchemy_getAssetTransfers` per storia precedente
- **BTC**: Blockstream `GET /api/address/{addr}/txs`

---

## 13. WALLET OVERVIEW — PRICE FEED

Il totale fiat viene calcolato con:
- `native-price-provider.ts` (esistente nel backend) per ETH, MATIC/POL, BNB
- CoinGecko `simple/price` per BTC e USDA (aggiungere al provider esistente)
- USDT e USDC: sempre = $1.00 (stablecoin)

**Endpoint nuovo**: `GET /api/v1/alpha-wallet/prices` — aggrega tutti i prezzi necessari.

---

## 14. STRUTTURA FILE — NUOVI FILE DA CREARE

### 14.1 Frontend (`artifacts/alpha-chat-web/src/`)

```
wallet/                          ← NUOVO — tutto qui sotto è nuovo
├── core/
│   ├── bip39.ts                 Generazione e validazione mnemonic
│   ├── hd-wallet.ts             BIP-32/44/84 derivation EVM + BTC
│   ├── keystore.ts              Cifratura/decifratura WebCrypto AES-256-GCM
│   └── wallet-auth.ts           WebAuthn + PIN challenge
│
├── evm/
│   ├── evm-network-config.ts    EVM Network Registry
│   ├── token-registry.ts        Token Registry con indirizzi verificati
│   ├── evm-balance.ts           Lettura balance ERC-20 e native
│   ├── evm-signer.ts            Signing locale tx EVM
│   └── evm-broadcaster.ts       Broadcast via backend proxy
│
├── bitcoin/
│   ├── btc-wallet.ts            BIP-84, address derivation
│   ├── btc-utxo.ts              Fetch UTXO da Blockstream
│   ├── btc-fee.ts               Fee estimation (sat/vbyte)
│   ├── btc-signer.ts            PSBT build + sign
│   └── btc-broadcaster.ts       Broadcast via backend proxy
│
├── hooks/
│   ├── useAlphaWallet.ts        Hook principale — stato wallet
│   ├── useWalletBalance.ts      Balance polling EVM + BTC
│   ├── useWalletHistory.ts      Transaction history
│   └── useWalletPrices.ts       Price feed
│
└── pages/
    ├── AlphaWalletPage.tsx      Entry point — sostituisce WalletCenterPage
    ├── WalletOverview.tsx       Schermata principale totale
    ├── WalletSetupFlow.tsx      Creazione/import wallet
    ├── WalletSeedBackup.tsx     Backup seed
    ├── WalletSendEvm.tsx        Send EVM sheet
    ├── WalletSendBtc.tsx        Send BTC sheet
    ├── WalletReceive.tsx        Receive (EVM + BTC)
    ├── WalletHistory.tsx        Transaction history
    └── WalletSecurity.tsx       Esporta seed/chiave
```

### 14.2 Backend (`artifacts/api-server/src/`)

```
wallet/                          ← NUOVO — tutto qui sotto è nuovo
├── alpha-wallet.controller.ts   Controller — broadcast, history, prices
├── alpha-wallet.service.ts      Logica: broadcast, fetch utxo, prices
├── alpha-wallet-evm.service.ts  EVM: balance, gas estimate, broadcast
├── alpha-wallet-btc.service.ts  BTC: UTXO, broadcast, history
└── alpha-wallet-price.service.ts  Price aggregator

models/
└── alpha-wallet-tx.model.ts    ← NUOVO — storico tx MongoDB

routes/v1/
└── alpha-wallet.routes.ts      ← NUOVO — /api/v1/alpha-wallet/*

wallet/__tests__/
├── alpha-wallet-evm.test.ts
├── alpha-wallet-btc.test.ts
└── alpha-wallet-price.test.ts
```

---

## 15. FILE ESISTENTI CHE NON DEVONO ESSERE TOCCATI

```
❌  artifacts/alpha-chat-web/src/pages/WalletCenterPage.tsx  (wrappare, non modificare)
❌  artifacts/alpha-chat-web/src/lib/thirdweb.ts
❌  artifacts/alpha-chat-web/src/lib/multichain-api.ts
❌  artifacts/alpha-chat-web/src/lib/usda-api.ts
❌  artifacts/alpha-chat-web/src/components/multichain/*
❌  artifacts/alpha-chat-web/src/components/usda/*
❌  artifacts/alpha-chat-web/src/App.tsx  (solo aggiungere case nel switch, non modificare logica esistente)
❌  artifacts/api-server/src/payment/*  (tutto il payment engine)
❌  artifacts/api-server/src/blockchain/multichain-config.ts
❌  artifacts/api-server/src/blockchain/evm/evm-adapter.ts
❌  artifacts/api-server/src/blockchain/gas-station.ts
❌  artifacts/api-server/src/blockchain/dynamic-fee-estimator.ts
❌  artifacts/api-server/src/blockchain/native-price-provider.ts  (riutilizzare via import, non modificare)
❌  artifacts/api-server/src/models/multichain-transfer.model.ts
❌  artifacts/api-server/src/models/user.model.ts  (non modificare — il nuovo wallet avrà proprio modello)
❌  artifacts/api-server/src/routes/v1/multichain-payment.routes.ts
❌  artifacts/api-server/src/controllers/multichain-payment.controller.ts
```

### 15.1 File esistenti che richiedono modifica minima (segnalazione)

| File | Motivo | Tipo di modifica |
|---|---|---|
| `App.tsx` | Aggiungere `"alpha-wallet"` all'enum `AppView` e il relativo `case` nel switch render | Addizione sicura, non modifica logica esistente |
| `ChatPage.tsx` (solo sidebar nav) | Aggiungere voce "Alpha Wallet" nel `SidebarMenu` nav list | Addizione sicura — solo un nuovo elemento JSX |
| `package.json` (frontend) | Aggiungere `@scure/bip39`, `@scure/bip32`, `@noble/secp256k1`, `viem` | Solo aggiunta dipendenze |

---

## 16. API BACKEND — NUOVI ENDPOINT

Tutti sotto `/api/v1/alpha-wallet/` — richiede autenticazione utente (`requireAuth`).

```
POST   /register          Registra il public address del wallet (EVM + BTC) nel DB
GET    /prices            Prezzi correnti ETH/POL/BNB/BTC/USDA
GET    /evm/balance       Balance ERC-20 e native per address e network
GET    /evm/gas-estimate  Stima gas per una transazione
POST   /evm/broadcast     Broadcast tx EVM firmata (raw tx hex)
GET    /btc/utxo          UTXO per un BTC address
GET    /btc/fee           Fee consigliata (sat/vbyte) dal mempool
POST   /btc/broadcast     Broadcast BTC tx firmata (raw hex)
GET    /history           Storico transazioni (paginato)
POST   /history           Salva tx nel DB dopo conferma
```

---

## 17. DATABASE

### 17.1 Nuovo modello `AlphaWalletTx`

Già descritto al punto 12.1. Nessuna modifica ai modelli esistenti.

### 17.2 È necessario il database per il wallet?

Il wallet funziona **senza database** per le operazioni core (balance, send, receive) — tutto on-chain. Il database è opzionale ma consigliato per:
- Storico transazioni (senza fare fetch on-chain ad ogni apertura)
- Registro degli address EVM/BTC per user (per analytics admin)
- Futuro: notifiche push su ricezione fondi

---

## 18. SICUREZZA — CHECKLIST OBBLIGATORIA

### 18.1 Cosa verificare in ogni PR

- [ ] Nessuna seed phrase in `fetch()` request body
- [ ] Nessuna private key in variabili di stato React
- [ ] Nessuna seed/key in `console.log()` (anche in dev)
- [ ] Private key decifrata solo in closure locale, eliminata dopo uso
- [ ] Nessuna seed/key nei log pino del backend
- [ ] Nessuna seed/key in MongoDB
- [ ] Test esplicito: intercettare le network requests durante una firma → nessun campo sensibile

### 18.2 Anti-phishing obbligatorio

Prima di ogni firma:
1. Mostrare schermata di conferma con tutti i dettagli
2. L'utente deve confermare esplicitamente
3. Poi e solo poi → autenticazione locale → firma
4. Se l'autenticazione fallisce → tx annullata → nessuna firma

---

## 19. RISCHI E MITIGAZIONI

| Rischio | Probabilità | Impatto | Mitigazione |
|---|---|---|---|
| iOS eviction IndexedDB | Media | Alto (perdita accesso wallet) | Warning utente, backup obbligatorio prima di deposito |
| XSS → furto key cifrata | Bassa | Alto | CSP headers, no eval, dependencies audit |
| Seed phrase in log | Media | Critico | Linting obbligatorio, review code |
| RPC failure durante firma | Alta | Medio | Retry automatico, tx non duplicata (nonce) |
| UTXO staleness BTC | Media | Medio | Refresh UTXO prima di costruire tx |
| BigInt overflow amount | Media | Alto | Sempre usare BigInt per amounts on-chain |
| Token decimals errati | Alta (BSC USDT!) | Critico | Token registry come fonte di verità unica |
| Collisione address EVM/BTC su stesso seed | Nessuna | — | By design: path diversi (BIP-44 vs BIP-84) |

---

## 20. TEST PLAN

### 20.1 Unit test — Core

```
wallet/core/
├── Genera mnemonic → 12 parole → valid BIP-39
├── Stessa mnemonic → stesso EVM address ogni volta
├── Stessa mnemonic → stesso BTC address ogni volta
├── Cifratura AES-256-GCM → decifratura → same plaintext
├── PIN sbagliato → decifratura fallisce
├── Export → import su MetaMask → same address (test manuale)
└── Export → import su BlueWallet BIP-84 → same BTC address (test manuale)
```

### 20.2 Unit test — EVM

```
wallet/evm/
├── Balance native ETH/POL/BNB
├── Balance ERC-20 USDT (6 decimali)
├── Balance ERC-20 USDC (6 decimali)
├── Balance ERC-20 USDA (18 decimali)
├── Balance ERC-20 USDT BSC (18 decimali) ← critico
├── Gas estimation
├── Sign tx EVM → verify signature → recover address
├── Broadcast raw tx → mock RPC
├── Insufficient balance → errore chiaro
├── Invalid address → errore chiaro
└── RPC timeout → retry
```

### 20.3 Unit test — Bitcoin

```
wallet/bitcoin/
├── BIP-84 derivation → bc1q... address
├── UTXO fetch → coin selection
├── Fee estimation (sat/vbyte)
├── PSBT build + sign → verify
├── Dust limit 546 sat → rifiuta output sotto soglia
├── Change address corretto
├── Insufficient balance → errore chiaro
├── Broadcast raw tx → mock Blockstream
└── RPC failure → errore chiaro
```

### 20.4 Security test

```
security/
├── Nessun campo seed/key nelle network requests durante firma
├── Nessun campo seed/key nel database dopo registrazione
├── Private key non presente nello state React dopo firma
└── WebAuthn challenge → firma → chiave eliminata dalla memoria
```

---

## 21. DIPENDENZE — LISTA COMPLETA

### 21.1 Nuove dipendenze frontend

```json
{
  "@scure/bip39": "^1.5.0",
  "@scure/bip32": "^1.6.0",
  "@noble/secp256k1": "^2.2.0",
  "@noble/hashes": "^1.7.0",
  "viem": "^2.21.0",
  "bitcoinjs-lib": "^7.0.1",
  "tiny-secp256k1": "^2.2.4",
  "ecpair": "^3.0.1"
}
```

> **Nota**: `@noble/hashes` potrebbe essere già presente come dipendenza transitiva. Verificare prima dell'installazione.

### 21.2 Nessuna nuova dipendenza backend

Il backend usa solo librerie già installate.

---

## 22. STIMA DI COMPLESSITÀ

| Componente | Complessità | Stima giorni-sviluppatore |
|---|---|---|
| Core wallet (BIP-39/32/84, keystore) | Alta | 3-4 |
| EVM balance + history reader | Media | 2 |
| EVM signer + broadcaster | Media | 2 |
| BTC wallet (UTXO, PSBT, fee) | Alta | 3-4 |
| Key security (WebAuthn + PIN) | Alta | 3 |
| UI Overview + Send + Receive | Media | 4 |
| UI Setup flow + Backup seed | Media | 2 |
| UI Transaction history | Bassa | 1 |
| Backend proxy endpoints | Bassa | 1 |
| Test suite completa | Media | 3 |
| **TOTALE** | | **~25 giorni** |

---

## 23. FASI DI IMPLEMENTAZIONE CONSIGLIATE

```
Fase A — Core + Test (no UI)
  Keystore, BIP-39, BIP-44, BIP-84, unit test compatibilità

Fase B — EVM Wallet
  Balance, signer, broadcaster, storia EVM

Fase C — Bitcoin Wallet
  UTXO, PSBT, fee estimation, broadcaster

Fase D — UI
  Overview, Send, Receive, Backup, History

Fase E — Security hardening
  WebAuthn, PIN fallback, security test suite

Fase F — Integration test + compatibilità esterna
  Test con MetaMask/BlueWallet, end-to-end

—— STOP — attendere approvazione prima di Fase G ——

Fase G (futura) — Integrazione con Chat Payment Engine
  "Pay from Alpha Wallet" nel flow chat
```

---

## 24. RISULTATO FINALE

L'Alpha Wallet così progettato è:

- **Self-custodial**: seed e private key mai lasciano il dispositivo
- **Compatibile**: stesso seed funziona su MetaMask (EVM) e BlueWallet (BTC)
- **Isolato**: zero dipendenze dal Payment Engine esistente
- **Disattivabile**: un feature flag `ALPHA_WALLET_ENABLED` disabilita l'intera sezione senza impatti
- **Modulare**: nuove EVM chain = nuova voce nel Network Registry, nessuna riscrittura
- **Sicuro**: private key in memoria solo durante la firma, mai nel DB, mai nelle API

---

*Fine documento Fase 1 — Attendere approvazione prima di qualsiasi implementazione.*
