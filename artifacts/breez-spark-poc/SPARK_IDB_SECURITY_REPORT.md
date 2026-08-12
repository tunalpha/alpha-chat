# Spark SDK — IDB Security Report
*Phase 4 · Audit completato: luglio 2026*

## 1. Cos'è memorizzato da Breez SDK in IndexedDB

Dall'analisi diretta delle chiavi IDB (`@breeztech/breez-sdk-spark`, mainnet):

| IDB Store | Tipo dati | Sensibilità |
|---|---|---|
| `settings` | JSON plain: `api_key`, `env`, `network` | ⚠️ API key visibile |
| `payment_*` | JSON plain: payment hash, amount, fees, memo | 🟡 Metadati finanziari |
| `channel_*` | JSON plain: state canale, nodi | 🟡 Privacy Lightning |
| `preimage_*` | JSON plain: preimage HTLC (32 byte hex) | 🔴 Critico: prova di pagamento |
| `lsp_info`  | JSON plain: endpoint LSP | 🟢 Basso |

**Mnemonic BIP39 NON presente**: confermato in Phase 3.1. Il mnemonic viene usato dal SDK solo per la derivazione (in-memory) e NON viene mai scritto su IDB.

---

## 2. Voce critica: preimage HTLC in chiaro

Il preimage HTLC (la "prova di pagamento" Lightning) è memorizzato come stringa hex in chiaro in IDB. Chiunque abbia accesso a IDB può:
- Provare di aver ricevuto un pagamento
- Costruire prove false in caso di collisione hash (teoricamente)

**Rischio pratico su PWA/Safari**: Basso. IDB è sandboxed per origine (`https://alpha.chat` vs altri). Tuttavia:
- XSS sul dominio può accedere a IDB
- Dispositivo sbloccato + DevTools = IDB leggibile

---

## 3. API key in chiaro in IDB

`VITE_BREEZ_API_KEY` viene salvata in plain text in IDB store `settings`. Questo è già il caso per tutte le app Breez SDK — non è un difetto specifico di Alpha Chat. La chiave Breez è necessaria per il routing LSP e non autentica l'utente.

**Mitigazione attuale**: la chiave è `VITE_BREEZ_API_KEY` (env var), non una chiave privata crittografica. Compromessa al massimo il quotaCurriculum routing LSP, non i fondi.

---

## 4. Ricerca API cifratura IDB ufficiale

**Risultato**: `@breeztech/breez-sdk-spark` **NON espone un'API custom storage** (v0.4.x).

Ricerca effettuata su:
- GitHub `breez/breez-sdk-liquid` — nessun `customStorage` hook nella versione JS/WASM
- Documentazione SDK Breez — nessuna menzione di `encryptedStorage` o `customStorage`
- Issues GitHub — feature request aperta, nessuna ETA

**Non implementare crittografia IDB improvvisata**: il SDK gestisce internamente la struttura dei dati IDB. Un wrapper custom non certificato potrebbe:
- Rompere l'integrità del database
- Causare perdita di canali/pagamenti
- Creare false garanzie di sicurezza

---

## 5. Namespace Spark IDB separato da Alpha Wallet

| Sistema | IDB Database | Crittografia |
|---|---|---|
| Alpha Wallet BTC | `alpha-wallet-v3-idb` | ✅ AES-256-GCM (PIN-derived) |
| Signal keystore | `signal-db-v*` | ✅ (Signal Protocol) |
| Breez SDK Spark | `spark-wallet-v1` (storageDir) | ❌ Plain JSON |
| IDB Trust (Signal) | `alpha-trust-store` | ✅ Separato |

Il namespace `spark-wallet-v1` è **completamente separato** da Alpha Wallet IDB. Nessuna contaminazione cross-store.

---

## 6. Rischio e raccomandazioni

### Rischio corrente: MEDIO
- Preimage HTLC in chiaro = esposizione alla storia dei pagamenti Lightning
- API key Breez in IDB = non critica (chiave routing, non chiave privata)
- Mnemonic NON esposto ✅

### Raccomandazioni

**R-1 (immediato)**: documentare nella privacy policy che Spark/Lightning memorizza metadati di pagamento in IDB in chiaro.

**R-2 (go-live prerequisito)**: attivare HTTPS strict + HSTS per ridurre rischio XSS (già presente su alpha.chat).

**R-3 (post go-live)**: monitorare aggiornamenti SDK Breez per API custom storage. Quando disponibile, valutare implementazione.

**R-4 (non fare ora)**: NON implementare cifratura IDB improvvisata. Attendere API ufficiale SDK.

**R-5 (opzionale)**: considerare pulizia IDB Spark su logout/lock per ridurre la finestra di esposizione.

---

## 7. Decisione documentata

**DECISIONE (Phase 4)**: Accettare il rischio IDB Spark plain JSON come noto e documentato. Non implementare crittografia custom (R-4). Tracciare il monitoraggio SDK (R-3) come task post-go-live.

*Approvazione richiesta da: Team Security prima del go-live.*
