---
name: MC sign-poll Load failed fix
description: Polling post-firma MultiChain trattava abort di rete iOS come fatale → bottone Firma riappariva (double-spend risk)
---

Il catch del polling nel sign-flow di MultiChainSendSheet gestiva solo i codici DEPOSIT_TX_NOT_DETECTED/ADAPTER_NOT_FOUND; un "Load failed" (iOS Safari aborta la fetch quando l'app va in background durante la firma in Trust Wallet) cadeva nel ramo fatale → setSignPhase("error") con messaggio grezzo + bottone "Firma transazione" di nuovo visibile.

**Fix (autorizzato dall'utente, ago 2026):** `if (!code && isNetworkError(pollErr)) continue;` nel catch del polling — SOLO lì.

**Regole:**
- Gate `!code` obbligatorio: un errore applicativo con .code resta fatale anche se TypeError con messaggio da fetch (richiesta esplicita review architect).
- signedUncertain e cap 10 min invariati; stessa semantica già presente nel recovery poll (isNetworkError → continue).
- Test di accettazione: Trust Wallet → firma → ritorno in app → nessun "Load failed", pagamento avanza fino a Rilasciato senza ri-premere "Firma".

**Caso reale:** transfer 9cf2cc0c (Polygon 1 USDT, 15/08/2026) — backend perfetto, priorità Alpha Wallet verificata funzionante, solo UI mostrava l'errore.
