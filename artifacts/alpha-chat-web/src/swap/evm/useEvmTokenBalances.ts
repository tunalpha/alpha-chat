/**
 * useEvmTokenBalances — hook condiviso per balance EVM per chain
 *
 * Usato sia in EvmSwapView (form principale) che in TokenSelector (per-chain aggiornato).
 * RPC fallback multi-endpoint per maggiore affidabilità su mobile/4G.
 */

import { useState, useEffect } from "react";
import { getTokensForChain } from "./types.js";

// ── Costanti RPC ─────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const _VITE_POLY = ((import.meta as any).env?.VITE_POLYGON_RPC as string | undefined);

export const CHAIN_RPC: Record<number, string[]> = {
  137: [_VITE_POLY ?? "https://polygon-rpc.com"],
  56:  ["https://bsc-dataseed.binance.org/", "https://bsc-dataseed1.ninicoin.io/"],
  // Ethereum: più fallback perché cloudflare può bloccare Safari iOS
  1:   [
    "https://rpc.ankr.com/eth",
    "https://ethereum-rpc.publicnode.com",
    "https://1rpc.io/eth",
    "https://cloudflare-eth.com",
  ],
};

async function rpcPost<T>(rpcUrl: string, method: string, params: unknown[]): Promise<T> {
  const res = await fetch(rpcUrl, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const data = await res.json() as { result?: T; error?: { message: string } };
  if (data.error) throw new Error(data.error.message);
  return data.result as T;
}

/** Prova ogni RPC nell'ordine finché uno risponde */
export async function rpcPostWithFallback<T>(
  chainId: number,
  method: string,
  params: unknown[],
): Promise<T> {
  const urls = CHAIN_RPC[chainId] ?? [];
  let lastErr: unknown;
  for (const url of urls) {
    try {
      return await rpcPost<T>(url, method, params);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr ?? new Error(`No RPC available for chain ${chainId}`);
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export interface BalancesState {
  map:     Map<string, bigint>;
  loading: boolean;
}

/**
 * Fetch dei saldi EVM (nativo + ERC-20) per una chain e un indirizzo.
 * Si re-esegue automaticamente quando cambia chainId o address.
 */
export function useEvmTokenBalances(chainId: number, address: string | undefined): BalancesState {
  const [state, setState] = useState<BalancesState>({ map: new Map(), loading: false });

  useEffect(() => {
    if (!address) { setState({ map: new Map(), loading: false }); return; }
    // BTC non è una chain EVM — nessun RPC call; resetta lo stato per evitare saldo stale
    if (!CHAIN_RPC[chainId]?.length) { setState({ map: new Map(), loading: false }); return; }

    const tokens = getTokensForChain(chainId);
    let cancelled = false;
    // Cancella subito il saldo vecchio — mai mostrare saldo Polygon mentre si aspetta Ethereum
    setState({ map: new Map(), loading: true });

    Promise.allSettled(
      tokens.map(async (t) => {
        if (t.isNative) {
          const hex = await rpcPostWithFallback<string>(chainId, "eth_getBalance", [address, "latest"]);
          return [t.address, BigInt(hex ?? "0x0")] as const;
        } else {
          const pad = address.slice(2).padStart(64, "0");
          const hex = await rpcPostWithFallback<string>(chainId, "eth_call", [
            { to: t.address, data: `0x70a08231${pad}` }, "latest",
          ]);
          // "0x" è truthy in JS ma BigInt("0x") lancia SyntaxError → usare "0x0" per risposta vuota
          return [t.address, BigInt(hex && hex !== "0x" ? hex : "0x0")] as const;
        }
      }),
    ).then(results => {
      if (cancelled) return;
      const entries: [string, bigint][] = [];
      for (const r of results) {
        if (r.status === "fulfilled") entries.push(r.value as [string, bigint]);
      }
      setState({ map: new Map(entries), loading: false });
    }).catch(() => {
      if (!cancelled) setState(prev => ({ ...prev, loading: false }));
    });

    return () => { cancelled = true; };
  }, [chainId, address]);

  return state;
}
