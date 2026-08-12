# Spark/Lightning Architecture Design
## Alpha Chat — Integrazione Lightning via Breez SDK Spark

**Stato:** DRAFT — in attesa di approvazione formale  
**Data:** 12 agosto 2026  
**SDK:** `@breeztech/breez-sdk-spark@0.15.1`  
**Dipendenza:** risposta Breez email (fee/ToS) + test iPhone reale  

> ⚠️ **REGOLA ASSOLUTA:** Nessun file di produzione verrà toccato finché questo documento non è approvato esplicitamente. L'approvazione deve essere esplicita e scritta.

---

## 0. Scope e vincoli

### In scope
- Integrazione Lightning/Spark per pagamenti in-chat
- Send e Receive Lightning (BOLT11, Spark address, Bitcoin on-chain)
- Portfolio balance Lightning/Spark
- Storico pagamenti Lightning

### Fuori scope (per questa fase)
- Modifica a qualsiasi sistema esistente (BTC on-chain, EVM, USDA, MultiChain)
- BOLT12 Receive (non supportato dall'SDK in ReceivePaymentMethod)
- Server-side Lightning node
- Custodia fondi lato Alpha (il modello è self-custodial client-side)

### Principio guida
> L'integrazione Spark deve essere **completamente isolata** dai sistemi esistenti durante l'implementazione. Un bug nell'integrazione Lightning non deve mai impattare BTC on-chain, USDA, o le chiamate vocali.

---

## 1. Modello Seed — Opzione A: Seed Unica ✅

**Decisione:** Alpha Wallet usa **una sola seed BIP39** per derivare sia le chiavi BTC on-chain che le chiavi Spark/Lightning.

```
Alpha Wallet BIP39 seed (12/24 parole)
   │
   ├── BTC on-chain:     m/84'/0'/0'/0/{idx}   (BIP84, purpose=84)
   │   pubkey:           03fc0ee... (empirico)
   │
   └── Spark/Lightning:  m/8797555'/1'/0'       (Spark, purpose=8797555)
       identityPubkey:   0281363... (empirico)
```

**Verifica empirica (PoC):**
- BIP84 pubkey: `03fc0eefc6756b893673ad37c40a2f9e0a42a0251a90c625bbee79aac2d31cb948`
- Spark pubkey: `0281363910b0dc0015a4a25e758da30f0e28388ea5252c0e3713936f2d4ef7d3d5`
- **DIVERSI → nessuna collisione ✅**

**Rationale:**
- UX superiore: l'utente gestisce una sola backup seed per tutto (BTC + Lightning)
- Standard del settore (stessa seed per multiple chain/protocol)
- Nessun rischio crittografico: path diversi → chiavi diverse

**Implicazione recovery:** una sola Recovery Card → recupera sia BTC on-chain che Lightning. Il documento di recovery must essere aggiornato per riflettere questo.

**NOTA:** l'account number Spark mainnet è `1` (non `0`). Path completo: `m/8797555'/1'/0'`.

---

## 2. ExternalSigner — Client-Side Signing

### Modello
```
┌─────────────────────────────────────────────────────────────────┐
│  Browser (Alpha Chat PWA)                                        │
│                                                                  │
│  BIP39 seed → ExternalSigner                                    │
│                │                                                 │
│                ├── sign(payload) → firma FROST                  │
│                │   [mai la chiave privata]                      │
│                │                                                 │
│                └── Breez SDK WASM                               │
│                    │                                             │
│                    ├── gRPC HTTPS → Spark Operator 1 (LightSpark)│
│                    ├── gRPC HTTPS → Spark Operator 2 (Breez)    │
│                    └── gRPC HTTPS → Spark Operator 3 (Flashnet) │
└─────────────────────────────────────────────────────────────────┘
```

### Garanzie
- **Chiave privata**: derivata localmente, mai trasmessa
- **Mnemonic**: mai inviato ad Alpha backend né agli operatori
- **Firme FROST**: threshold 2/3 → compromissione di 1 operatore non compromette i fondi
- **API key**: letta da `import.meta.env.VITE_BREEZ_API_KEY`, mai hardcoded, mai loggata

### In produzione
- `VITE_BREEZ_API_KEY` → Replit secret (già configurato nel PoC)
- Il prefisso `VITE_` la espone al bundle client: questo è il **modello ufficiale Breez** (app identifier, non user credential)
- Gestione key rotation: richiedere nuova key a Breez, aggiornare il secret Replit, rebuild

---

## 3. Architettura Software

### Layer stack
```
ChatPage / WalletView
    └── SparkProvider (Context React)
          └── BreezSparkAdapter (interface)
                ├── MockBreezAdapter   (sviluppo / unit test)
                └── LiveBreezAdapter   (produzione)
                      └── Breez SDK WASM (@breeztech/breez-sdk-spark)
                            └── IndexedDB (spark-{userId}/mainnet/{hash})
```

### Selezione adapter
```typescript
const adapter = import.meta.env.VITE_BREEZ_API_KEY
  ? createLiveBreezAdapter()
  : createMockBreezAdapter();
```

### storageDir naming in produzione
```typescript
// PRODUZIONE (non test vector):
const storageDir = `spark-${userId}`;
// → IDB: spark-{userId}/mainnet/{configHash}
```

> ⚠️ **MAI usare il test mnemonic "abandon x11 about" in production.** Il PoC ha dimostrato che è condiviso da altri dev su mainnet (20 tx trovate). In produzione ogni utente usa la propria seed Alpha Wallet.

---

## 4. IndexedDB — Isolamento e Persistenza

### Store creati dal SDK (dal PoC)
```
spark-{userId}/mainnet/{configHash}   (v15)
  └── [contenuto da analizzare: vedere §19 - rischi aperti]
```

### Store Alpha Wallet esistenti (NON toccati)
```
alpha-wallet-keystore-v3    (BTC/EVM keys)
signal-identity-store       (Signal E2E)
signal-pre-keys-store       (Signal OTPK)
...
```

### Regola di isolamento
- Namespace completamente separati → zero collisioni (verificato nel PoC)
- Il SDK Spark gestisce il proprio IDB in autonomia
- Alpha non deve mai leggere/scrivere nel namespace Spark direttamente

### Analisi cifatura IDB (APERTA)
- ⚠️ Non ancora verificato se il WASM cifra le leaves prima di persisterle in IDB
- Confronto necessario con Alpha Wallet (che usa AES-256-GCM per Signal store)
- **Azione richiesta prima di production:** analisi contenuto IDB + decisione su eventuale cifatura layer aggiuntivo

---

## 5. Send

### Flusso
```
Utente inserisce importo
    → calculateSparkQuote()    [fee breakdown: routing + Alpha]
    → preview sheet con fee
    → conferma utente
    → prepareSendPayment({ paymentRequest })
    → sendPayment()
```

### Tipi di send supportati
| Tipo | Method | Note |
|------|--------|------|
| Lightning BOLT11 | `prepareSendPayment({ paymentRequest: bolt11 })` | Standard |
| Spark address | `prepareSendPayment({ paymentRequest: sparkAddr })` | Istantaneo, fee basse |
| Bitcoin on-chain | Swap Lightning → on-chain (via SDK) | Fee più alte |
| Lightning Address | `parse("user@domain.com")` → BOLT11 | Automatico |
| LNURL-Pay | `parse(lnurl)` → BOLT11 | Automatico |
| BOLT12 offer | `parse(bolt12offer)` → send | Solo invio; receive non supportato |

### Regola fee send
```
amountSat (inserito dall'utente)
  + routing fee Lightning   [variabile, calcolata da prepareSendPayment]
  + Spark operator fee      [TBD — pendente risposta Breez]
  + Alpha fee 0.10%         [ceiling — vedi §9]
= totalDeducted
```

---

## 6. Receive

### Metodi supportati
| Tipo | API | Note |
|------|-----|------|
| BOLT11 invoice | `receivePayment({ paymentMethod: { type: "bolt11Invoice", amountSats, description } })` | Standard Lightning |
| Spark address | `receivePayment({ paymentMethod: { type: "sparkAddress" } })` | No importo fisso |
| Bitcoin on-chain | `receivePayment({ paymentMethod: { type: "bitcoinAddress" } })` | Swap on-chain → Lightning |

### BOLT12 (Offre persistente)
- ❌ **NON supportato** per Receive in `ReceivePaymentMethod`
- ✅ Supportato per Send (via `parse()`)
- Non blocca l'integrazione — BOLT11 è sufficiente per la maggior parte degli use case

### Flusso receive in-chat
```
Utente "Richiedi pagamento Lightning"
    → amount + description
    → receivePayment({ paymentMethod: bolt11Invoice })
    → invoice (BOLT11 string + QR)
    → bubble in chat con invoice
    → polling su listPayments() finché status = completed
    → notifica "Ricevuto N sats"
```

---

## 7. Spark-to-Spark

- Il routing è automatico lato SDK
- Se sender e receiver usano entrambi Spark: pagamento istantaneo senza routing Lightning esterno
- Fee Spark-to-Spark generalmente inferiori ai pagamenti Lightning standard
- Dal punto di vista del codice: stesso flusso Send, `parse()` riconosce automaticamente se è Spark address

---

## 8. Lightning Address / LNURL

### Supporto confermato (da type definitions SDK)
- **Lightning Address** (`user@domain.com`) → `parse()` → LNURL-Pay → BOLT11
- **LNURL-Pay** → `parse()` → BOLT11
- **LNURL-Withdraw** → supportato
- **LNURL-Auth** → supportato
- **BIP353** (DNS Lightning Address) → `parse()` → LNURL-Pay

### In Alpha Chat
- Campo di pagamento accetta: BOLT11, Spark address, Lightning Address, LNURL
- `parse(input)` viene chiamato prima di `prepareSendPayment()` per normalizzare il tipo

---

## 9. Alpha Fee Model (0.10%)

### Regola
```
Alpha fee = max(0.10% di amountSats, minFeeSat)
```

### Modalità fee-excluded (recipient-exact)
```
gross = net / (1 - 0.001)     // ceiling integer sat
recipient riceve: net sats esatti
mittente paga:   gross + routing fee + operator fee
```

### Fee waterfall completa
```
amountSat (netto al destinatario)
+ Alpha fee (0.10%)
+ Spark/Lightning routing fee  (variabile — da SDK)
+ Breez operator fee           (TBD — pendente email)
= gross deducted dal wallet mittente
```

### Stessa BTC Treasury
- I sat Alpha fee vengono accumulati sullo stesso wallet treasury BTC esistente
- Nessun treasury separato per Lightning — semplicità operativa
- Il sweep treasury Lightning → BTC on-chain può avvenire via swap (da definire nel dettaglio)

---

## 10. Portfolio

### Struttura balance (mai auto-sommati)
```typescript
interface SparkPortfolio {
  btc_onchain_sats: number;       // Alpha Wallet BTC esistente
  btc_lightning_sats: number;     // balance Lightning/BOLT11
  spark_sats: number;             // balance Spark leaves
  // NOTA: btc_lightning + spark = "spark wallet total"
  // Ma vengono mostrati separatamente per chiarezza
}
```

### Regola display
> I balance BTC on-chain, Lightning e Spark NON vengono mai sommati automaticamente in un'unica cifra senza esplicita richiesta/interazione dell'utente.

Questo protegge da confusione UX e da potenziali inconsistenze durante sync.

### getInfo() response mapping
```typescript
const info = await sdk.getInfo({ ensureSynced: false });
// info.balanceSats → btc_lightning_sats + spark_sats (totale wallet Spark)
// Separazione Lightning vs Spark leaves: da verificare se SDK espone separatamente
```

---

## 11. Storico Pagamenti

### API
```typescript
const { payments } = await sdk.listPayments({
  limit: 50,
  offset: 0,
  // fromTimestamp / toTimestamp per paginazione temporale
});
```

### Tipo pagamento Lightning in storico Alpha
```typescript
type TxType =
  | 'btc_lightning_sent'
  | 'btc_lightning_received'
  | 'spark_sent'
  | 'spark_received'
  // Tipi già esistenti: btc_sent, btc_received, evm_*, etc.
```

### Persistenza storico
- I pagamenti Lightning vengono persistiti dal SDK in IDB (Spark store)
- Alpha NON duplica i pagamenti Lightning in MongoDB (evita sincronizzazione doppia)
- La sorgente di verità per lo storico Lightning è il SDK (IDB locale)

---

## 12. iOS / Background Execution

### Limiti fondamentali iOS Safari PWA (non risolvibili lato SDK)
| Scenario | Comportamento |
|----------|---------------|
| PWA in foreground | ✅ Funziona normalmente |
| PWA in background >30s | ⚠️ Tab sospesa, WebSocket chiuso |
| Ritorno in foreground | `syncWallet()` obbligatorio (durata ~10-15s su mainnet) |
| Ricezione in background | ❌ Non notificato in real-time |

### Mitigazione: Webhook + Web Push (VAPID)
```
Pagamento ricevuto → Breez server → registerWebhook()
    → POST Alpha API backend
    → Web Push VAPID (già in produzione)
    → Notifica push utente "Ricevuto N sats"
    → Utente apre PWA → syncWallet() → balance aggiornato
```

`registerWebhook(url)` è disponibile nel SDK. L'URL webhook punta all'API Alpha backend.

### Sequenza init in foreground (iOS)
```javascript
// visibilitychange handler (già presente in BreezSparkContext)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    await adapter.syncWallet();  // ~10-15s — mostrare spinner
  }
});
```

### UX implication
- Spinner "Sincronizzazione Lightning..." obbligatorio al connect() e al ritorno in foreground
- Balance mostrato solo dopo sync completato (evitare balance stale)

---

## 13. Recovery

### Scenari di recovery

| Scenario | Comportamento |
|----------|---------------|
| A: Refresh pagina | SDK si re-inizializza, IDB intatta, sync rapido |
| B: Browser restart | Identico ad A |
| C: IDB cancellata | SDK si re-inizializza come nuovo device, sync storico da operatori |
| D: Restore seed | Re-init con stesso mnemonic → operatori ri-sincronizzano leaves |
| E: Nuovo device | Stesso di D: mnemonic → tutto torna |
| F: Operatore offline (1/3) | Threshold 2/3 → pagamenti continuano |
| G: 2+ operatori offline | Pagamenti bloccati temporaneamente |
| H: Exit unilaterale | Dopo timeout (1000 blocchi ≈ 7 giorni) + bond 10k sats |

### Recovery Card
La Recovery Card esistente (contenente il mnemonic Alpha Wallet) copre **automaticamente** anche Lightning/Spark in Opzione A (seed unica). Nessuna card aggiuntiva necessaria. Il testo della card va aggiornato per includere il riferimento a Lightning.

---

## 14. Isolamento Totale dal BTC On-Chain

### Regola architetturale
- Il codice BTC on-chain (PSBT, selectBtcUTXOs, buildAndBroadcastPayout, etc.) non viene mai toccato dall'integrazione Spark
- Il codice Spark non importa mai moduli dal path BTC on-chain
- Dependency check da aggiungere in CI: nessun import cross-domain

### Wallet separation a runtime
```
Alpha Wallet context
├── BtcWalletService     (UTXO, BIP84, bitcoinjs-lib) — INVARIATO
└── SparkWalletService   (NUOVO — WASM, Breez SDK)
```

I due servizi non si chiamano mai direttamente.

### Swap on-chain ↔ Lightning
- Disponibile tramite SDK: `receivePayment({ paymentMethod: { type: "bitcoinAddress" } })`
- Questo è un servizio opzionale, non fa parte del core payment flow
- Fee swap: mining fee + operator fee (da dettagliare post-email Breez)

---

## 15. Kill Switch / Disattivazione Spark

### Feature flag (admin-controllato)
```typescript
// AdminSettings singleton (già esistente in production)
interface AppFeatureFlags {
  // ... flag esistenti (usdt_enabled, btc_enabled, etc.)
  spark_lightning_enabled: boolean;  // default: false fino a go-live
}
```

### Comportamento quando `spark_lightning_enabled = false`
- Il bottone "Invia/Ricevi Lightning" non appare in ChatPage
- Il SparkProvider non inizializza il SDK (nessun connect())
- Nessun IDB Spark viene creato
- Il codice Spark è presente ma dormiente

### Disattivazione di emergenza
- Admin disabilita `spark_lightning_enabled` → effetto immediato su tutti gli utenti
- I fondi utente restano nei wallet Spark (l'SDK non viene "distrutto")
- Al re-enable: SDK si re-inizializza con sync automatico

---

## 16. Gestione Fee Breez + Alpha

### Stack fee completo (da definire dopo risposta Breez)
```
[PENDENTE risposta Breez]
Operator fee: TBD per transazione o percentuale
Routing fee Lightning: variabile (0-1% tipico)
Alpha fee: 0.10% ceiling

