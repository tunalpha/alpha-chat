---
name: Lightning invoice senza importo — fallback silenzioso
description: fetchPrices fallito in silenzio → invoice "Qualsiasi importo" → pagante invia 6 sat invece di 6 €
---

**Incidente (15/08/2026):** utente genera fattura Lightning da €6; `fetchPrices().catch(() => {})` era fallito → `lnPrices=null` → `computeLnSat()` null → `amountSat=undefined` → adapter Spark omette `amountSats` → BOLT11 "any amount". Il pagante ha digitato "6" nel suo wallet = **6 satoshi** ricevuti invece di ~6 €. Storico mostrava "Pagata €6.00" perché fiatAmount è salvato come metadato indipendente dall'importo reale.

**Regola:** se l'utente HA digitato un importo, la creazione invoice DEVE fallire con errore chiaro quando la conversione fiat→sat non è possibile — mai degradare a invoice senza importo. Amount-less solo con campo importo lasciato vuoto di proposito.

**Fix applicato** (AlphaWalletPage.tsx, solo ricezione LN): guard in generateInvoice pre-lock + retry/backoff su fetchPrices (3 tentativi).

**Pattern generale del progetto:** stessa classe di bug di "Load failed" MC — errori silenziosi che degradano il comportamento invece di fermarsi. Nei flussi pagamento ogni `catch(() => {})` su un dato necessario alla correttezza dell'importo è un bug latente.
