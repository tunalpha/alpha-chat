---
name: Build before deploy — regola pre-deploy obbligatoria
description: Eseguire sempre il pre-deploy check PRIMA di SuggestUserAction(deploy)
---

# Pre-deploy check obbligatorio

## Regola (🔒 permanente)
**MAI chiamare `SuggestUserAction({ action: "deploy" })` senza prima aver eseguito il pre-deploy check.**

## Come eseguirlo

### Modalità rapida (test + sanity, ~60s) — per deploy di sole modifiche codice:
```bash
bash scripts/pre-deploy-check.sh --quick
```

### Modalità completa (test + build + sanity, ~3 min) — per deploy con nuove dipendenze/configurazioni:
```bash
bash scripts/pre-deploy-check.sh
```

Solo se il check esce con codice 0 e stampa `✅ DEPLOY OK` è lecito suggerire il deploy.

## Cosa copre
- Step 1: test critici frontend (BTC address, EVM swap safety, write-before-submit, fee invarianti)
- Step 2: test critici backend (state machine, idempotency, scheduler)
- Step 3: suite completa alpha-chat-web (1300+ test, regression check)
- Step 4 (solo full): build parallela di alpha-chat-web + admin-panel + api-server
- Step 5: sanity check statici (P2TR, no catch(null), AdapterRegistry)

## Note tecniche script
- Rimuovere `set -e` e usare `set -uo pipefail` (senza -e) per evitare exit su grep vuoto
- I grep che possono ritornare "no match" devono avere `|| true` per non propagare exit 1 con pipefail
- Le build in modalità full girano in parallelo con `&` + `wait $PID` per stare sotto 5 min
- `ECONNREFUSED 127.0.0.1:3000` nel log step 3 è un test che testa errori di rete — normale, non è un fallimento

**Why:** L'utente ha deployato senza pre-deploy check (2026-08-17) dopo un mio SuggestUserAction immediato. Il check esiste esattamente per prevenire questo.
