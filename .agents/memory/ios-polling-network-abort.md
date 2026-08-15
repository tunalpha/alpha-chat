---
name: iOS polling network abort bug
description: Safari iOS aborta le richieste HTTP quando la PWA va in background → "Load failed" nel catch del polling → phase("error") invece di continuare
---

## Regola

Nel catch del polling loop in `signAndPoll` (SendPaymentSheet.tsx), errori di rete temporanei (Load failed, Failed to fetch, NetworkError, AbortError) devono essere trattati come `DEPOSIT_TX_NOT_DETECTED` — il polling continua, non si lancia errore fatale.

**Why:** iOS Safari abortisce le richieste HTTP in volo quando la PWA va in background (es. durante il signing WalletConnect). L'errore non è "DEPOSIT_TX_NOT_DETECTED" quindi il vecchio codice faceva `throw pollErr` → `handleSend` → `phase("error")` con "Load failed", anche se la TX era già on-chain.

Root cause identificata dai log produzione: transfer `0f1df96d`, pre-check 08:30:59 → 404 ok, firma avviata 08:31:35, "Load failed" arriva 08:32:13 (app era in WalletConnect background). Zero chiamate detect-deposit nel mezzo = iOS sospendeva il polling.

**How to apply:** Il fix è nella regex al fondo del `catch (pollErr)` in `signAndPoll`. Il pattern è:
```typescript
/load.?failed|failed.?to.?fetch|network.?error|the.?request.?was.?aborted|abortederror/i
```
Se corrisponde → `continue` (same logic as DEPOSIT_TX_NOT_DETECTED). NON toccare questo regex senza testare su dispositivo reale iOS 4G.
