/**
 * Alpha Wallet — Backend Controller (Phase B + C)
 *
 * Proxy verso servizi blockchain (Alchemy, Blockstream, RPC) per il wallet nativo.
 *
 * ISOLAMENTO: non usa nulla del Payment Engine (multichain, usda, escrow, gas).
 * SICUREZZA:
 *   - Riceve solo address pubblici e transazioni già firmate
 *   - Non riceve mai: seed, private key, PIN, signing material
 *   - Le chiavi API (Alchemy, RPC) rimangono solo lato server
 */

import { type Request, type Response, type NextFunction } from "express";
import { createPublicClient, http, type PublicClient } from "viem";
import { mainnet, polygon, bsc } from "viem/chains";
import { AppError } from "../errors/AppError";
import {
  isVerifiedAddress,
  isSymbolConflict,
  getVerifiedTokensForChain,
} from "../wallet/token-registry-server";
import { UserModel }                 from "../models/user.model";
import { ConversationMemberModel }   from "../models/conversation-member.model";
import { AlphaWalletPaymentRequestModel } from "../models/alpha-wallet-payment-request.model";
import { wsManager }                 from "../lib/ws-manager";
import mongoose                      from "mongoose";
import pino from "pino";

const logger = pino({ name: "alpha-wallet-controller" });

const BLOCKSTREAM_BASE = "https://blockstream.info/api";
const SAT_PER_BTC = 100_000_000n;
const COINGECKO_PRICE_URL =
  "https://api.coingecko.com/api/v3/simple/price" +
  "?ids=ethereum,matic-network,binancecoin,bitcoin" +
  "&vs_currencies=usd,eur";

// ─── RPC clients per chain ─────────────────────────────────────────────────

function getRpcClient(chainId: number): PublicClient {
  const rpcUrl = (() => {
    switch (chainId) {
      case 1:   return process.env.ETHEREUM_RPC_URL ?? "https://cloudflare-eth.com";
      case 137: return process.env.POLYGON_RPC_URL  ?? "https://polygon-rpc.com";
      case 56:  return process.env.BSC_RPC_URL      ?? "https://bsc-dataseed.binance.org";
      default:  return null;
    }
  })();
  if (!rpcUrl) throw new AppError("UNSUPPORTED_CHAIN", 400);
  const chain = chainId === 1 ? mainnet : chainId === 137 ? polygon : bsc;
  return createPublicClient({ chain, transport: http(rpcUrl) });
}

// ABIs minimali
const ERC20_READ_ABI = [
  { name: "name",      type: "function", inputs: [], outputs: [{ type: "string" }], stateMutability: "view" },
  { name: "symbol",    type: "function", inputs: [], outputs: [{ type: "string" }], stateMutability: "view" },
  { name: "decimals",  type: "function", inputs: [], outputs: [{ type: "uint8"  }], stateMutability: "view" },
  { name: "balanceOf", type: "function", inputs: [{ name: "owner", type: "address" }], outputs: [{ type: "uint256" }], stateMutability: "view" },
] as const;

// ─── GET /evm/token-info ───────────────────────────────────────────────────

export async function getEvmTokenInfo(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const chainId = parseInt(req.query.chainId as string, 10);
    const address = (req.query.address as string)?.toLowerCase();

    if (!chainId || !address) throw new AppError("BAD_REQUEST", 400);
    if (!/^0x[0-9a-f]{38,40}$/i.test(address)) throw new AppError("INVALID_ADDRESS", 400);

    const client = getRpcClient(chainId);

    const [name, symbol, decimals] = await Promise.all([
      client.readContract({ address: address as `0x${string}`, abi: ERC20_READ_ABI, functionName: "name"     }).catch(() => "Unknown Token"),
      client.readContract({ address: address as `0x${string}`, abi: ERC20_READ_ABI, functionName: "symbol"   }).catch(() => "???"),
      client.readContract({ address: address as `0x${string}`, abi: ERC20_READ_ABI, functionName: "decimals" }).catch(() => 18),
    ]);

    const isVerified   = isVerifiedAddress(chainId, address);
    const symbolConflict = !isVerified && isSymbolConflict(chainId, symbol as string);

    res.json({ data: { chainId, contractAddress: address, name, symbol, decimals, isVerified, symbolConflict } });
  } catch (err) { next(err); }
}

// ─── GET /evm/balance ──────────────────────────────────────────────────────
// Returns native token balance + all verified ERC-20 token balances for this chain.

