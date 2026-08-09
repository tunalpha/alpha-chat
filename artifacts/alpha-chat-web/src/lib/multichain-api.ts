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
  /** Causale / nota opzionale inserita dal mittente */
  note:                string | null;
  /**
   * Motivo Anti-Loss per waiting_for_gas. Null se non applicabile.
   * NETWORK_COST_TOO_HIGH | RPC_UNAVAILABLE → mostra UX "costo rete elevato".
   * GAS_STATION_DEPLETED → UX standard "attesa gas".
   */
  waiting_for_gas_reason?: "GAS_STATION_DEPLETED" | "NETWORK_COST_TOO_HIGH" | "RPC_UNAVAILABLE" | null;
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
  /** Motivo Anti-Loss per waiting_for_gas. Null se non applicabile. */
  waitingForGasReason: "GAS_STATION_DEPLETED" | "NETWORK_COST_TOO_HIGH" | "RPC_UNAVAILABLE" | null;
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

  const json = await res.json() as { transfer?: T; data?: T; error?: { code: string; message: string; details?: Record<string, unknown> } };
  if (!res.ok) {
    const err: Error & { code?: string; details?: Record<string, unknown> } = new Error(json.error?.message ?? `MC API error ${res.status}`);
    err.code    = json.error?.code;
    err.details = json.error?.details ?? undefined;
    throw err;
  }
  return (json.transfer ?? json.data ?? json) as T;
}

// ─── API pubbliche ────────────────────────────────────────────────────────────

export type MCAmountMode = "send_amount" | "recipient_exact";

export interface MCCreateParams {
  recipientId:          string;
  conversationId:       string;
  network:              MCNetwork;
  asset:                MCAsset;
  amountMode:           MCAmountMode;
  grossAmountUnits?:    string;        // obbligatorio per send_amount
  targetNetAmountUnits?: string;       // obbligatorio per recipient_exact
  clientRef:            string;
  note?:                string;        // causale opzionale (max 200 char)
  expiresInHours?:      number;
}

export interface MCRequestParams {
  payerId:              string;        // chi depositerà
  conversationId:       string;
  network:              MCNetwork;
  asset:                MCAsset;
  amountMode:           MCAmountMode;
  grossAmountUnits?:    string;        // obbligatorio per send_amount
  targetNetAmountUnits?: string;       // obbligatorio per recipient_exact
  clientRef:            string;
  note?:                string;        // causale opzionale (max 200 char)
  expiresInHours?:      number;
}

/** Breakdow fee preventivo — stessa logica del service, senza creare il transfer. */
export interface MCQuoteParams {
  network:              MCNetwork;
  asset:                MCAsset;
  amountMode:           MCAmountMode;
  grossAmountUnits?:    string;
  targetNetAmountUnits?: string;
}

export interface MCQuote {
  grossAmount:        string;
  netAmount:          string;
  projectFee:         string;
  networkFeeCharged:  string;
  feeBps:             number;
  amountMode:         MCAmountMode;
  /** true quando la BTC project fee è stata elevata al dust floor (546 sat) */
  btcFeeFloorApplied?: boolean;
}

/** Crea un transfer dove il chiamante è il mittente (paga). */
export async function apiMCCreate(params: MCCreateParams): Promise<MCTransfer> {
  return mcFetch<MCTransfer>("POST", "/transfers", params);
}

/** Crea un transfer dove il chiamante è il destinatario (richiede). */
export async function apiMCRequest(params: MCRequestParams): Promise<MCTransfer> {
  return mcFetch<MCTransfer>("POST", "/transfers/request", params);
}

/** Calcolo preventivo fee — stessa source of truth del backend. */
export async function apiMCQuote(params: MCQuoteParams): Promise<{ quote: MCQuote }> {
  return mcFetch<{ quote: MCQuote }>("POST", "/transfers/quote", params);
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

/**
 * Decimali massimi da visualizzare per ogni rete.
 * BSC USDT ha 18 decimali interni ma ne mostriamo solo 6 (come le altre reti USDT).
 */
/** Decimali mostrati in UI (puramente grafici — backend usa sempre raw).
 *  EVM/USDT → 2 (es. 1,50 USDT; 0,50 fee)
 *  BTC      → 8 (necessari per importi piccoli: 0.00018332 BTC)
 */
export const MC_DISPLAY_DECIMALS: Record<MCNetwork, number> = {
  polygon:  2,
  ethereum: 2,
  bsc:      2,   // raw 18 → display 2 (grafico)
  bitcoin:  8,
};

/**
 * Formatta unità minima → stringa human-readable con troncamento a displayDecimals.
 * Usa BigInt puro — nessun errore floating-point.
 * Tronca (floor) anziché arrotondare: non mostra mai importi maggiori del reale.
 *
 * Padding fisso: quando displayDecimals ≤ 2 (USDT/EVM) la stringa è sempre
 * allineata a dispDec cifre decimali (es. "1" → "1.00", "0.5" → "0.50").
 * Per BTC (displayDecimals=8) gli zeri finali vengono rimossi ("fino a 8").
 *
 * Esempi:
 *   Polygon USDT (raw=6, disp=2): "1000001" → "1.00"   "501003" → "0.50"
 *   BSC USDT    (raw=18, disp=2): "1000000000000000000" → "1.00"
 *   BTC         (raw=8,  disp=8): "18332" → "0.00018332"
 */
export function fmtDisplay(units: string, rawDecimals: number, displayDecimals: number): string {
  let str: string;
  if (rawDecimals <= displayDecimals) {
    str = fromSmallestUnit(units, rawDecimals);
  } else {
    const diff   = rawDecimals - displayDecimals;
    const scale  = BigInt(10) ** BigInt(diff);
    const scaled = BigInt(units) / scale;            // tronca sub-display precision
    str = fromSmallestUnit(scaled.toString(), displayDecimals);
  }
  // Padding fisso per valute "commerciali" (dispDec ≤ 2).
  // BTC (dispDec=8) mantiene il comportamento "fino a N decimali" (no trailing zeros).
  if (displayDecimals <= 2) {
    const dot = str.indexOf(".");
    if (dot === -1) {
      str += displayDecimals > 0 ? "." + "0".repeat(displayDecimals) : "";
    } else {
      str = str.padEnd(dot + 1 + displayDecimals, "0");
    }
  }
  return str;
}

/**
 * Etichetta fee per network (uso nell'interfaccia — nessuna voce "Commissione AlphaChat").
 * EVM-style chains: "Gas fee". UTXO/Polygon: "Fee rete".
 */
export function mcFeeLabel(network: MCNetwork): string {
  return (network === "ethereum" || network === "bsc") ? "Gas fee" : "Fee rete";
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
