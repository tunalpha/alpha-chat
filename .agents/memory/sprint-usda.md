---
name: Sprint USDA — Native Integration
description: Architettura, decisioni e pattern dell'integrazione USDA nativa in AlphaChat. Include wallet multi-chain, WalletCenter e Capability Test.
---

## Adapter Layer (Clean Architecture)

- Interfaccia: `UsdaAdapter` in `artifacts/api-server/src/usda/usda-adapter.interface.ts`
- MockAdapter: `MockUsdaAdapter` — simula pagamenti in-memory, auto-conferma dopo 3s via setTimeout
- HttpAdapter: `HttpUsdaAdapter` — legge `USDA_API_BASE_URL` + `USDA_API_KEY` da env; ogni endpoint ha commento `// TODO: verify` per allineamento con backend reale
- DI in `usda.service.ts`: se `USDA_API_BASE_URL` è configurato → HttpUsdaAdapter; altrimenti MockUsdaAdapter
- Callback status-change: `setMockStatusChangeCallback` connette il mock al service per broadcastare WS aggiornamenti

**Why:** Il backend USDA esterno non è ancora accessibile. L'adapter isola tutta la logica blockchain, RPC e wallet custodiale dal core di AlphaChat.

## Wallet Multi-Chain Identity

- User model: `wallets: { usda?, polygon?, ethereum?, bitcoin?, lightning? }` — ogni chain ha `{ address, verifiedAt }`
- Campo legacy `wallet_address` mantenuto per compatibilità (mirrors `wallets.usda.address`)
- Frontend: `WalletChain` type + `WALLET_CHAIN_LABELS` map (icon, label, placeholder)
- `setWalletAddress(userId, address, chain?)` accetta un `chain` opzionale (default "usda")
- WalletSetupSheet: ha un grid di 5 chain-button + input address chain-specifico

**Why:** Aggiungere BTC/ETH/USDC/USDT in futuro non richiede nessuna modifica DB — la struttura è già pronta.

## Capability Test

- Metodo `checkCapabilities(): Promise<UsdaCapabilities>` sull'interfaccia UsdaAdapter
- HttpAdapter: `GET /capabilities` con cache 5 min; fallback conservativo se endpoint non risponde
- MockAdapter restituisce `{ version: "mock-1.0", supports: { prepare, claim, refund, multi_chain: true, webhook: false, polling: true } }`
- Route: `GET /api/v1/usda/capabilities` (autenticata)
- Frontend: `apiUsdaGetCapabilities()` — WalletCenterPage mostra la matrice capabilities

**Why:** Quando il backend USDA sarà reale, AlphaChat si adatta automaticamente alle sue capacità senza deploy di codice.

## Message Types

- `usda_send` — pagamento inviato/ricevuto
- `usda_request` — richiesta di pagamento (con pulsante [Paga] per il destinatario)
- `usda_receipt` — ricevuta confermata
- `ciphertext: null` — i messaggi USDA non sono cifrati con Signal (system-like)
- `system_metadata` contiene tutto: `payment_id`, `kind`, `amount`, `fee`, `status`, `tx_hash`, ecc.

## WS Event

- `usda.payment.update` — payload: `{ payment_id, message_id, conversation_id, status, tx_hash, updated_at }`
- Il frontend aggiorna `system_metadata.status` del messaggio in-place tramite `setMessages()` — nessuna nuova bubble

## WalletCenter

- Pagina dedicata: `WalletCenterPage.tsx` accessibile da Settings > "💰 Pagamenti"
- Tab 1 — Saldo: balance card + stats grid + lista wallet per chain + matrice capabilities
- Tab 2 — Storico: filtri (Tutti/Inviati/Ricevuti/Pending/Riscossi/Rimborsati) + lista con tap → detail
- Tab 3 — Impostazioni: modifica/aggiunta indirizzi per ogni chain + backend info
- Route App.tsx: `"wallet-center"` → `<WalletCenterPage onBack={goBack} />`

## Model: `usda_payments` collection

- `client_payment_id` (UUID v4, unique) — idempotenza
- `external_payment_id` — ID nel backend USDA esterno
- `message_id` — link al messaggio AlphaChat (nullable, impostato dopo la creazione del messaggio)
- Stato: `preparing → signing → submitting → pending → confirmed | claimed | refunded | failed`

## Remaining Integration (quando USDA backend è disponibile)

1. Impostare `USDA_API_BASE_URL` in Replit Secrets → `HttpUsdaAdapter` attiva automaticamente
2. Impostare `USDA_API_KEY` se il backend richiede auth server-to-server
3. Verificare endpoint paths in `HttpUsdaAdapter` (ogni metodo ha `// TODO: verify`)
4. Verificare struttura response (`{ data: ... }` vs oggetto diretto)
5. Rimuovere i commenti `// TODO: verify` dopo verifica
6. Testare il webhook/callback per status update (attualmente mock usa setTimeout)
7. Configurare URL callback USDA → `/api/v1/usda/webhook` (da implementare)
8. Verificare se `GET /capabilities` è effettivamente esposto o cambia path
