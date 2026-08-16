---
name: Alpha Swap CSS + vitest timeout
description: asw-* design system, SwapView/EvmSwapView rewrite, vitest testTimeout bump
---

## Regola

1. **asw- prefix** — tutte le classi CSS del modulo Alpha Swap usano il prefisso `asw-` definito in `AlphaWalletPage.css`. Zero Tailwind utility classes in SwapView, EvmSwapView, TokenSelector.

2. **vitest testTimeout** — il barrel `swap/index.ts` importa ThirdWeb + @lifi/sdk (mock ESM). L'import dinamico nel test di isolamento richiedeva >5000ms su file più grandi. Soluzione: `testTimeout: 15000` e `hookTimeout: 15000` in `vitest.config.ts`. NON alzare di più senza giustificazione.

**Why:** Il timeout default di 5000ms era sufficiente per la vecchia SwapView (993 righe). Dopo il redesign con asw-*, SwapView + EvmSwapView + TokenSelector hanno più codice da parsare in vitest happy-dom → import lento.

**How to apply:** Ogni volta che si riscrivono componenti swap che usano ThirdWeb/LiFi, verificare che il test di isolamento non timeout. Se timeout ≥ 5s → non toccare i mock, alzare il timeout globale nel config.

3. **CHAIN_RPC in EvmSwapView** — `import.meta.env.VITE_POLYGON_RPC` si legge come `((import.meta as any).env?.VITE_POLYGON_RPC)` per compatibilità TypeScript strict. Fallback hardcoded: `"https://polygon-rpc.com"`.

4. **Chain auto-sync** — `useEvmSwapState.ts` ha un `useEffect([activeChain?.id])` che aggiorna `fromChainId/fromToken/toChainId/toToken` quando la chain connessa cambia. Guard: non interrompe swap in corso (`phase !== "idle" && phase !== "quoted"`).

5. **Auto-tab detection** — `SwapView.tsx` usa `useRef(didAutoSelect)` + `useEffect([activeAccount?.address])` per switchare una sola volta su EVM tab se il wallet è già connesso al mount. Non auto-switcha su disconnect.
