/**
 * Li.FI BTC PSBT inspection — no signing and no broadcasting.
 *
 * Li.FI supplies the exact partially signed Bitcoin transaction for BTC→EVM.
 * The OP_RETURN memo, vault output and amount must be taken from that PSBT;
 * this module only validates and exposes those immutable instructions.
 */

import { hex } from "@scure/base";
import { NETWORK, Transaction } from "@scure/btc-signer";

export class LiFiBtcPsbtValidationError extends Error {
  constructor(
    public readonly code:
      | "LIFI_BTC_PSBT_MISSING"
      | "LIFI_BTC_PSBT_INVALID"
      | "LIFI_BTC_MEMO_MISSING"
      | "LIFI_BTC_MEMO_INVALID"
      | "LIFI_BTC_VAULT_MISSING"
      | "LIFI_BTC_VAULT_MISMATCH"
      | "LIFI_BTC_AMOUNT_MISMATCH",
    message: string,
  ) {
    super(message);
    this.name = "LiFiBtcPsbtValidationError";
  }
}

export interface LiFiBtcPsbtInstructions {
  psbtHex: string;
  memo: string;
  vaultAddress: string;
  vaultAmountSat: bigint;
}

function parseHex(hexValue: string): Uint8Array {
  if (!hexValue || !/^[0-9a-f]+$/i.test(hexValue) || hexValue.length % 2 !== 0) {
    throw new LiFiBtcPsbtValidationError(
      "LIFI_BTC_PSBT_MISSING",
      "La quote Li.FI non contiene un PSBT Bitcoin valido. Richiedi una nuova quote.",
    );
  }
  try {
    return hex.decode(hexValue);
  } catch {
    throw new LiFiBtcPsbtValidationError(
      "LIFI_BTC_PSBT_INVALID",
      "Il PSBT ricevuto da Li.FI non può essere letto in sicurezza. Richiedi una nuova quote.",
    );
  }
}

function decodeOpReturn(script: Uint8Array): string | null {
  if (script.length < 3 || script[0] !== 0x6a) return null;

  let cursor = 1;
  const opcode = script[cursor++];
  let dataLength: number;

  if (opcode >= 1 && opcode <= 75) {
    dataLength = opcode;
  } else if (opcode === 0x4c && cursor < script.length) {
    dataLength = script[cursor++];
  } else if (opcode === 0x4d && cursor + 1 < script.length) {
    dataLength = script[cursor] | (script[cursor + 1] << 8);
    cursor += 2;
  } else {
    return null;
  }

  // A Li.FI memo must be one complete pushed UTF-8 value, not an arbitrary script.
  if (dataLength < 1 || cursor + dataLength !== script.length) return null;

  try {
    const memo = new TextDecoder("utf-8", { fatal: true }).decode(script.slice(cursor));
    return memo.trim() ? memo : null;
  } catch {
    return null;
  }
}

/**
 * Reads the immutable instructions supplied by Li.FI.
 * It never creates, changes, signs or broadcasts a transaction.
 */
export function inspectLiFiBtcPsbt(
  psbtHex: string,
  expectedVaultAddress?: string,
): LiFiBtcPsbtInstructions {
  const raw = parseHex(psbtHex);
  let tx: Transaction;
  try {
    // OP_RETURN is deliberately non-spendable and therefore "unknown" to the
    // generic script classifier. It is accepted here only to inspect Li.FI's
    // memo, which is immediately validated below.
    tx = Transaction.fromPSBT(raw, { allowUnknownOutputs: true });
  } catch {
    throw new LiFiBtcPsbtValidationError(
      "LIFI_BTC_PSBT_INVALID",
      "Il PSBT Li.FI non è valido. Nessuna transazione è stata creata.",
    );
  }

  const memoOutputs: string[] = [];
  const spendableOutputs: Array<{ address: string; amount: bigint }> = [];

  for (let index = 0; index < tx.outputsLength; index += 1) {
    const output = tx.getOutput(index);
    if (!output.script || output.amount === undefined) {
      throw new LiFiBtcPsbtValidationError(
        "LIFI_BTC_PSBT_INVALID",
        "Il PSBT Li.FI contiene un output incompleto. Nessuna transazione è stata creata.",
      );
    }
    const memo = decodeOpReturn(output.script);
    if (memo !== null) {
      memoOutputs.push(memo);
      continue;
    }

    const address = tx.getOutputAddress(index, NETWORK);
    if (address) spendableOutputs.push({ address, amount: output.amount });
  }

  if (memoOutputs.length !== 1) {
    throw new LiFiBtcPsbtValidationError(
      "LIFI_BTC_MEMO_MISSING",
      "La quote Li.FI non contiene un memo univoco. Nessuna transazione è stata creata.",
    );
  }

  if (spendableOutputs.length === 0) {
    throw new LiFiBtcPsbtValidationError(
      "LIFI_BTC_VAULT_MISSING",
      "La quote Li.FI non contiene un vault Bitcoin verificabile. Nessuna transazione è stata creata.",
    );
  }

  // The vault is identified by Li.FI's transactionRequest.to, never by an amount
  // heuristic. A change/refund output can legitimately be larger than the deposit.
  const vault = expectedVaultAddress
    ? spendableOutputs.find((output) => output.address === expectedVaultAddress)
    : spendableOutputs.length === 1
      ? spendableOutputs[0]
      : undefined;
  if (!vault || vault.amount <= 0n) {
    throw new LiFiBtcPsbtValidationError(
      expectedVaultAddress ? "LIFI_BTC_VAULT_MISMATCH" : "LIFI_BTC_VAULT_MISSING",
      "La quote Li.FI non contiene un importo vault valido. Nessuna transazione è stata creata.",
    );
  }

  return { psbtHex, memo: memoOutputs[0], vaultAddress: vault.address, vaultAmountSat: vault.amount };
}

/**
 * Ensures the already-inspected PSBT is still exactly the quote the user saw.
 * Any mismatch is fail-closed before private-key access or broadcasting.
 */
export function assertLiFiBtcPsbtMatches(
  psbtHex: string,
  expected: Pick<LiFiBtcPsbtInstructions, "memo" | "vaultAddress" | "vaultAmountSat">,
): LiFiBtcPsbtInstructions {
  const actual = inspectLiFiBtcPsbt(psbtHex, expected.vaultAddress);
  if (actual.memo !== expected.memo) {
    throw new LiFiBtcPsbtValidationError(
      "LIFI_BTC_MEMO_INVALID",
      "Il memo della transazione non corrisponde alla quote Li.FI. Nessuna transazione è stata creata.",
    );
  }
  if (actual.vaultAddress !== expected.vaultAddress) {
    throw new LiFiBtcPsbtValidationError(
      "LIFI_BTC_VAULT_MISMATCH",
      "Il vault della transazione non corrisponde alla quote Li.FI. Nessuna transazione è stata creata.",
    );
  }
  if (actual.vaultAmountSat !== expected.vaultAmountSat) {
    throw new LiFiBtcPsbtValidationError(
      "LIFI_BTC_AMOUNT_MISMATCH",
      "L'importo nel PSBT non corrisponde alla quote Li.FI. Nessuna transazione è stata creata.",
    );
  }
  return actual;
}