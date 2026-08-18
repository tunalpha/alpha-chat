---
name: ChangeNOW fixed-rate create response
description: Gestione robusta della risposta del provider dopo la creazione di un ordine EVM a tasso fisso.
---

Per gli swap EVM→EVM ChangeNOW a tasso fisso, la risposta di creazione può non
contenere gli importi attesi, anche se l’ordine è stato accettato dal provider.
Il record locale deve quindi usare l’importo sorgente convalidato e la stima
della quote fixed-rate appena bloccata come valori di persistenza e risposta.

**Why:** trattare gli importi della risposta create come obbligatori fa fallire
il salvataggio MongoDB dopo che il provider ha già creato l’ordine; il client
riceve un 500 generico e non può proseguire.

**How to apply:** la quote locked deve essere validata prima della creazione;
quando i campi amount della create response mancano o non sono numeri positivi,
usare input `fromAmount` e la stima della quote. Se anche la quote è malformata,
fallire esplicitamente prima di creare o persistere l’ordine.