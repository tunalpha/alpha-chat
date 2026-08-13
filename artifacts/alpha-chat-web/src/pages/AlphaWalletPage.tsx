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
// Phase 5: Spark/Lightning portfolio integration (safe hook — null se flag=false)
import { useSparkWalletOptional } from "../contexts/SparkWalletContext";
// Admin monitoring: registra stato Spark nell'admin monitor (fire-and-forget)
import { apiRegisterSparkStatus } from "../lib/spark/spark-admin-register";
import type { SparkFeeBreakdown } from "../lib/spark/spark-types";
import {
  saveLightningTx,
  updateLightningTx,
  listLightningTxs,
  type LightningTxRecord,
} from "../lib/spark/lightning-store";
import { useSecurePhraseDisplay } from "../hooks/useSecurePhraseDisplay";
import { useLock } from "../contexts/LockContext";
import { WalletProvider, useWallet } from "../wallet/context/WalletContext";
import { createMnemonic, isValidMnemonic } from "../wallet/core/mnemonic";
import { validatePin, pinValidationError } from "../wallet/core/wallet-auth";
import { loadKeystore, decryptSeed, loadWalletMeta } from "../wallet/core/keystore";
import { requestNotificationPermission } from "../wallet/notifications/wallet-notification-store";
import { buildCustomTokenPreview, getVerifiedTokens } from "../wallet/evm/token-registry";
import { apiWalletGetTokenInfo } from "../lib/alpha-wallet-api";
import { apiCreateLightningInvoiceLink } from "../lib/api";
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
  getSymbolPrice,
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
// logo.png è in public/ → copiato da Vite in dist/public/logo.png → sempre servito a /logo.png

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
  | "wallet-settings"   // Phase I — impostazioni wallet
  | "portfolio";        // Portfolio Multi-Chain

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

