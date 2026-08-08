/**
 * adapter-registry.ts — Registry degli adapter blockchain
 *
 * Punto di accesso centralizzato per tutti gli adapter.
 * Il PaymentService richiede un adapter per networkId senza conoscere
 * i dettagli di implementazione.
 *
 * Singleton lazy: gli adapter vengono creati alla prima richiesta,
 * non all'avvio del server.
 *
 * USDA esistente NON usa questo registry — continua a usare
 * usda-custodial.service.ts direttamente. (zero regressioni)
 */

import { multichainError } from "./errors";
import type { BlockchainAdapter, NetworkId } from "./adapter.interface";
import { FEATURE_FLAGS } from "./multichain-config";
import { logger } from "../lib/logger";

// ─── Registry ─────────────────────────────────────────────────────────────────

class AdapterRegistry {
  private readonly adapters = new Map<NetworkId, BlockchainAdapter>();
  private readonly factories = new Map<NetworkId, () => BlockchainAdapter>();

  /** Registra una factory lazy per una rete */
  register(networkId: NetworkId, factory: () => BlockchainAdapter): void {
    this.factories.set(networkId, factory);
  }

  /**
   * Restituisce l'adapter per una rete.
   * Crea l'adapter alla prima chiamata (lazy singleton).
   *
   * @throws AppError(FEATURE_DISABLED) se la rete non è abilitata
   * @throws AppError(ADAPTER_NOT_FOUND) se nessun adapter registrato
   */
  get(networkId: NetworkId): BlockchainAdapter {
    // Verifica feature flag (solo per le nuove reti — non per USDA esistente)
    if (!this._isEnabled(networkId)) {
      throw multichainError("FEATURE_DISABLED", { networkId });
    }

    // Singleton lazy
    const existing = this.adapters.get(networkId);
    if (existing) return existing;

    const factory = this.factories.get(networkId);
    if (!factory) {
      throw multichainError("ADAPTER_NOT_FOUND", { networkId });
    }

    const adapter = factory();
    this.adapters.set(networkId, adapter);

    logger.info({ networkId }, "[AdapterRegistry] Adapter inizializzato");
    return adapter;
  }

  /** Lista delle reti abilitate */
  enabledNetworks(): NetworkId[] {
    return (["polygon", "ethereum", "bsc", "bitcoin"] as NetworkId[]).filter(
      (n) => this._isEnabled(n),
    );
  }

  private _isEnabled(networkId: NetworkId): boolean {
    switch (networkId) {
      case "polygon":  return FEATURE_FLAGS.ENABLE_POLYGON_USDT;
      case "ethereum": return FEATURE_FLAGS.ENABLE_ETHEREUM_USDT;
      case "bsc":      return FEATURE_FLAGS.ENABLE_BSC_USDT;
      case "bitcoin":  return FEATURE_FLAGS.ENABLE_BITCOIN;
      default:         return false;
    }
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

export const adapterRegistry = new AdapterRegistry();

// ─── Default registrations ────────────────────────────────────────────────────

/**
 * Registra le factory lazy per tutti gli adapter.
 * Chiamare una volta all'avvio (index.ts) DOPO initCustodialService().
 *
 * Le factory sono lazy: l'adapter non viene istanziato finché non richiesto.
 * Se una rete è disabilitata via feature flag, la factory non viene mai chiamata.
 */
export function registerDefaultAdapters(): void {
  // Polygon USDT (Phase 2)
  adapterRegistry.register("polygon", () => {
    const { PolygonAdapter } = require("./evm/polygon.adapter");
    return new PolygonAdapter();
  });

  // Ethereum USDT (Phase 4)
  adapterRegistry.register("ethereum", () => {
    const { EthereumAdapter } = require("./evm/ethereum.adapter");
    return new EthereumAdapter();
  });

  // BSC USDT (Phase 5)
  adapterRegistry.register("bsc", () => {
    const { BscAdapter } = require("./evm/bsc.adapter");
    return new BscAdapter();
  });

  // Bitcoin BTC (Phase 3)
  adapterRegistry.register("bitcoin", () => {
    const { BitcoinAdapter } = require("./bitcoin/bitcoin-adapter");
    const { RPC_CONFIGS } = require("./multichain-config");
    return new BitcoinAdapter(RPC_CONFIGS.bitcoin, { confirmations: 3 });
  });

  logger.info("[AdapterRegistry] Factory registrate per polygon/ethereum/bsc/bitcoin");
}
