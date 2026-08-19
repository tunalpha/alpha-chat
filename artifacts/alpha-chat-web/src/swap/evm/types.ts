/**
 * Alpha Swap — EVM Swap Types
 *
 * ISOLAMENTO: zero import da payment engine, USDA, MultiChain, wallet bridge, IDB.
 * Usa copie inline dei token necessari (no dipendenza da token-registry.ts con IDB).
 */

// ── State machine ──────────────────────────────────────────────────────────────

export type EvmSwapPhase =
  | "idle"           // Nessuno swap in corso
  | "quoting"        // Quote in fetching
  | "quoted"         // Quote disponibile, attende conferma
  | "approving"      // Approval ERC-20 in corso
  | "signing"        // Firma transazione / invio BTC al vault in corso
  | "submitted"      // TX inviata alla rete (EVM mempool o BTC broadcast)
  | "pending"        // In attesa di conferma on-chain (EVM) / bridge Thorchain (BTC→EVM)
  | "completed"      // Swap completato
  | "failed"         // Errore definitivo
  | "action_required"; // Azione utente richiesta (es. switch chain manuale)

// ── Token e chain ─────────────────────────────────────────────────────────────

export interface EvmToken {
  chainId:          number;
  /** "native" per token nativi (ETH, POL, BNB), altrimenti contract address 0x... */
  address:          string;
  symbol:           string;
  name:             string;
  decimals:         number;
  logoURI?:         string;
  priceUSD?:        string;
  isNative:         boolean;
}

export interface EvmChainInfo {
  id:            number;
  name:          string;
  shortName:     string;
  nativeSymbol:  string;
  color:         string;
  explorerUrl:   string;
}

// ── Quote ─────────────────────────────────────────────────────────────────────

export interface EvmSwapQuote {
  /** Li.Fi Route (opaque — passato intero a executeRoute) */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  route:            any;
  routeId:          string;
  fromChainId:      number;
  toChainId:        number;
  fromToken:        EvmToken;
  toToken:          EvmToken;
  /** Importo inviato in unità minime (stringa per evitare perdita di precisione) */
  fromAmount:       string;
  /** Stima importo ricevuto */
  toAmount:         string;
  /** Importo minimo garantito (dopo slippage) */
  toAmountMin:      string;
  /** Fee Alpha 0.25% in USD (display only) */
  alphaFeeUSD:      string;
  /** Gas stimato in USD */
  gasCostUSD:       string;
  /** Fee totale in USD (gas + protocollo + Alpha) */
  totalFeeUSD:      string;
  /** Slippage applicato */
  slippage:         number;
  /** Scade a (unix ms) */
  expiresAt:        number;
  /** Tool/bridge usato (es. "across", "stargate", "thorchain") */
  tool:             string;
  /**
   * Importo da inviare calcolato da Li.Fi in unità minime (raw).
   * Presente solo quando la quote è stata ottenuta in exact-output mode (toAmount param).
   * Usato per mostrare in PAGA quanto occorre inviare per ricevere l'importo desiderato.
   */
  computedFromAmount?: string;
  /**
   * Solo per swaps BTC→EVM: indirizzo Bitcoin vault Thorchain a cui inviare i fondi.
   * Estratto da transactionRequest.to della risposta Li.Fi.
   * Usato internamente da useEvmSwapState.execute() per inviare BTC automaticamente
   * tramite sendAlphaWalletBtcTx — non mostrato all'utente.
   */
  btcDepositAddress?: string;
  /** PSBT immutabile emesso da Li.FI per BTC→EVM. Mai ricostruire a mano. */
  btcPsbtHex?: string;
  /** Memo OP_RETURN estratto dal PSBT Li.FI e verificato prima della firma. */
  btcMemo?: string;
}

// ── Active swap (per recovery localStorage) ───────────────────────────────────

