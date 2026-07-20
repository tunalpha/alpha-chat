# Validazione Fase 1 — Piano di Test
**Data:** 2026-07-20  
**Prerequisito:** M5 + M1 + M4 + M4-fix + M2 + M3 tutte applicate e in produzione  
**Obiettivo:** Verificare che nessuna regressione sia stata introdotta e che i nuovi meccanismi si comportino come atteso  
**Stato Fase 2:** In attesa — dipende dall'esito di questo ciclo di validazione

---

## Scenari da testare

### S1 — Chiamata normale (rete stabile)
**Setup:** Caller e Callee entrambi con WS OPEN, rete stabile  
**Azione:** Caller avvia chiamata → Callee risponde  

**Atteso nel log browser (Caller):**
```
[Call] call.offer inviato → call_id=<uuid> sent_at=<ms>
[Call] call.signal_ack delivered=true — call_id=<uuid> rtt=<N>ms
[Call] call.answered → ...
```
**NON deve apparire:** `[CALL_RETRY]`  
**Atteso nel log server:**
```
[CALL-M4] (assente — nessun duplicato)
[CALL-M5] callee online, openCount=1 → WS delivery, push non necessaria
```

---

### S2 — ACK ritardato ma entro 2s
**Setup:** Throttling artificiale della rete (Chrome DevTools → Slow 3G) per il Caller  
**Azione:** Caller avvia chiamata  

**Atteso:** `call.signal_ack` arriva entro i 2s → `ackTimerRef` cancellato → **nessun retry**  
**NON deve apparire:** `[CALL_RETRY]`  
**Come verificare:** nel log browser, `rtt=<N>ms` con N < 2000

---

### S3 — ACK assente (simulazione)
**Setup:** Aprire DevTools → Application → Service Workers → Offline (WS disconnesso durante l'invio dell'offer, ma la WS si riconnette prima del 30s timeout)  
**Oppure:** Bloccare temporaneamente la risposta del server con un proxy tool  

