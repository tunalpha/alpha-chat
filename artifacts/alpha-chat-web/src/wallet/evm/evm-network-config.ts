/**
 * Alpha Wallet — EVM Network Registry
 *
 * Fonte di verità per tutte le reti EVM supportate.
 * Per aggiungere una nuova rete: aggiungere un'entry qui.
 * Non richede modifiche al wallet core.
 *
 * ISOLAMENTO: questo file non importa nulla dal Payment Engine esistente.
 */

export interface EvmNetwork {
  /** ChainId EIP-155 */
  chainId: number;
  /** Nome completo */
  name: string;
  /** Abbreviazione UI */
  shortName: string;
  /** Simbolo del token nativo */
  nativeSymbol: string;
  /** Nome del token nativo */
  nativeName: string;
  /** Block explorer base URL */
  explorerUrl: string;
  /** URL per tx: explorerUrl + txPath + hash */
  txPath: string;
  /** URL per address: explorerUrl + addressPath + address */
  addressPath: string;
  /** Colore tema rete (per UI badge) */
  color: string;
  /** CoinGecko ID del token nativo (per price feed) */
  coingeckoId: string;
}

export const EVM_NETWORKS: Record<string, EvmNetwork> = {
  ethereum: {
    chainId: 1,
    name: "Ethereum",
    shortName: "ETH",
    nativeSymbol: "ETH",
    nativeName: "Ether",
    explorerUrl: "https://etherscan.io",
    txPath: "/tx/",
    addressPath: "/address/",
    color: "#627EEA",
    coingeckoId: "ethereum",
  },

  polygon: {
    chainId: 137,
    name: "Polygon",
    shortName: "POL",
    nativeSymbol: "POL",
    nativeName: "POL",
    explorerUrl: "https://polygonscan.com",
    txPath: "/tx/",
    addressPath: "/address/",
    color: "#8247E5",
    coingeckoId: "matic-network",
  },

  bsc: {
    chainId: 56,
    name: "BNB Smart Chain",
    shortName: "BSC",
    nativeSymbol: "BNB",
    nativeName: "BNB",
    explorerUrl: "https://bscscan.com",
    txPath: "/tx/",
    addressPath: "/address/",
    color: "#F3BA2F",
    coingeckoId: "binancecoin",
  },
} as const;

/** Tutte le reti disponibili come array */
export const ALL_EVM_NETWORKS = Object.values(EVM_NETWORKS);

/** Cerca una rete per chainId */
export function getNetworkByChainId(chainId: number): EvmNetwork | undefined {
  return ALL_EVM_NETWORKS.find(n => n.chainId === chainId);
}

/** Cerca una rete per nome chiave (es. "polygon") */
export function getNetworkByKey(key: string): EvmNetwork | undefined {
  return EVM_NETWORKS[key.toLowerCase()];
}

/** URL dell'explorer per una transazione */
export function txExplorerUrl(chainId: number, txHash: string): string {
  const net = getNetworkByChainId(chainId);
  if (!net) return "#";
  return `${net.explorerUrl}${net.txPath}${txHash}`;
}

/** URL dell'explorer per un address */
export function addressExplorerUrl(chainId: number, address: string): string {
  const net = getNetworkByChainId(chainId);
  if (!net) return "#";
  return `${net.explorerUrl}${net.addressPath}${address}`;
}

/** ChainId supportati */
export const SUPPORTED_CHAIN_IDS = ALL_EVM_NETWORKS.map(n => n.chainId);

/** True se il chainId è supportato */
export function isSupportedChain(chainId: number): boolean {
  return SUPPORTED_CHAIN_IDS.includes(chainId);
}
