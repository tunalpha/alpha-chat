---
name: Alpha Wallet Phase B
description: UI + services layer for the native self-custodial wallet — completed sprint.
---

## Stato
Phase B completata. 238/238 test green. App running.

## Fix critici scoperti
- `request` in `api.ts` è private e ha firma diversa da quella usata in `alpha-wallet-api.ts`: non si può importare. Fix: `walletRequest()` inline con `localStorage.getItem("ac_access_token")` e BASE `/api/v1`.
- `requestNotificationPermission` non è in `wallet-auth.ts` ma in `wallet-notification-store.ts`.
- `require()` non usabile in ESM/JSX: `getVerifiedTokens` va importato top-level.
- Il sync useEffect `wallet.phase → subView` sovrascriveva le subView del flusso onboarding (create/import). Fix: `subViewRef` + skip se `ONBOARDING_VIEWS.includes(subViewRef.current)`.
- `ConfirmPinView` per create-flow NON deve chiamare `importWallet` — solo validare PIN e passare a `BackupConfirmView`. `importWallet(mnemonic, pin)` va chiamato da `BackupConfirmView` dopo conferma checkbox.

## Architettura flusso create wallet
1. CreatePhraseView → genera mnemonic, salva in `pendingMnemonic` state
2. VerifyPhraseView → verifica 3 parole random
3. SetupPinView → PIN, salva in `pendingPin` state
4. ConfirmPinView (create) → valida PIN match SOLO, chiama onNext()
5. BackupConfirmView → checkbox + chiama `wallet.importWallet(mnemonic, pin)` → backupVerified=true, phase=unlocked
6. overview

## Architettura flusso import wallet
1. ImportPhraseView → valida mnemonic BIP-39
2. SetupPinView → PIN
3. ConfirmPinView (import) → chiama `wallet.importWallet(mnemonic, pin)` → phase=unlocked, onNext()
4. overview

## File creati Phase B
- `src/wallet/notifications/wallet-notification-types.ts`
- `src/wallet/notifications/wallet-notification-store.ts`
- `src/wallet/monitoring/tx-monitor.ts`
- `src/wallet/context/WalletContext.tsx`
- `src/lib/alpha-wallet-api.ts`
- `src/pages/AlphaWalletPage.tsx`
- `src/pages/AlphaWalletPage.css`
- `src/tests/wallet/notifications.test.ts`
- `src/tests/wallet/wallet-flows.test.ts`
- `src/tests/wallet/custom-token-import.test.ts`
- `artifacts/api-server/src/controllers/alpha-wallet.controller.ts`
- `artifacts/api-server/src/wallet/token-registry-server.ts`
- `artifacts/api-server/src/routes/v1/alpha-wallet.routes.ts`

## File modificati
- `wallet/index.ts` — export notifiche, monitoring, context
- `App.tsx` — AppView += "alpha-wallet", case alpha-wallet
- `ChatPage.tsx` — navItems += 🔐 Alpha Wallet
- `routes/v1/index.ts` — mount /alpha-wallet routes

## Limitazioni PWA documentate
- Background push notifications violano principio self-custodial (il server dovrebbe conoscere i wallet address) → NOT implemented in Phase B
- Il TxMonitor è in-app polling ogni 30s, funziona solo mentre l'app è aperta

**Why:** queste limitazioni sono documenti e architetturali, non bug da fixare.
