---
name: Sprint USDA — Native Integration
description: Architettura, decisioni e pattern dell'integrazione USDA nativa in AlphaChat.
---

## Adapter Layer (Clean Architecture)

- Interfaccia: `UsdaAdapter` in `artifacts/api-server/src/usda/usda-adapter.interface.ts`
- MockAdapter: `MockUsdaAdapter` — simula pagamenti in-memory, auto-conferma dopo 3s via setTimeout
- HttpAdapter: `HttpUsdaAdapter` — legge `USDA_API_BASE_URL` + `USDA_API_KEY` da env; ogni endpoint ha commento `// TODO: verify` per allineamento con backend reale
- DI in `usda.service.ts`: se `USDA_API_BASE_URL` è configurato → HttpUsdaAdapter; altrimenti MockUsdaAdapter
- Callback status-change: `setMockStatusChangeCallback` connette il mock al service per broadcastare WS aggiornamenti

**Why:** Il backend USDA esterno non è ancora accessibile. L'adapter isola tutta la logica blockchain, RPC e wallet custodiale dal core di AlphaChat.

## Message Types

- `usda_send` — pagamento inviato/ricevuto
- `usda_request` — richiesta di pagamento (con pulsante [Paga] per il destinatario)
- `usda_receipt` — ricevuta confermata
- `ciphertext: null` — i messaggi USDA non sono cifrati con Signal (system-like)
- `system_metadata` contiene tutto: `payment_id`, `kind`, `amount`, `fee`, `status`, `tx_hash`, `sender_name`, `recipient_name`, ecc.

**Why:** Separazione netta — il core Signal non tocca i dati USDA; il campo `system_metadata` porta il payload completo senza estendere aggressivamente lo schema.

## WS Event

- `usda.payment.update` — payload: `{ payment_id, message_id, conversation_id, status, tx_hash, updated_at }`
- Il frontend aggiorna `system_metadata.status` del messaggio in-place tramite `setMessages()` → nessuna nuova bubble creata

## Model: `usda_payments` collection

- `client_payment_id` (UUID v4, unique) — idempotenza
- `external_payment_id` — ID nel backend USDA esterno
- `message_id` — link al messaggio AlphaChat (nullable, impostato dopo la creazione del messaggio)
- Stato: `preparing → signing → submitting → pending → confirmed | claimed | refunded | failed`

## Frontend

- Bubbles: `UsdaPaymentBubble` (usda_send), `UsdaRequestBubble` (usda_request) in `src/components/usda/`
- Sheets: `SendUsdaSheet`, `RequestUsdaSheet`, `WalletSetupSheet`
- Detail: `UsdaPaymentDetail` (carica via API)
- History: `UsdaHistory` con filtri
- ChatPage: due tile nell'attach sheet (solo chat dirette, non gruppi); WS case `usda.payment.update`; previewText per messaggi USDA nella lista chat

## Remaining Integration (lista finale)

1. Impostare `USDA_API_BASE_URL` in Replit Secrets (es. `https://api.getusda.xyz/v1`)
2. Impostare `USDA_API_KEY` se il backend richiede auth server-to-server
3. Verificare endpoint paths in `HttpUsdaAdapter` (ogni metodo ha `// TODO: verify`)
4. Verificare struttura response (`{ data: ... }` vs oggetto diretto) — attualmente `json.data ?? json`
5. Verificare nomi campi nel response di PaymentResult (es. `payment_id` vs `id`)
6. Rimuovere i commenti `// TODO: verify` dopo la verifica
7. Testare il webhook/callback per status update (attualmente mock usa setTimeout)
8. Configurare `wallet_address` per gli utenti esistenti (campo aggiunto a User schema)
