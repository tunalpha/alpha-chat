---
name: Alpha Wallet Phase G — Bubble redesign + Face ID PaySheet
description: Redesign ChatWalletPaymentBubble a cp-bubble style; Face ID in ChatWalletPaySheet; wallet-pin-seal shared module
---

## Bubble redesign (ChatWalletPaymentBubble.tsx)

- Usa classi **cp-bubble** (stesse del MultiChain bubble) anziché `.wallet-pay-bubble`
- Struttura: header (🚀 CRIPTO INVIATA / 📩 CRIPTO RICEVUTA) → mc-network-badge → cp-bubble-amount → cp-bubble-divider → cp-bubble-status → cp-scan-link
- Link text = "Vedi transazione ↗" (NON truncated hash nel testo — hash è nell'href)
- `useLiveTxStatus(txHash, initial)` legge IDB e poll ogni 15s finché non finale
- `status: "confirmed"` → label "Pagamento completato"; non più "Confermata"

**Why:** cp-bubble style è identico al MultiChain bubble — consistenza visiva; max-width: 100% risolve il problema "bolla troppo piccola" senza aggiungere `payment-bubble` class

**How to apply:** per futuri bubble in-chat self-custodial, usare cp-bubble + cp-variant-{success,fail,waiting}; mai `.wallet-pay-bubble` custom

## wallet-pin-seal shared module (src/wallet/security/wallet-pin-seal.ts)

- Exports: `sealWalletPin`, `unsealWalletPin`, `clearSealedWalletPin`, `hasSealedPin`, `useWalletFaceId`
- `AlphaWalletPage.tsx` importa da questo modulo (rimossi i duplicati inline ~60 righe)
- `ChatWalletPaySheet.tsx` importa `useWalletFaceId` + `unsealWalletPin` per biometria

**Why:** duplicazione inline impediva riuso in PaySheet; estratto per evitare inconsistenze

## Face ID in ChatWalletPaySheet

- `onAuthRequired` prova biometria silenziosamente PRIMA di mostrare PIN step
  - Se `lock.tryUnlockWithBiometric()` + `unsealWalletPin()` ok → risolve senza step change
  - Fallback: mostra step "auth" con PIN input
- Auth step mostra bottone "🪪 Usa Face ID" se `walletBioActive = walletFaceIdEnabled && hasBiometricSet`
- Footer auth step ha "🪪 Face ID" button tra "Annulla" e "Firma e invia"
- `handleBioAuth` — retry esplicito dal bottone, imposta `authErr` se fallisce

## Test pattern

- Wizard test (`chat-wallet-pay-sheet-wizard.test.tsx`) deve mockare:
  - `../../../contexts/LockContext` → `useLock: () => ({ hasBiometricSet: false, ... })`
  - `../../../wallet/security/wallet-pin-seal` → `useWalletFaceId: () => ({ walletFaceIdEnabled: false })`
- Bubble test: controllare `href` su `a.cp-scan-link` per txHash (non più testo visibile)
