/**
 * BoltzService — BTC → Lightning (Submarine Swap)
 *
 * ISOLAMENTO: nessuna dipendenza da payment engine, USDA, MultiChain, Spark fee.
 * Chiama esclusivamente l'API REST di Boltz (https://api.boltz.exchange).
 *
 * Documentazione: https://api.docs.boltz.exchange
 *
 * STATO CORRENTE (agosto 2026):
 *   - Submarine swap (BTC→LN): API live, creazione attiva
 *   - Reverse swap (LN→BTC): creazione disabilitata ("swap creation is disabled")
 *
 * extraFees.id = "alpha-wallet" — attivare commissioni dopo registrazione Boltz Partner Program.
 */

import pino from "pino";

const logger = pino({ name: "boltz-service" });

const BOLTZ_BASE = "https://api.boltz.exchange/v2";

// ── Tipi interni ──────────────────────────────────────────────────────────────

export interface BoltzSubmarineFees {
  percentage: number;   // es. 0.1 = 0.1%
  minerFees:  number;   // sat
}

export interface BoltzSubmarineLimits {
  maximal:         number;  // sat
  minimal:         number;  // sat
  maximalZeroConf: number;  // sat
}

export interface BoltzSubmarineInfo {
  fees:   BoltzSubmarineFees;
  limits: BoltzSubmarineLimits;
}

export interface BoltzCreateSubmarineResult {
  swapId:           string;
  lockupAddress:    string;    // BTC address dove l'utente invia
  expectedAmount:   number;    // sat da inviare (include fees)
  timeoutBlockHeight: number;
  redeemScript:     string;
  /** boltUri o simile — opzionale */
  boltUri?:         string;
}

export interface BoltzSwapStatus {
  status: string;  // "invoice.set" | "transaction.mempool" | "transaction.confirmed" | "invoice.paid" | "invoice.failedToPay" | "swap.expired" | ...
  zeroConfRejected?: boolean;
  transaction?: {
    id:    string;
    hex?:  string;
  };
  failureReason?: string;
}

// ── Fetcher con timeout ───────────────────────────────────────────────────────

async function boltzFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(`${BOLTZ_BASE}${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(options?.headers ?? {}),
      },
    });
    const body = await res.json() as Record<string, unknown>;
    if (!res.ok) {
      const msg = (body?.error as string) ?? `Boltz HTTP ${res.status}`;
      throw new Error(msg);
    }
    return body as T;
  } finally {
    clearTimeout(tid);
  }
}

// ── Exported functions ────────────────────────────────────────────────────────

/**
 * Recupera fee e limiti correnti per BTC→Lightning submarine swap.
 * Usato per costruire una quote.
 */
export async function getBoltzSubmarineFees(): Promise<BoltzSubmarineInfo> {
  const data = await boltzFetch<Record<string, Record<string, unknown>>>("/swap/submarine");
  const pair = (data["BTC"] as Record<string, Record<string, unknown>>)?.["BTC"];
  if (!pair) throw new Error("Boltz: coppia BTC/BTC non trovata");
  return {
    fees:   pair.fees   as BoltzSubmarineFees,
    limits: pair.limits as BoltzSubmarineLimits,
  };
}

/**
 * Crea un submarine swap Boltz (BTC → Lightning).
 *
 * @param invoice         BOLT11 invoice Lightning (destinazione fondi)
 * @param refundPublicKey Chiave pubblica hex (33 byte compressa) per refund
 * @param alphaFeePct     Fee Alpha % (es. 0.25). Passata come extraFees.percentage.
 * @param integratorId    ID integrator (default "alpha-wallet")
 */
export async function createBoltzSubmarineSwap(params: {
  invoice:         string;
  refundPublicKey: string;
  alphaFeePct:     number;
  integratorId:    string;
}): Promise<BoltzCreateSubmarineResult> {
  const body: Record<string, unknown> = {
    from:            "BTC",
    to:              "BTC",
    invoice:         params.invoice,
    refundPublicKey: params.refundPublicKey,
  };

  if (params.alphaFeePct > 0) {
    body.extraFees = {
      id:         params.integratorId,
      percentage: params.alphaFeePct,
    };
  }

  logger.info({ invoice: params.invoice.slice(0, 20) + "..." }, "SWAP:BOLTZ:CREATE");

  const raw = await boltzFetch<Record<string, unknown>>("/swap/submarine", {
    method: "POST",
    body:   JSON.stringify(body),
  });

  if (raw["swap creation is disabled"] || (raw["error"] as string)?.includes("disabled")) {
    throw new Error("BOLTZ_DISABLED");
  }

  return {
    swapId:             raw.id         as string,
    lockupAddress:      raw.address    as string,
    expectedAmount:     raw.expectedAmount as number,
    timeoutBlockHeight: raw.timeoutBlockHeight as number,
    redeemScript:       (raw.redeemScript ?? raw.lockupScript ?? "") as string,
    boltUri:            raw.boltUri    as string | undefined,
  };
}

/**
 * Recupera lo stato di un submarine swap Boltz.
 */
export async function getBoltzSwapStatus(swapId: string): Promise<BoltzSwapStatus> {
  return boltzFetch<BoltzSwapStatus>(`/swap/${encodeURIComponent(swapId)}`);
}

/**
 * Verifica se il provider Boltz è raggiungibile (health check).
 */
export async function checkBoltzHealth(): Promise<{ reachable: boolean; version?: string }> {
  try {
    const data = await boltzFetch<{ version: string }>("/version");
    return { reachable: true, version: data.version };
  } catch {
    return { reachable: false };
  }
}
