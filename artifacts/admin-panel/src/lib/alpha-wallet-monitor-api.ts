/**
 * Alpha Wallet Monitor — Admin API Client
 *
 * Base: /api/v1/admin/alpha-wallet-monitor
 * Usa apiFetch da api.ts (base /api/v1/admin).
 */

import { apiFetch } from "./api";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AWMOverview {
  users: {
    wallet_enabled:       number;
    self_custodial_evm:   number;
    self_custodial_btc:   number;
    third_party_any:      number;
    third_party_polygon:  number;
    third_party_ethereum: number;
    third_party_usda:     number;
  };
  fee_records: {
    total:             number;
    success:           number;
    failed_permanent:  number;
    failed_transient:  number;
    volume_collected:  number;
    by_network: Record<string, { success: number; failed: number; volume: number }>;
  };
  payment_requests: {
    total:     number;
    pending:   number;
    paid:      number;
    cancelled: number;
    expired:   number;
  };
}

export interface AWMUser {
  user_id:           string;
  username:          string;
  email:             string;
  wallet_enabled:    boolean;
  self_custodial_evm: string | null;
  self_custodial_btc: string | null;
  third_party_wallets: {
    polygon?:   { address: string; verified_at: string | null } | null;
    ethereum?:  { address: string; verified_at: string | null } | null;
    usda?:      { address: string; verified_at: string | null } | null;
    bitcoin?:   { address: string; verified_at: string | null } | null;
    lightning?: { address: string; verified_at: string | null } | null;
  };
  registered_at: string;
}

export interface AWMFeeRecord {
  _id:         string;
  network:     string;
  assetSymbol: string;
  feeAmount:   string;
  feeWallet:   string;
  status:      "success" | "failed_transient" | "failed_permanent";
  attempts:    number;
  feeTxHash?:  string;
  lastError?:  string;
  source?:     string;
  createdAt:   string;
  updatedAt:   string;
}

export interface AWMPaymentRequest {
  id:                string;
  requester:         { id: string; username: string; email: string } | null;
  payer:             { id: string; username: string; email: string } | null;
  network:           string;
  asset_symbol:      string;
  amount:            string;
  requester_address: string;
  status:            "pending" | "paid" | "cancelled" | "expired";
  tx_hash:           string | null;
  created_at:        string;
  expires_at:        string;
}

export interface AWMUsersResponse      { data: { users: AWMUser[];          total: number; skip: number; limit: number } }
export interface AWMFeeResponse        { data: { records: AWMFeeRecord[];   total: number; skip: number; limit: number } }
export interface AWMPayReqResponse     { data: { requests: AWMPaymentRequest[]; total: number; skip: number; limit: number } }
export interface AWMErrorsResponse     { data: { errors: AWMFeeRecord[];    total: number } }

// ─── API Functions ────────────────────────────────────────────────────────────

export function apiAWMOverview(): Promise<{ data: AWMOverview }> {
  return apiFetch("/alpha-wallet-monitor/overview");
}

export function apiAWMUsers(params: {
  filter?: "all" | "enabled" | "self_custodial" | "third_party";
  skip?:   number;
  limit?:  number;
}): Promise<AWMUsersResponse> {
  const q = new URLSearchParams();
  if (params.filter) q.set("filter", params.filter);
  if (params.skip)   q.set("skip",   String(params.skip));
  if (params.limit)  q.set("limit",  String(params.limit));
  return apiFetch(`/alpha-wallet-monitor/users?${q}`);
}

export function apiAWMFeeRecords(params: {
  network?: string;
  status?:  string;
  range?:   string;
  source?:  string;
  skip?:    number;
  limit?:   number;
}): Promise<AWMFeeResponse> {
  const q = new URLSearchParams();
  if (params.network) q.set("network", params.network);
  if (params.status)  q.set("status",  params.status);
  if (params.range)   q.set("range",   params.range);
  if (params.source)  q.set("source",  params.source);
  if (params.skip)    q.set("skip",    String(params.skip));
  if (params.limit)   q.set("limit",   String(params.limit));
  return apiFetch(`/alpha-wallet-monitor/fee-records?${q}`);
}

export function apiAWMPaymentRequests(params: {
  status?: string;
  range?:  string;
  skip?:   number;
  limit?:  number;
}): Promise<AWMPayReqResponse> {
  const q = new URLSearchParams();
  if (params.status) q.set("status", params.status);
  if (params.range)  q.set("range",  params.range);
  if (params.skip)   q.set("skip",   String(params.skip));
  if (params.limit)  q.set("limit",  String(params.limit));
  return apiFetch(`/alpha-wallet-monitor/payment-requests?${q}`);
}

export function apiAWMErrors(): Promise<AWMErrorsResponse> {
  return apiFetch("/alpha-wallet-monitor/errors");
}
