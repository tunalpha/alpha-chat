/**
 * Alpha Swap module — barrel export
 *
 * ISOLAMENTO: tutto il codice swap è confinato in src/swap/.
 * Gli import esterni (AlphaWalletPage) usano SOLO questo barrel.
 */

export { SwapView }    from "./SwapView.js";
export { SwapHistory } from "./SwapHistory.js";
export type { SwapDirection, SwapPublicConfig, SwapState, SwapQuote, SwapHistoryItem } from "./types.js";
