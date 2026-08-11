/**
 * Alpha Wallet — Transaction History Store (Phase F)
 *
 * Store persistente IDB per lo storico completo delle transazioni
 * (EVM + BTC). Separato dal notification store: le notifiche sono
 * temporanee e cap-limited; lo storico TX è permanente e navigabile.
 *
 * SICUREZZA: contiene solo dati pubblici della blockchain.
 *   - Mai seed, private key, PIN
 *   - Gli indirizzi from/to sono pubblici per definizione
 *
 * ISOLAMENTO: non dipende dal Payment Engine esistente.
 */

import { getWalletDB, STORE_TX_HISTORY } from "../core/wallet-db";

// ─── Tipi ──────────────────────────────────────────────────────────────────

export type TxDirection = "in" | "out";
export type TxStatus    = "pending" | "confirmed" | "failed";

/**
 * Record canonico di una transazione (EVM o BTC).
 * Usato come chiave primaria: `id` = dedupKey univoco.
 */
export interface WalletTxRecord {
  /** Chiave primaria — dedupKey formato `${chainId}:${txHash}:${dir}:${logIndex??""}`  o `btc:${txid}:${dir}:` */
  id:          string;
  /** ChainId EVM (0 = Bitcoin) */
  chainId:     number;
  /** Nome rete leggibile (es. "Polygon") */
  network:     string;
  /** Hash transazione / txid BTC */
  txHash:      string;
  /** LogIndex ERC-20 Transfer (per dedup su stessa TX con più transfer) */
  logIndex?:   number;
  /** Direzione dal punto di vista del wallet locale */
  direction:   TxDirection;
  /** Symbol asset (es. "USDT", "BTC") */
  asset:       string;
  /** Importo human-readable (es. "100.50") */
  amount:      string;
  fromAddress?: string;
  toAddress?:   string;
  /** Timestamp UTC ms */
  timestamp:   number;
  status:      TxStatus;
  /** Numero blocco EVM (hex string) o blocco BTC (number come string) */
  blockNumber?: string;
  /** Fee human-readable (opzionale, disponibile dopo conferma) */
  fee?:        string;
  /** Timestamp ultimo aggiornamento (per reconciliation) */
  updatedAt:   number;
}

// ─── CRUD ──────────────────────────────────────────────────────────────────

/**
 * Salva (o aggiorna) un record TX.
 * Se esiste già un record con stesso `id`, non sovrascrive i campi
 * che sarebbero un downgrade (es. non torna da confirmed a pending).
 */
export async function saveTxRecord(record: WalletTxRecord): Promise<void> {
  const db = await getWalletDB();
  const existing = await db.get(STORE_TX_HISTORY, record.id) as WalletTxRecord | undefined;

  if (existing) {
    // Non fare downgrade di stato (confirmed → pending non ha senso)
    const statusRank: Record<TxStatus, number> = { pending: 0, confirmed: 1, failed: 1 };
    if (statusRank[record.status] < statusRank[existing.status]) return;
    await db.put(STORE_TX_HISTORY, { ...existing, ...record, updatedAt: Date.now() });
  } else {
    await db.put(STORE_TX_HISTORY, record);
  }
}

/**
 * Aggiorna lo stato di una TX esistente (pending → confirmed | failed).
 * No-op se il record non esiste.
 */
export async function updateTxStatus(
  id:     string,
  status: TxStatus,
  extra?: Pick<WalletTxRecord, "blockNumber" | "fee">
): Promise<boolean> {
  const db = await getWalletDB();
  const existing = await db.get(STORE_TX_HISTORY, id) as WalletTxRecord | undefined;
  if (!existing) return false;
  const statusRank: Record<TxStatus, number> = { pending: 0, confirmed: 1, failed: 1 };
  if (statusRank[status] < statusRank[existing.status]) return false;
  await db.put(STORE_TX_HISTORY, { ...existing, status, ...extra, updatedAt: Date.now() });
  return true;
}

/**
 * Carica lo storico TX (tutte le chain) ordinato per timestamp DESC.
 * @param limit   Max record da restituire (default 50)
 * @param offset  Offset per paginazione (default 0)
 */
export async function loadTxHistory(limit = 50, offset = 0): Promise<WalletTxRecord[]> {
  const db  = await getWalletDB();
  const all = (await db.getAll(STORE_TX_HISTORY)) as WalletTxRecord[];
  return all
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(offset, offset + limit);
}

/**
 * Carica lo storico TX filtrato per chainId.
 */
export async function loadTxHistoryByChain(
  chainId: number,
  limit  = 50,
  offset = 0
): Promise<WalletTxRecord[]> {
  const db  = await getWalletDB();
  const all = (await db.getAll(STORE_TX_HISTORY)) as WalletTxRecord[];
  return all
    .filter(r => r.chainId === chainId)
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(offset, offset + limit);
}

/**
 * Restituisce le TX ancora in stato pending (per reconciliation).
 */
export async function loadPendingTxRecords(): Promise<WalletTxRecord[]> {
  const db  = await getWalletDB();
  const all = (await db.getAll(STORE_TX_HISTORY)) as WalletTxRecord[];
  return all.filter(r => r.status === "pending");
}

/**
 * Restituisce un singolo record per id.
 */
export async function getTxRecord(id: string): Promise<WalletTxRecord | undefined> {
  const db = await getWalletDB();
  return db.get(STORE_TX_HISTORY, id) as Promise<WalletTxRecord | undefined>;
}

/**
 * Conta il totale di TX nello storico.
 */
export async function countTxRecords(): Promise<number> {
  const db = await getWalletDB();
  return db.count(STORE_TX_HISTORY);
}

/**
 * Svuota lo storico (usato su forget-wallet).
 */
export async function clearTxHistory(): Promise<void> {
  const db = await getWalletDB();
  await db.clear(STORE_TX_HISTORY);
}
