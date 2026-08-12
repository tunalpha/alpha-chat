/**
 * ChatWalletRequestSheet — Richiedi con Alpha Wallet
 *
 * Wizard semplificato (no PIN, no quote):
 *   network → asset → amount → confirm → sending → success
 *
 * Non accede mai a chiavi private, seed, PIN, keystore.
 * Usa solo bridge.getReceiveAddress() (indirizzo pubblico).
 *
 * ISOLAMENTO: importa solo da bridge/chat-wallet-bridge e alpha-wallet-api.
 */

import { useState, useEffect, useCallback } from "react";
import { useChatWalletBridge } from "../../wallet/bridge/chat-wallet-bridge-context";
import type { SupportedNetwork } from "../../wallet/bridge/chat-wallet-bridge";
import { NETWORK_LABELS, NETWORK_COLORS } from "../../wallet/bridge/chat-wallet-bridge";
import {
  apiCreateAlphaWalletPaymentRequest,
} from "../../lib/alpha-wallet-api";
import type { WalletRequestMeta } from "./ChatWalletRequestBubble";
import "./ChatWalletPaySheet.css"; // riusa stili identici

// ─── Assets (specchiato da ChatWalletPaySheet) ────────────────────────────

interface AssetOption {
  symbol:          string;
  name:            string;
  icon:            string;
  contractAddress: string | null;
}

