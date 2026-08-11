/**
 * Phase E — EVM Signing Verification (Correctness Audit)
 *
 * OBIETTIVO: verificare byte-per-byte / logicamente che ciò che la UI
 * mostrerebbe nella schermata di conferma corrisponda ESATTAMENTE a ciò
 * che viene messo nella transazione firmata.
 *
 * Strategia:
 *  1. Usare chiave privata di test pubblica (Hardhat/Foundry account #0)
 *  2. Mockare il broadcast per CATTURARE il tx hex firmato
 *     (apiWalletBroadcastEvmTx(chainId, signedTx) → catturiamo il 2° arg)
 *  3. Decodificare il tx hex con viem parseTransaction + decodeFunctionData
 *  4. Asserire che ogni campo decodificato corrisponda ai parametri in ingresso
 *
 * Copre: Ethereum (chainId=1), Polygon (chainId=137), BSC (chainId=56)
 * Copre: native transfer + ERC-20 transfer (USDT×2, USDC, USDA)
 *
 * INDIRIZZI DI TEST (Hardhat accounts pubblicamente documentati):
 *   Account #0: 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
 *   Account #1: 0x70997970C51812dc3A010C7d01b50e0d17dc79C8
 *   Account #2: 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC
 * Fonte: https://hardhat.org/hardhat-network/docs/reference#accounts
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { parseTransaction, decodeFunctionData, type Hex } from "viem";

// ─── Chiave di test pubblica (Hardhat account #0, NON un wallet reale) ─────
const HARDHAT_PK_BYTES = new Uint8Array([
  0xac, 0x09, 0x74, 0xbe, 0xc3, 0x9a, 0x17, 0xe3,
  0x6b, 0xa4, 0xa6, 0xb4, 0xd2, 0x38, 0xff, 0x94,
  0x4b, 0xac, 0xb4, 0x78, 0xcb, 0xed, 0x5e, 0xfc,
  0xae, 0x78, 0x4d, 0x7b, 0xf4, 0xf2, 0xff, 0x80,
]);
const HARDHAT_ADDR_0 = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"; // sender
const HARDHAT_ADDR_1 = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8"; // recipient A
const HARDHAT_ADDR_2 = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC"; // recipient B

// ─── ABI per decode ERC-20 calldata ──────────────────────────────────────
const ERC20_TRANSFER_ABI = [
  {
    name:   "transfer",
    type:   "function",
    inputs: [
      { name: "to",     type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs:         [{ type: "bool" }],
    stateMutability: "nonpayable",
  },
] as const;

// ─── Mocks ────────────────────────────────────────────────────────────────

vi.mock("../../wallet/core/hd-wallet", () => ({
  deriveEvmWallet: vi.fn(),
}));
vi.mock("../../lib/alpha-wallet-api", () => ({
  apiWalletBroadcastEvmTx: vi.fn(),
  apiWalletBroadcastBtcTx: vi.fn(),
  apiWalletGetGasEstimate:  vi.fn(),
  apiWalletGetBtcUTXOs:     vi.fn(),
  apiWalletGetBtcFeeRate:   vi.fn(),
  apiWalletGetBtcBalance:   vi.fn(),
  apiWalletGetEvmBalance:   vi.fn(),
  apiWalletGetPrices:       vi.fn(),
}));

import { deriveEvmWallet } from "../../wallet/core/hd-wallet";
import { apiWalletBroadcastEvmTx } from "../../lib/alpha-wallet-api";
import {
  signAndBroadcastNativeEvm,
  signAndBroadcastErc20Evm,
} from "../../wallet/services/evm-signer";

// ─── Setup ────────────────────────────────────────────────────────────────

beforeEach(() => {
  // IMPORTANTE: resetAllMocks (non clearAllMocks) — svuota anche la coda
  // di mockImplementationOnce lasciata da test precedenti che hanno lanciato
  // prima di chiamare il broadcast (es. indirizzi non-EIP-55 → getAddress throw).
  vi.resetAllMocks();
  // Fresh copy per ogni call — evita il bug "chiave azzerata tra test"
  vi.mocked(deriveEvmWallet).mockImplementation(async () => ({
    address:        HARDHAT_ADDR_0,
    privateKey:     new Uint8Array(HARDHAT_PK_BYTES),
    derivationPath: "m/44'/60'/0'/0/0",
    index:          0,
  }));
  vi.mocked(apiWalletBroadcastEvmTx).mockResolvedValue({ txHash: "0xmocked" });
});

// ─── Helper: cattura il signed tx hex (SECONDO argomento di broadcastEvmTx) ──

async function captureSignedTx(call: () => Promise<unknown>): Promise<Hex> {
  let captured: Hex | null = null;
  // apiWalletBroadcastEvmTx(chainId: number, signedTx: string)
  // Catturiamo il SECONDO argomento (signed tx hex), non il primo (chainId)
  vi.mocked(apiWalletBroadcastEvmTx).mockImplementationOnce(
    async (_chainId: number, signedTx: string) => {
      captured = signedTx as Hex;
      return { txHash: "0xtest" };
    }
  );
  await call();
  if (!captured) throw new Error("apiWalletBroadcastEvmTx non è stata chiamata");
  return captured;
}

// ─── Native EVM Transfer: verifica tutti i campi nel tx firmato ───────────

describe("Native EVM transfer — campi nel tx firmato", () => {
  const CHAINS = [
    { name: "Ethereum", chainId: 1   },
    { name: "Polygon",  chainId: 137 },
    { name: "BSC",      chainId: 56  },
  ];

  for (const { name, chainId } of CHAINS) {
    it(`${name} (chainId=${chainId}): chainId nel tx firmato corrisponde all'UI [EIP-155]`, async () => {
      const signedHex = await captureSignedTx(() =>
        signAndBroadcastNativeEvm({
          mnemonic: "test",
          chainId,
          to:       HARDHAT_ADDR_1,
          valueWei: 1_000_000_000_000_000n,
          gasLimit: 21_000n,
          gasPrice: 30_000_000_000n,
          nonce:    0,
        })
      );
      const decoded = parseTransaction(signedHex);
      // VERIFICA CRITICA: replay protection EIP-155
      expect(Number(decoded.chainId)).toBe(chainId);
    });

    it(`${name}: recipient (to) nel tx firmato = indirizzo inserito nella UI`, async () => {
      const recipient = HARDHAT_ADDR_1;
      const signedHex = await captureSignedTx(() =>
        signAndBroadcastNativeEvm({
          mnemonic: "test",
          chainId,
          to:       recipient,
          valueWei: 500_000_000_000_000n,
          gasLimit: 21_000n,
          gasPrice: 10_000_000_000n,
          nonce:    3,
        })
      );
      const decoded = parseTransaction(signedHex);
      expect(decoded.to?.toLowerCase()).toBe(recipient.toLowerCase());
    });

    it(`${name}: importo (value) nel tx firmato = importo inserito, senza arrotondamento`, async () => {
      const valueWei = 123_456_789_012_345_678n;
      const signedHex = await captureSignedTx(() =>
        signAndBroadcastNativeEvm({
          mnemonic: "test",
          chainId,
          to:       HARDHAT_ADDR_1,
          valueWei,
          gasLimit: 21_000n,
          gasPrice: 10_000_000_000n,
          nonce:    7,
        })
      );
      const decoded = parseTransaction(signedHex);
      expect(decoded.value).toBe(valueWei);
    });

    it(`${name}: nonce nel tx firmato = nonce stimato`, async () => {
      const nonce = 42;
      const signedHex = await captureSignedTx(() =>
        signAndBroadcastNativeEvm({
          mnemonic: "test",
          chainId,
          to:       HARDHAT_ADDR_1,
          valueWei: 1_000_000_000_000_000n,
          gasLimit: 21_000n,
          gasPrice: 10_000_000_000n,
          nonce,
        })
      );
      const decoded = parseTransaction(signedHex);
      expect(decoded.nonce).toBe(nonce);
    });

    it(`${name}: gasPrice nel tx firmato = stima gas`, async () => {
      const gasPrice = 35_000_000_000n;
      const signedHex = await captureSignedTx(() =>
        signAndBroadcastNativeEvm({
          mnemonic: "test",
          chainId,
          to:       HARDHAT_ADDR_1,
          valueWei: 1_000_000_000_000_000n,
          gasLimit: 21_000n,
          gasPrice,
          nonce:    0,
        })
      );
      const decoded = parseTransaction(signedHex);
      expect(decoded.gasPrice).toBe(gasPrice);
    });

    it(`${name}: gasLimit nel tx firmato = stima gasLimit`, async () => {
      const gasLimit = 21_000n;
      const signedHex = await captureSignedTx(() =>
        signAndBroadcastNativeEvm({
          mnemonic: "test",
          chainId,
          to:       HARDHAT_ADDR_1,
          valueWei: 1_000_000_000_000_000n,
          gasLimit,
          gasPrice: 10_000_000_000n,
          nonce:    0,
        })
      );
      const decoded = parseTransaction(signedHex);
      expect(decoded.gas).toBe(gasLimit);
    });
  }

  it("Native tx: data field assente/0x (nessun calldata per native transfer)", async () => {
    const signedHex = await captureSignedTx(() =>
      signAndBroadcastNativeEvm({
        mnemonic: "test",
        chainId:  137,
        to:       HARDHAT_ADDR_1,
        valueWei: 1_000_000_000_000_000n,
        gasLimit: 21_000n,
        gasPrice: 10_000_000_000n,
        nonce:    0,
      })
    );
    const decoded = parseTransaction(signedHex);
    expect(!decoded.data || decoded.data === "0x").toBe(true);
  });
});

// ─── ERC-20 Transfer: correttezza calldata ────────────────────────────────

describe("ERC-20 transfer — calldata nel tx firmato", () => {
  it("Polygon USDT (6 dec): `to` del tx = contract USDT, calldata contiene recipient e amount", async () => {
    // Verified contract addresses from token-registry-server.ts
    const USDT_POLYGON = "0xc2132D05D31c914a87C6611C10748AEb04B58e8F";
    const RECIPIENT    = HARDHAT_ADDR_2;
    const AMOUNT       = 10_000_000n; // 10 USDT (6 decimali)

    const signedHex = await captureSignedTx(() =>
      signAndBroadcastErc20Evm({
        mnemonic:          "test",
        chainId:           137,
        tokenContractAddr: USDT_POLYGON,
        recipient:         RECIPIENT,
        amount:            AMOUNT,
        gasLimit:          65_000n,
        gasPrice:          30_000_000_000n,
        nonce:             0,
      })
    );
    const decoded = parseTransaction(signedHex);

    // VERIFICA 1: `to` nel tx = CONTRACT address (non il recipient!)
    expect(decoded.to?.toLowerCase()).toBe(USDT_POLYGON.toLowerCase());
    // VERIFICA 2: value = 0 (i token viaggiano come calldata, il gas è in POL nativo)
    expect(decoded.value ?? 0n).toBe(0n);
    // VERIFICA 3: chainId = Polygon
    expect(Number(decoded.chainId)).toBe(137);
    // VERIFICA 4: calldata → recipient e amount corretti
    if (!decoded.data) throw new Error("Calldata mancante nel tx ERC-20");
    const { args } = decodeFunctionData({ abi: ERC20_TRANSFER_ABI, data: decoded.data });
    expect((args[0] as string).toLowerCase()).toBe(RECIPIENT.toLowerCase());
    expect(args[1]).toBe(AMOUNT);
  });

  it("BSC USDT (18 dec): amount in calldata usa 10^18, NON 10^6 — verifica decimali critici", async () => {
    const USDT_BSC  = "0x55d398326f99059fF775485246999027B3197955";
    const AMOUNT_18 = 10_000_000_000_000_000_000n; // 10 USDT BSC (18 dec)

    const signedHex = await captureSignedTx(() =>
      signAndBroadcastErc20Evm({
        mnemonic:          "test",
        chainId:           56,
        tokenContractAddr: USDT_BSC,
        recipient:         HARDHAT_ADDR_1,
        amount:            AMOUNT_18,
        gasLimit:          65_000n,
        gasPrice:          5_000_000_000n,
        nonce:             0,
      })
    );
    const decoded = parseTransaction(signedHex);
    if (!decoded.data) throw new Error("Calldata mancante");
    const { args } = decodeFunctionData({ abi: ERC20_TRANSFER_ABI, data: decoded.data });

    // CRITICO: BSC USDT ha 18 decimali — must NOT be 6-decimal amount
    expect(args[1]).toBe(AMOUNT_18);
    expect(args[1]).not.toBe(10_000_000n); // rifiuta importo a 6 decimali
  });

  it("Polygon USDA (18 dec): amount usa 10^18 — non confondersi con USDT Polygon (6 dec)", async () => {
    // PHASE E FINDING: il USDA_POLYGON_ADDRESS nei file wallet ha 39 hex chars (invalido).
    // Il payment engine usa 0xe714655fD1B3ba96B887DF1F94336c2A78E24001 (40 chars, valido).
    // In questo test usiamo l'indirizzo del payment engine (valido) per verificare la firma.
    // ACTION NEEDED prima del launch: verificare il corretto contratto USDA su Polygonscan.
    const USDA_POLYGON = "0xe714655fd1b3ba96b887df1f94336c2a78e24001";
    const AMOUNT_18    = 10_000_000_000_000_000_000n;

    const signedHex = await captureSignedTx(() =>
      signAndBroadcastErc20Evm({
        mnemonic:          "test",
        chainId:           137,
        tokenContractAddr: USDA_POLYGON,
        recipient:         HARDHAT_ADDR_1,
        amount:            AMOUNT_18,
        gasLimit:          70_000n,
        gasPrice:          30_000_000_000n,
        nonce:             2,
      })
    );
    const decoded = parseTransaction(signedHex);
    if (!decoded.data) throw new Error("Calldata mancante");
    const { args } = decodeFunctionData({ abi: ERC20_TRANSFER_ABI, data: decoded.data });
    expect(args[1]).toBe(AMOUNT_18);
    expect(Number(decoded.chainId)).toBe(137);
  });

  it("Ethereum USDC (6 dec): contract = USDC Ethereum, amount usa 10^6", async () => {
    // All-lowercase: getAddress() normalizza a EIP-55
    const USDC_ETH = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
    const AMOUNT   = 50_000_000n; // 50 USDC (6 dec)

    const signedHex = await captureSignedTx(() =>
      signAndBroadcastErc20Evm({
        mnemonic:          "test",
        chainId:           1,
        tokenContractAddr: USDC_ETH,
        recipient:         HARDHAT_ADDR_1,
        amount:            AMOUNT,
        gasLimit:          65_000n,
        gasPrice:          20_000_000_000n,
        nonce:             10,
      })
    );
    const decoded = parseTransaction(signedHex);
    if (!decoded.data) throw new Error("Calldata mancante");
    const { args } = decodeFunctionData({ abi: ERC20_TRANSFER_ABI, data: decoded.data });
    expect(decoded.to?.toLowerCase()).toBe(USDC_ETH.toLowerCase());
    expect(Number(decoded.chainId)).toBe(1);
    expect(args[1]).toBe(AMOUNT);
  });

  it("BSC USDC (18 dec): amount usa 10^18 — non confondersi con Ethereum USDC (6 dec)", async () => {
    // All-lowercase: getAddress() normalizza a EIP-55
    const USDC_BSC  = "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d";
    const AMOUNT_18 = 25_000_000_000_000_000_000n; // 25 USDC BSC (18 dec)

    const signedHex = await captureSignedTx(() =>
      signAndBroadcastErc20Evm({
        mnemonic:          "test",
        chainId:           56,
        tokenContractAddr: USDC_BSC,
        recipient:         HARDHAT_ADDR_1,
        amount:            AMOUNT_18,
        gasLimit:          65_000n,
        gasPrice:          5_000_000_000n,
        nonce:             1,
      })
    );
    const decoded = parseTransaction(signedHex);
    if (!decoded.data) throw new Error("Calldata mancante");
    const { args } = decodeFunctionData({ abi: ERC20_TRANSFER_ABI, data: decoded.data });
    expect(args[1]).toBe(AMOUNT_18);
    expect(args[1]).not.toBe(25_000_000n); // non deve essere 6-decimal
  });

  it("ERC-20: network fee (gas) è in ETH/POL/BNB nativo — value nel tx deve essere 0", async () => {
    const signedHex = await captureSignedTx(() =>
      signAndBroadcastErc20Evm({
        mnemonic:          "test",
        chainId:           137,
        tokenContractAddr: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F",
        recipient:         HARDHAT_ADDR_1,
        amount:            1_000_000n,
        gasLimit:          65_000n,
        gasPrice:          30_000_000_000n,
        nonce:             0,
      })
    );
    const decoded = parseTransaction(signedHex);
    // Il value deve essere 0 — il gas è pagato in nativo separatamente
    expect(decoded.value ?? 0n).toBe(0n);
  });

  it("TX con nonce diversi producono hex firmati diversi (no replay possibile)", async () => {
    const params = {
      mnemonic:  "test",
      chainId:   137,
      to:        HARDHAT_ADDR_1 as const,
      valueWei:  1_000_000_000_000_000n,
      gasLimit:  21_000n,
      gasPrice:  30_000_000_000n,
    };
    const hex1 = await captureSignedTx(() =>
      signAndBroadcastNativeEvm({ ...params, nonce: 1 })
    );
    const hex2 = await captureSignedTx(() =>
      signAndBroadcastNativeEvm({ ...params, nonce: 2 })
    );
    expect(hex1).not.toBe(hex2);
    const tx1 = parseTransaction(hex1);
    const tx2 = parseTransaction(hex2);
    expect(tx1.nonce).toBe(1);
    expect(tx2.nonce).toBe(2);
  });

  it("TX stesso nonce su chain diversi producono hex diversi (EIP-155 replay protection)", async () => {
    const params = {
      mnemonic:  "test",
      to:        HARDHAT_ADDR_1 as const,
      valueWei:  1_000_000_000_000_000n,
      gasLimit:  21_000n,
      gasPrice:  30_000_000_000n,
      nonce:     5,
    };
    const ethHex = await captureSignedTx(() =>
      signAndBroadcastNativeEvm({ ...params, chainId: 1 })
    );
    const polHex = await captureSignedTx(() =>
      signAndBroadcastNativeEvm({ ...params, chainId: 137 })
    );
    // Stessa chiave, stesso nonce, chain diverse → tx incompatibili tra reti
    expect(ethHex).not.toBe(polHex);
    expect(Number(parseTransaction(ethHex).chainId)).toBe(1);
    expect(Number(parseTransaction(polHex).chainId)).toBe(137);
  });
});
