/**
 * ChatWalletPaySheet — Wizard a 6 step (no-scroll)
 *
 * Tre casi destinatario:
 *   A — ha Alpha Wallet → address auto, locked
 *   B — non ha Alpha Wallet → messaggio invito / usa indirizzo esterno
 *   C — indirizzo esterno (manuale)
 *
 * Wizard steps:
 *   recipient → asset → amount → summary → auth → sending → success
 *
 * SICUREZZA §12 anti-remote-trigger:
 *   Solo azione esplicita utente può avviare sendPayment().
 * SICUREZZA §16: PIN raccolto inline nello step "auth", mai esposto al bridge.
 * ISOLAMENTO: importa solo da bridge/chat-wallet-bridge e alpha-wallet-api.
 */

import {
  useState,
  useEffect,
  useCallback,
  useRef,
} from "react";
import { useChatWalletBridge } from "../../wallet/bridge/chat-wallet-bridge-context";
import type {
  SupportedNetwork,
  ChatPaymentRequest,
  ChatPaymentResult,
  PaymentQuote,
} from "../../wallet/bridge/chat-wallet-bridge";
import {
  NETWORK_LABELS,
  NETWORK_COLORS,
} from "../../wallet/bridge/chat-wallet-bridge";
import {
  apiWalletGetRecipient,
  apiMarkAlphaWalletRequestPaid,
  type RecipientWalletInfo,
} from "../../lib/alpha-wallet-api";
import "./ChatWalletPaySheet.css";
import { useLock } from "../../contexts/LockContext";
import { useWalletFaceId, unsealWalletPin } from "../../wallet/security/wallet-pin-seal";
import {
  fetchPrices,
  type AssetPrices,
} from "../../wallet/services/price-service";

/**
 * Costruisce il testo del messaggio di invito Alpha Wallet nella lingua del
 * DESTINATARIO — non del mittente — affinché il destinatario lo comprenda.
 * Supporta tutte le 10 lingue dell'app; fallback en se lingua sconosciuta.
 */
function buildWalletInviteText(recipientLang: string | undefined, name: string): string {
  const n = name;
  switch (recipientLang ?? "en") {
    case "it": return `👋 Ciao ${n}! Per ricevere pagamenti diretti tramite Alpha Wallet, configura il tuo wallet su Alpha Chat: Impostazioni → Alpha Wallet. È gratuito e richiede meno di un minuto. 🔐`;
    case "es": return `👋 ¡Hola ${n}! Para recibir pagos directos con Alpha Wallet, configura tu wallet en Alpha Chat: Ajustes → Alpha Wallet. Es gratis y tarda menos de un minuto. 🔐`;
    case "fr": return `👋 Salut ${n}! Pour recevoir des paiements directs via Alpha Wallet, configure ton wallet sur Alpha Chat : Paramètres → Alpha Wallet. C'est gratuit et ça prend moins d'une minute. 🔐`;
    case "de": return `👋 Hallo ${n}! Um direkte Zahlungen über Alpha Wallet zu empfangen, richte dein Wallet in Alpha Chat ein: Einstellungen → Alpha Wallet. Es ist kostenlos und dauert weniger als eine Minute. 🔐`;
    case "pt": return `👋 Olá ${n}! Para receber pagamentos diretos via Alpha Wallet, configure sua carteira no Alpha Chat: Configurações → Alpha Wallet. É grátis e leva menos de um minuto. 🔐`;
    case "ar": return `👋 مرحباً ${n}! لاستقبال المدفوعات المباشرة عبر Alpha Wallet، أعدّ محفظتك في Alpha Chat: الإعدادات ← Alpha Wallet. إنه مجاني ويستغرق أقل من دقيقة. 🔐`;
    case "ru": return `👋 Привет ${n}! Чтобы получать прямые платежи через Alpha Wallet, настрой кошелёк в Alpha Chat: Настройки → Alpha Wallet. Это бесплатно и займёт меньше минуты. 🔐`;
    case "zh": return `👋 你好 ${n}！要通过 Alpha Wallet 接收直接付款，请在 Alpha Chat 中设置钱包：设置 → Alpha Wallet。免费，不到一分钟即可完成。🔐`;
    case "ja": return `👋 こんにちは ${n}！Alpha Wallet で直接支払いを受け取るには、Alpha Chat でウォレットを設定してください：設定 → Alpha Wallet。無料で1分もかかりません。🔐`;
    default:   return `👋 Hi ${n}! To receive direct payments via Alpha Wallet, set up your wallet on Alpha Chat: Settings → Alpha Wallet. It's free and takes less than a minute. 🔐`;
  }
}

/**
 * Converte un importo fiat (EUR/USD) nella stringa crypto corrispondente.
 * Ritorna stringa vuota se i prezzi non sono disponibili o l'importo non è valido.
 */
function cwpFiatToCrypto(
  fiatStr: string,
  assetSymbol: string,
  mode: "eur" | "usd",
  prices: AssetPrices | null,
): string {
  const fiatNum = parseFloat(fiatStr.replace(",", "."));
  if (isNaN(fiatNum) || fiatNum <= 0 || !prices) return "";
  const sym = assetSymbol.toLowerCase() as keyof AssetPrices;
  const priceObj = prices[sym] as { usd: number; eur: number } | undefined;
  const price = priceObj?.[mode];
  if (!price || price <= 0) return "";
  const decimals = assetSymbol.toUpperCase() === "BTC" ? 8 : 6;
  return (fiatNum / price).toFixed(decimals);
}

/**
 * Calcola il colore del testo (bianco/nero) in base alla luminanza del colore di sfondo.
 * Necessario per reti con colori chiari: BNB (#F3BA2F), Bitcoin (#F7931A).
 */
