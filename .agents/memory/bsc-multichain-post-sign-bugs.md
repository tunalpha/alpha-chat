---
name: BSC MultiChain — Post-sign bugs (History, Notifiche, Auto-open)
description: Tre root cause trovati dopo la conferma del fix BSC signing (walletsBsc). Relativi a TX reale non visibile in History/Notifiche e wallet non aperto automaticamente su iOS.
---

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
