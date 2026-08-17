---
name: EvmFailedView error prop unused
description: EvmFailedView aveva il prop `error` dichiarato ma non consumato nel JSX — il messaggio di errore era sempre hardcoded.
---

# EvmFailedView error prop unused bug

**Rule:** Quando si aggiunge un prop a un componente React, verificare che sia effettivamente usato nel JSX — non solo nella firma della funzione.

**Why:** `EvmFailedView({ error, onRetry })` aveva `error?: string` nella firma ma il body JSX mostrava `<p>Swap non disponibile al momento. Riprova tra qualche istante.</p>` hardcoded. Il prop veniva passato correttamente da `EvmSwapView` (`error={sv.error?.message}`) ma veniva silenziosamente ignorato, rendendo impossibile mostrare errori specifici come "insufficient funds".

**How to apply:** Ogni volta che si modifica la firma di un componente per aggiungere un prop, cercare nel body se il prop è usato in JSX. Aggiungere `humanizeEvmError(error ?? "SWAP_UNAVAILABLE")` al posto del testo hardcoded in `EvmFailedView`.

Anche in `useEvmSwapState.ts`: il catch block passava sempre `message: "SWAP_UNAVAILABLE"` invece del `msg` reale — fix: `message: msg || "SWAP_UNAVAILABLE"`.
