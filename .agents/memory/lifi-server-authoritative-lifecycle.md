---
name: Li.FI server-authoritative lifecycle
description: Regole permanenti per mantenere il ramo Li.FI parked e sicuro durante recovery e aggiornamenti.
---

Il browser può registrare una source transaction write-once e richiedere una riconciliazione, ma non può mai dichiarare `completed`, `failed`, `refunded` o `expired`. Il journal server-side collega un `swapId` stabile a source e destination transaction; verifica Li.FI, chain direction, source hash e payout prima di una transizione terminale.

**Why:** un broadcast EVM o una risposta del client dimostrano soltanto che la source TX è stata inviata; non dimostrano il payout del bridge. Anche il recovery dopo reload o restart deve restare corretto senza dipendere da localStorage.

**How to apply:** mantenere Li.FI disabled/parked per nuovi flussi finché richiesto, ma far riconciliare i journal non-terminali dal backend. History e notifiche devono deduplicare i lifecycle event usando `swapId` e tipo evento. Non archiviare PSBT, seed, PIN o materiale di firma nel journal.