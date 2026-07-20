# Hardening Fase 1 — Signaling Affidabile
**Data:** 2026-07-20  
**Scope:** call.offer · call.answer · call.reject · call.end  
**Vincoli:** nessuna modifica a WebRTC, ICE, SRTP, API pubbliche  
**Stato:** In attesa di approvazione — nessuna modifica al codice ancora applicata

---

## 1. Audit del Codice

### 1.1 Backend — ws-server.ts (flusso chiamate)

| Evento in ingresso | Azione server | Evento in uscita | ACK al mittente |
|---|---|---|---|
| `call.offer` (L.241) | relay `call.incoming` a tutti i device del callee via `sendToUser()` | `call.incoming` | ❌ nessuno |
| `call.answer` (L.314) | relay `call.answered` al caller | `call.answered` | ❌ nessuno |
| `call.reject` (L.353) | relay `call.rejected` al caller | `call.rejected` | ❌ nessuno |
| `call.end` (L.377) | relay `call.ended` al callee | `call.ended` | ❌ nessuno |
| `call.ice_candidate` (L.342) | relay diretto, **nessun buffer** | `call.ice_candidate` | ❌ nessuno |

**`sendToUser()` (ws-manager.ts L.111):**
```typescript
sendToUser(userId: string, event: WsOutboundEvent): void {
  const conns = this.userConnections.get(userId);
  if (!conns) return;                          // ← silent drop se utente non nella Map
  for (const conn of conns) {
    if (conn.ws.readyState === WebSocket.OPEN) { // ← skip CONNECTING/CLOSING/CLOSED
      safeSend(conn.ws, event);
    }
  }
}
```

**`pendingCalls` (ws-manager.ts L.46):**  
- Buffer in-memory per `call.incoming`, TTL 35s
- Re-consegnato al callee su riconnessione WS (ws-server.ts L.183-187)
- **Solo per `call.incoming`** — nessun buffer per `call.answer`, `call.reject`, `call.end`

**Deduplicazione:**  
Nessuna. Il server non traccia `call_id` né altri identificatori per evitare doppia elaborazione.

---

### 1.2 Frontend — CallContext.tsx + useWebSocket.ts

**Invio segnali:**  
Tutti i segnali passano per `wsSend()` → `useWebSocket.send()`.  
Se WS non è OPEN: l'evento viene accodato in `pendingEventsRef` con TTL 5s (`QUEUE_TTL_MS`).

**Guard esistenti (funzionanti):**
- `acceptingRef.current` (L.337): previene doppio tap su "accetta" ✅
- `callState !== "idle"` (L.504): previene doppio `call.incoming` ✅
- `totalTimeout` 15s su `acceptCall()` (L.352): previene spinner infinito ✅

**`call_id` nei payload:**
- Non presente. I payload attuali di `call.offer` contengono: `to_user_id`, `sdp`, `call_type`, `from_display_name`.
- Nessun identificatore univoco della chiamata lato client.

---

## 2. Root Cause Analysis

### Bug A — `call.offer` silently dropped (caso più grave)

