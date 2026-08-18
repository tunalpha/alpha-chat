---
name: ChangeNOW EVM→EVM Swap
description: Architettura e invarianti per swap EVM→EVM via ChangeNOW (Approccio A)
---

## Architettura

- **Backend**: collection separata `changenow_evm_swaps` (non tocca BTC→USDT existente)
- **Routes**: `/api/v1/swap/changenow/evm/*` (montate in v1/index.ts)
- **Frontend hook**: `useChangeNowEvmSwapState.ts` — state machine + history + notifiche
- **Frontend view**: `ChangeNowEvmSwapView.tsx` — rendered da SwapView quando provider=changenow

## Invarianti assoluti

### COMPLETED
```
isCompleted = cnStatus === "finished"
           && destinationTxHash !== null
           && destinationTxHash !== depositTxHash
```
MAI completed solo per confirming/exchanging/sending o per API response generica.

### DESTINATION ADDRESS
Sempre automatico dal wallet: alphaWalletAddress ?? activeEvmAddress.
MAI da input manuale. Se cambia account → invalida swap precedente.

### CAMPI SEPARATI
- `depositTxHash` = TX utente → payinAddress ChangeNOW
- `destinationTxHash` = TX ChangeNOW → utente (payoutHash)
- MAI intercambiabili

### SOURCE OF TRUTH
ChangeNOW API quando provider=changenow. Stato non retrocede mai nel DB.

## Cronologia

ID record: `cn_evm:{swapId}` — un solo record aggiornato idempotente.
Non due record separati IN/OUT visibili come operazioni distinte.

## Notifiche

DedupKey sintetico: `cn_evm:{swapId}:{eventType}`
Passa come txHash a dispatchWalletNotification → buildDedupKey lo incorpora.
Nessun doppio invio per polling ripetuto sullo stesso stato.

## Ticker verificati (2026-08-18)

pol ✅ (minAmount ~11.4), usdcmatic ✅, usdtmatic ✅, eth ✅, usdterc20 ✅, bnb ✅, usdtbsc ✅

## Sicurezza

- API key ChangeNOW: solo server-side
- Firma TX EVM: SOLO nel wallet utente (Alpha Wallet via createAlphaWalletViemClient)
- Server crea ordine e fornisce depositEvmAddress — NON firma, NON custodisce fondi
- writeContract/sendTransaction: castato a `any` per compatibilità viem WalletClient

## Test

26/26 PASS in `api-server/src/tests/swap/changenow-evm-swap.test.ts`
Include: T11 (finished+payoutHash → completed), T12 (finished senza payout → NOT completed),
T13 (payoutHash===depositTxHash → NOT completed), T18 (rete KO → usa DB), polling idempotente.
