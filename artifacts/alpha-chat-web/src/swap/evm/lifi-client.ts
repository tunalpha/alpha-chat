/**
 * Li.Fi EVM Swap Client
 *
 * Responsabilità:
 *   - Quote: GET /v1/quote con integrator=alpha-chat, fee=0.0025
 *   - Execute: @lifi/sdk executeRoute con wallet ThirdWeb → viem
 *   - Status: GET /v1/status per recovery
 *
 * SICUREZZA:
 *   - API key Li.Fi: mai usata qui (solo server-side), le quote pubbliche non la richiedono
 *   - integrator + fee sono parametri pubblici accettati senza autenticazione
 *   - Lock module-level anti-double-click gestito in useEvmSwapState
 *
 * ISOLAMENTO: zero import da payment engine, USDA, MultiChain.
 */

import { createConfig, EVM, executeRoute, type Route } from "@lifi/sdk";
import type { WalletClient } from "viem";
import {
  LIFI_INTEGRATOR, LIFI_FEE, LIFI_SLIPPAGE, QUOTE_VALIDITY_MS,
  NATIVE_ADDRESS, tokenAddressForLiFi,
  type EvmToken, type EvmSwapQuote,
} from "./types.js";

// ── Li.Fi SDK init ─────────────────────────────────────────────────────────────

let _lifiConfigured = false;
let _currentGetWallet: (() => Promise<WalletClient>) | null = null;
let _currentSwitchChain: ((chainId: number) => Promise<void>) | null = null;

/**
 * Inizializza (o aggiorna) il wallet usato dal Li.Fi SDK.
 * Chiamare ogni volta che il wallet ThirdWeb cambia.
 * createConfig è idempotente: eseguito solo al primo mount, i callback
 * puntano a closure mutabili così la wallet rotation funziona senza re-init.
 */
export function configureLiFiWallet(
  getWalletClient: () => Promise<WalletClient>,
  switchChain: (chainId: number) => Promise<void>,
): void {
  // Aggiorna sempre i puntatori (wallet rotation)
  _currentGetWallet  = getWalletClient;
  _currentSwitchChain = switchChain;

  if (!_lifiConfigured) {
    createConfig({
      integrator: LIFI_INTEGRATOR,
      providers: [
        EVM({
          getWalletClient:  () => _currentGetWallet!(),
          switchChain:      (id: number) => _currentSwitchChain!(id),
        }),
      ],
    });
    _lifiConfigured = true;
  }
}

// ── Quote ─────────────────────────────────────────────────────────────────────

const LIFI_API = "https://li.quest/v1";

export interface LiFiQuoteParams {
  fromChainId:  number;
  toChainId:    number;
  fromToken:    EvmToken;
  toToken:      EvmToken;
  fromAmount:   string;  // in token units (stringa)
  fromAddress:  string;  // wallet address dell'utente
}

/** Errore restituito se quote non disponibile */
export class LiFiQuoteError extends Error {
  constructor(public code: number, message: string) {
    super(message);
    this.name = "LiFiQuoteError";
  }
}

/** Recupera una quote Li.Fi (REST, senza SDK — più testabile e stabile). */
export async function fetchLiFiQuote(params: LiFiQuoteParams): Promise<EvmSwapQuote> {
  const qs = new URLSearchParams({
    fromChain:   String(params.fromChainId),
    toChain:     String(params.toChainId),
    fromToken:   tokenAddressForLiFi(params.fromToken),
    toToken:     tokenAddressForLiFi(params.toToken),
    fromAmount:  params.fromAmount,
    fromAddress: params.fromAddress,
    integrator:  LIFI_INTEGRATOR,
    fee:         String(LIFI_FEE),
    slippage:    String(LIFI_SLIPPAGE),
  });

  const res  = await fetch(`${LIFI_API}/quote?${qs}`, {
    headers: { Accept: "application/json" },
  });
  const body = await res.json() as Record<string, unknown>;

  if (!res.ok) {
    throw new LiFiQuoteError(
      (body.code as number) ?? res.status,
      (body.message as string) ?? `Li.Fi quote error ${res.status}`,
    );
  }

  return parseQuoteResponse(body, params);
}

