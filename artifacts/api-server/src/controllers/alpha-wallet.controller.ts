/**
 * Alpha Wallet — Backend Controller
 *
 * Proxy verso servizi blockchain (Alchemy, Blockstream) per il nuovo wallet.
 *
 * ISOLAMENTO: non usa nulla del Payment Engine (multichain, usda, escrow, gas).
 * SICUREZZA: riceve solo address pubblici, non espone chiavi API all'utente.
 *
 * Endpoint:
 *   GET /api/v1/alpha-wallet/evm/token-info?chainId=137&address=0x...
 *   GET /api/v1/alpha-wallet/evm/transactions?chainId=137&address=0x...&fromBlock=0x...
 *   GET /api/v1/alpha-wallet/btc/transactions?address=bc1q...
 */

import { type Request, type Response, type NextFunction } from "express";
import { createPublicClient, http, type PublicClient } from "viem";
import { mainnet, polygon, bsc } from "viem/chains";
import { AppError } from "../errors/AppError";
import { isVerifiedAddress, isSymbolConflict } from "../wallet/token-registry-server";
import pino from "pino";

const logger = pino({ name: "alpha-wallet-controller" });

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
  if (!rpcUrl) throw new AppError(400, "UNSUPPORTED_CHAIN", `chainId ${chainId} non supportato`);
  const chain = chainId === 1 ? mainnet : chainId === 137 ? polygon : bsc;
  return createPublicClient({ chain, transport: http(rpcUrl) });
}

// ERC-20 ABI minimal (name, symbol, decimals)
const ERC20_ABI = [
  { name: "name",     type: "function", inputs: [], outputs: [{ type: "string" }],  stateMutability: "view" },
  { name: "symbol",   type: "function", inputs: [], outputs: [{ type: "string" }],  stateMutability: "view" },
  { name: "decimals", type: "function", inputs: [], outputs: [{ type: "uint8"  }],  stateMutability: "view" },
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

    if (!chainId || !address) {
      throw new AppError(400, "BAD_REQUEST", "chainId e address obbligatori");
    }
    if (!/^0x[0-9a-f]{38,40}$/i.test(address)) {
      throw new AppError(400, "INVALID_ADDRESS", "Indirizzo non valido");
    }

    const client = getRpcClient(chainId);

    // Legge name, symbol, decimals dal contratto in parallelo
    const [name, symbol, decimals] = await Promise.all([
      client.readContract({ address: address as `0x${string}`, abi: ERC20_ABI, functionName: "name" })
        .catch(() => "Unknown Token"),
      client.readContract({ address: address as `0x${string}`, abi: ERC20_ABI, functionName: "symbol" })
        .catch(() => "???"),
      client.readContract({ address: address as `0x${string}`, abi: ERC20_ABI, functionName: "decimals" })
        .catch(() => 18),
    ]);

    const isVerified = isVerifiedAddress(chainId, address);
    const symbolConflict = !isVerified && isSymbolConflict(chainId, symbol as string);

    res.json({
      data: {
        chainId,
        contractAddress: address,
        name,
        symbol,
        decimals,
        isVerified,
        symbolConflict,
      },
    });
  } catch (err) {
    next(err);
  }
}

// ─── GET /evm/transactions ─────────────────────────────────────────────────

const ALCHEMY_URLS: Record<number, string> = {
  1:   `https://eth-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`,
  137: `https://polygon-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`,
  56:  "", // BSC non supportato da Alchemy — fallback a public RPC
};

export async function getEvmTransactions(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const chainId = parseInt(req.query.chainId as string, 10);
    const address = (req.query.address as string)?.toLowerCase();
    const fromBlock = (req.query.fromBlock as string) ?? "0x0";

    if (!chainId || !address) {
      throw new AppError(400, "BAD_REQUEST", "chainId e address obbligatori");
    }

    const alchemyUrl = ALCHEMY_URLS[chainId];
    let transfers: object[] = [];
    let latestBlock = "0x0";

    if (alchemyUrl) {
      // Usa Alchemy per ETH e Polygon
      const [inRes, outRes, blockRes] = await Promise.all([
        fetch(alchemyUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0", id: 1,
            method: "alchemy_getAssetTransfers",
            params: [{
              fromBlock,
              toAddress: address,
              category: ["external", "erc20"],
              withMetadata: true,
              maxCount: "0x32",
            }],
          }),
        }).then(r => r.json()),
        fetch(alchemyUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0", id: 2,
            method: "alchemy_getAssetTransfers",
            params: [{
              fromBlock,
              fromAddress: address,
              category: ["external", "erc20"],
              withMetadata: true,
              maxCount: "0x32",
            }],
          }),
        }).then(r => r.json()),
        fetch(alchemyUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0", id: 3,
            method: "eth_blockNumber",
            params: [],
          }),
        }).then(r => r.json()),
      ]);

      latestBlock = blockRes?.result ?? "0x0";
      const inTransfers = (inRes?.result?.transfers ?? []) as AlchemyTransfer[];
      const outTransfers = (outRes?.result?.transfers ?? []) as AlchemyTransfer[];

      transfers = [
        ...inTransfers.map(t => _mapAlchemyTransfer(t, address, "in", chainId)),
        ...outTransfers.map(t => _mapAlchemyTransfer(t, address, "out", chainId)),
      ].sort((a: any, b: any) => (b.blockNum > a.blockNum ? 1 : -1));
    } else {
      // BSC fallback: nessuna API senza chiave → array vuoto, Phase C
      logger.warn({ chainId }, "BSC tx history non disponibile senza Alchemy BSC");
    }

    res.json({ data: { transfers, latestBlock } });
  } catch (err) {
    next(err);
  }
}