export async function getEvmBalance(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const chainId = parseInt(req.query.chainId as string, 10);
    const address  = (req.query.address as string)?.toLowerCase();
    if (!chainId || !address) throw new AppError("BAD_REQUEST", 400);
    if (!/^0x[0-9a-f]{38,42}$/.test(address)) throw new AppError("INVALID_ADDRESS", 400);

    const client = getRpcClient(chainId);
    const walletAddr = address as `0x${string}`;

    // Native balance
    const nativeBal = await client.getBalance({ address: walletAddr }).catch(() => 0n);
    const nativeSymbol = chainId === 1 ? "ETH" : chainId === 137 ? "POL" : "BNB";

    // Verified ERC-20 balances (parallel)
    const verifiedTokens = getVerifiedTokensForChain(chainId);

    // Optional extra custom-token addresses from the client (comma-separated)
    const extraRaw = (req.query.extraTokens as string | undefined) ?? "";
    const extraAddresses = extraRaw
      .split(",")
      .map(a => a.trim().toLowerCase())
      .filter(a => /^0x[0-9a-f]{40}$/.test(a));

    // Dedupe: skip extra addresses already covered by verified list
    const verifiedAddresses = new Set(verifiedTokens.map(t => t.contractAddress?.toLowerCase()));
    const uniqueExtras = extraAddresses.filter(a => !verifiedAddresses.has(a));

    // Query verified tokens
    const verifiedBalances = await Promise.all(
      verifiedTokens.map(async (t) => {
        try {
          const bal = await client.readContract({
            address: t.contractAddress as `0x${string}`,
            abi: ERC20_READ_ABI,
            functionName: "balanceOf",
            args: [walletAddr],
          }) as bigint;
          return { symbol: t.symbol, name: t.name, balance: bal.toString(), decimals: t.decimals, contractAddress: t.contractAddress, isCustom: false };
        } catch {
          return { symbol: t.symbol, name: t.name, balance: "0", decimals: t.decimals, contractAddress: t.contractAddress, isCustom: false };
        }
      })
    );

    // Query custom/extra tokens: fetch symbol/name/decimals + balanceOf in parallel per token
    const customBalances = await Promise.all(
      uniqueExtras.map(async (addr) => {
        try {
          const [nameRaw, symbolRaw, decimalsRaw, balRaw] = await Promise.all([
            client.readContract({ address: addr as `0x${string}`, abi: ERC20_READ_ABI, functionName: "name"     }).catch(() => "Unknown Token"),
            client.readContract({ address: addr as `0x${string}`, abi: ERC20_READ_ABI, functionName: "symbol"   }).catch(() => "???"),
            client.readContract({ address: addr as `0x${string}`, abi: ERC20_READ_ABI, functionName: "decimals" }).catch(() => 18),
            client.readContract({ address: addr as `0x${string}`, abi: ERC20_READ_ABI, functionName: "balanceOf", args: [walletAddr] }).catch(() => 0n),
          ]);
          return { symbol: symbolRaw as string, name: nameRaw as string, balance: (balRaw as bigint).toString(), decimals: decimalsRaw as number, contractAddress: addr, isCustom: true };
        } catch {
          return null;
        }
      })
    );

    const tokenBalances = [
      ...verifiedBalances,
      ...customBalances.filter((b): b is NonNullable<typeof b> => b !== null),
    ];

    res.json({
      data: {
        chainId,
        address,
        native: { symbol: nativeSymbol, name: nativeSymbol, balance: nativeBal.toString(), decimals: 18 },
        tokens: tokenBalances,
      },
    });
  } catch (err) { next(err); }
}

// ─── GET /evm/gas ──────────────────────────────────────────────────────────
// Estimates gas for a transaction. The frontend uses this before signing.

export async function getEvmGasEstimate(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const chainId = parseInt(req.query.chainId as string, 10);
    const from  = (req.query.from  as string | undefined)?.toLowerCase();
    const to    = (req.query.to    as string | undefined)?.toLowerCase();
    const data  = (req.query.data  as string | undefined) ?? "0x";
    const value = BigInt(req.query.value as string || "0");

    if (!chainId || !to) throw new AppError("BAD_REQUEST", 400);

    const client = getRpcClient(chainId);

    const walletAddr = from ? from as `0x${string}` : undefined;

    const [gasPrice, gasLimit, nonce] = await Promise.all([
      client.getGasPrice().catch(() => 30_000_000_000n), // fallback 30 gwei
      client.estimateGas({
        account: walletAddr,
        to:      to as `0x${string}`,
        data:    data as `0x${string}`,
        value,
      }).catch(() => 21_000n), // fallback for native transfer
      walletAddr
        ? client.getTransactionCount({ address: walletAddr }).catch(() => 0)
        : Promise.resolve(0),
    ]);

    // 10% buffer on gas limit
    const gasLimitWithBuffer = (gasLimit * 110n) / 100n;
    const totalFeeWei = gasLimitWithBuffer * gasPrice;

    res.json({
      data: {
        gasLimit:    gasLimitWithBuffer.toString(),
        gasPrice:    gasPrice.toString(),
        totalFeeWei: totalFeeWei.toString(),
        nonce,
        // Human-readable
        gasPriceGwei: (Number(gasPrice) / 1e9).toFixed(2),
        totalFeeEth:  (Number(totalFeeWei) / 1e18).toFixed(8),
      },
    });
  } catch (err) { next(err); }
}

// ─── POST /evm/broadcast ───────────────────────────────────────────────────
// Broadcasts a pre-signed EVM transaction. Does NOT receive private keys.

export async function broadcastEvmTx(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { chainId, signedTx } = req.body as { chainId: number; signedTx: string };
    if (!chainId || !signedTx) throw new AppError("BAD_REQUEST", 400);
    if (!/^0x[0-9a-f]+$/i.test(signedTx)) throw new AppError("INVALID_TX", 400);

    const client = getRpcClient(chainId);

    let txHash: string;
    try {
      txHash = await (client as any).sendRawTransaction({
        serializedTransaction: signedTx as `0x${string}`,
      });
    } catch (rpcErr: any) {
      const msg = rpcErr?.message ?? rpcErr?.details ?? "Broadcast fallito";
      // Map RPC errors to friendly codes
      if (msg.includes("insufficient funds")) throw new AppError("INSUFFICIENT_FUNDS", 400);
      if (msg.includes("nonce too low")) throw new AppError("NONCE_TOO_LOW", 400);
      if (msg.includes("replacement transaction underpriced")) throw new AppError("TX_UNDERPRICED", 400);
      throw new AppError("BROADCAST_ERROR", 502);
    }

    res.json({ data: { txHash } });
  } catch (err) { next(err); }
}

// ─── GET /btc/balance ──────────────────────────────────────────────────────

