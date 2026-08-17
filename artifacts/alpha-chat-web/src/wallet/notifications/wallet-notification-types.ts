/**
 * Alpha Wallet — Notification Types
 *
 * Sistema di notifiche completamente separato dal Payment Engine esistente.
 * Le notifiche sono generate dal Transaction Monitor e salvate in IndexedDB.
 *
 * SICUREZZA: Le notifiche non contengono MAI:
 *   - seed phrase / private key / PIN
 *   - dati di signing / materiale crittografico
 * Contengono solo informazioni pubbliche della blockchain.
 */

export type WalletNotificationType =
  | "received"   // fondi in entrata confermati
  | "sent"       // fondi in uscita confermati
  | "pending"    // tx inviata, in attesa conferma
  | "confirmed"  // tx confermata (aggiornamento di pending)
  | "failed";    // tx fallita

export type WalletNotificationStatus = "pending" | "confirmed" | "failed";

export type WalletAssetSymbol =
  | "ETH" | "POL" | "BNB" | "BTC"
  | "USDT" | "USDC" | "USDA"
  | string; // custom tokens

export interface WalletNotification {
  /** ID univoco (uuid-like, generato localmente) */
  id: string;
  /**
   * Chiave di deduplicazione.
   * Formato: `${chainId}:${txHash}:${type}:${logIndex ?? ""}`
   * Per BTC: `btc:${txid}:${type}:`
   */
  dedupKey: string;
  type: WalletNotificationType;
  /** ChainId EVM (0 per BTC) */
  chainId: number;
  /** Nome rete leggibile */
  network: string;
  /** Symbol del token */
  asset: WalletAssetSymbol;
  /** Importo human-readable (es. "100.50") */
  amount: string;
  /** Hash transazione (txid per BTC) */
  txHash: string;
  /** LogIndex dell'evento ERC-20 Transfer (per dedup su same-tx multiple transfers) */
  logIndex?: number;
  fromAddress?: string;
  toAddress?: string;
  /** Timestamp in ms (da blockchain o locale) */
  timestamp: number;
  /** Notifica già vista dall'utente */
  read: boolean;
  status: WalletNotificationStatus;
}

/** Numero massimo di notifiche conservate in IDB */
export const MAX_NOTIFICATIONS_STORED = 200;

/** Genera un ID univoco per una notifica */
export function generateNotificationId(): string {
  return `wn_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

/** Genera la chiave di deduplicazione */
export function buildDedupKey(
  chainId: number,
  txHash: string,
  type: WalletNotificationType,
  logIndex?: number
): string {
  return `${chainId}:${txHash}:${type}:${logIndex ?? ""}`;
}

/** Etichetta leggibile per la rete dato il chainId */
export function chainName(chainId: number): string {
  const names: Record<number, string> = {
    1: "Ethereum",
    137: "Polygon",
    56: "BNB Smart Chain",
    0: "Bitcoin",
  };
  return names[chainId] ?? `Chain ${chainId}`;
}

/** Emoji icona per tipo di notifica */
export function notificationIcon(type: WalletNotificationType): string {
  switch (type) {
    case "received":  return "💰";
    case "sent":      return "💸";
    case "pending":   return "⏳";
    case "confirmed": return "✅";
    case "failed":    return "❌";
  }
}

/** Titolo push notification */
export function notificationTitle(n: WalletNotification): string {
  switch (n.type) {
    case "received":  return `💰 Alpha Wallet — ${n.amount} ${n.asset} ricevuto`;
    case "sent":      return `💸 Alpha Wallet — Invio ${n.asset} confermato`;
    case "pending":   return `⏳ Alpha Wallet — ${n.asset} in attesa`;
    case "confirmed": return `✅ Alpha Wallet — Transazione confermata`;
    case "failed":    return `❌ Alpha Wallet — Transazione fallita`;
  }
}

/** Corpo push notification */
export function notificationBody(n: WalletNotification): string {
  return `${n.network} · ${n.status === "confirmed" ? "Confermato" : n.status === "pending" ? "In attesa" : "Fallito"}`;
}
