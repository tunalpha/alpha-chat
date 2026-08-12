/**
 * Alpha Wallet — WalletContext
 *
 * Gestisce lo stato del wallet nativo (Phase A core + Phase B UI).
 * Fornito SOLO all'interno di AlphaWalletPage — non all'app globale.
 *
 * ISOLAMENTO: non importa nulla dal Payment Engine esistente.
 * SICUREZZA: la seed phrase rimane in memoria solo durante il setup,
 *            poi viene azzerata. Non è mai esposta all'app.
 */

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
import {
  hasKeystore,
  loadKeystore,
  saveKeystore,
  encryptSeed,
  decryptSeed,
  clearKeystore,
  saveWalletMeta,
  loadWalletMeta,
  markBackupVerified,
  type WalletMeta,
} from "../core/keystore";
import {
  createMnemonic,
  isValidMnemonic,
  normalizeMnemonic,
} from "../core/mnemonic";
import {
  deriveEvmAddress,
  deriveBtcAddress,
} from "../core/hd-wallet";
import {
  recordAuthSuccess,
  invalidateSession,
  isSessionValid,
  validatePin,
} from "../core/wallet-auth";
import {
  loadNotifications,
  countUnread,
  dispatchWalletNotification,
} from "../notifications/wallet-notification-store";
import type { WalletNotification } from "../notifications/wallet-notification-types";
import {
  loadCustomTokens,
  saveCustomToken,
  removeCustomToken,
  type TokenConfig,
} from "../evm/token-registry";
import { txMonitor } from "../monitoring/tx-monitor";
import {
  loadTxHistory,
  clearTxHistory,
  type WalletTxRecord,
} from "../services/tx-store";
// Task #93 — persiste gli indirizzi pubblici sul backend (best-effort, fire-and-forget)
import { apiWalletRegisterAddress } from "../../lib/alpha-wallet-api";

// ─── Tipi ─────────────────────────────────────────────────────────────────

export type WalletPhase =
  | "initializing"  // caricamento iniziale
  | "no-wallet"     // nessun wallet creato
  | "locked"        // wallet esiste ma bloccato
  | "unlocked";     // wallet sbloccato e pronto

interface WalletContextValue {
  phase: WalletPhase;
  meta: WalletMeta | null;
  selectedChainId: number;
  setSelectedChainId: (id: number) => void;
  notifications: WalletNotification[];
  unreadCount: number;
  customTokens: TokenConfig[];
  // Phase F: storico transazioni
  txHistory: WalletTxRecord[];
  refreshTxHistory: () => Promise<void>;
  // Operazioni wallet
  createWallet: (pin: string) => Promise<string>; // restituisce mnemonic
  importWallet: (mnemonic: string, pin: string) => Promise<void>;
  unlockWallet: (pin: string) => Promise<void>;
  lockWallet: () => void;
  forgetWallet: () => Promise<void>;
  confirmBackup: () => Promise<void>;
  // Notifiche
  refreshNotifications: () => Promise<void>;
  markNotificationRead: (id: string) => Promise<void>;
  // Token custom
  addCustomToken: (token: TokenConfig) => Promise<void>;
  removeToken: (chainId: number, address: string) => Promise<void>;
  // PIN management
  changeWalletPIN: (oldPin: string, newPin: string) => Promise<void>;
}

// ─── Context ───────────────────────────────────────────────────────────────

const WalletContext = createContext<WalletContextValue | null>(null);

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("[AlphaWallet] useWallet must be inside WalletProvider");
  return ctx;
}

// ─── Provider ──────────────────────────────────────────────────────────────

interface WalletProviderProps {
  children: ReactNode;
}

