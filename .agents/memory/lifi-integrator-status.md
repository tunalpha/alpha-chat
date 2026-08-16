---
name: Li.Fi integrator registration status
description: Stato registrazione integrator Li.Fi per Alpha Swap EVM — BLOCCATO in attesa di registrazione manuale
---

## Stato — CONFIGURAZIONE COMPLETATA (verificata 2026-08-16)

**Integrator `alpha-chat`: ATTIVO e VERIFICATO via API reale**

- HTTP 200 con `fee=0.0025` su Polygon same-chain e BSC→Polygon cross-chain
- Fee split: Li.Fi 0.25% + alpha-chat 0.25% = 0.50% totale ✅
- `wallet=undefined` nella risposta è CORRETTO — Fee Forwarder model (apr 2026): fee va direttamente al withdrawal address senza accumulo nel contratto
- ID integrator: `alpha-chat` (con trattino)
- API Key portale (UUID): trattare come SEGRETO — non mettere nel codice frontend

## Fee wallet — risultato confronto (2026-08-16)

`ETHEREUM_FEE_WALLET` = `POLYGON_FEE_WALLET` = `BSC_FEE_WALLET` → **stesso indirizzo EVM** (confermato via confronto sicuro senza esporre valori)

Li.Fi usa un unico wallet EVM — coincide perfettamente con la struttura Alpha esistente.

## Fee wallet — risultato confronto (2026-08-16)

`ETHEREUM_FEE_WALLET` = `POLYGON_FEE_WALLET` = `BSC_FEE_WALLET` → **stesso indirizzo EVM**

Inserire quell'unico indirizzo nel portale Li.Fi per la famiglia EVM. Nessun nuovo wallet, nessuna modifica ai segreti Replit.

## Come verificare dopo registrazione

```javascript
// Test da CodeExecution (sandbox):
const r = await fetch("https://li.quest/v1/quote?fromChain=137&toChain=137&fromToken=0xc2132D05D31c914a87C6611C10748AEb04B58e8F&toToken=0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359&fromAmount=10000000&fromAddress=0x0000000000000000000000000000000000000001&integrator=<ID>&fee=0.0025&slippage=0.005");
// Deve essere HTTP 200 con feeCosts contenente voce integrator
```

## Architettura decisa (non implementata)

- Modulo EVM completamente separato da BTC/Lightning: `src/swap/evm/`
- Stack firma: ThirdWeb v5 + `viemAdapter.walletClient.toViem()` + Li.Fi SDK
- Recovery: localStorage `aw_evm_swap_active`
- Lock anti-double-click: `_evmSwapExecuting` module-level
- Chain: Ethereum 1, Polygon 137, BSC 56 (già in `evm-network-config.ts`)
