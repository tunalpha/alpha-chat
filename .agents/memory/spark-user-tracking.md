---
name: Spark user tracking — admin monitoring
description: Come viene registrato e mostrato nell'admin monitor chi ha abilitato Spark Lightning; architettura della collection spark_user_status.
---

# Spark User Tracking — Admin Monitoring

## Architettura
- Collection: `spark_user_status` (MongoDB), campi: `userId`, `status` (enabled|disabled), `createdAt`, `updatedAt`, `lastSeenAt`
- Indice unico su `userId` (no duplicati)
- La registrazione avviene nel client (`AlphaWalletPage.tsx`) via `useEffect` che osserva `spark.state === "connected"` → chiama `POST /api/v1/spark/user-status` (fire-and-forget)

## File principali
- Modello: `artifacts/api-server/src/models/spark-user-status.model.ts`
- Controller: `artifacts/api-server/src/controllers/spark-user-status.controller.ts`
- Helper client: `artifacts/alpha-chat-web/src/lib/spark/spark-admin-register.ts`
- Routes aggiunte in: `artifacts/api-server/src/routes/v1/spark.routes.ts`

## API
- `POST /api/v1/spark/user-status` — authenticate middleware (utente normale, NON admin)
- `GET /api/v1/spark/monitoring/users` — requireAdmin("read_only")
- `GET /api/v1/spark/monitoring/users/stats` — requireAdmin("read_only")

## Privacy
- Movimenti per-utente: SEMPRE N/D — `alpha_wallet_fee_records` non contiene userId per privacy-by-design
- Nessun campo sensibile (mnemonic, seed, key, PIN) nei modelli o nelle response
- join con UserModel restituisce solo `username`, `display_name`, `_id`

**Why:** La richiesta era di NON modificare i fee records esistenti, quindi la relazione movimenti↔utente non è mai creata. N/D è onesto e corretto.

**How to apply:** Qualsiasi nuova feature che richiede conteggio movimenti per utente NON PUÒ farlo dai fee records — serve una join separata o un campo separato aggiunto al momento del pagamento.
