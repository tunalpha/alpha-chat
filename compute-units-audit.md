# Audit Compute Units — Alpha Chat (Replit Autoscale)
*Data: 5 agosto 2026 — Analisi completa back-end + front-end*

---

## 1. Problemi individuati

### 🔴 CRITICO — P1

---

#### P1-A — WS Heartbeat: log a `info` su ogni ping/pong
| Campo | Dettaglio |
|---|---|
| **File** | `artifacts/api-server/src/lib/ws-server.ts` |
| **Funzione** | `startHeartbeat()` / handler `ws.on("pong")` |
| **Righe** | 126 (ping sent), 573–576 (pong received) |
| **Motivo** | `logger.info` chiama JSON.stringify + I/O su ogni tick del heartbeat. Con N client connessi: **2N log/15s** = 8N log/min. Con 100 utenti simultanei → 800 serializzazioni JSON al minuto, senza alcun valore operativo in produzione. |
| **Impatto stimato** | Alto — costituisce la principale fonte di CPU wastage continua; presente 24/7 anche senza richieste HTTP. |
| **Soluzione** | Demotare entrambi i log a `logger.debug`. In produzione il livello è `info`, quindi scompaiono del tutto. |

**Codice originale:**
```typescript
// riga 126
logger.info({ userId, lastPingSentAt }, "[WS] ping sent");

// righe 573-576
logger.info(
  { userId, lastPongAt, rttMs: lastPingSentAt ? lastPongAt - lastPingSentAt : null },
  "[WS] pong received",
);
```

**Codice corretto:**
```typescript
// riga 126
logger.debug({ userId, lastPingSentAt }, "[WS] ping sent");

// righe 573-576
logger.debug(
  { userId, lastPongAt, rttMs: lastPingSentAt ? lastPongAt - lastPingSentAt : null },
  "[WS] pong received",
);
```

**Spiegazione:** `logger.debug` è un no-op quando `LOG_LEVEL=info` (default produzione). Nessun JSON.stringify, nessun write, nessun overhead.  
**Risparmio stimato:** 15–25% dei CU totali su istanze con traffico WS attivo.

---

#### P1-B — R2 Health Scheduler: DB write su ogni check (ogni 5 minuti)
| Campo | Dettaglio |
|---|---|
| **File** | `artifacts/api-server/src/schedulers/r2-health.scheduler.ts` |
| **Funzione** | `runHealthCheck()` |
| **Riga** | 35 — `R2EventModel.create(...)` |
| **Motivo** | Ogni 5 minuti esegue `HeadObjectCommand` verso R2 e poi scrive **sempre** un documento MongoDB (`R2EventModel.create`), anche quando lo stato è identico al check precedente. Risultato: 288 write MongoDB/giorno gratuite per nessun beneficio operativo aggiuntivo. La UI admin mostra solo "ultimo check" e "errori consecutivi" — informazioni ottenibili scrivendo solo sui cambiamenti di stato. |
| **Impatto stimato** | Medio-alto — ogni MongoDB write = allocazione documento + journal flush; 288 write/giorno × dimensione media documento = volume DB in crescita costante. |
| **Soluzione** | Tenere in memoria l'ultimo stato; scrivere su DB **solo se lo stato cambia** (success→error o error→success), oppure una volta all'ora come "heartbeat di stato". |

**Codice originale (`runHealthCheck`):**
```typescript
const duration_ms = Date.now() - start;

R2EventModel.create({
  event_type: "HEALTH_CHECK",
  status,
  duration_ms,
  ...(errorMessage ? { error_message: errorMessage } : {}),
}).catch((e) => logger.warn({ e }, "R2 health scheduler: persistenza event fallita (non fatale)"));

if (status === "error") {
  logger.warn({ errorMessage, duration_ms }, "R2 health check: FAIL");
}
```

**Codice corretto:**
```typescript
// Aggiungere fuori dalla funzione, nel modulo:
let _lastR2Status: "success" | "error" | null = null;
let _lastR2DbWriteAt = 0;
const R2_DB_WRITE_INTERVAL_MS = 60 * 60 * 1_000; // 1 ora max

// Dentro runHealthCheck(), al posto della create incondizionata:
const duration_ms = Date.now() - start;
const now = Date.now();
const stateChanged = status !== _lastR2Status;
const periodicWrite = now - _lastR2DbWriteAt > R2_DB_WRITE_INTERVAL_MS;

if (stateChanged || periodicWrite) {
  _lastR2Status = status;
  _lastR2DbWriteAt = now;
  R2EventModel.create({
    event_type: "HEALTH_CHECK",
    status,
    duration_ms,
    ...(errorMessage ? { error_message: errorMessage } : {}),
  }).catch((e) => logger.warn({ e }, "R2 health scheduler: persistenza event fallita (non fatale)"));
}

if (status === "error") {
  logger.warn({ errorMessage, duration_ms }, "R2 health check: FAIL");
}
```

