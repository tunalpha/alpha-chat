---
name: Wallet lock back-button race condition
description: Phase bug where pressing ← after locking the wallet stayed on the wallet screen instead of exiting
---

## The Rule
When `lockWallet()` is called from any subView other than "unlock" (e.g. "wallet-settings"), pressing ← before `useEffect([wallet.phase])` fires sends the user to "overview" instead of exiting. The back button must check `wallet.phase === "locked"` FIRST and always call `onBack()` in that case.

## Why
`lockWallet()` calls `setPhase("locked")` synchronously (React state), but `setSubView("unlock")` happens asynchronously via `useEffect([wallet.phase])` after the commit. In the window between these two, `subView` is still whatever the user was on (e.g. "wallet-settings"). The old back-button logic `(subView === "overview" || subView === "unlock") ? onBack() : setSubView("overview")` would call `setSubView("overview")` instead of `onBack()` — leaving the user still on the wallet.

## How to Apply
Three-layer fix (all required):
1. `AlphaWalletInner` header back button: `if (wallet.phase === "locked") { onBack(); return; }` BEFORE any subView check.
2. `App.tsx AppContent`: `history.pushState({ aw: true }, "")` when view → "alpha-wallet"; popstate listener calls `setView("chat")`. Enables iOS swipe-back in PWA.
3. `UnlockView({ onExit })`: explicit "← Indietro" button inside the lock screen content that calls `onExit` directly — works even if the header button is inaccessible.
4. `UnlockView` is now called as `<UnlockView onExit={onBack} />` from `renderContent()`.

## User Symptom
"Non succede nulla rimane sempre visibile." Multiple causes: (a) race condition where ← pressed before useEffect changed subView to "unlock"; (b) iOS swipe-back gesture not working (React SPA has no history entries); (c) header ← button potentially inaccessible. All three layers together ensure reliable exit.

## CSS note
`.aw-unlock` has only padding — NOT position:absolute. `.aw-secure-overlay` IS position:absolute;inset:0;z-index:10 but only renders during seed phrase viewing (CreatePhraseView). `.aw-tx-detail` is position:fixed;inset:0;z-index:10 and covers the header by design (only in TxDetailView, has its own back button).
