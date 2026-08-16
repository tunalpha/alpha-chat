# Alpha Swap V1 — Audit Report Pre-Go-Live
**Data:** 16 agosto 2026  
**Stato:** SWAP_ENABLED = false ✅ — non attivo in produzione

---

## 1. File modificati (impatto audit)

### Backend (api-server)
| File | Tipo | Note |
|---|---|---|
| `src/models/swap-config.model.ts` | **NUOVO** | Singleton config, isolato da admin-settings |
| `src/models/swap.model.ts` | **NUOVO** | Swap record + eventi audit trail |
| `src/services/swap/boltz.service.ts` | **NUOVO** | Client Boltz API v2 |
| `src/services/swap/swap.service.ts` | **NUOVO** | Business logic swap |
| `src/controllers/swap.controller.ts` | **NUOVO** | Handlers HTTP |
| `src/routes/v1/swap.routes.ts` | **NUOVO** | Routes `/api/v1/swap/*` |
| `src/routes/v1/index.ts` | **MODIFICATO** | +2 righe: mount swap routes |
| `src/tests/swap/swap-service.test.ts` | **NUOVO** | 19 test |

### Frontend (alpha-chat-web)
| File | Tipo | Note |
|---|---|---|
| `src/swap/types.ts` | **NUOVO** | Tipi condivisi swap module |
| `src/swap/SwapProvider.ts` | **NUOVO** | Interfaccia provider (astratta) |
| `src/swap/providers/BoltzBtcLnProvider.ts` | **NUOVO** | BTC→LN via Boltz |
| `src/swap/providers/BreezSparkBtcLnProvider.ts` | **NUOVO** | LN→BTC via Breez Spark |
| `src/swap/SwapRouter.ts` | **NUOVO** | Routing direction→provider |
| `src/swap/useSwapState.ts` | **NUOVO** | State machine hook |
| `src/swap/SwapView.tsx` | **NUOVO** | UI principale |
| `src/swap/SwapHistory.tsx` | **NUOVO** | Storico swap |
| `src/swap/index.ts` | **NUOVO** | Barrel export |
| `src/pages/AlphaWalletPage.tsx` | **MODIFICATO** | +1 import + case "swap" usa SwapView |
| `src/tests/swap/swap-isolation.test.ts` | **NUOVO** | 18 test |

### Admin Panel
| File | Tipo | Note |
|---|---|---|
| `src/pages/swap-monitor.tsx` | **NUOVO** | Lista swap con filtri |
| `src/pages/swap-revenue.tsx` | **NUOVO** | Revenue aggregata |
| `src/pages/swap-fee-config.tsx` | **NUOVO** | Config fee (super_admin) |
| `src/App.tsx` | **MODIFICATO** | +3 route swap |
| `src/components/layout/Sidebar.tsx` | **MODIFICATO** | +3 voci nav swap |
| `src/lib/api.ts` | **MODIFICATO** | +swapAdminFetch + swapAdminPatch |

### File NON modificati (invarianza confermata)
- ❌ `payment engine/*` — invariato
- ❌ `usda-payment.*` — invariato
- ❌ `multichain-payment.*` — invariato
- ❌ `chat-wallet-bridge*` — invariato
- ❌ `spark-fee-config.*` — invariato
- ❌ `alpha-wallet-fee-config.*` — invariato
- ❌ `btc-signer.ts` (signAndBroadcastBtcTx) — invariato
- ❌ `spark-fee-wallet-executor.ts` — invariato
- ❌ `gas-station.*` — invariato
- ❌ `treasury.*` — invariato
- ❌ `admin-settings.model.ts` — invariato

---

## 2. Flusso BTC → Lightning (Boltz Submarine)

```
Utente → SwapView (direction=btc_to_lightning, amountSat)
         → BoltzBtcLnProvider.getQuote()
         → POST /api/v1/swap/quote/btcln?amount=X   [auth]
         → swap.service.getBtcLnQuote()
         → boltz.service.getBoltzSubmarineFees()    [GET /v2/swap/submarine]
         → ritorna quote con fee Boltz + fee Alpha
         
Utente conferma
         → SwapView: spark.calculateSendFee({paymentRequest: spark_invoice})
           (pre-crea BOLT11 invoice per importo netto)
         → BoltzBtcLnProvider.execute()
         → POST /api/v1/swap/create/btcln            [auth]
         → swap.service.createBtcLnSwap()
         → boltz.service.createBoltzSubmarineSwap({invoice, refundPublicKey, extraFees})
         → salva ISwap in MongoDB (collection: swaps)
         → ritorna boltz_lockup_address + expected_amount_sat
         
Utente invia BTC all'indirizzo Boltz (da wallet on-chain)
         → Boltz paga BOLT11 → saldo Lightning aumenta
         
Polling: GET /api/v1/swap/status/:swapId
         → boltz.service.getBoltzSwapStatus()
         → aggiorna state in MongoDB
         → SwapView aggiorna UI
```

**Fee BTC→LN:**
- Boltz percentage: 0.1% (variabile — dipende da stato rete)
- Boltz miner fee: ~302 sat (variabile)
- Alpha fee: 25 bps = 0.25% → passata come `extraFees.percentage=0.25`
- **Total debit utente** = `from_amount + alpha_fee_sat` (ceil)
- **Recipient riceve** = `from_amount - boltz_fee - miner_fee`

**Formula fee (invariante):**
```
boltzFee = ceil(fromSat × boltzPct / 100)
alphaFee = ceil(fromSat × alphaBps / 10000)
toSat    = fromSat − boltzFee − minerFee          // > 0 garantito da guard
totalDebit = fromSat + alphaFee
```

