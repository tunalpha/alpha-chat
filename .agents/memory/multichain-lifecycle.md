---
name: Multi-Chain Payment Lifecycle Alignment
description: Allineamento lifecycle Multi-Chain al flusso USDA — eventi WS, detect dalla bolla, handler ChatPage.
---

## Regola

Il lifecycle Multi-Chain è ora architetturalmente identico al flusso USDA:

```
Crea richiesta
  → mc_payment bubble in chat (message_type="mc_payment", is_request=true)
  → status: awaiting_deposit
  → Bolla chiama apiMCDetect ogni 30s (non apiMCGet!) mentre awaiting_deposit
  → Backend emette mc_payment.state_changed via WS su ogni cambio stato
  → ChatPage.tsx aggiorna system_metadata bolla in-place (stessa pattern payment.state_changed)
  → Dopo release: tx_hash_release visibile → explorer link cliccabile
```

## Punti di emissione WS (multichain-events.ts)

`emitMCPaymentStateChanged(doc)` chiamato in:
- `detectMultiChainDeposit`: awaiting_deposit → pending
- `_releaseEvm`: releasing → released
- `_releaseBitcoin`: → released  
- `_doRefund` (entrambi i path): → refunded
- `_transitionToWaitingForGas`: releasing → waiting_for_gas

## Feature flag critico

`ENABLE_BITCOIN_BTC` non impostato in dev → detect BTC fallisce con ADAPTER_NOT_FOUND.
In produzione va impostato `ENABLE_BITCOIN_BTC=true`.

Polygon/ETH/BSC funzionano in dev (flag impostati).

## Differenza rispetto a USDA

La sola differenza sono i provider blockchain (Polygon/ETH/BSC ERC20 via Alchemy,
BTC UTXO via Blockstream). Architettura eventi/polling/WS/query identica.

**Why:** L'utente ha richiesto esplicitamente che MC riusi la stessa architettura USDA.

## Explorer URLs (MultiChainPaymentBubble.tsx)

- Polygon: https://polygonscan.com/tx/{hash}
- Ethereum: https://etherscan.io/tx/{hash}
- BSC: https://bscscan.com/tx/{hash}
- Bitcoin: https://blockstream.info/tx/{hash}

## Test runtime verificato

- mc_payment messages in DB con message_id linkato al transfer ✓
- BTC fee floor 546 sat ✓
- Polygon USDT recipient_exact invariant net+fee===gross ✓
- emitMCPaymentStateChanged compilato in dist (9 match) ✓
