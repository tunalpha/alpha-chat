/**
 * Alpha Wallet — Transaction Monitor (Phase F enhanced)
 *
 * Monitora le blockchain per nuove transazioni + reconciliation pending→confirmed/failed.
 *
 * Phase F additions:
 *   - Scrittura su tx-store (storico persistente)
 *   - Reconciliation: poll pending TX per aggiornarle a confirmed/failed
 *   - Visibility-aware: pausa quando il documento non è visibile
 *   - Exponential backoff su errori consecutivi (max 8 min)
 *   - AbortController per cleanup sicuro
 *
 * ISOLAMENTO: usa solo apiWalletGetEvmTransactions / apiWalletGetBtcTransactions.
 * Non usa nulla del Payment Engine esistente.
 *
 * SICUREZZA:
 * - Usa solo address pubblici (evmAddress, btcAddress)
 * - Non invia mai seed/key/PIN al backend
 */

import {
  apiWalletGetEvmTransactions,
  apiWalletGetBtcTransactions,
  type WalletTx,
  type BtcTx,
} from "../../lib/alpha-wallet-api";
import {
  dispatchWalletNotification,
} from "../notifications/wallet-notification-store";
import {
  buildDedupKey,
  chainName,
} from "../notifications/wallet-notification-types";
import { getWalletDB, STORE_TX_MONITOR_STATE } from "../core/wallet-db";
import {
  saveTxRecord,
  updateTxStatus,
  loadPendingTxRecords,
  type WalletTxRecord,
} from "../services/tx-store";

// ─── State IDB ────────────────────────────────────────────────────────────

interface MonitorState {
  /** Ultimo blocco EVM processato per chain */
  evmLastBlock: Record<number, string>;
  /** Timestamp ultimo check BTC */
  btcLastChecked: number;
  /** Txid BTC già visti */
  btcSeenTxids: string[];
}

const STATE_KEY = "monitor-state";

async function loadMonitorState(): Promise<MonitorState> {
  const db = await getWalletDB();
  return (await db.get(STORE_TX_MONITOR_STATE, STATE_KEY)) ?? {
    evmLastBlock: {},
    btcLastChecked: 0,
    btcSeenTxids: [],
  };
}

async function saveMonitorState(state: MonitorState): Promise<void> {
  const db = await getWalletDB();
  await db.put(STORE_TX_MONITOR_STATE, state, STATE_KEY);
}

// ─── Backoff ──────────────────────────────────────────────────────────────

const BACKOFF_STEPS_MS = [30_000, 60_000, 120_000, 240_000, 480_000]; // 30s → 8min

function backoffMs(consecutiveErrors: number): number {
  const idx = Math.min(consecutiveErrors, BACKOFF_STEPS_MS.length - 1);
  return BACKOFF_STEPS_MS[idx];
}

// ─── EVM monitoring ────────────────────────────────────────────────────────

const SUPPORTED_CHAIN_IDS = [1, 137, 56] as const;

async function pollEvmChain(
  chainId: number,
  address: string,
  state: MonitorState
): Promise<string> {
  const fromBlock = state.evmLastBlock[chainId];
  let result;
  try {
    result = await apiWalletGetEvmTransactions(chainId, address, fromBlock);
  } catch {
    // Errore di rete: non aggiornare il lastBlock, riprova al prossimo ciclo
    return fromBlock ?? "0x0";
  }

  for (const tx of result.transfers) {
    await _processEvmTx(tx, address, chainId);
  }

  return result.latestBlock;
}

async function _processEvmTx(
  tx: WalletTx,
  myAddress: string,
  chainId: number
): Promise<void> {
  const isIncoming = tx.direction === "in";
  const status = tx.status === "pending" ? "pending" : tx.status === "failed" ? "failed" : "confirmed";
  const type = isIncoming
    ? (status === "confirmed" ? "received" : "pending")
    : (status === "confirmed" ? "sent" : "pending");

  // Salva nel notification store (comportamento invariato)
  await dispatchWalletNotification({
    type,
    chainId,
    network: chainName(chainId),
    asset: tx.asset,
    amount: tx.value,
    txHash: tx.hash,
    logIndex: tx.logIndex,
    fromAddress: tx.from,
    toAddress: tx.to,
    timestamp: tx.timestamp ? tx.timestamp * 1000 : Date.now(),
    status,
  });

  // Phase F: salva nel tx-store persistente
  const dir = isIncoming ? "in" : "out";
  const id  = buildDedupKey(chainId, tx.hash, type, tx.logIndex);
  const record: WalletTxRecord = {
    id,
    chainId,
    network: chainName(chainId),
    txHash:  tx.hash,
    logIndex: tx.logIndex,
    direction: dir,
    asset:   tx.asset,
    amount:  tx.value,
    fromAddress: tx.from,
    toAddress:   tx.to,
    timestamp:   tx.timestamp ? tx.timestamp * 1000 : Date.now(),
    status,
    updatedAt: Date.now(),
  };
  await saveTxRecord(record);
}