interface AlchemyTransfer {
  hash: string;
  from: string;
  to: string;
  value: number | null;
  asset: string | null;
  category: string;
  blockNum: string;
  metadata?: { blockTimestamp?: string };
  rawContract?: { address?: string };
  erc721TokenId?: string;
  log?: { transactionIndex?: string; logIndex?: number };
}

function _mapAlchemyTransfer(
  t: AlchemyTransfer,
  myAddress: string,
  direction: "in" | "out",
  chainId: number
): object {
  const timestamp = t.metadata?.blockTimestamp
    ? Math.floor(new Date(t.metadata.blockTimestamp).getTime() / 1000)
    : undefined;

  return {
    hash: t.hash,
    from: t.from,
    to: t.to ?? "",
    value: t.value != null ? String(t.value) : "0",
    asset: t.asset ?? (chainId === 1 ? "ETH" : chainId === 137 ? "POL" : "BNB"),
    category: t.category,
    blockNum: t.blockNum,
    timestamp,
    status: "confirmed" as const,
    direction,
    logIndex: t.log?.logIndex,
    contractAddress: t.rawContract?.address,
  };
}

// ─── GET /btc/transactions ─────────────────────────────────────────────────

const BLOCKSTREAM_BASE = "https://blockstream.info/api";
const SAT_PER_BTC = 100_000_000;

export async function getBtcTransactions(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const address = req.query.address as string;
    if (!address) throw new AppError(400, "BAD_REQUEST", "address obbligatorio");
    // Validazione basilare: bc1q, 1..., 3...
    if (!/^(bc1|[13])[a-zA-Z0-9]{25,87}$/.test(address)) {
      throw new AppError(400, "INVALID_BTC_ADDRESS", "Indirizzo Bitcoin non valido");
    }

    const response = await fetch(
      `${BLOCKSTREAM_BASE}/address/${address}/txs`,
      { headers: { "User-Agent": "AlphaChat-Wallet/1.0" } }
    );

    if (!response.ok) {
      if (response.status === 400) {
        throw new AppError(400, "INVALID_BTC_ADDRESS", "Indirizzo Bitcoin non valido");
      }
      throw new AppError(502, "BLOCKSTREAM_ERROR", "Errore nel recupero transazioni BTC");
    }

    const rawTxs = await response.json() as BlockstreamTx[];

    const txs = rawTxs.map(tx => {
      // Calcola il valore netto per il nostro address
      let valueSat = 0;
      for (const vout of tx.vout) {
        if (vout.scriptpubkey_address === address) valueSat += vout.value;
      }
      for (const vin of tx.vin) {
        if (vin.prevout?.scriptpubkey_address === address) valueSat -= vin.prevout.value;
      }

      const direction: "in" | "out" = valueSat >= 0 ? "in" : "out";
      const confirmed = tx.status.confirmed;
      const confirmations = confirmed ? 1 : 0; // blockstream non fornisce num. conferme

      return {
        txid: tx.txid,
        valueSat: Math.abs(valueSat),
        valueBtc: (Math.abs(valueSat) / SAT_PER_BTC).toFixed(8),
        confirmed,
        confirmations,
        timestamp: tx.status.block_time,
        direction,
        status: confirmed ? "confirmed" : "pending",
        blockHeight: tx.status.block_height,
      };
    });

    res.json({ data: { txs } });
  } catch (err) {
    next(err);
  }
}

interface BlockstreamTx {
  txid: string;
  vin: Array<{ prevout?: { scriptpubkey_address: string; value: number } }>;
  vout: Array<{ scriptpubkey_address: string; value: number }>;
  status: { confirmed: boolean; block_height?: number; block_time?: number };
}
