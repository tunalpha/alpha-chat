/**
 * Alpha Wallet Page — Wallet nativo self-custodial
 *
 * Flussi:
 *   1. Nessun wallet → Onboarding (crea / importa)
 *   2. Wallet bloccato → PIN unlock
 *   3. Wallet sbloccato → Overview / Notifications / Token import / Security
 *
 * ISOLAMENTO ASSOLUTO: non importa nulla dal Payment Engine, USDA, ThirdWeb.
 * SICUREZZA: seed/privateKey non escono mai da questo modulo.
 */

import { useState, useCallback, useRef, useEffect } from "react";
import { WalletProvider, useWallet } from "../wallet/context/WalletContext";
import { createMnemonic, isValidMnemonic } from "../wallet/core/mnemonic";
import { validatePin, pinValidationError } from "../wallet/core/wallet-auth";
import { requestNotificationPermission } from "../wallet/notifications/wallet-notification-store";
import { buildCustomTokenPreview, getVerifiedTokens } from "../wallet/evm/token-registry";
import { apiWalletGetTokenInfo } from "../lib/alpha-wallet-api";
import { getNetworkByChainId, txExplorerUrl } from "../wallet/evm/evm-network-config";
import {
  notificationIcon,
  chainName,
} from "../wallet/notifications/wallet-notification-types";
import { markAllNotificationsRead } from "../wallet/notifications/wallet-notification-store";
import "./AlphaWalletPage.css";

// ─── Sub-view types ─────────────────────────────────────────────────────────

type WalletSubView =
  | "welcome"
  | "create-phrase"
  | "create-verify"
  | "import-phrase"
  | "setup-pin"
  | "confirm-pin"
  | "backup-confirm"
  | "unlock"
  | "overview"
  | "notifications"
  | "add-token"
  | "security";

const ONBOARDING_VIEWS: WalletSubView[] = [
  "create-phrase", "create-verify", "import-phrase",
  "setup-pin", "confirm-pin", "backup-confirm",
];

interface Props {
  onBack: () => void;
}

// ─── Root component (provides WalletContext) ─────────────────────────────────

export default function AlphaWalletPage({ onBack }: Props) {
  return (
    <WalletProvider>
      <AlphaWalletInner onBack={onBack} />
    </WalletProvider>
  );
}

// ─── Inner (reads WalletContext) ─────────────────────────────────────────────

