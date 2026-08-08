/**
 * ethereum.adapter.ts — EthereumAdapter (Phase 4 placeholder)
 *
 * Adapter EVM per Ethereum Mainnet (chainId 1).
 * Asset supportato: USDT ERC-20 (6 decimali).
 *
 * STATO: Phase 4 — struttura pronta, implementazione attiva quando
 * ENABLE_ETHEREUM_USDT=true.
 *
 * Confirmations: 12 (standard Ethereum ~2 min)
 */

import { mainnet } from "viem/chains";
import { EvmAdapter } from "./evm-adapter";
import { TOKEN_CONTRACTS, TOKEN_DECIMALS, RPC_CONFIGS } from "../multichain-config";
import { logger } from "../../lib/logger";

export class EthereumAdapter extends EvmAdapter {
  constructor() {
    const rpcConfig = RPC_CONFIGS.ethereum;

    if (!rpcConfig.primary) {
      logger.warn(
        "[EthereumAdapter] Nessun RPC configurato (ETHEREUM_RPC_URL). " +
        "Configurare prima di abilitare ENABLE_ETHEREUM_USDT.",
      );
    }

    super({
      networkId:        "ethereum",
      chain:            mainnet,
      rpcConfig,
      confirmations:    12,
      receiptTimeoutMs: 300_000, // 5 min — Ethereum ~12s/block
    });
  }

  get usdtAddress(): string {
    return TOKEN_CONTRACTS.ethereum.USDT;
  }

  getTokenDecimals(tokenAddress: string): number {
    return TOKEN_DECIMALS[tokenAddress.toLowerCase()] ?? 6;
  }
}