**Atteso nel log browser:**
```
[CALL_RETRY] call_id=<uuid> attempt=2 reason=no_ack elapsed=~2000ms
```
**NON deve apparire:** un secondo `[CALL_RETRY]`  
**Log server:** un solo `call.offer` elaborato (dedup M4 blocca l'eventuale doppio)

---

### S4 — Retry → Nessun doppio squillo (dedup M4)
**Collegato a S3.**  
Se il retry WS viene inviato e il server lo riceve con lo stesso `call_id`:

**Atteso nel log server:**
```
[CALL-M4] call.offer duplicato ignorato (stesso call_id)
```
**Atteso sul device Callee:** squilla una sola volta, **non** suona di nuovo

---

### S5 — Due dispositivi dello stesso utente (multi-device)
**Setup:** Callee loggato su due browser/tab  
**Azione:** Caller avvia chiamata  

**Atteso:** entrambi i device suonano (fan-out WS a tutti i socket OPEN)  
**Dopo che un device accetta:** l'altro device riceve `call.ended_elsewhere` e smette di squillare  
**NON deve succedere:** doppia sessione WebRTC attiva simultaneamente

---

### S6 — Zombie connection (M5)
**Setup:**
1. Callee apre l'app (WS OPEN)
2. Callee forza la chiusura del browser/tab senza fare logout (WS va in CLOSING)
3. Entro ~10-15s (prima che il heartbeat 15s lo rilevi) → Caller avvia chiamata

**Atteso nel log server:**
```
[CALL-M5] callee isOnline=true ma openCount=0 (zombie) → push inviata
```
**Atteso sul Callee:** riceve notifica push della chiamata  
**NON deve succedere:** chiamata silenziosamente persa (vecchio bug A)

---

### S7 — WS chiuso durante chiamata attiva
**Setup:** Mentre una chiamata è attiva, disconnettere la rete del Caller per >5s poi riconnettersi  

**Atteso:** WebRTC gestisce il reconnect (ICE restart già implementato in Sprint 25)  
**NON deve succedere:** loop infinito di retry, doppi `call.end`, UI bloccata "in chiamata"  
**Log browser (Caller):** nessun `[CALL_RETRY]` — M3 opera solo nella fase di setup (call.offer), non durante la chiamata attiva

---

### S8 — Reinstallazione PWA (regressione Signal)
**Scopo:** Verificare che le modifiche al signaling di Fase 1 non abbiano introdotto effetti collaterali sul protocollo Signal (identity key, sessioni E2E).  
**Setup:**
1. Disinstalla Alpha Chat dal dispositivo (o cancella i dati dell'app)
2. Reinstalla e registra nuovamente lo stesso utente
3. Ricevi una chiamata e alcuni messaggi da un contatto esistente

**Atteso:**
- Nessun comportamento anomalo nel signaling di chiamata (nessun `[CALL_RETRY]` anomalo, ACK ricevuto normalmente)
- Se i messaggi risultano `[Messaggio non decifrabile]` → il problema è **indipendente dalla Fase 1** e va attribuito alla gestione delle identity key (problema noto, congelato per module isolation policy)
- Se i messaggi sono decifrabili normalmente → nessuna regressione Signal introdotta da M1–M3

**Note:** Questo test non valida una funzionalità di Fase 1, ma esclude effetti collaterali.

---

### S9 — Doppia chiamata consecutiva (reset dei ref M3)
**Scopo:** Verificare che `callIdRef`, `ackTimerRef`, `retryAttemptedRef`, `offerSentAtRef` vengano correttamente azzerati da `cleanup()` e non "inquinino" la seconda chiamata.

**Setup:**
1. Effettua una chiamata normale (Caller → Callee risponde → entrambi chiudono)
2. Avvia immediatamente una seconda chiamata verso lo stesso contatto

**Atteso nel log browser (seconda chiamata):**
- `call_id` della seconda chiamata è un **nuovo UUID** diverso dalla prima
- Nessun `[CALL_RETRY]` ereditato dalla prima
- Nessun `call.signal_ack` della prima chiamata associato alla seconda (il filtro `ackCallId !== callIdRef.current` lo blocca)
- `ackTimerRef` è un timer fresco (il precedente era già stato cancellato da `cleanup()`)

**Come verificare:** confrontare i due `call_id` nei log; devono essere diversi. Il secondo `call.offer` deve avere `sent_at` coerente con il momento del secondo tentativo.

---

## Metriche da raccogliere in produzione

Dopo il deploy, monitorare i log per almeno 2-3 giorni:

| Metrica | Come cercarla nel log | Target |
|---|---|---|
| **Totale `call.offer` inviati** | `grep "call.offer inviato"` (log browser) | baseline |
| **Totale retry** | `grep "\[CALL_RETRY\]"` | Raro (<5% delle chiamate) |
| **Percentuale retry** | CALL_RETRY / call.offer × 100 | < 5% target; >20% → investigare |
| Retry riusciti | `[CALL_RETRY]` seguito da `call.answered` entro 30s | > 80% se retry si verifica |
| Duplicati bloccati | `[CALL-M4] call.offer duplicato ignorato` | Sempre = numero retry |
| **RTT medio ACK** (`delivered=true`) | `call.signal_ack delivered=true rtt=` — calcolare media | < 200ms condizioni normali |
| **RTT massimo ACK** | stesso campo, valore massimo osservato | Se > 1800ms → timeout 2s troppo stretto |
| Casi `delivered=false` | `call.signal_ack delivered=false` | Raro, solo zombie/offline |
| Push zombie (M5) | `[CALL-M5] callee isOnline=true ma openCount=0` | Presente quando callee in zombie |

---

## Contatori server-side (dashboard)

Oltre ai grep, i dati sono disponibili direttamente tramite API:

```
GET /api/v1/admin/call-metrics        (requireAdmin)
```

Risposta di esempio (reset a ogni riavvio server):
```json
{
  "ok": true,
  "data": {
    "calls_started":      42,
    "calls_answered":     38,
    "calls_completed":    40,
    "calls_failed":        4,
    "calls_retried":       2,
    "calls_deduplicated":  2,
    "answer_rate_pct":   90.5,
    "retry_rate_pct":     4.8,
    "failure_rate_pct":   9.5,
    "since": "2026-07-20T10:05:34.603Z"
  }
}
```

**Interpretazione:**
| Campo | Cosa misura | Soglia preoccupante |
|---|---|---|
| `answer_rate_pct` | % chiamate risposte sul totale | < 70% → investigare |
| `retry_rate_pct` | % retry (call.offer duplicati ricevuti) | > 20% → timeout 2s troppo stretto? |
| `failure_rate_pct` | % chiamate mai risposte (timeout + rifiuti) | > 30% → investigare rete/UX |
| `calls_deduplicated` | sempre = `calls_retried` (dedup server) | valore > 0 → M3 ha agito |

**Punti di incremento in ws-server.ts:**
- `calls_started` — dopo `markOfferProcessed()`, prima del relay
- `calls_answered` — all'inizio di `call.answer`
- `calls_completed` — all'inizio di `call.end`
- `calls_failed` — in `call.reject` + `call.end` con `reason=timeout/cancelled`
- `calls_retried` + `calls_deduplicated` — quando `hasProcessedOffer()=true`

---

## Soglie di allarme

Se si osservano i seguenti pattern → investigare prima di procedere con Fase 2:

- `[CALL_RETRY]` su >20% delle chiamate → problema sistematico di rete o ACK
- Doppio `[CALL-M4] duplicato ignorato` sullo stesso `call_id` → retry loop (non deve succedere)
- `call.signal_ack delivered=false` su chiamate verso utenti attivi → problema presenza/heartbeat
- `[CALL-M5]` assente per chiamate a zombie noto → M5 non funziona come atteso

---

## Decisione Fase 2

Raccogliere 2-3 giorni di log in produzione, poi rispondere a questa domanda:

**"Dopo il heartbeat a 15s (Fix F-1) e le modifiche M5–M3, si osservano ancora casi di presenza incoerente?"**

- Casi: REST dice "Online" ma WS dice "Offline", oppure presenza errata oltre la finestra attesa (>15s)  
- Se **no** → Fase 2 non necessaria  
- Se **sì** (con evidenza dai log) → procedere con Fix F-2 (`last_seen_at` staleness guard in `/presence/contacts`)

---

*Documento aggiornato automaticamente da build CI o manualmente dopo validazione sul campo.*