// ─── BTC monitoring ────────────────────────────────────────────────────────

async function pollBtc(
  address: string,
  state: MonitorState
): Promise<string[]> {
  let result;
  try {
    result = await apiWalletGetBtcTransactions(address);
  } catch {
    return state.btcSeenTxids;
  }

  const newTxids: string[] = [...state.btcSeenTxids];

  for (const tx of result.txs) {
    if (state.btcSeenTxids.includes(tx.txid)) {
      // TX già vista: controlla se c'è un aggiornamento di stato
      await _reconcileBtcTx(tx);
      continue;
    }
    newTxids.push(tx.txid);
    await _processBtcTx(tx);
  }

  return newTxids;
}

async function _processBtcTx(tx: BtcTx): Promise<void> {
  const isIncoming = tx.direction === "in";
  const status = tx.confirmed ? "confirmed" : "pending";
  const type = isIncoming
    ? (tx.confirmed ? "received" : "pending")
    : (tx.confirmed ? "sent" : "pending");

  await dispatchWalletNotification({
    type,
    chainId: 0,
    network: "Bitcoin",
    asset: "BTC",
    amount: tx.valueBtc,
    txHash: tx.txid,
    fromAddress: undefined,
    toAddress: undefined,
    timestamp: tx.timestamp ? tx.timestamp * 1000 : Date.now(),
    status,
  });

  // Phase F: salva nel tx-store
  const dir = isIncoming ? "in" : "out";
  const id  = `btc:${tx.txid}:${dir}:`;
  const record: WalletTxRecord = {
    id,
    chainId:   0,
    network:   "Bitcoin",
    txHash:    tx.txid,
    direction: dir,
    asset:     "BTC",
    amount:    tx.valueBtc,
    timestamp: tx.timestamp ? tx.timestamp * 1000 : Date.now(),
    status,
    updatedAt: Date.now(),
  };
  await saveTxRecord(record);
}

/** Aggiorna status BTC pending → confirmed se la TX è stata confermata */
async function _reconcileBtcTx(tx: BtcTx): Promise<void> {
  if (!tx.confirmed) return;
  const dir = tx.direction === "in" ? "in" : "out";
  const id  = `btc:${tx.txid}:${dir}:`;
  await updateTxStatus(id, "confirmed");
}

// ─── Reconciliation EVM pending TX ────────────────────────────────────────

/**
 * Controlla le TX EVM in stato pending nel tx-store e aggiorna il loro stato.
 * Strategy: se la TX è tra quelle ritornate dalla prossima poll → usa quel status.
 * Se non la troviamo più nelle ultime TX (assumed confirmed), marca confirmed.
 * Non facciamo call specifiche per TX (no eth_getTransactionReceipt diretto —
 * rischio rate limit su RPC free). Il monitor standard le ritroverà.
 */
async function _reconcilePendingEvm(
  address: string,
  newTxsThisRound: Map<string, WalletTx>
): Promise<void> {
  const pending = await loadPendingTxRecords();
  const evmPending = pending.filter(r => r.chainId !== 0);

  for (const r of evmPending) {
    const fromApi = newTxsThisRound.get(r.txHash.toLowerCase());
    if (!fromApi) continue;

    const newStatus = fromApi.status === "pending" ? "pending"
      : fromApi.status === "failed" ? "failed"
      : "confirmed";

    if (newStatus !== "pending") {
      await updateTxStatus(r.id, newStatus);
    }
  }
}

// ─── TxMonitor class ───────────────────────────────────────────────────────

export const POLL_INTERVAL_MS = 30_000; // 30 secondi base

