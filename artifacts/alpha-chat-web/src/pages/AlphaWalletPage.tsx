/**
 * Alpha Wallet Page — Phase B + C + F
 *
 * Flussi:
 *   1. Nessun wallet → Onboarding (crea / importa)
 *   2. Wallet bloccato → PIN unlock
 *   3. Wallet sbloccato → Overview / Receive / Send / Notifications / Token import / Security / History
 *
 * Phase F additions:
 *   - Storico transazioni (HistoryView) con filtri e dettaglio inline
 *   - Seed export autenticato (SeedExportView) in SecurityView
 *   - Custom token remove button nell'AssetList
 *   - Backup reminder potenziato con CTA navigabile
 *
 * ISOLAMENTO ASSOLUTO: non importa nulla dal Payment Engine, USDA, ThirdWeb.
 * SICUREZZA: seed/privateKey firmano localmente e non escono mai dal dispositivo.
 *   Il backend riceve solo address pubblici e transazioni già firmate.
 */

import { useState, useCallback, useRef, useEffect } from "react";
import { useLock } from "../contexts/LockContext";
import { WalletProvider, useWallet } from "../wallet/context/WalletContext";
import { createMnemonic, isValidMnemonic } from "../wallet/core/mnemonic";
import { validatePin, pinValidationError } from "../wallet/core/wallet-auth";
import { loadKeystore, decryptSeed } from "../wallet/core/keystore";
import { requestNotificationPermission } from "../wallet/notifications/wallet-notification-store";
import { buildCustomTokenPreview, getVerifiedTokens } from "../wallet/evm/token-registry";
import { apiWalletGetTokenInfo } from "../lib/alpha-wallet-api";
import { getNetworkByChainId, txExplorerUrl } from "../wallet/evm/evm-network-config";
import {
  notificationIcon,
  chainName,
} from "../wallet/notifications/wallet-notification-types";
import { markAllNotificationsRead } from "../wallet/notifications/wallet-notification-store";
import type { WalletTxRecord } from "../wallet/services/tx-store";
// Phase C: balance, price, gas, signing
import {
  fetchEvmBalance,
  fetchBtcBalance,
  type ChainBalance,
  type BtcBalance,
} from "../wallet/services/balance-service";
import {
  fetchPrices,
  formatCrypto,
  formatFiat,
  parseAmount,
  type AssetPrices,
} from "../wallet/services/price-service";
import {
  estimateNativeTransferGas,
  estimateErc20TransferGas,
  type GasEstimate,
} from "../wallet/services/gas-service";
import {
  signAndBroadcastNativeEvm,
  signAndBroadcastErc20Evm,
  validateEvmRecipient,
} from "../wallet/services/evm-signer";
import {
  signAndBroadcastBtcTx,
  validateBtcAddress,
  getBtcSendPreview,
  satToBtc,
  type BtcSendPreview,
} from "../wallet/services/btc-signer";
import type { BtcUTXO } from "../lib/alpha-wallet-api";
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
  | "receive"           // Phase C
  | "send"              // Phase C
  | "notifications"
  | "add-token"
  | "security"
  | "history"           // Phase F
  | "seed-export"       // Phase F
  | "wallet-settings";  // Phase I — impostazioni wallet

// ─── Currency preference hook ────────────────────────────────────────────────

function useWalletCurrency() {
  const [currency, setCurrencyState] = useState<"EUR" | "USD">(() => {
    try { return (localStorage.getItem("aw_currency") as "EUR" | "USD" | null) ?? "EUR"; }
    catch { return "EUR"; }
  });
  const setCurrency = useCallback((c: "EUR" | "USD") => {
    try { localStorage.setItem("aw_currency", c); } catch { /* ignore */ }
    setCurrencyState(c);
  }, []);
  return { currency, setCurrency };
}

const ONBOARDING_VIEWS: WalletSubView[] = [
  "create-phrase", "create-verify", "import-phrase",
  "setup-pin", "confirm-pin", "backup-confirm",
];

interface Props {
  onBack: () => void;
}

// ─── Root component ──────────────────────────────────────────────────────────

/**
 * Phase G §3.1: WalletProvider è ora al root dell'app (App.tsx).
 * AlphaWalletPage non ha più il suo wrapper — usa il provider elevato.
 */
export default function AlphaWalletPage({ onBack }: Props) {
  return <AlphaWalletInner onBack={onBack} />;
}

// ─── Inner ──────────────────────────────────────────────────────────────────

