/**
 * WalletCenterPage — hub completo per i pagamenti USDA.
 *
 * Tab 1 — Saldo:      balance, wallet per chain, rete, contatti recenti
 * Tab 2 — Storico:    filtri + lista pagamenti
 * Tab 3 — Impostazioni: wallet multi-chain + info backend
 */

import { useState, useEffect, useRef, useCallback } from "react";
import {
  apiUsdaGetWallet,
  apiUsdaGetHistory,
  apiUsdaGetCapabilities,
  apiUsdaGetInfo,
  apiUsdaCheckByClientId,
} from "../lib/usda-api";
import type { WalletInfo, UsdaPaymentData, UsdaBackendInfo, UsdaCapabilities, WalletChain } from "../lib/usda-types";
import { WALLET_CHAIN_LABELS, USDA_STATUS_LABELS, USDA_STATUS_ICONS } from "../lib/usda-types";
import { WalletSetupSheet } from "../components/usda/WalletSetupSheet";
import { UsdaPaymentDetail } from "../components/usda/UsdaPaymentDetail";

type Tab = "saldo" | "storico" | "impostazioni";
type HistoryFilter = "tutti" | "sent" | "received" | "pending" | "claimed" | "refunded";

const HISTORY_FILTERS: { key: HistoryFilter; label: string }[] = [
  { key: "tutti",    label: "Tutti"      },
  { key: "sent",     label: "Inviati"    },
  { key: "received", label: "Ricevuti"   },
  { key: "pending",  label: "Pending"    },
  { key: "claimed",  label: "Riscossi"   },
  { key: "refunded", label: "Rimborsati" },
];

const TAB_META: { id: Tab; icon: string; label: string }[] = [
  { id: "saldo",        icon: "💳", label: "Saldo"        },
  { id: "storico",      icon: "📋", label: "Storico"      },
  { id: "impostazioni", icon: "⚙️", label: "Impostazioni" },
];

interface Props {
  onBack: () => void;
}

