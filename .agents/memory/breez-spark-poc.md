---
name: Breez SDK Spark PoC
description: Stato architettura, findings critici e decision log per l'integrazione Lightning con Breez SDK Spark nel PoC isolato (artifacts/breez-spark-poc/)
---

## Ambiente

- **COOP/COEP headers**: sopravvivono al proxy Replit dev → `crossOriginIsolated=true` confermato via Playwright
- **SharedArrayBuffer**: disponibile (conseguenza di crossOriginIsolated=true)
- **WASM binary**: 7.2MB, carica correttamente nel browser
- **IDB**: `breez-poc-test-v1/mainnet/d2ea863c` — creato prima del fallimento di connect()
- **getSparkStatus() browser**: bloccato da CORS (`spark.money/api/v1/status` — no CORS header). Funziona in Node.js. In produzione: proxied dal backend Alpha.

## Findings critici

### API Key
- `connect()` su mainnet richiede `apiKey` obbligatoria (errore: `"Missing Breez API key"` — rifiuto immediato)
- API key **GRATUITA** via form: `breez.technology/request-api-key` o curl `breez.technology/contact/apikey`
- Email inviata a contact@breez.technology con 15 domande tecniche + richiesta chiave
- Quando disponibile: aggiungere come `VITE_BREEZ_API_KEY` secret Replit nel PoC

### Derivation path (FORMALMENTE DOCUMENTATO)
- Spark purpose: `m/8797555'/accountNumber'/keyType'`
- `8797555'` = SHA256("spark") last 3 bytes = 0x863d73
- Identity key: `m/8797555'/1'/0'` (mainnet, account=1)
- **MAINNET default account = 1** (non 0 — errore comune)
- BTC on-chain Alpha Wallet: `m/84'/0'/0'/0/{idx}` (purpose 84)
- Separazione garantita per design — nessuna collisione possibile
- Empiricamente verificato: BIP84 pubkey ≠ Spark identity pubkey
- Fonte ufficiale: `docs.spark.money/wallets/identity-key-derivation`

### Network support
- SDK v0.15.1 supporta solo `"mainnet" | "regtest"` — NO signet/testnet
- BOLT12 receive: NON supportato in `ReceivePaymentMethod` — solo BOLT11/sparkAddress/bitcoinAddress

## Architettura PoC (pre-API-key)

Tutti i file in `artifacts/breez-spark-poc/src/`:

- `lib/breez-spark/types.ts` — tutte le interfacce
- `lib/breez-spark/constants.ts` — derivation paths, IDB namespaces, fee model
- `lib/breez-spark/adapter.ts` — BreezSparkAdapter interface + factory
- `lib/breez-spark/adapters/mock.ts` — MockBreezAdapter (funziona senza API key)
- `lib/breez-spark/adapters/live.ts` — LiveBreezAdapter (wrappa SDK reale)
- `lib/breez-spark/fee-model.ts` — Alpha 0.10% + Spark TBD (feesExcluded)
- `lib/breez-spark/signer.ts` — ExternalSigner wrapper + derivation audit
- `lib/breez-spark/storage.ts` — IDB namespace manager + isolation check
- `contexts/BreezSparkContext.tsx` — state machine (6 stati) + hooks
- `components/spark/` — ConnectPanel, SendSheet, ReceiveSheet, SparkBalance, SparkTransactionHistory, SecurityChecklist, TestChecklist
- `pages/SparkArchDemo.tsx` — demo architettura con tab
- `App.tsx` — nav tra 🏗️ Architettura e 🧪 Test Runner

**Why**: il codice production non deve MAI importare direttamente da `@breeztech/breez-sdk-spark`. Solo `LiveBreezAdapter` importa l'SDK. `MockBreezAdapter` gira senza dipendenze esterne.

## iOS — classificazione definitiva
- iOS background execution = **iOS PWA PLATFORM LIMITATION** (non bug SDK)
- Mitigazione: `registerWebhook()` → Alpha backend → Web Push VAPID (già in produzione)

## Cosa manca prima di integrazione production
1. API key ricevuta + connect() verificato con PASS
2. Risposta Breez su costi operatori
3. Architettura design document approvato esplicitamente
4. Test su iPhone Safari reale
