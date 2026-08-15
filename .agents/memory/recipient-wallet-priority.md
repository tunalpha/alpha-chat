---
name: Recipient wallet priority — Alpha Wallet first
description: Regola di risoluzione wallet destinatario per payout USDA e MultiChain
---

**Regola:** chi ha Alpha Wallet configurato riceve i fondi lì. Cascata unica: `alpha_wallet_evm_address` → `wallets.usda.address` / `wallets.polygon` / `wallets.ethereum` → `wallet_address` legacy.

**Why:** incidente 2026-08-15 — destinatario con Alpha Wallet riceveva USDT MultiChain sul Trust Wallet legacy: la cascata di release in multichain-payment non includeva affatto `alpha_wallet_evm_address`, e i lazy-resolve USDA usavano solo usda/legacy.

**How to apply:**
- Usare `resolveRecipientEvmWallet()` (chat-payment.service) per ogni nuovo punto di risoluzione EVM; semantica `||` (stringhe vuote = assente), validazione formato con regex `/^0x[0-9a-fA-F]{40}$/` — MAI `isAddress` viem strict: gli indirizzi DB sono lowercase e il checksum li rifiuterebbe.
- I fixture nei test devono usare indirizzi hex validi a 40 char (niente "0xRECIPIENT...").
- Il `recipient_wallet` persistito nel transfer è immutabile per design: nel flusso MultiChain viene risolto solo al release, quindi la priorità Alpha vale per tutti i transfer nuovi.
