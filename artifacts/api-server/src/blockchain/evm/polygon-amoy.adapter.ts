/**
 * polygon-amoy.adapter.ts — PolygonAmoyAdapter
 *
 * Adapter EVM per Polygon Amoy testnet (chainId 80002).
 *
 * Usato esclusivamente per test su testnet — non è registrato
 * nell'AdapterRegistry di produzione.
 *
 * L'adapter condivide tutta la logica con EvmAdapter (sendToken, getBalance, ecc.)
 * ma usa:
 *   - chain: polygonAmoy (chainId 80002 invece di 137)
 *   - confirmations: 1 (sufficiente su testnet per velocità)
 *
 * Non importa multichain-config a runtime → sicuro come importazione statica
 * nei testnet scripts prima del set delle variabili d'ambiente di produzione.
 */

import { polygonAmoy } from "viem/chains";
import { EvmAdapter } from "./evm-adapter";
import type { RpcConfig } from "../multichain-config";

const AMOY_PUBLIC_RPC = "https://rpc-amoy.polygon.technology/";

export class PolygonAmoyAdapter extends EvmAdapter {
  constructor(rpcUrlOrConfig?: string | RpcConfig) {
    let rpcConfig: RpcConfig;

    if (!rpcUrlOrConfig) {
      rpcConfig = { primary: AMOY_PUBLIC_RPC, fallbacks: [] };
    } else if (typeof rpcUrlOrConfig === "string") {
      rpcConfig = { primary: rpcUrlOrConfig, fallbacks: [] };
    } else {
      rpcConfig = rpcUrlOrConfig;
    }

    super({
      networkId:        "polygon",
      chain:            polygonAmoy,
      rpcConfig,
      confirmations:    1,       // Amoy testnet: 1 conferma per velocità
      receiptTimeoutMs: 120_000, // 2 min
    });
  }
}