const ASSETS_BY_NETWORK: Record<SupportedNetwork, AssetOption[]> = {
  polygon: [
    { symbol: "USDA", name: "USDA (stablecoin)",   icon: "🟡", contractAddress: "0xe714655fD1B3ba96B887DF1F94336c2A78E24001" },
    { symbol: "USDT", name: "Tether (USDT)",        icon: "💵", contractAddress: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F" },
    { symbol: "USDC", name: "USD Coin (USDC)",       icon: "💎", contractAddress: "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174" },
    { symbol: "POL",  name: "POL (nativo)",          icon: "🔷", contractAddress: null },
  ],
  ethereum: [
    { symbol: "ETH",  name: "Ether (nativo)",       icon: "⬡",  contractAddress: null },
    { symbol: "USDT", name: "Tether (USDT)",         icon: "💵", contractAddress: "0xdAC17F958D2ee523a2206206994597C13D831ec7" },
    { symbol: "USDC", name: "USD Coin (USDC)",        icon: "💎", contractAddress: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" },
  ],
  bsc: [
    { symbol: "BNB",  name: "BNB (nativo)",          icon: "🟡", contractAddress: null },
    { symbol: "USDT", name: "Tether BSC (USDT)",      icon: "💵", contractAddress: "0x55d398326f99059fF775485246999027B3197955" },
    { symbol: "USDC", name: "USD Coin BSC (USDC)",     icon: "💎", contractAddress: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d" },
  ],
  bitcoin: [
    { symbol: "BTC",  name: "Bitcoin",               icon: "₿",  contractAddress: null },
  ],
};

const NETWORKS: SupportedNetwork[] = ["polygon", "ethereum", "bsc", "bitcoin"];

// ─── Types ────────────────────────────────────────────────────────────────

interface Props {
  payerUserId:   string;
  payerName?:    string;
  conversationId: string;
  onClose:       () => void;
  onRequested:   (requestId: string, meta: WalletRequestMeta) => void;
}

type Step =
  | "network"
  | "asset"
  | "amount"
  | "confirm"
  | "sending"
  | "success";

const STEP_LABELS: Partial<Record<Step, string>> = {
  network:  "Rete",
  asset:    "Asset",
  amount:   "Importo",
  confirm:  "Conferma richiesta",
  sending:  "Invio in corso…",
  success:  "Richiesta inviata",
};

// ─── Component ────────────────────────────────────────────────────────────

export function ChatWalletRequestSheet({
  payerUserId,
  payerName,
  conversationId,
  onClose,
  onRequested,
}: Props) {
  const bridge = useChatWalletBridge();

  const [step,     setStep]     = useState<Step>("network");
  const [network,  setNetwork]  = useState<SupportedNetwork>("polygon");
  const [assetIdx, setAssetIdx] = useState(0);
  const [amount,   setAmount]   = useState("");
  const [amountErr, setAmountErr] = useState<string | null>(null);
  const [sendErr,  setSendErr]  = useState<string | null>(null);

  // Indirizzo proprio per la rete selezionata (pubblico — no chiavi)
  const [myAddress, setMyAddress] = useState<string | null>(null);

  const assets   = ASSETS_BY_NETWORK[network];
  const asset    = assets[Math.min(assetIdx, assets.length - 1)];
  const netColor = NETWORK_COLORS[network];

  // Aggiorna indirizzo quando cambia la rete
  useEffect(() => {
    setAssetIdx(0);
    const addr = bridge.getReceiveAddress(network);
    setMyAddress(addr);
  }, [bridge, network]);

  const validateAmount = (): boolean => {
    const v = parseFloat(amount);
    if (!amount || isNaN(v) || v <= 0) {
      setAmountErr("Inserisci un importo valido");
      return false;
    }
    setAmountErr(null);
    return true;
  };

  const goBack = () => {
    setStep(s => {
      if (s === "asset")   return "network";
      if (s === "amount")  return "asset";
      if (s === "confirm") return "amount";
      return s;
    });
  };

  const handleConfirm = useCallback(async () => {
    if (!myAddress) {
      setSendErr("Indirizzo wallet non disponibile. Sblocca Alpha Wallet e riprova.");
      setStep("confirm");
      return;
    }

    setSendErr(null);
    setStep("sending");

    try {
      const expiresAt = Date.now() + 24 * 60 * 60 * 1000;
      const result = await apiCreateAlphaWalletPaymentRequest({
        payerUserId,
        conversationId,
        network,
        assetSymbol:      asset.symbol,
        amount,
        requesterAddress: myAddress,
      });

      const meta: WalletRequestMeta = {
        requestId:            result.requestId,
        network,
        assetSymbol:          asset.symbol,
        tokenContractAddress: asset.contractAddress,
        amount,
        requesterAddress:     myAddress,
        status:               "pending",
        expiresAt:            new Date(result.expiresAt).getTime() || expiresAt,
      };

      setStep("success");
      onRequested(result.requestId, meta);
    } catch (e) {
      setSendErr(e instanceof Error ? e.message : "Errore nell'invio della richiesta. Riprova.");
      setStep("confirm");
    }
  }, [bridge, myAddress, payerUserId, conversationId, network, asset, amount, onRequested]);

  const displayName = payerName ?? "il contatto";

  function truncate(addr: string) {
    if (addr.length <= 14) return addr;
    return `${addr.slice(0, 6)}…${addr.slice(-6)}`;
  }

  return (
    <div
      className="cwp-backdrop"
      onClick={e => {
        if (e.target === e.currentTarget && step !== "sending") onClose();
      }}
    >
    <div className="cwp-sheet" role="dialog" aria-modal="true">

      {/* ── Header ──────────────────────────────────────────────── */}
      <div className="awp-header">
        <button
          className="awp-back-btn"
          aria-label={step === "network" || step === "success" ? "Chiudi" : "Indietro"}
          disabled={step === "sending"}
          onClick={() => {
            if (step === "sending") return;
            if (step === "network" || step === "success") { onClose(); return; }
            goBack();
          }}
        >
          ←
        </button>
        <div className="awp-title-group">
          <span className="awp-title">📥 Richiedi con Alpha Wallet</span>
          {step !== "sending" && step !== "success" && (
            <span className="awp-step-label">{STEP_LABELS[step]}</span>
          )}
        </div>
        <div className="awp-header-spacer" aria-hidden="true" />
      </div>

      {/* ── Content ────────────────────────────────────────────── */}
      <div className="awp-content">

        {/* ═══ STEP 1 — Rete ═══════════════════════════════════════════ */}
        {step === "network" && (
          <div className="cwp-step">
            <p className="cwp-step-hint">
              Richiedi un pagamento a <strong>{displayName}</strong>.<br />
              Scegli la rete su cui vuoi ricevere.
            </p>
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
            {!myAddress && network !== "bitcoin" && (
              <p className="cwp-quote-err" style={{ marginTop: 8 }}>
                ⚠️ Nessun indirizzo trovato per questa rete. Sblocca Alpha Wallet prima di procedere.
              </p>
            )}
          </div>
        )}

        {/* ═══ STEP 2 — Asset ══════════════════════════════════════════ */}
        {step === "asset" && (
          <div className="cwp-step">
            <p className="cwp-step-hint">
              Seleziona l'asset che vuoi ricevere su{" "}
              <strong style={{ color: netColor }}>{NETWORK_LABELS[network]}</strong>
            </p>
            <div className="cwp-asset-list">
              {assets.map((a, i) => (
                <button
                  key={a.symbol}
                  className={`cwp-asset-btn ${assetIdx === i ? "active" : ""}`}
                  style={assetIdx === i ? { borderColor: netColor, background: `${netColor}12` } : {}}
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

        {/* ═══ STEP 3 — Importo ════════════════════════════════════════ */}
        {step === "amount" && (
          <div className="cwp-step">
            <div className="cwp-amount-context">
              <span className="cwp-ctx-pill" style={{ color: netColor, borderColor: `${netColor}50`, background: `${netColor}12` }}>
                {NETWORK_LABELS[network]}
              </span>
              <span className="cwp-ctx-pill">{asset.icon} {asset.symbol}</span>
              <span className="cwp-ctx-pill">← da {displayName}</span>
            </div>
            <div className="cwp-section">
              <label className="cwp-label">Quanto vuoi ricevere?</label>
              <div className="cwp-amount-row">
                <input
                  className={`cwp-input cwp-amount-input ${amountErr ? "error" : ""}`}
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="any"
                  placeholder="0.00"
                  value={amount}
                  onChange={e => { setAmount(e.target.value); setAmountErr(null); }}
                  autoFocus
                />
                <span className="cwp-amount-symbol">{asset.symbol}</span>
              </div>
              {amountErr && <p className="cwp-field-err">{amountErr}</p>}
            </div>
          </div>
        )}

        {/* ═══ STEP 4 — Confirm ════════════════════════════════════════ */}
        {step === "confirm" && (
          <div className="cwp-step">
            <div className="cwp-summary-hero">
              <span className="cwp-summary-hero-label">
                Richiedi a <strong>{displayName}</strong>
              </span>
              <span className="cwp-summary-hero-amount" style={{ color: netColor }}>
                {amount} {asset.symbol}
              </span>
            </div>

            <div className="cwp-quote">
              <div className="cwp-quote-header">
                <span>Riepilogo richiesta</span>
              </div>
              <div className="cwp-quote-row">
                <span>Rete</span>
                <span style={{ color: netColor, fontWeight: 600 }}>{NETWORK_LABELS[network]}</span>
              </div>
              <div className="cwp-quote-row">
                <span>Asset</span>
                <span>{asset.icon} {asset.symbol}</span>
              </div>
              <div className="cwp-quote-row">
                <span>Il tuo indirizzo</span>
                <span style={{ fontFamily: "monospace", fontSize: "0.78rem" }}>
                  🔒 {myAddress ? truncate(myAddress) : "—"}
                </span>
              </div>
              <div className="cwp-quote-divider" />
              <div className="cwp-quote-row cwp-quote-total">
                <span>Importo richiesto</span>
                <span style={{ color: netColor }}>{amount} {asset.symbol}</span>
              </div>
            </div>

            <p className="cwp-manual-confirm-warning" style={{ marginTop: 12 }}>
              📩 {displayName} riceverà una notifica con i dettagli della richiesta.<br />
              La richiesta scade tra <strong>24 ore</strong>.
            </p>
            {sendErr && <p className="cwp-send-err">{sendErr}</p>}
          </div>
        )}

        {/* ═══ STEP 5 — Sending ════════════════════════════════════════ */}
        {step === "sending" && (
          <div className="cwp-step cwp-step-center">
            <div className="cwp-sending-spinner" />
            <p className="cwp-sending-label">Invio richiesta…</p>
            <p className="cwp-sending-sub">
              Creazione della richiesta di pagamento su{" "}
              <strong style={{ color: netColor }}>{NETWORK_LABELS[network]}</strong>
            </p>
          </div>
        )}

        {/* ═══ SUCCESS ═════════════════════════════════════════════════ */}
        {step === "success" && (
          <div className="cwp-step cwp-step-center">
            <div className="cwp-success-icon">📥</div>
            <p className="cwp-success-title">Richiesta inviata</p>
            <p className="cwp-success-sub">
              Hai richiesto <strong>{amount} {asset.symbol}</strong> a{" "}
              <strong>{displayName}</strong>.<br />
              Riceverai una notifica quando verrà pagata.
            </p>
          </div>
        )}

      </div>{/* /awp-content */}

      {/* ── Footer ──────────────────────────────────────────────────── */}
      <div className="awp-footer">

        {step === "network" && (
          <button
            className="cwp-btn-primary"
            style={{ background: netColor }}
            onClick={() => setStep("asset")}
            disabled={!myAddress && network !== "bitcoin"}
          >
            Continua →
          </button>
        )}

        {step === "asset" && (
          <>
            <button className="cwp-btn-back" onClick={goBack}>← Indietro</button>
            <button
              className="cwp-btn-primary"
              style={{ background: netColor }}
              onClick={() => setStep("amount")}
            >
              Continua →
            </button>
          </>
        )}

        {step === "amount" && (
          <>
            <button className="cwp-btn-back" onClick={goBack}>← Indietro</button>
            <button
              className="cwp-btn-primary"
              style={{ background: netColor }}
              onClick={() => {
                if (!validateAmount()) return;
                setStep("confirm");
              }}
            >
              Anteprima →
            </button>
          </>
        )}

        {step === "confirm" && (
          <>
            <button className="cwp-btn-back" onClick={goBack}>← Modifica</button>
            <button
              className="cwp-btn-primary"
              style={{ background: netColor }}
              onClick={handleConfirm}
            >
              📩 Invia richiesta
            </button>
          </>
        )}

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
