---
name: Token logo inline SVG
description: Loghi token EVM/BTC come data URI inline — raw.githubusercontent.com bloccato in produzione
---

## Regola

**MAI usare `raw.githubusercontent.com` per i loghi token.** Questi URL vengono bloccati in produzione (CSP Safari iOS, rate-limit GitHub) e causano cerchi grigi invece dei loghi.

## Soluzione adottata

Tutti i `logoURI` in `artifacts/alpha-chat-web/src/swap/evm/types.ts` sono SVG `data:image/svg+xml,...` inline:
- BTC: arancione #F7931A con simbolo ₿
- ETH: blu #627EEA con diamante Ethereum
- POL: viola #8247E5 con logo Polygon
- BNB: oro #F3BA2F con diamante BNB
- USDT: verde #26A17B con simbolo ₮ (condiviso su ETH/POL/BSC)
- USDC: blu #2775CA con simbolo $ (condiviso su ETH/POL/BSC)

**Why:** raw.githubusercontent.com può essere bloccato da CSP o rate-limit di GitHub in ambienti produzione Safari iOS PWA. I data URI funzionano ovunque, offline, in iframe, senza richieste di rete.

**How to apply:** Ogni nuovo token aggiunto a EVM_SWAP_TOKENS deve avere un `logoURI` come data URI SVG inline, non un URL esterno.