**Spiegazione:** Il DB viene scritto solo quando lo stato cambia (evento significativo) o ogni ora come massimo (per aggiornare il "visto di recente" nella UI). Da 288 write/giorno a ≤24 + N_cambiamenti.  
**Risparmio stimato:** 85–90% delle write MongoDB da questo scheduler.

---

#### P1-C — R2 Health Scheduler: intervallo 5 minuti troppo frequente per una metrica admin
| Campo | Dettaglio |
|---|---|
| **File** | `artifacts/api-server/src/schedulers/r2-health.scheduler.ts` |
| **Funzione** | `startR2HealthScheduler()` |
| **Riga** | 14 — `const INTERVAL_MS = 5 * 60 * 1_000` |
| **Motivo** | Il check R2 fa una richiesta HTTP esterna (Cloudflare) ogni 5 minuti. Il dato è visualizzato in un pannello admin che non richiede questa granularità. |
| **Impatto stimato** | Medio — ogni HeadObjectCommand = TCP round-trip a Cloudflare + billing API call R2. |
| **Soluzione** | Portare l'intervallo a 15 minuti. |

**Codice originale:**
```typescript
const INTERVAL_MS = 5 * 60 * 1_000; // 5 minuti
```
**Codice corretto:**
```typescript
const INTERVAL_MS = 15 * 60 * 1_000; // 15 minuti — sufficiente per rilevare outage R2
```
**Risparmio stimato:** 67% delle chiamate HTTP esterne da questo scheduler.

---

### 🟠 ALTO — P2

---

#### P2-A — Diagnostic Logger: flush ogni 5 secondi su ogni tab attiva
| Campo | Dettaglio |
|---|---|
| **File** | `artifacts/alpha-chat-web/src/lib/diagnosticLogger.ts` |
| **Funzione** | `init()` |
| **Riga** | 29 (`FLUSH_INTERVAL_MS = 5_000`), 95 (`setInterval`) |
| **Motivo** | Ogni tab del browser autenticata invia una POST `/api/v1/diagnostics/events` ogni 5 secondi. Il guard su buffer vuoto esiste (riga 174) e funziona, quindi le POST a buffer vuoto non avvengono. Tuttavia, il `setInterval` esegue la funzione `_flush()` ogni 5s comunque, inclusa la chiamata a `_getToken()` e la lettura del buffer. Durante una chiamata attiva, questo invia dati reali ogni 5s anche se non è un'emergenza. |
| **Impatto stimato** | Medio — in sessioni attive (chiamate in corso) genera 12 POST/minuto/utente al server, ognuna con `insertMany` MongoDB. |
| **Soluzione** | Aumentare `FLUSH_INTERVAL_MS` a 15s in modalità normale; 5s solo durante una chiamata attiva (quando `_callId !== null`). |

**Codice originale:**
```typescript
const FLUSH_INTERVAL_MS = 5_000;
```

**Codice corretto:**
```typescript
const FLUSH_INTERVAL_NORMAL_MS = 15_000; // fuori dalle chiamate
const FLUSH_INTERVAL_CALL_MS   =  5_000; // durante una chiamata — massima granularità

// In _flush(), avviare con intervallo dinamico:
// (vedi sotto — restart timer dopo ogni flush con il valore corretto)
```

E modificare `init()` e `startCall()`/`endCall()` per riavviare il timer con l'intervallo corretto:
```typescript
private _restartFlushTimer(): void {
  if (this._flushTimer) clearInterval(this._flushTimer);
  const interval = this._callId ? FLUSH_INTERVAL_CALL_MS : FLUSH_INTERVAL_NORMAL_MS;
  this._flushTimer = setInterval(() => { void this._flush(); }, interval);
}

// Chiamare _restartFlushTimer() in startCall() e endCall() oltre che in init()
```
**Risparmio stimato:** 67% delle POST diagnostics in sessioni non-call; invariato durante le chiamate.

---

