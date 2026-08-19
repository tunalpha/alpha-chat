/**
 * Dedicated BTC→Li.FI executor.
 * It signs the Li.FI PSBT as received; it must never rebuild or amend outputs.
 */

import { hex } from "@scure/base";
import { HDKey } from "@scure/bip32";
import { Transaction } from "@scure/btc-signer";
import { mnemonicToSeedBytes } from "../../wallet/core/mnemonic";
import { BTC_BASE_PATH } from "../../wallet/core/hd-wallet";
import { apiWalletBroadcastBtcTx, WalletNetworkError } from "../../lib/alpha-wallet-api";
import {
  assertLiFiBtcPsbtMatches,
  type LiFiBtcPsbtInstructions,
} from "./lifi-btc-psbt";

export class LiFiBtcBroadcastUncertainError extends Error {
  constructor() {
    super("BTC_SEND_UNCERTAIN");
    this.name = "LiFiBtcBroadcastUncertainError";
  }
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function signAndBroadcastLiFiBtcPsbt(params: {
  mnemonic: string;
  expected: LiFiBtcPsbtInstructions;
}): Promise<{ txid: string }> {
  // All quote invariants are checked before mnemonic/key access.
  assertLiFiBtcPsbtMatches(params.expected.psbtHex, params.expected);

  const seed = await mnemonicToSeedBytes(params.mnemonic);
  let privateKey: Uint8Array | null = null;
  try {
    const child = HDKey.fromMasterSeed(seed).derive(`${BTC_BASE_PATH}/0`);
    if (!child.privateKey) throw new Error("Impossibile derivare la chiave Bitcoin.");
    privateKey = new Uint8Array(child.privateKey);

    // This is the exact PSBT emitted by Li.FI. No output is appended, removed,
    // re-ordered or re-priced here.
    const tx = Transaction.fromPSBT(hex.decode(params.expected.psbtHex), { allowUnknownOutputs: true });
    if (tx.sign(privateKey) < 1) {
      throw new Error("Il PSBT Li.FI non contiene input firmabili dall'Alpha Wallet.");
    }
    tx.finalize();

    try {
      return await apiWalletBroadcastBtcTx(bytesToHex(tx.extract()));
    } catch (error) {
      if (error instanceof WalletNetworkError) throw new LiFiBtcBroadcastUncertainError();
      throw error;
    }
  } finally {
    seed.fill(0);
    privateKey?.fill(0);
  }
}