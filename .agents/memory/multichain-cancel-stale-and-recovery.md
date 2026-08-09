---
name: MultiChain cancel-stale and on-chain recovery
description: Cancel-stale must never touch "pending" transfers (confirmed deposit). Recovery sweep pattern for stranded escrow funds when sender/recipient wallet is null.
---

# Rules for cancel-stale and recovery

## The rule
`cancel-stale` MUST only cancel `"awaiting_deposit"` transfers — NEVER `"pending"`.

- `"awaiting_deposit"` = no on-chain deposit confirmed → safe to cancel (0 balance)
- `"pending"` = backend already confirmed `balance >= required` on-chain → ALWAYS has real funds

Cancelling `"pending"` in DB while leaving blockchain untouched = funds stranded with no recovery path.

## Sender/recipient wallet requirement
EVM transfers (polygon, bsc, ethereum) MUST have both `senderWallet` and `recipientWallet` at creation time:
- `recipientWallet`: needed for TX1 (release to recipient)
- `senderWallet`: needed for refund to sender

If either is `null`: reject at `handleCreateTransfer` with `SENDER_WALLET_REQUIRED` / `RECIPIENT_WALLET_REQUIRED` (HTTP 400).
Bitcoin transfers are exempt (sender sends directly on-chain without app-managed wallet).

## Recovery pattern for stranded EVM escrow funds
When sender/recipient wallet is null and funds are on-chain, sweep to fee_wallet:
1. Gas station sends BNB to escrow (gas top-up, ~0.000008 BNB at 0.05 Gwei, 80k gas limit)
2. Escrow signs ERC-20 `transfer(fee_wallet, balance)` using decrypted `escrow_encrypted_pk`
3. Wait for receipt
4. Update DB: `status: "refunded"`, `tx_hash_refund: <hash>`, `completed_at: now`
5. Verify post-sweep balance = 0

Decryption: AES-256-GCM, `ESCROW_MASTER_KEY` env var (64-char hex), format: `iv[12] || authTag[16] || ciphertext[32]` base64.

**Why:** fee_wallet is the only recoverable destination when both wallets are null. Never invent addresses or reuse wallets from other transfers.

## Message document persistence
`_syncTransferMessageMeta(doc)` (fire-and-forget) must be called after every status-changing DB write. Without it, reloading the chat fetches the original `system_metadata.status = "awaiting_deposit"` from MongoDB even after WS updates show "pending"/"released".

Call sites: after every `emitMCPaymentStateChanged(doc)` in detect + release.
