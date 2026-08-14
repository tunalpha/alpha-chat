---
name: Alpha Wallet Monitor
description: Admin panel monitoring page per Alpha Wallet — architettura, endpoint, modelli usati
---

## Struttura

**Backend controller:** `artifacts/api-server/src/controllers/alpha-wallet-monitor.controller.ts`
**Backend routes:** `artifacts/api-server/src/routes/v1/admin-alpha-wallet-monitor.routes.ts`
**Route registrata in:** `artifacts/api-server/src/routes/v1/index.ts` come `/api/v1/admin/alpha-wallet-monitor`
**Frontend API client:** `artifacts/admin-panel/src/lib/alpha-wallet-monitor-api.ts`
**Frontend page:** `artifacts/admin-panel/src/pages/alpha-wallet-monitor.tsx`
**Route frontend:** `/alpha-wallet-monitor` (wouter, registrata in App.tsx)
**Sidebar entry:** "Alpha Wallet Monitor" con icona BarChart2

## Endpoint (tutti requireAdmin "read_only", GET)

- `/overview` — KPI aggregate: utenti wallet_enabled, self-custodial EVM/BTC, third-party, fee records per status/network, payment requests
- `/users` — lista utenti con filtri: all / enabled / self_custodial / third_party
- `/fee-records` — paginated fee records con filtri: network, status, range (24h/7d/30d), source
- `/payment-requests` — richieste pagamento populate requester/payer
- `/errors` — fee record con failed_permanent o lastError valorizzato (max 100)

## Modelli usati

- `UserModel`: `wallet_enabled`, `alpha_wallet_evm_address`, `alpha_wallet_btc_address`, `wallets.{polygon,ethereum,usda,bitcoin,lightning}.verifiedAt`
- `AlphaWalletFeeRecordModel`: aggregazione per status/network/source
- `AlphaWalletPaymentRequestModel`: populate requester_id/payer_id

## Bug fix stesso sprint

`config.min_fee_btc_sat.toLocaleString()` in `alpha-wallet-fee.tsx` — crash se campo assente nel DB (documento vecchio pre-Phase G #92). Fix: `(config.min_fee_btc_sat ?? 0).toLocaleString()` in 3 punti della pagina.

**Why:** produzione aveva documento alpha_wallet_fee_config creato prima dell'aggiunta del campo; il controller usa `?? DEFAULTS` ma browser cache 304 serviva risposta vecchia senza campo. Difensivo sempre.
