---
name: MC Send State Machine — "confirming" timing
description: setSignPhase("confirming") deve stare nel .then() di sendTransaction, non dopo il fire-and-forget setup
---

# MultiChain Send — State Machine Rule

## Rule
`setSignPhase("confirming")` ("Transazione inviata") deve essere chiamato SOLO dentro `.then()` di `sendTransaction()`, mai subito dopo il setup del fire-and-forget.

**Why:** Se impostato immediatamente dopo `sendTransaction().catch()` (sincrono), l'UI mostra "Transazione inviata" nel momento della chiamata — prima che il wallet abbia firmato. L'utente vede il risultato finale e non apre Trust Wallet per firmare.

**How to apply:**
```typescript
// CORRETTO
currentAccount.sendTransaction({...})
  .then(() => {
    setSignPhase(prev =>
      prev === "done" || prev === "error" || prev === "uncertain" ? prev : "confirming"
    );
    localStorage.setItem(MC_PENDING_KEY, ...);  // signed:true solo dopo TX hash
  })
  .catch((err) => { /* error handling */ });
// signPhase resta "signing" durante tutto il polling finché wallet non risponde

// SBAGLIATO (era il bug del 14/08/2026)
currentAccount.sendTransaction({...}).catch(...);
setSignPhase("confirming");  // ← sincrono, prima del wallet → "Transazione inviata" prematuro
```

**Guard anti-regressione nel .then():** `prev === "done" | "error" | "uncertain" → return prev`
Previene che il polling (che può rilevare il deposito prima del round-trip WC) venga sovrascritto dal .then() ritardato.

**localStorage signed:true** va nel `.then()`, non dopo il fire-and-forget — così viene scritto solo se il wallet ha effettivamente firmato.
