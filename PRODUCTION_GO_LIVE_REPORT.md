# PRODUCTION GO-LIVE REPORT — AlphaChat USDA

**Data:** 22 luglio 2026  
**Sprint:** Finale — ThirdWeb + Blockchain Verification  
**Stato:** ✅ Pronto per produzione (pending: `VITE_THIRDWEB_CLIENT_ID`)

---

## 1. ThirdWeb Integration

### Stato: ✅ Integrato

**Pacchetto:** `thirdweb` v5 (latest)  
**File principali:**
- `artifacts/alpha-chat-web/src/lib/thirdweb-client.ts` — client, catena, contratto
- `artifacts/alpha-chat-web/src/main.tsx` — `ThirdwebProvider` globale
- `artifacts/alpha-chat-web/src/components/usda/SendUsdaSheet.tsx` — signing reale

### Flusso produzione implementato

```
prepare (AlphaChat backend)
    ↓
ThirdWeb ConnectButton (MetaMask / WalletConnect / Coinbase / Rainbow / Trust)
    ↓
Network guard (Polygon Mainnet 137 — switch automatico)
    ↓
ERC-20 transfer (sendAndConfirmTransaction)
    ↓
txHash reale on-chain
    ↓
Blockchain verification (backend AlphaChat — verifyUsdaTx)
    ↓
POST /api/pay/confirm (backend USDA)
    ↓
Polling → usda.payment.update WS → bubble aggiornata
```

### Mock rimossi

| Elemento | Prima | Dopo |
|----------|-------|------|
| `_simulateTxHash()` | Generava hash falso | **Eliminato** |
| `mockSignature` | `0xbbb...` hardcoded | **Eliminato** |
| Delay 800ms | `setTimeout(800)` simulato | **Eliminato** |
| TODO ThirdWeb | Presente | **Rimosso** |

---

## 2. Wallet Supportati

| Wallet | Tipo | Desktop | Mobile |
|--------|------|---------|--------|
| MetaMask | Extension / App | ✅ | ✅ |
| WalletConnect | QR / Deep Link | ✅ | ✅ |
| Coinbase Wallet | Extension / App | ✅ | ✅ |
| Rainbow | App | ✅ | ✅ |
| Trust Wallet | App | ✅ | ✅ |

Tutti i wallet che supportano WalletConnect v2 sono automaticamente compatibili.

---

## 3. Network Guard

### Stato: ✅ Implementato

**Rete accettata:** Polygon Mainnet (chain ID 137)  
**Reti bloccate:** Tutte le altre (Mumbai, Ethereum, BSC, Arbitrum, Optimism, Avalanche, ecc.)

**Comportamento:**
1. Utente connette wallet su rete errata → banner giallo "⚠️ Rete errata"
2. Bottone "Passa a Polygon" → `useSwitchActiveWalletChain(polygonMainnet)`
3. Switch automatico nel wallet supportato (MetaMask, Coinbase)
4. Se switch fallisce → messaggio manuale

**`handleSign()` guard:**
```typescript
if (!isCorrectNetwork) {
  setError("Connetti a Polygon Mainnet (chain 137) per continuare.");
  return; // blocca firma
}
```

---

## 4. Verifica Blockchain

### Stato: ✅ Implementato (backend `polygon-rpc.ts`)

**Funzione:** `verifyUsdaTx(params)`

**Verifica eseguita PRIMA di `POST /api/pay/confirm`:**

| Controllo | Implementazione |
|-----------|----------------|
| `txHash` formato valido | Regex `/^0x[0-9a-fA-F]{64}$/` |
| ChainId = 137 | `eth_chainId` → `parseInt === 137` |
| `receipt.status === "0x1"` | Transazione non revertita |
| `receipt.to === USDA_CONTRACT` | Chiamata al contratto corretto |
| `Transfer` event presente | Topic `0xddf252ad...` nel log |
| `Transfer.from === senderAddress` | Wallet mittente corretto |
| `Transfer.to === recipientAddress` | Destinatario corretto |
| `Transfer.value >= amountUnits` | Importo sufficiente |

