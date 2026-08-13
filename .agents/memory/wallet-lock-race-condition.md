---
name: Wallet lock back-button race condition
description: Phase bug where pressing ← after locking the wallet stayed on the wallet screen instead of exiting
---

## The Rule
When `lockWallet()` is called from any subView other than "unlock" (e.g. "wallet-settings"), pressing ← before `useEffect([wallet.phase])` fires sends the user to "overview" instead of exiting. The back button must check `wallet.phase === "locked"` FIRST and always call `onBack()` in that case.

## Why
`lockWallet()` calls `setPhase("locked")` synchronously (React state), but `setSubView("unlock")` happens asynchronously via `useEffect([wallet.phase])` after the commit. In the window between these two, `subView` is still whatever the user was on (e.g. "wallet-settings"). The old back-button logic `(subView === "overview" || subView === "unlock") ? onBack() : setSubView("overview")` would call `setSubView("overview")` instead of `onBack()` — leaving the user still on the wallet.

## How to Apply
In `AlphaWalletInner` header back button (AlphaWalletPage.tsx), keep:
```js
if (wallet.phase === "locked") { onBack(); return; }
(subView === "overview" || subView === "unlock") ? onBack() : setSubView("overview");
```
This must come BEFORE any subView check. Applies to any future subView added to AlphaWalletPage.

## User Symptom
"Torno indietro e rimane sempre visibile — solo se chiudi l'app completamente risulta bloccato." The "close completely" workaround was unrelated — the actual issue was the first ← press calling setSubView("overview") instead of onBack(), requiring a second ← to exit.
