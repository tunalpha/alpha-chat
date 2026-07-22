/**
 * lib/thirdweb.ts — ThirdWeb v5 client, chain e wallet identici al progetto USDA.
 */

import { createThirdwebClient, defineChain } from "thirdweb";
import { createWallet } from "thirdweb/wallets";

export const client = createThirdwebClient({
  clientId: import.meta.env.VITE_THIRDWEB_CLIENT_ID as string,
});

export const polygon = defineChain(137);

export const USDA_CONTRACT_ADDRESS = "0x23396cF899Ca06c4472205fC903bDB4de249D6f";
export const USDA_CHAIN_ID  = 137;
export const USDA_DECIMALS  = 18;

export const wallets = [
  createWallet("io.metamask"),
  createWallet("com.trustwallet.app"),
  createWallet("com.coinbase.wallet"),
  createWallet("me.rainbow"),
  createWallet("io.zerion.wallet"),
];