export async function getBtcBalance(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const address = req.query.address as string;
    if (!address) throw new AppError("BAD_REQUEST", 400);
    if (!/^(bc1|[13])[a-zA-Z0-9]{25,87}$/.test(address)) {
      throw new AppError("INVALID_BTC_ADDRESS", 400);
    }

    const resp = await fetch(`${BLOCKSTREAM_BASE}/address/${address}`, {
      headers: { "User-Agent": "AlphaChat-Wallet/1.0" },
    });
    if (!resp.ok) throw new AppError("BLOCKSTREAM_ERROR", 502);

    const raw = await resp.json() as Record<string, unknown>;

    // Blockstream restituisce "chain_stats" (confermati) + "mempool_stats" (in attesa)
    const stats        = (raw.chain_stats  as Record<string,number> | null | undefined) ?? {};
    const mempoolStats = (raw.mempool_stats as Record<string,number> | null | undefined) ?? {};

    const data = {
      stats: {
        funded_txo_sum:   stats.funded_txo_sum   ?? 0,
        spent_txo_sum:    stats.spent_txo_sum    ?? 0,
        funded_txo_count: stats.funded_txo_count ?? 0,
        spent_txo_count:  stats.spent_txo_count  ?? 0,
        tx_count:         stats.tx_count         ?? 0,
      },
      mempool_stats: {
        funded_txo_sum: mempoolStats.funded_txo_sum ?? 0,
        spent_txo_sum:  mempoolStats.spent_txo_sum  ?? 0,
      },
    };

    const confirmedSat   = data.stats.funded_txo_sum - data.stats.spent_txo_sum;
    const mempoolDeltaSat = (data.mempool_stats.funded_txo_sum - data.mempool_stats.spent_txo_sum);
    const totalSat = confirmedSat + mempoolDeltaSat;

    res.json({
      data: {
        address,
        confirmedSat,
        mempoolDeltaSat,
        totalSat,
        confirmedBtc: (BigInt(confirmedSat) / SAT_PER_BTC).toString() + "." +
                      (BigInt(confirmedSat) % SAT_PER_BTC).toString().padStart(8, "0"),
        txCount: data.stats.tx_count,
      },
    });
  } catch (err) { next(err); }
}

// ─── GET /btc/utxos ────────────────────────────────────────────────────────

export async function getBtcUTXOs(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const address = req.query.address as string;
    if (!address) throw new AppError("BAD_REQUEST", 400);
    if (!/^(bc1|[13])[a-zA-Z0-9]{25,87}$/.test(address)) {
      throw new AppError("INVALID_BTC_ADDRESS", 400);
    }

    const resp = await fetch(`${BLOCKSTREAM_BASE}/address/${address}/utxo`, {
      headers: { "User-Agent": "AlphaChat-Wallet/1.0" },
    });
    if (!resp.ok) throw new AppError("BLOCKSTREAM_ERROR", 502);

    const utxos = await resp.json() as Array<{
      txid: string;
      vout: number;
      status: { confirmed: boolean; block_height?: number };
      value: number; // satoshi
    }>;

    // Only return confirmed UTXOs for signing (safer)
    const confirmed = utxos.filter(u => u.status.confirmed);

    res.json({
      data: {
        address,
        utxos: confirmed.map(u => ({
          txid:        u.txid,
          vout:        u.vout,
          value:       u.value, // satoshi
          confirmed:   u.status.confirmed,
          blockHeight: u.status.block_height,
        })),
        totalSat: confirmed.reduce((s, u) => s + u.value, 0),
      },
    });
  } catch (err) { next(err); }
}

// ─── POST /btc/broadcast ───────────────────────────────────────────────────

export async function broadcastBtcTx(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { txHex } = req.body as { txHex: string };
    if (!txHex) throw new AppError("BAD_REQUEST", 400);
    if (!/^[0-9a-f]+$/i.test(txHex)) throw new AppError("INVALID_TX_HEX", 400);

    const resp = await fetch(`${BLOCKSTREAM_BASE}/tx`, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain",
        "User-Agent":   "AlphaChat-Wallet/1.0",
      },
      body: txHex,
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => `HTTP ${resp.status}`);
      if (errText.includes("dust")) throw new AppError("BTC_DUST", 400);
      if (errText.includes("mempool")) throw new AppError("BTC_MEMPOOL", 400);
      throw new AppError("BTC_BROADCAST_ERROR", 502);
    }

    const txid = await resp.text(); // Blockstream returns txid as plain text
    res.json({ data: { txid: txid.trim() } });
  } catch (err) { next(err); }
}

// ─── GET /btc/fee-rate ─────────────────────────────────────────────────────

export async function getBtcFeeRate(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const resp = await fetch(`${BLOCKSTREAM_BASE}/fee-estimates`, {
      headers: { "User-Agent": "AlphaChat-Wallet/1.0" },
    });
    if (!resp.ok) throw new AppError("BLOCKSTREAM_ERROR", 502);

    const estimates = await resp.json() as Record<string, number>;
    // Return: 1-block (fastest), 6-block (normal), 144-block (economy)
    const fastest = estimates["1"]  ?? 20;
    const normal  = estimates["6"]  ?? 10;
    const economy = estimates["144"] ?? 5;

    res.json({ data: { fastest, normal, economy } });
  } catch (err) { next(err); }
}

// ─── GET /prices ───────────────────────────────────────────────────────────
// Returns fiat prices for wallet assets. Cached 5 minutes. Isolated from Payment Engine.

interface PriceCache {
  data: WalletPrices;
  fetchedAt: number;
}
let _priceCache: PriceCache | null = null;
const PRICE_CACHE_TTL_MS = 5 * 60_000;

interface WalletPrices {
  eth:  { usd: number; eur: number };
  pol:  { usd: number; eur: number };
  bnb:  { usd: number; eur: number };
  btc:  { usd: number; eur: number };
  usdt: { usd: number; eur: number };
  usdc: { usd: number; eur: number };
  usda: { usd: number; eur: number };
}

