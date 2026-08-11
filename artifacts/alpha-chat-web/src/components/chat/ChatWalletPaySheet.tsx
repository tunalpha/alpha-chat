/**
 * ChatWalletPaySheet — Task #93 (Recipient Wallet Discovery)
 *
 * Tre casi:
 *   A — destinatario ha Alpha Wallet → address auto-risolto, no digitazione
 *   B — destinatario NON ha Alpha Wallet → nessuna TX; messaggio di invito
 *   C — indirizzo esterno (manuale) → campo libero + avviso rete esplicito
 *
 * SICUREZZA (regola §16):
 *   Il PIN è raccolto qui tramite onAuthRequired callback e mai
 *   esposto al bridge o alla ChatPage.
 *
 * SICUREZZA (regola §12 anti-remote-trigger):
 *   Solo un'azione esplicita dell'utente può avviare sendPayment().
 *   Nessun evento WebSocket può triggerare firma o broadcast.
 *
 * ISOLAMENTO:
 *   Importa solo da bridge/chat-wallet-bridge (superficie pubblica)
 *   e da alpha-wallet-api (solo apiWalletGetRecipient).
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
import {
  apiWalletGetRecipient,
  type RecipientWalletInfo,
} from "../../lib/alpha-wallet-api";
import "./ChatWalletPaySheet.css";

// ─── Props ────────────────────────────────────────────────────────────────

interface Props {
  /** userId del destinatario della conversazione — usato per il lookup automatico */
  recipientUserId?:  string;
  /** Nome visualizzato del destinatario — per UX */
  recipientName?:    string;
  /** Address destinatario pre-compilato (Caso C — uso manuale) */
  prefillRecipient?: string;
  /** Conversazione corrente — per associare la TX al messaggio */
  conversationId?:   string;
  onClose:           () => void;
  onSent:            (result: ChatPaymentResult) => void;
  /** Caso B: invia messaggio di invito in chat quando il destinatario non ha Alpha Wallet */
  onSendInvite?:     (message: string) => void;
}

// ─── Asset option ──────────────────────────────────────────────────────────

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
    { symbol: "USDA", name: "USDA (stablecoin)",     contractAddress: "0xe714655fD1B3ba96B887DF1F94336c2A78E24001" },
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

// ─── Recipient mode ────────────────────────────────────────────────────────

type RecipientMode = "loading" | "found" | "not-found" | "manual";

// ─── Helpers ──────────────────────────────────────────────────────────────

/** Restituisce l'indirizzo corretto per la rete selezionata */
function pickAddress(info: RecipientWalletInfo | null, network: SupportedNetwork): string | null {
  if (!info) return null;
  if (network === "bitcoin") return info.btcAddress ?? null;
  return info.evmAddress ?? null;
}

