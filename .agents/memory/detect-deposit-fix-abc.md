---
name: detectDeposit Fix A+B+C — CONGELATO
description: Tre sub-bug in detectDeposit che causavano DEPOSIT_TX_NOT_DETECTED loop. Pattern obbligatorio — non modificare MAI questi filtri.
---

# detectDeposit — Fix A+B+C (CONGELATO ✅)

## Regola
I filtri in `detectDeposit()` su `rawContract.value` e `metadata.blockTimestamp` devono essere opzionali (best-effort). Alchemy non popola sempre questi campi per certe ERC-20. I filtri upstream (`toAddress + contractAddresses + category:erc20`) sono già sufficienti.

**NON aggiungere mai di nuovo filtri obbligatori su `rawContract.value` o `metadata.blockTimestamp`.**

## Fix A
`rawContract.value` opzionale:
```typescript
if (t.rawContract?.value != null && BigInt(t.rawContract.value) < minAmount) return false;
```
*Se assente → salta il check importo.*

## Fix B
`detectDeposit` idempotente su status post-deposit:
```typescript
const DEPOSIT_RECEIVED = ["pending","accepting","accepted","rejecting","rejected","cancelling","cancelled"];
if (DEPOSIT_RECEIVED.includes(transfer.status)) return _format(transfer);
throw new AppError("TRANSFER_INVALID_TRANSITION", 409); // solo "failed"
```
*Se il transfer è già oltre `awaiting_deposit` → successo immediato, nessuna chiamata Alchemy.*

## Fix C
`metadata.blockTimestamp` opzionale:
```typescript
if (t.metadata?.blockTimestamp) {
  const ts = Date.parse(t.metadata.blockTimestamp);
  if (Number.isNaN(ts) || ts < minTs) return false;
}
```
*Se assente → salta il check timestamp.*

## Perché
- **Fix A**: Alchemy omette `rawContract.value` quando non riesce a decodificare l'ABI → TX esclusa → loop 404.
- **Fix B**: race condition tra signAndPoll client e scheduler → transfer avanzava di stato prima che il client chiamasse detect → 409 → loop.
- **Fix C**: Alchemy può omettere `blockTimestamp` per le stesse ragioni di Fix A → `ts = NaN → return false` → loop 404.

Tutti e tre confermati su device reale. Fix C è stato il tassello mancante che causa il loop "Conferma blockchain..." su iOS Safari PWA.

## How to apply
Qualsiasi modifica a `detectDeposit()` in `chat-payment.service.ts` deve preservare questi tre pattern. Non aggiungere `if (!ts) return false` o `if (!rawContract?.value) return false`.

**Why:** These three bugs caused real double/triple on-chain charges because users closed and reopened the sheet due to the infinite loop, creating new transfers each time.
