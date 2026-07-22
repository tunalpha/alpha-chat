/**
 * UsdaWalletCard — card "👛 Wallet USDA" nel profilo utente.
 *
 * Legge il saldo ESCLUSIVAMENTE dalla blockchain Polygon via RPC (ERC20 balanceOf).
 * MAI dal database, MAI dalla cache.
 *
 * Aggiornamento automatico su:
 *  • mount
 *  • visibilitychange (app torna in foreground)
 *  • evento WS "usda.payment.update"
 *  • tap sul pulsante refresh
 *
 * RPC: usa polygonMainnet da thirdweb-client.ts.
 * Per sostituire con Alchemy: imposta VITE_POLYGON_RPC nell'env.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import {
  useActiveAccount,
  useActiveWalletChain,
  ConnectButton,
} from "thirdweb/react";
import { createWallet, walletConnect } from "thirdweb/wallets";
import { getContract, readContract } from "thirdweb";

import {
  thirdwebClient,
  polygonMainnet,
  USDA_CONTRACT_ADDRESS,
  USDA_CHAIN_ID,
  THIRDWEB_READY,
  WC_PROJECT_ID,
  APP_METADATA,
} from "../../lib/thirdweb-client";
import { useWs } from "../../contexts/WebSocketContext";

// ── Costanti ──────────────────────────────────────────────────────────────────

const USDA_DECIMALS   = 1_000_000; // 6 decimali
const BALANCE_TIMEOUT = 12_000;    // 12 s — poi mostra N/D

const SUPPORTED_WALLETS = [
  createWallet("io.metamask"),
  createWallet("com.coinbase.wallet"),
  walletConnect(),
  createWallet("me.rainbow"),
  createWallet("com.trustwallet.app"),
];

// ── Tipi ─────────────────────────────────────────────────────────────────────

type BalanceState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ok"; value: number; updatedAt: Date };

export interface UsdaWalletCardProps {
  /** Apre il flow di invio USDA (naviga al wallet center) */
  onSend:    () => void;
  /** Apre il flow di richiesta USDA */
  onRequest: () => void;
  /** Apre la gestione wallet (usda-settings o wallet-center) */
  onManage:  () => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function abbrev(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function relativeTime(date: Date): string {
  const secs = Math.round((Date.now() - date.getTime()) / 1000);
  if (secs < 10)  return "pochi secondi fa";
  if (secs < 60)  return `${secs} secondi fa`;
  if (secs < 120) return "1 minuto fa";
  return `${Math.round(secs / 60)} minuti fa`;
}

function formatBalance(val: number): string {
  return val.toFixed(4);
}

// ── Lettura on-chain ──────────────────────────────────────────────────────────

async function fetchOnChainBalance(address: string): Promise<number> {
  const contract = getContract({
    client:  thirdwebClient,
    chain:   polygonMainnet,
    address: USDA_CONTRACT_ADDRESS,
  });

  // ERC-20 balanceOf — chiamata RPC diretta, nessun dato dal DB
  const raw = await Promise.race<bigint>([
    readContract({
      contract,
      method:  "function balanceOf(address owner) view returns (uint256)",
      params:  [address as `0x${string}`],
    }),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("RPC timeout")), BALANCE_TIMEOUT),
    ),
  ]);

  return Number(raw) / USDA_DECIMALS;
}

// ── Componente ────────────────────────────────────────────────────────────────

