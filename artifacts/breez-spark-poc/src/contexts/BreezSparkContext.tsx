/**
 * BREEZ SPARK — CONTEXT E STATE MACHINE
 *
 * Provider React completamente isolato da WalletContext BTC esistente.
 * Gestisce:
 *   - State machine connessione (disconnected → connecting → connected/error/unavailable)
 *   - Lifecycle SDK (connect, disconnect, sync, foreground re-sync)
 *   - Selezione adapter (MockBreezAdapter vs LiveBreezAdapter)
 *   - Nessuna modifica al WalletContext BTC
 */

import {
  createContext, useContext, useReducer, useCallback, useEffect, useRef,
  type ReactNode,
} from 'react';
import { createBreezAdapter } from '../lib/breez-spark/adapter';
import type { BreezSparkAdapter } from '../lib/breez-spark/adapter';
import {
  getSparkApiKey, isApiKeyConfigured, SPARK_NETWORK, SPARK_TIMEOUTS,
} from '../lib/breez-spark/constants';
import type {
  SparkConnectionState, SparkError, SparkInfo, SparkBalance,
  SparkPayment, ReceiveRequest, ReceiveResponse,
  PrepareSendRequest, PrepareSendResponse, SendRequest, SendResponse,
  ListPaymentsRequest, WebhookConfig,
} from '../lib/breez-spark/types';

// ─── State ────────────────────────────────────────────────────────────────────

interface SparkState {
  connectionState: SparkConnectionState;
  error: SparkError | null;
  info: SparkInfo | null;
  balance: SparkBalance | null;
  adapterType: 'mock' | 'live' | null;
  apiKeyConfigured: boolean;
  network: 'mainnet' | 'regtest';
  lastSynced: number | null;
}

type SparkAction =
  | { type: 'CONNECTING' }
  | { type: 'CONNECTED'; info: SparkInfo; balance: SparkBalance; adapterType: 'mock' | 'live' }
  | { type: 'SYNCING' }
  | { type: 'SYNCED'; balance: SparkBalance; lastSynced: number }
  | { type: 'DISCONNECTED' }
  | { type: 'UNAVAILABLE' }
  | { type: 'ERROR'; error: SparkError };

function sparkReducer(state: SparkState, action: SparkAction): SparkState {
  switch (action.type) {
    case 'CONNECTING':
      return { ...state, connectionState: 'connecting', error: null };
    case 'CONNECTED':
      return {
        ...state,
        connectionState: 'connected',
        error: null,
        info: action.info,
        balance: action.balance,
        adapterType: action.adapterType,
        lastSynced: Date.now(),
      };
    case 'SYNCING':
      return { ...state, connectionState: 'syncing' };
    case 'SYNCED':
      return {
        ...state,
        connectionState: 'connected',
        balance: action.balance,
        lastSynced: action.lastSynced,
      };
    case 'DISCONNECTED':
      return { ...state, connectionState: 'disconnected', info: null, balance: null };
    case 'UNAVAILABLE':
      return { ...state, connectionState: 'unavailable' };
    case 'ERROR':
      return { ...state, connectionState: 'error', error: action.error };
    default:
      return state;
  }
}

const initialState: SparkState = {
  connectionState: 'disconnected',
  error: null,
  info: null,
  balance: null,
  adapterType: null,
  apiKeyConfigured: isApiKeyConfigured(),
  network: SPARK_NETWORK.DEFAULT,
  lastSynced: null,
};

// ─── Context interface ────────────────────────────────────────────────────────

interface BreezSparkContextValue {
  // State
  state: SparkState;

  // Azioni
  connect: (mnemonic: string, network?: 'mainnet' | 'regtest') => Promise<void>;
  disconnect: () => Promise<void>;
  sync: () => Promise<void>;

  // Wallet ops
  getInfo: (ensureSynced?: boolean) => Promise<SparkInfo | null>;
  receive: (req: ReceiveRequest) => Promise<ReceiveResponse | null>;
  prepareSend: (req: PrepareSendRequest) => Promise<PrepareSendResponse | null>;
  send: (req: SendRequest) => Promise<SendResponse | null>;
  listPayments: (req?: ListPaymentsRequest) => Promise<SparkPayment[]>;
  registerWebhook: (config: WebhookConfig) => Promise<void>;

  // Helpers
  isConnected: boolean;
  isMockMode: boolean;
}

const BreezSparkContext = createContext<BreezSparkContextValue | null>(null);

