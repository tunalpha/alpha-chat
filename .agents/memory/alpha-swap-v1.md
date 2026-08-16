---
name: Alpha Swap V1 — BTC↔Lightning
description: Architettura, fee model, provider, e decision log del modulo Alpha Swap (isolato dal payment engine).
---

## Stato
Implementato, SWAP_ENABLED=false (disabilitato finché audit non approvato).

## Architettura provider-swappable
- `BitcoinLightningSwapProvider` (interfaccia) → `BoltzBtcLnProvider` | `BreezSparkBtcLnProvider`
- `SwapRouter` mappa direction→provider
- Tutti i file in `src/swap/` — zero cross-import con payment engine

## Fee model
- **BTC→LN (Boltz):** Alpha 25 bps = 0.25%; formula: `ceil(fromSat × alphaBps / 10000)`; ex: 100k sat → 250 sat Alpha fee
- **LN→BTC (Breez Spark fallback):** Alpha 0% temporaneo — SDK non espone integrator fee
- Fee Alpha swap memorizzata in `swap_config` collection (MAI in admin-settings o fee_config esistenti)

## Boltz extraFees param
- Passato come `extraFees: { percentage: 0.25, address: feeWalletAddress }` in createBoltzSubmarineSwap
- **⚠️ Richiede registrazione Partner Program** su portal.boltz.exchange prima che la fee venga accreditata

## Chiave refund Boltz (RISCHIO APERTO)
- Attualmente ephemeral (random key) in `BoltzBtcLnProvider.execute()`
- **Da risolvere prima del go-live:** derivare da wallet BTC utente (m/84'/0'/0'/2/swap_index)

## SparkWalletContext API per swap
- Usare `spark.calculateSendFee(req, "fee_excluded")` per la stima fee (non prepareSend che è privato)
- Sequenza LN→BTC: `calculateSendFee()` → `send(req, breakdown)`
- `SparkSwapExecutor` interface definita in `BreezSparkBtcLnProvider.ts` — minimale, hide SparkFeeBreakdown

## Fee math correction (test fix)
- 25 bps × 100,000 sat = 250 sat (NON 25) — errore iniziale nei test, già corretto
- BPS formula: `amount × bps / 10000`

## Test
- Frontend: 18/18 swap-isolation.test.ts + 1177/1177 full suite
- Backend: 19/19 swap-service.test.ts (4 pre-esistenti falliti non swap-related)

## Abilitazione
Admin panel → Swap Fee Config → toggle master switch → PATCH /api/v1/swap/admin/config { enabled: true }

**Why:** SWAP_ENABLED=false default protegge il payment engine da esposizione prematura. Il modulo è completamente isolato ma il flusso reale (Boltz mainnet, fee accredito) richiede Partner Program registration.