export function UsdaWalletCard({ onSend, onRequest, onManage }: UsdaWalletCardProps) {
  const account     = useActiveAccount();
  const activeChain = useActiveWalletChain();
  const { on }      = useWs();

  const isConnected      = !!account;
  const isCorrectNetwork = activeChain?.id === USDA_CHAIN_ID;

  const [balance,     setBalance]     = useState<BalanceState>({ status: "loading" });
  const [relTime,     setRelTime]     = useState("pochi secondi fa");
  const [refreshing,  setRefreshing]  = useState(false);
  const prevAddressRef = useRef<string | null>(null);

  // ── Fetch saldo on-chain ─────────────────────────────────────────────────
  const fetchBalance = useCallback(async (addr: string) => {
    setBalance({ status: "loading" });
    try {
      const value = await fetchOnChainBalance(addr);
      const now   = new Date();
      setBalance({ status: "ok", value, updatedAt: now });
      setRelTime(relativeTime(now));
    } catch {
      // RPC fallita: NON usare DB né cache — mostra N/D
      setBalance({ status: "error" });
    }
  }, []);

  // Refresh manuale (pulsante)
  const handleRefresh = useCallback(async () => {
    if (!account?.address || refreshing) return;
    setRefreshing(true);
    await fetchBalance(account.address);
    setRefreshing(false);
  }, [account?.address, fetchBalance, refreshing]);

  // ── Trigger: mount + cambio account ──────────────────────────────────────
  useEffect(() => {
    if (!account?.address || !THIRDWEB_READY) {
      setBalance({ status: "loading" });
      return;
    }
    if (prevAddressRef.current === account.address) return;
    prevAddressRef.current = account.address;
    void fetchBalance(account.address);
  }, [account?.address, fetchBalance]);

  // ── Trigger: foreground resume ────────────────────────────────────────────
  useEffect(() => {
    const handler = () => {
      if (document.visibilityState === "visible" && account?.address) {
        void fetchBalance(account.address);
      }
    };
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  }, [account?.address, fetchBalance]);

  // ── Trigger: evento WS pagamento (inviato o ricevuto) ────────────────────
  useEffect(() => {
    return on((event) => {
      if (event.type === "usda.payment.update" && account?.address) {
        void fetchBalance(account.address);
      }
    });
  }, [on, account?.address, fetchBalance]);

  // ── Tick "Aggiornato X fa" ────────────────────────────────────────────────
  useEffect(() => {
    if (balance.status !== "ok") return;
    const id = setInterval(() => {
      setRelTime(relativeTime((balance as { status: "ok"; value: number; updatedAt: Date }).updatedAt));
    }, 30_000);
    return () => clearInterval(id);
  }, [balance]);

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────

  if (!THIRDWEB_READY) return null; // Non mostrare nulla se ThirdWeb non è configurato

  return (
    <div className="uwc-card" aria-label="Wallet USDA">

      {/* ── Intestazione ──────────────────────────────────────────────────── */}
      <div className="uwc-header">
        <div className="uwc-title-row">
          <span className="uwc-title-icon" aria-hidden="true">👛</span>
          <span className="uwc-title">Wallet USDA</span>
        </div>
        {isConnected && (
          <button
            type="button"
            className={`uwc-refresh-btn${refreshing ? " uwc-refresh-btn--spinning" : ""}`}
            aria-label="Aggiorna saldo"
            onClick={handleRefresh}
            disabled={refreshing}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"
                 strokeLinecap="round" strokeLinejoin="round" width="16" height="16" aria-hidden="true">
              <polyline points="23 4 23 10 17 10"/>
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
            </svg>
          </button>
        )}
      </div>

      {/* ══════════════════════════════════════════════════════════════════
          STATO: wallet NON collegato
      ══════════════════════════════════════════════════════════════════ */}
      {!isConnected && (
        <div className="uwc-disconnected">
          <div className="uwc-status-badge uwc-status-badge--warn">
            <span className="uwc-status-dot" aria-hidden="true" />
            Wallet non collegato
          </div>
          <p className="uwc-disconnect-msg">
            Per utilizzare USDA collega il tuo Wallet Polygon.
          </p>
          <div className="uwc-connect-wrap">
            <ConnectButton
              client={thirdwebClient}
              chain={polygonMainnet}
              wallets={SUPPORTED_WALLETS}
              appMetadata={APP_METADATA}
              walletConnect={{ projectId: WC_PROJECT_ID }}
              connectModal={{
                title:         "Connetti Wallet",
                size:          "compact",
                welcomeScreen: {
                  title:    "💸 Pagamenti USDA",
                  subtitle: "Connetti il wallet per inviare e ricevere USDA in chat",
                },
              }}
              connectButton={{ label: "🔗 Collega Wallet" }}
            />
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          STATO: wallet collegato
      ══════════════════════════════════════════════════════════════════ */}
      {isConnected && (
        <>
          {/* Status badge */}
          <div className="uwc-connected-header">
            <div className={`uwc-status-badge ${isCorrectNetwork ? "uwc-status-badge--ok" : "uwc-status-badge--warn"}`}>
              <span className="uwc-status-dot" aria-hidden="true" />
              {isCorrectNetwork ? "Wallet collegato" : "Rete non corretta"}
            </div>
            <div className="uwc-address" aria-label={`Indirizzo: ${account.address}`}>
              <span className="uwc-address-label">Indirizzo Polygon</span>
              <span className="uwc-address-value">{abbrev(account.address)}</span>
            </div>
          </div>

          {/* ── Saldo ────────────────────────────────────────────────────── */}
          <div className="uwc-balance-section" aria-live="polite" aria-atomic="true">

            {/* LOADING — shimmer */}
            {balance.status === "loading" && (
              <div className="uwc-shimmer-wrap" aria-label="Caricamento saldo">
                <div className="uwc-shimmer-label" />
                <div className="uwc-shimmer-value" />
                <div className="uwc-shimmer-sub" />
              </div>
            )}

            {/* ERROR — N/D (niente DB, niente cache) */}
            {balance.status === "error" && (
              <div className="uwc-balance-error">
                <div className="uwc-balance-label">💰 Saldo USDA</div>
                <div className="uwc-balance-nd">N/D</div>
                <div className="uwc-balance-error-msg">
                  Impossibile recuperare il saldo in questo momento.
                </div>
              </div>
            )}

            {/* OK — saldo disponibile */}
            {balance.status === "ok" && (
              <>
                {balance.value === 0 ? (
                  <>
                    <div className="uwc-balance-label">💸 Saldo disponibile</div>
                    <div className="uwc-balance-value">0.0000 <span className="uwc-currency">USDA</span></div>
                    <div className="uwc-zero-msg">Ricevi il tuo primo pagamento USDA per iniziare.</div>
                  </>
                ) : (
                  <>
                    <div className="uwc-balance-label">💰 Saldo disponibile</div>
                    <div className="uwc-balance-value">
                      {formatBalance(balance.value)} <span className="uwc-currency">USDA</span>
                    </div>
                  </>
                )}
                <div className="uwc-updated-at">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                       width="11" height="11" aria-hidden="true">
                    <circle cx="12" cy="12" r="10"/>
                    <polyline points="12 6 12 12 16 14"/>
                  </svg>
                  Aggiornato {relTime}
                </div>
              </>
            )}
          </div>

          {/* ── Azioni ───────────────────────────────────────────────────── */}
          <div className="uwc-actions" role="group" aria-label="Azioni wallet USDA">
            <button type="button" className="uwc-action-btn uwc-action-btn--primary" onClick={onSend}>
              <span aria-hidden="true">💸</span>
              <span>Invia USDA</span>
            </button>
            <button type="button" className="uwc-action-btn uwc-action-btn--secondary" onClick={onRequest}>
              <span aria-hidden="true">📥</span>
              <span>Richiedi</span>
            </button>
            <button type="button" className="uwc-action-btn uwc-action-btn--ghost" onClick={onManage}>
              <span aria-hidden="true">⚙️</span>
              <span>Gestisci</span>
            </button>
          </div>
        </>
      )}
    </div>
  );
}
