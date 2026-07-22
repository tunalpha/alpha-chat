/**
 * WalletCenterPage — hub completo per i pagamenti USDA.
 *
 * Sezioni:
 *   Saldo      — balance USDA + indirizzi wallet per chain
 *   Storico    — tutti i pagamenti con filtri (usa UsdaHistory)
 *   Impostazioni — wallet multi-chain (aggiunta/modifica indirizzi)
 */

import { useState, useEffect } from "react";
import { apiUsdaGetWallet, apiUsdaGetHistory, apiUsdaGetCapabilities, apiUsdaGetInfo } from "../lib/usda-api";
import type { WalletInfo, UsdaPaymentData, UsdaBackendInfo, UsdaCapabilities, WalletChain } from "../lib/usda-types";
import { WALLET_CHAIN_LABELS, USDA_STATUS_LABELS, USDA_STATUS_ICONS } from "../lib/usda-types";
import { WalletSetupSheet } from "../components/usda/WalletSetupSheet";
import { UsdaPaymentDetail } from "../components/usda/UsdaPaymentDetail";

type Tab = "saldo" | "storico" | "impostazioni";
type HistoryFilter = "tutti" | "sent" | "received" | "pending" | "claimed" | "refunded";

const HISTORY_FILTERS: { key: HistoryFilter; label: string }[] = [
  { key: "tutti",    label: "Tutti"     },
  { key: "sent",     label: "Inviati"   },
  { key: "received", label: "Ricevuti"  },
  { key: "pending",  label: "Pending"   },
  { key: "claimed",  label: "Riscossi"  },
  { key: "refunded", label: "Rimborsati"},
];

interface Props {
  onBack: () => void;
}