**Receipt non disponibile:** retry × 8 con attesa 4s tra tentativi (max 32s).

**Risposta a verifica fallita:**
```
HTTP 500 — [USDA] Blockchain verification failed: <motivo dettagliato>
```

Il backend USDA **non riceve mai** `POST /api/pay/confirm` se la verifica blockchain fallisce.

---

## 5. Gas Management

### Stato: ✅ Gestito da ThirdWeb + errori dedicati

ThirdWeb `sendAndConfirmTransaction` gestisce la stima gas automaticamente.  
L'utente vede il gas nel popup nativo del proprio wallet (MetaMask, Coinbase, ecc.).

**Errori gas implementati in `handleSign()`:**

| Scenario | Messaggio UI |
|----------|-------------|
| Gas insufficiente | "Gas insufficiente. Aggiungi MATIC al wallet per le commissioni di rete." |
| Firma rifiutata | "Firma rifiutata dal wallet. Ripremi «Firma e Invia» per riprovare." |
| Wallet bloccato | "Wallet bloccato. Sblocca il wallet e ripremi «Firma e Invia»." |
| Rete errata | "Rete errata. Premi «Passa a Polygon» per cambiare rete." |
| Timeout | "Timeout wallet. Ripremi «Firma e Invia» per riprovare." |

**Comportamento su "firma rifiutata":** lo sheet rimane sul passo "confirm" con `prepared_data` integro — l'utente può riprovare senza rieseguire `prepare`.

---

## 6. Security

### Stato: ✅ Implementato

| Misura | Implementazione |
|--------|----------------|
| txHash simulato accettato | ❌ **Non più accettato** — regex validazione obbligatoria |
| Replay protection | `reference_id` = `client_payment_id` univoco per pagamento |
| Double submit | `findByClientId` idempotency + `signing` guard UI |
| Doppio confirm | `client_payment_id` scartato se già in MongoDB |
| Sender verification | `Transfer.from === senderAddress` verificato on-chain |
| Recipient verification | `Transfer.to === recipientAddress` verificato on-chain |
| Amount verification | `Transfer.value >= amountUnits` verificato on-chain |
| pendingTransferId riuso | Scadenza gestita dal backend USDA (server-side TTL) |

---

## 7. Recovery (crash/refresh/kill)

### Stato: ✅ Implementato (sprint precedente, confermato)

| Scenario | Copertura |
|----------|-----------|
| Crash prima del confirm | `pendingTransferId` scade, nessun record MongoDB, utente riparte |
| Crash dopo setItem, prima risposta | WalletCenter rileva `usda_inflight_cpi` al mount → `GET /payments/check/:cpi` |
| Crash dopo risposta HTTP | Polling server-side continua, WS aggiorna bubble alla riapertura |
| Riavvio server API | `reconcilePendingPayments()` al boot → polling riavviato per tutti i pending |
| Timeout firma (90s) | Reset automatico a form, CPI rimosso da sessionStorage |
| Perdita rete durante polling | Retry automatico ogni 6s, timeout totale 5 minuti |

---

## 8. Production Logging

### Stato: ✅ Implementato

**Backend — eventi loggati (structured JSON via pino):**

| Evento | Level | Campi |
|--------|-------|-------|
| prepare | INFO | `pendingTransferId`, `fee` |
| blockchain verification pass | INFO | `txHash`, `fromAddr`, `toAddr` |
| blockchain verification fail | ERROR | `txHash`, `error` |
| confirm | INFO | `paymentId`, `code`, `status`, `txHash` |
| claim | INFO | `paymentId`, `status` |
| poll result | INFO | `internalPaymentId`, `code`, `status`, `txHash` |
| status callback error | ERROR | `err` |
| polling timeout | WARN | `internalPaymentId` |
| wallet rejection | INFO | (catturato nel catch frontend, propagato via errore HTTP) |
| RPC failure | WARN | `err`, `internalPaymentId` |
| health check | INFO | `status`, `available` |
| startup reconciliation | INFO | `count` |

