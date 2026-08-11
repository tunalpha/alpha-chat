/**
 * Alpha Wallet — Balance Service (Phase C)
 *
 * Fetches on-chain balances via backend proxy.
 * SICUREZZA: il backend riceve solo address pubblici.
 * La private key rimane esclusivamente locale.
 */

import {
  apiWalletGetEvmBalance,
  apiWalletGetBtcBalance,
  type EvmBalanceResponse,
  type BtcBalanceResponse,
} from "../../lib/alpha-wallet-api";
import { getVerifiedTokens } from "../evm/token-registry";
import { formatCrypto } from "./price-service";

// ─── Tipi pubblici ─────────────────────────────────────────────────────────

export interface TokenBalance {
  symbol:          string;
  name:            string;
  /** Raw on-chain value (in smallest unit, e.g. wei) */
  rawBalance:      bigint;
  decimals:        number;
  contractAddress?: string;
  /** Human-readable amount: "1.2345 USDT" */
  formatted:       string;
  /** True = verified by Alpha Wallet token registry */
  isVerified:      boolean;
}

export interface ChainBalance {
  chainId:   number;
  /** Native token (ETH, POL, BNB) */
  native:    TokenBalance;
  /** ERC-20 tokens (verified from registry) */
  tokens:    TokenBalance[];
  fetchedAt: number;
}

export interface BtcBalance {
  /** Confirmed balance in satoshi */
  confirmedSat:    bigint;
  /** Including mempool delta */
  totalSat:        bigint;
  /** Human-readable "0.00123456 BTC" */
  formatted:       string;
  txCount:         number;
  fetchedAt:       number;
}

// ─── EVM Balance ───────────────────────────────────────────────────────────

export async function fetchEvmBalance(
  chainId:  number,
  address:  `0x${string}`,
): Promise<ChainBalance> {
  const resp: EvmBalanceResponse = await apiWalletGetEvmBalance(chainId, address);
  const verifiedTokens = getVerifiedTokens(chainId);

  const native: TokenBalance = {
    symbol:    resp.native.symbol,
    name:      resp.native.name,
    rawBalance: BigInt(resp.native.balance),
    decimals:  resp.native.decimals,
    formatted: formatCrypto(BigInt(resp.native.balance), resp.native.decimals, resp.native.symbol),
    isVerified: true, // native tokens are always verified
  };

  const tokens: TokenBalance[] = resp.tokens.map(t => {
    const isVerified = verifiedTokens.some(
      vt => vt.contractAddress?.toLowerCase() === t.contractAddress?.toLowerCase()
    );
    return {
      symbol:          t.symbol,
      name:            t.name,
      rawBalance:       BigInt(t.balance),
      decimals:        t.decimals,
      contractAddress: t.contractAddress,
      formatted:       formatCrypto(BigInt(t.balance), t.decimals, t.symbol),
      isVerified,
    };
  });

  return { chainId, native, tokens, fetchedAt: Date.now() };
}

// ─── BTC Balance ───────────────────────────────────────────────────────────

export async function fetchBtcBalance(address: string): Promise<BtcBalance> {
  const resp: BtcBalanceResponse = await apiWalletGetBtcBalance(address);
  const confirmedSat = BigInt(resp.confirmedSat);
  const totalSat     = BigInt(resp.totalSat);
  const btcValue     = Number(confirmedSat) / 1e8;

  return {
    confirmedSat,
    totalSat,
    formatted:  `${btcValue.toFixed(8)} BTC`,
    txCount:    resp.txCount,
    fetchedAt:  Date.now(),
  };
}

// ─── Total portfolio value ─────────────────────────────────────────────────

import type { AssetPrices } from "./price-service";

/**
 * Calculates total portfolio value across all balances.
 * Returns null if prices are not available.
 */
export function calcPortfolioValue(
  evmBalances: ChainBalance[],
  btcBalance:  BtcBalance | null,
  prices:      AssetPrices | null,
  currency:    "USD" | "EUR",
): number | null {
  if (!prices) return null;

  let total = 0;
  const cur = currency.toLowerCase() as "usd" | "eur";

  for (const chain of evmBalances) {
    // Native
    const nativeSymbol = chain.native.symbol.toLowerCase() as keyof AssetPrices;
    const nativePrice  = (prices[nativeSymbol] as { usd: number; eur: number } | undefined)?.[cur] ?? 0;
    total += (Number(chain.native.rawBalance) / 10 ** chain.native.decimals) * nativePrice;

    // ERC-20
    for (const t of chain.tokens) {
      const sym = t.symbol.toLowerCase() as keyof AssetPrices;
      const p   = (prices[sym] as { usd: number; eur: number } | undefined)?.[cur] ?? 0;
      total += (Number(t.rawBalance) / 10 ** t.decimals) * p;
    }
  }

  // BTC
  if (btcBalance) {
    total += (Number(btcBalance.confirmedSat) / 1e8) * (prices.btc[cur] ?? 0);
  }

  return total;
}