export default function WalletCenterPage({ onBack }: Props) {
  const [tab, setTab] = useState<Tab>("saldo");

  // -- Wallet state
  const [wallet,       setWallet]       = useState<WalletInfo | null>(null);
  const [walletLoading, setWalletLoading] = useState(true);
  const [backendInfo,  setBackendInfo]  = useState<UsdaBackendInfo | null>(null);
  const [capabilities, setCapabilities] = useState<UsdaCapabilities | null>(null);

  // -- History state
  const [histFilter,   setHistFilter]   = useState<HistoryFilter>("tutti");
  const [payments,     setPayments]     = useState<UsdaPaymentData[]>([]);
  const [histTotal,    setHistTotal]    = useState(0);
  const [histLoading,  setHistLoading]  = useState(false);
  const [histError,    setHistError]    = useState<string | null>(null);

  // -- Detail / Setup
  const [detailId,      setDetailId]     = useState<string | null>(null);
  const [setupChain,    setSetupChain]   = useState<WalletChain | null>(null);

  // Load wallet + info + capabilities on mount (tutto dal backend — nessun valore hardcoded)
  useEffect(() => {
    Promise.all([
      apiUsdaGetWallet().then(setWallet).catch(() => {}),
      apiUsdaGetInfo().then(setBackendInfo).catch(() => {}),
      apiUsdaGetCapabilities().then(setCapabilities).catch(() => {}),
    ]).finally(() => setWalletLoading(false));
  }, []);

  // Load history when tab or filter changes
  useEffect(() => {
    if (tab !== "storico") return;
    setHistLoading(true);
    setHistError(null);
    apiUsdaGetHistory({
      type:  histFilter === "tutti" ? undefined : histFilter,
      limit: 30,
    })
      .then((r) => { setPayments(r.payments); setHistTotal(r.total); })
      .catch((err: Error) => setHistError(err.message))
      .finally(() => setHistLoading(false));
  }, [tab, histFilter]);

  // Saldo disponibile
  const balance = wallet?.balance_usda ?? "—";

  return (
    <div className="wc-root">
      {/* Header */}
      <header className="wc-header">
        <button className="wc-back" onClick={onBack} aria-label="Indietro">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="20" height="20">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
        </button>
        <div className="wc-header-title">
          <span className="wc-header-icon">💰</span>
          <span>Wallet Center</span>
        </div>
        {backendInfo && (
          <span className="wc-version">{backendInfo.network} · v{backendInfo.version}</span>
        )}
      </header>

      {/* Tab Bar */}
      <div className="wc-tabs">
        {(["saldo", "storico", "impostazioni"] as Tab[]).map((t) => (
          <button
            key={t}
            className={`wc-tab ${tab === t ? "active" : ""}`}
            onClick={() => setTab(t)}
          >
            {{ saldo: "💳", storico: "📋", impostazioni: "⚙️" }[t]}{" "}
            {{ saldo: "Saldo", storico: "Storico", impostazioni: "Impostazioni" }[t]}
          </button>
        ))}
      </div>

      {/* ── Tab: Saldo ───────────────────────────────────────────────────── */}
      {tab === "saldo" && (
        <div className="wc-content">
          {walletLoading ? (
            <div className="wc-loading">Caricamento…</div>
          ) : (
            <>
              {/* Balance Card */}
              <div className="wc-balance-card">
                <div className="wc-balance-label">Saldo disponibile</div>
                <div className="wc-balance-amount">{balance} <span className="wc-balance-currency">USDA</span></div>
                {wallet?.wallet_enabled === false && (
                  <div className="wc-balance-hint">Configura un wallet per iniziare</div>
                )}
              </div>

              {/* Quick Stats */}
              <div className="wc-stats-grid">
                <div className="wc-stat">
                  <div className="wc-stat-icon">📤</div>
                  <div className="wc-stat-label">Inviati</div>
                </div>
                <div className="wc-stat">
                  <div className="wc-stat-icon">📥</div>
                  <div className="wc-stat-label">Ricevuti</div>
                </div>
                <div className="wc-stat">
                  <div className="wc-stat-icon">⏳</div>
                  <div className="wc-stat-label">Pending</div>
                </div>
              </div>

              {/* Wallet Addresses */}
              <div className="wc-section-title">Wallet collegati</div>
              <div className="wc-wallets-list">
                {(Object.keys(WALLET_CHAIN_LABELS) as WalletChain[]).map((chain) => {
                  const meta  = WALLET_CHAIN_LABELS[chain];
                  const entry = wallet?.wallets?.[chain];
                  return (
                    <button
                      key={chain}
                      className="wc-wallet-row"
                      onClick={() => setSetupChain(chain)}
                    >
                      <div className="wc-wallet-chain-icon">{meta.icon}</div>
                      <div className="wc-wallet-info">
                        <div className="wc-wallet-chain">{meta.label}</div>
                        <div className="wc-wallet-addr">
                          {entry
                            ? `${entry.address.slice(0, 8)}…${entry.address.slice(-6)}`
                            : "Non configurato"
                          }
                        </div>
                      </div>
                      <div className={`wc-wallet-status ${entry ? "ok" : "missing"}`}>
                        {entry ? "✓" : "+"}
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Network info — letta dal backend */}
              {backendInfo && (
                <>
                  <div className="wc-section-title">Rete</div>
                  <div className="wc-backend-info">
                    <div className="wc-backend-row"><span>Network</span><span className="wc-backend-val">{backendInfo.network}</span></div>
                    <div className="wc-backend-row"><span>Chain ID</span><span className="wc-backend-val">{backendInfo.chainId}</span></div>
                    <div className="wc-backend-row"><span>Ambiente</span><span className={`wc-backend-val ${backendInfo.environment === "production" ? "ok" : ""}`}>{backendInfo.environment}</span></div>
                    <div className="wc-backend-row">
                      <span>Explorer</span>
                      <a href={backendInfo.explorer} target="_blank" rel="noopener noreferrer" className="wc-backend-link">
                        {backendInfo.explorer.replace("https://", "")}
                      </a>
                    </div>
                  </div>
                </>
              )}

              {/* Capabilities */}
              {capabilities && (
                <>
                  <div className="wc-section-title">Funzionalità backend</div>
                  <div className="wc-caps-grid">
                    {(Object.entries(capabilities.supports) as [string, boolean][]).map(([k, v]) => (
                      <div key={k} className={`wc-cap ${v ? "ok" : "off"}`}>
                        <span>{v ? "✓" : "✗"}</span>
                        <span>{k}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </>
          )}
        </div>
      )}

      {/* ── Tab: Storico ─────────────────────────────────────────────────── */}
      {tab === "storico" && (
        <div className="wc-content wc-content--history">
          {/* Filter chips */}
          <div className="wc-hist-filters">
            {HISTORY_FILTERS.map((f) => (
              <button
                key={f.key}
                className={`usda-filter-btn ${histFilter === f.key ? "active" : ""}`}
                onClick={() => setHistFilter(f.key)}
              >
                {f.label}
              </button>
            ))}
          </div>

          {histLoading && <div className="wc-loading">Caricamento…</div>}
          {histError   && <div className="usda-error" style={{ margin: "12px 16px" }}>{histError}</div>}
          {!histLoading && !histError && payments.length === 0 && (
            <div className="wc-empty">Nessuna transazione</div>
          )}

          <div className="wc-hist-list">
            {payments.map((p) => (
              <button
                key={p.payment_id}
                className="usda-history-item"
                onClick={() => setDetailId(p.payment_id)}
              >
                <div className="usda-history-icon">{p.kind === "request" ? "💸" : "💰"}</div>
                <div className="usda-history-info">
                  <div className="usda-history-amount">{p.amount} USDA</div>
                  <div className="usda-history-name">
                    {p.sender_name ?? p.sender_id.slice(0, 8)} → {p.recipient_name ?? p.recipient_id.slice(0, 8)}
                  </div>
                  {p.note && <div className="usda-history-note">"{p.note}"</div>}
                </div>
                <div className="usda-history-status">
                  <span>{USDA_STATUS_ICONS[p.status]}</span>
                  <span className="usda-history-status-label">{USDA_STATUS_LABELS[p.status]}</span>
                </div>
              </button>
            ))}
          </div>

          {histTotal > payments.length && (
            <div className="usda-history-more">{histTotal - payments.length} altre transazioni</div>
          )}
        </div>
      )}

      {/* ── Tab: Impostazioni ────────────────────────────────────────────── */}
      {tab === "impostazioni" && (
        <div className="wc-content">
          <div className="wc-section-title">Indirizzi wallet</div>
          <div className="wc-wallets-list">
            {(Object.keys(WALLET_CHAIN_LABELS) as WalletChain[]).map((chain) => {
              const meta  = WALLET_CHAIN_LABELS[chain];
              const entry = wallet?.wallets?.[chain];
              return (
                <div key={chain} className="wc-settings-row">
                  <div className="wc-settings-chain">
                    <span className="wc-settings-icon">{meta.icon}</span>
                    <div>
                      <div className="wc-settings-name">{meta.label}</div>
                      {entry ? (
                        <>
                          <div className="wc-settings-addr">{entry.address}</div>
                          {entry.verifiedAt && (
                            <div className="wc-settings-verified">
                              ✓ Verificato {new Date(entry.verifiedAt).toLocaleDateString("it-IT")}
                            </div>
                          )}
                        </>
                      ) : (
                        <div className="wc-settings-missing">Non configurato</div>
                      )}
                    </div>
                  </div>
                  <button
                    className="wc-settings-edit"
                    onClick={() => setSetupChain(chain)}
                  >
                    {entry ? "Modifica" : "Aggiungi"}
                  </button>
                </div>
              );
            })}
          </div>

          {(backendInfo || capabilities) && (
            <>
              <div className="wc-section-title" style={{ marginTop: 24 }}>Backend USDA</div>
              <div className="wc-backend-info">
                {backendInfo && (
                  <>
                    <div className="wc-backend-row"><span>Nome</span><span className="wc-backend-val">{backendInfo.name}</span></div>
                    <div className="wc-backend-row"><span>Versione</span><span className="wc-backend-val">{backendInfo.version}</span></div>
                    <div className="wc-backend-row"><span>API</span><span className="wc-backend-val">{backendInfo.apiVersion}</span></div>
                    <div className="wc-backend-row"><span>Ambiente</span><span className={`wc-backend-val ${backendInfo.environment === "production" ? "ok" : ""}`}>{backendInfo.environment}</span></div>
                    <div className="wc-backend-row"><span>Network</span><span className="wc-backend-val">{backendInfo.network}</span></div>
                    <div className="wc-backend-row"><span>Chain ID</span><span className="wc-backend-val">{backendInfo.chainId}</span></div>
                    <div className="wc-backend-row">
                      <span>Explorer</span>
                      <a href={backendInfo.explorer} target="_blank" rel="noopener noreferrer" className="wc-backend-link">
                        {backendInfo.explorer.replace("https://", "")}
                      </a>
                    </div>
                  </>
                )}
                {capabilities && (Object.entries(capabilities.supports) as [string, boolean][]).map(([k, v]) => (
                  <div key={k} className="wc-backend-row">
                    <span>{k}</span>
                    <span className={`wc-backend-val ${v ? "ok" : "off"}`}>{v ? "✓" : "✗"}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* Modals */}
      {setupChain && (
        <WalletSetupSheet
          initialChain={setupChain}
          onClose={() => setSetupChain(null)}
          onSetup={(w) => { setWallet(w); setSetupChain(null); }}
        />
      )}
      {detailId && (
        <UsdaPaymentDetail
          paymentId={detailId}
          onClose={() => setDetailId(null)}
        />
      )}
    </div>
  );
}
