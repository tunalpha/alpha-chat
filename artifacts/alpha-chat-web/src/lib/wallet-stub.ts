/**
 * wallet-stub.ts — costanti USDA senza wagmi/WalletConnect.
 * Verrà sostituito con la nuova integrazione.
 */

export const USDA_CONTRACT_ADDRESS = "0x23396cF899Ca06c4472205fC903bDB4de249D6f" as `0x${string}`
export const USDA_CHAIN_ID  = 137
export const USDA_DECIMALS  = 18

/** Placeholder: apre il WalletSheet quando sarà reintegrato. */
export const walletModal = {
  open: () => {
    console.warn("[wallet-stub] walletModal.open() — wallet non ancora integrato")
  },
}
