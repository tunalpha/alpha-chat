/**
 * polygon.adapter.ts — PolygonAdapter
 *
 * Adapter EVM per Polygon Mainnet (chainId 137).
 *
 * Supporto asset (Phase 2+):
 *   - USDA (ERC-20, 18 decimali) — già su Polygon via sistema USDA esistente
 *   - USDT (ERC-20, 6 decimali)  — nuovo, Phase 2
 *
 * IMPORTANTE: questo adapter NON sostituisce né modifica il sistema USDA
 * esistente (usda-custodial.service.ts). È un adapter SEPARATO per il nuovo
 * Multi-Chain Payment Engine. USDA continua a funzionare autonomamente.
 *
 * Configurazione RPC:
 *   POLYGON_RPC_URL — RPC primario per il Multi-Chain Engine
 *   Se assente, fallback a USDA_POLYGON_RPC (env già esistente)
 *   POLYGON_RPC_FALLBACK_URLS — RPC di fallback (separati da virgola)
 *
 * Confirmations: 5 (sufficiente per Polygon con finalità ~2s/blocco)
 */

import { polygon } from "viem/chains";
import { EvmAdapter } from "./evm-adapter";
import { TOKEN_CONTRACTS, TOKEN_DECIMALS, RPC_CONFIGS } from "../multichain-config";
import { logger } from "../../lib/logger";

export class PolygonAdapter extends EvmAdapter {
  constructor() {
    const rpcConfig = RPC_CONFIGS.polygon;

    if (!rpcConfig.primary) {
      logger.warn(
        "[PolygonAdapter] Nessun RPC configurato (POLYGON_RPC_URL / USDA_POLYGON_RPC). " +
        "Le operazioni on-chain del Multi-Chain Engine non sono disponibili.",
      );
    } else {
      logger.info(
        { fallbacks: rpcConfig.fallbacks.length },
        "[PolygonAdapter] Inizializzato — RPC configurato",
      );
    }

    super({
      networkId:     "polygon",
      chain:         polygon,
      rpcConfig,
      confirmations: 5,
      receiptTimeoutMs: 120_000, // 2 min — Polygon è veloce (~2s/block)
    });
  }

  // ─── Token helpers ──────────────────────────────────────────────────────────

  /** Indirizzo contratto USDA su Polygon */
  get usdaAddress(): string {
    return TOKEN_CONTRACTS.polygon.USDA;
  }

  /** Indirizzo contratto USDT su Polygon */
  get usdtAddress(): string {
    return TOKEN_CONTRACTS.polygon.USDT;
  }

  /** Decimali per un contratto token (lookup per indirizzo lower-case) */
  getTokenDecimals(tokenAddress: string): number {
    return TOKEN_DECIMALS[tokenAddress.toLowerCase()] ?? 18;
  }
}