/** Tronca un address per la visualizzazione */
function truncateAddress(addr: string): string {
  if (addr.length <= 14) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-6)}`;
}

// ─── Component ────────────────────────────────────────────────────────────

export function ChatWalletPaySheet({
  recipientUserId,
  recipientName,
  prefillRecipient,
  conversationId,
  onClose,
  onSent,
  onSendInvite,
}: Props) {
  const bridge = useChatWalletBridge();

  // ── Network / asset ──────────────────────────────────────────────────
  const [network,  setNetwork]  = useState<SupportedNetwork>("polygon");
  const [assetIdx, setAssetIdx] = useState(0);

  // ── Recipient discovery state ────────────────────────────────────────
  const [recipientMode, setRecipientMode] = useState<RecipientMode>(
    recipientUserId ? "loading" : "manual",
  );
  const [recipientInfo, setRecipientInfo] = useState<RecipientWalletInfo | null>(null);

  // ── Form state ───────────────────────────────────────────────────────
  // In Caso A: vuoto (usato autoAddress); Caso C: editabile
  const [manualAddress, setManualAddress] = useState(prefillRecipient ?? "");
  const [amountErr,     setAmountErr]     = useState<string | null>(null);
  const [recipErr,      setRecipErr]      = useState<string | null>(null);
  const [amount,        setAmount]        = useState("");

  // ── Quote state ──────────────────────────────────────────────────────
  const [quote,        setQuote]        = useState<PaymentQuote | null>(null);
  const [quoteAge,     setQuoteAge]     = useState(0);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteErr,     setQuoteErr]     = useState<string | null>(null);
  const quoteTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Auth modal state ─────────────────────────────────────────────────
  const [showAuth, setShowAuth] = useState(false);
  const [pin,      setPin]      = useState("");
  const [authErr,  setAuthErr]  = useState<string | null>(null);
  const pinResolveRef = useRef<((pin: string | null) => void) | null>(null);

  // ── Send state ───────────────────────────────────────────────────────
  const [sending, setSending] = useState(false);
  const [sendErr, setSendErr] = useState<string | null>(null);

  const assets   = ASSETS_BY_NETWORK[network];
  const asset    = assets[Math.min(assetIdx, assets.length - 1)];
  const netColor = NETWORK_COLORS[network];

  // ── Indirizzo effettivo (A: auto, C: manuale) ────────────────────────
  const autoAddress = pickAddress(recipientInfo, network);
  const effectiveAddress = recipientMode === "found"
    ? (autoAddress ?? "")
    : manualAddress;

  // ── Fetch recipient su mount (se recipientUserId presente) ───────────
  useEffect(() => {
    if (!recipientUserId) {
      setRecipientMode("manual");
      return;
    }
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
  useEffect(() => { setQuote(null); }, [amount, asset]);

  // ── In Caso A: quando cambia rete, invalida quote (address potrebbe cambiare) ──
  useEffect(() => {
    if (recipientMode === "found") setQuote(null);
  }, [network, recipientMode]);

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
      }
    }, 1000);
    quoteTimer.current = interval;
    return () => clearInterval(interval);
  }, [quote]);

  // ── Calcola quote ────────────────────────────────────────────────────
  const handleCalculate = useCallback(async () => {
    let valid = true;
    const amt = parseFloat(amount);
    if (!amount || isNaN(amt) || amt <= 0) {
      setAmountErr("Inserisci un importo valido"); valid = false;
    } else {
      setAmountErr(null);
    }

    // Validazione indirizzo — solo in Caso C (manuale)
    if (recipientMode === "manual") {
      const addr = manualAddress.trim();
      if (!addr) {
        setRecipErr("Inserisci l'indirizzo destinatario"); valid = false;
      } else if (network !== "bitcoin" && !/^0x[0-9a-fA-F]{40}$/.test(addr)) {
        setRecipErr("Indirizzo EVM non valido (0x + 40 hex)"); valid = false;
      } else if (network === "bitcoin" && !/^(bc1|[13])[a-zA-Z0-9]{25,87}$/.test(addr)) {
        setRecipErr("Indirizzo Bitcoin non valido"); valid = false;
      } else {
        setRecipErr(null);
      }
    } else if (recipientMode === "found" && !autoAddress) {
      setRecipErr(
        network === "bitcoin"
          ? `${recipientName ?? "Il destinatario"} non ha un indirizzo Bitcoin configurato. Scegli un'altra rete.`
          : "Indirizzo non disponibile per questa rete.",
      );
      valid = false;
    } else {
      setRecipErr(null);
    }

    if (!valid) return;

    setQuoteErr(null);
    setQuoteLoading(true);
    try {
      const q = await bridge.calculateQuote(network, asset.contractAddress, asset.symbol, amount);
      setQuote(q);
    } catch (e) {
      setQuoteErr(e instanceof Error ? e.message : "Errore nel calcolo dei costi. Riprova.");
    } finally {
      setQuoteLoading(false);
    }
  }, [bridge, network, asset, amount, manualAddress, recipientMode, autoAddress, recipientName]);

  // ── Auth callback ────────────────────────────────────────────────────
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
  // REGOLA §12: solo questa azione esplicita dell'utente può avviare sendPayment()
  const handleSend = useCallback(async () => {
    if (!quote) return; // non dovrebbe accadere: il bottone primario ora chiama handleCalculate se !quote
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
      recipientAddress:     effectiveAddress,
      frozenQuote:          quote,
      metadata:             { conversationId },
    };

    const result = await bridge.sendPayment(request, onAuthRequired);
    setSending(false);

    if (result.status === "cancelled") return;

    if (result.status === "sent" || result.status === "confirmed") {
      onSent(result);
    } else {
      setSendErr(result.errorMessage ?? "Pagamento fallito. Riprova.");
    }
  }, [bridge, quote, network, asset, amount, effectiveAddress, conversationId, onAuthRequired, handleCalculate, onSent]);

  const quoteSecondsLeft = quote ? Math.max(0, quote.quoteValiditySec - quoteAge) : 0;
  const displayName = recipientName ?? "il destinatario";

  // ─────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────

  return (
    <>
      {/* ── Main sheet ──────────────────────────────────────────────── */}
      <div className="cwp-backdrop" onClick={onClose}>
        <div className="cwp-sheet" onClick={e => e.stopPropagation()}>

          {/* Header */}
          <div className="cwp-header">
            <span className="cwp-title">🔐 Paga con Alpha Wallet</span>
            <button className="cwp-close" onClick={onClose} aria-label="Chiudi">✕</button>
          </div>

          <div className="cwp-body">

            {/* ── CASO B — destinatario senza Alpha Wallet ──────────── */}
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

                {/* Invita in chat — Bug 2 fix */}
                {onSendInvite && (
                  <button
                    className="cwp-btn-invite"
                    onClick={() => {
                      const name = recipientName ?? "il destinatario";
                      onSendInvite(
                        `👋 Ciao ${name}! Per ricevere pagamenti diretti tramite Alpha Wallet, configura il tuo wallet su Alpha Chat: Impostazioni → Alpha Wallet. È gratuito e richiede meno di un minuto. 🔐`,
                      );
                      onClose();
                    }}
                  >
                    📩 Invita {recipientName ?? "il destinatario"} su Alpha Wallet
                  </button>
                )}

                <button
                  className="cwp-btn-secondary"
                  onClick={() => {
                    setRecipientMode("manual");
                    setRecipErr(null);
                  }}
                >
                  Usa indirizzo esterno →
                </button>
                <p className="cwp-no-wallet-note">
                  Se il destinatario ha un wallet esterno (MetaMask, Trust Wallet, ecc.),
                  puoi inviare direttamente al suo indirizzo.
                </p>
              </div>
            )}

            {/* ── CASO A/C — form pagamento ─────────────────────────── */}
            {(recipientMode === "loading" || recipientMode === "found" || recipientMode === "manual") && (
              <>
                {/* Loading state */}
                {recipientMode === "loading" && (
                  <div className="cwp-recipient-loading">
                    <span className="cwp-loading-spinner" /> Verifica wallet destinatario…
                  </div>
                )}

                {/* CASO A — recipient info card */}
                {recipientMode === "found" && (
                  <div className="cwp-recipient-card">
                    <div className="cwp-recipient-badge">Alpha Wallet ✓</div>
                    <div className="cwp-recipient-name">
                      {recipientName ?? "Destinatario"}
                    </div>
                    {autoAddress ? (
                      <div className="cwp-recipient-address" title={autoAddress}>
                        {truncateAddress(autoAddress)}
                      </div>
                    ) : (
                      <div className="cwp-recipient-no-address">
                        Nessun indirizzo per questa rete
                      </div>
                    )}
                  </div>
                )}

                {/* CASO C — link per tornare a not-found (se era not-found) */}
                {recipientMode === "manual" && recipientUserId && (
                  <div className="cwp-manual-notice">
                    ⚠️ Indirizzo esterno — verifica rete e indirizzo prima di confermare.
                  </div>
                )}

                {/* Network selector */}
                <div className="cwp-section">
                  <label className="cwp-label">Rete</label>
                  <div className="cwp-network-tabs">
                    {(["polygon", "ethereum", "bsc", "bitcoin"] as SupportedNetwork[]).map(net => (
                      <button
                        key={net}
                        className={`cwp-net-tab ${network === net ? "active" : ""}`}
                        style={network === net
                          ? { background: `${NETWORK_COLORS[net]}22`, borderColor: NETWORK_COLORS[net], color: NETWORK_COLORS[net] }
                          : {}}
                        onClick={() => setNetwork(net)}
                        disabled={recipientMode === "loading"}
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
                    disabled={recipientMode === "loading"}
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
                      disabled={recipientMode === "loading"}
                    />
                    <span className="cwp-amount-symbol">{asset.symbol}</span>
                  </div>
                  {amountErr && <p className="cwp-field-err">{amountErr}</p>}
                </div>

                {/* CASO A — address locked (non modificabile) */}
                {recipientMode === "found" && (
                  <div className="cwp-section">
                    <label className="cwp-label">Destinatario</label>
                    {autoAddress ? (
                      <div className="cwp-address-locked" title={autoAddress}>
                        <span className="cwp-address-locked-icon">🔒</span>
                        <span className="cwp-address-locked-text">{autoAddress}</span>
                      </div>
                    ) : (
                      <div className="cwp-no-address-warning">
                        <span>⚠️ {recipientName ?? "Il destinatario"} non ha un indirizzo {network === "bitcoin" ? "Bitcoin" : "EVM"} configurato.</span>
                        {network === "bitcoin" && (
                          <span className="cwp-no-address-hint"> Scegli Polygon, Ethereum o BNB.</span>
                        )}
                      </div>
                    )}
                    {recipErr && <p className="cwp-field-err">{recipErr}</p>}
                  </div>
                )}

                {/* CASO C — address manuale */}
                {recipientMode === "manual" && (
                  <div className="cwp-section">
                    <label className="cwp-label">Destinatario</label>
                    <input
                      className={`cwp-input ${recipErr ? "error" : ""}`}
                      type="text"
                      placeholder={network === "bitcoin" ? "bc1q..." : "0x..."}
                      value={manualAddress}
                      onChange={e => { setManualAddress(e.target.value); setQuote(null); setRecipErr(null); }}
                      spellCheck={false}
                    />
                    {recipErr && <p className="cwp-field-err">{recipErr}</p>}
                  </div>
                )}

                {/* Fee breakdown + riepilogo pre-firma */}
                {quote && (
                  <div className="cwp-quote">
                    {/* Header riepilogo — RETE + ADDRESS SEMPRE ESPLICITI (spec §4 e §11) */}
                    <div className="cwp-quote-confirm-header">
                      <span className="cwp-quote-confirm-title">🔐 Conferma pagamento</span>
                    </div>

                    {/* Destinatario + rete */}
                    <div className="cwp-quote-confirm-dest">
                      <span className="cwp-quote-confirm-label">
                        {recipientMode === "found" && recipientName
                          ? <strong>{recipientName}</strong>
                          : "Destinatario"}
                        {" "}riceverà{" "}
                        <strong>{quote.recipientAmount} {asset.symbol}</strong>
                        {" "}su{" "}
                        <strong style={{ color: netColor }}>{NETWORK_LABELS[network]}</strong>
                      </span>
                    </div>

                    {/* Address esplicito */}
                    <div className="cwp-quote-address-row">
                      <span className="cwp-quote-addr-label">Destinatario</span>
                      <span className="cwp-quote-addr-value" title={effectiveAddress}>
                        {truncateAddress(effectiveAddress)}
                      </span>
                    </div>

                    <div className="cwp-quote-divider" />

                    <div className="cwp-quote-header">
                      <span>Riepilogo costi</span>
                      <span className={`cwp-quote-timer ${quoteSecondsLeft < 10 ? "expiring" : ""}`}>
                        ⏱ {quoteSecondsLeft}s
                      </span>
                    </div>
                    <div className="cwp-quote-row">
                      <span>Importo destinatario</span>
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

                    {/* Avviso rete per indirizzo manuale (Caso C) */}
                    {recipientMode === "manual" && (
                      <div className="cwp-manual-confirm-warning">
                        ⚠️ Stai inviando <strong>{asset.symbol}</strong> su{" "}
                        <strong>{NETWORK_LABELS[network]}</strong>.
                        Verifica che l'indirizzo destinatario appartenga alla rete corretta.
                      </div>
                    )}
                  </div>
                )}

                {quoteErr && <p className="cwp-quote-err">{quoteErr}</p>}
                {sendErr && <p className="cwp-send-err">{sendErr}</p>}

                {/* CTA — solo dopo azione esplicita dell'utente (§12)
                    Se non c'è quote: chiama handleCalculate direttamente (Bug 1 fix).
                    Se c'è quote: chiama handleSend per la firma.              */}
                <button
                  className="cwp-btn-primary"
                  style={{ background: quote ? netColor : undefined }}
                  onClick={quote ? handleSend : handleCalculate}
                  disabled={
                    sending ||
                    quoteLoading ||
                    bridge.sendInProgress ||
                    recipientMode === "loading" ||
                    (recipientMode === "found" && !autoAddress)
                  }
                >
                  {sending
                    ? "Invio in corso…"
                    : quoteLoading
                      ? "Calcolo in corso…"
                      : quote
                        ? `Conferma e Invia su ${NETWORK_LABELS[network]} →`
                        : "Calcola costi"}
                </button>
              </>
            )}

          </div>{/* /cwp-body */}
        </div>
      </div>

      {/* ── PIN auth modal ──────────────────────────────────────────── */}
      {showAuth && (
        <div className="cwp-auth-backdrop">
          <div className="cwp-auth-modal">
            <h3 className="cwp-auth-title">🔐 Conferma con PIN</h3>
            <p className="cwp-auth-sub">
              {recipientName
                ? <>Stai inviando <strong>{amount} {asset.symbol}</strong> a{" "}<strong>{recipientName}</strong> su <strong>{NETWORK_LABELS[network]}</strong></>
                : <>Inserisci il tuo PIN per autorizzare la transazione</>}
            </p>
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