export function WalletProvider({ children }: WalletProviderProps) {
  const [phase, setPhase] = useState<WalletPhase>("initializing");
  const [meta, setMeta] = useState<WalletMeta | null>(null);
  const [selectedChainId, setSelectedChainId] = useState(137); // Polygon default
  const [notifications, setNotifications] = useState<WalletNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [customTokens, setCustomTokens] = useState<TokenConfig[]>([]);
  const [txHistory, setTxHistory] = useState<WalletTxRecord[]>([]);
  const monitorStarted = useRef(false);

  // ── Inizializzazione ────────────────────────────────────────────────────
  useEffect(() => {
    void (async () => {
      const exists = await hasKeystore();
      if (!exists) {
        setPhase("no-wallet");
        return;
      }
      const savedMeta = await loadWalletMeta();
      setMeta(savedMeta);
      // Session ancora valida dopo navigazione?
      if (isSessionValid()) {
        setPhase("unlocked");
        _startMonitor(savedMeta);
      } else {
        setPhase("locked");
      }
    })();
  }, []);

  // ── Notifiche e storico al mount (quando unlocked) ──────────────────────
  useEffect(() => {
    if (phase === "unlocked") {
      void _refreshNotifications();
      void _refreshCustomTokens();
      void _refreshTxHistory();
    }
  }, [phase, selectedChainId]);

  // ── Monitor callback ────────────────────────────────────────────────────
  const _startMonitor = useCallback((m: WalletMeta | null) => {
    if (!m || monitorStarted.current) return;
    monitorStarted.current = true;
    txMonitor.onNewTransaction(() => {
      void _refreshNotifications();
      void _refreshTxHistory();
      // Notifica AlphaWalletPage (e altri listener) di aggiornare il saldo
      window.dispatchEvent(new CustomEvent("aw:new-tx"));
    });
    txMonitor.start(m.evmAddress, m.btcAddress);
  }, []);

  const _refreshNotifications = useCallback(async () => {
    const [notifs, unread] = await Promise.all([
      loadNotifications(),
      countUnread(),
    ]);
    setNotifications(notifs);
    setUnreadCount(unread);
  }, []);

  const _refreshCustomTokens = useCallback(async () => {
    const tokens = await loadCustomTokens(selectedChainId);
    setCustomTokens(tokens);
  }, [selectedChainId]);

  const _refreshTxHistory = useCallback(async () => {
    const history = await loadTxHistory(100);
    setTxHistory(history);
  }, []);

  // ── Operazioni wallet ───────────────────────────────────────────────────

  const createWallet = useCallback(async (pin: string): Promise<string> => {
    if (!validatePin(pin)) throw new Error("[AlphaWallet] PIN non valido");
    const mnemonic = createMnemonic(128);
    const evmAddress = await deriveEvmAddress(mnemonic);
    const btcAddress = await deriveBtcAddress(mnemonic);
    const entry = await encryptSeed(mnemonic, pin);
    const walletMeta: WalletMeta = {
      evmAddress,
      btcAddress,
      backupVerified: false,
      createdAt: Date.now(),
    };
    await saveKeystore(entry);
    await saveWalletMeta(walletMeta);
    setMeta(walletMeta);
    // Task #93: persiste indirizzi pubblici sul backend (best-effort, fire-and-forget)
    // Non blocca il flusso — il pagamento funziona anche se fallisce
    apiWalletRegisterAddress({ evmAddress, btcAddress }).catch(() => { /* best-effort */ });
    // NON impostare phase qui — il flusso continua con backup/verifica
    return mnemonic;
  }, []);

  const importWallet = useCallback(async (mnemonic: string, pin: string): Promise<void> => {
    const normalized = normalizeMnemonic(mnemonic);
    if (!isValidMnemonic(normalized)) {
      throw new Error("[AlphaWallet] Seed phrase non valida");
    }
    if (!validatePin(pin)) throw new Error("[AlphaWallet] PIN non valido");
    const evmAddress = await deriveEvmAddress(normalized);
    const btcAddress = await deriveBtcAddress(normalized);
    const entry = await encryptSeed(normalized, pin);
    const walletMeta: WalletMeta = {
      evmAddress,
      btcAddress,
      backupVerified: true, // import = seed già nota all'utente
      createdAt: Date.now(),
    };
    await saveKeystore(entry);
    await saveWalletMeta(walletMeta);
    setMeta(walletMeta);
    recordAuthSuccess();
    // Cache PIN per sblocco biometrico nella stessa sessione
    try { sessionStorage.setItem("aw_bio_pin", pin); } catch { /* ignore */ }
    setPhase("unlocked");
    _startMonitor(walletMeta);
    // Task #93: persiste indirizzi pubblici sul backend (best-effort, fire-and-forget)
    apiWalletRegisterAddress({ evmAddress, btcAddress }).catch(() => { /* best-effort */ });
  }, [_startMonitor]);

  const unlockWallet = useCallback(async (pin: string): Promise<void> => {
    const entry = await loadKeystore();
    if (!entry) throw new Error("[AlphaWallet] Keystore non trovato");
    // Verifica PIN (lancia eccezione se sbagliato)
    await decryptSeed(entry, pin);
    recordAuthSuccess();
    // Cache PIN per sblocco biometrico nella stessa sessione
    try { sessionStorage.setItem("aw_bio_pin", pin); } catch { /* ignore */ }
    const savedMeta = await loadWalletMeta();
    setMeta(savedMeta);
    setPhase("unlocked");
    _startMonitor(savedMeta);
  }, [_startMonitor]);

  const lockWallet = useCallback(() => {
    invalidateSession();
    txMonitor.stop();
    monitorStarted.current = false;
    setPhase("locked");
    setNotifications([]);
  }, []);

  const forgetWallet = useCallback(async () => {
    txMonitor.stop();
    monitorStarted.current = false;
    await clearKeystore();
    await TxMonitor_resetState();
    await clearTxHistory();
    try { sessionStorage.removeItem("aw_bio_pin"); } catch { /* ignore */ }
    setMeta(null);
    setPhase("no-wallet");
    setNotifications([]);
    setTxHistory([]);
  }, []);

  const confirmBackup = useCallback(async () => {
    await markBackupVerified();
    setMeta(prev => prev ? { ...prev, backupVerified: true } : prev);
    recordAuthSuccess();
    setPhase("unlocked");
    if (meta) _startMonitor(meta);
  }, [meta, _startMonitor]);

  const handleMarkRead = useCallback(async (id: string) => {
    const { markNotificationRead: mark } = await import(
      "../notifications/wallet-notification-store"
    );
    await mark(id);
    await _refreshNotifications();
  }, [_refreshNotifications]);

  const addToken = useCallback(async (token: TokenConfig) => {
    await saveCustomToken(token);
    await _refreshCustomTokens();
  }, [_refreshCustomTokens]);

  const removeToken = useCallback(async (chainId: number, address: string) => {
    await removeCustomToken(chainId, address);
    await _refreshCustomTokens();
  }, [_refreshCustomTokens]);

  const changeWalletPIN = useCallback(async (oldPin: string, newPin: string): Promise<void> => {
    if (!validatePin(newPin)) throw new Error("[AlphaWallet] Nuovo PIN non valido");
    const entry = await loadKeystore();
    if (!entry) throw new Error("[AlphaWallet] Keystore non trovato");
    // Decripta con vecchio PIN (lancia eccezione se errato)
    const seed = await decryptSeed(entry, oldPin);
    // Ri-cifra con nuovo PIN
    const newEntry = await encryptSeed(seed, newPin);
    await saveKeystore(newEntry);
    // Aggiorna cache biometrica
    try { sessionStorage.setItem("aw_bio_pin", newPin); } catch { /* ignore */ }
  }, []);

  return (
    <WalletContext.Provider
      value={{
        phase,
        meta,
        selectedChainId,
        setSelectedChainId,
        notifications,
        unreadCount,
        customTokens,
        txHistory,
        refreshTxHistory: _refreshTxHistory,
        createWallet,
        importWallet,
        unlockWallet,
        lockWallet,
        forgetWallet,
        confirmBackup,
        refreshNotifications: _refreshNotifications,
        markNotificationRead: handleMarkRead,
        addCustomToken: addToken,
        removeToken,
        changeWalletPIN,
      }}
    >
      {children}
    </WalletContext.Provider>
  );
}

// Helper per reset monitor state (evita circular import)
async function TxMonitor_resetState() {
  const { TxMonitor } = await import("../monitoring/tx-monitor");
  await TxMonitor.resetState();
}

export { dispatchWalletNotification };
