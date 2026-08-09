---
name: Native Sweep Audit Trail (TX3)
description: 6 new audit fields on IMultiChainTransfer for BNB/ETH sweep lifecycle; service changes and test patterns.
---

# Native Sweep Audit Trail — TX3

## Rule
`_reclaimEscrowGas` now populates 6 audit fields at each lifecycle step. Do NOT add MCStatus enum values (`sweeping_native`, `sweep_failed`) — use `native_sweep_status` field instead.

## The 6 new fields (model + schema)
- `native_balance_before_sweep` — escrow balance in wei before sweep, saved BEFORE INSUFFICIENT check
- `native_sweep_amount` — wei sent to gas station (balance − tx3GasCost)
- `native_sweep_gas_cost` — actual gasUsed × gasPrice (falls back to TX3_GAS_UNITS × gasPrice if no receipt.gasUsed)
- `native_sweep_tx_hash` — same as tx_hash_reclaim; redundant field for audit clarity
- `native_sweep_status` — enum: "pending" | "sweeping" | "completed" | "failed" | "skipped" | null
- `native_balance_after_sweep` — on-chain balance read after TX3 confirmed; null if RPC fails (best-effort)

## Status lifecycle
1. After `Promise.all([gasPrice, escrowBalance, nonce])`: save `native_balance_before_sweep + native_sweep_status: "pending"` in **inner try/catch** (not `.catch()` — Mongoose mock returns non-thenable `{}`)
2. If INSUFFICIENT_BALANCE: `native_sweep_status: "skipped"`
3. After `sendTransaction`: `native_sweep_status: "sweeping"` (alongside `tx_hash_reclaim_submitted`)
4. After receipt success: read `balanceAfterSweep` via `getBalance().catch(() => null)`, then `native_sweep_status: "completed"` + all fields
5. Catch block: `native_sweep_status: "failed"`

**Why:** Use `try { await findOneAndUpdate } catch {}` — NOT `await findOneAndUpdate(...).catch(() => {})`. The `.catch()` pattern calls `.catch` on Mongoose Query objects in production fine, but in tests `mockFindOneAndUpdate` returns `{}` (non-thenable), causing TypeError and killing the entire function.

## Post-sweep balance
`publicClient.getBalance` is called **twice**: once in `Promise.all` (initial check) and once after receipt (audit). Tests must account for this with `toHaveBeenCalledTimes(2)` or `mockResolvedValue` (not `Once`).

## Test file
`multichain-bsc-eth-sweep.test.ts` — 14 scenarios (S-01..S-14) covering BSC, ETH, gas spikes, minimum residual, failure/retry, concurrency, post-sweep balance verification.

**Key mock pattern**: Use `mockResolvedValue(BALANCE_2BNB)` (not `mockResolvedValueOnce`) in outer `beforeEach` for `mockGetBalance`. Use `mockReset()` in per-test `beforeEach` when you need specific different values. `Once` chains are consumed across tests and cause flaky results.
