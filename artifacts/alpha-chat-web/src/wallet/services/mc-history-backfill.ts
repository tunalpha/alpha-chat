/**
 * mc-history-backfill.ts — Backfill MultiChain TX nel tx-store IDB
 *
 * Problema risolto:
 *   I pagamenti MultiChain (Trust Wallet, WalletConnect) non passano
 *   attraverso il tx-monitor (che scansiona solo l'Alpha Wallet address).
 *   Il WS handler mc_payment.state_changed aggiornava solo la bolla chat
 *   ma non scriveva mai nel tx-store IDB che alimenta la History view.
 *
 * Soluzione:
 *   1. WS handler (ChatPage.tsx): salva la TX al momento del WS event.
 *   2. Backfill (questo modulo): recupera le TX storiche già completate
 *      dal backend e le inserisce nell'IDB (idempotente).
 *
 * ISOLAMENTO: nessuna dipendenza da React, WS context, o auth context.
 * Espone solo funzioni pure/async chiamabili da qualunque punto del frontend.
 */

import { saveTxRecord, type WalletTxRecord } from "./tx-store";

// ─── Costanti decimali ────────────────────────────────────────────────────────
//
// MC_DECIMALS in multichain-api.ts ha UN valore per rete (non per asset).
// Polygon USDT = 6dec, Polygon USDA = 18dec → serve chiave composita.
// BSC USDT = 18dec (non 6 come USDT su altre reti — confermato da BSCScan).

export const MC_ASSET_DECIMALS: Record<string, number> = {
  "bsc:USDT":      18,
  "polygon:USDT":   6,
  "polygon:USDA":  18,
  "ethereum:USDT":  6,
  "bitcoin:BTC":    8,
};

// ─── Chain ID EVM ─────────────────────────────────────────────────────────────

export const MC_CHAIN_ID: Record<string, number> = {
  bsc:      56,
  polygon:  137,
  ethereum: 1,
  bitcoin:  0,   // non-EVM; chainId=0 = skip in EVM tx-store
};

// ─── Nomi leggibili ───────────────────────────────────────────────────────────

