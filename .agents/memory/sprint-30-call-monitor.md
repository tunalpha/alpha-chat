---
name: Sprint 30 — Call Monitor (State Machine)
description: Modulo separato per state machine chiamate. Zero regressioni su chat/Signal/media/R2/auth.
---

# Sprint 30 — Call Monitor

## Principio fondamentale
Modulo completamente separato. NON tocca: CallContext.tsx, ws-server.ts logica, IncomingCallModal, calls.routes.ts, auth, Signal, media, R2.

## File nuovi (backend)
- `models/call-session.model.ts` — state machine: CALLING|RINGING|ACCEPTED|CONNECTED|ENDED|MISSED|REJECTED|BUSY|CANCELLED|TIMEOUT; TTL 90gg
- `models/call-event.model.ts` — call_events collection; TTL 30gg; CALL_START|CALL_RINGING|CALL_ACCEPT|CALL_REJECT|CALL_TIMEOUT|CALL_END|CALL_CANCEL|CALL_BUSY|CALL_ERROR|CALL_CONNECTED
- `services/call-session.service.ts` — fire-and-forget hooks (onCallOffer/Busy/Answer/Reject/End) + REST API functions + getCallMetrics() aggregation
- `routes/v1/call-session.routes.ts` — POST /calls/start|ringing|accept|reject|end|cancel|busy|timeout + GET /calls/sessions; montato su /calls INSIEME a calls.routes.ts

## File modificati minimalmente (backend)
- `lib/ws-server.ts` — fire-and-forget hook in call.offer (onCallOffer, onCallBusy), call.answer (onCallAnswer), call.reject (onCallReject), call.end (onCallEnd); tutti catch-all, non bloccano signaling
- `routes/v1/index.ts` — aggiunto mount call-session.routes.ts su /calls
- `routes/v1/admin.routes.ts` — aggiunto GET /admin/calls/metrics (requireAdmin("read_only"))

## File nuovi (admin panel)
- `pages/call-monitor.tsx` — KPI row (oggi/attive/durata/success rate) + state breakdown con progress bar + tabella contatori + BarChart 24h (recharts) + nota architetturale

## File modificati minimalmente (admin panel)
- `lib/api.ts` — interface CallMetrics + getCallMetrics()
- `hooks/use-admin.tsx` — useCallMetrics (refetchInterval 30s)
- `App.tsx` — route /call-monitor
- `Sidebar.tsx` — voce "Call Monitor" con Phone icon

## Integrazione WS → state machine
I hook sono fire-and-forget (void async) con try/catch interno. Se MongoDB è giù, il signaling WS continua senza interruzioni.
Upsert con $setOnInsert → idempotente, nessun duplicato se client chiama anche REST /calls/start prima del WS.

**Why:** Modulo separato con hook fire-and-forget = zero rischio regressioni sulla logica chiamate esistente.
**How to apply:** Per aggiungere stati futuri (es. CONNECTED su WebRTC "connected"), aggiungere hook in ws-server.ts e nuovo eventType in call-event.model.ts.

## Cosa NON è stato implementato (PWA limitation)
- PushKit/CallKit iOS → richiede progetto Xcode nativo
- Firebase Full-Screen Intent Android → richiede APK nativo
- Daily.co room → non richiesto dall'utente; WebRTC diretto mantenuto
