/**
 * Alpha Wallet — Barrel export
 *
 * ISOLAMENTO ASSOLUTO:
 * Questo modulo non dipende da nulla del Payment Engine esistente
 * (multichain, usda, thirdweb, walletconnect, escrow, gas station, BTC payment engine).
 *
 * La Fase G (integrazione con Chat/Payments) è esclusa e richiede
 * approvazione esplicita prima dell'implementazione.
 */

// Core
export * from "./core/mnemonic";
export * from "./core/hd-wallet";
export * from "./core/keystore";
export * from "./core/wallet-auth";

// EVM
export * from "./evm/evm-network-config";
export * from "./evm/token-registry";