export async function getWalletPrices(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const now = Date.now();
    if (_priceCache && now - _priceCache.fetchedAt < PRICE_CACHE_TTL_MS) {
      res.json({ data: _priceCache.data });
      return;
    }

    let prices: WalletPrices = {
      eth:  { usd: 0, eur: 0 },
      pol:  { usd: 0, eur: 0 },
      bnb:  { usd: 0, eur: 0 },
      btc:  { usd: 0, eur: 0 },
      usdt: { usd: 1, eur: 0.91 },
      usdc: { usd: 1, eur: 0.91 },
      usda: { usd: 1, eur: 0.91 },
    };

    try {
      const resp = await fetch(COINGECKO_PRICE_URL, {
        headers: { "User-Agent": "AlphaChat-Wallet/1.0" },
        signal: AbortSignal.timeout(8000),
      });
      if (resp.ok) {
        const data = await resp.json() as Record<string, { usd: number; eur: number }>;
        prices = {
          eth:  data["ethereum"]      ?? prices.eth,
          pol:  data["matic-network"] ?? prices.pol,
          bnb:  data["binancecoin"]   ?? prices.bnb,
          btc:  data["bitcoin"]       ?? prices.btc,
          usdt: prices.usdt,
          usdc: prices.usdc,
          usda: prices.usda,
        };
      }
    } catch {
      logger.warn("CoinGecko unavailable — returning cached/zero prices");
    }

    _priceCache = { data: prices, fetchedAt: now };
    res.json({ data: prices });
  } catch (err) { next(err); }
}

// ─── GET /evm/transactions ─────────────────────────────────────────────────

const ALCHEMY_URLS: Record<number, string> = {
  1:   `https://eth-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`,
  137: `https://polygon-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`,
  56:  "",
};

// ─── EVM Transaction Receipt ──────────────────────────────────────────────

/**
 * GET /evm/receipt?chainId=137&txHash=0x...
 *
 * Chiama eth_getTransactionReceipt tramite il client viem server-side.
 * Restituisce status: "confirmed" | "failed" | "pending"
 * "pending" = la TX esiste in mempool ma non ancora minata, o hash sconosciuto.
 *
 * SICUREZZA: non espone private key né material di firma.
 * Accetta solo hash pubblico + chainId.
 */
export async function getEvmReceipt(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const chainId = parseInt(req.query.chainId as string, 10);
    const txHash  = (req.query.txHash as string)?.trim();

    if (!chainId || !txHash || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
      throw new AppError("BAD_REQUEST", 400);
    }

    const client = getRpcClient(chainId);

    let receipt: Awaited<ReturnType<typeof client.getTransactionReceipt>> | null = null;
    try {
      receipt = await client.getTransactionReceipt({ hash: txHash as `0x${string}` });
    } catch {
      // Hash non trovato in nessun blocco → ancora pending
    }

    if (!receipt) {
      // Verifica se almeno è in mempool (non ancora minata)
      res.json({ data: { status: "pending", blockNumber: null } });
      return;
    }

    const status = receipt.status === "success" ? "confirmed" : "failed";
    res.json({ data: { status, blockNumber: Number(receipt.blockNumber ?? 0n) } });
  } catch (err) { next(err); }
}

export async function getEvmTransactions(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const chainId   = parseInt(req.query.chainId as string, 10);
    const address   = (req.query.address as string)?.toLowerCase();
    const fromBlock = (req.query.fromBlock as string) ?? "0x0";

    if (!chainId || !address) throw new AppError("BAD_REQUEST", 400);

    const alchemyUrl = ALCHEMY_URLS[chainId];
    let transfers: object[] = [];
    let latestBlock = "0x0";

    if (alchemyUrl) {
      const [inRes, outRes, blockRes] = await Promise.all([
        fetch(alchemyUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "alchemy_getAssetTransfers", params: [{ fromBlock, toAddress: address, category: ["external", "erc20"], withMetadata: true, maxCount: "0x32" }] }),
        }).then(r => r.json()),
        fetch(alchemyUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "alchemy_getAssetTransfers", params: [{ fromBlock, fromAddress: address, category: ["external", "erc20"], withMetadata: true, maxCount: "0x32" }] }),
        }).then(r => r.json()),
        fetch(alchemyUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "eth_blockNumber", params: [] }),
        }).then(r => r.json()),
      ]);

      const _blockRes = blockRes as { result?: string };
      const _inRes    = inRes    as { result?: { transfers?: AlchemyTransfer[] } };
      const _outRes   = outRes   as { result?: { transfers?: AlchemyTransfer[] } };
      latestBlock = _blockRes?.result ?? "0x0";
      const inT = (_inRes?.result?.transfers ?? []) as AlchemyTransfer[];
      const outT = (_outRes?.result?.transfers ?? []) as AlchemyTransfer[];
      transfers = [...inT.map(t => _mapAlchemy(t, address, "in", chainId)), ...outT.map(t => _mapAlchemy(t, address, "out", chainId))].sort((a: any, b: any) => (b.blockNum > a.blockNum ? 1 : -1));
    } else {
      logger.warn({ chainId }, "BSC tx history non disponibile senza Alchemy BSC");
    }

    res.json({ data: { transfers, latestBlock } });
  } catch (err) { next(err); }
}

interface AlchemyTransfer {
  hash: string; from: string; to: string; value: number | null; asset: string | null;
  category: string; blockNum: string;
  metadata?: { blockTimestamp?: string };
  rawContract?: { address?: string };
  log?: { logIndex?: number };
}

