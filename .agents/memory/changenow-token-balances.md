---
name: ChangeNOW token balance sources
description: Regole per mostrare il saldo on-chain della moneta selezionata nel flusso ChangeNOW.
---

## Regola

La visualizzazione del saldo nel flusso ChangeNOW deve interrogare il contratto
del token ChangeNOW selezionato, non presupporre che corrisponda al catalogo
standard Li.Fi/portfolio.

**Why:** Alcuni asset condividono simbolo e rete ma non contratto. USDC su Polygon,
per esempio, può riferirsi a una variante diversa nel catalogo ChangeNOW. Riutilizzare
solo il catalogo generico produce saldo assente o sbagliato e rende inaffidabili
le scorciatoie percentuali.

**How to apply:** Quando una view usa un catalogo provider-specifico, passa il
token selezionato alla lettura saldi come token aggiuntivo e usa la chiave della
Map restituita dal reader. I token nativi devono usare l'indirizzo zero condiviso,
non una chiave testuale ad hoc.

## Requisito EVM ChangeNOW

Nel prodotto, il ticker `pol` dello swap EVM deve rappresentare **POL nativo su
Polygon (chainId 137)**. Non sostituirlo con un token ERC-20 Ethereum solo perché
il catalogo di un endpoint partner o un’immagine provider è ambigua.

**Why:** L’app deve seguire la rete/asset selezionati dall’utente e il requisito
di prodotto è il payout nativo Polygon. Una rimappatura automatica su Ethereum
ha creato una voce wallet fuorviante e ha cambiato la destinazione promessa.

**How to apply:** Il flusso EVM deve usare l'API ChangeNOW V2, che separa
`currency` e `network`: per il POL nativo Polygon inviare
`toCurrency=matic` e `toNetwork=matic`, pur mostrando `POL` nel prodotto.
Usa un contract ERC-20 Ethereum solo come importazione manuale separata per
eventuali vecchi payout già ricevuti. Non usare V1 per gli swap EVM, perché il
solo ticker `pol` viene risolto come Ethereum.