function parseQuoteResponse(
  body: Record<string, unknown>,
  params: LiFiQuoteParams,
): EvmSwapQuote {
  const estimate = (body.estimate as Record<string, unknown>) ?? {};
  const action   = (body.action   as Record<string, unknown>) ?? {};
  const feeCosts = (estimate.feeCosts as unknown[]) ?? [];
  const gasCosts = (estimate.gasCosts as unknown[]) ?? [];

  // Fee Alpha (integrator share)
  let alphaFeeUSD = "0.00";
  for (const fc of feeCosts) {
    const f = fc as Record<string, unknown>;
    const split = (f.feeSplit as Record<string, unknown> | undefined);
    const recipients = (split?.recipients as unknown[]) ?? [];
    for (const rec of recipients) {
      const r = rec as Record<string, unknown>;
      if (r.name === LIFI_INTEGRATOR && r.walletAddress == null) {
        // Fee Forwarder — non ha walletAddress nella risposta (corretto)
        const feeRaw = String(r.fee ?? "0");
        const token  = (f.token as Record<string, unknown> | undefined);
        const dec    = (token?.decimals as number) ?? 6;
        const usdPer = parseFloat(String(token?.priceUSD ?? "1"));
        const human  = Number(BigInt(feeRaw)) / 10 ** dec;
        alphaFeeUSD  = (human * usdPer).toFixed(4);
      }
    }
  }

  // Gas cost USD
  let gasCostUSD = "0.00";
  for (const gc of gasCosts) {
    const g = gc as Record<string, unknown>;
    gasCostUSD = (parseFloat(gasCostUSD) + parseFloat(String(g.amountUSD ?? "0"))).toFixed(4);
  }

  // Total fee USD
  let totalFeeUSD = "0.00";
  for (const fc of feeCosts) {
    const f = fc as Record<string, unknown>;
    totalFeeUSD = (parseFloat(totalFeeUSD) + parseFloat(String(f.amountUSD ?? "0"))).toFixed(4);
  }
  totalFeeUSD = (parseFloat(totalFeeUSD) + parseFloat(gasCostUSD)).toFixed(4);

  const toAmount    = String(estimate.toAmount    ?? "0");
  const toAmountMin = String(estimate.toAmountMin ?? "0");
  const tool        = String((body.tool as string) ?? "lifi");

  return {
    route:        body,   // Li.Fi Route (opaque) — passato intero a executeRoute
    routeId:      String((body.id as string) ?? `${Date.now()}`),
    fromChainId:  params.fromChainId,
    toChainId:    params.toChainId,
    fromToken:    params.fromToken,
    toToken:      params.toToken,
    fromAmount:   params.fromAmount,
    toAmount,
    toAmountMin,
    alphaFeeUSD,
    gasCostUSD,
    totalFeeUSD,
    slippage:     LIFI_SLIPPAGE,
    expiresAt:    Date.now() + QUOTE_VALIDITY_MS,
    tool,
  };
}

// ── Execute ───────────────────────────────────────────────────────────────────

export interface ExecuteCallbacks {
  /** Chiamato ad ogni cambio di stato del route durante l'esecuzione */
  onRouteUpdate?: (route: Route) => void;
  /** Chiamato quando la TX è stata firmata e inviata */
  onTxSubmitted?: (txHash: string, chainId: number) => void;
}

/**
 * Esegue uno swap Li.Fi.
 * Il wallet deve essere già configurato via configureLiFiWallet().
 *
 * SICUREZZA:
 *   - Verifica che configureLiFiWallet sia stato chiamato
 *   - Verifica che la quote non sia scaduta prima di procedere
 */