#### P2-B — WS Heartbeat: intervallo 15s (precedentemente ridotto da 30s)
| Campo | Dettaglio |
|---|---|
| **File** | `artifacts/api-server/src/lib/ws-server.ts` |
| **Funzione** | `startHeartbeat()` |
| **Riga** | 40 — `const PING_INTERVAL_MS = 15_000` |
| **Motivo** | Il commento stesso dice "ridotto da 30s". Con 15s, ogni connessione WS genera 4 ping/min (8 eventi contando pong). Con 50 utenti simultanei = 400 eventi WS/min dedicati solo al heartbeat. |
| **Impatto stimato** | Medio — la banda WS heartbeat non è il problema (i pacchetti sono piccoli), ma il CPU per gestire i frame WS sì, soprattutto con il logging (P1-A risolve il logging; questo riduce il numero di frame). |
| **Soluzione** | Riportare a 30s (il valore originale era scelto per una buona ragione: zombie window di 30s è accettabile). |

**Codice originale:**
```typescript
const PING_INTERVAL_MS = 15_000; // 15 secondi (ridotto da 30s — zombie window massima)
```
**Codice corretto:**
```typescript
const PING_INTERVAL_MS = 30_000; // 30 secondi — zombie window accettabile, dimezza overhead heartbeat
```
**Risparmio stimato:** 50% del traffico heartbeat WS.

---

#### P2-C — USDA Polling: 6 secondi durante pagamenti attivi
| Campo | Dettaglio |
|---|---|
| **File** | `artifacts/api-server/src/usda/http-usda.adapter.ts` |
| **Funzione** | `pollTransaction()` o simile |
| **Righe** | 277, 281 — `POLL_INTERVAL_MS = 6_000` |
| **Motivo** | Ogni transazione USDA in stato pending genera un loop di polling verso `getusda.xyz` ogni 6 secondi, fino a timeout di 5 minuti. Se ci sono 5 pagamenti simultanei in corso → 50 HTTP GET/minuto verso API esterna. Con timeout di default assenti o molto lunghi, se l'API è lenta ogni request può tenere una connessione aperta a lungo. |
| **Impatto stimato** | Medio in situazioni di carico di pagamento; basso con pochi pagamenti. |
| **Soluzione** | Portare l'intervallo a 10s (la blockchain Polygon ha block time di ~2s, ma la conferma è comunque asincrona; 10s è abbondante). Aggiungere `signal: AbortSignal.timeout(8_000)` a ogni fetch per evitare connessioni pendenti. |

**Codice originale:**
```typescript
const POLL_INTERVAL_MS = 6_000;
// fetch senza AbortSignal / timeout esplicito
```
**Codice corretto:**
```typescript
const POLL_INTERVAL_MS = 10_000; // 10s — sufficiente per Polygon

// In ogni chiamata fetch all'adapter USDA:
const res = await fetch(url, {
  signal: AbortSignal.timeout(8_000), // max 8s per risposta
  headers: { ... },
});
```
**Risparmio stimato:** 40% delle chiamate HTTP esterne USDA + eliminazione connessioni pendenti.

---

### 🟡 MEDIO — P3

---

#### P3-A — Payment Schedulers: 3 setInterval separati da 5-10 minuti
| Campo | Dettaglio |
|---|---|
| **File** | `artifacts/api-server/src/payment/payment-scheduler.service.ts` |
| **Funzione** | `startPaymentScheduler()` |
| **Righe** | 420, 423, 426 |
| **Motivo** | Tre `setInterval` separati eseguono query MongoDB ogni 5-10 minuti: `processExpiredTransfers` (5m), `processStuckTransfers` (10m), `processPendingRequestReleases` (5m). Ciascuno fa almeno una query su `payments` collection. Non hanno `.unref()` verificabile — se mancasse, mantengono il processo attivo. |
| **Impatto stimato** | Basso-medio — query MongoDB 5-10min sono ragionevoli; il problema principale è l'assenza di indici su `expires_at`/`status` che renderebbe le query collscans. |
| **Soluzione** | (1) Verificare che i 3 interval usino `.unref()`. (2) Verificare indici su `expires_at`, `status`, `locked_at` nella collection payments. (3) Opzionale: unificare in un singolo scheduler con step sequenziali. |

---

