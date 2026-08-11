# Alpha Wallet × Alpha Chat — Phase G Design Specification
## ChatWalletBridge — Contratto Ufficiale

**Versione:** 1.0 — BOZZA PER APPROVAZIONE  
**Data:** 11 agosto 2026  
**Prerequisiti approvati:** Phase A–F (563/563 test ✅)  
**Status:** ⏳ In attesa di approvazione — nessun codice di produzione modificato

---

## 0. Premessa e perimetro

Questo documento definisce il **contratto pubblico** tra Alpha Chat e Alpha Wallet per Phase G. È il documento da approvare **prima** di toccare qualsiasi file di produzione.

### Due sistemi paralleli, non sovrapposti

```
                      ALPHA CHAT
                          │
               ┌──────────┴──────────┐
               │                     │
         Payment Engine        ChatWalletBridge
         (custodiale)          (questo documento)
               │                     │
         MultiChain             ALPHA WALLET
         USDA / USDA            (self-custodial)
         Gas Station            Phases A–F
         Escrow
```

**Phase G non modifica il Payment Engine esistente.** I due percorsi coesistono nella UI:

- "Invia Cripto" → Payment Engine custodiale (invariato)
- "Paga con Wallet" → ChatWalletBridge → Alpha Wallet

---

## 1. ChatWalletBridge — Interfaccia pubblica

Il bridge è il **confine ufficiale e unico** tra chat e wallet. La chat non importa nulla da `wallet/` direttamente.

```typescript
// artifacts/alpha-chat-web/src/wallet/bridge/chat-wallet-bridge.ts
// (FILE DA CREARE — solo dopo approvazione di questa spec)

/**
 * ChatWalletBridge — Surface pubblica esposta alla Chat.
 *
 * REGOLA FONDAMENTALE: questo è l'unico contratto.
 * ChatPage non importa useWallet(), WalletContext, WalletMeta,
 * evm-signer, btc-signer, keystore, mnemonic, hd-wallet, token-registry
 * o qualsiasi altro modulo wallet/* direttamente.
 */
export interface ChatWalletBridge {
  /**
   * Stato corrente del bridge — da usare per decidere se mostrare o nascondere
   * il pulsante "Paga con Wallet" nella chat.
   */
  readonly status: BridgeStatus;

  /**
   * Capabilities del wallet corrente.
   * Null se wallet non disponibile (locked o assente).
   */
  getCapabilities(): WalletCapabilities | null;

  /**
   * Indirizzo di ricezione per la rete richiesta.
   * Null se wallet non disponibile o rete non supportata.
   * Non richiede autenticazione — è informazione pubblica.
   */
  getReceiveAddress(network: SupportedNetwork): string | null;

  /**
   * Avvia un pagamento dalla chat.
   * SICUREZZA: richiede sempre autenticazione locale (PIN/Face ID).
   * Non può essere chiamata da un evento WS o messaggio remoto.
   * Blocca la UI di pagamento per prevenire doppio invio.
   */
  sendPayment(params: ChatPaymentRequest): Promise<ChatPaymentResult>;
}
```

---

## 2. Tipi di dominio

### 2.1 BridgeStatus

```typescript
export type BridgeStatus =
  | "unavailable"   // nessun wallet creato
  | "locked"        // wallet esiste ma bloccato — mostra "Sblocca per pagare"
  | "ready";        // wallet sbloccato e pronto per transazioni

// Comportamento UI per ogni status:
// "unavailable" → pulsante "Paga con Wallet" nascosto o disabled con tooltip
// "locked"      → pulsante visibile, tap → bottom sheet "Sblocca Wallet"
// "ready"       → pulsante attivo, tap → payment sheet
```

### 2.2 SupportedNetwork

```typescript
export type SupportedEvmNetwork = "ethereum" | "polygon" | "bsc";
export type SupportedNetwork    = SupportedEvmNetwork | "bitcoin";

// Map to chainId (per uso interno, non esposta alla Chat):
// ethereum → 1
// polygon  → 137
// bsc      → 56
// bitcoin  → 0  (convenzione interna)
```

### 2.3 WalletCapabilities

```typescript
export interface WalletCapabilities {
  /** Reti EVM disponibili con almeno un asset inviabile */
  evmNetworks: EvmNetworkCapability[];
  /** Bitcoin disponibile */
  bitcoin: BitcoinCapability | null;
  /** Timestamp dell'ultima sync balance (ms UTC) */
  lastBalanceSyncAt: number | null;
}

export interface EvmNetworkCapability {
  network:     SupportedEvmNetwork;
  /** Nome rete leggibile ("Polygon") */
  networkName: string;
  /** Colore tema rete per badge UI */
  color:       string;
  /** Asset inviabili su questa rete */
  assets:      AssetCapability[];
}

export interface AssetCapability {
  /** Symbol ("USDT", "ETH", "POL", "USDA") */
  symbol: string;
  /** Nome completo */
  name:   string;
  /** Saldo human-readable ("100.50") */
  balance: string;
  /** Saldo numerico — per validazione importo minimo */
  balanceRaw: bigint;
  /** Decimali */
  decimals: number;
  /** Contract address ERC-20, null = token nativo */
  contractAddress: string | null;
  /** Token verificato ufficialmente o custom */
  verified: boolean;
  /** CoinGecko ID per price display (può essere null) */
  coingeckoId: string | null;
}

export interface BitcoinCapability {
  /** Saldo in BTC human-readable */
  balance:    string;
  /** Saldo in satoshi */
  balanceSat: bigint;
}
```