export async function executeLiFiSwap(
  quote: EvmSwapQuote,
  callbacks?: ExecuteCallbacks,
): Promise<{ txHash: string }> {
  if (!_lifiConfigured || !_currentGetWallet) {
    throw new Error("LiFiClient: wallet non configurato. Chiama configureLiFiWallet() prima.");
  }

  // Verifica scadenza quote (client-side guard)
  if (Date.now() > quote.expiresAt) {
    throw new Error("QUOTE_EXPIRED");
  }

  let lastTxHash = "";

  await executeRoute(quote.route as Route, {
    updateRouteHook(updatedRoute: Route) {
      callbacks?.onRouteUpdate?.(updatedRoute);

      // Estrae txHash dall'ultimo step completato
      const steps = updatedRoute.steps ?? [];
      for (const step of steps) {
        const txs = (step as unknown as Record<string, unknown>).transactionHistory;
        if (Array.isArray(txs)) {
          for (const tx of txs) {
            const txRec = tx as Record<string, unknown>;
            if (txRec.txHash) {
              lastTxHash = String(txRec.txHash);
              callbacks?.onTxSubmitted?.(lastTxHash, (step as unknown as Record<string, unknown>).action?.fromChainId as number ?? quote.fromChainId);
            }
          }
        }
      }
    },
  });

  return { txHash: lastTxHash };
}

// ── Status (per recovery) ─────────────────────────────────────────────────────

export type LiFiStatus = "PENDING" | "DONE" | "FAILED" | "INVALID" | "NOT_FOUND";

export interface LiFiStatusResult {
  status:  LiFiStatus;
  txHash?: string;
  toAmount?: string;
}

/** Controlla lo stato di uno swap Li.Fi via txHash + chain. */
export async function getLiFiStatus(
  txHash: string,
  fromChainId: number,
  toChainId: number,
): Promise<LiFiStatusResult> {
  const qs = new URLSearchParams({
    txHash,
    fromChain: String(fromChainId),
    toChain:   String(toChainId),
  });

  try {
    const res  = await fetch(`${LIFI_API}/status?${qs}`, { headers: { Accept: "application/json" } });
    const body = await res.json() as Record<string, unknown>;

    if (!res.ok) return { status: "INVALID" };

    return {
      status:   (body.status as LiFiStatus) ?? "PENDING",
      txHash:   (body.receiving as Record<string, unknown>)?.txHash as string | undefined,
      toAmount: (body.receiving as Record<string, unknown>)?.amount as string | undefined,
    };
  } catch {
    return { status: "PENDING" };
  }
}

// ── Fee verification helper (per test) ────────────────────────────────────────

/**
 * Verifica che una risposta quote contenga la fee integrator al 25 bps.
 * Usato nei test per garantire che la fee non sia stata rimossa per errore.
 */
export function verifyAlphaFeeInResponse(quoteBody: Record<string, unknown>): {
  found: boolean;
  bps: number;
} {
  const estimate = (quoteBody.estimate as Record<string, unknown>) ?? {};
  const feeCosts = (estimate.feeCosts as unknown[]) ?? [];

  for (const fc of feeCosts) {
    const f = fc as Record<string, unknown>;
    const split = (f.feeSplit as Record<string, unknown> | undefined);
    const recipients = (split?.recipients as unknown[]) ?? [];
    for (const rec of recipients) {
      const r = rec as Record<string, unknown>;
      if (r.name === LIFI_INTEGRATOR) {
        // percentage è la % dell'intera fee, non la % su fromAmount
        // alphaFee / fromAmount × 100 = bps/100
        const lifiFee = BigInt(String(split!.lifiFee ?? "0"));
        const intFee  = BigInt(String(split!.integratorFee ?? "0"));
        const total   = lifiFee + intFee;
        if (total === 0n) return { found: true, bps: 0 };
        // intFee / total × (total_pct × 10000) — stima approssimata
        // Usiamo percentage del FeeCost che rappresenta % su fromAmount
        const pctStr = String(f.percentage ?? "0");
        const pct    = parseFloat(pctStr);         // es. 0.005 = 0.5% totale
        // Li.Fi split 50/50 tra lifi e integrator → metà del pct va all'integrator
        const intBps = Math.round((pct / 2) * 10000);
        return { found: true, bps: intBps };
      }
    }
  }
  return { found: false, bps: 0 };
}