// ─── Provider ─────────────────────────────────────────────────────────────────

interface BreezSparkProviderProps {
  children: ReactNode;
}

export function BreezSparkProvider({ children }: BreezSparkProviderProps) {
  const [state, dispatch] = useReducer(sparkReducer, initialState);
  const adapterRef = useRef<BreezSparkAdapter | null>(null);
  const mnemonicRef = useRef<string | null>(null);

  // Re-sync al ritorno in foreground (iOS PWA: WebSocket chiusa in background)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && state.connectionState === 'connected') {
        void syncAdapter();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.connectionState]);

  const connect = useCallback(async (mnemonic: string, network: 'mainnet' | 'regtest' = SPARK_NETWORK.DEFAULT) => {
    if (state.connectionState === 'connecting') return;

    mnemonicRef.current = mnemonic;
    dispatch({ type: 'CONNECTING' });

    try {
      const apiKey = getSparkApiKey();
      const adapter = await createBreezAdapter(apiKey);
      adapterRef.current = adapter;

      await adapter.connect(apiKey, mnemonic, network);

      const [info, balance] = await Promise.all([
        adapter.getInfo(false),
        adapter.getBalance(),
      ]);

      dispatch({
        type: 'CONNECTED',
        info,
        balance,
        adapterType: adapter.adapterType,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const isApiKeyError = message.includes('API key') || message.includes('Missing Breez');

      dispatch({
        type: 'ERROR',
        error: {
          code: isApiKeyError ? 'API_KEY_MISSING' : 'CONNECT_FAILED',
          message,
          recoverable: isApiKeyError,
        },
      });
    }
  }, [state.connectionState]);

  const disconnect = useCallback(async () => {
    if (adapterRef.current) {
      await adapterRef.current.disconnect().catch(() => {});
      adapterRef.current = null;
    }
    mnemonicRef.current = null;
    dispatch({ type: 'DISCONNECTED' });
  }, []);

  const syncAdapter = useCallback(async () => {
    if (!adapterRef.current || state.connectionState !== 'connected') return;
    dispatch({ type: 'SYNCING' });
    try {
      await adapterRef.current.sync();
      const balance = await adapterRef.current.getBalance();
      dispatch({ type: 'SYNCED', balance, lastSynced: Date.now() });
    } catch (err) {
      console.warn('[BreezSparkContext] sync failed:', err);
      dispatch({ type: 'CONNECTED', info: state.info!, balance: state.balance!, adapterType: state.adapterType! });
    }
  }, [state.connectionState, state.info, state.balance, state.adapterType]);

  const getInfo = useCallback(async (ensureSynced = false): Promise<SparkInfo | null> => {
    if (!adapterRef.current) return null;
    return adapterRef.current.getInfo(ensureSynced);
  }, []);

  const receive = useCallback(async (req: ReceiveRequest): Promise<ReceiveResponse | null> => {
    if (!adapterRef.current) return null;
    return adapterRef.current.receive(req);
  }, []);

  const prepareSend = useCallback(async (req: PrepareSendRequest): Promise<PrepareSendResponse | null> => {
    if (!adapterRef.current) return null;
    return adapterRef.current.prepareSend(req);
  }, []);

  const send = useCallback(async (req: SendRequest): Promise<SendResponse | null> => {
    if (!adapterRef.current) return null;
    return adapterRef.current.send(req);
  }, []);

  const listPayments = useCallback(async (req?: ListPaymentsRequest): Promise<SparkPayment[]> => {
    if (!adapterRef.current) return [];
    return adapterRef.current.listPayments(req);
  }, []);

  const registerWebhook = useCallback(async (config: WebhookConfig): Promise<void> => {
    if (!adapterRef.current) return;
    return adapterRef.current.registerWebhook(config);
  }, []);

  const value: BreezSparkContextValue = {
    state,
    connect,
    disconnect,
    sync: syncAdapter,
    getInfo,
    receive,
    prepareSend,
    send,
    listPayments,
    registerWebhook,
    isConnected: state.connectionState === 'connected' || state.connectionState === 'syncing',
    isMockMode: state.adapterType === 'mock',
  };

  return (
    <BreezSparkContext.Provider value={value}>
      {children}
    </BreezSparkContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useBreezSpark(): BreezSparkContextValue {
  const ctx = useContext(BreezSparkContext);
  if (!ctx) throw new Error('useBreezSpark must be used within BreezSparkProvider');
  return ctx;
}