### 2.4 ChatPaymentRequest

```typescript
export interface ChatPaymentRequest {
  /** Rete di invio */
  network: SupportedNetwork;

  /**
   * Per reti EVM: contract address ERC-20 o null per token nativo.
   * Per Bitcoin: null.
   */
  tokenContractAddress: string | null;

  /**
   * Symbol dell'asset (per display e validazione).
   * Il bridge verifica coerenza con contractAddress.
   */
  assetSymbol: string;

  /**
   * Importo human-readable ("100.50").
   * Il bridge converte in unità blockchain (wei, satoshi) internamente.
   * La Chat non conosce decimali o conversioni.
   */
  amount: string;

  /**
   * Indirizzo destinatario.
   * EVM: "0x..." (42 chars hex).
   * BTC: "bc1q...", "1...", "3...".
   * Il bridge valida il formato prima di procedere.
   */
  recipientAddress: string;

  /**
   * Metadata non finanziario — non influenza la TX blockchain.
   * Usato per associare il risultato al messaggio/conversazione corretta.
   */
  metadata?: {
    conversationId?: string;
    messageId?:      string;
    /** Label opzionale per UI ("Pagamento a Marco") */
    label?:          string;
  };
}
```

### 2.5 ChatPaymentResult

```typescript
export type ChatPaymentStatus =
  | "sent"       // TX broadcast confermato (non necessariamente minata)
  | "confirmed"  // TX confermata on-chain
  | "failed"     // TX fallita / rifiutata dalla rete
  | "cancelled"; // annullata dall'utente prima della firma

export interface ChatPaymentResult {
  status:      ChatPaymentStatus;

  /** Hash TX — disponibile per status "sent" e "confirmed" */
  txHash?:     string;

  /** URL dell'explorer per la TX */
  explorerUrl?: string;

  /** Rete su cui è avvenuta la TX */
  network?:    SupportedNetwork;

  /** Asset inviato */
  assetSymbol?: string;

  /** Importo confermato (può differire per fee BTC) */
  amountSent?:  string;

  /**
   * Fee pagata (gas EVM o miner fee BTC) — human-readable.
   * Disponibile dopo firma, non sempre on-chain confermata.
   */
  fee?:         string;

  /** Codice errore machine-readable per "failed" */
  errorCode?:  ChatPaymentErrorCode;

  /** Messaggio di errore human-readable */
  errorMessage?: string;

  /** Metadata passato nella request — restituito inalterato */
  metadata?:   ChatPaymentRequest["metadata"];
}

export type ChatPaymentErrorCode =
  | "WALLET_LOCKED"           // wallet bloccato durante il pagamento
  | "WALLET_UNAVAILABLE"      // wallet non creato
  | "AUTHENTICATION_FAILED"   // PIN/Face ID errato o annullato
  | "INSUFFICIENT_BALANCE"    // saldo insufficiente (incluse fee)
  | "INVALID_RECIPIENT"       // indirizzo non valido
  | "INVALID_AMOUNT"          // importo non valido (zero, negativo, > saldo)
  | "NETWORK_ERROR"           // errore di rete nel broadcast
  | "BROADCAST_REJECTED"      // TX rifiutata dal nodo (underpriced, etc.)
  | "DOUBLE_SEND_PREVENTED"   // pagamento identico già in corso
  | "UNKNOWN";
```

---

## 3. Implementazione bridge — Architettura interna

### 3.1 Dove vive il bridge (valutazione architetturale)

**Opzione A — Hook diretto (`useChatWallet()`)**  
Un hook che chiama `useWallet()` internamente e filtra la surface.  
❌ Problema: richiede che ChatPage importi qualcosa da `wallet/` per ottenere il hook.

**Opzione B — Context dedicato (`ChatWalletBridgeContext`)**  
Un React Context separato, wrappa `WalletContext` internamente, espone solo `ChatWalletBridge`.  
✅ ChatPage importa solo il context bridge — zero import da `wallet/`.  
✅ Il bridge può evolvere indipendentemente dall'interfaccia interna del wallet.

**→ Scelta raccomandata: Opzione B**

```
Providers stack (dopo Phase G):
  <AppAuthProvider>
    <WalletProvider>           ← elevato al root (ora è in AlphaWalletPage)
      <ChatWalletBridgeProvider>  ← nuovo in Phase G
        <ChatPage />           ← usa useChatWalletBridge(), zero import da wallet/
        <AlphaWalletPage />    ← rimuove il proprio WalletProvider wrapper
      </ChatWalletBridgeProvider>
    </WalletProvider>
  </AppAuthProvider>
```

**Implicazione:** `WalletProvider` deve essere elevato dalla sua posizione corrente (dentro `AlphaWalletPage`) al livello dell'app. Questo è l'unico punto dove Phase G tocca l'architettura esistente del wallet — ed è una modifica puramente strutturale, non funzionale.

### 3.2 ChatWalletBridgeProvider — responsabilità

