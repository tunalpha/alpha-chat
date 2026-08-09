---
name: MC detect status-check bug
description: detectMultiChainDeposit returns HTTP 200 whether deposit is found or not — frontend MUST check t.status, not just success/failure of the call.
---

# MC detect — HTTP 200 in both cases

## The rule
`detectMultiChainDeposit` (backend) returns HTTP 200 in **both** cases:
- `balance < required` → status `"awaiting_deposit"` (not found) — HTTP 200
- `balance >= required` → status `"pending"` (found) — HTTP 200

**Never treat a 200 from `/detect` as "deposit confirmed".** Always check `t.status !== "awaiting_deposit"`.

## Why
The backend design returns the transfer object unconditionally. When not found, it returns the unchanged doc with `status: "awaiting_deposit"`. Only when found does it update to `"pending"`.

Any code that uses `await apiMCDetect(id)` as a boolean (success = found, throw = not found) will fire `setSignPhase("done")` immediately on the first poll — the escrow can be empty and it still returns 200.

## How to apply
In ALL three polling sites in `MultiChainSendSheet.tsx`:
```typescript
const t = await apiMCDetect(transferId);
if (t.status === "awaiting_deposit") continue; // not yet — keep polling
setSignPhase("done"); // only here: real deposit confirmed
```

The pre-sign check (EVM `handleSign`) must use `preCheck.status !== "awaiting_deposit"` before calling `setSignPhase("done")`.

## Fixed in
- `pollDetect()` — BTC + EVM recovery
- `handleSign()` pre-sign check — EVM
- `handleSign()` polling loop — EVM

## Tech debt remaining
Backend should throw `AppError("DEPOSIT_TX_NOT_DETECTED", 402)` when `balance < required` so callers can use try/catch reliably (Task #63).