**Scenario:**  
Callee ha una connessione WS in stato CLOSING (zombie: app chiusa da <15s, heartbeat non ancora scattato). `wsManager.isOnline(calleeId)` restituisce `true` (il Map ha ancora l'entry). Il server quindi **non invia la push notification** (L.291: `if (!wsManager.isOnline(toId))`). `sendToUser()` prova a consegnare ma tutti i socket sono CLOSING → zero delivery. Il `pendingCalls` buffer salva solo se il callee riapre l'app entro 35s.

**Risultato:** chiamata mai ricevuta dal callee, nessuna notifica, nessun feedback al caller.

---

### Bug B — `call.answer` / `call.reject` / `call.end` persi durante WS instabile

**Scenario:**  
Rete mobile instabile: WS cade e si riconnette. Durante la finestra di riconnessione:
- Callee accetta la chiamata → `call.answer` messo in coda (5s TTL)
- Callee rifiuta la chiamata → `call.reject` messo in coda (5s TTL)
- Caller chiude la chiamata → `call.end` messo in coda (5s TTL)

Se la riconnessione WS + re-auth richiedono >5s (backoff esponenziale inizia a 1s, può arrivare a 2s, 4s... → oltre 5s al terzo tentativo), l'evento viene **scartato silenziosamente**. L'altra parte non lo riceve mai.

**Risultato specifico per `call.reject`:** il caller rimane con lo spinner infinito perché aspetta `call.answered` o `call.rejected` indefinitamente (il timeout lato caller è 45s, abbastanza per perdere il reject).

---

### Bug C — Doppia ricezione `call.incoming` in edge case multi-device/reconnect

**Scenario:**  
Callee ha 2 device attivi. Primo device riceve `call.incoming` via `sendToUser()` (socket OPEN). L'utente accetta sul secondo device che era in CONNECTING → riconnette → ottiene `call.incoming` di nuovo via `pendingCalls` re-delivery (L.183-187).

**Guard esistente:** `callState !== "idle"` su secondo device blocca il secondo incoming SE il primo ha già aggiornato lo stato. Ma il primo e il secondo device sono sessioni browser separate → stati indipendenti → entrambi potrebbero elaborare l'incoming.

**Risultato:** possibile doppia sessione WebRTC per la stessa chiamata. Raro ma riproducibile.

---

### Bug D — `call.end` non consegnato se WS cade a metà chiamata

**Scenario:**  
Caller perde rete a metà chiamata, WS cade, l'utente riapre l'app dopo >5s. `endCall()` era già stato chiamato automaticamente da `cleanup()`. L'evento `call.end` era in coda ma è scaduto (>5s). Callee non riceve `call.ended` → UI callee rimane "in chiamata".

**Risultato:** UI callee bloccata in stato "in chiamata" fino al timeout del watchdog (15s `isReconnecting`).

---

## 3. Piano di Modifica

### Regola generale
Ogni modifica è **backward-compatible**: i field aggiunti ai payload vengono ignorati da handler che non li conoscono. Nessuna modifica a SDP, ICE, o SRTP.

---

### Modifica M1 — `call_id` nei payload (client)

**File:** `artifacts/alpha-chat-web/src/contexts/CallContext.tsx`  
**Righe coinvolte:** L.310-320 (initiateCall), L.404-407 (call.answer), L.431, L.444, L.453  
**Dimensione:** ~10 righe

Generare un `call_id = crypto.randomUUID()` all'inizio di `initiateCall()` e allegarlo a tutti i segnali successivi (`call.offer`, `call.answer`, `call.reject`, `call.end`). Il `call_id` viene salvato in un `callIdRef` locale.

Per `call.incoming`, estrarre e conservare il `call_id` dal payload ricevuto, così callee può allegarlo ai propri `call.answer`/`call.reject`.

```typescript
// Prima (call.offer):
wsSend({ type: "call.offer", payload: { to_user_id, sdp, call_type, from_display_name } });

// Dopo:
wsSend({ type: "call.offer", payload: { to_user_id, sdp, call_type, from_display_name, call_id: callIdRef.current } });
```

**Rischio:** nessuno — field ignorato dal server se non gestito. ✅

---

### Modifica M2 — ACK server→client per i 4 segnali principali (server)

**File:** `artifacts/api-server/src/lib/ws-server.ts`  
**Righe coinvolte:** L.280-311 (call.offer), L.324-328 (call.answer), L.363-367 (call.reject), L.386-390 (call.end)  
**Dimensione:** ~20 righe totali (5 righe per evento)

Dopo ogni relay, il server invia al mittente:
```typescript
safeSend(ws, {
  type: "call.signal_ack",
  payload: { call_id, event_type: "call.offer", delivered: openCount > 0 || pendingBuffered }
});
```

- `delivered: true` se almeno un socket OPEN ha ricevuto il segnale, **oppure** se il `pendingCalls` buffer ha preso in carico l'offer
- `delivered: false` altrimenti (callee completamente irraggiungibile)

**Caso speciale `call.offer`:** se `isOnline(toId) === true` ma `openCount === 0` (zombie connection, Bug A), inviare push notification **comunque** e restituire `delivered: false` al caller.

**Aggiunta al tipo `WsEvent`** in `ws-events.ts`:
```typescript
| { type: "call.signal_ack"; payload: { call_id: string; event_type: string; delivered: boolean } }
```

**Rischio:** nuovo event type. Client che non lo gestisce lo ignora (handler default in useWebSocket). ✅

---

### Modifica M3 — Retry automatico solo se ACK mancante (client)

**File:** `artifacts/alpha-chat-web/src/contexts/CallContext.tsx`  
**Righe coinvolte:** L.310-330 (initiateCall, dopo invio call.offer)  
**Dimensione:** ~25 righe

Logica:
1. Invia `call.offer`
2. Attende `call.signal_ack` per 2s
3. Se ACK non arriva in 2s → **un solo retry** (non loop, non backoff)
4. Se secondo tentativo non ottiene ACK in 2s → caller riceve feedback "Chiamata non consegnata" e `cleanup("no_ack")`
5. Se ACK arriva con `delivered: false` → mostra toast "Il contatto non è raggiungibile" e cleanup immediato

```typescript
// Pseudo-codice
const ackPromise = new Promise<CallSignalAck>((resolve) => {
  const unsub = on((e) => {
    if (e.type === "call.signal_ack" && e.payload.call_id === callIdRef.current) {
      unsub(); resolve(e.payload);
    }
  });
});
wsSend({ type: "call.offer", payload: { ..., call_id: callIdRef.current } });
try {
  const ack = await Promise.race([ackPromise, delay(2000).then(() => null)]);
  if (!ack) { /* retry once */ }
  if (ack?.delivered === false) { cleanup("unreachable"); return; }
} catch { ... }
```

**Rischio:** il retry duplica `call.offer`. Mitigato da M4 (dedup lato server). ✅  
**Rischio secondario:** se `call.signal_ack` viene gestito nell'event loop prima che il `callState` sia aggiornato. Mitigato usando `useRef` per il listener, non state.

---

### Modifica M4 — Deduplicazione server per `call.offer` (server)

**File:** `artifacts/api-server/src/lib/ws-manager.ts`  
**Dimensione:** ~15 righe

Aggiungere un `processedOffers` Set con TTL automatico per evitare doppia elaborazione dello stesso `call_id`:

```typescript
private readonly processedOffers = new Map<string, number>(); // call_id → expiresAt

hasProcessedOffer(callId: string): boolean {
  const exp = this.processedOffers.get(callId);
  if (!exp) return false;
  if (Date.now() > exp) { this.processedOffers.delete(callId); return false; }
  return true;
}
markOfferProcessed(callId: string): void {
  this.processedOffers.set(callId, Date.now() + 60_000); // TTL 60s
}
```

Nel handler `call.offer` in ws-server.ts:
```typescript
const callId = p["call_id"] as string | undefined;
if (callId && wsManager.hasProcessedOffer(callId)) {
  safeSend(ws, { type: "call.signal_ack", payload: { call_id: callId, event_type: "call.offer", delivered: true } });
  break; // già elaborato, ack immediato
}
if (callId) wsManager.markOfferProcessed(callId);
```

**Rischio:** se `call_id` non è presente (client vecchio/incompatibile), dedup è no-op. Backward-compatible. ✅

---

### Modifica M5 — Push anche su zombie connection in `call.offer` (server)

**File:** `artifacts/api-server/src/lib/ws-server.ts`  
**Righe coinvolte:** L.291 (condizione push)  
**Dimensione:** 1 riga

Problema attuale:
```typescript
if (!wsManager.isOnline(toId)) { /* push */ }
// isOnline=true ma openCount=0 → push non inviata → silent drop
```

Fix:
```typescript
const diagBefore = wsManager.diagCalleeState(toId);
if (!wsManager.isOnline(toId) || diagBefore.openCount === 0) { /* push */ }
```

Questo è il fix più piccolo e ad alto impatto per Bug A. Anche se la WS ha una zombie connection nella Map, se nessun socket è OPEN la push viene inviata.

**Rischio:** possibile push duplicata (WS delivery + push) se il socket riceve il messaggio nell'ultimo istante prima di terminare. Il client già gestisce il caso "chiamata già gestita" tramite `callState !== "idle"`. Impatto UI: notifica push in più che, se toccata, trova la chiamata già in corso/rifiutata. Accettabile. ✅

---

## 4. Ordine di Implementazione

| # | Modifica | File | Righe stimate | Rischio |
|---|---|---|---|---|
| 1 | **M5** — push su zombie connection | ws-server.ts | 1 | ⬇️ minimo |
| 2 | **M1** — `call_id` nei payload | CallContext.tsx | ~10 | ⬇️ minimo |
| 3 | **M4** — dedup server | ws-manager.ts + ws-server.ts | ~20 | ⬇️ basso |
| 4 | **M2** — ACK server→client | ws-server.ts + ws-events.ts | ~25 | 🟡 basso-medio |
| 5 | **M3** — retry client su ACK mancante | CallContext.tsx | ~30 | 🟡 medio |

M5 è indipendente dagli altri e risolve Bug A da sola. M1→M4 si costruiscono in sequenza. M3 dipende da M2.

---

## 5. Cosa NON viene toccato

- Nessuna modifica a `RTCPeerConnection`, ICE, SRTP, SDP
- Nessuna modifica al flusso di login, chat o messaggi
- Nessuna modifica allo schema MongoDB
- Nessuna modifica alle API REST pubbliche
- Nessuna modifica al comportamento del reconnect WS
- `call.ice_candidate` escluso da questa fase (nessun buffer, nessun ACK — rischio alto per latenza)

---

## 6. Test Previsti

Per ogni modifica, prima di procedere alla successiva:

1. **M5:** chiamata a callee con zombie connection → verificare push ricevuta
2. **M1:** log server mostra `call_id` nei payload di tutti i segnali
3. **M4:** secondo `call.offer` con stesso `call_id` → server risponde ACK immediato senza doppio ring
4. **M2:** server invia `call.signal_ack` entro 100ms per ogni segnale inviato
5. **M3:** simulare ACK mancante (disconnessione manuale) → retry automatico una volta → fallback pulito

---

*In attesa di approvazione prima di qualsiasi modifica al codice.*