```typescript
// Responsabilità interne (non esposta alla Chat):
// - Legge phase/meta da useWallet()
// - Calcola BridgeStatus
// - Gestisce il lock anti-double-send (mutex boolean)
// - Gestisce lo stato pendingPayment in-flight
// - Chiama evm-signer / btc-signer dopo autenticazione
// - Scrive il risultato nel tx-store (come source="chat")

// NON espone alla Chat:
// - WalletMeta (evmAddress, btcAddress raw)
// - WalletPhase
// - WalletNotification
// - TokenConfig / TokenRegistry
// - TxMonitor
// - Nessun tipo da wallet/
```

---

## 4. Flusso UX completo — Pagamento dalla Chat

### 4.1 Happy path (wallet ready, pagamento EVM USDT)

```
1. ChatPage — OverviewBar o Composer
   └── Pulsante "💸 Paga con Wallet" (visibile solo se bridge.status === "ready")
       ↓ tap

2. ChatWalletPaySheet (nuovo componente Phase G)
   ├── Selezione rete: [Ethereum | Polygon | BSC | Bitcoin]
   ├── Selezione asset: [ETH / USDT / USDC / USDA / POL / ...] (da capabilities)
   ├── Campo importo + "MAX" button
   ├── Preview fee stimata (bridge.getCapabilities → asset.balance)
   ├── Indirizzo destinatario (pre-compilato dal profilo contatto se disponibile)
   └── CTA "Conferma e Invia →"
       ↓ tap

3. Schermata di autenticazione (SEMPRE — mai saltabile)
   ├── Se biometricOnly: Face ID / Touch ID
   └── Se PIN: PinPad (stesso componente di LockScreen)
       ↓ successo

4. Bridge — sendPayment() eseguito internamente
   ├── Valida params (indirizzo, importo, saldo)
   ├── Decripta mnemonic dal keystore (PIN appena inserito)
   ├── Chiama evm-signer.sendErc20() o btc-signer.sendBtc()
   ├── Firma LOCALMENTE (nessun dato privato al backend)
   ├── Broadcast della TX firmata via backend proxy
   ├── Azzera mnemonic dalla memoria (finally block)
   └── Restituisce ChatPaymentResult { status: "sent", txHash, explorerUrl }
       ↓

5. ChatPage — inserisce messaggio sistema con bubble di pagamento
   ├── Tipo messaggio: "wallet_payment" (nuovo message_type)
   ├── Payload: { txHash, network, asset, amount, direction: "out", status: "sent" }
   └── Il bubble mostra: "📤 Inviato 50 USDT su Polygon · 0xabc...def · ⏳ In attesa"
       ↓ (asincrono — tx-monitor polling)

6. tx-monitor reconciliation (Phase F — già implementato)
   └── Quando TX confermata → updateTxStatus → bubble aggiornato: "✅ Confermato"
```

### 4.2 Flusso ricezione (passivo)

```
1. Il wallet pubblica il proprio EVM address nel profilo utente (API server)
   ↓

2. Quando un contatto apre la conversazione, vede il pulsante "💸 Paga con Wallet"
   (il recipient address viene recuperato dal profilo — non da un messaggio in chat)
   ↓

3. Il flusso di invio è identico al §4.1
   ↓

4. Il destinatario riceve una notifica (tx-monitor lo rileva) → bubble nel proprio chat:
   "💰 Ricevuto 50 USDT su Polygon · 0xabc...def · ✅ Confermato"
```

### 4.3 Cancellazione (punto §11)

```
Cancellazione possibile SOLO prima della firma:

FASE                        CANCELLABILE?
─────────────────────────────────────────
ChatWalletPaySheet aperto   ✅ Sì — tasto "Annulla" / swipe down
Autenticazione in corso     ✅ Sì — tasto "Annulla" (result: "cancelled")
Firma in corso              ❌ No — operazione locale < 100ms
Broadcast in corso          ❌ No — TX già firmata, non annullabile
TX minata                   ❌ No — immutabile on-chain

Risultato cancelled → ChatPaymentResult { status: "cancelled" }
Nessun messaggio inserito in chat se cancelled.
```

---

## 5. Stato pending/confirmed/failed in chat (punto §8)

### 5.1 Modello di stato del bubble

```typescript
// system_metadata del messaggio "wallet_payment"
interface WalletPaymentMeta {
  txHash:      string;
  network:     SupportedNetwork;
  assetSymbol: string;
  amount:      string;         // human-readable
  fee?:        string;         // disponibile dopo firma
  direction:   "in" | "out";  // dal punto di vista del viewer
  status:      "sent" | "confirmed" | "failed";
  explorerUrl: string;
  // metadata opzionale
  conversationId?: string;
}
```

### 5.2 Aggiornamento stato (associazione TX ↔ messaggio — punto §9)

```
Aggiornamento via tx-monitor (già implementato in Phase F):

tx-monitor detecta conferma
        ↓
updateTxStatus("confirmed") nel tx-store
        ↓
onNewTransaction() callback in WalletContext → refreshTxHistory()
        ↓
ChatWalletBridgeContext intercetta la callback
        ↓
Cerca il messageId associato al txHash (dalla metadata del ChatPaymentRequest)
        ↓
API call: PATCH /messages/{messageId}/wallet-payment-status
        ↓
WS broadcast: "wallet_payment.confirmed" → ChatPage aggiorna bubble in-place
```

Il messageId viene passato nella `ChatPaymentRequest.metadata.messageId` al momento dell'invio e conservato nel tx-store come campo opzionale (`chatMessageId`).

### 5.3 Explorer link (punto §10)

