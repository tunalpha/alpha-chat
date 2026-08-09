---
name: MultiChain UI bugs — crash, fee display, BTC alignment
description: Tre bug risolti nel flow BTC/MultiChain: black screen, Totale pagato, BTC alignment
---

## Bug 0 — Polygon network fee default sbagliato (500_000 = 0.50 USDT invece di centesimi)

**Causa**: Phase 1 ha introdotto `POLYGON_FLAT_NETWORK_FEE_USDT` con default `"500000"` (0.50 USDT, 6 dec). Il segreto non era impostato, quindi il default errato era attivo. Polygon gas costa ~$0.001 per TX — 0.50 USDT è 500× troppo.

**Fix**: default cambiato a `"10000"` = 0.01 USDT (10× il costo reale → margine ragionevole). Override via env `POLYGON_FLAT_NETWORK_FEE_USDT`. Server riavviato.

**Why**: BSC e ETH hanno costi elevati e default alti giustificati. Polygon è ultra-economica. Mai usare lo stesso ordine di grandezza per tutte le EVM chain.

**How to apply**: configurare sempre fee per network nell'ordine di grandezza reale: Polygon ~0.01 USDT, BSC ~0.50-1 USDT, ETH ~5-15 USDT.

---

## Bug 1 — Black screen crash in Richiedi BTC (definitivamente risolto)

**Causa radice**: `fmtDisplay()` in `multichain-api.ts` chiamava `BigInt(units)` direttamente senza try/catch. Se il backend restituiva una stringa con punto decimale (es. "0.00018332") invece di un intero satoshi puro ("18332"), il SyntaxError propagava fino a ChatPage (nessun error boundary) abbattendo l'intera app → schermo nero.

**Fix**:
1. `fmtDisplay()` wrapped in try/catch con fallback che restituisce `units` raw.
2. `ErrorBoundary` React class component aggiunto in `src/components/ErrorBoundary.tsx`.
3. ChatPage: `<MultiChainPaymentBubble>` ora wrapped con `<ErrorBoundary fallback="⚠ Pagamento non visualizzabile">`.
4. ChatPage: `showBTCPay` e `showBTCRequest` modali wrapped con `<ErrorBoundary fallback={null}>`.
5. `totalFeeUnits()` in entrambe le sheet ora ha try/catch con fallback 0n.

**Why**: crash in render component senza error boundary abbatte tutto ChatPage. Regola: ogni componente "payment" va protetto da ErrorBoundary.

**How to apply**: qualsiasi nuovo componente "mc_payment" o "chat_payment" in ChatPage deve essere wrapped con `<ErrorBoundary>`.

## Bug 2 — BTC alignment (toName pagherà)

**Problema**: nel confirm di `MultiChainRequestSheet`, con `recipient_exact`, l'utente vedeva solo "Tu ricevi" e "Fee" ma non quanto avrebbe pagato il payer (inclusa network fee). Per BTC, la fee miner non è inclusa nel `networkFeeCharged` (sempre "0") ma nel `minDepositAmount` generato all'atto della creazione.

**Fix**:
- Aggiunta riga `"{toName} pagherà: gross + networkFee"` in recipient_exact confirm.
- Per BTC: riga aggiuntiva `(+ fee miner BTC)` note in italic.
- In send_amount confirm: "toName deposita" mostra il totale lordo.
- CSS: aggiunta `.mc-confirm-total` (font-weight 700, border-top) in `multichain.css`.

**New helper**: `totalPaidUnits(q: MCQuote)` = `grossAmount + networkFeeCharged` in entrambe le sheet.

## Bug 3 — Totale pagato mostra importo sbagliato

**Problema**: `MultiChainSendSheet` step 2 (confirm) mostrava `quote.grossAmount` per "Totale pagato", ma `grossAmount` = `netAmount + projectFee` (senza `networkFeeCharged`). Quindi per USDT BSC/ETH con fee di rete, il totale mostrato era 1.00 USDT invece di 1.60 USDT.

**Formula corretta**: `totale pagato = grossAmount + networkFeeCharged = minDepositAmount (EVM)`.

**Fix**: cambiato in `fmtQ(totalPaidUnits(quote).toString())` dove `totalPaidUnits = gross + networkFeeCharged`.

**Note BTC**: per BTC `networkFeeCharged = "0"` ma c'è la fee miner nel `minDepositAmount` — aggiunto nota `(+ fee miner BTC)` accanto al totale.