// ─── Sealed PIN + Wallet Face ID — importati dal modulo condiviso ─────────────
// Estratti in wallet/security/wallet-pin-seal.ts per riuso in ChatWalletPaySheet.
import {
  sealWalletPin,
  unsealWalletPin,
  clearSealedWalletPin,
  useWalletFaceId,
} from "../wallet/security/wallet-pin-seal";

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
      case "portfolio":
        return <PortfolioView
          onBack={() => setSubView("overview")}
          onSelectChain={(chainId) => { wallet.setSelectedChainId(chainId); setSubView("overview"); }}
        />;
      default: return null;
    }
  };

  const isOnboarding = ONBOARDING_VIEWS.includes(subView) || subView === "welcome";
  const subViewTitle: Partial<Record<WalletSubView, string>> = {
    overview: "Alpha Wallet", notifications: "Notifiche", "add-token": "Aggiungi Token",
    security: "Sicurezza", unlock: "Alpha Wallet", receive: "Ricevi", send: "Invia",
    history: "Storico", "seed-export": "Recovery Phrase", "wallet-settings": "Impostazioni",
    portfolio: "Portfolio",
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

// ─── SecureOverlay ────────────────────────────────────────────────────────────
// Si sovrappone alla griglia della frase quando viene rilevato un tentativo
// di screenshot o condivisione schermo.

function SecureOverlay({
  isScreenShare,
  onReveal,
}: {
  isScreenShare: boolean;
  onReveal: () => void;
}) {
  return (
    <div className="aw-secure-overlay" role="alert" aria-live="assertive">
      <div className="aw-secure-overlay-icon">🛡️</div>
      <p className="aw-secure-overlay-title">Schermata nascosta</p>
      {isScreenShare ? (
        <p className="aw-secure-overlay-sub aw-secure-overlay-sub--danger">
          ⚠️ Condivisione schermo rilevata.<br />
          Interrompi la registrazione per vedere la frase.
        </p>
      ) : (
        <p className="aw-secure-overlay-sub">
          Il contenuto è stato nascosto per proteggere la tua recovery phrase.
        </p>
      )}
      {!isScreenShare && (
        <button className="aw-secure-overlay-btn" onClick={onReveal}>
          👁 Tocca per rivelare
        </button>
      )}
    </div>
  );
}

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
  const [secsLeft, setSecsLeft] = useState(PHRASE_VISIBLE_SECS);
  const words = mnemonic.split(" ");
  const { isProtected, isScreenShare, reveal } = useSecurePhraseDisplay();

  // Auto-hide: dopo PHRASE_VISIBLE_SECS la frase si ri-offusca automaticamente
  useEffect(() => {
    if (!revealed) { setSecsLeft(PHRASE_VISIBLE_SECS); return; }
    setSecsLeft(PHRASE_VISIBLE_SECS);
    const iv = setInterval(() => {
      setSecsLeft(s => {
        if (s <= 1) { clearInterval(iv); setRevealed(false); return 0; }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(iv);
  }, [revealed]);

  const handleCopy = () => void navigator.clipboard.writeText(mnemonic).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  return (
    <div className="aw-create-phrase">
      <h2>La tua Recovery Phrase</h2>
      <p className="aw-sub">
        Scrivi queste 12 parole su carta. Non fare screenshot.
        {revealed && (
          <span style={{ display: "block", marginTop: 4, fontVariantNumeric: "tabular-nums", opacity: 0.7, fontSize: "0.85em" }}>
            La frase si nasconde in{" "}
            <strong style={{ color: secsLeft <= 10 ? "#ef4444" : undefined }}>{secsLeft}s</strong>.
          </span>
        )}
      </p>
      <div className={`aw-phrase-grid ${!revealed ? "aw-blurred" : ""}`} style={{ position: "relative" }}>
        {words.map((w, i) => (
          <div key={i} className="aw-phrase-word">
            <span className="aw-word-num">{i + 1}</span>
            <span className="aw-word-text">{w}</span>
          </div>
        ))}
        {revealed && isProtected && <SecureOverlay isScreenShare={isScreenShare} onReveal={reveal} />}
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
  const { isProtected, isScreenShare, reveal } = useSecurePhraseDisplay();
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
      <div className="aw-phrase-review" style={{ position: "relative" }}>
        {mnemonic.split(" ").map((w, i) => <span key={i} className="aw-phrase-tag">{i + 1}. {w}</span>)}
        {isProtected && <SecureOverlay isScreenShare={isScreenShare} onReveal={reveal} />}
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
  const { walletFaceIdEnabled } = useWalletFaceId();

  // Wallet-specific Face ID: enabled via wallet settings + device supports biometric
  const hasBiometricSet = lock?.hasBiometricSet ?? false;
  const canUseBiometric = lock?.canUseBiometric ?? false;
  const walletBioActive = walletFaceIdEnabled && hasBiometricSet;

  // App-level biometric-only (legacy path — keep working)
  const appBiometricOnly = lock?.biometricOnlyEnabled ?? false;
  const biometricEnabled = lock?.settings?.biometricEnabled ?? false;

  // Show biometric button if either wallet Face ID or app biometric is configured
  const showBiometric = walletBioActive || appBiometricOnly || (hasBiometricSet && biometricEnabled);
  // Auto-trigger biometric on mount only if it's the primary unlock method
  const primaryBiometric = walletBioActive || appBiometricOnly;

  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showPin, setShowPin] = useState(!primaryBiometric);

  // Tenta sblocco biometrico automaticamente se è il metodo primario
  useEffect(() => {
    if (primaryBiometric) void handleBiometric();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const unlockWithPin = async (p: string) => {
    if (!validatePin(p)) { setError("PIN non valido"); return; }
    setLoading(true);
    try {
      await wallet.unlockWallet(p);
      // Face ID abilitato ma WebAuthn non ancora registrato (es. toggle abilitato senza PIN in cache)?
      // Auto-registra ora + sigilla il PIN così le sessioni successive funzioneranno senza PIN.
      if (walletFaceIdEnabled && !hasBiometricSet && lock && canUseBiometric) {
        void (async () => {
          try {
            const ok = await lock.enableBiometric();
            if (ok) await sealWalletPin(p);
          } catch { /* best-effort — l'utente è già sbloccato */ }
        })();
      } else if (walletFaceIdEnabled && hasBiometricSet) {
        // Registrazione già avvenuta: aggiorna il sigillo con il PIN corrente
        void sealWalletPin(p);
      }
    } catch { setError("PIN errato. Riprova."); setPin(""); }
    finally { setLoading(false); }
  };

  const handleBiometric = async () => {
    if (!lock) return;
    setError(null);
    setLoading(true);
    try {
      const ok = await lock.tryUnlockWithBiometric();
      if (!ok) { setError("Autenticazione biometrica fallita."); setLoading(false); return; }
      // 1. Prova prima sessionStorage (stessa sessione PWA)
      const cached = sessionStorage.getItem("aw_bio_pin");
      if (cached) { await wallet.unlockWallet(cached); return; }
      // 2. Fallback: PIN sigillato con AES-GCM in localStorage (sopravvive alla chiusura)
      const sealed = await unsealWalletPin();
      if (sealed) { await wallet.unlockWallet(sealed); return; }
      // 3. Né sessionStorage né sealed: chiedi il PIN una volta per riscrivere il sigillo
      setError("Inserisci il PIN una volta per riattivare Face ID su questo dispositivo.");
      setShowPin(true);
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
      {primaryBiometric && !showPin ? (
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
          {showBiometric && !primaryBiometric && (
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
  const isBtc       = wallet.selectedChainId === 0;
  // Phase 5: Lightning — chainId=-1 è riservato a Spark/Lightning, separato da BTC on-chain
  const isLightning = wallet.selectedChainId === -1;
  const net = getNetworkByChainId(wallet.selectedChainId);
  // Saldo Lightning dal Spark SDK (stato in memoria — nessuna fetch blockchain)
  const spark          = useSparkWalletOptional();
  const sparkConnected = spark?.state === "connected";
  const sparkBalance: bigint | null = sparkConnected ? (spark?.walletInfo?.balanceSat ?? null) : null;
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
      if (wallet.selectedChainId === -1) {
        // Lightning: saldo da Spark SDK (già in memoria), nessuna fetch blockchain.
        // Fetch solo prezzi per il controvalore in fiat.
        const pricesData = await fetchPrices().catch(() => null);
        setPrices(pricesData);
        return;
      }
      const [pricesData] = await Promise.all([
        fetchPrices().catch(() => null),
        isBtc
          ? fetchBtcBalance(meta.btcAddress).then(setBtcBalance).catch(() => {})
          : fetchEvmBalance(
              wallet.selectedChainId,
              meta.evmAddress as `0x${string}`,
              wallet.customTokens.filter(t => t.chainId === wallet.selectedChainId),
            ).then(setChainBalance).catch(() => {}),
      ]);
      setPrices(pricesData);
    } catch {
      setBalanceError("Impossibile aggiornare il saldo. Controlla la connessione.");
    } finally {
      setBalanceLoading(false);
    }
  }, [meta, isBtc, wallet.selectedChainId, wallet.customTokens]);

  useEffect(() => {
    // Reset previous chain's balance when chain changes
    setChainBalance(null);
    setBtcBalance(null);
    void fetchData();
    const id = setInterval(() => void fetchData(), 60_000);
    return () => clearInterval(id);
  }, [fetchData]);

  // Refresh saldo quando il tx-monitor segnala nuove TX o riconciliazioni
  // (es. BTC pending → confirmed, nuova ricezione)
  useEffect(() => {
    const handler = () => void fetchData();
    window.addEventListener("aw:new-tx", handler);
    return () => window.removeEventListener("aw:new-tx", handler);
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
    if (isLightning) {
      // Lightning: prezzo BTC, separato da BTC on-chain (no double-counting)
      if (sparkConnected && sparkBalance !== null) {
        const btcP = (prices.btc as { eur: number; usd: number } | undefined)?.[fiatKey] ?? 0;
        totalFiatRaw = (Number(sparkBalance) / 1e8) * btcP;
      }
    } else if (isBtc && btcBalance) {
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
    : isLightning
      ? (sparkConnected && sparkBalance !== null
          ? formatSatoshisToBtc(sparkBalance)
          : "⚡ Lightning non disponibile")
      : isBtc
        ? (btcBalance?.formatted ?? "0.00000000 BTC")
        : (chainBalance?.native.formatted ?? `0 ${wallet.selectedChainId === 1 ? "ETH" : wallet.selectedChainId === 137 ? "POL" : "BNB"}`);

  const totalFiat = totalFiatRaw !== null
    ? new Intl.NumberFormat(currency === "EUR" ? "it-IT" : "en-US", { style: "currency", currency, maximumFractionDigits: 2 }).format(totalFiatRaw)
    : null;

  // Lightning non ha indirizzo on-chain — non mostrare EVM né BTC address
  const address = isLightning ? "" : isBtc ? meta.btcAddress : meta.evmAddress;

  return (
    <div className="aw-overview">
      {/* Portfolio total card — sopra il selettore chain, tap apre Portfolio */}
      <PortfolioTotalCard onOpen={() => onNavigate("portfolio")} currency={currency} />

      {/* Network selector */}
      <div className="aw-network-bar">
        <div className="aw-network-badge" style={{ borderColor: net?.color ?? "#888" }}>
          <span style={{ color: net?.color }}>●</span>
          {isLightning ? "⚡ Lightning" : isBtc ? "Bitcoin" : (net?.name ?? `Chain ${wallet.selectedChainId}`)}
        </div>
        <select className="aw-network-select" value={wallet.selectedChainId} onChange={e => wallet.setSelectedChainId(Number(e.target.value))} aria-label="Seleziona rete">
          <option value={137}>Polygon</option>
          <option value={1}>Ethereum</option>
          <option value={56}>BNB Smart Chain</option>
          <option value={0}>Bitcoin</option>
          {/* Lightning è un canale off-chain (chainId=-1); mostrato solo quando Spark è abilitato */}
          {spark?.isEnabled && <option value={-1}>⚡ Lightning</option>}
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
        {/* Invia/Ricevi: per Lightning usa i flussi Spark/Breez; per BTC/EVM usa i flussi on-chain */}
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

      {/* Address card — nascosta per Lightning (no indirizzo on-chain) */}
      {!isLightning && address && (
        <div className="aw-address-card">
          <div className="aw-address-label">Il tuo indirizzo {isBtc ? "Bitcoin" : (net?.shortName ?? "EVM")}</div>
          <div className="aw-address-value">{address}</div>
          <button className="aw-copy-btn" onClick={() => copy(address, isBtc ? "btc" : "evm")}>
            {copied ? "✅ Copiato" : "📋 Copia"}
          </button>
        </div>
      )}

      {/* Asset list / Lightning asset */}
      <div className="aw-section-header">
        <div className="aw-section-title" style={{ margin: 0 }}>Asset</div>
        {!isLightning && <button className="aw-section-link" onClick={() => onNavigate("add-token")}>+ Aggiungi</button>}
      </div>
      {isLightning ? (
        // Lightning: mostra solo il saldo BTC Lightning dal Spark SDK
        // NON mostrare saldi EVM/BNB/BTC on-chain
        <div className="aw-asset-list">
          {sparkConnected && sparkBalance !== null ? (
            <div className="aw-asset-item">
              <div className="aw-asset-icon">⚡</div>
              <div className="aw-asset-info">
                <div className="aw-asset-symbol">BTC</div>
                <div className="aw-asset-network">Bitcoin Lightning</div>
              </div>
              <div className="aw-asset-balance">
                <div className="aw-asset-amount">{formatSatoshisToBtc(sparkBalance)}</div>
                {prices && totalFiatRaw !== null && totalFiatRaw > 0 && (
                  <div className="aw-asset-fiat">
                    {new Intl.NumberFormat(currency === "EUR" ? "it-IT" : "en-US", {
                      style: "currency", currency, maximumFractionDigits: 2,
                    }).format(totalFiatRaw)}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="aw-asset-item"
              style={{ justifyContent: "center", color: "rgba(255,255,255,0.45)", fontSize: "0.85rem", padding: "1rem" }}>
              ⚠️ Lightning non disponibile
            </div>
          )}
        </div>
      ) : (
        <AssetList chainId={wallet.selectedChainId} chainBalance={chainBalance} btcBalance={btcBalance} prices={prices} loading={balanceLoading} currency={currency} />
      )}

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

// ─── Portfolio Multi-Chain helpers ───────────────────────────────────────────

interface PortfolioAllBalances {
  polygon:  ChainBalance | null;
  ethereum: ChainBalance | null;
  bsc:      ChainBalance | null;
  btc:      BtcBalance   | null;
}

const EMPTY_PORTFOLIO: PortfolioAllBalances = { polygon: null, ethereum: null, bsc: null, btc: null };

/** Formatta satoshi in stringa BTC leggibile (es. "0.00050000 BTC") */
function formatSatoshisToBtc(sats: bigint): string {
  return `${(Number(sats) / 1e8).toFixed(8)} BTC`;
}

function usePortfolioBalances() {
  const wallet = useWallet();
  const spark  = useSparkWalletOptional();  // null se spark_lightning_enabled=false
  const meta   = wallet.meta;
  const [all,          setAll]          = useState<PortfolioAllBalances>(EMPTY_PORTFOLIO);
  const [prices,       setPrices]       = useState<AssetPrices | null>(null);
  const [loading,      setLoading]      = useState(true);
  // Quante chain non hanno risposto (0 = dati completi, >0 = totale parziale)
  const [failedChains, setFailedChains] = useState(0);

  // Cooldown per retry "error" — evita loop rapidi se Spark SDK fallisce ripetutamente.
  const sparkRetryRef = useRef(0);

  // Auto-connect Spark.
  //
  // TIMING CRITICO: questo hook gira anche quando wallet.phase === "locked"
  // (il wallet mostra la schermata PIN ma i hook React sono già eseguiti).
  // sessionStorage["aw_bio_pin"] viene scritto da unlockWallet() SOLO DOPO che
  // l'utente inserisce il PIN del wallet. Prima di allora getMnemonic() lancerebbe
  // "[SparkWallet] Wallet non sbloccato" → state="error" → mai più ritentato.
  //
  // Fix:
  // 1. Verifica sessionStorage["aw_bio_pin"] prima di ogni tentativo.
  // 2. Dipende da spark.state → si ri-triggera quando state cambia (es. error → retry).
  // 3. Dipende da meta → null→non-null quando il wallet si sblocca = trigger naturale.
  // 4. Cooldown 30s su "error" per evitare loop se Breez SDK è irraggiungibile.
  useEffect(() => {
    const pinPresent = !!sessionStorage.getItem("aw_bio_pin");
    if (!spark?.isEnabled) return;
    // Non interferire con stati attivi
    if (spark.state === "connecting" || spark.state === "connected" || spark.state === "syncing") return;
    // Verifica PIN: stesso check che fa getMnemonic() — se manca, wallet ancora bloccato
    // (wallet.phase==="locked" → hook già eseguiti ma aw_bio_pin non ancora scritto)
    if (!pinPresent) return;
    // Cooldown 30s su "error" — evita loop rapidi se Breez SDK è irraggiungibile
    if (spark.state === "error") {
      const now = Date.now();
      if (now - sparkRetryRef.current < 30_000) return;
      sparkRetryRef.current = now;
    }
    void spark.connect().catch(() => {
      // state → "error" → sparkOffline=true → UI mostra "Lightning non disponibile"
    });
  }, [spark?.isEnabled, spark?.state, meta]); // meta null→non-null all'unlock = trigger

  // Admin monitoring: registra/aggiorna stato Spark nell'admin monitor (fire-and-forget).
  // Separato dall'auto-connect — non blocca mai il flusso Spark.
  useEffect(() => {
    if (!spark?.isEnabled) return;
    if (spark.state === "connected") {
      void apiRegisterSparkStatus("enabled").catch(() => {});
    }
  }, [spark?.state, spark?.isEnabled]);

  // Spark Lightning balance — letto dal context (no fetch rete, già in memoria)
  // null se: Spark disabilitato | non connesso | walletInfo non ancora disponibile
  const sparkSat: bigint | null =
    spark !== null && spark.state === "connected"
      ? (spark.walletInfo?.balanceSat ?? null)
      : null;
  // Spark è abilitato e connesso ma non ha ancora restituito walletInfo (caricamento)
  const sparkLoading =
    spark !== null && spark.isEnabled && spark.state === "connecting";
  // Spark è abilitato ma non disponibile → dati parziali
  const sparkOffline =
    spark !== null && spark.isEnabled &&
    spark.state !== "connected" && spark.state !== "disabled" && spark.state !== "connecting";

  const fetchAll = useCallback(async () => {
    if (!meta) return;
    setLoading(true);
    try {
      const [pricesRes, polyRes, ethRes, bscRes, btcRes] = await Promise.allSettled([
        fetchPrices(),
        fetchEvmBalance(137, meta.evmAddress as `0x${string}`, wallet.customTokens.filter(t => t.chainId === 137)),
        fetchEvmBalance(1,   meta.evmAddress as `0x${string}`, wallet.customTokens.filter(t => t.chainId === 1)),
        fetchEvmBalance(56,  meta.evmAddress as `0x${string}`, wallet.customTokens.filter(t => t.chainId === 56)),
        fetchBtcBalance(meta.btcAddress),
      ]);
      if (pricesRes.status === "fulfilled") setPrices(pricesRes.value);
      const chainResults = [polyRes, ethRes, bscRes, btcRes];
      setFailedChains(chainResults.filter(r => r.status === "rejected").length);
      setAll({
        polygon:  polyRes.status === "fulfilled" ? polyRes.value : null,
        ethereum: ethRes.status  === "fulfilled" ? ethRes.value  : null,
        bsc:      bscRes.status  === "fulfilled" ? bscRes.value  : null,
        btc:      btcRes.status  === "fulfilled" ? btcRes.value  : null,
      });
    } finally {
      setLoading(false);
    }
  }, [meta, wallet.customTokens]);

  // Fetch al mount e quando arriva un nuovo TX — nessun polling separato:
  // il refresh periodico dei dati è già gestito dal ciclo 60s di OverviewView.fetchData
  // tramite l'evento aw:new-tx che viene emesso dal tx-monitor.
  useEffect(() => { void fetchAll(); }, [fetchAll]);

  useEffect(() => {
    const h = () => void fetchAll();
    window.addEventListener("aw:new-tx", h);
    return () => window.removeEventListener("aw:new-tx", h);
  }, [fetchAll]);

  return { all, prices, loading, failedChains, sparkSat, sparkLoading, sparkOffline };
}

/**
 * Calcola il valore fiat totale di tutti gli asset su tutte le chain.
 *
 * Phase 5: sparkSat aggiunto — saldo Lightning/Spark in satoshi.
 * INVARIANTE: sparkSat è contabilizzato col prezzo BTC, separatamente da BTC on-chain.
 * MAI sommare sparkSat a BTC on-chain confirmedSat (double counting).
 */
function calcPortfolioTotal(
  all: PortfolioAllBalances,
  prices: AssetPrices | null,
  fiatKey: "eur" | "usd",
  sparkSat?: bigint | null,
): number {
  if (!prices) return 0;
  let total = 0;
  const price = (key: string) =>
    (prices[key as keyof AssetPrices] as { eur: number; usd: number } | undefined)?.[fiatKey] ?? 0;

  if (all.polygon) {
    total += (Number(all.polygon.native.rawBalance) / 1e18) * price("pol");
    for (const t of all.polygon.tokens)
      total += (Number(t.rawBalance) / 10 ** t.decimals) * price(t.symbol.toLowerCase());
  }
  if (all.ethereum) {
    total += (Number(all.ethereum.native.rawBalance) / 1e18) * price("eth");
    for (const t of all.ethereum.tokens)
      total += (Number(t.rawBalance) / 10 ** t.decimals) * price(t.symbol.toLowerCase());
  }
  if (all.bsc) {
    total += (Number(all.bsc.native.rawBalance) / 1e18) * price("bnb");
    for (const t of all.bsc.tokens)
      total += (Number(t.rawBalance) / 10 ** t.decimals) * price(t.symbol.toLowerCase());
  }
  if (all.btc) {
    total += (Number(all.btc.confirmedSat) / 1e8) * price("btc");
  }
  // Phase 5: Spark Lightning balance — stesso prezzo BTC, contabilizzato separatamente
  // GUARD: null = Spark non connesso → non includere nel totale (dati parziali)
  if (sparkSat != null && sparkSat > 0n) {
    total += (Number(sparkSat) / 1e8) * price("btc");
  }
  return total;
}

function fmtPortfolioTotal(value: number, currency: "EUR" | "USD"): string {
  return new Intl.NumberFormat(currency === "EUR" ? "it-IT" : "en-US", {
    style: "currency", currency, maximumFractionDigits: 2,
  }).format(value);
}

// ─── PortfolioTotalCard ───────────────────────────────────────────────────────

function PortfolioTotalCard({
  onOpen,
  currency,
}: {
  onOpen: () => void;
  currency: "EUR" | "USD";
}) {
  const { all, prices, loading, failedChains, sparkSat, sparkOffline } = usePortfolioBalances();
  const fiatKey = currency.toLowerCase() as "eur" | "usd";

  const partialCount = failedChains + (sparkOffline ? 1 : 0);
  const isPartial   = !loading && partialCount > 0;
  const totalRaw    = loading ? null : calcPortfolioTotal(all, prices, fiatKey, sparkSat);
  const totalFmt    = totalRaw !== null ? fmtPortfolioTotal(totalRaw, currency) : null;
  const activeChains = [all.polygon, all.ethereum, all.bsc, all.btc].filter(Boolean).length
    + (sparkSat != null ? 1 : 0);
  const totalAssets  = [
    all.polygon  ? 1 + all.polygon.tokens.length  : 0,
    all.ethereum ? 1 + all.ethereum.tokens.length : 0,
    all.bsc      ? 1 + all.bsc.tokens.length      : 0,
    all.btc      ? 1                               : 0,
    sparkSat != null ? 1 : 0,
  ].reduce((a, b) => a + b, 0);

  return (
    <button className="aw-portfolio-total-card" onClick={onOpen} aria-label="Apri portfolio multi-chain">
      <div className="aw-portfolio-total-inner">
        <div>
          <div className="aw-portfolio-total-label">
            Portfolio{isPartial ? <span className="aw-portfolio-partial-badge"> · ⚠️ parziale</span> : null}
          </div>
          <div className={`aw-portfolio-total-amount ${loading ? "aw-portfolio-total-loading" : ""}`}>
            {loading ? "Caricamento…" : (totalFmt ? `≈ ${totalFmt}` : "—")}
          </div>
          <div className="aw-portfolio-total-meta">
            {loading
              ? "…"
              : isPartial
                ? `${failedChains} chain non disponibili · dati parziali`
                : `${activeChains} chain · ${totalAssets} asset`}
          </div>
        </div>
        <span className="aw-portfolio-total-chevron">›</span>
      </div>
    </button>
  );
}

// ─── PortfolioView ────────────────────────────────────────────────────────────

interface PortfolioAssetRow {
  chainId:   number;
  network:   string;
  symbol:    string;
  icon:      string;
  name:      string;
  amount:    string;
  fiatValue: number;
  fiatStr:   string | null;
}

function PortfolioView({
  onBack,
  onSelectChain,
}: {
  onBack: () => void;
  onSelectChain: (chainId: number) => void;
}) {
  const { currency } = useWalletCurrency();
  const { all, prices, loading, failedChains, sparkSat, sparkLoading, sparkOffline } = usePortfolioBalances();
  const fiatKey = currency.toLowerCase() as "eur" | "usd";

  const price = (key: string) =>
    (prices?.[key as keyof AssetPrices] as { eur: number; usd: number } | undefined)?.[fiatKey] ?? 0;

  const rows: PortfolioAssetRow[] = [];

  const addEvm = (
    balance: ChainBalance | null,
    chainId: number,
    network: string,
    nativeKey: string,
    nativeIcon: string,
  ) => {
    if (!balance) return;
    const nativePrice = price(nativeKey);
    const nativeFiatVal = (Number(balance.native.rawBalance) / 1e18) * nativePrice;
    const nativePriceObj = prices?.[nativeKey as keyof AssetPrices] as { eur: number; usd: number } | undefined;
    rows.push({
      chainId, network,
      symbol: balance.native.symbol,
      icon: "⬡",
      name: balance.native.name,
      amount: balance.native.formatted,
      fiatValue: nativeFiatVal,
      fiatStr: nativePriceObj ? formatFiat(balance.native.rawBalance, 18, nativePriceObj, currency) : null,
    });
    for (const t of balance.tokens) {
      const sym = t.symbol.toLowerCase();
      const p   = price(sym);
      const fv  = (Number(t.rawBalance) / 10 ** t.decimals) * p;
      const po  = prices?.[sym as keyof AssetPrices] as { eur: number; usd: number } | undefined;
      rows.push({
        chainId, network,
        symbol: t.symbol,
        icon: "🪙",
        name: t.name,
        amount: formatCrypto(t.rawBalance, t.decimals, t.symbol),
        fiatValue: fv,
        fiatStr: po ? formatFiat(t.rawBalance, t.decimals, po, currency) : null,
      });
    }
  };

  addEvm(all.polygon,  137, "Polygon",        "pol", "⬡");
  addEvm(all.ethereum, 1,   "Ethereum",        "eth", "⬡");
  addEvm(all.bsc,      56,  "BNB Smart Chain", "bnb", "⬡");

  if (all.btc) {
    const btcP = price("btc");
    const fv   = (Number(all.btc.confirmedSat) / 1e8) * btcP;
    const po   = prices?.btc as { eur: number; usd: number } | undefined;
    rows.push({
      chainId: 0, network: "Bitcoin",
      symbol: "BTC", icon: "₿", name: "Bitcoin",
      amount: all.btc.formatted,
      fiatValue: fv,
      fiatStr: po ? formatFiat(all.btc.confirmedSat, 8, po, currency) : null,
    });
  }

  // Phase 5: Spark Lightning balance (BTC-priced, contabilizzato separatamente da BTC on-chain)
  // chainId=-1 → riserva per Lightning (non corrisponde a nessuna EVM chain)
  // NON confondere con BTC on-chain (chainId=0)
  if (sparkSat != null) {
    const btcP = price("btc");
    const fv   = (Number(sparkSat) / 1e8) * btcP;
    const po   = prices?.btc as { eur: number; usd: number } | undefined;
    rows.push({
      chainId: -1, network: "Lightning",
      symbol: "BTC", icon: "⚡", name: "Bitcoin Lightning",
      amount: formatSatoshisToBtc(sparkSat),
      fiatValue: fv,
      fiatStr: po ? formatFiat(sparkSat, 8, po, currency) : null,
    });
  }

  // Ordina per valore fiat decrescente
  rows.sort((a, b) => b.fiatValue - a.fiatValue);

  const partialCount = failedChains + (sparkOffline ? 1 : 0);

  const isPartial   = !loading && partialCount > 0;
  const totalRaw    = loading ? null : calcPortfolioTotal(all, prices, fiatKey, sparkSat);
  const totalFmt    = totalRaw !== null ? fmtPortfolioTotal(totalRaw, currency) : null;
  const activeChains = [all.polygon, all.ethereum, all.bsc, all.btc].filter(Boolean).length
    + (sparkSat != null ? 1 : 0);

  return (
    <div className="aw-portfolio-view">
      {/* Header totale */}
      <div className="aw-portfolio-view-header">
        <div className="aw-portfolio-view-label">Tutti gli asset</div>
        <div className={`aw-portfolio-view-total ${loading ? "aw-portfolio-total-loading" : ""}`}>
          {loading ? "Caricamento…" : (totalFmt ? `≈ ${totalFmt}` : "—")}
        </div>
        <div className="aw-portfolio-view-meta">
          {loading
            ? "…"
            : isPartial
              ? `${activeChains} chain disponibili · ${failedChains} non raggiungibili`
              : `${activeChains} chain · ${rows.length} asset`}
        </div>
        {isPartial && (
          <div className="aw-portfolio-partial-warn">
            ⚠️ Dati parziali —{" "}
            {failedChains > 0
              ? `${failedChains} chain ${failedChains === 1 ? "non ha risposto" : "non hanno risposto"}${sparkOffline ? " · Lightning non disponibile" : ""}`
              : "Lightning non disponibile"
            }. Il totale potrebbe essere incompleto.
          </div>
        )}
        {sparkLoading && (
          <div className="aw-portfolio-partial-warn" style={{ color: "rgba(255,255,255,0.5)" }}>
            ⚡ Caricamento saldo Lightning…
          </div>
        )}
      </div>

      {/* Lista asset */}
      <div className="aw-portfolio-asset-list">
        {loading && rows.length === 0
          ? [1, 2, 3, 4].map(i => (
              <div key={i} className="aw-asset-item aw-asset-item--skeleton">
                <div className="aw-asset-icon">⬡</div>
                <div className="aw-asset-info"><div className="aw-skeleton-line" style={{ width: 120, height: 14 }} /></div>
                <div className="aw-asset-balance">…</div>
              </div>
            ))
          : rows.map((row, i) => (
              <button
                key={`${row.chainId}-${row.symbol}-${i}`}
                className="aw-portfolio-asset-item"
                onClick={() => onSelectChain(row.chainId)}
                aria-label={`Vai a ${row.network}`}
              >
                <div className="aw-portfolio-asset-icon">{row.icon}</div>
                <div className="aw-portfolio-asset-info">
                  <div className="aw-portfolio-asset-symbol">{row.symbol}</div>
                  <div className="aw-portfolio-asset-network">{row.network}</div>
                </div>
                <div className="aw-portfolio-asset-amounts">
                  <div className="aw-portfolio-asset-amount">{row.amount}</div>
                  {row.fiatStr && <div className="aw-portfolio-asset-fiat">{row.fiatStr}</div>}
                </div>
                <span className="aw-portfolio-asset-chevron">›</span>
              </button>
            ))
        }
      </div>
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

  // Escludi i token nativi (contractAddress null/undefined) — già mostrati nella sezione dedicata sopra
  const allTokenDefs = [...verifiedTokens, ...wallet.customTokens].filter(t => t.contractAddress != null);

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

// ─── BOLT11 expiry decoder ────────────────────────────────────────────────────
// Decodifica il BOLT11 con @scure/base (bech32) per ricavare il timestamp di
// scadenza esatto: timestamp_creazione (35 bit) + tag type-6 expiry (default 3600 s).
// Nessun dato sensibile viene loggato — solo hasBolt11 e la durata.
async function parseBolt11Expiry(bolt11: string): Promise<number> {
  try {
    const { bech32 } = await import("@scure/base");
    const { words } = bech32.decode(bolt11, 2000);
    // Prime 7 words (5 bit × 7 = 35 bit) → Unix timestamp di creazione invoice
    let timestamp = 0;
    for (let i = 0; i < 7; i++) timestamp = timestamp * 32 + (words[i] & 0x1f);
    // Scan tag: skippa firma (ultimi 104 words = 520 bit = 65 byte)
    let expirySecs = 3600; // default per spec BOLT11
    let pos = 7;
    const tagEnd = words.length - 104;
    while (pos + 2 < tagEnd) {
      const tagType = words[pos] & 0x1f;
      const tagLen  = (words[pos + 1] & 0x1f) * 32 + (words[pos + 2] & 0x1f);
      pos += 3;
      if (tagType === 6 && tagLen > 0) {        // tag 6 = expiry
        let e = 0;
        for (let i = 0; i < tagLen; i++) e = e * 32 + (words[pos + i] & 0x1f);
        expirySecs = e;
        break;
      }
      pos += tagLen;
    }
    return (timestamp + expirySecs) * 1000;     // ms UTC
  } catch {
    return Date.now() + 3600 * 1000;            // fallback: 1 ora da ora
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// RECEIVE VIEW (Phase C)
// ═══════════════════════════════════════════════════════════════════════════

function ReceiveView({ onBack: _onBack }: { onBack: () => void }) {
  const wallet      = useWallet();
  const meta        = wallet.meta!;
  const isBtc       = wallet.selectedChainId === 0;
  const isLightning = wallet.selectedChainId === -1;
  const net         = getNetworkByChainId(wallet.selectedChainId);
  const address     = isLightning ? "" : isBtc ? meta.btcAddress : meta.evmAddress;
  const networkLabel = isLightning
    ? "⚡ Bitcoin Lightning"
    : isBtc
      ? "Bitcoin · Native SegWit"
      : (net?.name ?? `Chain ${wallet.selectedChainId}`);

  // Spark context per la generazione di invoice Lightning
  const spark = useSparkWalletOptional();

  // Stato on-chain receive (BTC / EVM)
  const [copied,    setCopied]    = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string>("");

  // Stato Lightning receive — tutti gli hook devono essere chiamati incondizionatamente
  const [lnAmountStr,  setLnAmountStr]  = useState("");
  const [lnInputMode,  setLnInputMode]  = useState<"btc" | "eur" | "usd">("btc");
  const [lnPrices,     setLnPrices]     = useState<AssetPrices | null>(null);
  const [lnInvoice,    setLnInvoice]    = useState<string | null>(null);
  const [lnInvoiceErr, setLnInvoiceErr] = useState<string | null>(null);
  const [lnExpiry,     setLnExpiry]     = useState<number | null>(null);   // ms UTC
  const [lnExpired,    setLnExpired]    = useState(false);
  const [lnCountdown,  setLnCountdown]  = useState<number | null>(null);   // secondi rimasti
  const [lnLoading,            setLnLoading]            = useState(false);
  const [lnQrUrl,              setLnQrUrl]              = useState<string>("");
  const [lnCopied,             setLnCopied]             = useState(false);
  const [lnShareLoading,       setLnShareLoading]       = useState(false);
  // Persistenza storico Lightning
  const [lnTxId,               setLnTxId]               = useState<string | null>(null);
  const [lnPaid,               setLnPaid]               = useState(false);
  const [lnGeneratedAmountSat, setLnGeneratedAmountSat] = useState<bigint | null>(null);

  // Fetch prezzi BTC solo per Lightning (per conversione EUR/USD → sat)
  useEffect(() => {
    if (!isLightning) return;
    fetchPrices().then(setLnPrices).catch(() => {});
  }, [isLightning]);

  // Countdown live: aggiorna ogni secondo finché lnExpiry è impostato
  useEffect(() => {
    if (!lnExpiry) { setLnCountdown(null); setLnExpired(false); return; }
    const tick = () => {
      const secs = Math.floor((lnExpiry - Date.now()) / 1000);
      if (secs <= 0) { setLnCountdown(0); setLnExpired(true); }
      else { setLnCountdown(secs); setLnExpired(false); }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [lnExpiry]);

  // Quando la invoice scade → aggiorna stato IDB (fire-and-forget, best-effort)
  useEffect(() => {
    if (!lnExpired || !lnTxId || lnPaid) return;
    void updateLightningTx(lnTxId, { status: "expired" }).catch(() => {});
  }, [lnExpired, lnTxId, lnPaid]);

  // Polling 15s per rilevare il pagamento della invoice corrente
  // Usa subscribeToEvents (SDK real-time) + fallback listPayments
  useEffect(() => {
    if (!lnInvoice || !spark || spark.state !== "connected" || lnPaid || lnExpired) return;
    let cancelled = false;

    // Event-based detection (real-time via SDK addEventListener)
    const unsub = spark.subscribeToEvents(async ev => {
      if (ev.type === "paymentSucceeded" && ev.bolt11 === lnInvoice && !cancelled) {
        setLnPaid(true);
        if (lnTxId) {
          await updateLightningTx(lnTxId, {
            status:    "paid",
            paymentId: ev.paymentId,
            paidAt:    Date.now(),
          }).catch(() => {});
        }
        await spark.syncWallet().catch(() => {});
      }
    });

    // Polling 15s — fallback: cattura pagamenti avvenuti offline
    const pollOnce = async () => {
      if (cancelled || lnPaid) return;
      try {
        const payments = await spark.listPayments({ limit: 30 });
        const match = payments.find(p => p.bolt11 === lnInvoice && p.status === "completed");
        if (match && !cancelled) {
          setLnPaid(true);
          if (lnTxId) {
            await updateLightningTx(lnTxId, {
              status:    "paid",
              paymentId: match.id,
              paidAt:    Date.now(),
            }).catch(() => {});
          }
          await spark.syncWallet().catch(() => {});
        }
      } catch { /* rete non disponibile — silenzioso */ }
    };

    void pollOnce();
    const pollId = setInterval(() => void pollOnce(), 15_000);

    return () => {
      cancelled = true;
      clearInterval(pollId);
      unsub();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lnInvoice, spark?.state, lnPaid, lnExpired, lnTxId]);

  // QR on-chain (skippato per Lightning: nessun indirizzo)
  useEffect(() => {
    if (isLightning || !address) return;
    let cancelled = false;
    import("qrcode").then(mod =>
      mod.toDataURL(address, {
        width: 240,
        margin: 2,
        errorCorrectionLevel: "M",
        color: { dark: "#111111", light: "#ffffff" },
      })
    ).then(url => { if (!cancelled) setQrDataUrl(url); })
     .catch(() => {});
    return () => { cancelled = true; };
  }, [address, isLightning]);

  const copy = () =>
    void navigator.clipboard.writeText(address).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    });

  /**
   * Converte l'importo inserito (BTC, EUR o USD) in satoshi.
   * Restituisce null se vuoto, non numerico o prezzi assenti per fiat.
   */
  const computeLnSat = (): bigint | null => {
    const raw = lnAmountStr.trim().replace(",", ".");
    if (!raw) return null;
    const num = parseFloat(raw);
    if (isNaN(num) || num <= 0) return null;
    if (lnInputMode === "btc") {
      const sat = Math.round(num * 1e8);
      return sat > 0 ? BigInt(sat) : null;
    }
    // EUR / USD → sat tramite prezzo BTC corrente
    const btcPriceObj = lnPrices?.btc as { eur: number; usd: number } | undefined;
    const btcPrice = btcPriceObj?.[lnInputMode];
    if (!btcPrice || btcPrice <= 0) return null;
    const sat = Math.round((num / btcPrice) * 1e8);
    return sat > 0 ? BigInt(sat) : null;
  };

  /** Genera BOLT11 invoice via Spark SDK — non richiede saldo preesistente */
  const generateInvoice = async () => {
    if (!spark || spark.state !== "connected") {
      setLnInvoiceErr("Spark non connesso. Torna al wallet e attendi la connessione Lightning.");
      return;
    }
    setLnLoading(true);
    setLnInvoiceErr(null);
    setLnInvoice(null);
    setLnQrUrl("");
    try {
      const amountSat = computeLnSat() ?? undefined;
      const result = await spark.createReceiveInvoice({
        method:      "bolt11",
        amountSat,
        description: "Alpha Wallet",
        expirySecs:  3600, // 1 ora — il default SDK è ~30 giorni
      });
      if (!result.bolt11) throw new Error("L'SDK non ha restituito una invoice BOLT11.");
      setLnInvoice(result.bolt11);
      // Decodifica BOLT11 per ricavare scadenza reale (tag type-6 + timestamp creazione)
      // ReceivePaymentResponse non espone expiresAt → unica fonte affidabile è il payload
      const expMs = await parseBolt11Expiry(result.bolt11);
      setLnExpiry(expMs);
      // QR uppercase per maggiore compatibilità con i scanner Lightning
      const mod = await import("qrcode");
      const url = await mod.toDataURL(result.bolt11.toUpperCase(), {
        width: 240, margin: 2, errorCorrectionLevel: "M",
        color: { dark: "#111111", light: "#ffffff" },
      });
      setLnQrUrl(url);
      // ── Persistenza immediata nello storico Lightning ──────────────────────
      // Invoice salvata PRIMA che l'utente possa premere Indietro.
      const txId = `ln-rx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const btcPriceObj = lnPrices?.btc as Record<string, number> | undefined;
      void saveLightningTx({
        id:                  txId,
        direction:           "receive",
        status:              "pending",
        amountSat:           amountSat !== undefined ? Number(amountSat) : 0,
        fiatAmount:          lnInputMode !== "btc" ? (parseFloat(lnAmountStr) || undefined) : undefined,
        fiatCurrency:        lnInputMode.toUpperCase() as "BTC" | "EUR" | "USD",
        btcPriceAtCreation:  btcPriceObj?.[lnInputMode] ?? undefined,
        bolt11:              result.bolt11,
        createdAt:           Date.now(),
        expiresAt:           expMs,
        updatedAt:           Date.now(),
      }).catch(() => {});
      setLnTxId(txId);
      setLnGeneratedAmountSat(amountSat ?? 0n);
    } catch (e) {
      setLnInvoiceErr(e instanceof Error ? e.message : "Errore nella creazione dell'invoice Lightning.");
    } finally {
      setLnLoading(false);
    }
  };

  // ── Lightning Receive ──────────────────────────────────────────────────────
  if (isLightning) {
    // Preview live: sat calcolati dall'importo corrente
    const previewSat   = computeLnSat();
    const previewBtc   = previewSat !== null ? (Number(previewSat) / 1e8).toFixed(8) : null;
    const btcPriceObj  = lnPrices?.btc as { eur: number; usd: number } | undefined;
    const inputSymbol  = lnInputMode === "btc" ? "BTC" : lnInputMode === "eur" ? "€" : "$";
    const fiatNeeds    = lnInputMode !== "btc" && !btcPriceObj;

    return (
      <div className="aw-receive">
        <p className="aw-receive-network-label">{networkLabel}</p>
        {!lnInvoice ? (
          <>
            {/* ── Selettore valuta ── */}
            <label className="aw-label">Importo richiesto (facoltativo)</label>
            <div className="aw-amount-mode-toggle" style={{ marginBottom: 8 }}>
              {(["btc", "eur", "usd"] as const).map(mode => (
                <button
                  key={mode}
                  type="button"
                  className={`aw-mode-pill${lnInputMode === mode ? " aw-mode-pill--active" : ""}`}
                  onClick={() => { setLnInputMode(mode); setLnAmountStr(""); setLnInvoiceErr(null); }}
                  disabled={mode !== "btc" && !btcPriceObj}
                  title={mode !== "btc" && !btcPriceObj ? "Prezzi non disponibili" : undefined}>
                  {mode === "btc" ? "BTC" : mode === "eur" ? "€ EUR" : "$ USD"}
                </button>
              ))}
            </div>

            {/* ── Campo importo ── */}
            <div className="aw-amount-row">
              {lnInputMode !== "btc" && (
                <span className="aw-amount-symbol" style={{ minWidth: 20, color: "rgba(255,255,255,.6)" }}>
                  {lnInputMode === "eur" ? "€" : "$"}
                </span>
              )}
              <input
                type="text"
                inputMode="decimal"
                className="aw-input aw-input--amount"
                value={lnAmountStr}
                onChange={e => { setLnAmountStr(e.target.value.replace(",", ".")); setLnInvoiceErr(null); }}
                placeholder={lnInputMode === "btc" ? "0.001  (vuoto = any amount)" : "0.00"}
                autoComplete="off"
              />
              {lnInputMode === "btc" && (
                <span className="aw-amount-symbol">BTC</span>
              )}
            </div>

            {/* ── Preview conversione in tempo reale ── */}
            {previewSat !== null && previewBtc !== null && (
              <div className="aw-amount-fiat" style={{ margin: "4px 0 2px" }}>
                {lnInputMode === "btc"
                  ? `≈ ${Number(previewSat).toLocaleString()} sat`
                  : `≈ ${previewBtc} BTC · ${Number(previewSat).toLocaleString()} sat`}
              </div>
            )}
            {fiatNeeds && (
              <div className="aw-sub" style={{ fontSize: "0.78rem", color: "rgba(255,200,0,.8)" }}>
                Prezzi non disponibili — seleziona BTC.
              </div>
            )}

            {/* ── Riepilogo pre-conferma ── */}
            {previewSat !== null && (
              <div style={{
                margin: "10px 0 4px",
                padding: "10px 12px",
                background: "rgba(255,255,255,0.06)",
                borderRadius: 10,
                fontSize: "0.82rem",
                lineHeight: 1.6,
              }}>
                <div><strong>Richiesta:</strong> {lnAmountStr} {inputSymbol}</div>
                <div><strong>Invoice per:</strong> {previewBtc} BTC ({Number(previewSat).toLocaleString()} sat)</div>
                {lnInputMode !== "btc" && btcPriceObj && (
                  <div style={{ color: "rgba(255,255,255,.5)", fontSize: "0.76rem" }}>
                    Prezzo BTC usato:{" "}
                    {lnInputMode === "eur"
                      ? `€ ${btcPriceObj.eur.toLocaleString("it-IT")}`
                      : `$ ${btcPriceObj.usd.toLocaleString("en-US")}`}
                  </div>
                )}
              </div>
            )}

            <p className="aw-receive-hint" style={{ marginTop: 6 }}>
              Lascia l'importo vuoto per un invoice «any amount». Ricevere Lightning non richiede fondi preesistenti.
            </p>
            {lnInvoiceErr && <div className="aw-error">{lnInvoiceErr}</div>}
            <button
              className="aw-btn aw-btn--primary"
              onClick={generateInvoice}
              disabled={lnLoading}
              style={{ width: "100%", marginTop: 12 }}>
              {lnLoading ? "Generazione…" : "⚡ Genera invoice Lightning"}
            </button>
          </>
        ) : lnPaid ? (
          /* ── Invoice pagata ──────────────────────────────────────────── */
          <>
            <div style={{ textAlign: "center", margin: "24px 0 8px", fontSize: "3.2rem", lineHeight: 1 }}>
              ⚡✅
            </div>
            <div style={{ textAlign: "center", fontWeight: 700, fontSize: "1.05rem", margin: "0 0 6px" }}>
              Invoice pagata!
            </div>
            <div style={{ textAlign: "center", color: "rgba(255,255,255,.65)", fontSize: "0.85rem", marginBottom: 20 }}>
              {lnGeneratedAmountSat && lnGeneratedAmountSat > 0n
                ? `${Number(lnGeneratedAmountSat).toLocaleString("it-IT")} sat ricevuti`
                : "Pagamento ricevuto con successo"}
            </div>
            <button
              className="aw-btn aw-btn--secondary"
              style={{ width: "100%", marginTop: 4 }}
              onClick={() => {
                setLnInvoice(null); setLnQrUrl(""); setLnCopied(false);
                setLnExpiry(null); setLnExpired(false); setLnCountdown(null);
                setLnAmountStr(""); setLnInvoiceErr(null);
                setLnTxId(null); setLnPaid(false); setLnGeneratedAmountSat(null);
              }}>
              ↻ Nuova invoice
            </button>
          </>
        ) : (
          <>
            {/* ── Branding header Alpha Wallet ─────────────────────────────── */}
            <div style={{
              display: "flex", flexDirection: "column", alignItems: "center",
              gap: 4, margin: "2px 0 10px",
            }}>
              <img
                src="/logo.png"
                alt="Alpha Wallet"
                style={{ width: 44, height: 44, borderRadius: 10, boxShadow: "0 2px 8px rgba(0,0,0,.35)" }}
                draggable={false}
              />
              <div style={{ fontWeight: 700, fontSize: "0.97rem", letterSpacing: "0.01em", lineHeight: 1.2 }}>
                Alpha Wallet
              </div>
              <div style={{ fontSize: "0.75rem", color: "rgba(255,255,255,.5)", letterSpacing: "0.04em", textTransform: "uppercase" }}>
                ⚡ Bitcoin Lightning
              </div>
            </div>

            {/* ── Importo richiesto ─────────────────────────────────────────── */}
            {lnGeneratedAmountSat !== null && lnGeneratedAmountSat > 0n && (() => {
              const sat = Number(lnGeneratedAmountSat);
              const btc = (sat / 1e8).toFixed(8);
              const satFmt = sat.toLocaleString("it-IT");
              return (
                <div style={{
                  textAlign: "center",
                  margin: "0 0 8px",
                  padding: "8px 12px",
                  background: "rgba(255,255,255,0.07)",
                  borderRadius: 10,
                  opacity: lnExpired ? 0.5 : 1,
                }}>
                  {lnInputMode !== "btc" && lnAmountStr && (
                    <div style={{ fontWeight: 700, fontSize: "1.05rem" }}>
                      {lnInputMode === "eur" ? "€" : "$"}{" "}
                      {parseFloat(lnAmountStr).toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                  )}
                  <div style={{ fontSize: "0.82rem", color: "rgba(255,255,255,.65)" }}>
                    {btc} BTC · {satFmt} sat
                  </div>
                </div>
              );
            })()}

            {/* ── QR (sempre visibile anche dopo scadenza, per consultazione) ── */}
            {lnQrUrl && (
              <div className="aw-receive-qr-card" style={lnExpired ? { opacity: 0.4 } : {}}>
                <img src={lnQrUrl} alt="Lightning invoice QR" className="aw-receive-qr-img" />
              </div>
            )}

            {/* ── Countdown / Scaduta ── */}
            {lnCountdown !== null && (() => {
              const isWarn = !lnExpired && lnCountdown < 3600;
              const fmtSecs = (s: number) => {
                if (s <= 0) return "scaduta";
                if (s < 60) return `${s}s`;
                if (s < 3600) { const m = Math.floor(s / 60), r = s % 60; return `${m}:${String(r).padStart(2, "0")}`; }
                if (s < 86400) { const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return `${h}h ${m}m`; }
                const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600); return `${d}g ${h}h`;
              };
              return (
                <div style={{
                  textAlign: "center",
                  margin: "8px 0 4px",
                  fontSize: "0.88rem",
                  fontVariantNumeric: "tabular-nums",
                  fontWeight: lnExpired || isWarn ? 600 : 400,
                  color: lnExpired ? "#ff4d4d" : isWarn ? "#ffaa00" : "rgba(255,255,255,.7)",
                  letterSpacing: "0.02em",
                }}>
                  {lnExpired
                    ? "🔴 Invoice scaduta — non deve più essere pagata"
                    : `⏱ Scade tra ${fmtSecs(lnCountdown)}`}
                </div>
              );
            })()}

            {/* ── BOLT11 testuale ── */}
            <div className="aw-receive-addr-box" style={lnExpired ? { opacity: 0.4 } : {}}>
              <span className="aw-receive-addr-text"
                style={{ fontSize: "0.7rem", wordBreak: "break-all", letterSpacing: 0 }}>
                {lnInvoice}
              </span>
            </div>

            {/* ── Azioni: Copia + Condividi ── */}
            {!lnExpired && (
              <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                {/* Copia BOLT11 — copia ESCLUSIVAMENTE la stringa BOLT11, nessun branding */}
                <button
                  className={`aw-receive-copy-btn${lnCopied ? " copied" : ""}`}
                  style={{ flex: 1 }}
                  onClick={() =>
                    void navigator.clipboard.writeText(lnInvoice!).then(() => {
                      setLnCopied(true);
                      setTimeout(() => setLnCopied(false), 3000);
                    })
                  }
                  aria-label={lnCopied ? "Invoice copiata" : "Copia invoice Lightning"}>
                  {lnCopied ? "✅ Copiata!" : "📋 Copia invoice"}
                </button>

                {/* Condividi — crea deep link opaque per questa invoice, poi Web Share API */}
                <button
                  className="aw-receive-copy-btn"
                  style={{ flex: 1, opacity: lnShareLoading ? 0.6 : 1 }}
                  disabled={lnShareLoading}
                  onClick={async () => {
                    if (lnShareLoading || !lnInvoice) return;
                    setLnShareLoading(true);

                    const sat      = lnGeneratedAmountSat !== null && lnGeneratedAmountSat > 0n
                                       ? Number(lnGeneratedAmountSat)
                                       : null;
                    const satFmt   = sat !== null ? sat.toLocaleString("it-IT") : null;
                    const btcFmt   = sat !== null ? (sat / 1e8).toFixed(8) : null;
                    const expSec   = lnExpiry !== null
                                       ? Math.floor(lnExpiry / 1000)
                                       : Math.floor(Date.now() / 1000) + 3600;

                    // Riga importo: costruita in base alla valuta scelta
                    let amountLine = "";
                    if (sat && sat > 0) {
                      if (lnInputMode !== "btc" && lnAmountStr) {
                        const sym     = lnInputMode === "eur" ? "€" : "$";
                        const fiatFmt = parseFloat(lnAmountStr).toLocaleString("it-IT", {
                          minimumFractionDigits: 2, maximumFractionDigits: 2,
                        });
                        amountLine = `Importo: ${sym} ${fiatFmt}\n${satFmt} sat · ${btcFmt} BTC`;
                      } else if (btcFmt) {
                        amountLine = `Importo: ${btcFmt} BTC · ${satFmt} sat`;
                      }
                    }

                    const shareTitle = "Alpha Wallet — Richiesta Bitcoin Lightning";
                    let invoiceLink  = "https://alphachat.sbs";

                    try {
                      // Crea link opaque per questa invoice specifica (nessun userId esposto)
                      const { invoiceId } = await apiCreateLightningInvoiceLink({
                        bolt11:    lnInvoice,
                        amountSat: sat,
                        expiresAt: expSec,
                      });
                      invoiceLink = `https://alphachat.sbs/pay/lightning/${invoiceId}`;
                    } catch {
                      // Fallback silenzioso: usiamo alphachat.sbs generico
                    }

                    const shareText = [
                      "⚡ Alpha Wallet",
                      "",
                      "Richiesta pagamento Bitcoin Lightning",
                      ...(amountLine ? ["", amountLine] : []),
                      "",
                      "👉 Paga con Bitcoin Lightning:",
                      invoiceLink,
                    ].join("\n");

                    if (typeof navigator.share === "function") {
                      await navigator.share({ title: shareTitle, text: shareText })
                        .catch(() => { /* utente ha annullato */ });
                    } else {
                      // Fallback: copia il testo con il link e mostra toast
                      await navigator.clipboard.writeText(shareText).then(() => {
                        setLnCopied(true);
                        setTimeout(() => setLnCopied(false), 3000);
                      });
                    }

                    setLnShareLoading(false);
                  }}
                  aria-label="Condividi invoice Lightning">
                  {lnShareLoading ? "…" : "↗ Condividi"}
                </button>
              </div>
            )}

            <button
              className="aw-btn aw-btn--secondary"
              style={{ width: "100%", marginTop: 8 }}
              onClick={() => {
                setLnInvoice(null); setLnQrUrl(""); setLnCopied(false);
                setLnExpiry(null); setLnExpired(false); setLnCountdown(null);
                setLnAmountStr(""); setLnInvoiceErr(null);
                setLnTxId(null); setLnPaid(false); setLnGeneratedAmountSat(null);
              }}>
              ↻ Nuova invoice
            </button>

            {/* ── URL branding sotto il pulsante ── */}
            <div style={{
              textAlign: "center",
              marginTop: 14,
              fontSize: "0.78rem",
              fontWeight: 600,
              color: "rgba(255,255,255,.62)",
              letterSpacing: "0.04em",
              userSelect: "none",
            }}>
              alphachat.sbs
            </div>
          </>
        )}
      </div>
    );
  }

  // ── On-chain Receive (BTC / EVM) ───────────────────────────────────────────
  return (
    <div className="aw-receive">

      {/* Rete */}
      <p className="aw-receive-network-label">{networkLabel}</p>

      {/* Card bianca con QR */}
      <div className="aw-receive-qr-card">
        {qrDataUrl
          ? <img src={qrDataUrl} alt={`QR ${address}`} className="aw-receive-qr-img" />
          : <div className="aw-receive-qr-skeleton" aria-hidden="true" />
        }
      </div>

      {/* Indirizzo testuale */}
      <div className="aw-receive-addr-box">
        <span className="aw-receive-addr-text">{address}</span>
      </div>

      {/* Unico bottone — Copia indirizzo */}
      <button
        className={`aw-receive-copy-btn${copied ? " copied" : ""}`}
        onClick={copy}
        aria-label={copied ? "Indirizzo copiato" : "Copia indirizzo"}
      >
        {copied ? "✅  Copiato!" : "📋  Copia indirizzo"}
      </button>

      {/* Hint minimo */}
      <p className="aw-receive-hint">
        Invia solo asset {isBtc ? "BTC (mainnet)" : `compatibili con ${net?.name ?? "questa rete"}`} a questo indirizzo.
      </p>

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

/**
 * Converte la stringa digitata dall'utente in bigint nativo per la transazione.
 * - inputMode "crypto": parsing diretto
 * - inputMode "eur"/"usd": converti fiat → crypto usando il prezzo corrente
 */
function resolveRaw(
  amountStr: string,
  inputMode: "crypto" | "eur" | "usd",
  decimals: number,
  prices: AssetPrices | null,
  symbol: string,
): bigint | null {
  if (!amountStr.trim()) return null;
  if (inputMode === "crypto") return parseAmount(amountStr, decimals);
  const priceObj = prices
    ? (prices[symbol.toLowerCase() as keyof AssetPrices] as { usd: number; eur: number } | undefined)
    : null;
  const price = priceObj?.[inputMode]; // "eur" | "usd"
  if (!price || price <= 0) return null;
  const fiatNum = parseFloat(amountStr.replace(",", "."));
  if (isNaN(fiatNum) || fiatNum <= 0) return null;
  const rawNum = Math.round((fiatNum / price) * 10 ** decimals);
  if (!isFinite(rawNum) || rawNum <= 0) return null;
  try { return BigInt(rawNum); } catch { return null; }
}

function SendView({ onBack, onSuccess }: { onBack: () => void; onSuccess: () => void }) {
  const wallet      = useWallet();
  const meta        = wallet.meta!;
  const chainId     = wallet.selectedChainId;
  const isBtc       = chainId === 0;
  const isLightning = chainId === -1;
  // Spark/Lightning context (null se spark_lightning_enabled=false)
  const spark = useSparkWalletOptional();

  // Balance data
  const [chainBalance, setChainBalance] = useState<ChainBalance | null>(null);
  const [btcBalance, setBtcBalance] = useState<BtcBalance | null>(null);
  const [prices, setPrices] = useState<AssetPrices | null>(null);
  const [balLoading, setBalLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      setBalLoading(true);
      try {
        if (isLightning) {
          // Lightning: saldo da Spark SDK (già in memoria), nessuna fetch blockchain.
          const p = await fetchPrices().catch(() => null);
          setPrices(p);
          return;
        }
        const [p] = await Promise.all([
          fetchPrices().catch(() => null),
          isBtc
            ? fetchBtcBalance(meta.btcAddress).then(setBtcBalance).catch(() => {})
            : fetchEvmBalance(
                chainId,
                meta.evmAddress as `0x${string}`,
                wallet.customTokens.filter(t => t.chainId === chainId),
              ).then(setChainBalance).catch(() => {}),
        ]);
        setPrices(p);
      } finally { setBalLoading(false); }
    })();
  }, [chainId, meta.evmAddress, meta.btcAddress, isBtc, isLightning, wallet.customTokens]);

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
  const [inputMode, setInputMode]       = useState<"crypto" | "eur" | "usd">("crypto");
  const [pendingRaw, setPendingRaw]     = useState<bigint | null>(null); // raw bigint confirmed in handleProceed
  const [recipientErr, setRecipientErr] = useState<string | null>(null);
  const [amountErr, setAmountErr]       = useState<string | null>(null);
  const [gasEst, setGasEst]             = useState<GasEstimate | null>(null);
  const [btcPreview, setBtcPreview]     = useState<(BtcSendPreview & { feeRate: number }) | null>(null);
  const [txHash, setTxHash]             = useState<string | null>(null);
  const [broadcastErr, setBroadcastErr] = useState<string | null>(null);
  const [pin, setPin]                   = useState("");
  const [pinErr, setPinErr]             = useState<string | null>(null);

  // Lightning-specific state (nessun EVM/BTC on-chain — Spark SDK)
  const [lnInvoice,      setLnInvoice]      = useState("");
  const [lnInvoiceErr,   setLnInvoiceErr]   = useState<string | null>(null);
  const [lnFeeBreakdown, setLnFeeBreakdown] = useState<SparkFeeBreakdown | null>(null);
  const [lnPaymentId,    setLnPaymentId]    = useState<string | null>(null);
  const lightningBalanceSat = isLightning ? (spark?.walletInfo?.balanceSat ?? null) : null;

  const selectedAsset = assets[assetIdx] ?? assets[0];

  const handleProceed = async () => {
    // ── Lightning ─────────────────────────────────────────────────────────────
    if (isLightning) {
      if (!lnInvoice.trim()) { setLnInvoiceErr("Inserisci un invoice Lightning (BOLT11)."); return; }
      setLnInvoiceErr(null);
      setStep("confirming-gas");
      try {
        const breakdown = await spark!.calculateSendFee({ paymentRequest: lnInvoice }, "fee_excluded");
        // Verifica saldo Lightning sufficiente
        if (lightningBalanceSat !== null && breakdown.totalDebitSat > lightningBalanceSat) {
          setLnInvoiceErr(
            `Saldo Lightning insufficiente. Necessari ${Number(breakdown.totalDebitSat)} sat, disponibili ${Number(lightningBalanceSat)} sat.`,
          );
          setStep("form");
          return;
        }
        setLnFeeBreakdown(breakdown);
        setStep("confirm");
      } catch (e) {
        setLnInvoiceErr(e instanceof Error ? e.message : "Errore nel calcolo fee Lightning.");
        setStep("form");
      }
      return;
    }
    // ── BTC / EVM ─────────────────────────────────────────────────────────────
    if (!selectedAsset) return;

    // Validate recipient
    const rErr = isBtc ? validateBtcAddress(recipient) : validateEvmRecipient(recipient);
    if (rErr) { setRecipientErr(rErr); return; }
    setRecipientErr(null);

    // Validate amount — supports crypto, EUR and USD input modes
    const raw = resolveRaw(amountStr, inputMode, selectedAsset.decimals, prices, selectedAsset.symbol);
    if (!raw || raw <= 0n) {
      setAmountErr(inputMode !== "crypto" && !prices
        ? "Prezzi non disponibili. Usa la modalità crypto."
        : "Importo non valido");
      return;
    }
    if (raw > selectedAsset.balance) { setAmountErr("Saldo insufficiente"); return; }
    setPendingRaw(raw); // store resolved bigint for handleSignAndSend
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
    // ── Lightning ─────────────────────────────────────────────────────────────
    if (isLightning) {
      setPinErr(null);
      setStep("processing");
      try {
        // Verifica PIN tramite keystore (conferma identità — Spark SDK gestisce i propri segreti)
        const keystore = await loadKeystore();
        if (keystore) {
          try { await decryptSeed(keystore, pin); }
          catch { setPin(""); setStep("auth"); setPinErr("PIN errato. Riprova."); return; }
        }
        const { result } = await spark!.send({ paymentRequest: lnInvoice }, lnFeeBreakdown!);
        setPin("");
        setLnPaymentId(result.paymentId);
        // ── Persistenza storico Lightning — invio ──────────────────────────
        void saveLightningTx({
          id:        `ln-tx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          direction: "send",
          status:    "paid",
          amountSat: Number(lnFeeBreakdown!.recipientAmountSat),
          bolt11:    lnInvoice ?? undefined,
          paymentId: result.paymentId,
          feeSat:    Number((lnFeeBreakdown!.estimatedProviderFeeSat ?? 0n) + (lnFeeBreakdown!.alphaPlatformFeeSat ?? 0n)),
          createdAt: Date.now(),
          paidAt:    Date.now(),
          updatedAt: Date.now(),
        }).catch(() => {});
        setStep("success");
      } catch (e) {
        setPin("");
        setBroadcastErr(e instanceof Error ? e.message : "Errore durante il pagamento Lightning.");
        setStep("error");
      }
      return;
    }
    // ── BTC / EVM ─────────────────────────────────────────────────────────────
    setPinErr(null);
    setStep("processing");
    // Use the raw value confirmed during handleProceed (already validated + converted from fiat if needed)
    const raw = pendingRaw ?? resolveRaw(amountStr, inputMode, selectedAsset.decimals, prices, selectedAsset.symbol)!;
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
  // Live-display raw: converts fiat→crypto using current prices so previews update in real time
  const raw = selectedAsset
    ? resolveRaw(amountStr, inputMode, selectedAsset.decimals, prices, selectedAsset.symbol)
    : null;

  // Render form step
  if (step === "form" || step === "confirming-gas") {
    // ── Lightning form ──────────────────────────────────────────────────────
    if (isLightning) {
      return (
        <div className="aw-send-form">
          <h2>Invia</h2>
          <div className="aw-send-network">⚡ Lightning</div>
          {lightningBalanceSat !== null && (
            <div className="aw-send-balance">
              Disponibile:{" "}
              <strong>{formatSatoshisToBtc(lightningBalanceSat)}</strong>
              {lightningBalanceSat === 0n && (
                <span style={{ color: "rgba(255,80,80,.9)", marginLeft: 8 }}>⚠️ Saldo insufficiente</span>
              )}
            </div>
          )}
          <label className="aw-label">Lightning invoice (BOLT11)</label>
          <textarea
            className={`aw-input${lnInvoiceErr ? " aw-input--error" : ""}`}
            style={{ minHeight: 90, fontFamily: "monospace", fontSize: "0.78rem", resize: "vertical" }}
            value={lnInvoice}
            onChange={e => { setLnInvoice(e.target.value.trim()); setLnInvoiceErr(null); }}
            placeholder="lnbc…"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
          />
          {lnInvoiceErr && <div className="aw-error">{lnInvoiceErr}</div>}
          <p className="aw-sub" style={{ fontSize: "0.78rem", margin: "4px 0 0" }}>
            Incolla un invoice BOLT11 generato dal destinatario.
            NON usare indirizzi BTC on-chain (bc1…) o EVM (0x…).
          </p>
          <div className="aw-btn-row">
            <button className="aw-btn aw-btn--secondary" onClick={onBack}>Annulla</button>
            <button className="aw-btn aw-btn--primary" onClick={handleProceed}
              disabled={step === "confirming-gas" || !lnInvoice.trim()}>
              {step === "confirming-gas" ? "Calcolo fee…" : "Rivedi →"}
            </button>
          </div>
        </div>
      );
    }
    // ── BTC / EVM form ──────────────────────────────────────────────────────
    return (
      <div className="aw-send-form">
        <h2>Invia</h2>
        <div className="aw-send-network">{netName}</div>

        {/* Asset selector */}
        {assets.length > 1 && (
          <>
            <label className="aw-label">Asset</label>
            <select className="aw-select" value={assetIdx} onChange={e => { setAssetIdx(Number(e.target.value)); setAmountStr(""); setAmountErr(null); setInputMode("crypto"); setPendingRaw(null); }}>
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

        {/* Amount — with native / EUR / USD toggle */}
        <label className="aw-label">Importo</label>

        {/* Mode pills */}
        <div className="aw-amount-mode-toggle">
          <button
            type="button"
            className={`aw-mode-pill${inputMode === "crypto" ? " aw-mode-pill--active" : ""}`}
            onClick={() => { setInputMode("crypto"); setAmountStr(""); setAmountErr(null); setPendingRaw(null); }}
          >
            {selectedAsset?.symbol ?? "Crypto"}
          </button>
          <button
            type="button"
            className={`aw-mode-pill${inputMode === "eur" ? " aw-mode-pill--active" : ""}`}
            onClick={() => { setInputMode("eur"); setAmountStr(""); setAmountErr(null); setPendingRaw(null); }}
            disabled={!prices}
            title={!prices ? "Prezzi non disponibili" : undefined}
          >
            EUR €
          </button>
          <button
            type="button"
            className={`aw-mode-pill${inputMode === "usd" ? " aw-mode-pill--active" : ""}`}
            onClick={() => { setInputMode("usd"); setAmountStr(""); setAmountErr(null); setPendingRaw(null); }}
            disabled={!prices}
            title={!prices ? "Prezzi non disponibili" : undefined}
          >
            USD $
          </button>
        </div>

        {/* Amount input */}
        <div className="aw-amount-row">
          {inputMode !== "crypto" && (
            <span className="aw-amount-symbol" style={{ minWidth: 20, color: "rgba(255,255,255,.6)" }}>
              {inputMode === "eur" ? "€" : "$"}
            </span>
          )}
          <input
            type="text"
            inputMode="decimal"
            className={`aw-input aw-input--amount ${amountErr ? "aw-input--error" : ""}`}
            value={amountStr}
            onChange={e => { setAmountStr(e.target.value.replace(",", ".")); setAmountErr(null); setPendingRaw(null); }}
            placeholder="0.00"
          />
          {inputMode === "crypto" && (
            <span className="aw-amount-symbol">{selectedAsset?.symbol}</span>
          )}
        </div>
        {amountErr && <div className="aw-error">{amountErr}</div>}

        {/* Conversion preview */}
        {raw && raw > 0n && prices && selectedAsset && (() => {
          const priceObj = getSymbolPrice(prices, selectedAsset.symbol);
          if (inputMode === "crypto") {
            // Mostra EUR + USD
            const eurStr = priceObj ? formatFiat(raw, selectedAsset.decimals, priceObj, "EUR") : null;
            const usdStr = priceObj ? formatFiat(raw, selectedAsset.decimals, priceObj, "USD") : null;
            const parts = [eurStr, usdStr].filter(s => s && s !== "—");
            return parts.length > 0 ? <div className="aw-amount-fiat">≈ {parts.join(" · ")}</div> : null;
          } else {
            // Mostra equivalente crypto
            const cryptoStr = formatCrypto(raw, selectedAsset.decimals, selectedAsset.symbol);
            return <div className="aw-amount-fiat">≈ {cryptoStr}</div>;
          }
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

  // ── Lightning confirm ───────────────────────────────────────────────────────
  if (step === "confirm" && isLightning && lnFeeBreakdown) {
    return (
      <div className="aw-send-confirm">
        <h2>Conferma pagamento Lightning</h2>
        <div className="aw-confirm-table">
          <div className="aw-confirm-row"><span>Rete</span><strong>⚡ Lightning</strong></div>
          <div className="aw-confirm-row">
            <span>Importo destinatario</span>
            <strong>{satToBtc(lnFeeBreakdown.recipientAmountSat)}</strong>
          </div>
          <div className="aw-confirm-row">
            <span>Fee routing (Spark)</span>
            <strong>{Number(lnFeeBreakdown.estimatedProviderFeeSat)} sat</strong>
          </div>
          <div className="aw-confirm-row">
            <span>Fee piattaforma Alpha</span>
            <strong>{Number(lnFeeBreakdown.alphaPlatformFeeSat)} sat</strong>
          </div>
          <div className="aw-confirm-row aw-confirm-row--total">
            <span>Totale addebitato</span>
            <strong>{satToBtc(lnFeeBreakdown.totalDebitSat)}</strong>
          </div>
        </div>
        {lnFeeBreakdown.quoteExpiresAt > 0 && (
          <p className="aw-sub" style={{ fontSize: "0.78rem", textAlign: "center" }}>
            ⏱ Quote valido fino alle {new Date(lnFeeBreakdown.quoteExpiresAt).toLocaleTimeString()}
          </p>
        )}
        <div className="aw-confirm-note">
          ⚠️ I pagamenti Lightning sono immediati e non reversibili. Verifica l'invoice prima di confermare.
        </div>
        <div className="aw-btn-row">
          <button className="aw-btn aw-btn--secondary" onClick={() => setStep("form")}>← Modifica</button>
          <button className="aw-btn aw-btn--primary" onClick={() => setStep("auth")}>Autorizza →</button>
        </div>
      </div>
    );
  }

  // ── BTC / EVM confirm ───────────────────────────────────────────────────────
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

  // ── Lightning success ────────────────────────────────────────────────────────
  if (step === "success" && isLightning) {
    return (
      <div className="aw-send-success">
        <div className="aw-send-success-icon">✅</div>
        <h2>Pagamento Lightning inviato!</h2>
        <p>Il pagamento è stato completato con successo.</p>
        {lnPaymentId && (
          <div className="aw-tx-hash-box">
            <div className="aw-tx-hash-label">Payment ID</div>
            <div className="aw-tx-hash" style={{ fontSize: "0.75rem", wordBreak: "break-all" }}>
              {lnPaymentId}
            </div>
          </div>
        )}
        <button className="aw-btn aw-btn--primary" onClick={onSuccess}>← Torna al wallet</button>
      </div>
    );
  }

  // ── BTC / EVM success ────────────────────────────────────────────────────────
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

type PinChangeStep =
  | "idle"
  | "verify-old" | "enter-new" | "confirm-new"          // Cambia PIN (vecchio PIN noto)
  | "reset-phrase" | "reset-pin-new" | "reset-pin-confirm"; // Reset PIN (via recovery phrase)

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
  const { walletFaceIdEnabled, setWalletFaceIdEnabled } = useWalletFaceId();
  const lock = useLock();
  const hasBiometricSet   = lock?.hasBiometricSet   ?? false;
  const canUseBiometric   = lock?.canUseBiometric   ?? false;
  // Il PIN è già in cache in sessionStorage se l'utente ha già sbloccato in questa sessione
  const hasPinCached = !!sessionStorage.getItem("aw_bio_pin");

  // ── Change PIN flow ──────────────────────────────────────────────────────
  const [pinStep, setPinStep] = useState<PinChangeStep>("idle");
  const [oldPin, setOldPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [pinError, setPinError] = useState<string | null>(null);
  const [pinLoading, setPinLoading] = useState(false);
  const [pinSuccess, setPinSuccess] = useState(false);

  // ── Reset PIN flow (via recovery phrase) ────────────────────────────────
  const [resetPhrase,      setResetPhrase]      = useState("");
  const [resetNewPin,      setResetNewPin]       = useState("");
  const [resetConfirmPin,  setResetConfirmPin]   = useState("");
  const [storedEvmAddr,    setStoredEvmAddr]     = useState<string | null>(null);

  const resetPinFlow = () => {
    setPinStep("idle");
    setOldPin(""); setNewPin(""); setConfirmPin("");
    setResetPhrase(""); setResetNewPin(""); setResetConfirmPin("");
    setPinError(null); setPinLoading(false);
  };

  /** Passo 1 Reset: valida la recovery phrase e carica l'indirizzo stored */
  const handleResetPhraseSubmit = async () => {
    const words = resetPhrase.trim().toLowerCase().replace(/\s+/g, " ");
    if (!isValidMnemonic(words)) {
      setPinError("Recovery phrase non valida. Controlla le 12 parole e riprova.");
      return;
    }
    setPinError(null);
    // Carica indirizzo wallet attuale per mostrarlo all'utente come riferimento
    const meta = await loadWalletMeta();
    setStoredEvmAddr(meta?.evmAddress ?? null);
    setResetPhrase(words); // normalizzata
    setPinStep("reset-pin-new");
  };

  /** Passo 2 Reset: valida il nuovo PIN */
  const handleResetPinNew = () => {
    const err = pinValidationError(resetNewPin);
    if (err) { setPinError(err); return; }
    setPinError(null);
    setPinStep("reset-pin-confirm");
  };

  /** Passo 3 Reset: conferma PIN e re-cifra il keystore con la phrase */
  const handleResetPinConfirm = async () => {
    if (resetConfirmPin !== resetNewPin) { setPinError("I PIN non corrispondono"); return; }
    setPinLoading(true); setPinError(null);
    try {
      await wallet.importWallet(resetPhrase, resetNewPin);
      setPinSuccess(true);
      setTimeout(() => { setPinSuccess(false); resetPinFlow(); }, 2500);
    } catch (e) {
      setPinError(e instanceof Error ? e.message : "Errore durante il reset del PIN");
    } finally {
      setPinLoading(false);
    }
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

      /* ── Reset PIN via recovery phrase ─────────────────────────────────── */
      case "reset-phrase":
        return (
          <div className="aw-settings-pin-flow">
            <p className="aw-sub" style={{ fontWeight: 600 }}>🔑 Reset PIN — Recovery phrase</p>
            <p className="aw-sub" style={{ fontSize: "0.8rem", opacity: 0.7 }}>
              Inserisci le 12 parole della recovery phrase nell'ordine corretto. Il wallet verrà
              re-cifrato con il nuovo PIN che sceglierai al passo successivo.
            </p>
            <textarea
              className="aw-input"
              rows={3}
              placeholder="parola1 parola2 parola3 … parola12"
              value={resetPhrase}
              onChange={e => { setResetPhrase(e.target.value); setPinError(null); }}
              autoComplete="off"
              spellCheck={false}
              style={{ resize: "none", fontFamily: "monospace", fontSize: "0.85rem" }}
            />
            {pinError && <div className="aw-error">{pinError}</div>}
            <div className="aw-btn-row">
              <button className="aw-btn aw-btn--secondary" onClick={resetPinFlow}>Annulla</button>
              <button
                className="aw-btn aw-btn--primary"
                onClick={handleResetPhraseSubmit}
                disabled={resetPhrase.trim().split(/\s+/).length < 12}
              >
                Avanti →
              </button>
            </div>
          </div>
        );

      case "reset-pin-new":
        return (
          <div className="aw-settings-pin-flow">
            <p className="aw-sub" style={{ fontWeight: 600 }}>🔑 Reset PIN — Nuovo PIN</p>
            {storedEvmAddr && (
              <div className="aw-settings-pin-addr-hint">
                🔍 Indirizzo wallet: <code>{storedEvmAddr.slice(0,8)}…{storedEvmAddr.slice(-6)}</code>
              </div>
            )}
            <p className="aw-sub" style={{ fontSize: "0.8rem", opacity: 0.7 }}>
              Scegli il nuovo PIN (minimo 6 cifre).
            </p>
            <input type="password" inputMode="numeric" className="aw-input aw-input--pin" value={resetNewPin}
              onChange={e => { setResetNewPin(e.target.value.replace(/\D/g, "")); setPinError(null); }}
              onKeyDown={e => e.key === "Enter" && handleResetPinNew()}
              maxLength={12} placeholder="••••••" autoFocus />
            {pinError && <div className="aw-error">{pinError}</div>}
            <div className="aw-btn-row">
              <button className="aw-btn aw-btn--secondary" onClick={resetPinFlow}>Annulla</button>
              <button className="aw-btn aw-btn--primary" onClick={handleResetPinNew} disabled={resetNewPin.length < 6}>
                Avanti →
              </button>
            </div>
          </div>
        );

      case "reset-pin-confirm":
        return (
          <div className="aw-settings-pin-flow">
            <p className="aw-sub" style={{ fontWeight: 600 }}>🔑 Reset PIN — Conferma</p>
            <input type="password" inputMode="numeric" className="aw-input aw-input--pin" value={resetConfirmPin}
              onChange={e => { setResetConfirmPin(e.target.value.replace(/\D/g, "")); setPinError(null); }}
              onKeyDown={e => e.key === "Enter" && void handleResetPinConfirm()}
              maxLength={12} placeholder="••••••" autoFocus />
            {pinError && <div className="aw-error">{pinError}</div>}
            <div className="aw-btn-row">
              <button className="aw-btn aw-btn--secondary" onClick={resetPinFlow}>Annulla</button>
              <button
                className="aw-btn aw-btn--primary"
                onClick={handleResetPinConfirm}
                disabled={pinLoading || resetConfirmPin.length < 6}
              >
                {pinLoading ? "Reset in corso…" : "Conferma e Salva →"}
              </button>
            </div>
          </div>
        );

      default:
        return (
          <>
            <button className="aw-settings-item" onClick={() => { resetPinFlow(); setPinStep("verify-old"); }}>
              <span className="aw-settings-item-icon">🔑</span>
              <span className="aw-settings-item-label">Cambia PIN</span>
              <span className="aw-settings-item-chevron">›</span>
            </button>
            <button className="aw-settings-item" onClick={() => { resetPinFlow(); setPinStep("reset-phrase"); }}>
              <span className="aw-settings-item-icon">🔓</span>
              <div style={{ flex: 1 }}>
                <div className="aw-settings-item-label">Reset PIN</div>
                <div className="aw-settings-item-hint">Hai dimenticato il PIN? Usa la recovery phrase</div>
              </div>
              <span className="aw-settings-item-chevron">›</span>
            </button>
          </>
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

        {/* Face ID wallet-specifico — mostra se il dispositivo supporta biometrica,
            se era già registrata, oppure se era già abilitata (flag persistito) */}
        {(canUseBiometric || hasBiometricSet || walletFaceIdEnabled) && (
          <div className="aw-settings-item aw-settings-item--row">
            <span className="aw-settings-item-icon">🫣</span>
            <div style={{ flex: 1 }}>
              <div className="aw-settings-item-label">Face ID / Touch ID</div>
              <div className="aw-settings-item-hint">
                {walletFaceIdEnabled && !hasPinCached
                  ? "Sblocca con PIN una volta per attivare"
                  : walletFaceIdEnabled
                  ? "Sblocco biometrico abilitato"
                  : "Sblocca il wallet con Face ID"}
              </div>
            </div>
            <label className="aw-toggle">
              <input
                type="checkbox"
                checked={walletFaceIdEnabled}
                onChange={e => {
                  const enabling = e.target.checked;
                  if (!enabling) {
                    // Disabilitazione: rimuovi sigillo e credenziale WebAuthn
                    clearSealedWalletPin();
                    lock?.disableBiometric();
                    setWalletFaceIdEnabled(false);
                    return;
                  }
                  // Abilitazione
                  setWalletFaceIdEnabled(true);
                  const pin = sessionStorage.getItem("aw_bio_pin");
                  if (pin && lock) {
                    // PIN disponibile in sessione → registra WebAuthn + sigilla subito
                    void (async () => {
                      try {
                        const ok = await lock.enableBiometric();
                        if (ok) await sealWalletPin(pin);
                      } catch { /* best-effort */ }
                    })();
                  }
                  // Se PIN non disponibile: il flag è settato, la registrazione
                  // avviene automaticamente al prossimo sblocco con PIN (unlockWithPin)
                }}
              />
              <span className="aw-toggle-track" />
            </label>
          </div>
        )}

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
// HISTORY VIEW (Phase F + Task 6 — storico on-chain + ⚡ Lightning)
// Due tab fissi sempre visibili indipendentemente dal chain selezionato.
// ═══════════════════════════════════════════════════════════════════════════

type TxFilter = "all" | "in" | "out" | "pending";

function HistoryView({ onBack }: { onBack: () => void }) {
  const wallet = useWallet();

  // Tab di primo livello: on-chain vs Lightning
  // Default: Lightning se il chain selezionato è -1, altrimenti on-chain
  const [mainTab, setMainTab] = useState<"onchain" | "lightning">(
    wallet.selectedChainId === -1 ? "lightning" : "onchain"
  );

  // ── On-chain state ──────────────────────────────────────────────────────
  const [filter,     setFilter]     = useState<TxFilter>("all");
  const [selectedTx, setSelectedTx] = useState<WalletTxRecord | null>(null);
  const [page,       setPage]       = useState(1);
  const PAGE_SIZE = 30;

  // ── Lightning state ─────────────────────────────────────────────────────
  const [lnHistory,    setLnHistory]    = useState<LightningTxRecord[]>([]);
  const [lnLoading,    setLnLoading]    = useState(false);
  const [selectedLnTx, setSelectedLnTx] = useState<LightningTxRecord | null>(null);
  const [lnFilter,     setLnFilter]     = useState<"all" | "receive" | "send">("all");

  // Carica on-chain sempre; carica Lightning al primo accesso al tab
  useEffect(() => { void wallet.refreshTxHistory(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (mainTab !== "lightning") return;
    setLnLoading(true);
    void listLightningTxs(200)
      .then(txs => {
        const now = Date.now();
        setLnHistory(txs.map(t =>
          t.status === "pending" && t.expiresAt && t.expiresAt < now
            ? { ...t, status: "expired" as const }
            : t
        ));
      })
      .catch(() => {})
      .finally(() => setLnLoading(false));
  }, [mainTab]);

  // ── Detail views (devono stare prima dei return early) ──────────────────
  if (selectedTx) {
    return <TxDetailView tx={selectedTx} onBack={() => setSelectedTx(null)} />;
  }
  if (selectedLnTx) {
    return <LightningTxDetailView
      tx={selectedLnTx}
      onBack={() => setSelectedLnTx(null)}
      onUpdated={updated => setSelectedLnTx(updated)}
    />;
  }

  // ── Tab switcher ────────────────────────────────────────────────────────
  const tabBar = (
    <div className="aw-history-filters" style={{ marginBottom: 4 }}>
      <button
        className={`aw-filter-chip ${mainTab === "onchain" ? "aw-filter-chip--active" : ""}`}
        onClick={() => setMainTab("onchain")}
      >
        🔗 On-chain
      </button>
      <button
        className={`aw-filter-chip ${mainTab === "lightning" ? "aw-filter-chip--active" : ""}`}
        onClick={() => setMainTab("lightning")}
      >
        ⚡ Lightning
      </button>
    </div>
  );

  // ── Lightning tab ───────────────────────────────────────────────────────
  if (mainTab === "lightning") {
    const lnFiltered = lnHistory.filter(t => {
      if (lnFilter === "all") return true;
      if (lnFilter === "receive") return t.direction === "receive";
      if (lnFilter === "send") return t.direction === "send";
      return true;
    });

    return (
      <div className="aw-history">
        {tabBar}
        <div className="aw-history-filters">
          {(["all", "receive", "send"] as const).map(f => (
            <button
              key={f}
              className={`aw-filter-chip ${lnFilter === f ? "aw-filter-chip--active" : ""}`}
              onClick={() => setLnFilter(f)}
            >
              {f === "all" ? "Tutto" : f === "receive" ? "💰 Ricevuto" : "📤 Inviato"}
            </button>
          ))}
        </div>

        {lnLoading ? (
          <div className="aw-history-empty">
            <div className="aw-spinner" style={{ margin: "32px auto" }} />
          </div>
        ) : lnFiltered.length === 0 ? (
          <div className="aw-history-empty">
            <div className="aw-history-empty-icon">⚡</div>
            <div className="aw-history-empty-title">Nessuna transazione Lightning</div>
            <p>Le invoice generate e i pagamenti inviati via Lightning appariranno qui.</p>
          </div>
        ) : (
          <div className="aw-history-list">
            {lnFiltered.map(tx => (
              <LightningTxListItem key={tx.id} tx={tx} onClick={() => setSelectedLnTx(tx)} />
            ))}
          </div>
        )}
      </div>
    );
  }

  // ── On-chain tab ────────────────────────────────────────────────────────
  const filtered = wallet.txHistory.filter(tx => {
    if (filter === "all") return true;
    if (filter === "in") return tx.direction === "in" && tx.status !== "pending";
    if (filter === "out") return tx.direction === "out" && tx.status !== "pending";
    if (filter === "pending") return tx.status === "pending";
    return true;
  });

  const visible = filtered.slice(0, page * PAGE_SIZE);
  const hasMore = visible.length < filtered.length;

  return (
    <div className="aw-history">
      {tabBar}
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

// ─── LightningTxListItem ─────────────────────────────────────────────────────

function LightningTxListItem({ tx, onClick }: { tx: LightningTxRecord; onClick: () => void }) {
  const isReceive = tx.direction === "receive";
  const isPaid    = tx.status === "paid";
  const isPending = tx.status === "pending";
  const isExpired = tx.status === "expired";
  const isFailed  = tx.status === "failed";

  const icon      = isReceive ? (isPaid ? "💰" : isExpired ? "⏰" : isFailed ? "❌" : "⏳")
                              : (isPaid ? "📤" : "❌");
  const iconClass = isPaid
    ? (isReceive ? "aw-tx-icon--in" : "aw-tx-icon--out")
    : isPending ? "aw-tx-icon--pending"
    : "aw-tx-icon--pending";

  const label     = isReceive
    ? (isPaid ? "Ricevuto ⚡" : isPending ? "In attesa" : isExpired ? "Scaduta" : "Fallita")
    : (isPaid ? "Inviato ⚡" : "Fallito");

  const amtSat    = tx.amountSat;
  const amtPrefix = isReceive ? "+" : "-";
  const amtClass  = isPaid
    ? (isReceive ? "aw-tx-amount--in" : "aw-tx-amount--out")
    : "aw-tx-amount--pending";

  const date    = new Date(tx.createdAt);
  const dateStr = date.toLocaleDateString("it-IT", { day: "2-digit", month: "short" });
  const timeStr = date.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });

  const amtDisplay = amtSat > 0
    ? `${amtPrefix}${amtSat.toLocaleString("it-IT")} sat`
    : isReceive ? "⚡ Qualsiasi" : "—";

  return (
    <div className="aw-tx-item" onClick={onClick} role="button" tabIndex={0}
      onKeyDown={e => e.key === "Enter" && onClick()}>
      <div className={`aw-tx-icon ${iconClass}`}>{icon}</div>
      <div className="aw-tx-body">
        <div className="aw-tx-title">
          {label}
          {isFailed  && <span className="aw-tx-status-badge aw-tx-status-badge--failed">Fallita</span>}
          {isPending && <span className="aw-tx-status-badge aw-tx-status-badge--pending">Pending</span>}
          {isExpired && <span className="aw-tx-status-badge aw-tx-status-badge--failed">Scaduta</span>}
        </div>
        <div className="aw-tx-meta">⚡ Lightning</div>
      </div>
      <div className="aw-tx-amount-col">
        <div className={`aw-tx-amount ${amtClass}`}>{amtDisplay}</div>
        <div className="aw-tx-date">{dateStr} {timeStr}</div>
      </div>
    </div>
  );
}

// ─── LightningTxDetailView ───────────────────────────────────────────────────

function LightningTxDetailView({
  tx,
  onBack,
  onUpdated,
}: {
  tx: LightningTxRecord;
  onBack: () => void;
  onUpdated: (updated: LightningTxRecord) => void;
}) {
  const isReceive = tx.direction === "receive";
  const isPaid    = tx.status === "paid";
  const isPending = tx.status === "pending";
  const isExpired = tx.status === "expired" || (isPending && !!tx.expiresAt && tx.expiresAt < Date.now());

  const [qrUrl,   setQrUrl]   = useState<string>("");
  const [copied,  setCopied]  = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);

  // Genera QR per invoice pending-receive
  useEffect(() => {
    if (!isReceive || !isPending || isExpired || !tx.bolt11) return;
    let cancelled = false;
    import("qrcode").then(mod =>
      mod.toDataURL(tx.bolt11!.toUpperCase(), {
        width: 220, margin: 2, errorCorrectionLevel: "M",
        color: { dark: "#111111", light: "#ffffff" },
      })
    ).then(url => { if (!cancelled) setQrUrl(url); }).catch(() => {});
    return () => { cancelled = true; };
  }, [tx.bolt11, isReceive, isPending, isExpired]);

  // Countdown per invoice pending (scadenza residua)
  useEffect(() => {
    if (!isPending || !tx.expiresAt || isExpired) return;
    const tick = () => {
      const secs = Math.floor((tx.expiresAt! - Date.now()) / 1000);
      setCountdown(secs <= 0 ? 0 : secs);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [tx.expiresAt, isPending, isExpired]);

  // Quando il countdown arriva a 0 → aggiorna record e notifica parent
  useEffect(() => {
    if (countdown !== 0 || isPaid) return;
    const updated = { ...tx, status: "expired" as const };
    void updateLightningTx(tx.id, { status: "expired" }).catch(() => {});
    onUpdated(updated);
  }, [countdown]); // eslint-disable-line react-hooks/exhaustive-deps

  const copyBolt11 = () => {
    if (!tx.bolt11) return;
    void navigator.clipboard.writeText(tx.bolt11)
      .then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  };

  const fmtSecs = (s: number) => {
    if (s <= 0) return "scaduta";
    if (s < 60) return `${s}s`;
    if (s < 3600) { const m = Math.floor(s / 60), r = s % 60; return `${m}:${String(r).padStart(2, "0")}`; }
    if (s < 86400) { const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return `${h}h ${m}m`; }
    const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600); return `${d}g ${h}h`;
  };

  const statusEmoji = isPaid ? "✅" : isExpired ? "⏰" : isPending ? "⏳" : "❌";
  const statusLabel = isPaid ? "Pagata" : isExpired ? "Scaduta" : isPending ? "In attesa di pagamento" : "Fallita";
  const dirLabel    = isReceive ? "Ricevuto" : "Inviato";
  const dateStr     = new Date(tx.createdAt).toLocaleString("it-IT", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });

  return (
    <div className="aw-tx-detail">
      <div className="aw-tx-detail-header">
        <button className="aw-back-btn" onClick={onBack} aria-label="Indietro">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="20" height="20">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
        </button>
        <h2>Dettaglio ⚡ Lightning</h2>
      </div>

      <div className="aw-tx-detail-icon">{statusEmoji}</div>

      <div className="aw-tx-detail-amount">
        <div className={`aw-tx-detail-amount-value ${isReceive && isPaid ? "aw-tx-amount--in" : !isPaid ? "aw-tx-amount--pending" : "aw-tx-amount--out"}`}>
          {isReceive ? "+" : "-"}
          {tx.amountSat > 0
            ? `${tx.amountSat.toLocaleString("it-IT")} sat`
            : isReceive ? "Qualsiasi importo" : "—"}
        </div>
        <div className="aw-tx-detail-amount-network">⚡ Lightning · {dirLabel}</div>
      </div>

      {/* QR per invoice pending-receive ancora valida */}
      {isReceive && isPending && !isExpired && qrUrl && (
        <div className="aw-receive-qr-card" style={{ margin: "12px auto" }}>
          <img src={qrUrl} alt="QR invoice Lightning" className="aw-receive-qr-img" />
        </div>
      )}

      {/* Countdown per pending */}
      {isPending && !isExpired && countdown !== null && (
        <div style={{
          textAlign: "center", margin: "6px 0 12px", fontSize: "0.88rem",
          fontVariantNumeric: "tabular-nums", fontWeight: countdown < 60 ? 600 : 400,
          color: countdown < 60 ? "#ffaa00" : "rgba(255,255,255,.7)",
        }}>
          ⏱ Scade tra {fmtSecs(countdown)}
        </div>
      )}

      {/* Banner scaduta */}
      {isExpired && (
        <div style={{ textAlign: "center", color: "#ff4d4d", fontSize: "0.88rem", fontWeight: 600, margin: "6px 0 12px" }}>
          🔴 Invoice scaduta
        </div>
      )}

      <div className="aw-tx-detail-card">
        <div className="aw-tx-detail-row">
          <span className="aw-tx-detail-label">Stato</span>
          <span className="aw-tx-detail-value">{statusLabel}</span>
        </div>
        <div className="aw-tx-detail-row">
          <span className="aw-tx-detail-label">Data creazione</span>
          <span className="aw-tx-detail-value">{dateStr}</span>
        </div>
        {tx.paidAt && (
          <div className="aw-tx-detail-row">
            <span className="aw-tx-detail-label">Data pagamento</span>
            <span className="aw-tx-detail-value">
              {new Date(tx.paidAt).toLocaleString("it-IT", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
            </span>
          </div>
        )}
        {tx.feeSat !== undefined && tx.feeSat > 0 && (
          <div className="aw-tx-detail-row">
            <span className="aw-tx-detail-label">Fee</span>
            <span className="aw-tx-detail-value">{tx.feeSat.toLocaleString("it-IT")} sat</span>
          </div>
        )}
        {tx.fiatAmount && tx.fiatCurrency && tx.fiatCurrency !== "BTC" && (
          <div className="aw-tx-detail-row">
            <span className="aw-tx-detail-label">Importo fiat</span>
            <span className="aw-tx-detail-value">
              {tx.fiatCurrency === "EUR" ? "€" : "$"}{tx.fiatAmount.toFixed(2)}
            </span>
          </div>
        )}
        {tx.paymentId && (
          <div className="aw-tx-detail-row">
            <span className="aw-tx-detail-label">Payment ID</span>
            <span className="aw-tx-detail-value aw-tx-detail-value--mono" style={{ fontSize: "0.72rem" }}>
              {tx.paymentId.slice(0, 16)}…
            </span>
          </div>
        )}
      </div>

      {/* Azioni */}
      {tx.bolt11 && (
        <div className="aw-tx-detail-actions">
          <button className="aw-btn aw-btn--secondary" onClick={copyBolt11}>
            {copied ? "✅ Copiata" : "📋 Copia invoice"}
          </button>
        </div>
      )}

      <div style={{ marginTop: 12 }}>
        <button className="aw-btn aw-btn--secondary" style={{ width: "100%" }} onClick={onBack}>
          ← Torna allo storico
        </button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// SEED EXPORT VIEW (Phase F — visualizzazione autenticata recovery phrase)
// ═══════════════════════════════════════════════════════════════════════════

const PHRASE_VISIBLE_SECS = 30; // secondi prima dell'auto-hide

function SeedExportView({ onBack }: { onBack: () => void }) {
  const [pin, setPin] = useState("");
  const [pinErr, setPinErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [words, setWords] = useState<string[] | null>(null);
  const [copied, setCopied] = useState(false);
  const [secsLeft, setSecsLeft] = useState(PHRASE_VISIBLE_SECS);

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

  // Hook sicurezza — sempre chiamato (sopra i return condizionali, regola dei hooks)
  const { isProtected, isScreenShare, reveal } = useSecurePhraseDisplay();

  // Auto-hide: dopo PHRASE_VISIBLE_SECS la frase scompare e l'utente deve reinserire il PIN
  useEffect(() => {
    if (!words) { setSecsLeft(PHRASE_VISIBLE_SECS); return; }
    setSecsLeft(PHRASE_VISIBLE_SECS);
    const iv = setInterval(() => {
      setSecsLeft(s => {
        if (s <= 1) { clearInterval(iv); setWords(null); return 0; }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(iv);
  }, [words]);

  // Mostra la frase se autenticata

  if (words) {
    return (
      <div className="aw-seed-export">
        <div className="aw-seed-export-warning">
          ⚠️ <strong>Non condividere mai queste parole.</strong> Chiunque le abbia può accedere ai tuoi fondi.
          Non fare screenshot — le immagini possono essere intercettate.
          <br />
          <span style={{ fontVariantNumeric: "tabular-nums", opacity: 0.75 }}>
            La frase scomparirà automaticamente in{" "}
            <strong style={{ color: secsLeft <= 10 ? "#ef4444" : undefined }}>{secsLeft}s</strong>.
          </span>
        </div>
        <div className="aw-seed-export-phrase" style={{ position: "relative" }}>
          {words.map((w, i) => (
            <div key={i} className="aw-seed-export-word">
              <span className="aw-seed-export-word-num">{i + 1}</span>
              <span>{w}</span>
            </div>
          ))}
          {isProtected && <SecureOverlay isScreenShare={isScreenShare} onReveal={reveal} />}
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
