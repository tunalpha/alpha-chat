---
name: USDA Sprint Finale — ThirdWeb + Blockchain Verification
description: Signing reale ERC-20 via ThirdWeb v5, verifica blockchain on-chain, mock eliminati, env vars configurate
---

## Cosa è stato fatto

**Sprint Finale USDA** — sostituisce ogni mock con produzione reale.

### Mock eliminati
- `_simulateTxHash()` in `http-usda.adapter.ts` — **rimosso**
- `mockSignature` — **rimosso**
- Delay simulato — **rimosso**

### ThirdWeb v5 integrazione
- `lib/thirdweb-client.ts` — client, `polygonMainnet` con RPC pubblico, costanti USDA
- `main.tsx` — `ThirdwebProvider` globale
- `SendUsdaSheet.tsx` — `useActiveAccount`, `useActiveWalletChain`, `useSwitchActiveWalletChain`, `ConnectButton`, `sendAndConfirmTransaction`
- Wallet supportati: MetaMask, WalletConnect, Coinbase, Rainbow, Trust

### Flusso produzione
```
prepare → ConnectButton → network guard (137) → sendAndConfirmTransaction → txHash
  → verifyUsdaTx (backend) → POST /api/pay/confirm → polling → WS update
```

### Verifica blockchain (backend — polygon-rpc.ts → verifyUsdaTx)
- chainId = 137
- receipt.status = "0x1"
- receipt.to = USDA contract address
- Transfer event presente (topic0 = keccak256("Transfer(address,address,uint256)"))
- Transfer.from = senderAddress (wallet mittente)
- Transfer.to = recipientAddress (destinatario)
- Transfer.value >= amountUnits (importo sufficiente)
- Retry receipt × 8 con 4s tra tentativi
- Chiamato PRIMA di POST /api/pay/confirm — nessun confirm senza verifica valida

### Network guard
- activeChain.id === 137 — guard in handleSign()
- Bottone "Passa a Polygon" → useSwitchActiveWalletChain(polygonMainnet)

### Error handling in handleSign
- User rejection → rimane su confirm (prepared intatto), non resetta a form
- Gas insufficiente → messaggio MATIC dedicato
- Wallet bloccato → messaggio dedicato
- Rete errata → redirect a "Passa a Polygon"
- Timeout 90s → reset a form

### Env vars configurate
- `VITE_THIRDWEB_CLIENT_ID` — impostata (shared) ✅
- `USDA_API_BASE_URL` = https://getusda.xyz
- `USDA_CONTRACT_ADDRESS` = 0xe714655fD1B3ba96B887DF1F94336c2A78E24001
- `USDA_CHAIN_ID` = 137

**Why:** ThirdWeb v5 usa ESM, non richiede config Vite speciale; polygonMainnet definito con RPC pubblico per non dipendere da infrastruttura ThirdWeb per read-only calls.

**How to apply:** Se cambia contratto USDA → aggiorna USDA_CONTRACT_ADDRESS env + costante in thirdweb-client.ts. Se decimali ≠ 6 → aggiornare USDA_DECIMALS in polygon-rpc.ts.