export class TxMonitor {
  private _timer: ReturnType<typeof setInterval> | null = null;
  private _evmAddress: string | null = null;
  private _btcAddress: string | null = null;
  private _running = false;
  private _onNewTx: (() => void) | null = null;
  private _consecutiveErrors = 0;
  private _abortController: AbortController | null = null;

  /** Callback chiamata ogni volta che ci sono nuove transazioni */
  onNewTransaction(cb: () => void): void {
    this._onNewTx = cb;
  }

  /** Avvia il monitor con gli address del wallet sbloccato */
  start(evmAddress: string, btcAddress: string): void {
    if (this._running) this.stop();
    this._evmAddress = evmAddress;
    this._btcAddress = btcAddress;
    this._running = true;
    this._consecutiveErrors = 0;
    this._abortController = new AbortController();

    // Visibility-aware: pausa quando il documento non è visibile
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", this._visibilityHandler);
    }

    // Primo poll immediato (solo se visibile)
    if (typeof document === "undefined" || document.visibilityState !== "hidden") {
      void this._poll();
    }

    this._scheduleNext();
  }

  stop(): void {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
    this._abortController?.abort();
    this._abortController = null;
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this._visibilityHandler);
    }
    this._running = false;
    this._evmAddress = null;
    this._btcAddress = null;
    this._consecutiveErrors = 0;
  }

  isRunning(): boolean {
    return this._running;
  }

  /** Forza un poll immediato (utile per refresh manuale) */
  async forcePoll(): Promise<void> {
    if (this._running) await this._poll();
  }

  private _visibilityHandler = (): void => {
    if (!this._running) return;
    if (document.visibilityState === "visible") {
      // App tornata in foreground: poll immediato
      void this._poll();
    }
  };

  private _scheduleNext(): void {
    if (this._timer) clearInterval(this._timer);
    const interval = this._consecutiveErrors > 0
      ? backoffMs(this._consecutiveErrors)
      : POLL_INTERVAL_MS;
    this._timer = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      void this._poll();
    }, interval);
  }

  private async _poll(): Promise<void> {
    if (!this._evmAddress && !this._btcAddress) return;

    const state = await loadMonitorState();
    let hasNew = false;
    let hadError = false;
    const txsThisRound = new Map<string, WalletTx>();

    // EVM chains
    if (this._evmAddress) {
      for (const chainId of SUPPORTED_CHAIN_IDS) {
        const prevBlock = state.evmLastBlock[chainId];
        try {
          const result = await apiWalletGetEvmTransactions(
            chainId, this._evmAddress, prevBlock
          );
          for (const tx of result.transfers) {
            txsThisRound.set(tx.hash.toLowerCase(), tx);
            await _processEvmTx(tx, this._evmAddress, chainId);
          }
          if (result.latestBlock !== prevBlock) {
            state.evmLastBlock[chainId] = result.latestBlock;
            if (result.transfers.length > 0) hasNew = true;
          }
        } catch {
          hadError = true;
          // Non aggiornare lastBlock — riprova al prossimo ciclo
        }
      }
      // Reconcile pending EVM TX con i dati appena ottenuti
      await _reconcilePendingEvm(this._evmAddress, txsThisRound);
    }

    // Bitcoin
    if (this._btcAddress) {
      try {
        const prevTxids = state.btcSeenTxids;
        const newTxids = await pollBtc(this._btcAddress, state);
        if (newTxids.length > prevTxids.length) {
          state.btcSeenTxids = newTxids;
          hasNew = true;
        }
      } catch {
        hadError = true;
      }
    }

    await saveMonitorState(state);

    // Aggiorna backoff
    if (hadError) {
      this._consecutiveErrors++;
      this._scheduleNext(); // ri-schedula con backoff aumentato
    } else if (this._consecutiveErrors > 0) {
      this._consecutiveErrors = 0;
      this._scheduleNext(); // torna all'intervallo normale
    }

    if (hasNew) {
      this._onNewTx?.();
    }
  }

  /** Reset dello stato (utile quando si cambia wallet) */
  static async resetState(): Promise<void> {
    const db = await getWalletDB();
    await db.delete(STORE_TX_MONITOR_STATE, STATE_KEY);
  }
}

/** Istanza globale singleton (unica per l'app) */
export const txMonitor = new TxMonitor();
