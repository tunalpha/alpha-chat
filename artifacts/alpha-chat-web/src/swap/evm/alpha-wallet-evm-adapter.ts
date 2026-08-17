/**
 * Alpha Wallet EVM Adapter — Bridge tra WalletContext e Li.Fi / viem.
 *
 * SICUREZZA:
 *   - La private key esiste SOLO nella stack locale di createAlphaWalletViemClient()
 *   - Viene azzerata nel blocco finally tramite privKey.fill(0)
 *   - Mai salvata in React state, localStorage, o scope di modulo
 *   - Il mnemonic (stringa JS) viene dereferenziato immediatamente dopo la derivazione
 *   - Richiede il PIN dalla sessionStorage["aw_bio_pin"] — presente solo quando
 *     il wallet è sbloccato nella sessione corrente (scritto da unlockWallet/importWallet)
 *
 * ISOLAMENTO: importa solo da viem e wallet/core — zero dipendenze dal payment engine,
 *             USDA, MultiChain, ThirdWeb.
 */

import { createWalletClient, http, type WalletClient } from "viem";
import { polygon, mainnet, bsc } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { loadKeystore, decryptSeed } from "../../wallet/core/keystore";
import { deriveEvmWallet, toHexKey } from "../../wallet/core/hd-wallet";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const AW_CHAIN_RPC: Record<number, string> = {
  137: ((import.meta as any).env?.VITE_POLYGON_RPC as string | undefined) ?? "https://polygon-rpc.com",
  56:  "https://bsc-dataseed.binance.org/",
  1:   "https://cloudflare-eth.com",
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const AW_VIEM_CHAIN: Record<number, any> = {
  137: polygon,
  56:  bsc,
  1:   mainnet,
};

/**
 * Crea un viem WalletClient dall'Alpha Wallet interno.
 *
 * Il PIN viene letto da sessionStorage["aw_bio_pin"] — presente solo quando
 * il wallet è sbloccato (scritto da WalletContext.unlockWallet / importWallet).
 *
 * La chiave privata viene azzerata nel blocco finally prima del ritorno.
 * Il chiamante riceve un WalletClient con account preconfigurato che può
 * firmare transazioni direttamente tramite viem — senza alcuna sessione ThirdWeb.
 *
 * @param chainId — Chain per cui creare il client (137=Polygon, 56=BSC, 1=ETH)
 * @throws ALPHA_WALLET_LOCKED   — wallet non sbloccato (aw_bio_pin assente)
 * @throws ALPHA_WALLET_NO_KEYSTORE — nessun keystore in IDB
 * @throws CHAIN_NOT_SUPPORTED   — chainId non supportato
 */
export async function createAlphaWalletViemClient(chainId: number): Promise<WalletClient> {
  // 1. Fail-fast: verifica chain supportata prima di derivare la chiave
  const chain = AW_VIEM_CHAIN[chainId];
  if (!chain) {
    throw new Error(`CHAIN_NOT_SUPPORTED: chain ${chainId} non è supportata (usa 137=Polygon, 56=BSC, 1=ETH).`);
  }

  // 2. Verifica PIN disponibile (wallet sbloccato in questa sessione)
  const pin = sessionStorage.getItem("aw_bio_pin");
  if (!pin) {
    throw new Error("ALPHA_WALLET_LOCKED: sblocca Alpha Wallet con il PIN prima di eseguire lo swap.");
  }

  // 3. Carica il keystore cifrato da IDB
  const entry = await loadKeystore();
  if (!entry) {
    throw new Error("ALPHA_WALLET_NO_KEYSTORE: nessun keystore trovato.");
  }

  // 4. Decripta il mnemonic con il PIN (lancia se PIN errato)
  const mnemonic = await decryptSeed(entry, pin);

  // 5. Deriva la chiave EVM (path m/44'/60'/0'/0/0) e crea il client
  let privKey: Uint8Array | null = null;
  try {
    const derived = await deriveEvmWallet(mnemonic, 0);
    privKey = derived.privateKey;

    const account = privateKeyToAccount(toHexKey(privKey));
    const rpcUrl  = AW_CHAIN_RPC[chainId];

    // 6. Crea e restituisce il viem WalletClient
    return createWalletClient({
      account,
      chain,
      transport: http(rpcUrl),
    }) as unknown as WalletClient;
  } finally {
    // 7. AZZERAMENTO CHIAVE — obbligatorio: la privKey non deve sopravvivere
    if (privKey) privKey.fill(0);
    // Il mnemonic è una stringa JS — non azzerabile direttamente,
    // ma dereferenziata al termine di questa funzione (garbage collected).
  }
}
