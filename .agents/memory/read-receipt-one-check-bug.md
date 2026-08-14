---
name: Read receipt one-check bug
description: Sender vede una sola spunta anche dopo che il receiver ha letto e risposto — 3 root causes + fix
---

## Il bug
Il messaggio del sender mostra sempre una spunta (sent) invece di due (read), anche quando il receiver ha aperto la conversazione e risposto.

## Root causes (tutti e tre si sommano)

### Causa 1 — handleSelectConv sovrascriveva senza guard monotonica
`handleSelectConv` (ChatPage.tsx ~3238) fa:
```js
setReadReceipts((prev) => ({ ...prev, [convId]: conv.other_user_last_read_at }));
```
Se il sender riceveva un WS `read.receipt` con timestamp T2 e poi navigava via e tornava, `handleSelectConv` sovrascriveva `readReceipts[convId]` con il valore stale `other_user_last_read_at` (che era T1 < T2), cancellando il valore corretto.

### Causa 2 — read.receipt WS non aggiornava conversations state
`conversations[convId].other_user_last_read_at` veniva mai aggiornato quando arrivava un WS `read.receipt`. Quindi `handleSelectConv` leggeva sempre il valore dal carico iniziale delle conversazioni. Con il sender che naviga via e torna, Causa 1 + Causa 2 = spunta persa.

### Causa 3 — riconnessione WS non refreshava conversations
Il reconnect handler (ChatPage ~1574) rifetchava solo i messaggi, non le conversazioni. Dopo una breve disconnessione (iOS bg, network flap), i `read.receipt` persi non venivano mai recuperati. Stessa cosa su visibilitychange.

## Fix applicati (ChatPage.tsx, 1032 test PASS)

1. **Guard monotonica in handleSelectConv**: `if (existing && existing >= newVal) return prev;`
2. **read.receipt aggiorna conversations**: `setConversations(prev => prev.map(c => c.conversation_id !== cid ? c : { ...c, other_user_last_read_at: read_at }))` (con guard)
3. **Reconnect refresha conversations + readReceipts**: nel `useEffect([connected])`, dopo il refetch messaggi, chiama `apiListConversations()` e aggiorna `readReceipts` in un unico batch con guard monotonica
4. **visibilitychange idem**: stessa logica nel handler di ritorno dal background

**Why:** Senza la guard monotonica, qualsiasi navigazione via+torna resettava le spuntine. Senza il sync conversations, il reset era garantito. Senza il reconnect recovery, le spuntine perse su disconnessione erano irrecuperabili senza reload.