Display all'utente:
"Stai inviando 1000 sats
 + routing fee: ~5 sats
 + Alpha fee: 1 sat
 = 1006 sats totali dal tuo wallet"
```

### Fee disclosure
- Tutte le fee vengono mostrate prima della conferma (no sorprese)
- `prepareSendPayment()` restituisce le fee calcolate prima di `sendPayment()`

---

## 17. Migrazione Futura

### V1 → V2 potenziale
Se in futuro si volesse passare da client-side WASM a server-side Lightning node (Phoenixd, LND, CLN):
- Lo `SparkWalletService` ha una interfaccia astratta (`BreezSparkAdapter`)
- La migrazione richiederebbe solo una nuova implementazione dell'adapter
- Il codice UI (ChatPage, bubble, sheet) non cambierebbe
- I fondi utente nei wallet Spark sarebbero portabili via backup seed

### SDK version upgrade
- Mantenere `@breeztech/breez-sdk-spark` nella dependency di `artifacts/breez-spark-poc/` come tracking
- Prima di upgrade in production: rilanciare PoC con nuova versione + verificare breaking changes

---

## 18. Test e Rollback

### Strategia test (per la fase di implementazione)

**Unit test (Vitest)**
- `MockBreezAdapter` → testabile senza network, senza WASM
- Coverage: fee calculation, state machine, error handling
- Obiettivo: 80%+ su SparkWalletService

**Integration test (PoC)**
- Rilanciare `runLiveCheckpoint` dopo ogni major change con API key reale
- Verificare connect() + getInfo() + syncWallet() + listPayments() OK

**E2E (Playwright)**
- Test Send sheet: preview fee → conferma → success bubble
- Test Receive: generate invoice → QR display
- Test in-chat bubble: stato pagamento polling

### Rollback plan
- Feature flag `spark_lightning_enabled = false` → Spark completamente dormiente
- Il codice Spark può essere rimosso senza impatto su BTC/EVM/USDA
- I fondi utente non vengono mai in Alpha backend → nessuna migrazione dati necessaria per rollback

### Checkpoint di approvazione durante implementazione
```
Phase 1: SparkWalletService + MockAdapter    → approvazione
Phase 2: LiveAdapter + connect() in prod     → approvazione
Phase 3: Send flow UI                        → approvazione
Phase 4: Receive flow UI                     → approvazione
Phase 5: Go-live (enable feature flag)       → approvazione esplicita
```

---

## 19. Sicurezza

### Threat model
| Threat | Mitigazione |
|--------|-------------|
| Private key exposure | ExternalSigner locale — chiave mai serializzata/trasmessa |
| Mnemonic exposure | Mai in localStorage, IDB manuale, log, o network request |
| API key exposure | Replit secret, mai in git, mai in log |
| IDB tampering | **APERTO** — contenuto non ancora analizzato |
| Operatore malevolo | Threshold 2/3 FROST — 1 operatore non può muovere fondi |
| WASM supply chain | Verificare hash SDK in lock file ad ogni upgrade |
| Replay attack | SDK gestisce nonces internamente |
| iOS side-channel | Earpiece/PWA limits non impattano il modello di sicurezza |

### Nessuna regressione garanzie
- `ChatPage.tsx` non deve essere importato da nessun nuovo modulo Spark
- Nessun modulo Spark importa da Alpha Wallet existenti (BTC, USDA, Signal)
- CI lint check: no cross-domain imports

---

## 20. Condizioni per GO TO PRODUCTION (aggiornate)

La risposta email Breez è trattata come **"Commercial / Provider Confirmation — Advisory"** e NON blocca il lavoro tecnico. L'implementazione controllata può procedere immediatamente.

Le condizioni per il GO-LIVE (feature flag `spark_lightning_enabled = true` in produzione) sono:

- [ ] **1. Test iPhone Safari reale** — verifica WASM + background su iOS 15+ (non simulatore)
- [ ] **2. Approvazione esplicita di questo documento** — prima di toccare qualsiasi file production
- [ ] **3. Analisi contenuto IDB Spark** — verificare se il WASM cifra le chiavi prima di persisterle
- [ ] **4. Tutti i test green** — unit, integration, regression BTC, build, lint, typecheck
- [ ] **5. Risposta Breez email** *(Advisory — non blocca tecnico, ma necessaria per go-live commerciale)*

**NON fare deploy production al termine dell'implementazione.** Il feature flag rimane `false`.

---

## 21. Admin Fee Configuration

### Principio di separazione

Le due fee Alpha Platform sono **singleton MongoDB indipendenti**, con model, route e audit log separati:

| Configurazione | Singleton | Default | Indipendente da |
|---|---|---|---|
| BTC on-chain Alpha fee | `alpha_wallet_fee_config` (`_id: "alpha-wallet-fee"`) | 10 bps (0.10%) | Spark fee |
| Spark/Lightning Alpha fee | `spark_fee_config` (`_id: "spark-fee"`) | 10 bps (0.10%) | BTC fee |

**Invariante di isolamento**: modificare la fee Spark NON modifica la fee BTC, e viceversa. I test `spark-isolation.test.ts` garantiscono questo a ogni build.

### Campi configurabili (Spark)

| Campo | Tipo | Default | Range | Descrizione |
|---|---|---|---|---|
| `fee_bps` | integer | 10 | 0–500 | Alpha Platform Fee in basis points |
| `min_fee_sat` | integer | 1 | ≥0 | Fee minima in satoshi |
| `quote_validity_sec` | integer | 30 | 5–300 | Validità quote in secondi |

### Provider fee: NON configurabile admin

La **provider fee** (Breez/Spark routing) è determinata dall'SDK al momento di `prepareSendPayment()`. Non esiste un campo admin per essa:
- Viene mostrata separatamente all'utente nella fee breakdown UI
- Non può essere sovrascritta dall'admin
- Non viene sommata silenziosamente alla Alpha fee

### Route API Spark fee

```
GET  /api/v1/spark/fee-config   — requireAdmin("read_only")
PATCH /api/v1/spark/fee-config  — requireAdmin("super_admin")
```

### Audit log obbligatorio

Ogni modifica PATCH genera un audit event `SPARK_FEE_UPDATED` con:
```json
{
  "event": "SPARK_FEE_UPDATED",
  "user_id": "<admin_id>",
  "created_at": "<timestamp_ISO>",
  "metadata": {
    "prev_fee_bps": 10,
    "new_fee_bps": 15,
    "prev_min_fee_sat": 1,
    "new_min_fee_sat": 1,
    "btc_fee_config_unchanged": true,
    "provider_fee_unchanged": true
  }
}
```

### Treasury destination

Entrambe le fee Alpha (BTC e Spark) vengono accreditate allo stesso BTC Treasury Alpha:
- **BTC**: direttamente (già in produzione)
- **Spark**: sweep Lightning → on-chain via SDK (da implementare in fase di go-live, non ora)
- **Nessun trasferimento reale nella fase corrente** — solo l'astrazione è implementata

### Test di isolamento

I test in `src/tests/spark/spark-isolation.test.ts` verificano:
- Modificare fee_bps Spark non altera fee BTC
- Modificare fee_bps BTC non altera fee Spark
- recipient_exact: recipientAmountSat invariato
- Provider fee mai confusa con Alpha fee nel totalDebit
- alphaPlatformFeeSat mai negativa (Treasury non riceve valore negativo)

### Admin panel (DIFFERITO)

L'UI admin per la fee Spark è **differita** a una fase successiva (non questa). Il modello, le route e i test sono pronti; la pagina admin visual verrà aggiunta quando il feature flag Spark viene abilitato in produzione.

---

## Appendice A — Findings PoC (Live Connect Checkpoint, 12 ago 2026)

| Test | Risultato |
|------|-----------|
| connect() mainnet (con API key) | ✅ PASS |
| getInfo() — identityPubkey | ✅ `0281363910b0dc0015a4a25e758da30f0e28388ea5252c0e3713936f2d4ef7d3d5` |
| getInfo() — balanceSats | ✅ 0 (test mnemonic, nessun fondo) |
| syncWallet() | ✅ PASS in 10936ms (~11s) |
| listPayments(limit:20) | ✅ 20 pagamenti (seed pubblica usata da altri dev) |
| IDB isolation | ✅ `breez-poc-live-v1/mainnet/d2ea863c` — zero store Alpha |
| Private key trasmessa | ✅ MAI |
| Mnemonic trasmesso | ✅ MAI |
| API key nei log | ✅ MAI |
| COOP/COEP su Replit | ✅ `crossOriginIsolated=true` |
| SharedArrayBuffer | ✅ Disponibile |

---

## Appendice B — File PoC (nessun file production toccato)

```
artifacts/breez-spark-poc/
├── src/
│   ├── lib/breez-spark/
│   │   ├── adapter.ts
│   │   ├── adapters/live.ts
│   │   ├── adapters/mock.ts
│   │   ├── constants.ts
│   │   ├── fee-model.ts
│   │   ├── index.ts
│   │   ├── signer.ts
│   │   ├── storage.ts
│   │   └── types.ts
│   ├── contexts/BreezSparkContext.tsx
│   ├── pages/SparkPoC.tsx         (test runner — 18 sezioni)
│   └── pages/SparkArchDemo.tsx    (architettura demo — 7 tab)
└── SPARK_ARCHITECTURE_DESIGN.md   (questo documento)
```

---

*Documento preparato come output della fase PoC. Nessun file production modificato.*  
*Prossima azione: attendere approvazione esplicita prima di qualsiasi implementazione.*