function getContrastColor(hex: string): "#111111" | "#ffffff" {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.55 ? "#111111" : "#ffffff";
}

// ─── Types ────────────────────────────────────────────────────────────────

/** Dati pre-compilati dal bubble "Richiedi" — apre il wizard direttamente su amount. */
export interface PrefillRequest {
  requestId:            string;
  network:              SupportedNetwork;
  assetSymbol:          string;
  tokenContractAddress: string | null;
  amount:               string;
  recipientAddress:     string;
}

interface Props {
  recipientUserId?:  string;
  recipientName?:    string;
  prefillRecipient?: string;
  conversationId?:   string;
  onClose:           () => void;
  onSent:            (result: ChatPaymentResult) => void;
  onSendInvite?:     (message: string) => void;
  /** Se presente, salta a step="amount" con campi bloccati (payer flow). */
  prefillRequest?:   PrefillRequest;
}

interface AssetOption {
  symbol:          string;
  name:            string;
  icon:            string;
  contractAddress: string | null;
}

type RecipientMode = "loading" | "found" | "not-found" | "manual";

type WizardStep =
  | "recipient"   // Step 1: destinatario + rete
  | "asset"       // Step 2: asset
  | "amount"      // Step 3: importo (+ indirizzo Caso C)
  | "summary"     // Step 4: riepilogo fee + conferma
  | "auth"        // Inline PIN
  | "sending"     // Broadcast in corso
  | "success";    // Pagamento inviato

// ─── Assets ───────────────────────────────────────────────────────────────

