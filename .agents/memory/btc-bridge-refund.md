---
name: BTC→EVM swap bridge refund handling
description: Thorchain rifiuta swap sotto il minimo e rimborsa BTC automaticamente — UI fix e causa
---

# BTC→EVM Swap — Bridge Refund (Thorchain minimum)

## Incidente (2026-08-17)
Utente ha inviato 0.00022745 BTC (~$13) per uno swap BTC→USDT via Thorchain/Li.Fi.
Thorchain ha rifiutato il deposit perché sotto il minimo (tipicamente $50-100 per swap BTC).
Li.Fi ha risposto `status: "FAILED"` durante il polling.

**Prima del fix:** UI mostrava "Swap non disponibile al momento. Riprova." con pulsante "Riprova"
→ rischio che l'utente inviasse altro BTC premendo "Riprova".

## Fix applicato
`useEvmSwapState.ts` `startBtcPoll`: quando `st.status === "FAILED" | "INVALID"`, usa codice errore
`BTC_BRIDGE_REFUND` invece di `SWAP_UNAVAILABLE`.

`EvmSwapView.tsx`:
- `humanizeEvmCode("BTC_BRIDGE_REFUND")` → "Lo swap è stato rifiutato dal bridge... BTC rimborsato entro 30-60 min"
- `EvmFailedView`: quando `error === "BTC_BRIDGE_REFUND"`, **nasconde** il pulsante "Riprova"
  (mostra solo "Torna allo swap") per evitare doppio invio BTC.

## Cosa succede ai fondi
Thorchain rimborsa automaticamente il BTC all'indirizzo mittente entro 30-60 minuti.
Non è necessaria nessuna azione manuale.

## Gap rimasto (non ancora fixato)
Manca una guard PRE-INVIO: il sistema non verifica che l'importo sia sopra il minimo Thorchain
PRIMA di far firmare e inviare il BTC. Il fix attuale gestisce solo il caso post-invio.
Serve leggere `minAmount` dalla risposta quote Li.Fi e bloccare l'execute se sotto soglia.

**Why:** "Riprova" su un bridge-refund invia nuovamente BTC → double spend; il pulsante
deve essere nascosto o etichettato correttamente per evitarlo.
