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

## Mappatura rete provider

Il ticker ChangeNOW `pol` identifica il token POL ERC-20 su Ethereum
(`0x455e53cbb86018ac2b8092fdcd39d8444affc3f6`), non il POL nativo su Polygon.

**Why:** Il simbolo POL esiste su entrambe le reti. Trattare il payout provider
come asset Polygon nasconde un saldo reale sul wallet Ethereum e presenta una
destinazione di swap fuorviante.

**How to apply:** Conservare la semantica provider-specifica nel catalogo
ChangeNOW e registrare il contratto in entrambi i registry wallet per renderlo
leggibile e trasferibile. Non cambiare il POL nativo Polygon, che resta un
asset distinto.