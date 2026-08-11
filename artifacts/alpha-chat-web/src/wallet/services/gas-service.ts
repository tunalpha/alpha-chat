/**
 * Alpha Wallet — Gas Service (Phase C)
 *
 * Fetches gas estimates from the backend proxy.
 * Builds ERC-20 transfer calldata client-side (no secrets involved).
 * SICUREZZA: gas fetching uses only public addresses.
 */

import { encodeFunctionData } from "viem";
import { apiWalletGetGasEstimate } from "../../lib/alpha-wallet-api";

// ─── Tipi ──────────────────────────────────────────────────────────────────

export interface GasEstimate {
  gasLimit:     bigint;
  gasPrice:     bigint;
  totalFeeWei:  bigint;
  nonce:        number;
  gasPriceGwei: string;  // "12.50"
  totalFeeEth:  string;  // "0.00001234"
  /** Native token symbol (ETH, POL, BNB) for display */
  feeSymbol:    string;
}

// ─── ERC-20 ABI minimal ────────────────────────────────────────────────────

const ERC20_TRANSFER_ABI = [
  {
    name:   "transfer",
    type:   "function",
    inputs: [
      { name: "to",     type: "address"  },
      { name: "amount", type: "uint256"  },
    ],
    outputs:         [{ type: "bool" }],
    stateMutability: "nonpayable",
  },
] as const;

// ─── Data encoding ─────────────────────────────────────────────────────────

/**
 * Builds the calldata for an ERC-20 transfer(address, uint256) call.
 * This is computed client-side — no secrets involved.
 */
export function buildErc20TransferData(
  to:     `0x${string}`,
  amount: bigint,
): `0x${string}` {
  return encodeFunctionData({
    abi:          ERC20_TRANSFER_ABI,
    functionName: "transfer",
    args:         [to, amount],
  });
}

// ─── Gas estimation ────────────────────────────────────────────────────────

/**
 * Fetches gas estimate for a native EVM transfer.
 */
export async function estimateNativeTransferGas(params: {
  chainId:   number;
  from:      `0x${string}`;
  to:        `0x${string}`;
  valueWei:  bigint;
}): Promise<GasEstimate> {
  return _fetchGasEstimate({
    chainId: params.chainId,
    from:    params.from,
    to:      params.to,
    data:    "0x",
    value:   params.valueWei,
  });
}

/**
 * Fetches gas estimate for an ERC-20 transfer.
 * The `to` is the CONTRACT address, `recipient` is the human recipient.
 */
export async function estimateErc20TransferGas(params: {
  chainId:          number;
  from:             `0x${string}`;
  tokenContractAddr: `0x${string}`;
  recipient:        `0x${string}`;
  amount:           bigint;
}): Promise<GasEstimate> {
  const data = buildErc20TransferData(params.recipient, params.amount);
  return _fetchGasEstimate({
    chainId: params.chainId,
    from:    params.from,
    to:      params.tokenContractAddr,
    data,
    value:   0n,
  });
}

async function _fetchGasEstimate(params: {
  chainId: number;
  from:    `0x${string}`;
  to:      `0x${string}`;
  data:    string;
  value:   bigint;
}): Promise<GasEstimate> {
  const resp = await apiWalletGetGasEstimate({
    chainId: params.chainId,
    from:    params.from,
    to:      params.to,
    data:    params.data,
    value:   params.value.toString(),
  });

  const feeSymbol = params.chainId === 1 ? "ETH" : params.chainId === 137 ? "POL" : "BNB";

  return {
    gasLimit:     BigInt(resp.gasLimit),
    gasPrice:     BigInt(resp.gasPrice),
    totalFeeWei:  BigInt(resp.totalFeeWei),
    nonce:        resp.nonce,
    gasPriceGwei: resp.gasPriceGwei,
    totalFeeEth:  resp.totalFeeEth,
    feeSymbol,
  };
}
