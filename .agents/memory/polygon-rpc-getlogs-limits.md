---
name: Polygon RPC — limiti getLogs e detect depositi
description: Perché il backend non deve mai usare eth_getLogs per scansioni storiche e come fare detect depositi
---

**Regola:** mai usare `eth_getLogs` su range storici da backend con RPC gratuiti. Tutti i free tier lo bloccano: publicnode ("Archive requests require a personal token"), Alchemy free (max 10 blocchi), dRPC (rifiuta anche range piccoli), ankr/polygon-rpc (chiave richiesta).

**Come fare invece:**
- Scansione depositi verso un indirizzo: `alchemy_getAssetTransfers` (enhanced API, free tier, range illimitato) con `withMetadata:true`, `order:"desc"`, filtro `metadata.blockTimestamp >= createdAt - 5min` E `rawContract.value >= amount`.
- Verifica di una tx nota: `eth_getTransactionReceipt` + ispezione `receipt.logs` (funziona ovunque, non è archive).

**Why (incidente lug 2026):** detectDeposit stimava fromBlock con block time 2500ms; Polygon reale ~1,5s/blocco → fromBlock cadeva DOPO il blocco del deposito → depositi reali mai rilevati ("Deposito non ancora rilevato" su fondi già in escrow). Mai stimare block range dal block time; filtrare per timestamp del blocco.

**How to apply:** qualsiasi nuova feature di chain-scanning in api-server deve usare alchemy_getAssetTransfers o receipt-by-hash, mai getLogs a range.
