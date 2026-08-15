---
name: Direct Transfer Flow (USDA Chat Payment)
description: Architettura e decisioni del direct transfer (sender → recipient in 1 TX) per il Chat Payment Engine USDA.
---

# Direct Transfer — Decisioni architetturali

## Regola principale
Quando il destinatario ha un wallet EVM configurato (`alpha_wallet_evm_address` > `wallets.usda.address`), la TX va direttamente dal mittente al destinatario in **1 TX on-chain** (transfer_mode="direct"). Nessun escrow wallet generato, nessuna TX di release.

## State machine
- Escrow: `awaiting_deposit → pending → accepted`
- Direct:  `awaiting_deposit → accepted` (salta "pending")

Scheduler (`processExpiredTransfers`, `processPendingSendTransfers`) ha filtro `transfer_mode: { $ne: "direct" }` per escluderli.

## createTransfer routing
Priorità wallet destinatario: `alpha_wallet_evm_address` > `wallets.usda.address` > `wallet_address`.
- Con wallet → `transfer_mode:"direct"`, `escrow_wallet:null`, `escrow_encrypted_pk:null`
- Senza wallet → `transfer_mode:"escrow"`, escrow generato normalmente

## detectDeposit branching
- `scanToAddress = isDirect ? recipient_wallet : escrow_wallet`
- TX trovata + mode=direct → `_confirmDirect()`
- TX trovata + mode=escrow → `confirmDeposit()` (invariato)

Guard `PAYMENT_SKIP_CHAIN_VERIFY=true` rimossa da `detectDeposit()`: non lancia più early. Ora skippa solo la chiamata `eth_blockNumber` (fromBlock=0n in dev) e salta `_verifyDepositTx` (torna null).

**Why:** La guard early impediva il test con mock Alchemy. Splittar il comportamento per funzione è più granulare e testabile.

## _confirmDirect
```
checkAndMarkTx → _verifyDepositTx → findOneAndUpdate(awaiting_deposit→accepted) → emitPaymentStateChanged
```
- NON chiama `transferFromCustodial` né `ensureEscrowGas`
- `rollbackTx` chiamato nel catch di `_verifyDepositTx` (non se `checkAndMarkTx` fallisce)
- `findOneAndUpdate` restituisce null → `TRANSFER_INVALID_TRANSITION 409`
- recipient_wallet null → `WALLET_NOT_CONFIGURED 412`

## _verifyDepositTx param rename
Il parametro `escrowWallet` → `toAddress`: serve sia per direct che per escrow.

## Bubble frontend
Recipient vede `depositUrl` (link TX deposito) anche per direct (non c'è `releaseUrl`).

## Frontend signAndPoll
- `signAndPoll` / `createdTransferRef` / `resumeRef` usano `toAddress` (non `escrowWallet`)
- `handleSend` branchia su `created.transfer_mode`
- `payment.state_changed` WS handler: salva IDB + notifica per `direct+accepted` fuori dalla guard `activeConvId`

## Escrow function guards
`acceptTransfer`, `rejectTransfer`, `cancelTransfer`, `autoReleaseForSend`, `autoReleaseForRequest` lanciano `TRANSFER_ESCROW_NOT_AVAILABLE` se `escrow_wallet` è null.

## Testing pattern
- `vi.mock("../usda-custodial.service")` mette a mock ANCHE `getRpcUrl` → assegnare `(custodial as any).getRpcUrl = vi.fn().mockReturnValue("https://mock-polygon-rpc")` in beforeEach.
- Con SKIP=true: `eth_blockNumber` saltato (fromBlock=0n), `_verifyDepositTx` torna null. Solo Alchemy scan via `global.fetch`.
- Mock fetch deve gestire: `eth_blockNumber` (result: "0x1400000"), `alchemy_getAssetTransfers`, `eth_getTransactionReceipt`.

**Why:** `createPublicClient` usa il mock di `getRpcUrl` (undefined senza override) → fallback drpc.org → timeout in test.