```typescript
// Il bridge calcola l'explorer URL internamente:
// EVM: explorerUrl = txExplorerUrl(chainId, txHash) da evm-network-config.ts
// BTC: explorerUrl = `https://blockstream.info/tx/${txid}`

// Il bubble mostra sempre il link — mai il txHash completo (solo abbreviato):
// "0xdeadbeef...cafe123" — tap → apre explorer nel browser
```

---

## 6. Wallet locked durante il pagamento (punto §12)

```
Scenario: utente blocca il wallet mentre ChatWalletPaySheet è aperto.

STATO               COMPORTAMENTO
─────────────────────────────────────────────────────────────────
Sheet aperto,       Bridge rileva status → "locked"
autenticazione      Sheet si chiude automaticamente con messaggio:
non ancora iniziata "Wallet bloccato. Sblocca per continuare."

Firma in corso      Impossibile (mnemonic è già in memoria locale
                    per la durata della firma < 100ms, poi azzerato).
                    Il lock non interrompe una firma già avviata.

TX in broadcast     La TX è già firmata. Il lock non può fermarla.
                    Il bubble appare ugualmente.
```

---

## 7. Gestione errori (punto §13)

### 7.1 Errori pre-firma

```typescript
// Validazioni eseguite DAL BRIDGE prima di chiedere autenticazione:

"INSUFFICIENT_BALANCE"  → "Saldo insufficiente. Disponibile: X USDT"
"INVALID_RECIPIENT"     → "Indirizzo non valido" (EVM: regex 0x+40hex; BTC: pattern)
"INVALID_AMOUNT"        → "Importo non valido" (zero, negativo, > saldo - fee)
"WALLET_LOCKED"         → redirect a LockScreen (non alert)
"WALLET_UNAVAILABLE"    → "Crea un wallet Alpha per inviare criptovalute"
```

### 7.2 Errori post-autenticazione

```typescript
"AUTHENTICATION_FAILED" → "PIN errato" / "Face ID non riconosciuto"
                          → il bridge NON registra alcuna TX
                          → nessun messaggio in chat

"NETWORK_ERROR"         → "Errore di rete. Riprova."
                          → TX NON broadcast (firma non inviata)
                          → retry manuale disponibile

"BROADCAST_REJECTED"    → "Transazione rifiutata dalla rete (nonce / gas)"
                          → possibile retry con gas più alto (UX TBD in implementazione)
```

### 7.3 Errori post-broadcast

```typescript
"failed" (on-chain)     → tx-monitor detecta TX fallita
                          → bubble aggiornato: "❌ Transazione fallita"
                          → link explorer per dettagli
```

---

## 8. Idempotenza e prevenzione doppio invio (punto §14)

### 8.1 Mutex in-flight

```typescript
// ChatWalletBridgeProvider mantiene internamente:
private _sendInProgress = false;

sendPayment(params) {
  if (this._sendInProgress) {
    return { status: "failed", errorCode: "DOUBLE_SEND_PREVENTED" };
  }
  this._sendInProgress = true;
  try {
    // ... firma e broadcast
  } finally {
    this._sendInProgress = false;
  }
}
// Il pulsante "Conferma e Invia" è disabled mentre _sendInProgress === true
```

### 8.2 Idempotenza EVM (nonce)

```typescript
// evm-signer già usa il nonce on-chain (da eth_getTransactionCount).
// Se la stessa TX viene firmata due volte con lo stesso nonce,
// la seconda viene rifiutata dal nodo ("nonce already used").
// Il mutex in-flight previene comunque la seconda chiamata a sendPayment().
```

### 8.3 Idempotenza BTC (UTXO selection)

```typescript
// btc-signer già seleziona UTXO atomicamente.
// Se la stessa TX BTC viene inviata due volte, la seconda fallisce perché
// gli UTXO sono già spesi (double-spend detection del nodo).
// Il mutex in-flight previene comunque la doppia firma.
```

---

## 9. Regola fondamentale — Nessun evento remoto può autorizzare una TX (punto §15)

### 9.1 La regola

```
Un messaggio ricevuto via chat — inclusi:
  • messaggi Signal E2E
  • eventi WebSocket (WsEvent)
  • notifiche push
  • system_metadata di qualsiasi tipo
  
NON PUÒ, in nessun caso, chiamare bridge.sendPayment().

L'unico trigger valido è:
  utente → tap esplicito → schermata pagamento → conferma → autenticazione → firma
```

### 9.2 Enforcement architetturale

Questa regola è garantita a livello di **architettura**, non solo di convenzione:

1. `sendPayment()` è una funzione **asincrona interattiva** — richiede un'autenticazione UI (PIN/Face ID) che deve completarsi. Non può essere chiamata silenziosamente in background.

2. Il `ChatWalletBridgeContext` espone `sendPayment()` solo al **render tree React**. Un handler WebSocket (che gira fuori dal render cycle) non può invocarla direttamente.

3. I WS handler in ChatPage aggiornano **state React** — non chiamano funzioni di pagamento. La regola è:

```typescript
// ✅ PERMESSO in un WS handler:
case "wallet_payment.confirmed":
  updateMessageStatus(payload.txHash, "confirmed"); // aggiorna bubble
  break;

// ❌ VIETATO in un WS handler — regola assoluta:
case "payment_request_received":
  bridge.sendPayment({ ... }); // MAI — questa riga non deve mai esistere
  break;
