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

// Notifications
export * from "./notifications/wallet-notification-types";
export { dispatchWalletNotification, loadNotifications, countUnread, markAllNotificationsRead } from "./notifications/wallet-notification-store";

// Monitoring
export { txMonitor } from "./monitoring/tx-monitor";

// Context
export { WalletProvider, useWallet } from "./context/WalletContext";
export type { WalletPhase } from "./context/WalletContext";