export const MC_NETWORK_NAME: Record<string, string> = {
  bsc:      "BNB Smart Chain",
  polygon:  "Polygon",
  ethereum: "Ethereum",
  bitcoin:  "Bitcoin",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Restituisce i decimali corretti per la coppia rete+asset.
 * Fallback: decimali da MC_ASSET_DECIMALS solo per rete, poi 6.
 */
export function mcDecimalsFor(network: string, asset: string): number {
  const key = `${network}:${asset}`;
  if (key in MC_ASSET_DECIMALS) return MC_ASSET_DECIMALS[key]!;
  // fallback: cerca solo per rete
  const rateKey = Object.keys(MC_ASSET_DECIMALS).find((k) => k.startsWith(`${network}:`));
  return rateKey ? MC_ASSET_DECIMALS[rateKey]! : 6;
}

/**
 * Converte da unità minime (integer string) a valore human-readable.
 * Usa parseFloat sicuro per importi fino a Number.MAX_SAFE_INTEGER.
 * USDT/USDA: sempre 2 decimali. BTC (8dec): 8 decimali.
 * Token con 18 decimali (USDA/BSC USDT): 4 decimali visivi.
 */
export function formatMCAmount(rawUnits: string, decimals: number): string {
  if (!rawUnits || rawUnits === "0") return "0.00";
  const val = parseFloat(rawUnits) / Math.pow(10, decimals);
  // 18-dec token: mostra 4 cifre decimali per precisione visiva
  return val.toFixed(decimals >= 18 ? 4 : 2);
}

// ─── Tipo item (speculare al backend response) ────────────────────────────────

export interface MCHistoryItem {
  transferId:    string;
  network:       string;
  asset:         string;
  grossAmount:   string;
  netAmount:     string;
  txHashDeposit: string | null;
  txHashRelease: string | null;
  senderId:      string;
  recipientId:   string;
  status:        string;
  createdAt:     string;
}

// ─── Backfill core ────────────────────────────────────────────────────────────

export interface BackfillResult {
  saved:   number;
  skipped: number;
}

/**
 * Itera i trasferimenti MultiChain completati e li inserisce nel tx-store IDB.
 *
 * Idempotente: `saveTxRecord` fa upsert su id = `${chainId}:${txHash}:${dir}:`.
 * Chiamato più volte con gli stessi item → stesso numero di record, nessun duplicato.
 *
 * @param items   Lista di trasferimenti completati (dal backend /transfers/history)
 * @param userId  auth.userId dell'utente corrente (MongoDB ObjectId come stringa)
 */
export async function backfillMCHistory(
  items: MCHistoryItem[],
  userId: string,
): Promise<BackfillResult> {
  let saved   = 0;
  let skipped = 0;

  for (const item of items) {
    // Solo "released" ha tx_hash_release garantito.
    // "refunded" ha solo tx_hash_deposit (rimborso al sender originale).
    const { network, asset, grossAmount, netAmount,
            txHashDeposit, txHashRelease, senderId, status, createdAt } = item;

    const chainId = MC_CHAIN_ID[network] ?? 0;
    // Skip Bitcoin (non EVM, tx-store usa chainId > 0 per EVM)
    if (chainId === 0) { skipped++; continue; }

    const decimals  = mcDecimalsFor(network, asset);
    const netName   = MC_NETWORK_NAME[network] ?? network;
    const isSender  = senderId === userId;
    const now       = Date.now();
    const timestamp = createdAt ? new Date(createdAt).getTime() : now;

    if (status === "released") {
      // Sender: TX di deposito dal suo wallet → escrow.
      //
      // tx_hash_deposit è null su BSC: il backend rileva il deposito via balance
      // check sull'escrow (non log scan) → la hash del deposito Trust Wallet non
      // viene mai persistita nel documento MongoDB.
      //
      // Fallback: se tx_hash_deposit è null, usa tx_hash_release come
      // identificatore stabile per il record IDB del sender (direction="out").
      //   - tx_hash_deposit (hash reale deposito) ha priorità se presente.
      //   - tx_hash_release (escrow→recipient) è fallback di indicizzazione
      //     ONLY — NON rappresenta la TX on-chain del sender.
      // Non-collision: sender → `${chainId}:${hash}:out:`,
      //                receiver → `${chainId}:${hash}:in:` → chiavi distinte.
      const effectiveOutHash = txHashDeposit ?? txHashRelease;
      if (isSender && effectiveOutHash) {
        const record: WalletTxRecord = {
          id:        `${chainId}:${effectiveOutHash}:out:`,
          chainId,
          network:   netName,
          txHash:    effectiveOutHash,
          direction: "out",
          asset,
          amount:    formatMCAmount(grossAmount, decimals),
          timestamp,
          status:    "confirmed",
          updatedAt: now,
        };
        await saveTxRecord(record);
        saved++;
      }
      // Receiver: TX di release escrow → recipient wallet
      if (!isSender && txHashRelease) {
        const record: WalletTxRecord = {
          id:        `${chainId}:${txHashRelease}:in:`,
          chainId,
          network:   netName,
          txHash:    txHashRelease,
          direction: "in",
          asset,
          amount:    formatMCAmount(netAmount, decimals),
          timestamp,
          status:    "confirmed",
          updatedAt: now,
        };
        await saveTxRecord(record);
        saved++;
      }
      // Skip counter: incrementa solo se non è stato salvato nulla.
      // - Sender: effectiveOutHash è null → né deposit né release disponibili.
      // - Receiver: txHashRelease è null.
      if (
        (isSender  && !effectiveOutHash) ||
        (!isSender && !txHashRelease)
      ) {
        skipped++;
      }
    } else if (status === "refunded" && isSender && txHashDeposit) {
      // Refund: il sender riprende i suoi fondi. Registriamo come "in" il rimborso.
      const record: WalletTxRecord = {
        id:        `${chainId}:${txHashDeposit}:refund:`,
        chainId,
        network:   netName,
        txHash:    txHashDeposit,
        direction: "in",
        asset,
        amount:    formatMCAmount(grossAmount, decimals),
        timestamp,
        status:    "confirmed",
        updatedAt: now,
      };
      await saveTxRecord(record);
      saved++;
    } else {
      skipped++;
    }
  }

  return { saved, skipped };
}
