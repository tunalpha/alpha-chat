---
name: BSC incoming notification missing
description: Safety net dispatcha la notification in IDB ma non chiama refreshNotifications() → badge resta 0 finché non gira tx-monitor
---

## Regola

Quando il safety net di `ChatWalletPaymentBubble` scatta (status="confirmed" via receipt API, prima del tx-monitor), la notification viene salvata in IDB ma `wallet.unreadCount` React state rimane 0 finché `_refreshNotifications()` non viene chiamata.

`onConfirmed?.()` → solo `refreshTxHistory()`; `refreshNotifications()` NON era inclusa → badge stale.

## Fix applicato

In `ChatPage.tsx`:
```typescript
const { refreshTxHistory, refreshNotifications } = useWallet();
// ...
onConfirmed={() => { void refreshTxHistory(); void refreshNotifications(); }}
```

Due siti (le due istanze di `ChatWalletPaymentBubble` nella pagina).

**Why:** Il safety net path e il tx-monitor path sono INDIPENDENTI. Il tx-monitor chiama `_onNewTx()` → `_refreshNotifications()`. Il safety net chiama solo `onConfirmed` → `refreshTxHistory()`. Se il safety net scatta prima del tx-monitor, il badge resta 0 fino al prossimo poll (~30s). L'utente vede badge=0 e conclude "notification mancante".

**How to apply:** Ogni volta che si aggiunge `onConfirmed` a un bubble che dispatcha notifiche, includere `refreshNotifications()` nella callback.

## Catena causale completa

1. Safety net fires (T=5s via Level 2 receipt) → `dispatchWalletNotification` → saved in IDB ✅
2. `onConfirmed?.()` → `refreshTxHistory()` only → `unreadCount` React = 0
3. tx-monitor runs (T=30s) → `_processEvmTx` → dispatch BLOCKED by level-2 dedup (safety net già in IDB)
4. `hasNew=true` (transfers found) → `_onNewTx()` → `_refreshNotifications()` → badge = 1 ✅ (ma tardivo)

Il fix rende il badge immediato (step 2 include ora `refreshNotifications()`).