function _mapAlchemy(t: AlchemyTransfer, myAddress: string, dir: "in" | "out", chainId: number) {
  const ts = t.metadata?.blockTimestamp ? Math.floor(new Date(t.metadata.blockTimestamp).getTime() / 1000) : undefined;
  return { hash: t.hash, from: t.from, to: t.to ?? "", value: t.value != null ? String(t.value) : "0", asset: t.asset ?? (chainId === 1 ? "ETH" : chainId === 137 ? "POL" : "BNB"), category: t.category, blockNum: t.blockNum, timestamp: ts, status: "confirmed" as const, direction: dir, logIndex: t.log?.logIndex, contractAddress: t.rawContract?.address };
}

// ─── GET /btc/transactions ─────────────────────────────────────────────────

export async function getBtcTransactions(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const address = req.query.address as string;
    if (!address) throw new AppError("BAD_REQUEST", 400);
    if (!/^(bc1|[13])[a-zA-Z0-9]{25,87}$/.test(address)) throw new AppError("INVALID_BTC_ADDRESS", 400);

    const response = await fetch(`${BLOCKSTREAM_BASE}/address/${address}/txs`, { headers: { "User-Agent": "AlphaChat-Wallet/1.0" } });
    if (!response.ok) {
      if (response.status === 400) throw new AppError("INVALID_BTC_ADDRESS", 400);
      throw new AppError("BLOCKSTREAM_ERROR", 502);
    }

    const rawTxs = await response.json() as BlockstreamTx[];
    const txs = rawTxs.map(tx => {
      let valueSat = 0;
      for (const vout of tx.vout) { if (vout.scriptpubkey_address === address) valueSat += vout.value; }
      for (const vin of tx.vin) { if (vin.prevout?.scriptpubkey_address === address) valueSat -= vin.prevout.value; }
      const dir: "in" | "out" = valueSat >= 0 ? "in" : "out";
      const confirmed = tx.status.confirmed;
      return { txid: tx.txid, valueSat: Math.abs(valueSat), valueBtc: (Math.abs(valueSat) / 100_000_000).toFixed(8), confirmed, confirmations: confirmed ? 1 : 0, timestamp: tx.status.block_time, direction: dir, status: confirmed ? "confirmed" : "pending", blockHeight: tx.status.block_height };
    });

    res.json({ data: { txs } });
  } catch (err) { next(err); }
}

interface BlockstreamTx {
  txid: string;
  vin: Array<{ prevout?: { scriptpubkey_address: string; value: number } }>;
  vout: Array<{ scriptpubkey_address: string; value: number }>;
  status: { confirmed: boolean; block_height?: number; block_time?: number };
}

// ─── Phase G: Platform Fee Config ──────────────────────────────────────────

import {
  AlphaWalletFeeConfigModel,
  getAlphaWalletFeeConfig as _loadFeeConfig,
  ALPHA_WALLET_FEE_DEFAULTS,
} from "../models/alpha-wallet-fee-config.model";
import {
  AlphaWalletFeeRecordModel,
  emitPermanentFeeFailureAlert,
  type FeeRecordStatus,
  type IAlphaWalletFeeRecord,
} from "../models/alpha-wallet-fee-record.model";
import { logAuditEvent } from "../lib/audit";

/**
 * GET /api/v1/alpha-wallet/fee-config
 * Recupera la configurazione Platform Fee. Accessibile a tutti gli utenti autenticati
 * (l'indirizzo fee wallet è pubblico on-chain).
 */
export async function getFeeConfig(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const cfg = await _loadFeeConfig();
    res.json({
      data: {
        fee_bps:            cfg.fee_bps,
        quote_validity_sec: cfg.quote_validity_sec,
        min_fee_usdt:       cfg.min_fee_usdt   ?? ALPHA_WALLET_FEE_DEFAULTS.min_fee_usdt,
        min_fee_btc_sat:    cfg.min_fee_btc_sat ?? ALPHA_WALLET_FEE_DEFAULTS.min_fee_btc_sat,
        // Fee wallet addresses — public on-chain, safe to expose to authenticated users
        fee_wallet_evm: process.env.POLYGON_FEE_WALLET ?? null,
        fee_wallet_btc: process.env.BTC_FEE_WALLET     ?? null,
        updated_at:     cfg.updated_at     ?? null,
        updated_by_email: cfg.updated_by_email ?? null,
      },
    });
  } catch (err) { next(err); }
}

/**
 * PATCH /api/v1/alpha-wallet/fee-config
 * Aggiorna la Platform Fee. Richiede ruolo super_admin.
 * Registra un audit log per ogni modifica.
 */