---

## 3. Flusso Lightning → BTC (Breez Spark Fallback)

```
Utente → SwapView (direction=lightning_to_btc, amountSat, btcAddress)
         → BreezSparkBtcLnProvider.getQuote()
         → spark.calculateSendFee({paymentRequest: btcAddress, amountSat})
           (stima fee provider dal SDK — reverse submarine interno)
         → ritorna quote con providerFee, alphaFee=0

Utente conferma
         → BreezSparkBtcLnProvider.execute()
         → spark.calculateSendFee() poi spark.send({paymentRequest: btcAddress, amountSat}, breakdown)
           (Breez SDK esegue internamente reverse submarine swap)
         → POST /api/v1/swap/record/lnbtc            [auth, best-effort]
           (registra record per storico/monitoring)
         → ritorna paymentId
         
Saldo Lightning diminuisce, BTC on-chain arriva a btcAddress (1-2 conferme)
```

**Fee LN→BTC:**
- Alpha fee: **0% PERMANENTEMENTE** per ora (Breez SDK non espone integrator fee)
- Provider fee: inclusa nel SDK, stimata ~0.5% + 300 sat
- **Questa è una limitazione NOTA** — sostituire BreezSparkBtcLnProvider quando disponibile un provider con fee integrator

---

## 4. Fee per direzione (invarianti)

| Direzione | Provider | Alpha Fee | Modifica fee globale |
|---|---|---|---|
| BTC → LN | Boltz Submarine | **25 bps (0.25%)** | ❌ No — SwapConfig separato |
| LN → BTC | Breez Spark (fallback) | **0% temporaneo** | ❌ No — invariato |

**Conferma isolamento fee:**
- `btcln_fee_bps` = campo esclusivo di `SwapConfig` (collection: `swap_config`)
- NON condiviso con `spark_fee_config.platform_fee_bps`
- NON condiviso con `alpha_wallet_fee_config.btc_fee_bps`
- NON condiviso con `admin-settings`
- NON condiviso con `fee_wallet_configs`

---

## 5. SWAP_ENABLED = false — Conferma

```typescript
// swap-config.model.ts (default protetto)
const SWAP_CONFIG_DEFAULTS = {
  enabled: false,   // ← default permanente fino ad audit
  ...
};
```

**Comportamento con SWAP_ENABLED=false:**
- `GET /api/v1/swap/config` → ritorna `{ config: { enabled: false } }` (sempre OK)
- `GET /api/v1/swap/quote/btcln` → `503 SWAP_DISABLED`
- `POST /api/v1/swap/create/btcln` → `503 SWAP_DISABLED`
- `POST /api/v1/swap/record/lnbtc` → `503 SWAP_DISABLED` (solo guarda config per display)
- Frontend SwapView → mostra "Swap in arrivo" banner

---

## 6. Risultati test

| Suite | Test | Pass | Fail |
|---|---|---|---|
| `swap-isolation.test.ts` (frontend) | 18 | 18 | 0 |
| `swap-service.test.ts` (backend) | 19 | 19 | 0 |
| Suite completa frontend | 1177 | 1177 | 0 |
| Suite completa backend | 943 | 939 | **4 pre-esistenti** |

**4 test pre-esistenti falliti (non correlati a swap):**
1. `jwt.service.test.ts` — timing test token expiry
2. `refresh-token.service.test.ts` — timing test
3. `27-temp-password.test.ts` — auth endpoint test
4. `payment-quote.test.ts` — regex isolation guard (già falliva prima)

---

## 7. Rischi residui (da risolvere prima del go-live)

| # | Rischio | Severità | Mitigazione |
|---|---|---|---|
| R-1 | **Boltz Partner Program** — senza registrazione di "alpha-wallet", `extraFees` è accettata ma non accreditata. La fee NON arriva ad Alpha. | 🔴 CRITICO | Registrarsi su portal.boltz.exchange prima di abilitare swap |
| R-2 | **Chiave refund Boltz** — attualmente ephemeral (random per swap). Se il tx Boltz fallisce, il refund richiede la chiave privata corrispondente. | 🔴 CRITICO | Derivare da wallet BTC utente (`m/84'/0'/0'/2/<swap_index>`) prima di go-live |
| R-3 | **LN→BTC fee 0%** — Alpha non guadagna su questa direzione. | 🟡 BASSO | Trovare provider alternativo con `integrator fee` |
| R-4 | **Boltz può re-disabilitare** — `"swap creation is disabled"` gestito con errore `BOLTZ_DISABLED`. | 🟡 BASSO | Architettura provider-swappable: sostituire solo il provider |
| R-5 | **Li.Fi portal** — integrazione EVM swap non implementata in V1. Nessun rischio attivo. | 🟢 N/A | Implementare in V2 separatamente |
| R-6 | **Treasury routing fee swap** — la fee Alpha del swap (25 bps su Boltz) non viene inviata automaticamente al treasury. | 🟡 MEDIO | Definire modello fee sweep prima del go-live |

---

## 8. Checklist go-live

- [ ] Registrare "alpha-wallet" su Boltz Partner Program
- [ ] Implementare refund key derivata da wallet BTC utente (no more ephemeral)
- [ ] Definire treasury routing per fee Alpha swap
- [ ] Abilitare via admin panel: `PATCH /api/v1/swap/admin/config { enabled: true }`
- [ ] Testare end-to-end su mainnet con importo minimo
- [ ] Trovare provider LN→BTC con integrator fee (task separato)
- [ ] Audit sicurezza sul path Boltz (man-in-the-middle, invoice manipulation)