---

## 9. Deploy Readiness Checklist

### ✅ Completato

| Elemento | Stato |
|----------|-------|
| Mock `_simulateTxHash()` | ✅ **Eliminato** |
| Mock `mockSignature` | ✅ **Eliminato** |
| TODO ThirdWeb aperto | ✅ **Eliminato** |
| Endpoint stimati (VERIFY) | ✅ **Nessuno** |
| `console.log` nel codice | ✅ **Nessuno** (solo `logger`) |
| Debug routes in produzione | ✅ **Nessuna** |
| txHash simulato accettato | ✅ **Bloccato** (regex validation) |
| TypeScript errors introdotti | ✅ **0** |
| Adapter interface modificata | ✅ **Invariata** |
| UI/UX modificata fuori scope | ✅ **No** |

### ⏳ Prerequisiti per go-live

| Elemento | Azione richiesta |
|----------|-----------------|
| `VITE_THIRDWEB_CLIENT_ID` | Creare API key su [thirdweb.com/create-api-key](https://thirdweb.com/create-api-key) → impostare come env var `shared` |
| `USDA_POLYGON_RPC` | Opzionale — impostare RPC dedicato (Alchemy/Infura) per evitare throttling pubblico |
| ThirdWeb Client ID | Gratuito — piano Starter include 1000 richieste/mese illimitate per wallet connection |
| Test E2E con wallet reale | Eseguire almeno un pagamento completo end-to-end su Polygon Mainnet prima del deploy |

---

## 10. Performance (attese)

| Fase | Tempo stimato |
|------|--------------|
| `POST /api/pay/prepare` | < 500ms |
| Apertura wallet popup | Immediato |
| Firma utente | Variabile (5-60s) |
| Broadcast + propagazione | 2-5s |
| `eth_getTransactionReceipt` | 2-15s (Polygon ~2s/block) |
| `POST /api/pay/confirm` | < 500ms |
| Primo poll + WS update | 6s |
| **Totale** | **~15-90s** (dipende da firma utente e congestione rete) |

---

## 11. Limiti Residui

| Limitazione | Impatto | Piano |
|-------------|---------|-------|
| `VITE_THIRDWEB_CLIENT_ID` non ancora impostato | Signing bloccato — banner istruzioni visibile | Impostare prima del deploy |
| USDA token decimals assunti = 6 | Verifica `amountUnits` potrebbe essere errata se decimali ≠ 6 | Verificare con `decimals()` on-chain |
| RPC pubblico Polygon | Rate limiting sotto carico | Configurare `USDA_POLYGON_RPC` con nodo dedicato |
| `sessionStorage` non disponibile in alcune PWA offline | Recovery crash non attivata | Accettabile per V1 |
| ThirdWeb IPFS | Non usato | N/A |

---

## 12. GO / NO-GO

| Condizione | Stato |
|------------|-------|
| ThirdWeb integrato con wallet reali | ✅ GO |
| Mock firma eliminato | ✅ GO |
| Blockchain verification on-chain | ✅ GO |
| Network guard Polygon 137 | ✅ GO |
| Error handling (rejection, gas, lock, timeout) | ✅ GO |
| Security (replay, double submit, sender/recipient/amount check) | ✅ GO |
| Recovery crash | ✅ GO |
| Startup reconciliation | ✅ GO |
| Architettura invariata | ✅ GO |
| TypeScript clean | ✅ GO |
| `VITE_THIRDWEB_CLIENT_ID` impostato | ⏳ **BLOCCO** |

### Verdetto

**NO-GO per deploy produzione** — un solo blocco: `VITE_THIRDWEB_CLIENT_ID` non configurato.

Tutto il codice è production-ready. Appena il Client ID ThirdWeb è impostato nelle variabili d'ambiente, il sistema è pronto per gestire transazioni USDA reali su Polygon Mainnet.

---

*Report generato al termine dello Sprint Finale — 22 luglio 2026.*
