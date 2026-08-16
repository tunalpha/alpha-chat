/**
 * SwapRouter — selezione automatica del provider
 *
 * Mappa ogni direction al provider corretto:
 *   btc_to_lightning  → BoltzBtcLnProvider
 *   lightning_to_btc  → BreezSparkBtcLnProvider
 *
 * ISOLAMENTO: La UI chiama solo SwapRouter, non conosce il provider concreto.
 * Per sostituire un provider: modificare solo questa classe + il provider stesso.
 * UI, state machine, Admin, payment logic: invariati.
 *
 * SWAP_ENABLED = false — controllare prima di qualsiasi operazione.
 */

import type { BitcoinLightningSwapProvider } from "./SwapProvider.js";
import type { SwapDirection, SwapPublicConfig } from "./types.js";

export class SwapRouter {
  private readonly providers: Map<SwapDirection, BitcoinLightningSwapProvider>;

  constructor(
    boltzProvider:      BitcoinLightningSwapProvider,
    breezSparkProvider: BitcoinLightningSwapProvider,
  ) {
    this.providers = new Map([
      ["btc_to_lightning", boltzProvider],
      ["lightning_to_btc", breezSparkProvider],
    ]);
  }

  /** Restituisce il provider per la direction richiesta. */
  resolve(direction: SwapDirection): BitcoinLightningSwapProvider {
    const provider = this.providers.get(direction);
    if (!provider) {
      throw new Error(`Nessun provider per direction: ${direction}`);
    }
    return provider;
  }

  /** Verifica se la direction è disponibile (provider + config). */
  async isDirectionAvailable(direction: SwapDirection, config: SwapPublicConfig): Promise<boolean> {
    if (!config.enabled) return false;
    if (direction === "btc_to_lightning") return config.btcln.enabled;
    if (direction === "lightning_to_btc") return config.lnbtc.enabled;
    return false;
  }

  /** Restituisce le direction disponibili in base alla configurazione. */
  getAvailableDirections(config: SwapPublicConfig): SwapDirection[] {
    const dirs: SwapDirection[] = [];
    if (config.enabled) {
      if (config.btcln.enabled) dirs.push("btc_to_lightning");
      if (config.lnbtc.enabled) dirs.push("lightning_to_btc");
    }
    return dirs;
  }
}

/** Recupera la configurazione pubblica dello swap dal backend. */
export async function fetchSwapConfig(): Promise<SwapPublicConfig> {
  const token = localStorage.getItem("ac_access_token");
  const res = await fetch("/api/v1/swap/config", {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const body = await res.json() as { config: SwapPublicConfig };
  return body.config;
}
