---
name: Li.Fi integrator registration status
description: Stato registrazione integrator Li.Fi per Alpha Swap EVM — BLOCCATO in attesa di registrazione manuale
---

## Stato

**Integrator `alphachat`: NON REGISTRATO su Li.Fi (verificato 2026-08-16)**

Chiamata API reale `GET https://li.quest/v1/quote?integrator=alphachat&fee=0.0025...`
→ HTTP 400, code 1011: "Integrator 'alphachat' is not configured for collecting fees."

## Cosa manca

1. Registrazione manuale su https://portal.li.fi/
2. Configurazione fee wallet per chain:
   - Polygon (137) → `POLYGON_FEE_WALLET` (secret Replit)
   - BSC (56) → `BSC_FEE_WALLET` (secret Replit)
   - Ethereum (1) → `ETHEREUM_FEE_WALLET` (secret Replit)
3. Fee = 0.25% = 0.0025
4. Conferma ID integrator finale (potrebbe essere diverso da `alphachat`)

## Regola (permanente)

**NON implementare fee Li.Fi nel codice finché una chiamata API reale non dimostra che:**
- integrator è riconosciuto (HTTP 200 con fee nei feeCosts)
- fee 0.25% è raccolta
- fee wallet è configurato per tutte e 3 le chain

**Why:** Li.Fi rifiuta con HTTP 400 il parametro `fee` se l'integrator non è registrato — non è solo "non raccolta", è errore bloccante che impedisce di ottenere qualsiasi quote.

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
