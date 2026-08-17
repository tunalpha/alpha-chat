---
name: Token logo source — Swap view
description: I logoURI nei token EVM Swap devono usare i file locali /coin-icons/*.png, non CDN esterni
---

## Regola

**I `logoURI` in `EVM_SWAP_TOKENS` (artifacts/alpha-chat-web/src/swap/evm/types.ts) devono puntare ai file locali `/coin-icons/*.png`**, non a URL CDN esterni (TrustWallet GitHub raw, CoinGecko, ecc.).

## File locali disponibili

`/coin-icons/btc.png`, `eth.png`, `pol.png`, `bnb.png`, `usdt.png`, `usdc.png`

Sono serviti da `artifacts/alpha-chat-web/public/coin-icons/` — stesso origin, zero blocchi CSP/CDN.

## Perché

- `raw.githubusercontent.com` viene bloccato da Safari iOS in produzione (rate-limit GitHub + CSP)
- Il componente `CoinIcon` nel Portfolio usa già questi file locali e funziona correttamente
- SVG inline `data:` URI funzionano tecnicamente ma producono loghi visivamente diversi da quelli del Portfolio, confondendo l'utente

**How to apply:** Ogni nuovo token aggiunto a `EVM_SWAP_TOKENS` deve usare un path `/coin-icons/<symbol>.png`. Se il file non esiste, aggiungere il PNG in `public/coin-icons/` e aggiornare anche `COIN_LOGOS` in `CoinIcon.tsx`.
