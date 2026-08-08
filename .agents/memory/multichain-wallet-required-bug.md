---
name: MultiChain sender_wallet/recipient_wallet required bug
description: Mongoose schema had sender_wallet/recipient_wallet as required:true, but transfer creation doesn't have these at request time → ValidationError → 500 for ALL non-Polygon networks
---

## The Rule
`sender_wallet` and `recipient_wallet` in `MultiChainTransferSchema` MUST be `{ type: String, default: null }`, NOT `required: true`.

**Why:** These fields represent the connected user wallet (e.g. MetaMask address). At transfer creation time (`/transfers/request`, `/transfers/send`) the sender's wallet is unknown — it's only filled when the user connects a wallet. The escrow wallet is separate and IS known at creation.

**How to apply:** Any future model change that adds wallet fields to MultiChainTransferSchema should default to null, not required. The interface correctly defines them as `string | null`.

## Discovery
- Bug affected Ethereum USDT and BSC USDT requests (Polygon didn't surface because tests hit frontend amount=0 validation first)
- Error: `ValidationError: Validation failed: sender_wallet: Path sender_wallet is required., recipient_wallet: Path recipient_wallet is required.`
- Fix: Changed lines 167-168 in `multichain-transfer.model.ts` from `required: true` to `default: null`
- Confirmed fix with curl: both ETH and BSC return `status: "awaiting_deposit"` ✓
