---
name: BTC Send Uncertain Error
description: iOS network abort after BTC broadcast causes double-spend attempt — BtcSendUncertainError guard
---

# BTC Send Uncertain Error

## The rule
After `apiWalletBroadcastBtcTx` succeeds server-side but iOS aborts the HTTP response, the TX is already in Bitcoin mempool. **Never release `sendInProgressRef.current` or show "Riprova" in this case.**

## Why
iOS Safari PWA aborts in-flight HTTP connections when the app goes to background. `walletRequest` throws `WalletNetworkError`. Before this fix, the BTC catch block released the lock unconditionally → user retried → same UTXOs already in mempool → `bad-txns-inputs-missingorspent` from Blockstream. Lightning already had `SparkSendUncertainError` / `resolveUncertainMarker`; BTC had nothing.

## How to apply
- `btc-signer.ts`: `BtcSendUncertainError` exported. In `signAndBroadcastBtcTx`, the broadcast call wraps `WalletNetworkError` → `BtcSendUncertainError`.
- `AlphaWalletPage.tsx` SendView: `btcUncertain` state. In BTC catch: `if (e instanceof BtcSendUncertainError)` → keep lock active + `setBtcUncertain(true)`. Error render: no "Riprova" button + warning banner. "Annulla" releases lock + resets flag via `onClick`.
- Same pattern as Lightning's `lnUncertain`.

## Related
- `ios-polling-network-abort.md` — Safari iOS aborts HTTP in background
- `double-spend-uncertain-state.md` — MultiChain/EVM version of this pattern
- `btc-fee-floor.md` — other BTC send fixes