export interface EvmActiveSwap {
  routeId:      string;
  txHash?:      string;
  fromChainId:  number;
  toChainId:    number;
  fromToken:    EvmToken;
  toToken:      EvmToken;
  fromAmount:   string;
  toAmount:     string;
  startedAt:    number;
  // ── Audit trail — non necessari per il funzionamento, servono per ricostruire incidenti ──
  /** Vault Thorchain/bridge a cui è stato inviato il BTC (da transactionRequest.to della quote). */
  btcDepositAddress?: string;
  /** Indirizzo EVM destinatario finale (0x...) — per verificare che i fondi arrivino al posto giusto. */
  toAddress?: string;
  /** Memo OP_RETURN della quote Li.FI, mantenuto solo come audit trail del deposito BTC. */
  btcMemo?: string;
  /** SHA-256 del PSBT Li.FI originale; il PSBT non viene mai salvato nel journal. */
  btcPsbtDigest?: string;
}

// ── Error ─────────────────────────────────────────────────────────────────────

export interface EvmSwapError {
  code:    string;
  message: string;
}

// ── State value ───────────────────────────────────────────────────────────────

export interface EvmSwapStateValue {
  phase:       EvmSwapPhase;
  fromChainId: number;
  toChainId:   number;
  fromToken:   EvmToken | null;
  toToken:     EvmToken | null;
  fromAmount:  string;         // stringa dell'input utente (es. "10.5")
  quote:       EvmSwapQuote | null;
  error:       EvmSwapError | null;
  txHash:      string | null;
  recovering:  boolean;
}

// ── Actions ───────────────────────────────────────────────────────────────────

export interface EvmSwapActions {
  setFromChain:  (chainId: number) => void;
  setToChain:    (chainId: number) => void;
  setFromToken:  (token: EvmToken) => void;
  setToToken:    (token: EvmToken) => void;
  setFromAmount: (amount: string) => void;
  swapDirection: () => void;
  fetchQuote:    () => Promise<void>;
  /** Calcola la quote a partire dall'importo DESIDERATO in output (exact-output mode). */
  fetchQuoteExactOut: (toAmountHuman: string) => Promise<void>;
  execute:       () => Promise<void>;
  reset:         () => void;
}

// ── Constants ─────────────────────────────────────────────────────────────────

export const LIFI_INTEGRATOR   = "alpha-chat"  as const;
export const LIFI_FEE          = 0.0025         as const;  // 25 bps
export const LIFI_SLIPPAGE     = 0.005          as const;  // 0.5%
export const QUOTE_VALIDITY_MS = 60_000         as const;  // 60s
export const EVM_SWAP_ACTIVE_KEY = "aw_evm_swap_active" as const;
export const EVM_SWAP_IKEY       = "aw_evm_swap_ikey"   as const;

/** Li.Fi chain ID per Bitcoin (non-EVM) */
export const BTC_CHAIN_ID       = 20000000000001 as const;
/** Li.Fi token address per Bitcoin native */
export const BTC_NATIVE_ADDRESS = "bitcoin"       as const;

/** Restituisce true se la chain è Bitcoin (non-EVM) */
export function isBtcChain(chainId: number): boolean {
  return chainId === BTC_CHAIN_ID;
}

// ── Supported chains ──────────────────────────────────────────────────────────

export const EVM_SWAP_CHAINS: EvmChainInfo[] = [
  { id: 137,           name: "Polygon",         shortName: "POL", nativeSymbol: "POL", color: "#8247E5", explorerUrl: "https://polygonscan.com" },
  { id: 56,            name: "BNB Smart Chain",  shortName: "BSC", nativeSymbol: "BNB", color: "#F3BA2F", explorerUrl: "https://bscscan.com" },
  { id: 1,             name: "Ethereum",         shortName: "ETH", nativeSymbol: "ETH", color: "#627EEA", explorerUrl: "https://etherscan.io" },
  { id: BTC_CHAIN_ID,  name: "Bitcoin",          shortName: "BTC", nativeSymbol: "BTC", color: "#F7931A", explorerUrl: "https://mempool.space" },
];

// ── Token list (inline, senza dipendenze IDB) ─────────────────────────────────

/** Token nativi EVM (address zero) */
export const NATIVE_ADDRESS = "0x0000000000000000000000000000000000000000";