function AlphaWalletInner({ onBack }: Props) {
  const wallet = useWallet();
  const [subView, setSubView] = useState<WalletSubView>("welcome");
  const subViewRef = useRef<WalletSubView>("welcome");
  const [pendingMnemonic, setPendingMnemonic] = useState<string>("");
  const [pendingPin, setPendingPin] = useState<string>("");
  const [flowType, setFlowType] = useState<"create" | "import">("create");

  // Keep ref in sync for use inside useEffect without adding to deps
  subViewRef.current = subView;

  // Sync subView with wallet phase — but never interrupt onboarding flow
  useEffect(() => {
    if (wallet.phase === "initializing") return;
    const inOnboarding = ONBOARDING_VIEWS.includes(subViewRef.current);
    if (inOnboarding) return; // user is in create/import flow, don't override
    if (wallet.phase === "no-wallet") setSubView("welcome");
    else if (wallet.phase === "locked") setSubView("unlock");
    else if (wallet.phase === "unlocked") setSubView("overview");
  }, [wallet.phase]);

  if (wallet.phase === "initializing") {
    return (
      <div className="aw-root">
        <div className="aw-spinner" role="status" aria-label="Caricamento wallet" />
      </div>
    );
  }

  const handleCreate = () => {
    setFlowType("create");
    setSubView("create-phrase");
  };
  const handleImport = () => {
    setFlowType("import");
    setSubView("import-phrase");
  };

  const renderContent = () => {
    switch (subView) {
      case "welcome":
        return <WelcomeView onCreate={handleCreate} onImport={handleImport} />;

      case "create-phrase":
        return (
          <CreatePhraseView
            onNext={(mnemonic) => { setPendingMnemonic(mnemonic); setSubView("create-verify"); }}
            onBack={() => setSubView("welcome")}
          />
        );

      case "create-verify":
        return (
          <VerifyPhraseView
            mnemonic={pendingMnemonic}
            onNext={() => setSubView("setup-pin")}
            onBack={() => setSubView("create-phrase")}
          />
        );

      case "import-phrase":
        return (
          <ImportPhraseView
            onNext={(mnemonic) => { setPendingMnemonic(mnemonic); setSubView("setup-pin"); }}
            onBack={() => setSubView("welcome")}
          />
        );

      case "setup-pin":
        return (
          <SetupPinView
            onNext={(pin) => { setPendingPin(pin); setSubView("confirm-pin"); }}
            onBack={() => setSubView(flowType === "create" ? "create-verify" : "import-phrase")}
          />
        );

      case "confirm-pin":
        return (
          <ConfirmPinView
            expectedPin={pendingPin}
            mnemonic={pendingMnemonic}
            flowType={flowType}
            onNext={() => {
              if (flowType === "create") {
                setSubView("backup-confirm");
              } else {
                // importWallet already called inside ConfirmPinView → phase = unlocked
                setPendingMnemonic("");
                setPendingPin("");
                setSubView("overview");
              }
            }}
            onBack={() => setSubView("setup-pin")}
          />
        );

      case "backup-confirm":
        return (
          <BackupConfirmView
            mnemonic={pendingMnemonic}
            pin={pendingPin}
            onConfirm={async () => {
              // importWallet called inside BackupConfirmView after checkbox confirmed
              setPendingMnemonic("");
              setPendingPin("");
              setSubView("overview");
            }}
          />
        );

      case "unlock":
        return <UnlockView />;

      case "overview":
        return <OverviewView onNavigate={setSubView} />;

      case "notifications":
        return <NotificationsView onBack={() => setSubView("overview")} />;

      case "add-token":
        return <AddTokenView onBack={() => setSubView("overview")} />;

      case "security":
        return <SecurityView onBack={() => setSubView("overview")} onForget={onBack} />;

      default:
        return null;
    }
  };

  const isOnboarding = ONBOARDING_VIEWS.includes(subView) || subView === "welcome";

  return (
    <div className="aw-root">
      <header className="aw-header">
        {isOnboarding ? (
          <>
            <button className="aw-back-btn" onClick={onBack} aria-label="Chiudi">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="20" height="20">
                <line x1="18" y1="6" x2="6" y2="18"/>
                <line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
            <span className="aw-header-title">Alpha Wallet</span>
            <div />
          </>
        ) : (
          <>
            <button className="aw-back-btn"
              onClick={() => subView === "overview" ? onBack() : setSubView("overview")}
              aria-label="Indietro"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="20" height="20">
                <polyline points="15 18 9 12 15 6"/>
              </svg>
            </button>
            <span className="aw-header-title">
              {subView === "overview" && "Alpha Wallet"}
              {subView === "notifications" && "Notifiche"}
              {subView === "add-token" && "Aggiungi Token"}
              {subView === "security" && "Sicurezza"}
              {subView === "unlock" && "Alpha Wallet"}
            </span>
            {subView === "overview" ? (
              <div className="aw-header-actions">
                <button className="aw-icon-btn" onClick={() => setSubView("notifications")}
                  aria-label="Notifiche" style={{ position: "relative" }}>
                  🔔
                  {wallet.unreadCount > 0 && (
                    <span className="aw-badge">{wallet.unreadCount}</span>
                  )}
                </button>
                <button className="aw-icon-btn" onClick={() => setSubView("security")}
                  aria-label="Sicurezza">
                  🔒
                </button>
              </div>
            ) : <div />}
          </>
        )}
      </header>

      <main className="aw-content">
        {renderContent()}
      </main>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// SUB-VIEWS
// ═══════════════════════════════════════════════════════════════════════════

// ─── Welcome ────────────────────────────────────────────────────────────────

function WelcomeView({ onCreate, onImport }: { onCreate: () => void; onImport: () => void }) {
  return (
    <div className="aw-welcome">
      <div className="aw-welcome-icon">🔐</div>
      <h1 className="aw-welcome-title">Alpha Wallet</h1>
      <p className="aw-welcome-sub">
        Wallet self-custodial nativo. Le tue chiavi restano solo sul tuo dispositivo.
      </p>
      <div className="aw-warning-box">
        <span>⚠️</span>
        <span>
          Alpha Chat non può recuperare il tuo wallet se perdi la recovery phrase.
          Esegui sempre il backup prima di depositare fondi.
        </span>
      </div>
      <button className="aw-btn aw-btn--primary" onClick={onCreate}>
        🆕 Crea nuovo wallet
      </button>
      <button className="aw-btn aw-btn--secondary" onClick={onImport}>
        📥 Importa wallet esistente
      </button>
    </div>
  );
}

// ─── Create Phrase ──────────────────────────────────────────────────────────

function CreatePhraseView({ onNext, onBack }: { onNext: (m: string) => void; onBack: () => void }) {
  const [mnemonic] = useState(() => createMnemonic(128));
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const words = mnemonic.split(" ");

  const handleCopy = () => {
    void navigator.clipboard.writeText(mnemonic).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="aw-create-phrase">
      <h2>La tua Recovery Phrase</h2>
      <p className="aw-sub">Scrivi queste 12 parole su carta. Non fare screenshot.</p>

      <div className={`aw-phrase-grid ${!revealed ? "aw-blurred" : ""}`}>
        {words.map((w, i) => (
          <div key={i} className="aw-phrase-word">
            <span className="aw-word-num">{i + 1}</span>
            <span className="aw-word-text">{w}</span>
          </div>
        ))}
      </div>

      {!revealed ? (
        <button className="aw-btn aw-btn--secondary" onClick={() => setRevealed(true)}>
          👁 Mostra recovery phrase
        </button>
      ) : (
        <button className="aw-btn aw-btn--ghost" onClick={handleCopy}>
          {copied ? "✅ Copiato" : "📋 Copia negli appunti"}
        </button>
      )}

      <div className="aw-btn-row">
        <button className="aw-btn aw-btn--secondary" onClick={onBack}>Indietro</button>
        <button className="aw-btn aw-btn--primary" onClick={() => onNext(mnemonic)} disabled={!revealed}>
          Ho scritto le parole →
        </button>
      </div>
    </div>
  );
}

// ─── Verify Phrase ──────────────────────────────────────────────────────────

function VerifyPhraseView({ mnemonic, onNext, onBack }: {
  mnemonic: string; onNext: () => void; onBack: () => void;
}) {
  const words = mnemonic.split(" ");
  const [indices] = useState(() => {
    const pool = [...Array(12).keys()];
    return pool.sort(() => Math.random() - 0.5).slice(0, 3).sort((a, b) => a - b);
  });
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | null>(null);

  const verify = () => {
    const allCorrect = indices.every(i => answers[i]?.trim().toLowerCase() === words[i]);
    if (!allCorrect) { setError("Una o più parole non corrispondono. Riprova."); return; }
    onNext();
  };

  return (
    <div className="aw-verify">
      <h2>Verifica la Recovery Phrase</h2>
      <p className="aw-sub">Inserisci le parole richieste dalla tua recovery phrase.</p>
      {indices.map(idx => (
        <div key={idx} className="aw-verify-field">
          <label>Parola #{idx + 1}</label>
          <input
            type="text"
            className="aw-input"
            value={answers[idx] ?? ""}
            onChange={e => { setAnswers(prev => ({ ...prev, [idx]: e.target.value })); setError(null); }}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            placeholder={`Parola ${idx + 1}…`}
          />
        </div>
      ))}
      {error && <div className="aw-error">{error}</div>}
      <div className="aw-btn-row">
        <button className="aw-btn aw-btn--secondary" onClick={onBack}>Indietro</button>
        <button className="aw-btn aw-btn--primary" onClick={verify}>Conferma →</button>
      </div>
    </div>
  );
}

// ─── Import Phrase ──────────────────────────────────────────────────────────

function ImportPhraseView({ onNext, onBack }: { onNext: (m: string) => void; onBack: () => void }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  const validate = () => {
    const norm = value.trim().toLowerCase().replace(/\s+/g, " ");
    if (!isValidMnemonic(norm)) { setError("Seed phrase non valida. Verifica le parole e riprova."); return; }
    onNext(norm);
  };

  const wordCount = value.trim().split(/\s+/).filter(Boolean).length;

  return (
    <div className="aw-import">
      <h2>Importa Recovery Phrase</h2>
      <p className="aw-sub">Inserisci le tue 12 (o 24) parole separate da spazio.</p>
      <textarea
        className="aw-textarea"
        rows={5}
        value={value}
        onChange={e => { setValue(e.target.value); setError(null); }}
        placeholder="parola1 parola2 parola3 …"
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
      />
      <div className="aw-word-count">{wordCount} parole</div>
      {error && <div className="aw-error">{error}</div>}
      <div className="aw-btn-row">
        <button className="aw-btn aw-btn--secondary" onClick={onBack}>Indietro</button>
        <button className="aw-btn aw-btn--primary" onClick={validate}>Importa →</button>
      </div>
    </div>
  );
}

// ─── Setup PIN ──────────────────────────────────────────────────────────────

function SetupPinView({ onNext, onBack }: { onNext: (pin: string) => void; onBack: () => void }) {
  const [pin, setPin] = useState("");
  const err = pinValidationError(pin);

  return (
    <div className="aw-pin-setup">
      <h2>Crea il tuo PIN</h2>
      <p className="aw-sub">Il PIN sblocca il wallet. Usa almeno 6 cifre.</p>
      <input
        type="password"
        inputMode="numeric"
        className="aw-input aw-input--pin"
        value={pin}
        onChange={e => setPin(e.target.value.replace(/\D/g, ""))}
        maxLength={12}
        placeholder="••••••"
        autoFocus
      />
      {pin.length > 0 && err && <div className="aw-error">{err}</div>}
      <div className="aw-btn-row">
        <button className="aw-btn aw-btn--secondary" onClick={onBack}>Indietro</button>
        <button className="aw-btn aw-btn--primary" onClick={() => !err && onNext(pin)} disabled={!!err || pin.length === 0}>
          Avanti →
        </button>
      </div>
    </div>
  );
}

// ─── Confirm PIN ────────────────────────────────────────────────────────────
// Create flow: solo valida PIN match → procede a backup-confirm (importWallet in BackupConfirmView)
// Import flow: chiama importWallet qui → fase unlocked → procede a overview

function ConfirmPinView({ expectedPin, mnemonic, flowType, onNext, onBack }: {
  expectedPin: string;
  mnemonic: string;
  flowType: "create" | "import";
  onNext: () => void;
  onBack: () => void;
}) {
  const wallet = useWallet();
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const confirm = useCallback(async () => {
    if (pin !== expectedPin) { setError("I PIN non corrispondono. Riprova."); return; }

    if (flowType === "import") {
      // Import: crea wallet ora → fase diventa "unlocked"
      setLoading(true);
      try {
        await wallet.importWallet(mnemonic, pin);
        onNext();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Errore durante la creazione del wallet");
      } finally {
        setLoading(false);
      }
    } else {
      // Create: il wallet viene creato in BackupConfirmView dopo che l'utente
      // conferma di aver scritto la recovery phrase
      onNext();
    }
  }, [pin, expectedPin, flowType, mnemonic, wallet, onNext]);

  return (
    <div className="aw-pin-setup">
      <h2>Conferma il PIN</h2>
      <p className="aw-sub">Reinserisci il PIN per confermare.</p>
      <input
        type="password"
        inputMode="numeric"
        className="aw-input aw-input--pin"
        value={pin}
        onChange={e => { setPin(e.target.value.replace(/\D/g, "")); setError(null); }}
        onKeyDown={e => e.key === "Enter" && void confirm()}
        maxLength={12}
        placeholder="••••••"
        autoFocus
      />
      {error && <div className="aw-error">{error}</div>}
      <div className="aw-btn-row">
        <button className="aw-btn aw-btn--secondary" onClick={onBack} disabled={loading}>Indietro</button>
        <button className="aw-btn aw-btn--primary" onClick={confirm} disabled={loading || pin.length < 6}>
          {loading ? "Creazione…" : "Conferma →"}
        </button>
      </div>
    </div>
  );
}

// ─── Backup Confirm ─────────────────────────────────────────────────────────
// Riceve sia mnemonic che pin. Chiama importWallet solo dopo conferma checkbox.
// Questo garantisce che il wallet sia salvato CON backupVerified=true
// (il flusso import lo fa subito; il flusso create lo fa DOPO il backup).

function BackupConfirmView({ mnemonic, pin, onConfirm }: {
  mnemonic: string;
  pin: string;
  onConfirm: () => Promise<void>;
}) {
  const wallet = useWallet();
  const [checked, setChecked] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConfirm = async () => {
    if (!checked) return;
    setLoading(true);
    try {
      // importWallet salva keystore con backupVerified=true e setta phase=unlocked
      await wallet.importWallet(mnemonic, pin);
      await onConfirm();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Errore durante il salvataggio del wallet");
      setLoading(false);
    }
  };

  return (
    <div className="aw-backup">
      <div className="aw-backup-icon">📝</div>
      <h2>Backup obbligatorio</h2>
      <p>
        Hai annotato le 12 parole in un posto sicuro?<br />
        <strong>Alpha Chat non può recuperare il tuo wallet se perdi la recovery phrase.</strong>
      </p>

      <div className="aw-phrase-review">
        {mnemonic.split(" ").map((w, i) => (
          <span key={i} className="aw-phrase-tag">{i + 1}. {w}</span>
        ))}
      </div>

      <label className="aw-checkbox-label">
        <input type="checkbox" checked={checked} onChange={e => setChecked(e.target.checked)} />
        Ho annotato le 12 parole su carta e le ho messe in un posto sicuro.
      </label>

      {error && <div className="aw-error">{error}</div>}

      <button
        className="aw-btn aw-btn--primary"
        disabled={!checked || loading}
        onClick={handleConfirm}
      >
        {loading ? "Salvataggio…" : "Continua al Wallet →"}
      </button>
    </div>
  );
}

// ─── Unlock ─────────────────────────────────────────────────────────────────

function UnlockView() {
  const wallet = useWallet();
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const unlock = async () => {
    if (!validatePin(pin)) { setError("PIN non valido"); return; }
    setLoading(true);
    try {
      await wallet.unlockWallet(pin);
    } catch {
      setError("PIN errato. Riprova.");
      setPin("");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="aw-unlock">
      <div className="aw-unlock-icon">🔐</div>
      <h2>Alpha Wallet</h2>
      <p className="aw-sub">Inserisci il PIN per sbloccare il wallet.</p>
      <input
        type="password"
        inputMode="numeric"
        className="aw-input aw-input--pin"
        value={pin}
        onChange={e => { setPin(e.target.value.replace(/\D/g, "")); setError(null); }}
        onKeyDown={e => e.key === "Enter" && void unlock()}
        maxLength={12}
        placeholder="••••••"
        autoFocus
      />
      {error && <div className="aw-error">{error}</div>}
      <button className="aw-btn aw-btn--primary" onClick={unlock} disabled={loading || pin.length < 6}>
        {loading ? "Sblocco…" : "Sblocca →"}
      </button>
    </div>
  );
}

// ─── Overview ───────────────────────────────────────────────────────────────

function OverviewView({ onNavigate }: { onNavigate: (v: WalletSubView) => void }) {
  const wallet = useWallet();
  const meta = wallet.meta;
  const net = getNetworkByChainId(wallet.selectedChainId);
  const [copied, setCopied] = useState<"evm" | "btc" | null>(null);
  const [notifPermission, setNotifPermission] = useState<NotificationPermission>("default");

  useEffect(() => {
    if (typeof Notification !== "undefined") setNotifPermission(Notification.permission);
  }, []);

  const copy = (text: string, type: "evm" | "btc") => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(type);
      setTimeout(() => setCopied(null), 2000);
    });
  };

  const requestPush = async () => {
    const perm = await requestNotificationPermission();
    setNotifPermission(perm);
  };

  if (!meta) return null;

  const isBtc = wallet.selectedChainId === 0;

  return (
    <div className="aw-overview">
      {/* Network selector */}
      <div className="aw-network-bar">
        <div className="aw-network-badge" style={{ borderColor: net?.color ?? "#888" }}>
          <span style={{ color: net?.color }}>●</span>
          {isBtc ? "Bitcoin" : (net?.name ?? `Chain ${wallet.selectedChainId}`)}
        </div>
        <select
          className="aw-network-select"
          value={wallet.selectedChainId}
          onChange={e => wallet.setSelectedChainId(Number(e.target.value))}
          aria-label="Seleziona rete"
        >
          <option value={137}>Polygon</option>
          <option value={1}>Ethereum</option>
          <option value={56}>BNB Smart Chain</option>
          <option value={0}>Bitcoin</option>
        </select>
      </div>

      {/* Balance placeholder — Phase C */}
      <div className="aw-balance-card">
        <div className="aw-balance-label">Saldo totale</div>
        <div className="aw-balance-coming">Disponibile in Phase C</div>
      </div>

      {/* Actions */}
      <div className="aw-actions">
        <button className="aw-action-btn" disabled title="Disponibile in Phase C">
          📤<br /><small>Invia</small>
        </button>
        <button className="aw-action-btn" disabled title="Mostra indirizzo">
          📥<br /><small>Ricevi</small>
        </button>
        <button className="aw-action-btn" onClick={() => onNavigate("add-token")}>
          ➕<br /><small>Token</small>
        </button>
        <button className="aw-action-btn" onClick={() => onNavigate("notifications")} style={{ position: "relative" }}>
          🔔<br /><small>Notifiche</small>
          {wallet.unreadCount > 0 && <span className="aw-badge-sm">{wallet.unreadCount}</span>}
        </button>
      </div>

      {/* Address */}
      {!isBtc ? (
        <div className="aw-address-card">
          <div className="aw-address-label">Il tuo indirizzo {net?.shortName ?? "EVM"}</div>
          <div className="aw-address-value">{meta.evmAddress}</div>
          <button className="aw-copy-btn" onClick={() => copy(meta.evmAddress, "evm")}>
            {copied === "evm" ? "✅ Copiato" : "📋 Copia"}
          </button>
        </div>
      ) : (
        <div className="aw-address-card">
          <div className="aw-address-label">Il tuo indirizzo Bitcoin</div>
          <div className="aw-address-value">{meta.btcAddress}</div>
          <button className="aw-copy-btn" onClick={() => copy(meta.btcAddress, "btc")}>
            {copied === "btc" ? "✅ Copiato" : "📋 Copia"}
          </button>
        </div>
      )}

      {/* Asset list */}
      <div className="aw-section-title">Asset</div>
      <AssetList chainId={wallet.selectedChainId} />

      {/* Push notification prompt */}
      {notifPermission === "default" && (
        <div className="aw-push-prompt">
          <span>🔔 Ricevi notifiche per le transazioni in entrata</span>
          <button className="aw-btn-sm" onClick={requestPush}>Attiva</button>
        </div>
      )}

      {/* Backup warning */}
      {!meta.backupVerified && (
        <div className="aw-backup-warning">
          <span>⚠️</span>
          <div>
            <strong>Backup non completato</strong>
            <p>Esegui il backup della recovery phrase prima di depositare fondi.</p>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Asset List ─────────────────────────────────────────────────────────────

function AssetList({ chainId }: { chainId: number }) {
  const wallet = useWallet();
  const isBtc = chainId === 0;
  const evmChainId = isBtc ? 137 : chainId;
  const verifiedTokens = getVerifiedTokens(evmChainId);
  const allTokens = isBtc ? [] : [...verifiedTokens, ...wallet.customTokens];

  if (isBtc) {
    return (
      <div className="aw-asset-list">
        <div className="aw-asset-item">
          <div className="aw-asset-icon">₿</div>
          <div className="aw-asset-info">
            <div className="aw-asset-name">Bitcoin <span className="aw-badge-verified">✅</span></div>
            <div className="aw-asset-network">Bitcoin · Native SegWit</div>
          </div>
          <div className="aw-asset-balance">— BTC</div>
        </div>
      </div>
    );
  }

  return (
    <div className="aw-asset-list">
      {allTokens.map(t => (
        <div key={`${t.chainId}-${t.contractAddress ?? "native"}`} className="aw-asset-item">
          <div className="aw-asset-icon">{t.standard === "native" ? "⬡" : "🪙"}</div>
          <div className="aw-asset-info">
            <div className="aw-asset-name">
              {t.symbol}
              {t.verification === "verified"
                ? <span className="aw-badge-verified" title="Token verificato">✅</span>
                : <span className="aw-badge-custom" title="Token custom">⚠️</span>
              }
            </div>
            <div className="aw-asset-network">{t.name}</div>
          </div>
          <div className="aw-asset-balance">— {t.symbol}</div>
        </div>
      ))}
    </div>
  );
}

// ─── Notifications ──────────────────────────────────────────────────────────

function NotificationsView({ onBack }: { onBack: () => void }) {
  const wallet = useWallet();

  useEffect(() => {
    void markAllNotificationsRead().then(() => wallet.refreshNotifications());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (wallet.notifications.length === 0) {
    return (
      <div className="aw-empty-state">
        <div className="aw-empty-icon">🔔</div>
        <div className="aw-empty-title">Nessuna notifica</div>
        <p className="aw-empty-sub">Le transazioni rilevate appariranno qui.</p>
        <button className="aw-btn aw-btn--secondary" style={{ maxWidth: 200, margin: "16px auto 0" }} onClick={onBack}>
          ← Torna al wallet
        </button>
      </div>
    );
  }

  return (
    <div className="aw-notifications">
      {wallet.notifications.map(n => (
        <div key={n.id} className={`aw-notif-item ${!n.read ? "aw-notif-item--unread" : ""}`}>
          <div className="aw-notif-icon">{notificationIcon(n.type)}</div>
          <div className="aw-notif-body">
            <div className="aw-notif-title">{n.amount} {n.asset}</div>
            <div className="aw-notif-meta">
              {chainName(n.chainId)} ·{" "}
              {n.status === "confirmed" ? "Confermato" : n.status === "pending" ? "In attesa" : "Fallito"}
            </div>
            {n.txHash && (
              <a
                className="aw-notif-hash"
                href={txExplorerUrl(n.chainId, n.txHash)}
                target="_blank"
                rel="noopener noreferrer"
              >
                {n.txHash.slice(0, 10)}…{n.txHash.slice(-6)}
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                  <polyline points="15 3 21 3 21 9"/>
                  <line x1="10" y1="14" x2="21" y2="3"/>
                </svg>
              </a>
            )}
          </div>
          <div className="aw-notif-time">
            {new Date(n.timestamp).toLocaleDateString("it-IT", { day: "2-digit", month: "short" })}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Add Token ──────────────────────────────────────────────────────────────

function AddTokenView({ onBack }: { onBack: () => void }) {
  const wallet = useWallet();
  const [address, setAddress] = useState("");
  const [chainId, setChainId] = useState(137);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{
    name: string; symbol: string; decimals: number;
    isVerified: boolean; symbolConflict: boolean;
  } | null>(null);

  const fetchInfo = async () => {
    if (!/^0x[0-9a-fA-F]{38,42}$/.test(address)) {
      setError("Indirizzo non valido (deve iniziare con 0x)");
      return;
    }
    setLoading(true);
    setError(null);
    setPreview(null);
    try {
      const info = await apiWalletGetTokenInfo(chainId, address);
      setPreview(info);
    } catch {
      setError("Impossibile recuperare le informazioni del token. Verifica rete e indirizzo.");
    } finally {
      setLoading(false);
    }
  };

  const addToken = async () => {
    if (!preview) return;
    const p = buildCustomTokenPreview(
      chainId, preview.symbol, preview.name, preview.decimals,
      address as `0x${string}`
    );
    await wallet.addCustomToken(p.token);
    onBack();
  };

  const net = getNetworkByChainId(chainId);

  return (
    <div className="aw-add-token">
      <h2>Aggiungi Token</h2>
      <p className="aw-sub">Importa un token ERC-20 tramite il suo contract address.</p>

      <label className="aw-label">Rete</label>
      <select className="aw-select" value={chainId} onChange={e => {
        setChainId(Number(e.target.value));
        setPreview(null);
      }}>
        <option value={137}>Polygon</option>
        <option value={1}>Ethereum</option>
        <option value={56}>BNB Smart Chain</option>
      </select>

      <label className="aw-label">Contract Address</label>
      <input
        type="text"
        className="aw-input"
        value={address}
        onChange={e => { setAddress(e.target.value.trim()); setPreview(null); setError(null); }}
        placeholder="0x..."
        autoComplete="off"
        autoCapitalize="none"
      />

      {error && <div className="aw-error">{error}</div>}

      {!preview && (
        <button className="aw-btn aw-btn--secondary" onClick={fetchInfo} disabled={loading}>
          {loading ? "Ricerca…" : "🔍 Cerca token"}
        </button>
      )}

      {preview && (
        <div className="aw-token-preview">
          <div className="aw-token-preview-header">
            {preview.isVerified
              ? <span className="aw-verified-badge">✅ Verificato</span>
              : preview.symbolConflict
              ? <span className="aw-warning-badge">⚠️ Symbol identico a token ufficiale — rischio phishing</span>
              : <span className="aw-custom-badge">⚠️ Token non verificato</span>
            }
          </div>
          <table className="aw-token-table">
            <tbody>
              <tr><td>Nome</td><td>{preview.name}</td></tr>
              <tr><td>Symbol</td><td>{preview.symbol}</td></tr>
              <tr><td>Network</td><td>{net?.name ?? `Chain ${chainId}`}</td></tr>
              <tr><td>Decimals</td><td>{preview.decimals}</td></tr>
              <tr><td>Contract</td><td><code className="aw-code">{address.slice(0, 10)}…{address.slice(-8)}</code></td></tr>
            </tbody>
          </table>
          {preview.symbolConflict && (
            <div className="aw-phishing-warning">
              ⚠️ Questo token usa lo stesso symbol di un token ufficiale ma ha un contract diverso.
              Potrebbe essere un tentativo di phishing. Aggiungilo solo se sei sicuro della fonte.
            </div>
          )}
          <div className="aw-btn-row">
            <button className="aw-btn aw-btn--secondary" onClick={() => setPreview(null)}>Annulla</button>
            <button className="aw-btn aw-btn--primary" onClick={addToken}>➕ Aggiungi token</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Security ───────────────────────────────────────────────────────────────

function SecurityView({ onBack, onForget }: { onBack: () => void; onForget: () => void }) {
  const wallet = useWallet();
  const [showForgetConfirm, setShowForgetConfirm] = useState(false);
  const [forgetting, setForgetting] = useState(false);

  const forget = async () => {
    setForgetting(true);
    await wallet.forgetWallet();
    onForget();
  };

  return (
    <div className="aw-security">
      <div className="aw-security-section">
        <h3>Stato backup</h3>
        <div className={`aw-backup-status ${wallet.meta?.backupVerified ? "ok" : "warn"}`}>
          {wallet.meta?.backupVerified
            ? "✅ Recovery phrase verificata"
            : "⚠️ Recovery phrase non ancora verificata"}
        </div>
      </div>

      <div className="aw-security-section">
        <h3>Sessione</h3>
        <button className="aw-btn aw-btn--secondary" onClick={wallet.lockWallet}>
          🔒 Blocca wallet
        </button>
      </div>

      <div className="aw-security-section aw-security-section--danger">
        <h3>Zona pericolosa</h3>
        <p>Questa operazione è IRREVERSIBILE. I fondi sono recuperabili solo con la recovery phrase.</p>
        {!showForgetConfirm ? (
          <button className="aw-btn aw-btn--danger" onClick={() => setShowForgetConfirm(true)}>
            🗑️ Elimina wallet da questo dispositivo
          </button>
        ) : (
          <div className="aw-forget-confirm">
            <p><strong>Sei sicuro?</strong> Il wallet verrà eliminato da questo dispositivo. Avrai bisogno della recovery phrase per ripristinarlo.</p>
            <div className="aw-btn-row">
              <button className="aw-btn aw-btn--secondary" onClick={() => setShowForgetConfirm(false)} disabled={forgetting}>
                Annulla
              </button>
              <button className="aw-btn aw-btn--danger" onClick={forget} disabled={forgetting}>
                {forgetting ? "Eliminazione…" : "Elimina definitivamente"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
