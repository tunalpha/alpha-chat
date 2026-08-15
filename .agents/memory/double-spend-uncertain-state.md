---
name: MultiChain double-spend uncertain state
description: Quando sendTransaction torna "Load failed" dopo che il wallet ha già firmato, NON mostrare il bottone "Firma transazione" — la TX è già in mempool.
---

## Regola

Quando `sendTransaction` rigetta con un errore di rete (non un rifiuto utente), la TX è probabilmente già stata firmata e broadcast. Mostrare di nuovo il pulsante "Firma transazione" causa double-spend.

**Pattern corretto:**
- `signedUncertain = true` per: "Load failed", "Failed to fetch", "NetworkError", timeout, errori RPC
- `pollAborted = true` SOLO per: "user rejected", "insufficient funds", errori chain (TX non mai partita)
- In stato `uncertain`: non fare `return` dal loop di polling — continuare fino a max 10 min
- Fase `"uncertain"` nel render: box giallo ambra, nessun bottone firma, solo "Ho inviato →"

**Why:** Su iOS Safari PWA con WalletConnect, il relay può cadere dopo che il wallet ha firmato ma prima che il SDK riceva il txHash. La TX è in mempool ma il frontend non lo sa. Il backend detect (polling) è l'unica fonte di verità — deve continuare.

**How to apply:** Qualsiasi payment flow con `sendTransaction` fire-and-forget deve distinguere tra:
- Errore PRE-broadcast (rifiuto, funds, chain) → retry sicuro
- Errore POST-broadcast (rete, timeout, RPC) → incerto → `signedUncertain`
- File: `MultiChainSendSheet.tsx`, `MultiChainPayRequestSheet.tsx`, `SendPaymentSheet.tsx`

**Incidente BSC 2026:** BSCScan TX 0xfbf3...c16d confermata, UI mostrava "Load failed" + bottone firma attivo.

## Incidente USDA 2026-08-15 — Triple charge 1.15 USDA

**Root cause**: `SendPaymentSheet.tsx` NON aveva `signedUncertain`. Dopo "Load failed" + 30s GRACE_POLLS → throw → phase="error" → bottone "Riprova" → `setStep("confirm")` con `isResume=false` → `handleSend()` → `apiPaymentCreate()` → NUOVA TX reale.

**Fix applicato** (pattern identico a MultiChainSendSheet):
- `signedUncertain = true` nel .catch() di sendTransaction per errori non-rifiuto
- GRACE_POLLS: se `signedUncertain` → `setPhase("uncertain")` e CONTINUA il loop (no throw)
- Timeout 10 min: se `signedUncertain` → `setPhase("uncertain"); return` (no throw)
- `createdTransferRef`: salvato immediatamente dopo `apiPaymentCreate()` → guard in `handleSend` impedisce secondo `apiPaymentCreate()` se ref già settato
- `handleRetrySign()`: retry firma senza nuovo transfer
- "Riprova" in phase="error": se `createdTransferRef.current` → `handleRetrySign()`, altrimenti `setStep("confirm")`
- **Invariant test**: `src/tests/usda-send-idempotency.test.ts` — §1-§3 (8 casi)

**INVARIANTE**: per ogni payment intent, `apiPaymentCreate()` è chiamata al massimo 1 volta.
