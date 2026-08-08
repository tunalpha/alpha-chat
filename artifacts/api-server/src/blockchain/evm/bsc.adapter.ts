/**
 * bsc.adapter.ts — BscAdapter (Phase 5 placeholder)
 *
 * Adapter EVM per BNB Smart Chain (chainId 56).
 * Asset supportato: USDT BEP-20 (18 decimali — diverso da ETH/Polygon USDT).
 *
 * STATO: Phase 5 — struttura pronta, implementazione attiva quando
 * ENABLE_BSC_USDT=true.
 *
 * Nota gas: BSC usa BNB come gas token. Il gas station BSC (se necessario)
 * dovrà garantire BNB sufficiente ai wallet escrow.
 *
 * Confirmations: 15 (BSC ~3s/block)
 */

import { bsc } from "viem/chains";
import { EvmAdapter } from "./evm-adapter";
import { TOKEN_CONTRACTS, TOKEN_DECIMALS, RPC_CONFIGS } from "../multichain-config";
import { logger } from "../../lib/logger";

export class BscAdapter extends EvmAdapter {
  constructor() {
    const rpcConfig = RPC_CONFIGS.bsc;

    if (!rpcConfig.primary) {
      logger.warn(
        "[BscAdapter] Nessun RPC configurato (BSC_RPC_URL). " +
        "Configurare prima di abilitare ENABLE_BSC_USDT.",
      );
    }

    super({
      networkId:        "bsc",
      chain:            bsc,
      rpcConfig,
      confirmations:    15,
      receiptTimeoutMs: 120_000, // 2 min — BSC ~3s/block
    });
  }

  /** USDT BEP-20 su BSC (18 decimali) */
  get usdtAddress(): string {
    return TOKEN_CONTRACTS.bsc.USDT;
  }

  getTokenDecimals(tokenAddress: string): number {
    // BSC-Peg USDT usa 18 decimali (diverso da standard USDT a 6 dec)
    return TOKEN_DECIMALS[tokenAddress.toLowerCase()] ?? 18;
  }
}