export async function updateFeeConfig(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const adminUser = (req as any).user as { userId: string; email?: string };
    const { fee_bps, quote_validity_sec, min_fee_usdt, min_fee_btc_sat } = req.body as {
      fee_bps?:            number;
      quote_validity_sec?: number;
      min_fee_usdt?:       number;
      min_fee_btc_sat?:    number;
    };

    // Validazione
    if (fee_bps !== undefined) {
      if (typeof fee_bps !== "number" || !Number.isInteger(fee_bps) || fee_bps < 0 || fee_bps > 500) {
        res.status(400).json({ error: "FEE_BPS_INVALID", message: "fee_bps deve essere un intero tra 0 e 500" });
        return;
      }
    }
    if (quote_validity_sec !== undefined) {
      if (typeof quote_validity_sec !== "number" || !Number.isInteger(quote_validity_sec) || quote_validity_sec < 5 || quote_validity_sec > 300) {
        res.status(400).json({ error: "QUOTE_VALIDITY_INVALID", message: "quote_validity_sec deve essere un intero tra 5 e 300" });
        return;
      }
    }
    if (min_fee_usdt !== undefined) {
      if (typeof min_fee_usdt !== "number" || isNaN(min_fee_usdt) || min_fee_usdt < 0) {
        res.status(400).json({ error: "MIN_FEE_USDT_INVALID", message: "min_fee_usdt deve essere un numero non negativo" });
        return;
      }
    }
    if (min_fee_btc_sat !== undefined) {
      if (typeof min_fee_btc_sat !== "number" || !Number.isInteger(min_fee_btc_sat) || min_fee_btc_sat < 0) {
        res.status(400).json({ error: "MIN_FEE_BTC_SAT_INVALID", message: "min_fee_btc_sat deve essere un intero non negativo (satoshi)" });
        return;
      }
    }

    // Carica config precedente per audit
    const prev = await _loadFeeConfig();

    // Aggiorna
    const updated = await AlphaWalletFeeConfigModel.findOneAndUpdate(
      { _id: "alpha-wallet-fee" },
      {
        $set: {
          ...(fee_bps            !== undefined ? { fee_bps }            : {}),
          ...(quote_validity_sec !== undefined ? { quote_validity_sec } : {}),
          ...(min_fee_usdt       !== undefined ? { min_fee_usdt }       : {}),
          ...(min_fee_btc_sat    !== undefined ? { min_fee_btc_sat }    : {}),
          updated_at:       new Date(),
          updated_by:       adminUser.userId,
          updated_by_email: adminUser.email ?? null,
        },
      },
      { upsert: true, returnDocument: "after" },
    );

    // Audit log
    logAuditEvent({
      event:   "ALPHA_WALLET_FEE_UPDATED",
      user_id: adminUser.userId,
      ip_hash: req.ip ?? undefined,
      created_at: new Date().toISOString(),
      metadata: {
        prev_fee_bps:       prev.fee_bps,
        new_fee_bps:        updated?.fee_bps        ?? prev.fee_bps,
        prev_validity:      prev.quote_validity_sec,
        new_validity:       updated?.quote_validity_sec ?? prev.quote_validity_sec,
        prev_min_usdt:      prev.min_fee_usdt,
        new_min_usdt:       updated?.min_fee_usdt   ?? prev.min_fee_usdt,
        prev_min_btc_sat:   prev.min_fee_btc_sat,
        new_min_btc_sat:    updated?.min_fee_btc_sat ?? prev.min_fee_btc_sat,
      },
    });

    res.json({
      data: {
        ok:                true,
        fee_bps:           updated?.fee_bps,
        quote_validity_sec: updated?.quote_validity_sec,
        min_fee_usdt:      updated?.min_fee_usdt,
        min_fee_btc_sat:   updated?.min_fee_btc_sat,
      },
    });
  } catch (err) { next(err); }
}

// ─── Phase G #90: Fee Record endpoints ────────────────────────────────────

/**
 * POST /api/v1/alpha-wallet/fee-record
 *
 * Registra l'esito di una raccolta platform fee (success o failure).
 * Idempotency key: _id = mainTxHash — un record per TX principale.
 *
 * SICUREZZA §17: nessun dato privato nel payload — solo txHash, rete, importo, status.
 */
export async function recordFeeOutcome(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const {
      mainTxHash, network, assetSymbol, feeAmount, feeWallet,
      status, feeTxHash, attempts, error,
    } = req.body as {
      mainTxHash:  string;
      network:     string;
      assetSymbol: string;
      feeAmount:   string;
      feeWallet:   string;
      status:      FeeRecordStatus;
      feeTxHash?:  string;
      attempts:    number;
      error?:      string;
    };

    if (!mainTxHash || !network || !assetSymbol || !status) {
      res.status(400).json({ error: "FEE_RECORD_INVALID", message: "mainTxHash, network, assetSymbol, status obbligatori" });
      return;
    }

    // Idempotency: se esiste già un record "success" per questo mainTxHash, non sovrascrivere
    const existing = await AlphaWalletFeeRecordModel.findById(mainTxHash) as IAlphaWalletFeeRecord | null;
    if (existing?.status === "success") {
      res.json({ data: { ok: true, idempotent: true } });
      return;
    }

    const record = await AlphaWalletFeeRecordModel.findOneAndUpdate(
      { _id: mainTxHash },
      {
        $set: {
          network, assetSymbol, feeAmount, feeWallet, status,
          attempts: attempts ?? 1,
          ...(feeTxHash ? { feeTxHash }  : {}),
          ...(error     ? { lastError: error } : {}),
        },
      },
      { upsert: true, returnDocument: "after" },
    ) as IAlphaWalletFeeRecord | null;

    // Allerta strutturata su fallimento permanente
    if (status === "failed_permanent") {
      emitPermanentFeeFailureAlert(record ?? {
        _id: mainTxHash, network, assetSymbol, feeAmount,
        feeWallet, attempts, lastError: error,
      } as Partial<IAlphaWalletFeeRecord>);

      logAuditEvent({
        event:    "ALPHA_WALLET_FEE_FAILED",
        user_id:  ((req as unknown as Record<string, unknown>).user as { userId?: string })?.userId,
        ip_hash:  req.ip ?? undefined,
        created_at: new Date().toISOString(),
        metadata: { mainTxHash, network, assetSymbol, feeAmount, attempts, error },
      });
    }

    res.json({ data: { ok: true, idempotent: false } });
  } catch (err) { next(err); }
}

/**
 * GET /api/v1/alpha-wallet/fee-records
 * Lista record fee con summary aggregato — richiede super_admin.
 */
export async function getFeeRecords(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { status, network, limit = "50" } = req.query as {
      status?:  string;
      network?: string;
      limit?:   string;
    };

    const filter: Record<string, unknown> = {};
    if (status)  filter["status"]  = status;
    if (network) filter["network"] = network;

    const records = await AlphaWalletFeeRecordModel
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(Math.min(parseInt(limit, 10) || 50, 200))
      .lean();

    const [total, success, failedTransient, failedPermanent] = await Promise.all([
      AlphaWalletFeeRecordModel.countDocuments({}),
      AlphaWalletFeeRecordModel.countDocuments({ status: "success" }),
      AlphaWalletFeeRecordModel.countDocuments({ status: "failed_transient" }),
      AlphaWalletFeeRecordModel.countDocuments({ status: "failed_permanent" }),
    ]);

    res.json({
      data: {
        records,
        summary: {
          total,
          success,
          failed_transient: failedTransient,
          failed_permanent: failedPermanent,
        },
      },
    });
  } catch (err) { next(err); }
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase G — Richiedi con Alpha Wallet (Payment Requests)
// ─────────────────────────────────────────────────────────────────────────────