```

4. **Code review requirement (Phase G):** ogni PR che tocca WS handler di ChatPage deve includere un commento esplicito che dichiara il non-uso di `sendPayment()`.

---

## 10. Autenticazione locale obbligatoria prima della firma (punto §16)

```
Regola: ogni chiamata a sendPayment() deve includere una fase
        di autenticazione locale completata con successo.

Implementazione:
  bridge.sendPayment(params)
    → mostra AuthModal (PinPad o Face ID, stesso di LockScreen)
    → await authResult
    → if authResult.failed → return { status: "failed", errorCode: "AUTHENTICATION_FAILED" }
    → if authResult.cancelled → return { status: "cancelled" }
    → decryptSeed(keystore, pin) → mnemonic
    → [firma]
    → [azzera mnemonic]

NESSUNA ECCEZIONE.
Non esiste un modo per bypassare l'autenticazione nella bridge.sendPayment().
Anche se il wallet è "unlocked" (sessione attiva), la firma richiede
il PIN/Face ID perché accede al keystore cifrato.

Nota tecnica: "unlocked" in WalletContext significa che la SESSIONE
è valida (l'utente ha sbloccato di recente). Non significa che il
mnemonic sia in memoria — il mnemonic viene decifrato solo on-demand
per la firma e azzerato immediatamente dopo.
```

---

## 11. Isolamento dati — Cosa la Chat non vede mai (punto §17)

```
DATO                          ESPOSTO ALLA CHAT?
──────────────────────────────────────────────────
Mnemonic / seed phrase        ❌ Mai
Private key                   ❌ Mai
Keystore cifrato              ❌ Mai
Derivation path               ❌ Mai
Signed transaction (raw)      ❌ Mai — il bridge non espone nemmeno il txRaw
WalletMeta.evmAddress raw     ❌ Mai — la Chat usa solo ChatPaymentResult
WalletMeta.btcAddress raw     ❌ Mai — getReceiveAddress() ritorna solo la propria
PIN dell'utente               ❌ Mai — entra solo nel bridge, non nella Chat
KeystoreEntry                 ❌ Mai
IDB tx-history raw            ❌ Mai — la Chat vede solo ChatPaymentResult
WalletPhase enum              ❌ Mai — la Chat vede BridgeStatus
TokenConfig internals         ❌ Mai — la Chat vede AssetCapability (subset pulito)
TxMonitor internals           ❌ Mai
notification store            ❌ Mai

DATO ESPOSTO (via ChatWalletBridge)   TIPO
──────────────────────────────────────────────────────
BridgeStatus                          "unavailable"|"locked"|"ready"
WalletCapabilities                    subset pulito (no internals)
AssetCapability                       symbol, balance, name — no address opaque
ChatPaymentResult                     txHash, explorerUrl, status, amount — solo pubblico blockchain
```

---

## 12. Isolamento dal Payment Engine (punto §18)

```
MODULO                          PHASE G LO TOCCA?
────────────────────────────────────────────────────
multichain-payment.service.ts   ❌ No
MultiChainTransfer model        ❌ No
mc_payment message type         ❌ No
MultiChainSendSheet             ❌ No
MultiChainPaymentBubble         ❌ No
usda.service.ts                 ❌ No
Gas Station                     ❌ No
Escrow accounts                 ❌ No
GasReserveProtection            ❌ No
api-server payment routes       ❌ No (eccetto nuova route wallet_payment status)

MODULO                          PHASE G MODIFICA?
────────────────────────────────────────────────────
ChatPage.tsx                    ✅ Sì (chirurgicamente — aggiunge pulsante + bubble)
AlphaWalletPage.tsx             ✅ Sì (rimuove WalletProvider wrapper)
App root / router               ✅ Sì (eleva WalletProvider, aggiunge Bridge Provider)
wallet/index.ts                 ✅ Sì (aggiunge export del bridge)
api-server routes               ✅ Sì (aggiunge /messages/:id/wallet-payment-status)
```

---

## 12b. Platform Fee Alpha Wallet (aggiunta post-approvazione)

### 12b.1 Principio

La Platform Fee Alpha Wallet è **indipendente** dal Payment Engine custodiale. Non si sovrappone né modifica le fee di MultiChain, USDA o Gas Station.

```
ALPHA WALLET Platform Fee    ≠    PAYMENT ENGINE fee
(questo §)                        (invariata — fuori scope Phase G)
```

### 12b.2 Valore di default e configurazione

```typescript
interface AlphaWalletFeeConfig {
  /** Fee in basis points (1 bps = 0.01%). Default: 10 bps = 0.10% */
  feeBps:        number;   // min: 0, max: 500 (5%)
  /** Fee minima per rete/asset — evita fee sub-dust */
  minFeeByNetwork?: Partial<Record<SupportedNetwork, string>>; // human-readable
  /** Fee massima per rete/asset (cap opzionale) */
  maxFeeByNetwork?: Partial<Record<SupportedNetwork, string>>;
  /** Wallet di destinazione fee per rete */
  feeWallets: {
    ethereum: string;   // da env ETHEREUM_FEE_WALLET
    polygon:  string;   // da env POLYGON_FEE_WALLET
    bsc:      string;   // da env BSC_FEE_WALLET
    bitcoin:  string;   // da env BTC_FEE_WALLET
  };
  /** Validità della quote in secondi (default: 30s) */
  quoteValiditySeconds: number;
  /** Timestamp ultima modifica */
  updatedAt:   Date;
  /** userId di chi ha modificato (audit) */
  updatedBy:   string;
}
```

### 12b.3 Configurazione Admin

**Admin panel — nuova sezione "Alpha Wallet Fee"** (separata da "Payment Engine Settings"):

```
┌─ Alpha Wallet Platform Fee ─────────────────────────────────┐
│                                                              │
│  Fee rate:  [ 10 ] bps  =  0,10%                            │
│  (min 0 bps — max 500 bps)                                   │
│                                                              │
│  Quote validity: [ 30 ] secondi                              │
│                                                              │
│  Modifica → richiede conferma → audit log                    │
│                                                              │
│  Last updated: 11 ago 2026 14:32 — admin@example.com        │
└──────────────────────────────────────────────────────────────┘
```

Audit log per ogni modifica:
```typescript
interface AlphaWalletFeeAuditEntry {
  timestamp:  Date;
  adminId:    string;
  adminEmail: string;
  prevFeeBps: number;
  newFeeBps:  number;
  ip:         string;
}
```

### 12b.4 Calcolo fee — regole

```
EVM (ERC-20 / native):
  platformFeeAmount = floor(amount × feeBps / 10000)
  // Se platformFeeAmount < minFee → usa minFee
  // Se maxFee definita e platformFeeAmount > maxFee → usa maxFee

BTC:
  platformFeeSat = floor(amountSat × feeBps / 10000)
  // Rispetta dust limit: min 546 sat

Totale a carico del mittente:
  EVM: amount + platformFeeAmount + networkGasFee
  BTC: amountSat + platformFeeSat + minerFeeSat
```

### 12b.5 UI breakdown obbligatoria (schermata di conferma)

```
EVM (USDC):
┌──────────────────────────────────┐
│  Destinatario      100,00 USDC   │
│  Platform fee        0,10 USDC   │
│  Network fee         0,42 POL    │  ← in token nativo (gas)
│  ──────────────────────────────  │
│  Totale inviato    100,10 USDC   │
│  + Network fee       0,42 POL    │
└──────────────────────────────────┘

BTC:
┌──────────────────────────────────┐
│  Destinatario   0,00100000 BTC   │
│  Platform fee   0,00000010 BTC   │
│  Miner fee      0,00000234 BTC   │
│  ──────────────────────────────  │
│  Totale pagato  0,00100244 BTC   │
└──────────────────────────────────┘

REGOLA ASSOLUTA: Platform Fee e Network/Miner Fee non devono mai
essere mostrate come un'unica voce aggregata.
```

### 12b.6 Congelamento della quote e validità temporale

```
Flusso con quote congelata:

1. Apertura ChatWalletPaySheet
   → GET /api/wallet/payment-quote-config (fee corrente + validity)
   → La quote è valida per N secondi (default 30s)
   → Timer visibile nella UI: "Prezzi aggiornati · scade in 28s ⟳"

2. Utente completa i campi e preme "Conferma"
   → Il bridge controlla age della quote
   → Se quote scaduta: ricaricare automaticamente (notify utente "Fee aggiornata")
   → Se quote valida: congela { amount, platformFee, networkFee }

3. Utente inserisce PIN / Face ID
   → La firma avviene con i valori congelati al passo 2
   → Anche se l'Admin modifica la fee durante questa finestra,
     la transazione usa la fee presentata all'utente

4. SCENARIO: Admin modifica fee MENTRE l'utente è in attesa della firma
   → La firma usa la fee congelata (protegge l'utente da variazioni silenti)
   → Le nuove fee si applicano al PROSSIMO pagamento

Quote invalidity window:
  - Quote valida ≤ quoteValiditySeconds → procede normalmente
  - Quote scaduta prima della firma → ricalcola, mostra nuovi valori, richiede
    nuova conferma utente (non riautenticazione)
```

### 12b.7 Destinazione fee — transazione tecnica

```
EVM (ERC-20):
  TX1: transfer(recipient, amount)           → tx principale
  TX2: transfer(feeWallet, platformFeeAmt)   → fee collection (fire-and-forget)
  Entrambe firmate con lo stesso mnemonic nella stessa sessione di autenticazione.
  TX2 failure: non blocca TX1 — audit log dell'errore.

EVM (native ETH/POL/BNB):
  Stessa strategia a 2 TX.

BTC:
  Singola transazione con 2 output:
    output[0]: recipient address, amountSat
    output[1]: feeWallet address, platformFeeSat
  Elegante e atomico — nessun rischio di partial execution.
```

### 12b.8 Errori specifici Platform Fee

```typescript
// Aggiunta a ChatPaymentErrorCode:
| "FEE_CONFIG_UNAVAILABLE"    // impossibile recuperare la config fee
| "QUOTE_EXPIRED"             // quote scaduta durante la firma
| "PLATFORM_FEE_TX_FAILED"    // TX2 (fee collection) fallita — TX1 già inviata
```

---

## 13. Associazione TX ↔ messaggio (punto §9 — dettaglio)

```typescript
// Flusso di associazione:

// 1. Al momento dell'invio, il bridge riceve il messageId proposto dalla Chat
const result = await bridge.sendPayment({
  ...params,
  metadata: { conversationId, messageId: tempMessageId }
});

// 2. Il bridge salva l'associazione nel tx-store con campo opzionale:
await saveTxRecord({
  ...record,
  chatMessageId: tempMessageId  // nuovo campo opzionale in WalletTxRecord (Phase G)
});

// 3. tx-monitor rileva la conferma → cerca chatMessageId → notifica ChatPage
// 4. ChatPage aggiorna il bubble via API + WS

// Regola di fallback:
// Se chatMessageId non è disponibile (es. offline al momento dell'invio),
// il bubble parte in stato "sent" e viene aggiornato al prossimo avvio
// tramite reconciliation del tx-store.
```

---

## 14. Nuovo message_type: "wallet_payment"

```typescript
// Nuovo tipo da aggiungere al WsEvent union (ChatPage.tsx)
// e al message_type enum del backend

interface WalletPaymentMessage {
  message_type: "wallet_payment";
  system_metadata: WalletPaymentMeta; // definita in §5.1
}

// Bubble di rendering:
// direction === "out" (sender)  → "📤 Inviato 50 USDT su Polygon · 0xabc...def · ⏳"
// direction === "in"  (receiver) → "💰 Ricevuto 50 USDT su Polygon · 0xabc...def · ✅"
// status === "failed"            → "❌ Transazione fallita · 0xabc...def"

// NOTA: questo message_type è DIVERSO da "mc_payment" (Payment Engine custodiale).
// I due bubble sono componenti distinti e non condividono codice.
```

---

## 15. Indirizzo destinatario — Come la Chat lo ottiene

```
Il destinatario del pagamento wallet deve essere conosciuto in anticipo.
La Chat NON deve mai derivarlo da un messaggio ricevuto (vedi §9).

Fonti valide:
  1. Profilo utente in-app: il destinatario ha registrato il proprio
     EVM/BTC address nel profilo (API server — campo opzionale)
  2. QR code / NFC (futuro — fuori scope Phase G)

Flusso:
  ChatPage sa che il contatto ha un wallet address → abilita "Paga con Wallet"
  ChatPage recupera l'address via API: GET /users/{userId}/wallet-addresses
  ChatPage passa l'address al ChatWalletPaySheet (non a bridge.sendPayment direttamente)
  L'utente conferma l'address visivamente prima di procedere
```

---

## 16. Acceptance criteria (punto §19)

### AC-1: Isolamento del bridge
- [ ] `ChatPage.tsx` non importa nulla da `wallet/` eccetto il bridge context
- [ ] `useChatWalletBridge()` restituisce `BridgeStatus`, non `WalletPhase`
- [ ] TypeScript: nessun tipo da `wallet/core/`, `wallet/services/`, `wallet/evm/` in ChatPage

### AC-2: Sicurezza della firma
- [ ] `sendPayment()` senza autenticazione completata → fallisce sempre
- [ ] La Chat non può leggere il risultato dell'autenticazione (PIN/biometric)
- [ ] Il mnemonic non è mai in nessun campo di ChatPaymentResult
- [ ] Dopo `sendPayment()`, nessuna riferimento al mnemonic rimane in scope

### AC-3: Anti-remote-trigger
- [ ] Nessun WS handler chiama `sendPayment()` o qualsiasi funzione di firma
- [ ] Un evento `"payment_request_received"` mostra al massimo un banner/bubble informativo
- [ ] Code review checklist: ogni WS handler deve avere un commento esplicito

### AC-4: Prevenzione doppio invio
- [ ] Due tap rapidi su "Conferma e Invia" generano una sola TX
- [ ] `sendPayment()` mentre un'altra è in corso → `{ status: "failed", errorCode: "DOUBLE_SEND_PREVENTED" }`
- [ ] Il pulsante "Conferma" è `disabled` durante `_sendInProgress === true`

### AC-5: Isolamento Payment Engine
- [ ] Nessun file del Payment Engine (multichain, usda, escrow, gas-station) è modificato
- [ ] I test esistenti del Payment Engine passano invariati dopo Phase G
- [ ] Il bubble `wallet_payment` non usa codice di `MultiChainPaymentBubble`

### AC-6: Stato TX in chat
- [ ] Un pagamento inviato offline → bubble parte come "sent"
- [ ] tx-monitor rileva conferma → bubble aggiornato a "confirmed" senza reload
- [ ] TX fallita on-chain → bubble aggiornato a "failed" con link explorer
- [ ] Link explorer apre il browser esterno (non iframe in-app)

### AC-7: UX cancellazione
- [ ] Tasto "Annulla" nel ChatWalletPaySheet → nessun messaggio in chat
- [ ] Face ID annullato → nessuna TX, nessun messaggio, ritorno allo sheet
- [ ] Wallet si blocca mentre lo sheet è aperto → sheet si chiude con messaggio

### AC-8: Capability e balance
- [ ] `getCapabilities()` restituisce null se wallet locked/unavailable
- [ ] Asset con saldo zero sono inclusi in capabilities (per ricevere)
- [ ] `getCapabilities()` non fa fetch di rete — usa il balance cache in WalletContext

### AC-9: Regressione
- [ ] 563/563 test pre-Phase G passano invariati dopo Phase G
- [ ] Il Payment Engine custodiale funziona indipendentemente dal bridge
- [ ] AlphaWalletPage funziona identicamente (WalletProvider elevato è trasparente)

---

## 17. Test plan (punto §20)

### 17.1 Unit test — ChatWalletBridge

| Test | Verifica |
|------|----------|
| `bridge-status.test.ts` | BridgeStatus corretto per ogni WalletPhase |
| `get-capabilities.test.ts` | Capabilities corrette per ogni combinazione rete/asset |
| `get-receive-address.test.ts` | Indirizzo corretto per ogni rete, null se locked |
| `send-payment-validation.test.ts` | Tutti i codici di errore pre-firma |
| `double-send-prevention.test.ts` | Mutex _sendInProgress blocca seconda chiamata |
| `authentication-required.test.ts` | sendPayment senza auth sempre fallisce |

### 17.2 Unit test — Sicurezza

| Test | Verifica |
|------|----------|
| `no-private-data-in-result.test.ts` | ChatPaymentResult non contiene mnemonic/key/keystore |
| `no-ws-trigger.test.ts` | Simulazione evento WS non chiama sendPayment() |
| `mnemonic-zeroized.test.ts` | Mnemonic non in scope dopo sendPayment() (finally block) |

### 17.3 Integration test — Flusso completo

| Test | Verifica |
|------|----------|
| `happy-path-evm.test.ts` | Invio USDT Polygon → txHash → confirmed |
| `happy-path-btc.test.ts` | Invio BTC → txid → confirmed |
| `cancel-before-auth.test.ts` | Cancelled → nessuna TX |
| `wallet-locked-mid-flow.test.ts` | Lock durante sheet → sheet chiuso |
| `insufficient-balance.test.ts` | Errore prima dell'auth |
| `network-error-broadcast.test.ts` | Errore broadcast → nessun messaggio |

### 17.4 Regression test

```bash
# Dopo Phase G: questo comando deve restituire 563+ test verdi
pnpm --filter @workspace/alpha-chat-web exec vitest run
```

### 17.5 Manual QA checklist (pre-merge Phase G)

- [ ] Invio USDT Polygon → conferma → bubble aggiornato
- [ ] Invio BTC → conferma → bubble aggiornato
- [ ] Payment Engine "Invia Cripto" funziona come prima
- [ ] Wallet bloccato mid-payment → comportamento corretto
- [ ] Due tap rapidi → una sola TX
- [ ] Annulla prima di PIN → nessuna TX
- [ ] PIN errato 3× → schermata bloccata (Phase D behaviour)
- [ ] Offline durante broadcast → errore graceful

---

## 18. File da creare in Phase G (nessuno esiste ancora)

```
artifacts/alpha-chat-web/src/
  wallet/
    bridge/
      chat-wallet-bridge.ts          ← tipi e interfacce (questo documento)
      chat-wallet-bridge-context.tsx  ← ChatWalletBridgeProvider + useChatWalletBridge
      chat-wallet-bridge.test.ts     ← unit test bridge
  components/
    chat/
      ChatWalletPaySheet.tsx         ← bottom sheet selezione rete/asset/importo
      ChatWalletPaymentBubble.tsx    ← bubble in-chat per wallet_payment
      ChatWalletPaySheet.css
      ChatWalletPaymentBubble.css
  tests/
    wallet/
      phase-g-bridge.test.ts
      phase-g-security.test.ts
      phase-g-integration.test.ts
```

---

## 19. File modificati chirurgicamente in Phase G

```
artifacts/alpha-chat-web/src/
  pages/
    AlphaWalletPage.tsx    ← rimuove wrapper WalletProvider (già gestito dal root)
    ChatPage.tsx           ← aggiunge: pulsante, bubble wallet_payment, WS handler status
  App.tsx (o root router)  ← aggiunge WalletProvider + ChatWalletBridgeProvider
artifacts/api-server/src/
  routes/
    messages.routes.ts     ← aggiunge PATCH /messages/:id/wallet-payment-status
  controllers/
    messages.controller.ts ← handler per status update
```

---

## 20. Fuori scope di Phase G

I seguenti elementi **non** rientrano in Phase G e richiedono una specifica separata:

- Richiesta di pagamento in-chat ("Pagami X") — solo invio in scope
- QR code / deep link per address sharing
- Multi-firma o threshold transactions  
- Swap in-app (conversione tra asset)
- Payment history view integrata in chat (usa AlphaWalletPage esistente)
- Notifiche push per pagamenti ricevuti dal wallet (già in tx-monitor — UX TBD)
- Address book (rubrica contatti con wallet addresses)

---

## 21. Approvazione richiesta

Questo documento è pronto per revisione. Per procedere con l'implementazione (Phase G #88 e #89) è necessaria approvazione esplicita su:

1. **Architettura bridge**: Opzione B (ChatWalletBridgeContext) ✓
2. **Elevazione di WalletProvider** al root dell'app ✓ / modifica ✗
3. **Interfaccia ChatWalletBridge** (§1): approvata ✓ / modifiche richieste ✗
4. **Tipi ChatPaymentRequest / ChatPaymentResult** (§2): approvati ✓ / modifiche ✗
5. **Flusso UX** (§4): approvato ✓ / modifiche ✗
6. **Acceptance criteria** (§16): approvati ✓ / integrazioni ✗

---

*Nessuna riga di codice di produzione è stata modificata per produrre questo documento.*  
*Tutte le scelte architetturali sono derivate dall'analisi dei file esistenti (Phases A–F).*