const ASSETS_BY_NETWORK: Record<SupportedNetwork, AssetOption[]> = {
  polygon: [
    { symbol: "USDA", name: "USDA (stablecoin)",    icon: "🟡", contractAddress: "0xe714655fD1B3ba96B887DF1F94336c2A78E24001" },
    { symbol: "USDT", name: "Tether (USDT)",         icon: "💵", contractAddress: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F" },
    { symbol: "USDC", name: "USD Coin (USDC)",        icon: "💎", contractAddress: "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174" },
    { symbol: "POL",  name: "POL (nativo)",           icon: "🔷", contractAddress: null },
  ],
  ethereum: [
    { symbol: "ETH",  name: "Ether (nativo)",        icon: "⬡",  contractAddress: null },
    { symbol: "USDT", name: "Tether (USDT)",          icon: "💵", contractAddress: "0xdAC17F958D2ee523a2206206994597C13D831ec7" },
    { symbol: "USDC", name: "USD Coin (USDC)",         icon: "💎", contractAddress: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" },
  ],
  bsc: [
    { symbol: "BNB",  name: "BNB (nativo)",           icon: "🟡", contractAddress: null },
    { symbol: "USDT", name: "Tether BSC (USDT)",       icon: "💵", contractAddress: "0x55d398326f99059fF775485246999027B3197955" },
    { symbol: "USDC", name: "USD Coin BSC (USDC)",      icon: "💎", contractAddress: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d" },
  ],
  bitcoin: [
    { symbol: "BTC",  name: "Bitcoin",                icon: "₿",  contractAddress: null },
  ],
};

const NETWORKS: SupportedNetwork[] = ["polygon", "ethereum", "bsc", "bitcoin"];

// ─── Helpers ──────────────────────────────────────────────────────────────

function pickAddress(info: RecipientWalletInfo | null, network: SupportedNetwork): string | null {
  if (!info) return null;
  if (network === "bitcoin") return info.btcAddress ?? null;
  return info.evmAddress ?? null;
}

function truncateAddress(addr: string): string {
  if (addr.length <= 14) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-6)}`;
}

const STEP_LABELS: Partial<Record<WizardStep, string>> = {
  recipient: "Destinatario · Rete",
  asset:     "Asset",
  amount:    "Importo",
  summary:   "Riepilogo",
  auth:      "Conferma PIN",
  sending:   "Invio in corso…",
  success:   "Pagamento inviato",
};

// ─── Component ────────────────────────────────────────────────────────────

export function ChatWalletPaySheet({
  recipientUserId,
  recipientName,
  prefillRecipient,
  conversationId,
  onClose,
  onSent,
  onSendInvite,
  prefillRequest,
}: Props) {
  const bridge = useChatWalletBridge();

  // ── Fetch prices per conversione EUR/USD ─────────────────────────────
  useEffect(() => { fetchPrices().then(setPrices).catch(() => {}); }, []);

  // ── Biometric auth (Face ID per wallet) ──────────────────────────────
  const lock = useLock();
  const { walletFaceIdEnabled } = useWalletFaceId();
  const hasBiometricSet  = lock?.hasBiometricSet  ?? false;
  const walletBioActive  = walletFaceIdEnabled && hasBiometricSet;

  // ── Wizard step ──────────────────────────────────────────────────────
  // Quando prefillRequest è presente salta direttamente ad "amount" (payer flow).
  const [step, setStep] = useState<WizardStep>(prefillRequest ? "amount" : "recipient");

  // ── Network / asset ──────────────────────────────────────────────────
  const [network,  setNetwork]  = useState<SupportedNetwork>(prefillRequest?.network ?? "polygon");
  const [assetIdx, setAssetIdx] = useState(() => {
    if (!prefillRequest) return 0;
    const idx = ASSETS_BY_NETWORK[prefillRequest.network]
      .findIndex(a => a.symbol === prefillRequest.assetSymbol);
    return Math.max(0, idx);
  });

  // ── Recipient discovery ──────────────────────────────────────────────
  const [recipientMode, setRecipientMode] = useState<RecipientMode>(
    prefillRequest ? "manual" :
    recipientUserId ? "loading" : "manual",
  );
  const [recipientInfo, setRecipientInfo] = useState<RecipientWalletInfo | null>(null);

  // ── Form state ───────────────────────────────────────────────────────
  const [manualAddress, setManualAddress] = useState(
    prefillRequest?.recipientAddress ?? prefillRecipient ?? "",
  );
  const [amount,          setAmount]          = useState(prefillRequest?.amount ?? "");
  const [amountInputMode, setAmountInputMode] = useState<"crypto" | "eur" | "usd">("crypto");
  const [prices,          setPrices]          = useState<AssetPrices | null>(null);
  const [amountErr,       setAmountErr]       = useState<string | null>(null);
  const [recipErr,        setRecipErr]        = useState<string | null>(null);

  // ── Quote ────────────────────────────────────────────────────────────
  const [quote,        setQuote]        = useState<PaymentQuote | null>(null);
  const [quoteAge,     setQuoteAge]     = useState(0);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteErr,     setQuoteErr]     = useState<string | null>(null);
  const [showFullAddr, setShowFullAddr] = useState(false);

  // ── Auth (inline PIN) ────────────────────────────────────────────────
  const [pinValue,  setPinValue]  = useState("");
  const [authErr,   setAuthErr]   = useState<string | null>(null);
  const pinResolveRef = useRef<((pin: string | null) => void) | null>(null);

  // ── Send ─────────────────────────────────────────────────────────────
  const [sending,     setSending]     = useState(false);
  const [sendErr,     setSendErr]     = useState<string | null>(null);
  const [txHash,      setTxHash]      = useState<string | null>(null);
  const [explorerUrl, setExplorerUrl] = useState<string | null>(null);

  const assets         = ASSETS_BY_NETWORK[network];
  const asset          = assets[Math.min(assetIdx, assets.length - 1)];
  const netColor       = NETWORK_COLORS[network];
  const autoAddress    = pickAddress(recipientInfo, network);
  const effectiveAddress = recipientMode === "found"
    ? (autoAddress ?? "")
    : manualAddress;

  // ── Fetch recipient on mount ─────────────────────────────────────────
  useEffect(() => {
    // In prefill (payer) mode l'indirizzo è già noto → non serve lookup
    if (prefillRequest) return;
    if (!recipientUserId) { setRecipientMode("manual"); return; }
    let cancelled = false;
    (async () => {
      try {
        const info = await apiWalletGetRecipient(recipientUserId);
        if (cancelled) return;
        setRecipientInfo(info);
        setRecipientMode(info.hasAlphaWallet ? "found" : "not-found");
      } catch {
        if (!cancelled) setRecipientMode("manual");
      }
    })();
    return () => { cancelled = true; };
  }, [recipientUserId]);

  // ── Reset asset quando cambia rete ───────────────────────────────────
  useEffect(() => { setAssetIdx(0); setQuote(null); }, [network]);

  // ── Invalida quote se cambia importo o asset ─────────────────────────
  useEffect(() => { setQuote(null); setQuoteErr(null); }, [amount, assetIdx, network]);

  // ── Quote countdown ──────────────────────────────────────────────────
  useEffect(() => {
    if (!quote) { setQuoteAge(0); return; }
    setQuoteAge(0);
    const interval = setInterval(() => {
      const age = Math.floor((Date.now() - quote.frozenAt) / 1000);
      setQuoteAge(age);
      if (age >= quote.quoteValiditySec) {
        setQuote(null);
        clearInterval(interval);
        // Quote scaduta → torna ad "amount".
        // NOTA: functional update per evitare la closure stale di `step`
        // (questo effect dipende solo da [quote]).
        setSendErr("Quote scaduta. Ricalcola i costi.");
        setStep(s => (s === "summary" ? "amount" : s));
      }
    }, 1000);
    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quote]);

  // ── Importo effettivo in crypto (per quote e validazione) ────────────
  // Se inputMode è "crypto" usa amount direttamente; altrimenti converte fiat → crypto.
  const effectiveAmount = amountInputMode === "crypto"
    ? amount
    : cwpFiatToCrypto(amount, asset.symbol, amountInputMode, prices);

  // ── Validazione ──────────────────────────────────────────────────────
  const validateAmount = (): boolean => {
    const numToCheck = parseFloat(amountInputMode === "crypto" ? amount : effectiveAmount);
    if (!amount || isNaN(numToCheck) || numToCheck <= 0) {
      setAmountErr(
        amountInputMode !== "crypto" && !prices
          ? "Prezzi non disponibili. Usa la modalità crypto."
          : "Inserisci un importo valido",
      );
      return false;
    }
    setAmountErr(null);
    return true;
  };

  const validateAddress = (): boolean => {
    if (recipientMode === "manual") {
      const addr = manualAddress.trim();
      if (!addr) {
        setRecipErr("Inserisci l'indirizzo destinatario");
        return false;
      } else if (network !== "bitcoin" && !/^0x[0-9a-fA-F]{40}$/.test(addr)) {
        setRecipErr("Indirizzo EVM non valido (0x + 40 hex)");
        return false;
      } else if (network === "bitcoin" && !/^(bc1|[13])[a-zA-Z0-9]{25,87}$/.test(addr)) {
        setRecipErr("Indirizzo Bitcoin non valido");
        return false;
      }
    } else if (recipientMode === "found" && !autoAddress) {
      setRecipErr(
        network === "bitcoin"
          ? `${recipientName ?? "Il destinatario"} non ha un indirizzo Bitcoin. Scegli un'altra rete.`
          : "Indirizzo non disponibile per questa rete.",
      );
      return false;
    }
    setRecipErr(null);
    return true;
  };

  // ── Navigazione ──────────────────────────────────────────────────────
  const goNext = () => {
    setStep(s => {
      if (s === "recipient") return "asset";
      if (s === "asset")     return "amount";
      return s;
    });
  };

  const goBack = () => {
    setStep(s => {
      if (s === "asset")   return "recipient";
      if (s === "amount")  return "asset";
      if (s === "summary") { setQuote(null); setQuoteErr(null); return "amount"; }
      return s;
    });
  };

  // ── Vai a riepilogo (con calcolo quote) ──────────────────────────────
  const handleGoToSummary = useCallback(async () => {
    if (!validateAmount() || !validateAddress()) return;

    setSendErr(null);
    setQuoteErr(null);
    setQuoteLoading(true);
    try {
      const q = await bridge.calculateQuote(
        network,
        asset.contractAddress,
        asset.symbol,
        effectiveAmount || amount,
      );
      // FIX Step 4 bianco: calculateQuote può risolvere `null` SENZA lanciare
      // (wallet non "ready" — es. auto-lock su iOS PWA — o importo non parsabile).
      // Prima si faceva setQuote(null)+setStep("summary") → schermo vuoto.
      if (!q) {
        setQuoteErr(
          "Impossibile calcolare i costi: il wallet potrebbe essere bloccato. Sblocca Alpha Wallet e riprova.",
        );
        // Torna SEMPRE ad "amount": questo handler può essere invocato anche
        // dal fallback "Ricalcola i costi" mentre siamo già su "summary".
        setStep("amount");
        return;
      }
      setQuote(q);
      setShowFullAddr(false);
      setStep("summary");
    } catch (e) {
      setQuoteErr(e instanceof Error ? e.message : "Errore nel calcolo dei costi. Riprova.");
    } finally {
      setQuoteLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridge, network, asset, amount, effectiveAmount, manualAddress, recipientMode, autoAddress, recipientName]);

  // ── onAuthRequired: prova Face ID silenziosamente, fallback PIN step ─
  const onAuthRequired = useCallback((): Promise<string | null> => {
    // eslint-disable-next-line no-async-promise-executor
    return new Promise(async resolve => {
      // Prova Face ID silenziosamente — se ha successo e il PIN è sigillato,
      // risolve la promise senza mostrare l'auth step.
      if (walletBioActive && lock) {
        try {
          const ok = await lock.tryUnlockWithBiometric();
          if (ok) {
            const pin = await unsealWalletPin();
            if (pin) { resolve(pin); return; }
          }
        } catch { /* non disponibile — mostra PIN step */ }
      }
      // Biometria fallita/assente → mostra step PIN inline
      pinResolveRef.current = resolve;
      setPinValue("");
      setAuthErr(null);
      setStep("auth");
    });
  }, [lock, walletBioActive]);

  // ── handleBioAuth: retry Face ID dall'auth step (bottone esplicito) ─
  const handleBioAuth = useCallback(async () => {
    if (!walletBioActive || !lock) return;
    setAuthErr(null);
    try {
      const ok = await lock.tryUnlockWithBiometric();
      if (ok) {
        const pin = await unsealWalletPin();
        if (pin && pinResolveRef.current) {
          pinResolveRef.current(pin);
          pinResolveRef.current = null;
          setStep("sending");
          return;
        }
      }
      setAuthErr("Face ID non riconosciuto. Inserisci il PIN.");
    } catch {
      setAuthErr("Face ID non disponibile. Inserisci il PIN.");
    }
  }, [walletBioActive, lock]);

  const handlePinSubmit = () => {
    if (pinValue.length < 4) { setAuthErr("PIN troppo corto"); return; }
    if (pinResolveRef.current) {
      pinResolveRef.current(pinValue);
      pinResolveRef.current = null;
    }
    setStep("sending");
  };

  const handlePinCancel = () => {
    if (pinResolveRef.current) {
      pinResolveRef.current(null);
      pinResolveRef.current = null;
    }
    // Se nel frattempo la quote è scaduta (countdown → setQuote(null)),
    // tornare a "summary" mostrerebbe uno step vuoto: torna ad "amount".
    setStep(quote ? "summary" : "amount");
  };

  // ── Invia pagamento ──────────────────────────────────────────────────
  // REGOLA §12: solo questa azione esplicita avvia sendPayment()
  const handleSend = useCallback(async () => {
    if (!quote) return;
    const age = (Date.now() - quote.frozenAt) / 1000;
    if (age >= quote.quoteValiditySec) {
      setQuote(null);
      setSendErr("Quote scaduta. Ricalcola i costi.");
      setStep("amount");
      return;
    }

    setSendErr(null);
    setSending(true);

    const request: ChatPaymentRequest = {
      network,
      tokenContractAddress: asset.contractAddress,
      assetSymbol:          asset.symbol,
      amount,
      recipientAddress:     effectiveAddress,
      frozenQuote:          quote,
      metadata:             { conversationId },
    };

    // sendPayment chiamerà onAuthRequired → step "auth" → step "sending"
    const result = await bridge.sendPayment(request, onAuthRequired);
    setSending(false);

    if (result.status === "cancelled") {
      // L'utente ha annullato nel PIN step → torna a summary
      setStep("summary");
      return;
    }

    if (result.status === "sent" || result.status === "confirmed") {
      // Se stiamo pagando una richiesta, notifica il backend (best-effort)
      if (prefillRequest?.requestId && result.txHash) {
        apiMarkAlphaWalletRequestPaid(prefillRequest.requestId, result.txHash).catch(() => {});
      }
      setTxHash(result.txHash ?? null);
      setExplorerUrl(result.explorerUrl ?? null);
      setStep("success");
      onSent(result);
    } else {
      const rawErr = result.errorMessage;
      const errMsg = typeof rawErr === "string" && rawErr.trim()
        ? rawErr
        : "Pagamento fallito. Riprova.";
      setSendErr(errMsg);
      setStep("summary");
    }
  }, [bridge, quote, network, asset, amount, effectiveAddress, conversationId, onAuthRequired, onSent]);

  const quoteSecondsLeft = quote
    ? Math.max(0, quote.quoteValiditySec - quoteAge)
    : 0;

  const displayName = recipientName ?? "il destinatario";

  // ─────────────────────────────────────────────────────────────────────
  // RENDER — Bottom-sheet compatto.
  //
  // ARCHITETTURA iOS/PWA:
  //   cwp-backdrop   position:fixed inset:0 — overlay sopra la chat
  //   cwp-sheet      ancorato in basso, flex column, alto quanto il contenuto
  //   awp-header     flex-shrink:0
  //   awp-content    flex:1 — NESSUNO step dipende dallo scroll interno:
  //                  ogni step è compatto e sta nel viewport mobile.
  //                  overflow-y:auto resta solo come rete di sicurezza.
  //   awp-footer     flex-shrink:0 — il CTA è STRUTTURALMENTE fuori dal
  //                  content, quindi sempre visibile a prescindere da iOS.
  // ─────────────────────────────────────────────────────────────────────

  return (
    <div
      className="cwp-backdrop"
      onClick={e => {
        // Chiusura da backdrop DISABILITATA durante "sending" e "auth":
        // in auth sendPayment() sta awaitando la promise del PIN — chiudere
        // qui lascerebbe pinResolveRef pendente e il mutex anti-double-send
        // attivo fino al reload. La X/← nell'header gestisce l'annullo corretto.
        if (e.target === e.currentTarget && step !== "sending" && step !== "auth") onClose();
      }}
    >
    <div className="cwp-sheet" role="dialog" aria-modal="true">

      {/* ── Header ──────────────────────────────────────────────────── */}
      <div className="awp-header">
        <button
          className="awp-back-btn"
          aria-label={step === "recipient" || step === "success" ? "Chiudi" : "Indietro"}
          disabled={step === "sending"}
          onClick={() => {
            if (step === "sending") return;
            if (step === "recipient" || step === "success") { onClose(); return; }
            if (step === "auth") { handlePinCancel(); return; }
            goBack();
          }}
        >
          ←
        </button>
        <div className="awp-title-group">
          <span className="awp-title">🔐 Paga con Alpha Wallet</span>
          {step !== "sending" && step !== "success" && (
            <span className="awp-step-label">{STEP_LABELS[step]}</span>
          )}
        </div>
        <div className="awp-header-spacer" aria-hidden="true" />
      </div>

      {/* ── Scrollable content ─────────────────────────────────────── */}
      <div className="awp-content">

        {/* ════════════════════════════════════════════════════════════
            STEP 1 — Destinatario + Rete
        ═══════════════════════════════════════════════════════════════ */}
        {step === "recipient" && (
          <div className="cwp-step">

            {/* Loading */}
            {recipientMode === "loading" && (
              <div className="cwp-recipient-loading">
                <span className="cwp-loading-spinner" />
                Verifica wallet destinatario…
              </div>
            )}

            {/* CASO B — no wallet */}
            {recipientMode === "not-found" && (
              <div className="cwp-no-wallet-card">
                <div className="cwp-no-wallet-icon">⚠️</div>
                <p className="cwp-no-wallet-title">
                  {recipientName
                    ? <><strong>{recipientName}</strong> non ha ancora configurato Alpha Wallet.</>
                    : <>Il destinatario non ha ancora configurato Alpha Wallet.</>}
                </p>
                <p className="cwp-no-wallet-sub">
                  Per ricevere un pagamento self-custodial diretto, il destinatario deve
                  prima configurare Alpha Wallet sul proprio dispositivo.
                </p>
                {onSendInvite && (
                  <button
                    className="cwp-btn-invite"
                    onClick={() => {
                      // Il testo viene costruito nella lingua del DESTINATARIO
                      // (ritornata dal backend insieme al lookup wallet),
                      // non nella lingua dell'interfaccia del mittente.
                      const name = recipientName ?? "there";
                      const lang = recipientInfo?.language;
                      onSendInvite(buildWalletInviteText(lang, name));
                      onClose();
                    }}
                  >
                    📩 Invita {recipientName ?? "il destinatario"} su Alpha Wallet
                  </button>
                )}
                <button
                  className="cwp-btn-secondary"
                  onClick={() => { setRecipientMode("manual"); setRecipErr(null); }}
                >
                  Usa indirizzo esterno →
                </button>
                <p className="cwp-no-wallet-note">
                  Se il destinatario ha un wallet esterno, puoi inviare al suo indirizzo.
                </p>
              </div>
            )}

            {/* CASO A — Alpha Wallet trovato */}
            {recipientMode === "found" && (
              <div className="cwp-recipient-card">
                <div className="cwp-recipient-badge">ALPHA WALLET ✓</div>
                <div className="cwp-recipient-name">{recipientName ?? "Destinatario"}</div>
                {autoAddress
                  ? <div className="cwp-recipient-address">{truncateAddress(autoAddress)}</div>
                  : <div className="cwp-recipient-no-address">Nessun indirizzo per questa rete</div>
                }
              </div>
            )}

            {/* CASO C — manuale */}
            {recipientMode === "manual" && recipientUserId && (
              <div className="cwp-manual-notice">
                ⚠️ Indirizzo esterno — verifica rete e indirizzo prima di confermare.
              </div>
            )}

            {/* Selezione rete */}
            {(recipientMode === "found" || recipientMode === "manual") && (
              <div className="cwp-section">
                <label className="cwp-label">Rete</label>
                <div className="cwp-network-grid">
                  {NETWORKS.map(net => (
                    <button
                      key={net}
                      className={`cwp-net-btn ${network === net ? "active" : ""}`}
                      style={network === net
                        ? { borderColor: NETWORK_COLORS[net], color: NETWORK_COLORS[net], background: `${NETWORK_COLORS[net]}18` }
                        : {}}
                      onClick={() => setNetwork(net)}
                    >
                      {NETWORK_LABELS[net]}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ════════════════════════════════════════════════════════════
            STEP 2 — Asset
        ═══════════════════════════════════════════════════════════════ */}
        {step === "asset" && (
          <div className="cwp-step">
            <p className="cwp-step-hint">
              Seleziona l'asset da inviare su{" "}
              <strong style={{ color: netColor }}>{NETWORK_LABELS[network]}</strong>
            </p>
            <div className="cwp-asset-list">
              {assets.map((a, i) => (
                <button
                  key={a.symbol}
                  className={`cwp-asset-btn ${assetIdx === i ? "active" : ""}`}
                  style={assetIdx === i
                    ? { borderColor: netColor, background: `${netColor}12` }
                    : {}}
                  onClick={() => setAssetIdx(i)}
                >
                  <span className="cwp-asset-icon">{a.icon}</span>
                  <span className="cwp-asset-info">
                    <span className="cwp-asset-symbol">{a.symbol}</span>
                    <span className="cwp-asset-name">{a.name}</span>
                  </span>
                  {assetIdx === i && (
                    <span className="cwp-asset-check" style={{ color: netColor }}>✓</span>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ════════════════════════════════════════════════════════════
            STEP 3 — Importo
        ═══════════════════════════════════════════════════════════════ */}
        {step === "amount" && prefillRequest && (
          /* Payer flow — campi bloccati dalla richiesta ricevuta */
          <div className="cwp-step">
            <div
              style={{
                marginBottom: 12,
                padding: "10px 14px",
                background: "rgba(15,15,30,0.82)",
                borderLeft: `4px solid ${netColor}`,
                borderRadius: 8,
                fontSize: 13,
                color: "#f0f0f0",
                lineHeight: 1.5,
                fontWeight: 500,
              }}
            >
              📥 Stai pagando una richiesta ricevuta. Rete, asset e importo sono fissati dal richiedente.
            </div>
            <div className="cwp-amount-context">
              <span className="cwp-ctx-pill" style={{ color: getContrastColor(netColor) === "#111111" ? "#555" : netColor, borderColor: `${netColor}60`, background: `${netColor}20` }}>
                {NETWORK_LABELS[network]}
              </span>
              <span className="cwp-ctx-pill">{asset.icon} {asset.symbol}</span>
              <span className="cwp-ctx-pill">→ {displayName}</span>
            </div>
            <div className="cwp-section">
              <label className="cwp-label">Importo richiesto</label>
              <div className="cwp-amount-row" style={{ opacity: 0.85 }}>
                <span className="cwp-input cwp-amount-input" style={{ display: "flex", alignItems: "center", background: "var(--color-surface,#1a1a2e)", cursor: "default" }}>
                  {amount}
                </span>
                <span className="cwp-amount-symbol">{asset.symbol}</span>
              </div>
            </div>
            <div className="cwp-section">
              <label className="cwp-label">Indirizzo destinatario</label>
              <div className="cwp-quote-addr-full" style={{ marginTop: 4 }}>
                🔒 {manualAddress}
              </div>
            </div>
            {quoteErr && <p className="cwp-quote-err">{quoteErr}</p>}
            {sendErr && <p className="cwp-send-err">{sendErr}</p>}
          </div>
        )}
        {step === "amount" && !prefillRequest && (
          /* Normale: tutti i campi editabili */
          <div className="cwp-step">
            <div className="cwp-amount-context">
              <span className="cwp-ctx-pill" style={{ color: getContrastColor(netColor) === "#111111" ? "#555" : netColor, borderColor: `${netColor}60`, background: `${netColor}20` }}>
                {NETWORK_LABELS[network]}
              </span>
              <span className="cwp-ctx-pill">{asset.icon} {asset.symbol}</span>
              <span className="cwp-ctx-pill">→ {displayName}</span>
            </div>

            <div className="cwp-section">
              <label className="cwp-label">Quanto vuoi inviare?</label>

              {/* Toggle crypto / EUR / USD */}
              <div className="cwp-mode-toggle">
                {(["crypto", "eur", "usd"] as const).map(mode => {
                  const label = mode === "crypto" ? asset.symbol : mode === "eur" ? "EUR €" : "USD $";
                  const active = amountInputMode === mode;
                  return (
                    <button
                      key={mode}
                      type="button"
                      className={`cwp-mode-pill${active ? " active" : ""}`}
                      style={active ? { borderColor: netColor, color: netColor, background: `${netColor}18` } : {}}
                      disabled={mode !== "crypto" && !prices}
                      title={mode !== "crypto" && !prices ? "Prezzi non disponibili" : undefined}
                      onClick={() => {
                        setAmountInputMode(mode);
                        setAmount("");
                        setAmountErr(null);
                        setQuoteErr(null);
                      }}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>

              <div className="cwp-amount-row">
                {amountInputMode !== "crypto" && (
                  <span className="cwp-amount-prefix">
                    {amountInputMode === "eur" ? "€" : "$"}
                  </span>
                )}
                <input
                  className={`cwp-input cwp-amount-input ${amountErr ? "error" : ""}`}
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="any"
                  placeholder="0.00"
                  value={amount}
                  onChange={e => { setAmount(e.target.value); setAmountErr(null); setQuoteErr(null); }}
                  autoFocus
                />
                {amountInputMode === "crypto" && (
                  <span className="cwp-amount-symbol">{asset.symbol}</span>
                )}
              </div>

              {/* Conversione in tempo reale */}
              {amount && parseFloat(amount) > 0 && prices && (() => {
                const priceObj = prices[asset.symbol.toLowerCase() as keyof AssetPrices] as
                  | { usd: number; eur: number } | undefined;
                if (!priceObj) return null;
                if (amountInputMode === "crypto") {
                  const n = parseFloat(amount);
                  if (isNaN(n)) return null;
                  return (
                    <div className="cwp-amount-hint">
                      ≈ €{(n * priceObj.eur).toFixed(2)} · ${(n * priceObj.usd).toFixed(2)}
                    </div>
                  );
                }
                if (!effectiveAmount) return null;
                return (
                  <div className="cwp-amount-hint">
                    ≈ {effectiveAmount} {asset.symbol}
                  </div>
                );
              })()}

              {amountErr && <p className="cwp-field-err">{amountErr}</p>}
            </div>

            {recipientMode === "manual" && (
              <div className="cwp-section">
                <label className="cwp-label">Indirizzo destinatario</label>
                <input
                  className={`cwp-input ${recipErr ? "error" : ""}`}
                  type="text"
                  placeholder={network === "bitcoin" ? "bc1q..." : "0x..."}
                  value={manualAddress}
                  onChange={e => { setManualAddress(e.target.value); setRecipErr(null); }}
                  spellCheck={false}
                  autoComplete="off"
                />
                {recipErr && <p className="cwp-field-err">{recipErr}</p>}
              </div>
            )}

            {quoteErr && <p className="cwp-quote-err">{quoteErr}</p>}
            {sendErr && <p className="cwp-send-err">{sendErr}</p>}
          </div>
        )}

        {/* ════════════════════════════════════════════════════════════
            STEP 4 — Riepilogo compatto
            Schema: [chi/quanto] + [tabella rete+dest+fee+totale]
            Nessun blocco enorme — indirizzo inline nella tabella.
        ═══════════════════════════════════════════════════════════════ */}
        {step === "summary" && quote && (
          <div className="cwp-step">

            {/* Hero compatto */}
            <div className="cwp-summary-hero">
              <span className="cwp-summary-hero-label">
                {recipientMode === "found" && recipientName
                  ? <><strong>{recipientName}</strong> riceverà</>
                  : <>Destinatario riceverà</>}
              </span>
              <span className="cwp-summary-hero-amount" style={{ color: netColor }}>
                {quote.recipientAmount} {asset.symbol}
              </span>
            </div>

            {/* Tabella compatta: rete + dest + fee */}
            <div className="cwp-quote">
              <div className="cwp-quote-header">
                <span>Riepilogo costi</span>
                <span className={`cwp-quote-timer ${quoteSecondsLeft < 10 ? "expiring" : ""}`}>
                  ⏱ {quoteSecondsLeft}s
                </span>
              </div>
              <div className="cwp-quote-row">
                <span>Rete</span>
                <span style={{ color: netColor, fontWeight: 600 }}>{NETWORK_LABELS[network]}</span>
              </div>
              <div className="cwp-quote-row">
                <span>Destinatario</span>
                <button
                  type="button"
                  className="cwp-quote-addr"
                  title={showFullAddr ? "Nascondi indirizzo completo" : "Mostra indirizzo completo"}
                  onClick={() => setShowFullAddr(v => !v)}
                >
                  🔒 {truncateAddress(effectiveAddress)}
                </button>
              </div>
              {showFullAddr && (
                <div className="cwp-quote-addr-full">{effectiveAddress}</div>
              )}
              <div className="cwp-quote-divider" />
              <div className="cwp-quote-row">
                <span>Platform fee</span>
                <span>{quote.platformFee} {asset.symbol}</span>
              </div>
              <div className="cwp-quote-row">
                <span>Network fee</span>
                <span>~{quote.networkFee} {quote.networkFeeSymbol}</span>
              </div>
              <div className="cwp-quote-divider" />
              <div className="cwp-quote-row cwp-quote-total">
                <span>Totale inviato</span>
                <span style={{ color: netColor }}>{quote.totalAsset} {asset.symbol}</span>
              </div>
              {quote.networkFeeSymbol !== asset.symbol && (
                <div className="cwp-quote-row cwp-quote-gas">
                  <span>+ gas separato</span>
                  <span>~{quote.networkFee} {quote.networkFeeSymbol}</span>
                </div>
              )}
            </div>

            {recipientMode === "manual" && (
              <div className="cwp-manual-confirm-warning">
                ⚠️ Verifica che l'indirizzo sia sulla rete{" "}
                <strong>{NETWORK_LABELS[network]}</strong>.
              </div>
            )}

            {sendErr && <p className="cwp-send-err">{sendErr}</p>}
          </div>
        )}

        {/* ── STEP 4 senza quote — fallback difensivo (MAI schermo vuoto).
            Può accadere solo se la quote scade/si invalida mentre siamo
            su questo step: mostra un messaggio e permetti il ricalcolo. ── */}
        {step === "summary" && !quote && (
          <div className="cwp-step cwp-step-center">
            <div className="cwp-no-wallet-icon">⏱</div>
            <p className="cwp-quote-err">
              Quote non disponibile o scaduta. Ricalcola i costi per continuare.
            </p>
            {quoteErr && <p className="cwp-field-err">{quoteErr}</p>}
          </div>
        )}

        {/* ════════════════════════════════════════════════════════════
            STEP 5 — PIN inline
        ═══════════════════════════════════════════════════════════════ */}
        {step === "auth" && (
          <div className="cwp-step cwp-step-auth">
            {/* Face ID disponibile → bottone primario in cima, PIN come fallback */}
            {walletBioActive ? (
              <>
                <button
                  type="button"
                  className="cwp-bio-btn"
                  onClick={handleBioAuth}
                  aria-label="Autorizza con Face ID"
                >
                  <span className="cwp-bio-icon">🪪</span>
                  <span>Usa Face ID</span>
                </button>
                <p className="cwp-bio-or">oppure inserisci il PIN</p>
              </>
            ) : (
              <div className="cwp-auth-icon">🔐</div>
            )}
            <p className="cwp-auth-desc">
              {recipientName
                ? <>Stai inviando <strong>{amount} {asset.symbol}</strong> a{" "}<strong>{recipientName}</strong></>
                : <>Autorizza la transazione con il tuo PIN</>}
            </p>
            <input
              className={`cwp-pin-input ${authErr ? "error" : ""}`}
              type="password"
              inputMode="numeric"
              pattern="[0-9]*"
              placeholder="• • • •"
              value={pinValue}
              onChange={e => { setPinValue(e.target.value.replace(/\D/g, "")); setAuthErr(null); }}
              autoFocus={!walletBioActive}
              maxLength={8}
            />
            {authErr && <p className="cwp-field-err">{authErr}</p>}
          </div>
        )}

        {/* ════════════════════════════════════════════════════════════
            STEP 6 — Invio in corso
        ═══════════════════════════════════════════════════════════════ */}
        {step === "sending" && (
          <div className="cwp-step cwp-step-center">
            <div className="cwp-sending-spinner" />
            <p className="cwp-sending-label">Invio in corso…</p>
            <p className="cwp-sending-sub">
              Trasmissione della transazione su{" "}
              <strong style={{ color: netColor }}>{NETWORK_LABELS[network]}</strong>
            </p>
          </div>
        )}

        {/* ════════════════════════════════════════════════════════════
            SUCCESS
        ═══════════════════════════════════════════════════════════════ */}
        {step === "success" && (
          <div className="cwp-step cwp-step-center">
            <div className="cwp-success-icon">✅</div>
            <p className="cwp-success-title">Pagamento inviato</p>
            <p className="cwp-success-sub">
              {amount} {asset.symbol} inviati a <strong>{displayName}</strong>
            </p>
            {txHash && explorerUrl && (
              <a
                className="cwp-success-tx"
                href={explorerUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                Visualizza sulla blockchain →
              </a>
            )}
          </div>
        )}

      </div>{/* /awp-content */}

      {/* ════════════════════════════════════════════════════════════
          FOOTER — strutturalmente fuori da awp-content.
          flex-shrink:0 garantisce che il CTA sia SEMPRE visibile
          indipendentemente dall'altezza del contenuto dello step.
      ═══════════════════════════════════════════════════════════════ */}
      <div className="awp-footer">

        {/* Step 1 — solo quando c'è un'azione primaria */}
        {step === "recipient" && (recipientMode === "found" || recipientMode === "manual") && (
          <button
            className="cwp-btn-primary"
            style={{ background: netColor }}
            onClick={goNext}
            disabled={recipientMode === "found" && !autoAddress}
          >
            Continua →
          </button>
        )}

        {/* Step 2 */}
        {step === "asset" && (
          <>
            <button className="cwp-btn-back" onClick={goBack}>← Indietro</button>
            <button className="cwp-btn-primary" style={{ background: netColor }} onClick={goNext}>
              Continua →
            </button>
          </>
        )}

        {/* Step 3 */}
        {step === "amount" && (
          <>
            <button className="cwp-btn-back" onClick={goBack}>← Indietro</button>
            <button
              className="cwp-btn-primary"
              style={{ background: netColor }}
              onClick={handleGoToSummary}
              disabled={quoteLoading}
            >
              {quoteLoading ? "Calcolo…" : "Calcola costi →"}
            </button>
          </>
        )}

        {/* Step 4 */}
        {step === "summary" && quote && (
          <>
            <button className="cwp-btn-back" onClick={goBack}>← Modifica</button>
            <button
              className="cwp-btn-primary"
              style={{ background: netColor }}
              onClick={handleSend}
              disabled={sending || bridge.sendInProgress}
            >
              🔐 Firma e invia
            </button>
          </>
        )}

        {/* Step 4 senza quote — fallback: consenti ricalcolo o ritorno */}
        {step === "summary" && !quote && (
          <>
            <button className="cwp-btn-back" onClick={goBack}>← Modifica</button>
            <button
              className="cwp-btn-primary"
              style={{ background: netColor }}
              onClick={handleGoToSummary}
              disabled={quoteLoading}
            >
              {quoteLoading ? "Calcolo…" : "Ricalcola i costi"}
            </button>
          </>
        )}

        {/* Step 5 — auth */}
        {step === "auth" && (
          <>
            <button className="cwp-btn-back" onClick={handlePinCancel}>Annulla</button>
            {walletBioActive && (
              <button
                type="button"
                className="cwp-btn-bio"
                onClick={handleBioAuth}
                aria-label="Face ID"
              >
                🪪 Face ID
              </button>
            )}
            <button
              className="cwp-btn-primary"
              style={{ background: netColor }}
              onClick={handlePinSubmit}
            >
              Firma e invia
            </button>
          </>
        )}

        {/* Success */}
        {step === "success" && (
          <button className="cwp-btn-primary" style={{ background: netColor }} onClick={onClose}>
            Chiudi
          </button>
        )}

      </div>{/* /awp-footer */}

    </div>{/* /cwp-sheet */}
    </div>
  );
}