function AlphaWalletInner({ onBack }: Props) {
  const wallet = useWallet();
  const [subView, setSubView] = useState<WalletSubView>("welcome");
  const subViewRef = useRef<WalletSubView>("welcome");
  const [pendingMnemonic, setPendingMnemonic] = useState<string>("");
  const [pendingPin, setPendingPin] = useState<string>("");
  const [flowType, setFlowType] = useState<"create" | "import">("create");

  subViewRef.current = subView;

  useEffect(() => {
    if (wallet.phase === "initializing") return;
    const inOnboarding = ONBOARDING_VIEWS.includes(subViewRef.current);
    if (inOnboarding) return;
    if (wallet.phase === "no-wallet") setSubView("welcome");
    else if (wallet.phase === "locked") setSubView("unlock");
    else if (wallet.phase === "unlocked") {
      // Only redirect if currently on unlock/welcome — don't disrupt send/receive/etc.
      const isAuthView = subViewRef.current === "unlock" || subViewRef.current === "welcome";
      if (isAuthView) setSubView("overview");
    }
  }, [wallet.phase]);

  if (wallet.phase === "initializing") {
    return <div className="aw-root"><div className="aw-spinner" /></div>;
  }

  // SECURITY: always wipe pending onboarding state before starting a new flow
  const handleCreate = () => {
    setPendingMnemonic(""); setPendingPin("");
    setFlowType("create"); setSubView("create-phrase");
  };
  const handleImport = () => {
    setPendingMnemonic(""); setPendingPin("");
    setFlowType("import"); setSubView("import-phrase");
  };

  const renderContent = () => {
    switch (subView) {
      case "welcome":
        return <WelcomeView onCreate={handleCreate} onImport={handleImport} />;
      case "create-phrase":
        return <CreatePhraseView
          onNext={(m) => { setPendingMnemonic(m); setSubView("create-verify"); }}
          onBack={() => { setPendingMnemonic(""); setPendingPin(""); setSubView("welcome"); }} />;
      case "create-verify":
        return <VerifyPhraseView mnemonic={pendingMnemonic} onNext={() => setSubView("setup-pin")} onBack={() => setSubView("create-phrase")} />;
      case "import-phrase":
        return <ImportPhraseView
          onNext={(m) => { setPendingMnemonic(m); setSubView("setup-pin"); }}
          onBack={() => { setPendingMnemonic(""); setPendingPin(""); setSubView("welcome"); }} />;
      case "setup-pin":
        return <SetupPinView onNext={(p) => { setPendingPin(p); setSubView("confirm-pin"); }} onBack={() => setSubView(flowType === "create" ? "create-verify" : "import-phrase")} />;
      case "confirm-pin":
        return (
          <ConfirmPinView
            expectedPin={pendingPin}
            mnemonic={pendingMnemonic}
            flowType={flowType}
            onNext={() => {
              if (flowType === "create") { setSubView("backup-confirm"); }
              else { setPendingMnemonic(""); setPendingPin(""); setSubView("overview"); }
            }}
            onBack={() => setSubView("setup-pin")}
          />
        );
      case "backup-confirm":
        return (
          <BackupConfirmView
            mnemonic={pendingMnemonic}
            pin={pendingPin}
            onConfirm={async () => { setPendingMnemonic(""); setPendingPin(""); setSubView("overview"); }}
          />
        );
      case "unlock":
        return <UnlockView />;
      case "overview":
        return <OverviewView onNavigate={setSubView} />;
      case "receive":
        return <ReceiveView onBack={() => setSubView("overview")} />;
      case "send":
        return <SendView onBack={() => setSubView("overview")} onSuccess={() => setSubView("overview")} />;
      case "notifications":
        return <NotificationsView onBack={() => setSubView("overview")} />;
      case "add-token":
        return <AddTokenView onBack={() => setSubView("overview")} />;
      case "security":
        return <SecurityView onBack={() => setSubView("overview")} onForget={onBack} onExportSeed={() => setSubView("seed-export")} />;
      case "history":
        return <HistoryView onBack={() => setSubView("overview")} />;
      case "seed-export":
        return <SeedExportView onBack={() => setSubView("security")} />;
      case "wallet-settings":
        return <WalletSettingsView onBack={() => setSubView("overview")} onGoSecurity={() => setSubView("security")} onGoSeedExport={() => setSubView("seed-export")} />;
      default: return null;
    }
  };

  const isOnboarding = ONBOARDING_VIEWS.includes(subView) || subView === "welcome";
  const subViewTitle: Partial<Record<WalletSubView, string>> = {
    overview: "Alpha Wallet", notifications: "Notifiche", "add-token": "Aggiungi Token",
    security: "Sicurezza", unlock: "Alpha Wallet", receive: "Ricevi", send: "Invia",
    history: "Storico", "seed-export": "Recovery Phrase", "wallet-settings": "Impostazioni",
  };

  return (
    <div className="aw-root">
      <header className="aw-header">
        {isOnboarding ? (
          <>
            <button className="aw-back-btn" onClick={onBack} aria-label="Chiudi">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="20" height="20">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
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
            <span className="aw-header-title">{subViewTitle[subView] ?? ""}</span>
            {subView === "overview" ? (
              <div className="aw-header-actions">
                <button className="aw-icon-btn" onClick={() => setSubView("notifications")} aria-label="Notifiche" style={{ position: "relative" }}>
                  🔔
                  {wallet.unreadCount > 0 && <span className="aw-badge">{wallet.unreadCount}</span>}
                </button>
                <button className="aw-icon-btn" onClick={() => wallet.lockWallet()} aria-label="Blocca wallet">🔒</button>
                <button className="aw-icon-btn" onClick={() => setSubView("wallet-settings")} aria-label="Impostazioni">⚙️</button>
              </div>
            ) : <div />}
          </>
        )}
      </header>
      <main className="aw-content">{renderContent()}</main>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// ONBOARDING VIEWS (Phase B — unchanged)
// ═══════════════════════════════════════════════════════════════════════════

function WelcomeView({ onCreate, onImport }: { onCreate: () => void; onImport: () => void }) {
  return (
    <div className="aw-welcome">
      <div className="aw-welcome-icon">🔐</div>
      <h1 className="aw-welcome-title">Alpha Wallet</h1>
      <p className="aw-welcome-sub">Wallet self-custodial nativo. Le tue chiavi restano solo sul tuo dispositivo.</p>
      <div className="aw-warning-box">
        <span>⚠️</span>
        <span>Alpha Chat non può recuperare il tuo wallet se perdi la recovery phrase. Esegui sempre il backup prima di depositare fondi.</span>
      </div>
      <button className="aw-btn aw-btn--primary" onClick={onCreate}>🆕 Crea nuovo wallet</button>
      <button className="aw-btn aw-btn--secondary" onClick={onImport}>📥 Importa wallet esistente</button>
    </div>
  );
}

function CreatePhraseView({ onNext, onBack }: { onNext: (m: string) => void; onBack: () => void }) {
  const [mnemonic] = useState(() => createMnemonic(128));
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const words = mnemonic.split(" ");
  const handleCopy = () => void navigator.clipboard.writeText(mnemonic).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
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
      {!revealed
        ? <button className="aw-btn aw-btn--secondary" onClick={() => setRevealed(true)}>👁 Mostra recovery phrase</button>
        : <button className="aw-btn aw-btn--ghost" onClick={handleCopy}>{copied ? "✅ Copiato" : "📋 Copia negli appunti"}</button>
      }
      <div className="aw-btn-row">
        <button className="aw-btn aw-btn--secondary" onClick={onBack}>Indietro</button>
        <button className="aw-btn aw-btn--primary" onClick={() => onNext(mnemonic)} disabled={!revealed}>Ho scritto le parole →</button>
      </div>
    </div>
  );
}

function VerifyPhraseView({ mnemonic, onNext, onBack }: { mnemonic: string; onNext: () => void; onBack: () => void }) {
  const words = mnemonic.split(" ");
  const [indices] = useState(() => [...Array(12).keys()].sort(() => Math.random() - 0.5).slice(0, 3).sort((a, b) => a - b));
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | null>(null);
  const verify = () => {
    if (!indices.every(i => answers[i]?.trim().toLowerCase() === words[i])) { setError("Una o più parole non corrispondono. Riprova."); return; }
    onNext();
  };
  return (
    <div className="aw-verify">
      <h2>Verifica la Recovery Phrase</h2>
      <p className="aw-sub">Inserisci le parole richieste dalla tua recovery phrase.</p>
      {indices.map(idx => (
        <div key={idx} className="aw-verify-field">
          <label>Parola #{idx + 1}</label>
          <input type="text" className="aw-input" value={answers[idx] ?? ""} onChange={e => { setAnswers(p => ({ ...p, [idx]: e.target.value })); setError(null); }} autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder={`Parola ${idx + 1}…`} />
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
      <textarea className="aw-textarea" rows={5} value={value} onChange={e => { setValue(e.target.value); setError(null); }} placeholder="parola1 parola2 parola3 …" autoComplete="off" autoCapitalize="none" spellCheck={false} />
      <div className="aw-word-count">{wordCount} parole</div>
      {error && <div className="aw-error">{error}</div>}
      <div className="aw-btn-row">
        <button className="aw-btn aw-btn--secondary" onClick={onBack}>Indietro</button>
        <button className="aw-btn aw-btn--primary" onClick={validate}>Importa →</button>
      </div>
    </div>
  );
}

function SetupPinView({ onNext, onBack }: { onNext: (pin: string) => void; onBack: () => void }) {
  const [pin, setPin] = useState("");
  const err = pinValidationError(pin);
  return (
    <div className="aw-pin-setup">
      <h2>Crea il tuo PIN</h2>
      <p className="aw-sub">Il PIN sblocca il wallet. Usa almeno 6 cifre.</p>
      <input type="password" inputMode="numeric" className="aw-input aw-input--pin" value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, ""))} maxLength={12} placeholder="••••••" autoFocus />
      {pin.length > 0 && err && <div className="aw-error">{err}</div>}
      <div className="aw-btn-row">
        <button className="aw-btn aw-btn--secondary" onClick={onBack}>Indietro</button>
        <button className="aw-btn aw-btn--primary" onClick={() => !err && onNext(pin)} disabled={!!err || pin.length === 0}>Avanti →</button>
      </div>
    </div>
  );
}

function ConfirmPinView({ expectedPin, mnemonic, flowType, onNext, onBack }: {
  expectedPin: string; mnemonic: string; flowType: "create" | "import"; onNext: () => void; onBack: () => void;
}) {
  const wallet = useWallet();
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const confirm = useCallback(async () => {
    if (pin !== expectedPin) { setError("I PIN non corrispondono. Riprova."); return; }
    if (flowType === "import") {
      setLoading(true);
      try { await wallet.importWallet(mnemonic, pin); onNext(); }
      catch (err) { setError(err instanceof Error ? err.message : "Errore durante la creazione"); }
      finally { setLoading(false); }
    } else { onNext(); }
  }, [pin, expectedPin, flowType, mnemonic, wallet, onNext]);
  return (
    <div className="aw-pin-setup">
      <h2>Conferma il PIN</h2>
      <p className="aw-sub">Reinserisci il PIN per confermare.</p>
      <input type="password" inputMode="numeric" className="aw-input aw-input--pin" value={pin} onChange={e => { setPin(e.target.value.replace(/\D/g, "")); setError(null); }} onKeyDown={e => e.key === "Enter" && void confirm()} maxLength={12} placeholder="••••••" autoFocus />
      {error && <div className="aw-error">{error}</div>}
      <div className="aw-btn-row">
        <button className="aw-btn aw-btn--secondary" onClick={onBack} disabled={loading}>Indietro</button>
        <button className="aw-btn aw-btn--primary" onClick={confirm} disabled={loading || pin.length < 6}>{loading ? "Creazione…" : "Conferma →"}</button>
      </div>
    </div>
  );
}

function BackupConfirmView({ mnemonic, pin, onConfirm }: { mnemonic: string; pin: string; onConfirm: () => Promise<void> }) {
  const wallet = useWallet();
  const [checked, setChecked] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const handleConfirm = async () => {
    if (!checked) return;
    setLoading(true);
    try { await wallet.importWallet(mnemonic, pin); await onConfirm(); }
    catch (err) { setError(err instanceof Error ? err.message : "Errore durante il salvataggio"); setLoading(false); }
  };
  return (
    <div className="aw-backup">
      <div className="aw-backup-icon">📝</div>
      <h2>Backup obbligatorio</h2>
      <p>Hai annotato le 12 parole in un posto sicuro?<br /><strong>Alpha Chat non può recuperare il tuo wallet se perdi la recovery phrase.</strong></p>
      <div className="aw-phrase-review">
        {mnemonic.split(" ").map((w, i) => <span key={i} className="aw-phrase-tag">{i + 1}. {w}</span>)}
      </div>
      <label className="aw-checkbox-label">
        <input type="checkbox" checked={checked} onChange={e => setChecked(e.target.checked)} />
        Ho annotato le 12 parole su carta e le ho messe in un posto sicuro.
      </label>
      {error && <div className="aw-error">{error}</div>}
      <button className="aw-btn aw-btn--primary" disabled={!checked || loading} onClick={handleConfirm}>
        {loading ? "Salvataggio…" : "Continua al Wallet →"}
      </button>
    </div>
  );
}

function UnlockView() {
  const wallet = useWallet();
  const lock = useLock();
  const biometricOnlyEnabled = lock?.biometricOnlyEnabled ?? false;
  const hasBiometricSet = lock?.hasBiometricSet ?? false;
  const biometricEnabled = lock?.settings?.biometricEnabled ?? false;
  const showBiometric = biometricOnlyEnabled || (hasBiometricSet && biometricEnabled);

  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showPin, setShowPin] = useState(!biometricOnlyEnabled);

  // Tenta sblocco biometrico automaticamente se è l'unico metodo
  useEffect(() => {
    if (biometricOnlyEnabled) void handleBiometric();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const unlockWithPin = async (p: string) => {
    if (!validatePin(p)) { setError("PIN non valido"); return; }
    setLoading(true);
    try { await wallet.unlockWallet(p); }
    catch { setError("PIN errato. Riprova."); setPin(""); }
    finally { setLoading(false); }
  };

  const handleBiometric = async () => {
    if (!lock) return;
    setError(null);
    setLoading(true);
    try {
      const ok = await lock.tryUnlockWithBiometric();
      if (!ok) { setError("Autenticazione biometrica fallita."); setLoading(false); return; }
      // Recupera il PIN cachato in sessionStorage per decriptare il keystore
      const cached = sessionStorage.getItem("aw_bio_pin");
      if (!cached) {
        setError("Sessione scaduta. Inserisci il PIN una volta per riattivare Face ID.");
        setShowPin(true);
        setLoading(false);
        return;
      }
      await wallet.unlockWallet(cached);
    } catch {
      setError("Impossibile sbloccare. Usa il PIN.");
      setShowPin(true);
    } finally {
      setLoading(false);
    }
  };

  const BiometricIcon = () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="24" height="24">
      <path d="M12 1C5.925 1 1 5.925 1 12s4.925 11 11 11 11-4.925 11-11S18.075 1 12 1z"/>
      <path d="M8.5 9.5c0-1.933 1.567-3.5 3.5-3.5s3.5 1.567 3.5 3.5"/>
      <path d="M6 12c0-3.314 2.686-6 6-6s6 2.686 6 6"/>
      <path d="M3.5 12c0-4.694 3.806-8.5 8.5-8.5s8.5 3.806 8.5 8.5"/>
      <circle cx="12" cy="12" r="1"/>
    </svg>
  );

  return (
    <div className="aw-unlock">
      <div className="aw-unlock-icon">🔐</div>
      <h2>Alpha Wallet</h2>

      {/* Modalità biometrica primaria */}
      {biometricOnlyEnabled && !showPin ? (
        <>
          <p className="aw-sub">Usa Face ID per sbloccare il wallet.</p>
          {error && <div className="aw-error">{error}</div>}
          <button
            className="aw-btn aw-btn--primary aw-btn--biometric"
            onClick={handleBiometric}
            disabled={loading}
          >
            <BiometricIcon />
            {loading ? "Verifica in corso…" : "Face ID / Touch ID"}
          </button>
          <button className="aw-btn aw-btn--ghost" onClick={() => setShowPin(true)}>
            Usa il PIN
          </button>
        </>
      ) : (
        <>
          <p className="aw-sub">Inserisci il PIN per sbloccare il wallet.</p>
          <input
            type="password"
            inputMode="numeric"
            className="aw-input aw-input--pin"
            value={pin}
            onChange={e => { setPin(e.target.value.replace(/\D/g, "")); setError(null); }}
            onKeyDown={e => e.key === "Enter" && void unlockWithPin(pin)}
            maxLength={12}
            placeholder="••••••"
            autoFocus
          />
          {error && <div className="aw-error">{error}</div>}
          <button
            className="aw-btn aw-btn--primary"
            onClick={() => unlockWithPin(pin)}
            disabled={loading || pin.length < 6}
          >
            {loading ? "Sblocco…" : "Sblocca →"}
          </button>
          {showBiometric && !biometricOnlyEnabled && (
            <button
              className="aw-btn aw-btn--ghost aw-btn--biometric"
              onClick={handleBiometric}
              disabled={loading}
            >
              <BiometricIcon />
              Face ID / Touch ID
            </button>
          )}
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// OVERVIEW (Phase C — real balances)
// ═══════════════════════════════════════════════════════════════════════════

function OverviewView({ onNavigate }: { onNavigate: (v: WalletSubView) => void }) {
  const wallet = useWallet();
  const { currency } = useWalletCurrency();
  const meta = wallet.meta;
  const isBtc = wallet.selectedChainId === 0;
  const net = getNetworkByChainId(wallet.selectedChainId);
  const [copied, setCopied] = useState<"evm" | "btc" | null>(null);
  const [notifPermission, setNotifPermission] = useState<NotificationPermission>("default");

  // Phase C: real balance state
  const [chainBalance, setChainBalance] = useState<ChainBalance | null>(null);
  const [btcBalance, setBtcBalance] = useState<BtcBalance | null>(null);
  const [prices, setPrices] = useState<AssetPrices | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(true);
  const [balanceError, setBalanceError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!meta) return;
    setBalanceLoading(true);
    setBalanceError(null);
    try {
      const [pricesData] = await Promise.all([
        fetchPrices().catch(() => null),
        isBtc
          ? fetchBtcBalance(meta.btcAddress).then(setBtcBalance).catch(() => {})
          : fetchEvmBalance(wallet.selectedChainId, meta.evmAddress as `0x${string}`).then(setChainBalance).catch(() => {}),
      ]);
      setPrices(pricesData);
    } catch {
      setBalanceError("Impossibile aggiornare il saldo. Controlla la connessione.");
    } finally {
      setBalanceLoading(false);
    }
  }, [meta, isBtc, wallet.selectedChainId]);

  useEffect(() => {
    // Reset previous chain's balance when chain changes
    setChainBalance(null);
    setBtcBalance(null);
    void fetchData();
    const id = setInterval(() => void fetchData(), 60_000);
    return () => clearInterval(id);
  }, [fetchData]);

  useEffect(() => {
    if (typeof Notification !== "undefined") setNotifPermission(Notification.permission);
  }, []);

  const copy = (text: string, type: "evm" | "btc") => {
    void navigator.clipboard.writeText(text).then(() => { setCopied(type); setTimeout(() => setCopied(null), 2000); });
  };

  if (!meta) return null;

  // Portfolio total in selected currency
  const fiatKey = currency.toLowerCase() as "eur" | "usd";
  let totalFiatRaw: number | null = null;
  if (prices && !balanceLoading) {
    if (isBtc && btcBalance) {
      totalFiatRaw = (Number(btcBalance.confirmedSat) / 1e8) * (prices.btc?.[fiatKey] ?? 0);
    } else if (chainBalance) {
      totalFiatRaw = 0;
      const nativeKey = wallet.selectedChainId === 1 ? "eth" : wallet.selectedChainId === 137 ? "pol" : "bnb";
      const np = (prices[nativeKey as keyof AssetPrices] as { eur: number; usd: number } | undefined)?.[fiatKey] ?? 0;
      totalFiatRaw += (Number(chainBalance.native.rawBalance) / 1e18) * np;
      for (const t of chainBalance.tokens) {
        const sym = t.symbol.toLowerCase() as keyof AssetPrices;
        const p = (prices[sym] as { eur: number; usd: number } | undefined)?.[fiatKey] ?? 0;
        totalFiatRaw += (Number(t.rawBalance) / 10 ** t.decimals) * p;
      }
    }
  }

  const primaryBalance = balanceLoading
    ? "Caricamento…"
    : isBtc
      ? (btcBalance?.formatted ?? "0.00000000 BTC")
      : (chainBalance?.native.formatted ?? `0 ${wallet.selectedChainId === 1 ? "ETH" : wallet.selectedChainId === 137 ? "POL" : "BNB"}`);

  const totalFiat = totalFiatRaw !== null
    ? new Intl.NumberFormat(currency === "EUR" ? "it-IT" : "en-US", { style: "currency", currency, maximumFractionDigits: 2 }).format(totalFiatRaw)
    : null;

  const address = isBtc ? meta.btcAddress : meta.evmAddress;

  return (
    <div className="aw-overview">
      {/* Network selector */}
      <div className="aw-network-bar">
        <div className="aw-network-badge" style={{ borderColor: net?.color ?? "#888" }}>
          <span style={{ color: net?.color }}>●</span>
          {isBtc ? "Bitcoin" : (net?.name ?? `Chain ${wallet.selectedChainId}`)}
        </div>
        <select className="aw-network-select" value={wallet.selectedChainId} onChange={e => wallet.setSelectedChainId(Number(e.target.value))} aria-label="Seleziona rete">
          <option value={137}>Polygon</option>
          <option value={1}>Ethereum</option>
          <option value={56}>BNB Smart Chain</option>
          <option value={0}>Bitcoin</option>
        </select>
      </div>

      {/* Balance card */}
      <div className="aw-balance-card">
        <div className="aw-balance-label">Saldo totale</div>
        <div className={`aw-balance-main ${balanceLoading ? "aw-balance-loading" : ""}`}>
          {primaryBalance}
        </div>
        {totalFiat && <div className="aw-balance-fiat">≈ {totalFiat}</div>}
        {balanceError && (
          <div className="aw-balance-error-row">
            <span>⚠️ {balanceError}</span>
            <button className="aw-btn-sm" onClick={fetchData}>↻</button>
          </div>
        )}
        {!balanceLoading && !balanceError && (
          <button className="aw-refresh-btn" onClick={fetchData} aria-label="Aggiorna saldo">↻</button>
        )}
      </div>

      {/* Actions */}
      <div className="aw-actions">
        <button className="aw-action-btn" onClick={() => onNavigate("send")}>
          📤<br /><small>Invia</small>
        </button>
        <button className="aw-action-btn" onClick={() => onNavigate("receive")}>
          📥<br /><small>Ricevi</small>
        </button>
        <button className="aw-action-btn" onClick={() => onNavigate("history")}>
          📋<br /><small>Storico</small>
        </button>
        <button className="aw-action-btn" onClick={() => onNavigate("notifications")} style={{ position: "relative" }}>
          🔔<br /><small>Notifiche</small>
          {wallet.unreadCount > 0 && <span className="aw-badge-sm">{wallet.unreadCount}</span>}
        </button>
      </div>

      {/* Address card */}
      <div className="aw-address-card">
        <div className="aw-address-label">Il tuo indirizzo {isBtc ? "Bitcoin" : (net?.shortName ?? "EVM")}</div>
        <div className="aw-address-value">{address}</div>
        <button className="aw-copy-btn" onClick={() => copy(address, isBtc ? "btc" : "evm")}>
          {copied ? "✅ Copiato" : "📋 Copia"}
        </button>
      </div>

      {/* Asset list */}
      <div className="aw-section-header">
        <div className="aw-section-title" style={{ margin: 0 }}>Asset</div>
        <button className="aw-section-link" onClick={() => onNavigate("add-token")}>+ Aggiungi</button>
      </div>
      <AssetList chainId={wallet.selectedChainId} chainBalance={chainBalance} btcBalance={btcBalance} prices={prices} loading={balanceLoading} currency={currency} />

      {/* Push notification prompt */}
      {notifPermission === "default" && (
        <div className="aw-push-prompt">
          <span>🔔 Ricevi notifiche per le transazioni in entrata</span>
          <button className="aw-btn-sm" onClick={async () => setNotifPermission(await requestNotificationPermission())}>Attiva</button>
        </div>
      )}

      {!meta.backupVerified && (
        <div className="aw-backup-warning">
          <span>⚠️</span>
          <div className="aw-backup-warning-content">
            <strong>Backup non completato</strong>
            <p>Esegui il backup della recovery phrase prima di depositare fondi.</p>
            <button className="aw-backup-warning-btn" onClick={() => onNavigate("seed-export")}>
              📋 Vedi recovery phrase →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Asset List (Phase C — real balances) ────────────────────────────────────

interface AssetListProps {
  chainId:      number;
  chainBalance: ChainBalance | null;
  btcBalance:   BtcBalance | null;
  prices:       AssetPrices | null;
  loading:      boolean;
  currency:     "EUR" | "USD";
}

function AssetList({ chainId, chainBalance, btcBalance, prices, loading, currency }: AssetListProps) {
  const wallet = useWallet();
  const isBtc = chainId === 0;
  const verifiedTokens = getVerifiedTokens(isBtc ? 137 : chainId);

  if (isBtc) {
    const btcPrice = prices?.btc ?? null;
    const fiatStr  = btcBalance && btcPrice
      ? formatFiat(btcBalance.confirmedSat, 8, btcPrice, currency)
      : null;
    return (
      <div className="aw-asset-list">
        <div className="aw-asset-item">
          <div className="aw-asset-icon">₿</div>
          <div className="aw-asset-info">
            <div className="aw-asset-name">Bitcoin <span className="aw-badge-verified">✅</span></div>
            <div className="aw-asset-network">Bitcoin · Native SegWit</div>
          </div>
          <div className="aw-asset-balance-col">
            <div className="aw-asset-balance">{loading ? "…" : (btcBalance?.formatted ?? "0.00000000 BTC")}</div>
            {fiatStr && <div className="aw-asset-fiat">{fiatStr}</div>}
          </div>
        </div>
      </div>
    );
  }

  const allTokenDefs = [...verifiedTokens, ...wallet.customTokens];

  return (
    <div className="aw-asset-list">
      {/* Native token */}
      {chainBalance && (() => {
        const n = chainBalance.native;
        const nKey = chainId === 1 ? "eth" : chainId === 137 ? "pol" : "bnb";
        const nPrice = prices ? prices[nKey as keyof AssetPrices] as { usd: number; eur: number } | undefined : null;
        const fiatStr = nPrice ? formatFiat(n.rawBalance, 18, nPrice, currency) : null;
        return (
          <div className="aw-asset-item">
            <div className="aw-asset-icon">⬡</div>
            <div className="aw-asset-info">
              <div className="aw-asset-name">{n.symbol} <span className="aw-badge-verified">✅</span></div>
              <div className="aw-asset-network">{n.name}</div>
            </div>
            <div className="aw-asset-balance-col">
              <div className="aw-asset-balance">{n.formatted}</div>
              {fiatStr && <div className="aw-asset-fiat">{fiatStr}</div>}
            </div>
          </div>
        );
      })()}

      {/* ERC-20 tokens */}
      {allTokenDefs.map(t => {
        const balItem = chainBalance?.tokens.find(
          b => b.contractAddress?.toLowerCase() === t.contractAddress?.toLowerCase()
        );
        const bal    = balItem?.rawBalance ?? 0n;
        const fmtBal = loading ? "…" : formatCrypto(bal, t.decimals, t.symbol);
        const sym    = t.symbol.toLowerCase() as keyof AssetPrices;
        const price  = prices ? prices[sym] as { usd: number; eur: number } | undefined : null;
        const fiat   = !loading && price ? formatFiat(bal, t.decimals, price, currency) : null;
        const isVerifiedToken = t.verification === "verified";
        const isCustomToken   = t.verification === "custom";
        return (
          <div key={`${t.chainId}-${t.contractAddress}`} className="aw-asset-item">
            <div className="aw-asset-icon">🪙</div>
            <div className="aw-asset-info">
              <div className="aw-asset-name">
                {t.symbol}
                {isVerifiedToken
                  ? <span className="aw-badge-verified" title="Token verificato">✅</span>
                  : <span className="aw-badge-custom" title="Token custom">⚠️</span>
                }
              </div>
              <div className="aw-asset-network">{t.name}</div>
            </div>
            <div className="aw-asset-balance-col">
              <div className="aw-asset-balance">{fmtBal}</div>
              {fiat && <div className="aw-asset-fiat">{fiat}</div>}
            </div>
            {/* Phase F: remove custom token button */}
            {isCustomToken && t.contractAddress && (
              <button
                className="aw-asset-remove-btn"
                title="Rimuovi token"
                onClick={e => { e.stopPropagation(); void wallet.removeToken(t.chainId, t.contractAddress!); }}
                aria-label={`Rimuovi ${t.symbol}`}
              >✕</button>
            )}
          </div>
        );
      })}

      {/* Placeholder rows while loading */}
      {loading && !chainBalance && [1, 2, 3].map(i => (
        <div key={i} className="aw-asset-item aw-asset-item--skeleton">
          <div className="aw-asset-icon">⬡</div>
          <div className="aw-asset-info"><div className="aw-skeleton-line" /></div>
          <div className="aw-asset-balance">…</div>
        </div>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// RECEIVE VIEW (Phase C)
// ═══════════════════════════════════════════════════════════════════════════

function ReceiveView({ onBack }: { onBack: () => void }) {
  const wallet = useWallet();
  const meta = wallet.meta!;
  const isBtc = wallet.selectedChainId === 0;
  const address = isBtc ? meta.btcAddress : meta.evmAddress;
  const net = getNetworkByChainId(wallet.selectedChainId);
  const [copied, setCopied] = useState(false);

  const copy = () => void navigator.clipboard.writeText(address).then(() => { setCopied(true); setTimeout(() => setCopied(false), 3000); });

  return (
    <div className="aw-receive">
      <div className="aw-receive-icon">📥</div>
      <div className="aw-receive-network">
        {isBtc ? "Bitcoin · Native SegWit" : (net?.name ?? `Chain ${wallet.selectedChainId}`)}
      </div>
      <div className="aw-receive-address-box">
        <div className="aw-receive-address">{address}</div>
        <button className="aw-btn aw-btn--primary" onClick={copy}>
          {copied ? "✅ Indirizzo copiato!" : "📋 Copia indirizzo"}
        </button>
      </div>
      <div className="aw-receive-warning">
        ⚠️ Invia solo {isBtc ? "BTC (mainnet)" : `asset compatibili con ${net?.name ?? "questa rete"}`} a questo indirizzo.
      </div>
      <button className="aw-btn aw-btn--secondary" style={{ maxWidth: 200, margin: "16px auto 0" }} onClick={onBack}>
        ← Torna al wallet
      </button>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// SEND VIEW (Phase C — self-custodial send flow)
//
// Steps: form → confirming-gas → confirm → auth → processing → success | error
// SICUREZZA: la private key viene derivata solo nel passaggio "auth",
//   usata per firmare, e poi azzerata. Non lascia mai il dispositivo.
// ═══════════════════════════════════════════════════════════════════════════

type SendStep = "form" | "confirming-gas" | "confirm" | "auth" | "processing" | "success" | "error";

interface SendAsset {
  symbol:          string;
  decimals:        number;
  balance:         bigint;
  contractAddress?: string;
  isNative:        boolean;
  chainId:         number;
  name:            string;
}

function SendView({ onBack, onSuccess }: { onBack: () => void; onSuccess: () => void }) {
  const wallet   = useWallet();
  const meta     = wallet.meta!;
  const chainId  = wallet.selectedChainId;
  const isBtc    = chainId === 0;

  // Balance data
  const [chainBalance, setChainBalance] = useState<ChainBalance | null>(null);
  const [btcBalance, setBtcBalance] = useState<BtcBalance | null>(null);
  const [prices, setPrices] = useState<AssetPrices | null>(null);
  const [balLoading, setBalLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      setBalLoading(true);
      try {
        const [p] = await Promise.all([
          fetchPrices().catch(() => null),
          isBtc
            ? fetchBtcBalance(meta.btcAddress).then(setBtcBalance).catch(() => {})
            : fetchEvmBalance(chainId, meta.evmAddress as `0x${string}`).then(setChainBalance).catch(() => {}),
        ]);
        setPrices(p);
      } finally { setBalLoading(false); }
    })();
  }, [chainId, meta.evmAddress, meta.btcAddress, isBtc]);

  // Build asset list
  const assets: SendAsset[] = isBtc
    ? [{ symbol: "BTC", decimals: 8, balance: btcBalance?.confirmedSat ?? 0n, isNative: true, chainId: 0, name: "Bitcoin" }]
    : chainBalance
    ? [
        {
          symbol:    chainBalance.native.symbol,
          decimals:  18,
          balance:   chainBalance.native.rawBalance,
          isNative:  true,
          chainId,
          name:      chainBalance.native.name,
        },
        ...chainBalance.tokens.map(t => ({
          symbol:          t.symbol,
          decimals:        t.decimals,
          balance:         t.rawBalance,
          contractAddress: t.contractAddress,
          isNative:        false,
          chainId,
          name:            t.name,
        })),
      ]
    : [];

  // Send form state
  const [step, setStep]                 = useState<SendStep>("form");
  const [assetIdx, setAssetIdx]         = useState(0);
  const [recipient, setRecipient]       = useState("");
  const [amountStr, setAmountStr]       = useState("");
  const [recipientErr, setRecipientErr] = useState<string | null>(null);
  const [amountErr, setAmountErr]       = useState<string | null>(null);
  const [gasEst, setGasEst]             = useState<GasEstimate | null>(null);
  const [btcPreview, setBtcPreview]     = useState<(BtcSendPreview & { feeRate: number }) | null>(null);
  const [txHash, setTxHash]             = useState<string | null>(null);
  const [broadcastErr, setBroadcastErr] = useState<string | null>(null);
  const [pin, setPin]                   = useState("");
  const [pinErr, setPinErr]             = useState<string | null>(null);

  const selectedAsset = assets[assetIdx] ?? assets[0];

  const handleProceed = async () => {
    if (!selectedAsset) return;

    // Validate recipient
    const rErr = isBtc ? validateBtcAddress(recipient) : validateEvmRecipient(recipient);
    if (rErr) { setRecipientErr(rErr); return; }
    setRecipientErr(null);

    // Validate amount
    const raw = parseAmount(amountStr, selectedAsset.decimals);
    if (!raw || raw <= 0n) { setAmountErr("Importo non valido"); return; }
    if (raw > selectedAsset.balance) { setAmountErr("Saldo insufficiente"); return; }
    setAmountErr(null);

    setStep("confirming-gas");
    try {
      if (isBtc) {
        const preview = await getBtcSendPreview(meta.btcAddress, raw, "normal");
        const total = raw + preview.feeSat;
        if (total > selectedAsset.balance) { setAmountErr(`Saldo insufficiente dopo fee (${satToBtc(preview.feeSat)})`); setStep("form"); return; }
        setBtcPreview({ ...preview, feeRate: preview.feeRateSvb });
        setStep("confirm");
      } else {
        let est: GasEstimate;
        if (selectedAsset.isNative) {
          est = await estimateNativeTransferGas({ chainId, from: meta.evmAddress as `0x${string}`, to: recipient as `0x${string}`, valueWei: raw });
          if (raw + est.totalFeeWei > selectedAsset.balance) {
            setAmountErr(`Saldo insufficiente per coprire importo + gas (${est.totalFeeEth} ${est.feeSymbol})`);
            setStep("form"); return;
          }
        } else {
          est = await estimateErc20TransferGas({ chainId, from: meta.evmAddress as `0x${string}`, tokenContractAddr: selectedAsset.contractAddress as `0x${string}`, recipient: recipient as `0x${string}`, amount: raw });
        }
        setGasEst(est);
        setStep("confirm");
      }
    } catch (e) {
      setAmountErr(e instanceof Error ? e.message : "Errore nella stima del gas/fee");
      setStep("form");
    }
  };

  const handleSignAndSend = async () => {
    if (!validatePin(pin)) { setPinErr("PIN non valido"); return; }
    setPinErr(null);
    setStep("processing");
    const raw = parseAmount(amountStr, selectedAsset.decimals)!;
    try {
      const keystore = await loadKeystore();
      if (!keystore) throw new Error("Keystore non trovato. Ricrea il wallet.");
      let mnemonic: string;
      try { mnemonic = await decryptSeed(keystore, pin); }
      catch {
        // SECURITY: wrong PIN — clear entered PIN so user retypes from scratch
        setPin("");
        setStep("auth"); setPinErr("PIN errato. Riprova."); return;
      }

      if (isBtc) {
        const result = await signAndBroadcastBtcTx({ mnemonic, recipientAddress: recipient, amountSat: raw, feeTarget: "normal" });
        setTxHash(result.txid);
      } else if (selectedAsset.isNative) {
        const result = await signAndBroadcastNativeEvm({ mnemonic, chainId, to: recipient as `0x${string}`, valueWei: raw, gasLimit: gasEst!.gasLimit, gasPrice: gasEst!.gasPrice, nonce: gasEst!.nonce });
        setTxHash(result.txHash);
      } else {
        const result = await signAndBroadcastErc20Evm({ mnemonic, chainId, tokenContractAddr: selectedAsset.contractAddress as `0x${string}`, recipient: recipient as `0x${string}`, amount: raw, gasLimit: gasEst!.gasLimit, gasPrice: gasEst!.gasPrice, nonce: gasEst!.nonce });
        setTxHash(result.txHash);
      }
      // SECURITY: clear PIN from React state on success
      setPin("");
      setStep("success");
    } catch (e) {
      // SECURITY: clear PIN from React state on error too
      setPin("");
      setBroadcastErr(e instanceof Error ? e.message : "Errore durante l'invio");
      setStep("error");
    }
  };

  const netName = isBtc ? "Bitcoin" : getNetworkByChainId(chainId)?.name ?? `Chain ${chainId}`;
  const raw = parseAmount(amountStr, selectedAsset?.decimals ?? 8);

  // Render form step
  if (step === "form" || step === "confirming-gas") {
    return (
      <div className="aw-send-form">
        <h2>Invia</h2>
        <div className="aw-send-network">{netName}</div>

        {/* Asset selector */}
        {assets.length > 1 && (
          <>
            <label className="aw-label">Asset</label>
            <select className="aw-select" value={assetIdx} onChange={e => { setAssetIdx(Number(e.target.value)); setAmountStr(""); setAmountErr(null); }}>
              {assets.map((a, i) => <option key={i} value={i}>{a.symbol} — {formatCrypto(a.balance, a.decimals, a.symbol)}</option>)}
            </select>
          </>
        )}

        {selectedAsset && (
          <div className="aw-send-balance">
            Disponibile: <strong>{balLoading ? "…" : formatCrypto(selectedAsset.balance, selectedAsset.decimals, selectedAsset.symbol)}</strong>
          </div>
        )}

        {/* Recipient */}
        <label className="aw-label">Indirizzo destinatario</label>
        <input
          type="text"
          className={`aw-input ${recipientErr ? "aw-input--error" : ""}`}
          value={recipient}
          onChange={e => { setRecipient(e.target.value.trim()); setRecipientErr(null); }}
          placeholder={isBtc ? "bc1q… oppure 1…" : "0x…"}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
        />
        {recipientErr && <div className="aw-error">{recipientErr}</div>}

        {/* Amount */}
        <label className="aw-label">Importo</label>
        <div className="aw-amount-row">
          <input
            type="text"
            inputMode="decimal"
            className={`aw-input aw-input--amount ${amountErr ? "aw-input--error" : ""}`}
            value={amountStr}
            onChange={e => { setAmountStr(e.target.value.replace(",", ".")); setAmountErr(null); }}
            placeholder="0.00"
          />
          <span className="aw-amount-symbol">{selectedAsset?.symbol}</span>
        </div>
        {amountErr && <div className="aw-error">{amountErr}</div>}

        {/* Fiat preview */}
        {raw && raw > 0n && prices && selectedAsset && (() => {
          const sym = selectedAsset.symbol.toLowerCase() as keyof AssetPrices;
          const p = prices[sym] as { usd: number; eur: number } | undefined;
          return p ? <div className="aw-amount-fiat">≈ {formatFiat(raw, selectedAsset.decimals, p, "EUR")}</div> : null;
        })()}

        <div className="aw-btn-row">
          <button className="aw-btn aw-btn--secondary" onClick={onBack}>Annulla</button>
          <button className="aw-btn aw-btn--primary" onClick={handleProceed} disabled={step === "confirming-gas" || !amountStr || !recipient}>
            {step === "confirming-gas" ? "Calcolo fee…" : "Rivedi →"}
          </button>
        </div>
      </div>
    );
  }

  // Confirm step
  if (step === "confirm") {
    const raw2 = parseAmount(amountStr, selectedAsset?.decimals ?? 8)!;
    return (
      <div className="aw-send-confirm">
        <h2>Conferma invio</h2>
        <div className="aw-confirm-table">
          <div className="aw-confirm-row"><span>Asset</span><strong>{selectedAsset?.symbol}</strong></div>
          <div className="aw-confirm-row"><span>Rete</span><strong>{netName}</strong></div>
          <div className="aw-confirm-row"><span>Importo</span><strong>{formatCrypto(raw2, selectedAsset?.decimals ?? 8, selectedAsset?.symbol ?? "")}</strong></div>
          <div className="aw-confirm-row"><span>Destinatario</span><strong className="aw-confirm-addr">{recipient.slice(0, 12)}…{recipient.slice(-8)}</strong></div>
          {isBtc && btcPreview ? (
            <>
              <div className="aw-confirm-row"><span>Miner fee</span><strong>{satToBtc(btcPreview.feeSat)} ({btcPreview.feeRateSvb} sat/vbyte)</strong></div>
              <div className="aw-confirm-row aw-confirm-row--total"><span>Totale</span><strong>{satToBtc(raw2 + btcPreview.feeSat)}</strong></div>
            </>
          ) : gasEst ? (
            <>
              {selectedAsset?.contractAddress && (
                <div className="aw-confirm-row"><span>Contract</span><strong className="aw-confirm-addr">{selectedAsset.contractAddress?.slice(0, 10)}…{selectedAsset.contractAddress?.slice(-8)}</strong></div>
              )}
              <div className="aw-confirm-row"><span>Network fee</span><strong>{gasEst.totalFeeEth} {gasEst.feeSymbol} ({gasEst.gasPriceGwei} gwei)</strong></div>
              {selectedAsset?.isNative && (
                <div className="aw-confirm-row aw-confirm-row--total">
                  <span>Totale</span>
                  <strong>{formatCrypto(raw2 + gasEst.totalFeeWei, 18, selectedAsset.symbol)}</strong>
                </div>
              )}
            </>
          ) : null}
        </div>
        <div className="aw-confirm-note">
          ⚠️ Verifica il destinatario prima di confermare. Le transazioni blockchain sono irreversibili.
        </div>
        <div className="aw-btn-row">
          <button className="aw-btn aw-btn--secondary" onClick={() => setStep("form")}>← Modifica</button>
          <button className="aw-btn aw-btn--primary" onClick={() => setStep("auth")}>Autorizza →</button>
        </div>
      </div>
    );
  }

  // Auth step — PIN required before signing
  if (step === "auth") {
    return (
      <div className="aw-send-auth">
        <div className="aw-send-auth-icon">🔑</div>
        <h2>Autorizzazione richiesta</h2>
        <p className="aw-sub">Inserisci il PIN per firmare la transazione. La chiave privata rimarrà esclusivamente sul tuo dispositivo.</p>
        <input
          type="password"
          inputMode="numeric"
          className={`aw-input aw-input--pin ${pinErr ? "aw-input--error" : ""}`}
          value={pin}
          onChange={e => { setPin(e.target.value.replace(/\D/g, "")); setPinErr(null); }}
          onKeyDown={e => e.key === "Enter" && void handleSignAndSend()}
          maxLength={12}
          placeholder="••••••"
          autoFocus
        />
        {pinErr && <div className="aw-error">{pinErr}</div>}
        <div className="aw-btn-row">
          <button className="aw-btn aw-btn--secondary" onClick={() => { setStep("confirm"); setPin(""); setPinErr(null); }}>← Indietro</button>
          <button className="aw-btn aw-btn--primary" onClick={handleSignAndSend} disabled={pin.length < 6}>
            Firma e invia 🔏
          </button>
        </div>
      </div>
    );
  }

  // Processing
  if (step === "processing") {
    return (
      <div className="aw-send-processing">
        <div className="aw-spinner" />
        <p>Firma e broadcast in corso…</p>
        <p className="aw-sub">La chiave privata viene usata solo ora e sarà azzerata al termine.</p>
      </div>
    );
  }

  // Success
  if (step === "success" && txHash) {
    const explorerUrl = isBtc
      ? `https://blockstream.info/tx/${txHash}`
      : txExplorerUrl(chainId, txHash);
    return (
      <div className="aw-send-success">
        <div className="aw-send-success-icon">✅</div>
        <h2>Transazione inviata!</h2>
        <p>La transazione è stata trasmessa alla rete.</p>
        <div className="aw-tx-hash-box">
          <div className="aw-tx-hash-label">TX Hash</div>
          <div className="aw-tx-hash">{txHash}</div>
          <a href={explorerUrl} target="_blank" rel="noopener noreferrer" className="aw-explorer-link">
            Vedi su explorer ↗
          </a>
        </div>
        <button className="aw-btn aw-btn--primary" onClick={onSuccess}>← Torna al wallet</button>
      </div>
    );
  }

  // Error
  return (
    <div className="aw-send-error">
      <div className="aw-send-error-icon">❌</div>
      <h2>Invio fallito</h2>
      <div className="aw-error-box">{broadcastErr ?? "Errore sconosciuto"}</div>
      <div className="aw-btn-row">
        <button className="aw-btn aw-btn--secondary" onClick={() => { setStep("confirm"); setBroadcastErr(null); }}>← Riprova</button>
        <button className="aw-btn aw-btn--primary" onClick={onBack}>Annulla</button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// NOTIFICATIONS (Phase B — unchanged)
// ═══════════════════════════════════════════════════════════════════════════

function NotificationsView({ onBack }: { onBack: () => void }) {
  const wallet = useWallet();
  useEffect(() => { void markAllNotificationsRead().then(() => wallet.refreshNotifications()); }, []); // eslint-disable-line
  if (wallet.notifications.length === 0) {
    return (
      <div className="aw-empty-state">
        <div className="aw-empty-icon">🔔</div>
        <div className="aw-empty-title">Nessuna notifica</div>
        <p className="aw-empty-sub">Le transazioni rilevate appariranno qui.</p>
        <button className="aw-btn aw-btn--secondary" style={{ maxWidth: 200, margin: "16px auto 0" }} onClick={onBack}>← Torna al wallet</button>
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
              {chainName(n.chainId)} · {n.status === "confirmed" ? "Confermato" : n.status === "pending" ? "In attesa" : "Fallito"}
            </div>
            {n.txHash && (
              <a className="aw-notif-hash" href={txExplorerUrl(n.chainId, n.txHash)} target="_blank" rel="noopener noreferrer">
                {n.txHash.slice(0, 10)}…{n.txHash.slice(-6)}
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
              </a>
            )}
          </div>
          <div className="aw-notif-time">{new Date(n.timestamp).toLocaleDateString("it-IT", { day: "2-digit", month: "short" })}</div>
        </div>
      ))}
    </div>
  );
}

// ─── Add Token (Phase B — unchanged) ────────────────────────────────────────

function AddTokenView({ onBack }: { onBack: () => void }) {
  const wallet = useWallet();
  const [address, setAddress] = useState("");
  const [chainId, setChainId] = useState(137);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ name: string; symbol: string; decimals: number; isVerified: boolean; symbolConflict: boolean } | null>(null);

  const fetchInfo = async () => {
    if (!/^0x[0-9a-fA-F]{38,42}$/.test(address)) { setError("Indirizzo non valido (deve iniziare con 0x)"); return; }
    setLoading(true); setError(null); setPreview(null);
    try { setPreview(await apiWalletGetTokenInfo(chainId, address)); }
    catch { setError("Impossibile recuperare le informazioni del token. Verifica rete e indirizzo."); }
    finally { setLoading(false); }
  };

  const addToken = async () => {
    if (!preview) return;
    const p = buildCustomTokenPreview(chainId, preview.symbol, preview.name, preview.decimals, address as `0x${string}`);
    await wallet.addCustomToken(p.token);
    onBack();
  };

  const net = getNetworkByChainId(chainId);
  return (
    <div className="aw-add-token">
      <h2>Aggiungi Token</h2>
      <p className="aw-sub">Importa un token ERC-20 tramite il suo contract address.</p>
      <label className="aw-label">Rete</label>
      <select className="aw-select" value={chainId} onChange={e => { setChainId(Number(e.target.value)); setPreview(null); }}>
        <option value={137}>Polygon</option>
        <option value={1}>Ethereum</option>
        <option value={56}>BNB Smart Chain</option>
      </select>
      <label className="aw-label">Contract Address</label>
      <input type="text" className="aw-input" value={address} onChange={e => { setAddress(e.target.value.trim()); setPreview(null); setError(null); }} placeholder="0x..." autoComplete="off" autoCapitalize="none" />
      {error && <div className="aw-error">{error}</div>}
      {!preview && <button className="aw-btn aw-btn--secondary" onClick={fetchInfo} disabled={loading}>{loading ? "Ricerca…" : "🔍 Cerca token"}</button>}
      {preview && (
        <div className="aw-token-preview">
          <div className="aw-token-preview-header">
            {preview.isVerified ? <span className="aw-verified-badge">✅ Verificato</span>
              : preview.symbolConflict ? <span className="aw-warning-badge">⚠️ Symbol identico a token ufficiale — rischio phishing</span>
              : <span className="aw-custom-badge">⚠️ Token non verificato</span>}
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
          {preview.symbolConflict && <div className="aw-phishing-warning">⚠️ Questo token usa lo stesso symbol di un token ufficiale ma ha un contract diverso. Potrebbe essere un tentativo di phishing.</div>}
          <div className="aw-btn-row">
            <button className="aw-btn aw-btn--secondary" onClick={() => setPreview(null)}>Annulla</button>
            <button className="aw-btn aw-btn--primary" onClick={addToken}>➕ Aggiungi token</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Security (Phase B + F) ────────────────────────────────────────────────

function SecurityView({ onBack, onForget, onExportSeed }: { onBack: () => void; onForget: () => void; onExportSeed: () => void }) {
  const wallet = useWallet();
  const [showForgetConfirm, setShowForgetConfirm] = useState(false);
  const [forgetting, setForgetting] = useState(false);
  const forget = async () => { setForgetting(true); await wallet.forgetWallet(); onForget(); };
  return (
    <div className="aw-security">
      <div className="aw-security-section">
        <h3>Stato backup</h3>
        <div className={`aw-backup-status ${wallet.meta?.backupVerified ? "ok" : "warn"}`}>
          {wallet.meta?.backupVerified ? "✅ Recovery phrase verificata" : "⚠️ Recovery phrase non ancora verificata"}
        </div>
      </div>

      {/* Phase F: seed export autenticato */}
      <div className="aw-security-section">
        <h3>Recovery Phrase</h3>
        <p style={{ fontSize: 13, color: "rgba(255,255,255,.45)", margin: "0 0 10px" }}>
          Visualizza la tua recovery phrase in modo sicuro, protetta dal PIN.
        </p>
        <button className="aw-btn aw-btn--secondary" onClick={onExportSeed}>
          📋 Mostra recovery phrase
        </button>
      </div>

      <div className="aw-security-section">
        <h3>Sessione</h3>
        <button className="aw-btn aw-btn--secondary" onClick={wallet.lockWallet}>🔒 Blocca wallet</button>
      </div>
      <div className="aw-security-section aw-security-section--danger">
        <h3>Zona pericolosa</h3>
        <p>Questa operazione è IRREVERSIBILE. I fondi sono recuperabili solo con la recovery phrase.</p>
        {!showForgetConfirm
          ? <button className="aw-btn aw-btn--danger" onClick={() => setShowForgetConfirm(true)}>🗑️ Elimina wallet da questo dispositivo</button>
          : (
            <div className="aw-forget-confirm">
              <p><strong>Sei sicuro?</strong> Il wallet verrà eliminato. Avrai bisogno della recovery phrase per ripristinarlo.</p>
              <div className="aw-btn-row">
                <button className="aw-btn aw-btn--secondary" onClick={() => setShowForgetConfirm(false)} disabled={forgetting}>Annulla</button>
                <button className="aw-btn aw-btn--danger" onClick={forget} disabled={forgetting}>{forgetting ? "Eliminazione…" : "Elimina definitivamente"}</button>
              </div>
            </div>
          )
        }
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// WALLET SETTINGS VIEW (Phase I)
// ═══════════════════════════════════════════════════════════════════════════

type PinChangeStep = "idle" | "verify-old" | "enter-new" | "confirm-new";

function WalletSettingsView({
  onBack,
  onGoSecurity,
  onGoSeedExport,
}: {
  onBack: () => void;
  onGoSecurity: () => void;
  onGoSeedExport: () => void;
}) {
  const wallet = useWallet();
  const { currency, setCurrency } = useWalletCurrency();

  // ── Change PIN flow ──────────────────────────────────────────────────────
  const [pinStep, setPinStep] = useState<PinChangeStep>("idle");
  const [oldPin, setOldPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [pinError, setPinError] = useState<string | null>(null);
  const [pinLoading, setPinLoading] = useState(false);
  const [pinSuccess, setPinSuccess] = useState(false);

  const resetPinFlow = () => {
    setPinStep("idle");
    setOldPin(""); setNewPin(""); setConfirmPin("");
    setPinError(null); setPinLoading(false);
  };

  const handleVerifyOld = async () => {
    if (oldPin.length < 6) { setPinError("PIN troppo corto"); return; }
    setPinLoading(true); setPinError(null);
    // Verifica vecchio PIN provando a sbloccare (senza modificare lo stato del wallet)
    try {
      const entry = await loadKeystore();
      if (!entry) throw new Error("Keystore non trovato");
      await decryptSeed(entry, oldPin);
      setPinStep("enter-new");
    } catch {
      setPinError("PIN attuale errato. Riprova.");
    } finally {
      setPinLoading(false);
    }
  };

  const handleNewPin = () => {
    const err = pinValidationError(newPin);
    if (err) { setPinError(err); return; }
    setPinError(null);
    setPinStep("confirm-new");
  };

  const handleConfirmNew = async () => {
    if (confirmPin !== newPin) { setPinError("I PIN non corrispondono"); return; }
    setPinLoading(true); setPinError(null);
    try {
      await wallet.changeWalletPIN(oldPin, newPin);
      setPinSuccess(true);
      setTimeout(() => { setPinSuccess(false); resetPinFlow(); }, 2000);
    } catch (e) {
      setPinError(e instanceof Error ? e.message : "Errore durante il cambio PIN");
    } finally {
      setPinLoading(false);
    }
  };

  const renderPinFlow = () => {
    if (pinSuccess) {
      return (
        <div className="aw-settings-pin-success">✅ PIN aggiornato con successo</div>
      );
    }
    switch (pinStep) {
      case "verify-old":
        return (
          <div className="aw-settings-pin-flow">
            <p className="aw-sub">Inserisci il PIN attuale</p>
            <input type="password" inputMode="numeric" className="aw-input aw-input--pin" value={oldPin}
              onChange={e => { setOldPin(e.target.value.replace(/\D/g, "")); setPinError(null); }}
              onKeyDown={e => e.key === "Enter" && void handleVerifyOld()}
              maxLength={12} placeholder="••••••" autoFocus />
            {pinError && <div className="aw-error">{pinError}</div>}
            <div className="aw-btn-row">
              <button className="aw-btn aw-btn--secondary" onClick={resetPinFlow}>Annulla</button>
              <button className="aw-btn aw-btn--primary" onClick={handleVerifyOld} disabled={pinLoading || oldPin.length < 6}>
                {pinLoading ? "Verifica…" : "Avanti →"}
              </button>
            </div>
          </div>
        );
      case "enter-new":
        return (
          <div className="aw-settings-pin-flow">
            <p className="aw-sub">Scegli il nuovo PIN (min. 6 cifre)</p>
            <input type="password" inputMode="numeric" className="aw-input aw-input--pin" value={newPin}
              onChange={e => { setNewPin(e.target.value.replace(/\D/g, "")); setPinError(null); }}
              onKeyDown={e => e.key === "Enter" && handleNewPin()}
              maxLength={12} placeholder="••••••" autoFocus />
            {pinError && <div className="aw-error">{pinError}</div>}
            <div className="aw-btn-row">
              <button className="aw-btn aw-btn--secondary" onClick={resetPinFlow}>Annulla</button>
              <button className="aw-btn aw-btn--primary" onClick={handleNewPin} disabled={newPin.length < 6}>
                Avanti →
              </button>
            </div>
          </div>
        );
      case "confirm-new":
        return (
          <div className="aw-settings-pin-flow">
            <p className="aw-sub">Conferma il nuovo PIN</p>
            <input type="password" inputMode="numeric" className="aw-input aw-input--pin" value={confirmPin}
              onChange={e => { setConfirmPin(e.target.value.replace(/\D/g, "")); setPinError(null); }}
              onKeyDown={e => e.key === "Enter" && void handleConfirmNew()}
              maxLength={12} placeholder="••••••" autoFocus />
            {pinError && <div className="aw-error">{pinError}</div>}
            <div className="aw-btn-row">
              <button className="aw-btn aw-btn--secondary" onClick={resetPinFlow}>Annulla</button>
              <button className="aw-btn aw-btn--primary" onClick={handleConfirmNew} disabled={pinLoading || confirmPin.length < 6}>
                {pinLoading ? "Salvataggio…" : "Conferma →"}
              </button>
            </div>
          </div>
        );
      default:
        return (
          <button className="aw-settings-item" onClick={() => { resetPinFlow(); setPinStep("verify-old"); }}>
            <span className="aw-settings-item-icon">🔑</span>
            <span className="aw-settings-item-label">Cambia PIN</span>
            <span className="aw-settings-item-chevron">›</span>
          </button>
        );
    }
  };

  return (
    <div className="aw-settings">

      {/* ── Preferenze ─────────────────────────────────────────────────── */}
      <div className="aw-settings-section">
        <div className="aw-settings-section-title">Preferenze</div>

        {/* Valuta di visualizzazione */}
        <div className="aw-settings-item aw-settings-item--row">
          <span className="aw-settings-item-icon">💱</span>
          <span className="aw-settings-item-label">Valuta</span>
          <div className="aw-segmented">
            <button
              className={`aw-segmented-btn ${currency === "EUR" ? "aw-segmented-btn--active" : ""}`}
              onClick={() => setCurrency("EUR")}
            >EUR €</button>
            <button
              className={`aw-segmented-btn ${currency === "USD" ? "aw-segmented-btn--active" : ""}`}
              onClick={() => setCurrency("USD")}
            >USD $</button>
          </div>
        </div>
      </div>

      {/* ── Sicurezza ──────────────────────────────────────────────────── */}
      <div className="aw-settings-section">
        <div className="aw-settings-section-title">Sicurezza</div>

        {/* Cambio PIN */}
        <div className="aw-settings-expandable">
          {renderPinFlow()}
        </div>

        {/* Recovery phrase */}
        <button className="aw-settings-item" onClick={onGoSeedExport}>
          <span className="aw-settings-item-icon">📋</span>
          <span className="aw-settings-item-label">Recovery phrase</span>
          <span className="aw-settings-item-chevron">›</span>
        </button>

        {/* Stato backup */}
        <div className="aw-settings-item aw-settings-item--info">
          <span className="aw-settings-item-icon">{wallet.meta?.backupVerified ? "✅" : "⚠️"}</span>
          <span className="aw-settings-item-label">
            Backup {wallet.meta?.backupVerified ? "completato" : "non completato"}
          </span>
        </div>

        {/* Sicurezza avanzata */}
        <button className="aw-settings-item" onClick={onGoSecurity}>
          <span className="aw-settings-item-icon">🛡️</span>
          <span className="aw-settings-item-label">Sicurezza avanzata</span>
          <span className="aw-settings-item-chevron">›</span>
        </button>

        {/* Blocca wallet */}
        <button className="aw-settings-item aw-settings-item--lock" onClick={() => { wallet.lockWallet(); onBack(); }}>
          <span className="aw-settings-item-icon">🔒</span>
          <span className="aw-settings-item-label">Blocca wallet</span>
        </button>
      </div>

      {/* ── Informazioni ───────────────────────────────────────────────── */}
      <div className="aw-settings-section">
        <div className="aw-settings-section-title">Informazioni</div>
        <div className="aw-settings-item aw-settings-item--info">
          <span className="aw-settings-item-icon">ℹ️</span>
          <div>
            <div className="aw-settings-item-label">Alpha Wallet</div>
            <div className="aw-settings-item-sub">Self-custodial · Le chiavi restano sul dispositivo</div>
          </div>
        </div>
      </div>

    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// HISTORY VIEW (Phase F — storico transazioni)
// ═══════════════════════════════════════════════════════════════════════════

type TxFilter = "all" | "in" | "out" | "pending";

function HistoryView({ onBack }: { onBack: () => void }) {
  const wallet = useWallet();
  const [filter, setFilter] = useState<TxFilter>("all");
  const [selectedTx, setSelectedTx] = useState<WalletTxRecord | null>(null);
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 30;

  // Refresh storico quando si entra nella view
  useEffect(() => { void wallet.refreshTxHistory(); }, []); // eslint-disable-line

  const filtered = wallet.txHistory.filter(tx => {
    if (filter === "all") return true;
    if (filter === "in") return tx.direction === "in" && tx.status !== "pending";
    if (filter === "out") return tx.direction === "out" && tx.status !== "pending";
    if (filter === "pending") return tx.status === "pending";
    return true;
  });

  const visible = filtered.slice(0, page * PAGE_SIZE);
  const hasMore = visible.length < filtered.length;

  if (selectedTx) {
    return <TxDetailView tx={selectedTx} onBack={() => setSelectedTx(null)} />;
  }

  return (
    <div className="aw-history">
      {/* Filtri */}
      <div className="aw-history-filters">
        {(["all", "in", "out", "pending"] as TxFilter[]).map(f => (
          <button
            key={f}
            className={`aw-filter-chip ${filter === f ? "aw-filter-chip--active" : ""}`}
            onClick={() => { setFilter(f); setPage(1); }}
          >
            {f === "all" ? "Tutto" : f === "in" ? "💰 Ricevuto" : f === "out" ? "📤 Inviato" : "⏳ In attesa"}
          </button>
        ))}
      </div>

      {/* Lista */}
      {filtered.length === 0 ? (
        <div className="aw-history-empty">
          <div className="aw-history-empty-icon">📋</div>
          <div className="aw-history-empty-title">
            {filter === "all" ? "Nessuna transazione" : "Nessuna transazione con questo filtro"}
          </div>
          <p>Le transazioni rilevate dal monitor appariranno qui.</p>
        </div>
      ) : (
        <div className="aw-history-list">
          {visible.map(tx => <TxListItem key={tx.id} tx={tx} onClick={() => setSelectedTx(tx)} />)}
          {hasMore && (
            <div className="aw-history-load-more">
              <button className="aw-btn aw-btn--secondary" style={{ maxWidth: 180 }} onClick={() => setPage(p => p + 1)}>
                Carica altri…
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── TxListItem ─────────────────────────────────────────────────────────────

function TxListItem({ tx, onClick }: { tx: WalletTxRecord; onClick: () => void }) {
  const isIn      = tx.direction === "in";
  const isPending = tx.status === "pending";
  const isFailed  = tx.status === "failed";

  const iconClass = isPending ? "aw-tx-icon--pending" : isIn ? "aw-tx-icon--in" : "aw-tx-icon--out";
  const icon      = isPending ? "⏳" : isIn ? "💰" : "📤";
  const label     = isPending ? "In attesa" : isIn ? "Ricevuto" : "Inviato";
  const amtClass  = isPending ? "aw-tx-amount--pending" : isIn ? "aw-tx-amount--in" : "aw-tx-amount--out";
  const amtPrefix = isIn ? "+" : "-";

  const date = new Date(tx.timestamp);
  const dateStr = date.toLocaleDateString("it-IT", { day: "2-digit", month: "short" });
  const timeStr = date.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });

  return (
    <div className="aw-tx-item" onClick={onClick} role="button" tabIndex={0}
      onKeyDown={e => e.key === "Enter" && onClick()}>
      <div className={`aw-tx-icon ${iconClass}`}>{icon}</div>
      <div className="aw-tx-body">
        <div className="aw-tx-title">
          {label}
          {isFailed && <span className="aw-tx-status-badge aw-tx-status-badge--failed">Fallita</span>}
          {isPending && <span className="aw-tx-status-badge aw-tx-status-badge--pending">Pending</span>}
        </div>
        <div className="aw-tx-meta">{tx.network} · {tx.txHash.slice(0, 8)}…{tx.txHash.slice(-6)}</div>
      </div>
      <div className="aw-tx-amount-col">
        <div className={`aw-tx-amount ${amtClass}`}>{amtPrefix}{tx.amount} {tx.asset}</div>
        <div className="aw-tx-date">{dateStr} {timeStr}</div>
      </div>
    </div>
  );
}

// ─── TxDetailView ───────────────────────────────────────────────────────────

function TxDetailView({ tx, onBack }: { tx: WalletTxRecord; onBack: () => void }) {
  const isIn      = tx.direction === "in";
  const isPending = tx.status === "pending";
  const isFailed  = tx.status === "failed";
  const [copied, setCopied] = useState(false);

  const explorerUrl = tx.chainId === 0
    ? `https://blockstream.info/tx/${tx.txHash}`
    : txExplorerUrl(tx.chainId, tx.txHash);

  const copyHash = () => {
    void navigator.clipboard.writeText(tx.txHash)
      .then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  };

  const statusLabel = isFailed ? "Fallita ❌" : isPending ? "In attesa ⏳" : "Confermata ✅";
  const amtClass = isPending ? "aw-tx-detail-amount-value--out"
    : isIn ? "aw-tx-detail-amount-value--in" : "aw-tx-detail-amount-value--out";
  const amtPrefix = isIn ? "+" : "-";

  const date = new Date(tx.timestamp);
  const dateStr = date.toLocaleString("it-IT");

  return (
    <div className="aw-tx-detail">
      <div className="aw-tx-detail-header">
        <button className="aw-back-btn" onClick={onBack} aria-label="Indietro">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="20" height="20">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
        </button>
        <h2>Dettaglio transazione</h2>
      </div>

      <div className="aw-tx-detail-icon">
        {isPending ? "⏳" : isIn ? "💰" : "📤"}
      </div>

      <div className="aw-tx-detail-amount">
        <div className={`aw-tx-detail-amount-value ${amtClass}`}>
          {amtPrefix}{tx.amount} {tx.asset}
        </div>
        <div className="aw-tx-detail-amount-network">{tx.network}</div>
      </div>

      <div className="aw-tx-detail-card">
        <div className="aw-tx-detail-row">
          <span className="aw-tx-detail-label">Stato</span>
          <span className="aw-tx-detail-value">{statusLabel}</span>
        </div>
        <div className="aw-tx-detail-row">
          <span className="aw-tx-detail-label">Data</span>
          <span className="aw-tx-detail-value">{dateStr}</span>
        </div>
        <div className="aw-tx-detail-row">
          <span className="aw-tx-detail-label">TX Hash</span>
          <span className="aw-tx-detail-value aw-tx-detail-value--mono">
            {tx.txHash.slice(0, 14)}…{tx.txHash.slice(-10)}
          </span>
        </div>
        {tx.fromAddress && (
          <div className="aw-tx-detail-row">
            <span className="aw-tx-detail-label">Da</span>
            <span className="aw-tx-detail-value aw-tx-detail-value--mono">
              {tx.fromAddress.slice(0, 10)}…{tx.fromAddress.slice(-8)}
            </span>
          </div>
        )}
        {tx.toAddress && (
          <div className="aw-tx-detail-row">
            <span className="aw-tx-detail-label">A</span>
            <span className="aw-tx-detail-value aw-tx-detail-value--mono">
              {tx.toAddress.slice(0, 10)}…{tx.toAddress.slice(-8)}
            </span>
          </div>
        )}
        {tx.blockNumber && (
          <div className="aw-tx-detail-row">
            <span className="aw-tx-detail-label">Blocco</span>
            <span className="aw-tx-detail-value">{parseInt(tx.blockNumber, 16) || tx.blockNumber}</span>
          </div>
        )}
        {tx.fee && (
          <div className="aw-tx-detail-row">
            <span className="aw-tx-detail-label">Fee</span>
            <span className="aw-tx-detail-value">{tx.fee}</span>
          </div>
        )}
      </div>

      <div className="aw-tx-detail-actions">
        <button className="aw-btn aw-btn--secondary" onClick={copyHash}>
          {copied ? "✅ Hash copiato" : "📋 Copia TX Hash"}
        </button>
        <a href={explorerUrl} target="_blank" rel="noopener noreferrer"
          className="aw-btn aw-btn--secondary" style={{ textDecoration: "none", textAlign: "center" }}>
          🔍 Vedi su explorer ↗
        </a>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// SEED EXPORT VIEW (Phase F — visualizzazione autenticata recovery phrase)
// ═══════════════════════════════════════════════════════════════════════════

function SeedExportView({ onBack }: { onBack: () => void }) {
  const [pin, setPin] = useState("");
  const [pinErr, setPinErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [words, setWords] = useState<string[] | null>(null);
  const [copied, setCopied] = useState(false);

  const handleReveal = async () => {
    if (!validatePin(pin)) { setPinErr("PIN non valido"); return; }
    setPinErr(null);
    setLoading(true);
    try {
      const keystore = await loadKeystore();
      if (!keystore) { setPinErr("Keystore non trovato. Ricrea il wallet."); return; }
      const mnemonic = await decryptSeed(keystore, pin);
      setWords(mnemonic.split(" "));
      setPin(""); // SECURITY: wipe PIN from state
    } catch {
      setPin("");
      setPinErr("PIN errato. Riprova.");
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = () => {
    if (!words) return;
    void navigator.clipboard.writeText(words.join(" "))
      .then(() => { setCopied(true); setTimeout(() => setCopied(false), 3000); });
  };

  // Mostra la frase se autenticata
  if (words) {
    return (
      <div className="aw-seed-export">
        <div className="aw-seed-export-warning">
          ⚠️ <strong>Non condividere mai queste parole.</strong> Chiunque le abbia può accedere ai tuoi fondi.
          Non fare screenshot — le immagini possono essere intercettate.
        </div>
        <div className="aw-seed-export-phrase">
          {words.map((w, i) => (
            <div key={i} className="aw-seed-export-word">
              <span className="aw-seed-export-word-num">{i + 1}</span>
              <span>{w}</span>
            </div>
          ))}
        </div>
        <button className="aw-btn aw-btn--ghost" onClick={handleCopy}>
          {copied ? "✅ Copiata negli appunti" : "📋 Copia recovery phrase"}
        </button>
        <button className="aw-btn aw-btn--secondary" onClick={onBack}>← Torna alla sicurezza</button>
      </div>
    );
  }

  // Form PIN
  return (
    <div className="aw-seed-export">
      <div className="aw-seed-export-warning">
        ⚠️ La recovery phrase ti permette di ripristinare il wallet su qualsiasi dispositivo.
        Tienila in un posto fisico sicuro, mai in foto o file digitali.
      </div>
      <p className="aw-sub">Inserisci il PIN per vedere la recovery phrase.</p>
      <input
        type="password"
        inputMode="numeric"
        className={`aw-input aw-input--pin ${pinErr ? "aw-input--error" : ""}`}
        value={pin}
        onChange={e => { setPin(e.target.value.replace(/\D/g, "")); setPinErr(null); }}
        onKeyDown={e => e.key === "Enter" && void handleReveal()}
        maxLength={12}
        placeholder="••••••"
        autoFocus
      />
      {pinErr && <div className="aw-error">{pinErr}</div>}
      <div className="aw-btn-row">
        <button className="aw-btn aw-btn--secondary" onClick={onBack}>Annulla</button>
        <button className="aw-btn aw-btn--primary" onClick={handleReveal} disabled={loading || pin.length < 6}>
          {loading ? "Verifica…" : "Mostra phrase →"}
        </button>
      </div>
    </div>
  );
}
