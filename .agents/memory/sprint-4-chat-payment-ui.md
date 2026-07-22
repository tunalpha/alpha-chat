---
name: Sprint 4 — Chat Payment UI
description: Bolla chat per message_type payment; pura vista dello stato backend; pulsanti accept/reject/cancel; WS handler payment.state_changed.
---

## File creati/modificati

| File | Azione |
|------|--------|
| `src/lib/payment-api.ts` | Nuovo — API client REST per /api/v1/payments; tipi ChatPaymentData, ChatTransferStatus |
| `src/components/usda/ChatPaymentBubble.tsx` | Nuovo — bolla pura-vista-stato |
| `src/index.css` | +55 righe `.cp-bubble` CSS |
| `src/hooks/useWebSocket.ts` | +2 event type: payment.state_changed, signal.session.reset |
| `src/pages/ChatPage.tsx` | Import + WS handler + render branch message_type==="payment" |

## Filosofia implementata

Frontend = pura vista del backend. Il componente non prende decisioni:
- Legge `data.status` → calcola variant (waiting/action/spinning/success/fail/neutral)
- Mostra UI corrispondente
- Le azioni (accept/reject/cancel) chiamano REST → risposta arriva via WS payment.state_changed → setMessages aggiorna system_metadata in-place → re-render automatico

## Tabella stato → UI

| Status | Mittente (isMine) | Destinatario |
|--------|-------------------|--------------|
| awaiting_deposit | "In attesa del tuo deposito" | "In attesa del deposito" |
| pending | "Depositato, in attesa risposta" + [🚫 Annulla] | [✅ Accetta] [❌ Rifiuta] |
| accepting/rejecting/cancelling/refunding | Spinner | Spinner |
| accepted | "Pagamento completato" | "🎉 Pagamento ricevuto!" |
| rejected | "↩️ Rifiutato" | "❌ Hai rifiutato" |
| cancelled | "🚫 Annullato" | "🚫 Annullato dal mittente" |
| expired | "⏰ Scaduto e rimborsato" | idem |
| failed | "❌ Errore" | idem |

## WS handler in ChatPage.tsx

```typescript
case "payment.state_changed": {
  // Merge payload in system_metadata del messaggio
  setMessages(prev => prev.map(m => 
    m.id !== message_id ? m : {
      ...m,
      system_metadata: { ...meta, status, tx_hash_release, amount, expires_at, asset_symbol }
    }
  ));
}
```

## CSS classi chiave

- `.cp-bubble` — container; `.cp-bubble.mine` — gradiente viola
- `.cp-variant-{waiting|action|spinning|success|fail|neutral}` — colori stato
- `.cp-spinner` — spinner CSS puro, nessuna libreria
- `.cp-btn-accept` / `.cp-btn-reject` / `.cp-btn-cancel` — pulsanti azione

## Fix pre-esistenti risolti

- `WebSocketContext.tsx`: aggiunto `signal.session.reset` al WsEvent union (confronto tipo never)
- `ChatPage.tsx:1564`: `auth.userId` → `auth?.userId ?? ""` (auth possibly null)

## TypeScript: 0 errori (exit 0 verificato)
