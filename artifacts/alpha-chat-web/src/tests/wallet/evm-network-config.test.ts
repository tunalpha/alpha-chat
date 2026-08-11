/**
 * Test — Alpha Wallet: EVM Network Config
 *
 * Verifica:
 * - Reti supportate (Ethereum, Polygon, BSC)
 * - Lookup per chainId
 * - URL explorer corretti
 * - ChainId unici (no duplicati)
 */

import { describe, it, expect } from "vitest";
import {
  EVM_NETWORKS,
  ALL_EVM_NETWORKS,
  getNetworkByChainId,
  getNetworkByKey,
  txExplorerUrl,
  addressExplorerUrl,
  isSupportedChain,
  SUPPORTED_CHAIN_IDS,
} from "@/wallet/evm/evm-network-config";

describe("EVM_NETWORKS struttura", () => {
  it("contiene Ethereum, Polygon e BSC", () => {
    expect(EVM_NETWORKS.ethereum).toBeDefined();
    expect(EVM_NETWORKS.polygon).toBeDefined();
    expect(EVM_NETWORKS.bsc).toBeDefined();
  });

  it("tutti i chainId sono unici", () => {
    const ids = ALL_EVM_NETWORKS.map(n => n.chainId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("Ethereum ha chainId 1", () => {
    expect(EVM_NETWORKS.ethereum.chainId).toBe(1);
  });

  it("Polygon ha chainId 137", () => {
    expect(EVM_NETWORKS.polygon.chainId).toBe(137);
  });

  it("BSC ha chainId 56", () => {
    expect(EVM_NETWORKS.bsc.chainId).toBe(56);
  });
});

describe("getNetworkByChainId", () => {
  it("trova Ethereum per chainId 1", () => {
    const net = getNetworkByChainId(1);
    expect(net).toBeDefined();
    expect(net!.name).toBe("Ethereum");
  });

  it("trova Polygon per chainId 137", () => {
    const net = getNetworkByChainId(137);
    expect(net!.nativeSymbol).toBe("POL");
  });

  it("restituisce undefined per chainId sconosciuto", () => {
    expect(getNetworkByChainId(9999)).toBeUndefined();
  });
});

describe("getNetworkByKey", () => {
  it("trova rete per chiave minuscola", () => {
    expect(getNetworkByKey("ethereum")).toBeDefined();
    expect(getNetworkByKey("polygon")).toBeDefined();
    expect(getNetworkByKey("bsc")).toBeDefined();
  });

  it("case-insensitive", () => {
    expect(getNetworkByKey("ETHEREUM")).toBeDefined();
    expect(getNetworkByKey("Polygon")).toBeDefined();
  });

  it("restituisce undefined per rete sconosciuta", () => {
    expect(getNetworkByKey("solana")).toBeUndefined();
  });
});

describe("txExplorerUrl / addressExplorerUrl", () => {
  it("genera URL tx Ethereum corretto", () => {
    const url = txExplorerUrl(1, "0xabc123");
    expect(url).toBe("https://etherscan.io/tx/0xabc123");
  });

  it("genera URL address Polygon corretto", () => {
    const url = addressExplorerUrl(137, "0xdef456");
    expect(url).toBe("https://polygonscan.com/address/0xdef456");
  });

  it("restituisce # per chainId sconosciuto", () => {
    expect(txExplorerUrl(9999, "0xabc")).toBe("#");
    expect(addressExplorerUrl(9999, "0xabc")).toBe("#");
  });
});

describe("isSupportedChain", () => {
  it("chainId 1, 137, 56 sono supportati", () => {
    expect(isSupportedChain(1)).toBe(true);
    expect(isSupportedChain(137)).toBe(true);
    expect(isSupportedChain(56)).toBe(true);
  });

  it("chainId sconosciuto non è supportato", () => {
    expect(isSupportedChain(9999)).toBe(false);
    expect(isSupportedChain(0)).toBe(false);
  });

  it("SUPPORTED_CHAIN_IDS contiene i 3 chainId principali", () => {
    expect(SUPPORTED_CHAIN_IDS).toContain(1);
    expect(SUPPORTED_CHAIN_IDS).toContain(137);
    expect(SUPPORTED_CHAIN_IDS).toContain(56);
  });
});