const REQUEST_TTL_MS = 24 * 60 * 60 * 1000; // 24h

/**
 * POST /api/v1/alpha-wallet/payment-requests
 *
 * Crea una richiesta di pagamento self-custodial.
 * Body: { payerUserId, conversationId, network, assetSymbol, amount, requesterAddress }
 *
 * SICUREZZA: non riceve mai seed, private key, PIN.
 * Solo indirizzo pubblico del requester (per inviare i fondi).
 */
export async function createAlphaWalletPaymentRequest(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const requesterId = (req as any).user?.userId as string | undefined;
    if (!requesterId) throw new AppError("UNAUTHORIZED", 401);

    const {
      payerUserId,
      conversationId,
      network,
      assetSymbol,
      amount,
      requesterAddress,
    } = req.body as Record<string, unknown>;

    if (typeof payerUserId !== "string" || !mongoose.Types.ObjectId.isValid(payerUserId))
      throw new AppError("INVALID_PAYER_ID", 400);
    if (typeof conversationId !== "string" || !mongoose.Types.ObjectId.isValid(conversationId))
      throw new AppError("INVALID_CONVERSATION_ID", 400);
    if (typeof network !== "string" || !["polygon","ethereum","bsc","bitcoin"].includes(network))
      throw new AppError("INVALID_NETWORK", 400);
    if (typeof assetSymbol !== "string" || !assetSymbol.trim())
      throw new AppError("INVALID_ASSET_SYMBOL", 400);
    if (typeof amount !== "string" || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0)
      throw new AppError("INVALID_AMOUNT", 400);
    if (
      typeof requesterAddress !== "string" ||
      (network !== "bitcoin" && !/^0x[0-9a-fA-F]{40}$/.test(requesterAddress)) ||
      (network === "bitcoin" && !/^(bc1|[13])[a-zA-Z0-9]{25,87}$/.test(requesterAddress))
    ) throw new AppError("INVALID_REQUESTER_ADDRESS", 400);
    if (payerUserId === requesterId) throw new AppError("CANNOT_REQUEST_FROM_SELF", 400);

    // Verifica che payer esista
    const payerExists = await UserModel.exists({ _id: new mongoose.Types.ObjectId(payerUserId) });
    if (!payerExists) throw new AppError("PAYER_NOT_FOUND", 404);

    const expiresAt = new Date(Date.now() + REQUEST_TTL_MS);

    const doc = await AlphaWalletPaymentRequestModel.create({
      requester_id:      new mongoose.Types.ObjectId(requesterId),
      payer_id:          new mongoose.Types.ObjectId(payerUserId),
      conversation_id:   new mongoose.Types.ObjectId(conversationId as string),
      network,
      asset_symbol:      assetSymbol,
      amount,
      requester_address: requesterAddress,
      status:            "pending",
      expires_at:        expiresAt,
    });

    res.status(201).json({
      data: {
        requestId:  (doc._id as mongoose.Types.ObjectId).toString(),
        expiresAt:  expiresAt.toISOString(),
      },
    });
  } catch (err) { next(err); }
}

/**
 * GET /api/v1/alpha-wallet/payment-requests/:id
 *
 * Restituisce lo stato corrente di una richiesta.
 * Accessibile solo da requester o payer (verifica _id appartenenza).
 */
export async function getAlphaWalletPaymentRequest(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const userId = (req as any).user?.userId as string | undefined;
    if (!userId) throw new AppError("UNAUTHORIZED", 401);

    const { id } = req.params as { id: string };
    if (!mongoose.Types.ObjectId.isValid(id)) throw new AppError("INVALID_REQUEST_ID", 400);

    const doc = await AlphaWalletPaymentRequestModel
      .findById(id)
      .select("requester_id payer_id status tx_hash expires_at network asset_symbol amount requester_address")
      .lean();

    if (!doc) throw new AppError("REQUEST_NOT_FOUND", 404);

    // Solo requester o payer possono vedere
    const rid = doc.requester_id.toString();
    const pid = doc.payer_id.toString();
    if (userId !== rid && userId !== pid) throw new AppError("FORBIDDEN", 403);

    // Controlla scadenza
    const expired = new Date() > new Date(doc.expires_at) && doc.status === "pending";
    const effectiveStatus = expired ? "expired" : doc.status;

    res.json({
      data: {
        requestId:        id,
        status:           effectiveStatus,
        txHash:           doc.tx_hash ?? null,
        network:          doc.network,
        assetSymbol:      doc.asset_symbol,
        amount:           doc.amount,
        requesterAddress: doc.requester_address,
        expiresAt:        new Date(doc.expires_at).getTime(),
      },
    });
  } catch (err) { next(err); }
}

/**
 * PATCH /api/v1/alpha-wallet/payment-requests/:id/paid
 *
 * Il payer segnala di aver eseguito il pagamento (dopo TX broadcast).
 * Body: { txHash }
 * Emette WS aw_payment_request.state_changed a requester e payer.
 */