// ── Logo locali — stessi file usati da CoinIcon nel Portfolio (zero CDN esterni)
export const BTC_LOGO_URI = "/coin-icons/btc.png";
const _ETH_LOGO  = "/coin-icons/eth.png";
const _POL_LOGO  = "/coin-icons/pol.png";
const _BNB_LOGO  = "/coin-icons/bnb.png";
const _USDT_LOGO = "/coin-icons/usdt.png";
const _USDC_LOGO = "/coin-icons/usdc.png";

export const EVM_SWAP_TOKENS: EvmToken[] = [
  // Bitcoin (BTC_CHAIN_ID) — cross-chain via Li.Fi/Thorchain
  { chainId: BTC_CHAIN_ID, address: BTC_NATIVE_ADDRESS,                           symbol: "BTC",  name: "Bitcoin",     decimals: 8,  isNative: true,  logoURI: BTC_LOGO_URI },
  // Ethereum (1)
  { chainId: 1,   address: NATIVE_ADDRESS,                               symbol: "ETH",  name: "Ether",       decimals: 18, isNative: true,  logoURI: _ETH_LOGO  },
  { chainId: 1,   address: "0xdAC17F958D2ee523a2206206994597C13D831ec7", symbol: "USDT", name: "Tether USD",   decimals: 6,  isNative: false, logoURI: _USDT_LOGO },
  { chainId: 1,   address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", symbol: "USDC", name: "USD Coin",     decimals: 6,  isNative: false, logoURI: _USDC_LOGO },
  // Polygon (137)
  { chainId: 137, address: NATIVE_ADDRESS,                               symbol: "POL",  name: "POL",          decimals: 18, isNative: true,  logoURI: _POL_LOGO  },
  { chainId: 137, address: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F", symbol: "USDT", name: "Tether USD",   decimals: 6,  isNative: false, logoURI: _USDT_LOGO },
  { chainId: 137, address: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", symbol: "USDC", name: "USD Coin",     decimals: 6,  isNative: false, logoURI: _USDC_LOGO },
  // BSC (56) — ⚠️ USDT e USDC su BSC hanno 18 decimali
  { chainId: 56,  address: NATIVE_ADDRESS,                               symbol: "BNB",  name: "BNB",          decimals: 18, isNative: true,  logoURI: _BNB_LOGO  },
  { chainId: 56,  address: "0x55d398326f99059fF775485246999027B3197955", symbol: "USDT", name: "Tether USD",   decimals: 18, isNative: false, logoURI: _USDT_LOGO },
  { chainId: 56,  address: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", symbol: "USDC", name: "USD Coin",     decimals: 18, isNative: false, logoURI: _USDC_LOGO },
];

export function getTokensForChain(chainId: number): EvmToken[] {
  return EVM_SWAP_TOKENS.filter(t => t.chainId === chainId);
}

export function getDefaultFromToken(chainId: number): EvmToken {
  return getTokensForChain(chainId)[0]!;
}

export function getChainInfo(chainId: number): EvmChainInfo | undefined {
  return EVM_SWAP_CHAINS.find(c => c.id === chainId);
}

/** Indirizzo da passare a Li.Fi: BTC → "bitcoin", native EVM → "0x0000...", altrimenti address contratto */
export function tokenAddressForLiFi(token: EvmToken): string {
  if (isBtcChain(token.chainId)) return BTC_NATIVE_ADDRESS;
  return token.isNative ? NATIVE_ADDRESS : token.address;
}

/** Converti importo human-readable in unità minime (stringa) */
export function toTokenUnits(humanAmount: string, decimals: number): string {
  if (!humanAmount || isNaN(Number(humanAmount))) return "0";
  const [int, dec = ""] = humanAmount.split(".");
  const padded = dec.padEnd(decimals, "0").slice(0, decimals);
  const units = BigInt(int || "0") * BigInt(10 ** decimals) + BigInt(padded || "0");
  return units.toString();
}

/** Converti unità minime in human-readable */
export function fromTokenUnits(rawAmount: string, decimals: number): string {
  if (!rawAmount || rawAmount === "0") return "0";
  const raw = BigInt(rawAmount);
  const divisor = BigInt(10 ** decimals);
  const int = raw / divisor;
  const rem = raw % divisor;
  if (rem === 0n) return int.toString();
  const decStr = rem.toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${int}.${decStr}`;
}
