---
name: Sprint 4 — Payment Engine Audit Blockchain + iOS Recovery
description: detect-deposit endpoint, localStorage iOS recovery, blockchain audit fields (block numbers + PolygonScan URLs) nel transfer model e nella bubble.
---

## Endpoint detect-deposit
- `POST /api/v1/payments/:id/detect-deposit` — scansiona ultimi ~1000 blocchi Polygon con `getLogs` (ERC20_TRANSFER_EVENT + `args.to = escrow_wallet`), trova tx, chiama `confirmDeposit` internamente.
- Viem: usare `parseAbiItem` + `event` + `args` (NON raw `topics`) per evitare errori TypeScript.
- In dev mode (`PAYMENT_SKIP_CHAIN_VERIFY=true`) ritorna 404 DEPOSIT_TX_NOT_DETECTED — corretto.

## iOS Safari PWA recovery flow
- Problema: `sendAndConfirmTransaction` apre MetaMask via deep link → iOS ricarica PWA → Promise morta → tx hash perso.
- Fix: `localStorage["ac_pending_payment"] = { transferId, conversationId, timestamp }` salvato PRIMA della firma.
- On mount di `SendPaymentSheet`: se pending < 30 min per stessa conversazione → auto-chiama `apiPaymentDetectDeposit` → mostra "recovering" phase.
- Pulsante "🔄 Controlla deposito" in `ChatPaymentBubble` per sender quando `status === "awaiting_deposit"`.
- localStorage pulito solo su successo (phase "done") — non su errore (la tx potrebbe non essere ancora minata).

## Blockchain audit fields (chat-transfer model)
- Campi aggiunti: `deposit_block_number: number | null`, `release_block_number: number | null`
- `_verifyDepositTx` ora ritorna `number | null` (block number) invece di `void`; null in dev mode.
- `confirmDeposit` salva `deposit_block_number` direttamente dal receipt.
- `acceptTransfer` salva `release_block_number` con fire-and-forget `getTransactionReceipt` DOPO la state transition (la tx è già confermata da `transferFromCustodial`).
- `POLYGONSCAN_TX(hash)` helper → `https://polygonscan.com/tx/${hash}` o null.
- `_format`, `_paymentMeta`, `_updateMessageMeta` sincronizzano tutti i nuovi campi.

## Frontend bubble PolygonScan links
- `ChatPaymentData` interface: +`tx_hash_deposit`, +`deposit_block_number`, +`release_block_number`, +`deposit_polygonscan_url`, +`release_polygonscan_url`
- Bubble calcola URL dinamicamente con fallback: `data.deposit_polygonscan_url ?? (data.tx_hash_deposit ? 'https://polygonscan.com/tx/...' : null)`
- CSS: `.cp-bubble-scan-links`, `.cp-scan-link` — stile sobrio, colore #818cf8/a5b4fc

**Why:** permanenza audit blockchain + fallback per messaggi vecchi (pre-upgrade) che non hanno i nuovi campi nel system_metadata.
