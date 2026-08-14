---
name: BSC MultiChain — Post-sign bugs (History, Notifiche, Auto-open)
description: Tre root cause trovati dopo la conferma del fix BSC signing (walletsBsc). Relativi a TX reale non visibile in History/Notifiche e wallet non aperto automaticamente su iOS.
---

## Fix applicato (2026-08-14) — confermato e testato

**FIX 1 — ChatPage.tsx** (`mc_payment.state_changed` handler):
```typescript
const txHash = isSender
  ? (tx_hash_deposit ?? tx_hash_release)  // fallback: release hash per indicizzazione
  : tx_hash_release;
```

**FIX 2 — mc-history-backfill.ts** (backfill storico):
```typescript
const effectiveOutHash = txHashDeposit ?? txHashRelease;
if (isSender && effectiveOutHash) { /* salva con effectiveOutHash */ }
// skip counter: usa !effectiveOutHash, non !txHashDeposit
if ((isSender && !effectiveOutHash) || (!isSender && !txHashRelease)) { skipped++; }
```

**Semantica**: `tx_hash_deposit` ha priorità; `tx_hash_release` è fallback di SOLA INDICIZZAZIONE per sender BSC — non rappresenta la TX Trust Wallet originale. Commentato esplicitamente nel codice.

**Test**: 8 casi aggiunti in `23-mc-history-backfill.test.ts` e `notifications.test.ts`. 1074/1074 PASS. Build OK.

**TX reali da verificare in produzione**:
- `0xfadf4a2bc384bfab539f4ff8f84862262306b41461ea2b003414d933cfe612e1` (22:31)
- `0x4fe9123a468fce650c0139fb77edac8639d9b43a35cc3732604233b0e7564d1f` (22:55)

## History — TX non appare (root cause)

`ChatPage.tsx` — handler WS `mc_payment.state_changed`:
- `if (conversation_id !== activeConvId) break;` era PRIMA del blocco `saveTxRecord`.
- Se l'utente lasciava la conversazione prima che il backend emettesse "released", la `break` usciva dall'intero case — `saveTxRecord` mai chiamato.
- **Fix**: spostare `saveTxRecord` PRIMA del guard. Il guard protegge solo `setMessages` (bubble update), non la scrittura IDB.

## Notifiche — TX non appare (root cause)

`ChatPage.tsx` — handler WS `mc_payment.state_changed`:
- `dispatchWalletNotification` non era mai chiamata per MC payments.
- Funzionava solo per tx-monitor (Alpha Wallet interno). MultiChain gap strutturale.
- **Fix**: chiamare `dispatchWalletNotification` subito dopo `saveTxRecord` nel blocco released. Import aggiunto da `wallet/notifications/wallet-notification-store`.

## Auto-open wallet iOS — Trust Wallet non si apre (root cause)

`MultiChainSendSheet.tsx` — `handleSign()`:
- iOS WebKit blocca `window.location.href = "trust://"` (custom scheme) se chiamato fuori da user gesture context sincrono.
- Dopo `await switchChain(bsc)` (I/O WebSocket WC + interazione utente) e `await apiMCDetect()`, il contesto gesture è perso.
- ThirdWeb chiama `openWindow("trust://")` → bloccato da iOS.
- Il relay WC consegna la richiesta via WebSocket (non bloccato), ma Trust Wallet rimane in background.
- **Fix**: aggiungere `window.location.href = NATIVE_SCHEME[wallet.id]` PRIMA di qualsiasi `await` in `handleSign()`. Fired nel tick sincrono del click → iOS lo permette. Trust Wallet arriva in foreground; la richiesta WC arriverà via relay pochi istanti dopo.
- `NATIVE_SCHEME` map: trust:// / metamask:// / cbwallet:// / rainbow:// / zerion://
- Solo per `/iphone|ipad|ipod/i.test(navigator.userAgent)`.

**Why:** Su iOS dopo qualsiasi network I/O in await chain, window.location.href per custom scheme viene bloccato silenziosamente. Questo non riguarda https:// o http:// (gestiti diversamente da openWindow.js).
