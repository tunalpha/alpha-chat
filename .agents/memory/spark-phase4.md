---
name: Spark Phase 4 — Keystore Wiring + Admin Fee UI + Treasury Accounting
description: Dettagli implementativi Phase 4 Spark/Lightning — wiring keystore, admin UI, treasury, 5 test file, docs
---

## Keystore wiring (LiveSparkAdapter._getMnemonic)

**Pattern**: `SparkWalletProvider` accetta prop opzionale `getMnemonic?: () => Promise<string>`.
- Passato attraverso `connect()` in `SparkConnectConfig.getMnemonic`
- `LiveSparkAdapter` salva il callback in `_getMnemonicFn` all'inizio di `connect()`
- `App.tsx` `SparkWalletProviderWrapper` fornisce il callback con `useCallback`:
  - Legge `sessionStorage.getItem("aw_bio_pin")` (già scritto da `unlockWallet`/`importWallet`)
  - Chiama `loadKeystore()` + `decryptSeed(entry, pin)` (dynamic import)
  - WalletContext BTC NON modificato

**Why**: Il PIN è nella session cache (biometric unlock — già esistente nel codebase). Non richiede modifiche a WalletContext. Il mnemonic plaintext è in memoria solo durante `connect()`.

**How to apply**: NON modificare WalletContext per aggiungere Spark. Usare sempre il callback iniettato.

## Admin Panel — Spark / Lightning Fee

- Pagina: `artifacts/admin-panel/src/pages/spark-lightning-fee.tsx`
- API client: `artifacts/admin-panel/src/lib/spark-api.ts`
- Route: `/spark-lightning-fee`, nav label "Spark / Lightning"
- Endpoint: `/api/v1/spark/fee-config` (già esistente Phase 3)
- Icona Lucide: `Zap` — aggiunta all'import Sidebar.tsx

**Why**: Separata da Alpha Wallet Fee (BTC on-chain). Stessa UI pattern di alpha-wallet-fee.tsx.

## Treasury Accounting — FeeRecordSource

- `IAlphaWalletFeeRecord.source?: FeeRecordSource` aggiunto (backward compat)
- `FeeRecordSource = "btc_onchain" | "spark_lightning"` (sia backend model che spark-types.ts frontend)
- Nuovo servizio: `api-server/src/services/spark-treasury-accounting.ts`
  - `recordSparkFee(payload)` — idempotente, `_id = spark_{paymentHash}`
  - `network = "lightning"`, `assetSymbol = "BTC_SAT"`, `source = "spark_lightning"`
  - NON esegue sweep on-chain (solo ledger)
  - `assertSparkFeeRecord()` guard prima della scrittura

**Why**: Stessa collection `alpha_wallet_fee_records`, source distinta per contabilità separata.

## Test files Phase 4 (5 nuovi)

| File | Sezioni | Test |
|---|---|---|
| `spark-keystore-isolation.test.ts` | 1-7 (BTC/Spark derivation, mnemonic leak) | ~25 |
| `spark-fee-isolation.test.ts` | A-G (fee engine purity, Treasury) | ~30 |
| `spark-treasury-isolation.test.ts` | A-E (source separation, contabilità) | ~15 |
| `spark-feature-flag.test.ts` | A-E (flag=false no-op, zero Spark) | ~20 |
| `spark-security.test.ts` | A-E (mnemonic non esposto, API key) | ~20 |

**Totale Phase 4**: 861 test (773 Phase 3.1 + 88 nuovi) — tutti PASS

## Documenti prodotti

- `SPARK_IDB_SECURITY_REPORT.md` — analisi IDB plain JSON, no API cifratura ufficiale, rischio MEDIO
- `SPARK_IOS_TEST_CHECKLIST.md` — 7 sezioni, 30+ check per iPhone fisico
- `SPARK_SEND_RECEIVE_TEST_PLAN.md` — mock (A), testnet (B), vincoli sicurezza (C)

## Invarianti confermati Phase 4

- `spark_lightning_enabled=false` — Spark dormant, zero JS al caricamento
- `SparkWalletContext-*.js` è chunk lazy separato (NON nel main bundle)
- `@breeztech/breez-sdk-spark` NON nel dist (external + lazy) → `[]` al cold start
- Build SUCCESS 29.95s, 43 test files PASS, Admin panel TS 0 errori
- TS errors pre-esistenti (CallContext, AnimatedStickerPlayer, keystore.ts) NON introdotti da Phase 4

## RTL renderHook wrapper — gotcha

RTL `renderHook` wrapper NON propaga le props extra (es. `enabled`) dopo `rerender()`.
Le props extra vanno solo alla hook function. Per testare toggle: usare render separati.

## Stop conditions (ancora attive)

- NON modificare WalletContext BTC
- NON modificare ChatPage.tsx
- NON impostare `spark_lightning_enabled=true`
- STOP se mnemonic rischia di uscire dal client
