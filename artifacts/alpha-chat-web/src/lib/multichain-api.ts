/**
 * multichain-api.ts — Client REST per Multi-Chain Payment Engine
 *
 * Base: /api/v1/multichain
 * ISOLAMENTO: nessuna dipendenza da USDA, ThirdWeb, o altri payment flow.
 */

import { getAccessToken } from "./auth";

const BASE = "/api/v1/multichain";

// ─── Tipi ─────────────────────────────────────────────────────────────────────

export type MCNetwork = "polygon" | "ethereum" | "bsc" | "bitcoin";
export type MCAsset   = "USDT" | "BTC";
export type MCStatus  =
  | "awaiting_deposit"
  | "detecting"
  | "releasing"
  | "released"
  | "refunding"
  | "refunded"
  | "expired"
  | "failed"
  | "waiting_for_gas";

/** Shape di system_metadata per message_type: "mc_payment" */
export interface MCSystemMeta {
  transfer_id:         string;
  sender_id:           string;
  recipient_id:        string;
  network:             MCNetwork;
  asset:               MCAsset;
  gross_amount:        string;   // unità minima (intero)
  net_amount:          string;
  project_fee:         string;
  status:              MCStatus;
  escrow_wallet:       string;
  expires_at:          string;   // ISO
  min_deposit_amount:  string | null;
  network_fee_charged: string | null;
  tx_hash_deposit:     string | null;
  tx_hash_release:     string | null;
  /** true = la bubble è una richiesta di pagamento (requester = message.sender_id) */
  is_request:          boolean;
}

export interface MCTransfer {
  transferId:        string;
  senderId:          string;
  recipientId:       string;
  network:           MCNetwork;
  asset:             MCAsset;
  grossAmount:       string;
  netAmount:         string;
  projectFee:        string;
  status:            MCStatus;
  escrowWallet:      string;
  expiresAt:         string;
  minDepositAmount:  string | null;
  networkFeeCharged: string | null;
  txHashDeposit:     string | null;
  txHashRelease:     string | null;
}

// ─── Helper fetch ─────────────────────────────────────────────────────────────

async function mcFetch<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token   = getAccessToken();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res  = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const json = await res.json() as { transfer?: T; data?: T; error?: { code: string; message: string } };
  if (!res.ok) {
    const err: Error & { code?: string } = new Error(json.error?.message ?? `MC API error ${res.status}`);
    err.code = json.error?.code;
    throw err;
  }
  return (json.transfer ?? json.data ?? json) as T;
}

// ─── API pubbliche ────────────────────────────────────────────────────────────

export interface MCCreateParams {
  recipientId:      string;
  conversationId:   string;
  network:          MCNetwork;
  asset:            MCAsset;
  amountMode:       "send_amount";
  grossAmountUnits: string;   // intero in unità minima (es. "10000000" = 10 USDT 6-dec)
  clientRef:        string;
  expiresInHours?:  number;
}

export interface MCRequestParams {
  payerId:          string;   // chi depositerà
  conversationId:   string;
  network:          MCNetwork;
  asset:            MCAsset;
  amountMode:       "send_amount";
  grossAmountUnits: string;
  clientRef:        string;
  expiresInHours?:  number;
}

/** Crea un transfer dove il chiamante è il mittente (paga). */
export async function apiMCCreate(params: MCCreateParams): Promise<MCTransfer> {
  return mcFetch<MCTransfer>("POST", "/transfers", params);
}

/** Crea un transfer dove il chiamante è il destinatario (richiede). */
export async function apiMCRequest(params: MCRequestParams): Promise<MCTransfer> {
  return mcFetch<MCTransfer>("POST", "/transfers/request", params);
}

/** Recupera lo stato corrente di un transfer. */
export async function apiMCGet(transferId: string): Promise<MCTransfer> {
  return mcFetch<MCTransfer>("GET", `/transfers/${transferId}`);
}

/** Rileva deposito on-chain (chiama il backend che controlla la blockchain). */
export async function apiMCDetect(transferId: string): Promise<MCTransfer> {
  return mcFetch<MCTransfer>("POST", `/transfers/${transferId}/detect`);
}

// ─── GET /networks — reti abilitate ──────────────────────────────────────────

export interface MCNetworkEntry {
  id:       MCNetwork;
  asset:    MCAsset;
  label:    string;
  decimals: number;
}

/**
 * Reti e asset attivi (filtrati da FEATURE_FLAGS lato backend).
 * Chiamata senza auth. Cache in-memory per 5 minuti.
 */
let _networksCache: { data: MCNetworkEntry[]; at: number } | null = null;

export async function apiMCNetworks(): Promise<MCNetworkEntry[]> {
  if (_networksCache && Date.now() - _networksCache.at < 5 * 60 * 1000) {
    return _networksCache.data;
  }
  const res = await fetch(`${BASE}/networks`);
  if (!res.ok) throw new Error("Failed to fetch available networks");
  const json = await res.json() as { networks: MCNetworkEntry[] };
  _networksCache = { data: json.networks, at: Date.now() };
  return json.networks;
}

// ─── Utilities ────────────────────────────────────────────────────────────────

export function isMCTerminal(status: MCStatus): boolean {
  return ["released", "refunded", "expired", "failed"].includes(status);
}

export function isMCPending(status: MCStatus): boolean {
  return ["detecting", "releasing", "refunding", "waiting_for_gas"].includes(status);
}

/**
 * Converte un importo decimale (es. "10.50") in unità minima intera (es. "10500000" per 6-dec).
 * Evita errori di floating point.
 */
export function toSmallestUnit(amount: string, decimals: number): string {
  const trimmed = amount.trim().replace(",", ".");
  const [intPart = "0", decPart = ""] = trimmed.split(".");
  const paddedDec = decPart.padEnd(decimals, "0").slice(0, decimals);
  const result = BigInt(intPart) * BigInt(10 ** decimals) + BigInt(paddedDec || "0");
  if (result <= 0n) throw new Error("Amount must be positive");
  return result.toString();
}

/**
 * Converte da unità minima intera a stringa decimale human-readable.
 * Es. "10500000" con 6 decimali → "10.5"
 */
export function fromSmallestUnit(units: string, decimals: number): string {
  try {
    const n = BigInt(units);
    const d = BigInt(10 ** decimals);
    const int = n / d;
    const rem = n % d;
    if (rem === 0n) return int.toString();
    return `${int}.${rem.toString().padStart(decimals, "0").replace(/0+$/, "")}`;
  } catch {
    return units;
  }
}

// ─── Costanti display ────────────────────────────────────────────────────────

export const MC_NETWORK_LABELS: Record<MCNetwork, string> = {
  polygon:  "Polygon",
  ethereum: "Ethereum",
  bsc:      "BSC",
  bitcoin:  "Bitcoin",
};

export const MC_NETWORK_ICONS: Record<MCNetwork, string> = {
  polygon:  "🔵",
  ethereum: "⬡",
  bsc:      "🟡",
  bitcoin:  "🟠",
};

export const MC_DECIMALS: Record<MCNetwork, number> = {
  polygon:  6,
  ethereum: 6,
  bsc:      18,
  bitcoin:  8,
};

export const MC_ASSET: Record<MCNetwork, MCAsset> = {
  polygon:  "USDT",
  ethereum: "USDT",
  bsc:      "USDT",
  bitcoin:  "BTC",
};

export const MC_TICKER: Record<MCNetwork, string> = {
  polygon:  "USDT",
  ethereum: "USDT",
  bsc:      "USDT",
  bitcoin:  "BTC",
};
