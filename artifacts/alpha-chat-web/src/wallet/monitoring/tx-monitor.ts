/**
 * Alpha Wallet — Transaction Monitor
 *
 * Monitora le blockchain per rilevare nuove transazioni e generare notifiche.
 * Usa il backend come proxy verso Alchemy (EVM) e Blockstream (BTC).
 *
 * ISOLAMENTO: usa solo apiWalletGetEvmTransactions / apiWalletGetBtcTransactions.
 * Non usa nulla del Payment Engine esistente.
 *
 * SICUREZZA:
 * - Usa solo address pubblici (evmAddress, btcAddress)
 * - Non invia mai seed/key/PIN al backend
 * - La private key rimane solo in IDB cifrato
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
  const type = isIncoming
    ? (tx.status === "confirmed" ? "received" : "pending")
    : (tx.status === "confirmed" ? "sent" : "pending");

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
    status: tx.status === "pending" ? "pending" : tx.status === "failed" ? "failed" : "confirmed",
  });
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
    if (state.btcSeenTxids.includes(tx.txid)) continue;
    newTxids.push(tx.txid);
    await _processBtcTx(tx);
  }

  return newTxids;
}

async function _processBtcTx(tx: BtcTx): Promise<void> {
  const isIncoming = tx.direction === "in";
  const type = isIncoming
    ? (tx.confirmed ? "received" : "pending")
    : (tx.confirmed ? "sent" : "pending");

  await dispatchWalletNotification({
    type,
    chainId: 0, // 0 = Bitcoin
    network: "Bitcoin",
    asset: "BTC",
    amount: tx.valueBtc,
    txHash: tx.txid,
    fromAddress: undefined,
    toAddress: undefined,
    timestamp: tx.timestamp ? tx.timestamp * 1000 : Date.now(),
    status: tx.confirmed ? "confirmed" : "pending",
  });
}

// ─── TxMonitor class ───────────────────────────────────────────────────────

export const POLL_INTERVAL_MS = 30_000; // 30 secondi

export class TxMonitor {
  private _timer: ReturnType<typeof setInterval> | null = null;
  private _evmAddress: string | null = null;
  private _btcAddress: string | null = null;
  private _running = false;
  private _onNewTx: (() => void) | null = null;

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

    // Primo poll immediato
    void this._poll();

    this._timer = setInterval(() => {
      void this._poll();
    }, POLL_INTERVAL_MS);
  }

  stop(): void {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
    this._running = false;
    this._evmAddress = null;
    this._btcAddress = null;
  }

  isRunning(): boolean {
    return this._running;
  }

  private async _poll(): Promise<void> {
    if (!this._evmAddress && !this._btcAddress) return;

    const state = await loadMonitorState();
    let hasNew = false;

    // EVM chains
    if (this._evmAddress) {
      for (const chainId of SUPPORTED_CHAIN_IDS) {
        const prevBlock = state.evmLastBlock[chainId];
        const newBlock = await pollEvmChain(chainId, this._evmAddress, state);
        if (newBlock !== prevBlock) {
          state.evmLastBlock[chainId] = newBlock;
          hasNew = true;
        }
      }
    }

    // Bitcoin
    if (this._btcAddress) {
      const prevTxids = state.btcSeenTxids;
      const newTxids = await pollBtc(this._btcAddress, state);
      if (newTxids.length > prevTxids.length) {
        state.btcSeenTxids = newTxids;
        hasNew = true;
      }
    }

    await saveMonitorState(state);

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