export default function WalletCenterPage({ onBack }: Props) {
  const [tab,          setTab]          = useState<Tab>("saldo");
  const [wallet,       setWallet]       = useState<WalletInfo | null>(null);
  const [backendInfo,  setBackendInfo]  = useState<UsdaBackendInfo | null>(null);
  const [capabilities, setCapabilities] = useState<UsdaCapabilities | null>(null);
  const [walletLoading, setWalletLoading] = useState(true);

  const [histFilter,  setHistFilter]  = useState<HistoryFilter>("tutti");
  const [payments,    setPayments]    = useState<UsdaPaymentData[]>([]);
  const [histTotal,   setHistTotal]   = useState(0);
  const [histLoading, setHistLoading] = useState(false);
  const [histError,   setHistError]   = useState<string | null>(null);

  const [recentContacts, setRecentContacts] = useState<{ id: string; name: string; icon: string }[]>([]);

  const [detailId,   setDetailId]   = useState<string | null>(null);
  const [setupChain, setSetupChain] = useState<WalletChain | null>(null);

  const abortMount   = useRef<AbortController | null>(null);
  const abortHistory = useRef<AbortController | null>(null);

  // Banner di recovery per crash tra sessionStorage.setItem e risposta /confirm
  const [recoveryBanner, setRecoveryBanner] = useState<
    "found" | "not_found" | null
  >(null);

  // ── Recovery crash al mount ───────────────────────────────────────────────
  // Se l'app è crashata tra sessionStorage.setItem e la risposta di /confirm,
  // WalletCenter rileva la chiave e verifica se il pagamento è già in DB.
  useEffect(() => {
    const inflightCpi = sessionStorage.getItem("usda_inflight_cpi");
    if (!inflightCpi) return;
    sessionStorage.removeItem("usda_inflight_cpi"); // gestito qui — non deve ripetirsi

    apiUsdaCheckByClientId(inflightCpi).then((payment) => {
      if (payment) {
        // Il pagamento è in DB: il confirm è arrivato al server prima del crash.
        // Il polling server-side sta già aggiornando lo stato.
        setRecoveryBanner("found");
      } else {
        // Il confirm non ha raggiunto il server (o il server ha risposto con errore).
        // Nessun duplicato in DB — l'utente può riprovare normalmente.
        setRecoveryBanner("not_found");
      }
    }).catch(() => {
      sessionStorage.removeItem("usda_inflight_cpi");
    });
  }, []);

  // ── Caricamento dati al mount ─────────────────────────────────────────────
  useEffect(() => {
    abortMount.current = new AbortController();
    Promise.all([
      apiUsdaGetWallet().then(setWallet).catch(() => {}),
      apiUsdaGetInfo().then(setBackendInfo).catch(() => {}),
      apiUsdaGetCapabilities().then(setCapabilities).catch(() => {}),
      // Ultimi 10 pagamenti per "Contatti recenti"
      apiUsdaGetHistory({ limit: 10 }).then((r) => {
        const seen = new Set<string>();
        const contacts: { id: string; name: string; icon: string }[] = [];
        for (const p of r.payments) {
          const id   = p.kind === "send" ? p.recipient_id : p.sender_id;
          const name = (p.kind === "send" ? p.recipient_name : p.sender_name) ?? id.slice(0, 8);
          if (!seen.has(id)) { seen.add(id); contacts.push({ id, name, icon: p.kind === "send" ? "📤" : "📥" }); }
          if (contacts.length >= 5) break;
        }
        setRecentContacts(contacts);
      }).catch(() => {}),
    ]).finally(() => setWalletLoading(false));

    return () => { abortMount.current?.abort(); };
  }, []);

  // ── Caricamento storico ───────────────────────────────────────────────────
  const loadHistory = useCallback(() => {
    abortHistory.current?.abort();
    abortHistory.current = new AbortController();
    setHistLoading(true);
    setHistError(null);
    apiUsdaGetHistory({ type: histFilter === "tutti" ? undefined : histFilter, limit: 30 })
      .then((r) => { setPayments(r.payments); setHistTotal(r.total); })
      .catch((err: Error) => { if (err.name !== "AbortError") setHistError(err.message); })
      .finally(() => setHistLoading(false));
  }, [histFilter]);

  useEffect(() => {
    if (tab !== "storico") return;
    loadHistory();
    return () => { abortHistory.current?.abort(); };
  }, [tab, loadHistory]);

  const balance = wallet?.balance_usda ?? "—";

  return (
    <div className="wc-root">

      {/* ── Recovery banner ─────────────────────────────────────────────── */}
      {recoveryBanner === "found" && (
        <div className="wc-recovery-banner wc-recovery-found" role="alert">
          <span>⚠️</span>
          <span>
            Un pagamento precedente è stato registrato correttamente prima della chiusura dell'app.
            Controlla lo storico per verificarne lo stato.
          </span>
          <button type="button" aria-label="Chiudi avviso" onClick={() => setRecoveryBanner(null)}>✕</button>
        </div>
      )}
      {recoveryBanner === "not_found" && (
        <div className="wc-recovery-banner wc-recovery-not-found" role="status">
          <span>ℹ️</span>
          <span>L'ultimo pagamento non era stato completato. Puoi riprovare normalmente.</span>
          <button type="button" aria-label="Chiudi avviso" onClick={() => setRecoveryBanner(null)}>✕</button>
        </div>
      )}

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header className="wc-header">
        <button
          type="button"
          className="wc-back"
          aria-label="Torna alle impostazioni"
          onClick={onBack}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="20" height="20" aria-hidden="true">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
        </button>
        <div className="wc-header-title">
          <span className="wc-header-icon" aria-hidden="true">💰</span>
          <span>Wallet Center</span>
        </div>
        {backendInfo && (
          <span className="wc-version" aria-label={`Backend: ${backendInfo.network} v${backendInfo.version}`}>
            {backendInfo.network.split(" ").slice(-1)[0]} · v{backendInfo.version}
          </span>
        )}
      </header>

      {/* ── Tab Bar ─────────────────────────────────────────────────────── */}
      <div className="wc-tabs" role="tablist" aria-label="Sezioni Wallet Center">
        {TAB_META.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            aria-controls={`wc-panel-${t.id}`}
            id={`wc-tab-${t.id}`}
            className={`wc-tab ${tab === t.id ? "active" : ""}`}
            onClick={() => setTab(t.id)}
          >
            <span aria-hidden="true">{t.icon}</span> {t.label}
          </button>
        ))}
      </div>

      {/* ── Tab: Saldo ──────────────────────────────────────────────────── */}
      {tab === "saldo" && (
        <div
          id="wc-panel-saldo"
          role="tabpanel"
          aria-labelledby="wc-tab-saldo"
          className="wc-content"
        >
          {walletLoading ? (
            <div className="wc-loading" role="status" aria-label="Caricamento saldo">
              <span className="usda-loading-dots" aria-hidden="true" /> Caricamento…
            </div>
          ) : (
            <>
              {/* Balance */}
              <div className="wc-balance-card" aria-label={`Saldo: ${balance} USDA`}>
                <div className="wc-balance-label">Saldo disponibile</div>
                <div className="wc-balance-amount">
                  {balance} <span className="wc-balance-currency">USDA</span>
                </div>
                {!wallet?.wallet_enabled && (
                  <div className="wc-balance-hint">Configura un wallet per iniziare</div>
                )}
              </div>

              {/* Quick actions (go to storico with filter) */}
              <div className="wc-stats-grid" role="list" aria-label="Accesso rapido">
                {[
                  { icon: "📤", label: "Inviati",   filter: "sent"     as HistoryFilter },
                  { icon: "📥", label: "Ricevuti",  filter: "received" as HistoryFilter },
                  { icon: "⏳", label: "Pending",   filter: "pending"  as HistoryFilter },
                  { icon: "✅", label: "Riscossi",  filter: "claimed"  as HistoryFilter },
                  { icon: "↩️", label: "Rimborsi",  filter: "refunded" as HistoryFilter },
                  { icon: "📋", label: "Tutti",     filter: "tutti"    as HistoryFilter },
                ].map((item) => (
                  <button
                    key={item.filter}
                    type="button"
                    role="listitem"
                    className="wc-stat"
                    aria-label={`Mostra ${item.label}`}
                    onClick={() => { setHistFilter(item.filter); setTab("storico"); }}
                  >
                    <div className="wc-stat-icon" aria-hidden="true">{item.icon}</div>
                    <div className="wc-stat-label">{item.label}</div>
                  </button>
                ))}
              </div>

              {/* Contatti recenti */}
              {recentContacts.length > 0 && (
                <>
                  <div className="wc-section-title">Contatti recenti</div>
                  <div className="wc-recent-contacts" role="list">
                    {recentContacts.map((c) => (
                      <div key={c.id} className="wc-recent-contact" role="listitem">
                        <div className="wc-recent-icon" aria-hidden="true">{c.icon}</div>
                        <div className="wc-recent-name">{c.name}</div>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {/* Wallet collegati */}
              <div className="wc-section-title">Wallet collegati</div>
              <div className="wc-wallets-list" role="list">
                {(Object.keys(WALLET_CHAIN_LABELS) as WalletChain[]).map((chain) => {
                  const meta  = WALLET_CHAIN_LABELS[chain];
                  const entry = wallet?.wallets?.[chain];
                  return (
                    <button
                      key={chain}
                      type="button"
                      role="listitem"
                      className="wc-wallet-row"
                      aria-label={`${meta.label}: ${entry ? entry.address : "Non configurato"}. Tocca per modificare`}
                      onClick={() => setSetupChain(chain)}
                    >
                      <div className="wc-wallet-chain-icon" aria-hidden="true">{meta.icon}</div>
                      <div className="wc-wallet-info">
                        <div className="wc-wallet-chain">{meta.label}</div>
                        <div className="wc-wallet-addr">
                          {entry
                            ? `${entry.address.slice(0, 8)}…${entry.address.slice(-6)}`
                            : "Non configurato"
                          }
                        </div>
                      </div>
                      <div className={`wc-wallet-status ${entry ? "ok" : "missing"}`} aria-hidden="true">
                        {entry ? "✓" : "+"}
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Network info */}
              {backendInfo && (
                <>
                  <div className="wc-section-title">Rete</div>
                  <div className="wc-backend-info">
                    <div className="wc-backend-row"><span>Network</span><span className="wc-backend-val">{backendInfo.network}</span></div>
                    <div className="wc-backend-row"><span>Chain ID</span><span className="wc-backend-val">{backendInfo.chainId}</span></div>
                    <div className="wc-backend-row">
                      <span>Ambiente</span>
                      <span className={`wc-backend-val ${backendInfo.environment === "production" ? "ok" : ""}`}>
                        {backendInfo.environment}
                      </span>
                    </div>
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
                  <div className="wc-section-title">Funzionalità</div>
                  <div className="wc-caps-grid" role="list">
                    {(Object.entries(capabilities.supports) as [string, boolean][]).map(([k, v]) => (
                      <div
                        key={k}
                        role="listitem"
                        className={`wc-cap ${v ? "ok" : "off"}`}
                        aria-label={`${k}: ${v ? "supportato" : "non supportato"}`}
                      >
                        <span aria-hidden="true">{v ? "✓" : "✗"}</span>
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

      {/* ── Tab: Storico ────────────────────────────────────────────────── */}
      {tab === "storico" && (
        <div
          id="wc-panel-storico"
          role="tabpanel"
          aria-labelledby="wc-tab-storico"
          className="wc-content wc-content--history"
        >
          <div className="wc-hist-filters" role="tablist" aria-label="Filtra transazioni">
            {HISTORY_FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                role="tab"
                aria-selected={histFilter === f.key}
                className={`usda-filter-btn ${histFilter === f.key ? "active" : ""}`}
                onClick={() => setHistFilter(f.key)}
              >
                {f.label}
              </button>
            ))}
          </div>

          {histLoading && (
            <div className="wc-loading" role="status" aria-label="Caricamento transazioni">
              <span className="usda-loading-dots" aria-hidden="true" /> Caricamento…
            </div>
          )}
          {histError && (
            <div className="usda-error" style={{ margin: "12px 16px" }} role="alert">{histError}</div>
          )}
          {!histLoading && !histError && payments.length === 0 && (
            <div className="wc-empty">Nessuna transazione</div>
          )}

          <div className="wc-hist-list" role="list">
            {payments.map((p) => (
              <button
                key={p.payment_id}
                type="button"
                role="listitem"
                className="usda-history-item"
                aria-label={`${p.kind === "request" ? "Richiesta" : "Pagamento"} di ${p.amount} USDA — ${USDA_STATUS_LABELS[p.status]}`}
                onClick={() => setDetailId(p.payment_id)}
              >
                <div className="usda-history-icon" aria-hidden="true">{p.kind === "request" ? "💸" : "💰"}</div>
                <div className="usda-history-info">
                  <div className="usda-history-amount">{p.amount} USDA</div>
                  <div className="usda-history-name">
                    {p.sender_name ?? p.sender_id.slice(0, 8)} → {p.recipient_name ?? p.recipient_id.slice(0, 8)}
                  </div>
                  {p.note && <div className="usda-history-note">"{p.note}"</div>}
                </div>
                <div className="usda-history-status" aria-hidden="true">
                  <span>{USDA_STATUS_ICONS[p.status]}</span>
                  <span className="usda-history-status-label">{USDA_STATUS_LABELS[p.status]}</span>
                </div>
              </button>
            ))}
          </div>

          {histTotal > payments.length && (
            <div className="usda-history-more" aria-live="polite">
              {histTotal - payments.length} altre transazioni
            </div>
          )}
        </div>
      )}

      {/* ── Tab: Impostazioni ───────────────────────────────────────────── */}
      {tab === "impostazioni" && (
        <div
          id="wc-panel-impostazioni"
          role="tabpanel"
          aria-labelledby="wc-tab-impostazioni"
          className="wc-content"
        >
          <div className="wc-section-title">Indirizzi wallet</div>
          <div className="wc-wallets-list">
            {(Object.keys(WALLET_CHAIN_LABELS) as WalletChain[]).map((chain) => {
              const meta  = WALLET_CHAIN_LABELS[chain];
              const entry = wallet?.wallets?.[chain];
              return (
                <div key={chain} className="wc-settings-row">
                  <div className="wc-settings-chain">
                    <span className="wc-settings-icon" aria-hidden="true">{meta.icon}</span>
                    <div>
                      <div className="wc-settings-name">{meta.label}</div>
                      {entry ? (
                        <>
                          <div className="wc-settings-addr" aria-label={`Indirizzo: ${entry.address}`}>{entry.address}</div>
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
                    type="button"
                    className="wc-settings-edit"
                    aria-label={`${entry ? "Modifica" : "Aggiungi"} indirizzo ${meta.label}`}
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
                    <div className="wc-backend-row">
                      <span>Ambiente</span>
                      <span className={`wc-backend-val ${backendInfo.environment === "production" ? "ok" : ""}`}>
                        {backendInfo.environment}
                      </span>
                    </div>
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

      {/* ── Modals ──────────────────────────────────────────────────────── */}
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
