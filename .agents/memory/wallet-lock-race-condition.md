---
name: Wallet lock back-button race condition
description: Phase bug where pressing ← after locking the wallet stayed on the wallet screen instead of exiting
---

## The Rule
When `lockWallet()` is called from any subView other than "unlock" (e.g. "wallet-settings"), pressing ← before `useEffect([wallet.phase])` fires sends the user to "overview" instead of exiting. The back button must check `wallet.phase === "locked"` FIRST and always call `onBack()` in that case.

## Why
`lockWallet()` calls `setPhase("locked")` synchronously (React state), but `setSubView("unlock")` happens asynchronously via `useEffect([wallet.phase])` after the commit. In the window between these two, `subView` is still whatever the user was on (e.g. "wallet-settings"). The old back-button logic `(subView === "overview" || subView === "unlock") ? onBack() : setSubView("overview")` would call `setSubView("overview")` instead of `onBack()` — leaving the user still on the wallet.

## ROOT CAUSE (definitive)
The "Blocca wallet" buttons in SecurityView (line 2884) and WalletSettingsView (line 3296) were NOT exiting the wallet to chat:
- SecurityView: `onClick={wallet.lockWallet}` — locks only, stays on SecurityView → useEffect redirects to UnlockView
- WalletSettingsView: `onClick={() => { wallet.lockWallet(); onBack(); }}` — `onBack` was `setSubView("overview")`, NOT the top-level exit → useEffect redirects to UnlockView

Both trapped the user on the lock screen with no working exit path.

## Fix Applied
Added `onLockAndExit?: () => void` prop to both SecurityView and WalletSettingsView, passed as `onLockAndExit={onBack}` (top-level onBack = `setView("chat")`) from `renderContent()`. Both lock buttons now call `wallet.lockWallet(); onLockAndExit?.();` — exits to chat immediately.

## Additional fixes (defence-in-depth)
1. Header ← button: `if (wallet.phase === "locked") { onBack(); return; }` guards the race condition
2. `App.tsx`: `history.pushState({ aw: true }, "")` + popstate listener for iOS swipe-back
3. `UnlockView({ onExit })`: explicit "← Indietro" button for when wallet is opened while already locked

## Rule
Any new "lock wallet" trigger in AlphaWalletPage MUST call the top-level `onBack` (= `setView("chat")`), NOT a subView setter. Never rely on useEffect([wallet.phase]) for post-lock navigation — it only fires for phase changes, not for user intent to exit.

## CSS note
`.aw-unlock` has only padding — NOT position:absolute. `.aw-secure-overlay` IS position:absolute;inset:0;z-index:10 but only renders during seed phrase viewing (CreatePhraseView). `.aw-tx-detail` is position:fixed;inset:0;z-index:10 and covers the header by design (only in TxDetailView, has its own back button).
