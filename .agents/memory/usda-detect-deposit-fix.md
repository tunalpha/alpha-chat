---
name: USDA detectDeposit — sheet bloccata su "Conferma blockchain..."
description: Perché signAndPoll() restava bloccato anche con TX confermata in History
---

## Problema osservato

TX USDA firmata una sola volta, confermata on-chain, visibile in History ("Inviata")
ma SendPaymentSheet restava su "Conferma blockchain..." indefinitamente.

## Root cause: due source of truth con filtri diversi

| | History / tx-monitor | detectDeposit (sheet polling) |
|---|---|---|
| Scan direction | `fromAddress: user_wallet` | `toAddress: escrow_wallet` |
| RPC | `ALCHEMY_URLS[137]` (ALCHEMY_API_KEY) | `USDA_POLYGON_RPC` |
| Filtro importo | **nessuno** | `rawContract.value >= amount_units` |
| Filtro timestamp | **nessuno** | `blockTimestamp >= createdAt - 5min` |

La History trova la TX perché scannerizza **uscite dal wallet utente** senza filtri.
`detectDeposit` scannerizza **entrate all'escrow** con un filtro su `rawContract.value`
che Alchemy può non popolare → `rawContract.value == null` → TX esclusa.

## Fix A — rawContract.value opzionale (chat-payment.service.ts)

Prima:
```typescript
if (t.rawContract?.value == null || BigInt(t.rawContract.value) < minAmount) return false;
```

Dopo:
```typescript
if (t.rawContract?.value != null && BigInt(t.rawContract.value) < minAmount) return false;
```

`toAddress + contractAddresses + category: erc20` sono già filtri sufficienti.
Il check importo diventa best-effort quando il valore è disponibile.

## Fix B — idempotenza su status post-deposit (chat-payment.service.ts)

Se un altro path (scheduler, bolla) ha già processato il deposito
(status = pending/accepting/accepted/rejecting/rejected/cancelling/cancelled),
`detectDeposit` ora restituisce il transfer corrente (200) invece di 409 TRANSFER_INVALID_TRANSITION.
`failed` resta 409 (deposito mai avvenuto o release fallita permanentemente).

**Why:** signAndPoll() ha solo un success path → detectDeposit 200. Se il transfer
è già uscito da awaiting_deposit per un altro path, ogni poll successivo era 409 →
throw → setPhase("error"). Ora restituisce il transfer → setPhase("done").

## Bug pre-esistente nel test corretto

`acceptTransfer > WALLET_NOT_CONFIGURED`: il global `UserModel.findById` mock
restituiva sempre RECIPIENT_WALLET, bypassando il guard ADR-004.
Fix: aggiungere `mockImplementationOnce` che restituisce utente senza wallet.

## Invarianti garantite

- `checkAndMarkTx` (anti-replay) NON chiamato nel path idempotente Fix B
- `apiPaymentCreate` non toccato (createdTransferRef invariato)
- signing, WalletConnect, retry, tx-monitor, History, dedup non modificati
