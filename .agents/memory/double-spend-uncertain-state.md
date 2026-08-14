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

**Incidente:** BSCScan TX 0xfbf3...c16d confermata, UI mostrava "Load failed" + bottone firma attivo.