export async function markAlphaWalletRequestPaid(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const userId = (req as any).user?.userId as string | undefined;
    if (!userId) throw new AppError("UNAUTHORIZED", 401);

    const { id } = req.params as { id: string };
    if (!mongoose.Types.ObjectId.isValid(id)) throw new AppError("INVALID_REQUEST_ID", 400);

    const { txHash } = req.body as { txHash?: unknown };
    if (typeof txHash !== "string" || !txHash.trim()) throw new AppError("INVALID_TX_HASH", 400);

    const doc = await AlphaWalletPaymentRequestModel.findById(id).lean();
    if (!doc) throw new AppError("REQUEST_NOT_FOUND", 404);

    // Solo il payer può marcare come paid
    if (doc.payer_id.toString() !== userId) throw new AppError("FORBIDDEN", 403);
    if (doc.status !== "pending") {
      // Idempotente: se già paid restituisce OK
      res.json({ data: { ok: true, status: doc.status } });
      return;
    }

    await AlphaWalletPaymentRequestModel.updateOne(
      { _id: doc._id, status: "pending" },
      { $set: { status: "paid", tx_hash: txHash } },
    );

    // Notifica WS a entrambe le parti
    const payload = {
      requestId: id,
      status:    "paid" as const,
      txHash,
    };
    wsManager.sendToUsers(
      [doc.requester_id.toString(), doc.payer_id.toString()],
      { type: "aw_payment_request.state_changed", payload },
    );

    logger.info({ requestId: id, txHash }, "aw_payment_request marked paid");

    res.json({ data: { ok: true, status: "paid" } });
  } catch (err) { next(err); }
}

// ─────────────────────────────────────────────────────────────────────────────
// Task #93 — Recipient Wallet Discovery
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/v1/alpha-wallet/register-address
 *
 * Persiste gli indirizzi Alpha Wallet pubblici dell'utente autenticato.
 * Chiamato dal client dopo createWallet / importWallet (best-effort).
 * NON riceve mai seed, private key, PIN o keystore.
 */
export async function registerAlphaWalletAddress(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const userId = (req as any).user?.userId as string | undefined;
    if (!userId) throw new AppError("UNAUTHORIZED", 401);

    const { evmAddress, btcAddress } = req.body as {
      evmAddress?: unknown;
      btcAddress?: unknown;
    };

    if (
      typeof evmAddress !== "string" ||
      !/^0x[0-9a-fA-F]{40}$/.test(evmAddress)
    ) {
      throw new AppError("INVALID_EVM_ADDRESS", 400);
    }

    if (btcAddress !== undefined && btcAddress !== null) {
      if (
        typeof btcAddress !== "string" ||
        !/^(bc1|[13])[a-zA-Z0-9]{25,87}$/.test(btcAddress)
      ) {
        throw new AppError("INVALID_BTC_ADDRESS", 400);
      }
    }

    const update: Record<string, unknown> = {
      alpha_wallet_evm_address: evmAddress,
    };
    if (typeof btcAddress === "string") {
      update["alpha_wallet_btc_address"] = btcAddress;
    }

    await UserModel.updateOne(
      { _id: new mongoose.Types.ObjectId(userId) },
      { $set: update },
    );

    res.json({ data: { ok: true } });
  } catch (err) { next(err); }
}

/**
 * GET /api/v1/alpha-wallet/recipient/:userId
 *
 * Restituisce gli indirizzi Alpha Wallet pubblici di un utente destinatario.
 *
 * SICUREZZA:
 *   - Autenticato (JWT — gestito da router.use(authenticate))
 *   - Verifica che requester e target condividano una conversazione attiva
 *   - 403 se non esiste conversazione comune
 *   - Non espone mai: seed, mnemonic, private key, PIN, keystore, dati IDB
 *
 * REGOLA §12: un evento WebSocket NON può mai chiamare questo endpoint
 * per avviare automaticamente una firma — solo l'azione esplicita dell'utente
 * apre ChatWalletPaySheet che chiama questo endpoint.
 */
export async function getAlphaWalletRecipient(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const requesterId = (req as any).user?.userId as string | undefined;
    if (!requesterId) throw new AppError("UNAUTHORIZED", 401);

    const { userId: targetId } = req.params as { userId: string };

    if (!targetId || !mongoose.Types.ObjectId.isValid(targetId)) {
      throw new AppError("INVALID_USER_ID", 400);
    }
    if (targetId === requesterId) {
      throw new AppError("CANNOT_LOOKUP_SELF", 400);
    }

    // ── Verifica conversazione condivisa ───────────────────────────────────
    const myMemberships = await ConversationMemberModel
      .find({
        user_id:    new mongoose.Types.ObjectId(requesterId),
        left_at:    null,
        deleted_at: null,
      })
      .select("conversation_id")
      .lean();

    if (myMemberships.length === 0) {
      throw new AppError("FORBIDDEN", 403);
    }

    const myConvIds = myMemberships.map(m => m.conversation_id);

    const sharedMembership = await ConversationMemberModel.findOne({
      conversation_id: { $in: myConvIds },
      user_id:         new mongoose.Types.ObjectId(targetId),
      left_at:         null,
      deleted_at:      null,
    }).lean();

    if (!sharedMembership) {
      throw new AppError("FORBIDDEN", 403);
    }

    // ── Legge solo i campi pubblici Alpha Wallet ───────────────────────────
    const targetUser = await UserModel
      .findById(targetId)
      .select("alpha_wallet_evm_address alpha_wallet_btc_address")
      .lean();

    if (!targetUser) throw new AppError("USER_NOT_FOUND", 404);

    const evmAddress = targetUser.alpha_wallet_evm_address ?? null;
    const btcAddress = targetUser.alpha_wallet_btc_address ?? null;
    const hasAlphaWallet = evmAddress !== null;

    res.json({
      data: {
        hasAlphaWallet,
        ...(evmAddress ? { evmAddress } : {}),
        ...(btcAddress ? { btcAddress } : {}),
      },
    });
  } catch (err) { next(err); }
}
