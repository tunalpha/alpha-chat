/**
 * ChatWalletPaySheet — Phase G
 *
 * Bottom sheet per avviare un pagamento self-custodial da Alpha Wallet.
 * Mostra la selezione rete/asset, importo, indirizzo destinatario,
 * breakdown fee (Platform Fee + Network Fee + Totale) e gestisce
 * il ciclo: quote → conferma → PIN → sendPayment → risultato.
 *
 * SICUREZZA (regola §16):
 *   Il PIN è raccolto qui tramite onAuthRequired callback e mai
 *   esposto al bridge o alla ChatPage.
 *
 * ISOLAMENTO:
 *   Importa solo da bridge/chat-wallet-bridge (superficie pubblica).
 */

import {
  useState,
  useEffect,
  useCallback,
  useRef,
  type FormEvent,
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
import "./ChatWalletPaySheet.css";

// ─── Props ────────────────────────────────────────────────────────────────

interface Props {
  /** Address destinatario pre-compilato dal profilo del contatto */
  prefillRecipient?: string;
  /** Conversazione corrente — per associare la TX al messaggio */
  conversationId?:   string;
  onClose:           () => void;
  onSent:            (result: ChatPaymentResult) => void;
}

// ─── Asset option (semplificato Phase G) ─────────────────────────────────

interface AssetOption {
  symbol:          string;
  name:            string;
  contractAddress: string | null;
}

const ASSETS_BY_NETWORK: Record<SupportedNetwork, AssetOption[]> = {
  polygon: [
    { symbol: "POL",  name: "POL (nativo)",        contractAddress: null },
    { symbol: "USDT", name: "Tether (USDT)",        contractAddress: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F" },
    { symbol: "USDC", name: "USD Coin (USDC)",       contractAddress: "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174" },
    { symbol: "USDA", name: "USDA (stablecoin)",     contractAddress: "0x4F51E5416EFf9B91FCE28Be3C63d714f34b59c76" },
  ],
  ethereum: [
    { symbol: "ETH",  name: "Ether (nativo)",        contractAddress: null },
    { symbol: "USDT", name: "Tether (USDT)",          contractAddress: "0xdAC17F958D2ee523a2206206994597C13D831ec7" },
    { symbol: "USDC", name: "USD Coin (USDC)",         contractAddress: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" },
  ],
  bsc: [
    { symbol: "BNB",  name: "BNB (nativo)",           contractAddress: null },
    { symbol: "USDT", name: "Tether BSC (USDT)",       contractAddress: "0x55d398326f99059fF775485246999027B3197955" },
    { symbol: "USDC", name: "USD Coin BSC (USDC)",      contractAddress: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d" },
  ],
  bitcoin: [
    { symbol: "BTC",  name: "Bitcoin",                contractAddress: null },
  ],
};

// ─── Component ────────────────────────────────────────────────────────────

export function ChatWalletPaySheet({ prefillRecipient, conversationId, onClose, onSent }: Props) {
  const bridge = useChatWalletBridge();

  // ── Form state ──────────────────────────────────────────────────────
  const [network,    setNetwork]    = useState<SupportedNetwork>("polygon");
  const [assetIdx,   setAssetIdx]   = useState(0);
  const [amount,     setAmount]     = useState("");
  const [recipient,  setRecipient]  = useState(prefillRecipient ?? "");
  const [amountErr,  setAmountErr]  = useState<string | null>(null);
  const [recipErr,   setRecipErr]   = useState<string | null>(null);

  // ── Quote state ──────────────────────────────────────────────────────
  const [quote,      setQuote]      = useState<PaymentQuote | null>(null);
  const [quoteAge,   setQuoteAge]   = useState(0);  // seconds since fetch
  const [quoteLoading, setQuoteLoading] = useState(false);
  const quoteTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Auth modal state ─────────────────────────────────────────────────
  const [showAuth, setShowAuth] = useState(false);
  const [pin,      setPin]      = useState("");
  const [authErr,  setAuthErr]  = useState<string | null>(null);
  const pinResolveRef = useRef<((pin: string | null) => void) | null>(null);

  // ── Send state ───────────────────────────────────────────────────────
  const [sending,  setSending]  = useState(false);
  const [sendErr,  setSendErr]  = useState<string | null>(null);

  const assets  = ASSETS_BY_NETWORK[network];
  const asset   = assets[Math.min(assetIdx, assets.length - 1)];
  const netColor = NETWORK_COLORS[network];

  // ── Reset asset when network changes ────────────────────────────────
  useEffect(() => { setAssetIdx(0); setQuote(null); }, [network]);
  useEffect(() => { setQuote(null); }, [amount, asset]);

  // ── Quote countdown timer ────────────────────────────────────────────
  useEffect(() => {
    if (!quote) { setQuoteAge(0); return; }
    setQuoteAge(0);
    const interval = setInterval(() => {
      const age = Math.floor((Date.now() - quote.frozenAt) / 1000);
      setQuoteAge(age);
      if (age >= quote.quoteValiditySec) {
        setQuote(null); // force refresh
        clearInterval(interval);
      }
    }, 1000);
    quoteTimer.current = interval;
    return () => clearInterval(interval);
  }, [quote]);

  // ── Calcola quote ────────────────────────────────────────────────────
  const handleCalculate = useCallback(async () => {
    // Validazione base
    let valid = true;
    const amt = parseFloat(amount);
    if (!amount || isNaN(amt) || amt <= 0) {
      setAmountErr("Inserisci un importo valido"); valid = false;
    } else {
      setAmountErr(null);
    }
    if (!recipient.trim()) {
      setRecipErr("Inserisci l'indirizzo destinatario"); valid = false;
    } else if (
      network !== "bitcoin" && !/^0x[0-9a-fA-F]{40}$/.test(recipient)
    ) {
      setRecipErr("Indirizzo EVM non valido (0x + 40 hex)"); valid = false;
    } else if (
      network === "bitcoin" && !/^(bc1|[13])[a-zA-Z0-9]{25,87}$/.test(recipient)
    ) {
      setRecipErr("Indirizzo Bitcoin non valido"); valid = false;
    } else {
      setRecipErr(null);
    }
    if (!valid) return;

    setQuoteLoading(true);
    try {
      const q = await bridge.calculateQuote(network, asset.contractAddress, asset.symbol, amount);
      setQuote(q);
    } finally {
      setQuoteLoading(false);
    }
  }, [bridge, network, asset, amount, recipient]);

  // ── Auth callback per sendPayment ────────────────────────────────────
  const onAuthRequired = useCallback((): Promise<string | null> => {
    return new Promise(resolve => {
      pinResolveRef.current = resolve;
      setPin("");
      setAuthErr(null);
      setShowAuth(true);
    });
  }, []);

  const handleAuthSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!pin || pin.length < 4) { setAuthErr("PIN troppo corto"); return; }
    if (pinResolveRef.current) {
      pinResolveRef.current(pin);
      pinResolveRef.current = null;
    }
    setShowAuth(false);
  };

  const handleAuthCancel = () => {
    if (pinResolveRef.current) {
      pinResolveRef.current(null);
      pinResolveRef.current = null;
    }
    setShowAuth(false);
  };

  // ── Invia pagamento ──────────────────────────────────────────────────
  const handleSend = useCallback(async () => {
    if (!quote) { void handleCalculate(); return; }
    // Check quote non scaduta
    const age = (Date.now() - quote.frozenAt) / 1000;
    if (age >= quote.quoteValiditySec) {
      setQuote(null); setSendErr("Quote scaduta. Ricalcola i costi."); return;
    }

    setSendErr(null);
    setSending(true);

    const request: ChatPaymentRequest = {
      network,
      tokenContractAddress: asset.contractAddress,
      assetSymbol:          asset.symbol,
      amount,
      recipientAddress:     recipient,
      frozenQuote:          quote,
      metadata:             { conversationId },
    };

    const result = await bridge.sendPayment(request, onAuthRequired);
    setSending(false);

    if (result.status === "cancelled") return; // utente ha annullato il PIN

    if (result.status === "sent" || result.status === "confirmed") {
      onSent(result);
    } else {
      setSendErr(result.errorMessage ?? "Pagamento fallito. Riprova.");
    }
  }, [bridge, quote, network, asset, amount, recipient, conversationId, onAuthRequired, handleCalculate, onSent]);

  const quoteSecondsLeft = quote ? Math.max(0, quote.quoteValiditySec - quoteAge) : 0;

  return (
    <>
      {/* ── Main sheet ─────────────────────────────────────────────── */}
      <div className="cwp-backdrop" onClick={onClose}>
        <div className="cwp-sheet" onClick={e => e.stopPropagation()}>

          {/* Header */}
          <div className="cwp-header">
            <span className="cwp-title">💸 Paga con Wallet</span>
            <button className="cwp-close" onClick={onClose} aria-label="Chiudi">✕</button>
          </div>

          <div className="cwp-body">
            {/* Network selector */}
            <div className="cwp-section">
              <label className="cwp-label">Rete</label>
              <div className="cwp-network-tabs">
                {(["polygon", "ethereum", "bsc", "bitcoin"] as SupportedNetwork[]).map(net => (
                  <button
                    key={net}
                    className={`cwp-net-tab ${network === net ? "active" : ""}`}
                    style={network === net ? { background: `${NETWORK_COLORS[net]}22`, borderColor: NETWORK_COLORS[net], color: NETWORK_COLORS[net] } : {}}
                    onClick={() => setNetwork(net)}
                  >
                    {NETWORK_LABELS[net]}
                  </button>
                ))}
              </div>
            </div>

            {/* Asset selector */}
            <div className="cwp-section">
              <label className="cwp-label">Asset</label>
              <select
                className="cwp-select"
                value={assetIdx}
                onChange={e => setAssetIdx(Number(e.target.value))}
              >
                {assets.map((a, i) => (
                  <option key={a.symbol} value={i}>{a.symbol} — {a.name}</option>
                ))}
              </select>
            </div>

            {/* Amount */}
            <div className="cwp-section">
              <label className="cwp-label">Importo</label>
              <div className="cwp-amount-row">
                <input
                  className={`cwp-input ${amountErr ? "error" : ""}`}
                  type="number"
                  min="0"
                  step="any"
                  placeholder="0.00"
                  value={amount}
                  onChange={e => { setAmount(e.target.value); setQuote(null); }}
                />
                <span className="cwp-amount-symbol">{asset.symbol}</span>
              </div>
              {amountErr && <p className="cwp-field-err">{amountErr}</p>}
            </div>

            {/* Recipient */}
            <div className="cwp-section">
              <label className="cwp-label">Destinatario</label>
              <input
                className={`cwp-input ${recipErr ? "error" : ""}`}
                type="text"
                placeholder={network === "bitcoin" ? "bc1q..." : "0x..."}
                value={recipient}
                onChange={e => { setRecipient(e.target.value); setQuote(null); }}
                spellCheck={false}
              />
              {recipErr && <p className="cwp-field-err">{recipErr}</p>}
            </div>

            {/* Fee breakdown */}
            {quote ? (
              <div className="cwp-quote">
                <div className="cwp-quote-header">
                  <span>Riepilogo costi</span>
                  <span className={`cwp-quote-timer ${quoteSecondsLeft < 10 ? "expiring" : ""}`}>
                    ⏱ {quoteSecondsLeft}s
                  </span>
                </div>
                <div className="cwp-quote-row">
                  <span>Destinatario</span>
                  <span>{quote.recipientAmount} {asset.symbol}</span>
                </div>
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
                    <span>+ Network fee</span>
                    <span>~{quote.networkFee} {quote.networkFeeSymbol}</span>
                  </div>
                )}
              </div>
            ) : (
              <button
                className="cwp-btn-secondary"
                onClick={handleCalculate}
                disabled={quoteLoading}
              >
                {quoteLoading ? "Calcolo in corso…" : "Calcola costi"}
              </button>
            )}

            {/* Error */}
            {sendErr && <p className="cwp-send-err">{sendErr}</p>}

            {/* CTA */}
            <button
              className="cwp-btn-primary"
              style={{ background: netColor }}
              onClick={handleSend}
              disabled={sending || bridge.sendInProgress}
            >
              {sending ? "Invio in corso…" : quote ? "Conferma e Invia →" : "Calcola costi prima"}
            </button>
          </div>
        </div>
      </div>

      {/* ── PIN auth modal ──────────────────────────────────────────── */}
      {showAuth && (
        <div className="cwp-auth-backdrop">
          <div className="cwp-auth-modal">
            <h3 className="cwp-auth-title">🔐 Conferma con PIN</h3>
            <p className="cwp-auth-sub">Inserisci il tuo PIN per autorizzare la transazione</p>
            <form onSubmit={handleAuthSubmit}>
              <input
                className="cwp-auth-pin"
                type="password"
                inputMode="numeric"
                pattern="[0-9]*"
                placeholder="PIN"
                value={pin}
                onChange={e => setPin(e.target.value.replace(/\D/g, ""))}
                autoFocus
                maxLength={8}
              />
              {authErr && <p className="cwp-field-err">{authErr}</p>}
              <div className="cwp-auth-actions">
                <button type="button" className="cwp-btn-secondary" onClick={handleAuthCancel}>
                  Annulla
                </button>
                <button type="submit" className="cwp-btn-primary" style={{ background: netColor }}>
                  Autorizza
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
