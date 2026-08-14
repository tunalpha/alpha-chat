---
name: Double-charge incident 2026-08-14
description: Sirtre double-charged 1733 USDA — forensic findings, root causes, and recovery actions
---

## Incident summary
Sirtre (`0x4F5d90d666ED674Baa2996E98a0C3C2eC4A2aC50`) sent 1733 USDA to Alpha
(`0x2b393F9CDA795056A5dCC3C63bd2BDB379965805`) at 10:26 UTC. Got a detect/timeout
error, retried at 10:27. Both blockchain TXs confirmed → double charge.

## Root causes (3 bugs)

### Bug #1 — Generic error message (FIXED in i18n)
When /detect timed out, frontend showed "load error" instead of
"Your deposit is on-chain — DO NOT retry." Fixed in `it.json` `depositTimeout` key.

### Bug #2 — No scheduler for non-request pending sends (FIXED)
`processPendingSendTransfers()` added to `payment-scheduler.service.ts`.
`autoReleaseForSend()` added to `chat-payment.service.ts`.
Runs every 5 min, recovers pending sends with confirmed deposits.

### Bug #3 — Gas Station depleted after one top-up
After releasing Transfer 1, gas station had insufficient MATIC for Transfer 3.
Transfer 3 will auto-retry every 5 min once gas station is refunded.

## Transfer outcomes (as of 11:46 UTC 2026-08-14)
| ID | Direction | Status | Notes |
|---|---|---|---|
| d8781bff | Sirtre→Alpha | accepted ✅ | Alpha received 1733 via release TX |
| 18a04c19 | Sirtre→Alpha | accepted ✅ | RELEASED at 11:46 via scheduler fix; TX 0x673021b8... |
| 586ca479 | Alpha→Sirtre | pending ⏳ | Gas station depleted; will auto-retry every 5min |

## Net financial outcome (once Transfer 3 releases)
- Sirtre: paid 1733×2=3466 USDA, gets back 1733 (Transfer 3) → net -1733 ✅ correct
- Alpha: received 1733×2=3466, sent back 1733 (Transfer 3) → net +1733 ✅ correct

## Remaining action
Gas station wallet needs MATIC top-up to process Transfer 3 release.
Once funded, the 5-min scheduler will auto-complete it.
