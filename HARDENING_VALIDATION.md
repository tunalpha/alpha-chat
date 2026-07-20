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

## Metriche da raccogliere in produzione

Dopo il deploy, monitorare i log per almeno 2-3 giorni:

| Metrica | Come cercarla nel log | Target |
|---|---|---|
| Numero di retry | `grep "\[CALL_RETRY\]"` | Raro (<5% delle chiamate) |
| Retry riusciti | `[CALL_RETRY]` seguito da `call.answered` entro 30s | > 80% se retry si verifica |
| Duplicati bloccati | `[CALL-M4] call.offer duplicato ignorato` | Sempre = numero retry |
| ACK medi (`delivered=true`) | `call.signal_ack delivered=true rtt=` | < 200ms in condizioni normali |
| Casi `delivered=false` | `call.signal_ack delivered=false` | Raro, solo zombie/offline |
| Push zombie (M5) | `[CALL-M5] callee isOnline=true ma openCount=0` | Presente quando callee in zombie |

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
