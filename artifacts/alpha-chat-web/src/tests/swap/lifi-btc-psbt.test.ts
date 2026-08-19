/**
 * Li.FI BTC→EVM PSBT guards.
 *
 * These checks execute before the dedicated signer accesses a key or calls the
 * broadcast API. A generic Bitcoin transaction is deliberately never accepted.
 */

import { describe, expect, it } from "vitest";
import { hex } from "@scure/base";
import { Transaction } from "@scure/btc-signer";
import {
  assertLiFiBtcPsbtMatches,
  inspectLiFiBtcPsbt,
  LiFiBtcPsbtValidationError,
} from "../../swap/evm/lifi-btc-psbt";

const VAULT = "bc1qnjg0jd8228aq7egyzacy8cys3knf9xvrerkf9g";
const OTHER_VAULT = "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu";
const MEMO = "=:ETH.ETH:0x1111111111111111111111111111111111111111";
const AMOUNT = 123_456n;

function opReturn(memo: string): Uint8Array {
  const bytes = new TextEncoder().encode(memo);
  if (bytes.length > 75) throw new Error("Test memo too long.");
  return new Uint8Array([0x6a, bytes.length, ...bytes]);
}

function makePsbt(options: {
  memo?: string | null;
  vault?: string;
  amount?: bigint;
} = {}): string {
  const tx = new Transaction({ allowUnknownOutputs: true });
  tx.addOutputAddress(options.vault ?? VAULT, options.amount ?? AMOUNT);
  if (options.memo !== null) {
    tx.addOutput({ script: opReturn(options.memo ?? MEMO), amount: 0n });
  }
  return hex.encode(tx.toPSBT());
}

function expectCode(call: () => unknown, code: LiFiBtcPsbtValidationError["code"]) {
  try {
    call();
    throw new Error("Expected LiFiBtcPsbtValidationError");
  } catch (error) {
    expect(error).toBeInstanceOf(LiFiBtcPsbtValidationError);
    expect((error as LiFiBtcPsbtValidationError).code).toBe(code);
  }
}

describe("Li.FI BTC PSBT inspection", () => {
  it("accepts exactly one OP_RETURN memo and the declared vault output", () => {
    const psbtHex = makePsbt();
    expect(inspectLiFiBtcPsbt(psbtHex, VAULT)).toMatchObject({
      psbtHex,
      memo: MEMO,
      vaultAddress: VAULT,
      vaultAmountSat: AMOUNT,
    });
  });

  it("blocks a PSBT without a Li.FI OP_RETURN memo", () => {
    expectCode(() => inspectLiFiBtcPsbt(makePsbt({ memo: null }), VAULT), "LIFI_BTC_MEMO_MISSING");
  });

  it("blocks a vault that does not match transactionRequest.to", () => {
    expectCode(() => inspectLiFiBtcPsbt(makePsbt(), OTHER_VAULT), "LIFI_BTC_VAULT_MISMATCH");
  });

  it("blocks a memo altered after the quote was shown", () => {
    const quote = inspectLiFiBtcPsbt(makePsbt(), VAULT);
    const altered = makePsbt({ memo: `${MEMO}:altered` });
    expectCode(() => assertLiFiBtcPsbtMatches(altered, quote), "LIFI_BTC_MEMO_INVALID");
  });

  it("blocks a vault amount altered after the quote was shown", () => {
    const quote = inspectLiFiBtcPsbt(makePsbt(), VAULT);
    const altered = makePsbt({ amount: AMOUNT + 1n });
    expectCode(() => assertLiFiBtcPsbtMatches(altered, quote), "LIFI_BTC_AMOUNT_MISMATCH");
  });

  it("blocks malformed or absent PSBT data before signing", () => {
    expectCode(() => inspectLiFiBtcPsbt("not-a-psbt", VAULT), "LIFI_BTC_PSBT_MISSING");
  });
});