---
name: Sprint USDA Backend Connection
description: Collegamento HttpUsdaAdapter al backend reale getusda.xyz — env vars, endpoint, polling, balanceOf
---

# USDA Backend Connection

## Configurazione
- `USDA_API_BASE_URL=https://getusda.xyz` → attiva HttpUsdaAdapter automaticamente
- `USDA_CHAIN_ID=137` (Polygon Mainnet)
- `USDA_CONTRACT_ADDRESS=0xe714655fD1B3ba96B887DF1F94336c2A78E24001`
- **Nessuna API key, nessun Bearer token** — il backend USDA non richiede autenticazione

## Endpoint confermati dalla documentazione USDA
- `GET /api/health` — health check (NON /capabilities)
- `GET /api/pay/poll-tx?code={code}` — polling stato tx
- `POST /api/pay/claim/{code}` — riscossione
- **Nessun prefisso /v1** — tutti i path sono `/api/...`

## Endpoint da verificare (VERIFY)
- POST /api/pay/send — invio pagamento
- POST /api/pay/request — richiesta pagamento
- POST /api/pay/pay — pagamento richiesta
- POST /api/pay/refund/{code} — rimborso
- GET /api/pay/history — storico

## Balance ERC-20 (non via HTTP)
- `balanceOf(address)` via eth_call su Polygon RPC pubblico
- File: `artifacts/api-server/src/usda/polygon-rpc.ts`
- Decimali: 6 (USDC-standard, da verificare con contratto)
- RPC: `https://polygon-rpc.com` (configurabile via USDA_POLYGON_RPC)

## Architettura polling (webhook non supportato)
- After submitPayment/payRequest → `_startPolling(externalId, code)`
- Ogni 6s → GET /api/pay/poll-tx → status change → `_onStatusChange` → WS `usda.payment.update`
- Timeout: 5 minuti, poi `failed`

## Health check e graceful degradation
- `GET /api/v1/usda/health` (unauthenticated) → chiama `/api/health` USDA
- Se non disponibile: `UsdaUnavailableError` (503) — chat rimane operativa
- Cache: 60 secondi

**Why:** Il backend USDA non ha /v1 prefix, non ha API key, non ha webhook → tutto diverso da quanto ipotizzato nel MockAdapter. Pattern di integrazione documentato qui per future modifiche.