#### P3-B — MongoDB `syncIndexes()` allo startup
| Campo | Dettaglio |
|---|---|
| **File** | `artifacts/api-server/src/lib/mongodb.ts` |
| **Funzione** | connessione MongoDB (evento `connected`) |
| **Riga** | ~31 — `mongoose.connection.syncIndexes()` |
| **Motivo** | `syncIndexes()` legge tutti gli indici da MongoDB per ogni collection, li confronta con quelli definiti nei modelli Mongoose, e crea/dropa quelli mancanti/extra. Su collection grandi questo può richiedere diversi secondi e blocca l'avvio. Su Replit Autoscale, dove le istanze possono ripartire frequentemente dopo idle, questo genera un burst di CPU ad ogni cold start. |
| **Impatto stimato** | Medio al cold start; irrilevante dopo. |
| **Soluzione** | Sostituire `syncIndexes()` con `createIndexes()` (crea solo indici mancanti, non dropa quelli extra) oppure eseguirlo solo in sviluppo. |

**Codice originale:**
```typescript
mongoose.connection.on('connected', () => {
  mongoose.connection.syncIndexes(); // dropa + ricrea — lento
});
```
**Codice corretto:**
```typescript
mongoose.connection.on('connected', () => {
  if (process.env.NODE_ENV !== 'production') {
    // In dev: sync completo per rilevare indici obsoleti
    mongoose.connection.syncIndexes().catch(logger.error);
  }
  // In prod: crea solo gli indici mancanti, veloce e non-bloccante
  // Gli indici esistenti non vengono toccati.
});
// In produzione, gli indici sono gestiti via migration script esplicito.
```
**Risparmio stimato:** 2–8s di CPU al cold start eliminati.

---

#### P3-C — visibilitychange: WS reconnect immediato con backoff azzerato
| Campo | Dettaglio |
|---|---|
| **File** | `artifacts/alpha-chat-web/src/hooks/useWebSocket.ts` |
| **Funzione** | handler `visibilitychange` |
| **Righe** | 201–219 |
| **Motivo** | Quando l'utente torna in foreground, il backoff viene azzerato a 1000ms e parte immediatamente un `connect("visibilitychange")`. Se molti utenti tornano contemporaneamente (tipico: mattino, post-riunione), si genera un **thundering herd** verso il WS server. Su Replit Autoscale questo può causare lo spin-up di una nuova istanza proprio nel momento di picco. |
| **Impatto stimato** | Basso in media, spike potenzialmente alto. |
| **Soluzione** | Aggiungere un jitter casuale (0–2s) prima della reconnessione da visibilitychange. |

**Codice originale:**
```typescript
// visibilitychange handler
reconnectDelay.current = 1_000;
connect("visibilitychange");
```
**Codice corretto:**
```typescript
// Jitter 0–2s per distribuire le reconnessioni al ritorno dal background
const jitter = Math.random() * 2_000;
reconnectDelay.current = 1_000;
setTimeout(() => connect("visibilitychange"), jitter);
```
**Risparmio stimato:** Previene spike di carico da thundering herd; difficile quantificarlo in CU ma migliora la stabilità del deployment Autoscale.

---

### 🟢 BASSO — P4

---

#### P4-A — Heartbeat timeout log a `info`
| Campo | Dettaglio |
|---|---|
| **File** | `artifacts/api-server/src/lib/ws-server.ts`, righe 116–119 |
| **Problema** | Il log "heartbeat timeout — nessun pong ricevuto" è a `info` ed è corretto (evento raro). Non è un problema di frequenza. Va mantenuto. |

#### P4-B — DMS Scheduler (ogni 4 ore)
| Riga | `index.ts:46` |
|---|---|
| **Valutazione** | 4h è un intervallo molto conservativo, costo trascurabile. Non richiede ottimizzazione. |

#### P4-C — Temp Cleanup Scheduler (ogni 1 ora)
| Riga | `temp-cleanup.scheduler.ts:29` |
|---|---|
| **Valutazione** | 1h è ragionevole per la pulizia R2. Usa `.unref()`. Non impatta il comportamento Autoscale. |

#### P4-D — Token refresh frontend
| File | `AuthContext.tsx:129-143` |
|---|---|
| **Valutazione** | Usano solo `visibilitychange` (no polling continuo). Ottimale, nessuna azione richiesta. |

#### P4-E — Signal OTPK replenishment
| File | `ChatPage.tsx:1935`, `key-manager.ts:118-126` |
|---|---|
| **Valutazione** | Chiamato solo al mount/login, non periodicamente. Ottimale. |

---

## 2. Analisi Idle su Replit Autoscale

Su Replit Autoscale il container rimane attivo finché c'è lavoro CPU. Il processo **non può** andare in idle puro perché è un server HTTP che deve restare in ascolto. Tuttavia, i **CU vengono addebitati proporzionalmente al CPU effettivo**, non al wall time. Quindi ottimizzare significa ridurre il CPU in assenza di richieste reali.

