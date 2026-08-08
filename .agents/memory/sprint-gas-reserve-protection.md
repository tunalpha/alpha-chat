---
name: Gas Reserve Protection — waiting_for_gas
description: Stato waiting_for_gas introdotto per preservare i trasferimenti quando il gas station è esaurito; decisioni architetturali e invarianti di sistema.
---

## Regola fondamentale
Se `ensureMultiChainEscrowGas` rileva che il gas station non ha fondi sufficienti, NON deve mai portare il transfer a "failed" né fare rollback del deposito.
Il deposito è al sicuro nell'escrow — il transfer va a "waiting_for_gas" e si auto-recupera.

## GasReserveDepletedError
- Classe custom esportata da `multichain-payment.service.ts`
- Campi: `network`, `escrowAddress`, `required: bigint`, `available: bigint`, `code = "GAS_RESERVE_DEPLETED"`
- Lanciata SOLO da `ensureMultiChainEscrowGas`:
  1. Escrow ha bisogno di top-up E gas station ha `gsBalance < topUp` → throw PRIMA di sendTransaction
  2. sendTransaction fallisce dopo il balance check (race condition) → wrappare come GasReserveDepletedError
- Se `GAS_STATION_PRIVATE_KEY` non configurato → warning + return (non-blocking, dev/test)

## State machine waiting_for_gas
```
pending → (release, GasReserveDepletedError) → waiting_for_gas
waiting_for_gas → (scheduler, gas disponibile) → releasing → released
waiting_for_gas → (scheduler, gas ancora vuoto) → waiting_for_gas (gas_retry_count++)
```
- NESSUN refund automatico da waiting_for_gas
- NESSUNA transizione a "failed" per gas insufficiente
- Il deposito non viene mai toccato mentre in waiting_for_gas

## Nuovi campi nel model
- `waiting_for_gas` aggiunto all'enum status in Mongoose + TypeScript union
- `gas_retry_count: number` (default 0): incrementato da `_transitionToWaitingForGas` ad ogni fallimento
- Indice: `{ status: 1, network: 1 }` per recovery scheduler

## acquireMCLock — lock da waiting_for_gas
- `releaseFromWaitingForGas` acquisisce il lock con `fromStatus: "waiting_for_gas"` → `toStatus: "releasing"`
- Se gas ancora insufficiente → torna a `waiting_for_gas` (conservativo)
- Se errore non-gas con `tx_hash_release: null` → torna a `waiting_for_gas` (conservativo, non pending)

## Admin alert (_fireGasDepletedAlert)
- Log pino a livello `error` con campi: transferId, network, asset, escrowWallet, nativeRequired, nativeAvailable, nativeUnit, gasRetryCount, reason, timestamp, depositPreserved, autoRecovery
- MAI includere: private_key, escrow_encrypted_pk, GAS_STATION_PRIVATE_KEY, seed phrase

## Response client (handleReleaseTransfer)
- Se `status === "waiting_for_gas"` → HTTP 200 (non 5xx!) con `message: "Pagamento ricevuto — elaborazione in corso. Riceverai conferma a breve."`
- Il client non vede mai "insufficient gas", "GasReserveDepletedError" o dettagli tecnici

## Scheduler
- `processWaitingForGasTransfers()` aggiunto a `_runAll()` + `setInterval(EXPIRE_INTERVAL_MS)` (ogni 5 min)
- Chiama `releaseFromWaitingForGas(doc.transfer_id)` per ogni waiting_for_gas
- Errori non-gas: logga + continua (mai propagare, altri transfer continuano)

## Admin monitor (frontend)
- `MCStatus` type: aggiunto `"waiting_for_gas"`
- `STATUS_COLORS`: amber (`bg-amber-500/10 text-amber-300 border-amber-500/30`)
- KPI card: "⛽ Attesa Gas" con `color="text-amber-300"` (griglia 8 colonne)
- Filter dropdown: "Waiting for Gas ⛽"
- `MCStats.totals.waitingForGas: number` (backend stats endpoint)

## Test coverage
- Test A: gas sufficiente → release normale (baseline invariato)
- Test B: GS insufficiente → waiting_for_gas (no TX, fee invarianti)
- Test B2: releaseFromWaitingForGas con gas ancora vuoto → waiting_for_gas, retry_count++
- Test C: gas ripristinato → scheduler → released
- Test C2: errore imprevisto nel service → scheduler logga + continua
- Test F: GS completamente vuoto (0 wei) → waiting_for_gas, non failed
- Test G: gas ancora vuoto → transfer rimane in waiting_for_gas
- Test G2: nessun transfer waiting_for_gas → no-op
- Test H: nessuna eccezione tecnica propagata al caller

**Why:** Gas station esauribile in produzione (volatilità prezzo gas, fondi non monitorati continuamente). Senza questa protezione, i fondi degli utenti resterebbero bloccati con status "failed" non recuperabile.
