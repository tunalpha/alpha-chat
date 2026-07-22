/**
 * UsdaWalletCard — card "👛 Wallet USDA" nel profilo utente.
 *
 * Legge il saldo ESCLUSIVAMENTE dalla blockchain Polygon via RPC (ERC20 balanceOf).
 * MAI dal database, MAI dalla cache.
 *
 * Stack: wagmi v3 + viem + Reown AppKit (sostituisce ThirdWeb)
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { useAccount, useChainId } from "wagmi";
import { erc20Abi } from "viem";

import {
  walletModal,
  polygonPublicClient,
  USDA_CONTRACT_ADDRESS,
  USDA_CHAIN_ID,
} from "../../lib/wallet-client";
import { useWs } from "../../contexts/WebSocketContext";

// ── Costanti ──────────────────────────────────────────────────────────────────

const USDA_DECIMALS_FACTOR = 1e18;   // 18 decimali ERC-20
const BALANCE_TIMEOUT      = 12_000; // 12 s — poi mostra N/D

// ── Tipi ─────────────────────────────────────────────────────────────────────

type BalanceState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ok"; value: number; updatedAt: Date };

export interface UsdaWalletCardProps {
  onSend:    () => void;
  onRequest: () => void;
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

// ── Lettura on-chain via viem ─────────────────────────────────────────────────

async function fetchOnChainBalance(address: `0x${string}`): Promise<number> {
  const raw = await Promise.race<bigint>([
    polygonPublicClient.readContract({
      address:      USDA_CONTRACT_ADDRESS,
      abi:          erc20Abi,
      functionName: "balanceOf",
      args:         [address],
    }) as Promise<bigint>,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("RPC timeout")), BALANCE_TIMEOUT),
    ),
  ]);
  return Number(raw) / USDA_DECIMALS_FACTOR;
}

// ── Componente ────────────────────────────────────────────────────────────────

export function UsdaWalletCard({ onSend, onRequest, onManage }: UsdaWalletCardProps) {
  const { address, isConnected } = useAccount();
  const chainId  = useChainId();
  const { on }   = useWs();

  const isCorrectNetwork = chainId === USDA_CHAIN_ID;

  const [balance,    setBalance]    = useState<BalanceState>({ status: "loading" });
  const [relTime,    setRelTime]    = useState("pochi secondi fa");
  const [refreshing, setRefreshing] = useState(false);
  const prevAddressRef = useRef<string | null>(null);

  // ── Fetch saldo on-chain ─────────────────────────────────────────────────
  const fetchBalance = useCallback(async (addr: `0x${string}`) => {
    setBalance({ status: "loading" });
    try {
      const value = await fetchOnChainBalance(addr);
      const now   = new Date();
      setBalance({ status: "ok", value, updatedAt: now });
      setRelTime(relativeTime(now));
    } catch {
      setBalance({ status: "error" });
    }
  }, []);

  const handleRefresh = useCallback(async () => {
    if (!address || refreshing) return;
    setRefreshing(true);
    await fetchBalance(address as `0x${string}`);
    setRefreshing(false);
  }, [address, fetchBalance, refreshing]);

  // ── Trigger: mount + cambio account ──────────────────────────────────────
  useEffect(() => {
    if (!address || !isConnected) { setBalance({ status: "loading" }); return; }
    if (prevAddressRef.current === address) return;
    prevAddressRef.current = address;
    void fetchBalance(address as `0x${string}`);
  }, [address, isConnected, fetchBalance]);

  // ── Trigger: foreground resume ────────────────────────────────────────────
  useEffect(() => {
    const handler = () => {
      if (document.visibilityState === "visible" && address) {
        void fetchBalance(address as `0x${string}`);
      }
    };
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  }, [address, fetchBalance]);

  // ── Trigger: evento WS pagamento ─────────────────────────────────────────
  useEffect(() => {
    return on((event) => {
      if (event.type === "usda.payment.update" && address) {
        void fetchBalance(address as `0x${string}`);
      }
    });
  }, [on, address, fetchBalance]);

  // ── Tick "Aggiornato X fa" ────────────────────────────────────────────────
  useEffect(() => {
    if (balance.status !== "ok") return;
    const id = setInterval(() => {
      setRelTime(relativeTime((balance as { status: "ok"; value: number; updatedAt: Date }).updatedAt));
    }, 30_000);
    return () => clearInterval(id);
  }, [balance]);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="uwc-card" aria-label="Wallet USDA">

      {/* Intestazione */}
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

      {/* Wallet non collegato */}
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
            <button
              type="button"
              className="uwc-connect-btn"
              style={{ touchAction: "manipulation", WebkitTapHighlightColor: "transparent" }}
              onClick={() => walletModal.open()}
            >
              🔗 Collega Wallet
            </button>
          </div>
        </div>
      )}

      {/* Wallet collegato */}
      {isConnected && address && (
        <>
          <div className="uwc-connected-header">
            <div className={`uwc-status-badge ${isCorrectNetwork ? "uwc-status-badge--ok" : "uwc-status-badge--warn"}`}>
              <span className="uwc-status-dot" aria-hidden="true" />
              {isCorrectNetwork ? "Wallet collegato" : "Rete non corretta"}
            </div>
            <div className="uwc-address" aria-label={`Indirizzo: ${address}`}>
              <span className="uwc-address-label">Indirizzo Polygon</span>
              <span className="uwc-address-value">{abbrev(address)}</span>
            </div>
          </div>

          <div className="uwc-balance-section" aria-live="polite" aria-atomic="true">
            {balance.status === "loading" && (
              <div className="uwc-shimmer-wrap" aria-label="Caricamento saldo">
                <div className="uwc-shimmer-label" /><div className="uwc-shimmer-value" /><div className="uwc-shimmer-sub" />
              </div>
            )}
            {balance.status === "error" && (
              <div className="uwc-balance-error">
                <div className="uwc-balance-label">💰 Saldo USDA</div>
                <div className="uwc-balance-nd">N/D</div>
                <div className="uwc-balance-error-msg">Impossibile recuperare il saldo in questo momento.</div>
              </div>
            )}
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
                    <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                  </svg>
                  Aggiornato {relTime}
                </div>
              </>
            )}
          </div>

          <div className="uwc-actions" role="group" aria-label="Azioni wallet USDA">
            <button type="button" className="uwc-action-btn uwc-action-btn--primary" onClick={onSend}>
              <span aria-hidden="true">💸</span><span>Invia USDA</span>
            </button>
            <button type="button" className="uwc-action-btn uwc-action-btn--secondary" onClick={onRequest}>
              <span aria-hidden="true">📥</span><span>Richiedi</span>
            </button>
            <button type="button" className="uwc-action-btn uwc-action-btn--ghost" onClick={onManage}>
              <span aria-hidden="true">⚙️</span><span>Gestisci</span>
            </button>
          </div>
        </>
      )}
    </div>
  );
}