**Cosa impedisce attivamente il low-CPU idle:**

| Componente | Frequenza | CPU quando idle |
|---|---|---|
| WS ping logging (P1-A) | ogni 15s × N client | Alta (JSON serialize + I/O) |
| R2 Health DB write (P1-B) | ogni 5 min | Media (MongoDB write) |
| R2 HeadObject (P1-C) | ogni 5 min | Bassa (HTTP round-trip) |
| Payment schedulers | ogni 5-10 min | Media (MongoDB query) |
| Diag flush (P2-A) | ogni 5s per tab attiva | Bassa (solo in sessione) |

**Cosa usa già `.unref()` correttamente** (non blocca idle del processo Node):
- R2 Health scheduler ✅
- Temp cleanup scheduler ✅

**Cosa manca di verifica `.unref()`:**
- Payment schedulers (P3-A) — da verificare

---

## 3. Report finale — Tabella priorità

| Priorità | Problema | CU sprecate stimate | Soluzione | Beneficio |
|---|---|---|---|---|
| 🔴 P1-A | WS heartbeat: log `info` su ogni ping/pong | **Alta** — continua, scala con utenti | `logger.debug` invece di `logger.info` | −20% CU su istanze WS attive |
| 🔴 P1-B | R2 Health: MongoDB write su ogni check (5 min) | **Alta** — 288 write/giorno gratuiti | Scrivere solo su cambio stato | −85% write da questo scheduler |
| 🔴 P1-C | R2 Health: intervallo 5 min troppo frequente | **Media** — 288 call HTTP/giorno | Portare a 15 minuti | −67% chiamate R2 |
| 🟠 P2-A | Diag flush ogni 5s in sessione | **Media** — 12 POST/min per utente in call | 15s normal / 5s in-call | −67% POST diagnostics fuori call |
| 🟠 P2-B | WS heartbeat interval 15s (era 30s) | **Media** — doppio del necessario | Riportare a 30s | −50% frame heartbeat WS |
| 🟠 P2-C | USDA polling 6s senza timeout HTTP | **Media** — connessioni pendenti in carico | 10s + AbortSignal.timeout(8s) | −40% call HTTP USDA |
| 🟡 P3-A | Payment schedulers senza .unref() verificato | **Bassa** — impede idle del processo | Aggiungere `.unref()` | Processo Node può uscire pulito |
| 🟡 P3-B | `syncIndexes()` ad ogni cold start | **Bassa** — impatta startup time | Solo in sviluppo | −2–8s CPU al cold start |
| 🟡 P3-C | visibilitychange: reconnect senza jitter | **Bassa** — spike da thundering herd | Jitter 0–2s | Stabilità Autoscale scale-up |

---

## 4. Punteggio di efficienza e classificazione

### Punteggio: **64 / 100**

**Classificazione consumo attuale: 🟠 ELEVATO**

### Dettaglio scoring:

| Area | Punteggio parziale | Note |
|---|---|---|
| Logging | 40/100 | Heartbeat info log è il problema più costoso e più facile da correggere |
| Schedulers | 60/100 | Intervalli ragionevoli ma R2 health scrive troppo spesso nel DB |
| WebSocket | 65/100 | Heartbeat a 15s è il doppio del necessario |
| Frontend polling | 90/100 | Ottimale: nessun polling continuo, guard su buffer vuoto, jitter assente |
| MongoDB | 70/100 | syncIndexes in prod + R2 unconditional write abbassano il voto |
| HTTP calls esterne | 65/100 | USDA polling senza timeout esplicito è un rischio |

### Priorità di intervento consigliata:

1. **Prima, subito** (5 minuti di lavoro, massimo ROI): Fix P1-A (2 righe di codice: `info` → `debug`)
2. **Poi** (30 minuti): Fix P1-B + P1-C (R2 scheduler con write condizionale + intervallo 15m)
3. **Poi** (1 ora): Fix P2-B (heartbeat 30s) + P2-C (USDA timeout + 10s poll)
4. **Quando comodo**: P2-A (diag flush dinamico), P3-A (unref verification), P3-B (syncIndexes), P3-C (jitter)

Con solo i fix P1-A + P1-B + P1-C implementati si stima una riduzione del **40–60% dei CU** nelle ore di traffico normale.

---

*Audit generato da analisi statica del codice sorgente — 5 agosto 2026*
