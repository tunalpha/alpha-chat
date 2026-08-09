/**
 * MultiChainSendSheet — "Invia Cripto"
 *
 * UX:
 *   Step 1 (Importo):  rete + importo che il destinatario deve ricevere + nota
 *   Step 2 (Conferma): breakdown dal backend (quote)
 *   Step 3 EVM:        Firma transazione via ThirdWeb (fire-and-forget)
 *                      Stessa architettura di SendPaymentSheet (USDA).
 *   Step 3 BTC:        Indirizzo escrow da copiare — inalterato (non è EVM).
 *
 * Modalità fissa: recipient_exact — l'utente specifica quanto
 * vuole che arrivi al destinatario; il backend calcola il gross.
 *
 * ── Pattern firma EVM ────────────────────────────────────────────────────────
 *  1. useActiveAccount() → account ThirdWeb
 *  2. ConnectButton per rete corretta se non connesso
 *  3. encodeERC20Transfer(escrowWallet, minDepositAmount)
 *     - minDepositAmount è già in raw units → nessuna conversione
 *     - Polygon USDT (6 dec) / BSC USDT (18 dec) / Ethereum USDT (6 dec)
 *  4. account.sendTransaction() fire-and-forget (NO await del txHash)
 *  5. Polling apiMCDetect() ogni 10s — il backend è source of truth
 *
 * ── Differenze da USDA ──────────────────────────────────────────────────────
 *  - signAndPoll usa apiMCDetect invece di apiPaymentDetectDeposit
 *  - L'importo è già in raw units (BigInt(minDepositAmount)), no toWei18
 *  - La chain cambia per rete (polygon/bsc/ethereum)
 *  - BTC rimane copia-indirizzo (non è EVM)
 */

import { useState, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useActiveAccount, ConnectButton } from "thirdweb/react";
import type { Chain } from "thirdweb";
import { client, wallets, polygon, bsc, ethereum } from "../../lib/thirdweb";
import QRCode from "qrcode";
import {
  apiMCCreate,
  apiMCDetect,
  apiMCQuote,
  apiMCNetworks,
  MC_DECIMALS,
  MC_DISPLAY_DECIMALS,
  MC_ASSET,
  MC_TOKEN_CONTRACT,
  toSmallestUnit,
  fmtDisplay,
  type MCNetwork,
  type MCTransfer,
  type MCQuote,
} from "../../lib/multichain-api";
import {
  useBtcPrice,
  fiatToSatoshi,
  satoshiToBtcStr,
  FIAT_SYMBOLS,
  FIAT_LABELS,
  type FiatCurrency,
} from "../../hooks/useBtcPrice";
import { useEffect } from "react";

// ─── Chain mapping ────────────────────────────────────────────────────────────

const EVM_CHAIN: Partial<Record<MCNetwork, Chain>> = {
  polygon,
  bsc,
  ethereum,
};

const EVM_CHAIN_ID: Partial<Record<MCNetwork, number>> = {
  polygon:  137,
  bsc:      56,
  ethereum: 1,
};

// ─── ERC-20 calldata (identico a SendPaymentSheet) ────────────────────────────

/**
 * Encoda il calldata ERC-20 transfer(address,uint256) manualmente.
 * Bypassa il wrapper ThirdWeb (sendAndConfirmTransaction / getContract)
 * che tenta wallet_sendCalls (EIP-5792) prima di eth_sendTransaction,
 * causando due popup firma su Trust Wallet.
 */
function encodeERC20Transfer(to: string, amountRaw: bigint): `0x${string}` {
  const selector = "a9059cbb";
  const toHex    = to.toLowerCase().replace("0x", "").padStart(64, "0");
  const amtHex   = amountRaw.toString(16).padStart(64, "0");
  return `0x${selector}${toHex}${amtHex}` as `0x${string}`;
}

// ─── iOS recovery (stesso pattern USDA) ──────────────────────────────────────

const MC_PENDING_KEY = "ac_mc_pending";

interface MCPendingPayment {
  transferId:     string;
  conversationId: string;
  timestamp:      number; // ms
}

// ─── Steps ────────────────────────────────────────────────────────────────────

/** EVM: form → confirm → sign | BTC: form → confirm → address */
type Step = "form" | "confirm" | "sign" | "address";

/** Fasi visive dello step "sign" */
type SignPhase =
  | "ready"      // wallet connesso, pronto per firmare
  | "signing"    // wallet aperto, in attesa firma
  | "confirming" // polling backend detect
  | "done"
  | "error";

// ─── Reti ─────────────────────────────────────────────────────────────────────

interface NetOption { id: MCNetwork; label: string; sublabel: string; icon: string; ticker: string; }

const ALL_USDT_OPTS: NetOption[] = [
  { id: "polygon",  label: "USDT", sublabel: "Polygon",  icon: "🔵", ticker: "USDT" },
  { id: "ethereum", label: "USDT", sublabel: "Ethereum", icon: "⬡",  ticker: "USDT" },
  { id: "bsc",      label: "USDT", sublabel: "BSC",      icon: "🟡", ticker: "USDT" },
];
const BTC_NET: NetOption = { id: "bitcoin", label: "BTC", sublabel: "Bitcoin Network", icon: "₿", ticker: "BTC" };

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  conversationId: string;
  toUserId:       string;
  toName:         string;
  onClose:        () => void;
  onSent:         () => void;
  mode?: "usdt" | "btc";
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function totalFeeUnits(q: MCQuote): bigint {
  try { return BigInt(q.projectFee ?? "0") + BigInt(q.networkFeeCharged ?? "0"); }
  catch { return 0n; }
}

/** grossAmount + networkFeeCharged = importo totale depositato dal mittente */
function totalPaidUnits(q: MCQuote): bigint {
  try { return BigInt(q.grossAmount ?? "0") + BigInt(q.networkFeeCharged ?? "0"); }
  catch { return 0n; }
}

// ─── Componente ───────────────────────────────────────────────────────────────

export function MultiChainSendSheet({ conversationId, toUserId, toName, onClose, onSent, mode = "usdt" }: Props) {
  const { t } = useTranslation();

  // ── Wallet (ThirdWeb v5) ────────────────────────────────────────────────────
  const account     = useActiveAccount();
  const isConnected = !!account;

  // ── State ───────────────────────────────────────────────────────────────────
  const [step,           setStep]           = useState<Step>("form");
  const [network,        setNetwork]        = useState<MCNetwork>(mode === "btc" ? "bitcoin" : "polygon");
  const [amount,         setAmount]         = useState("");
  const [note,           setNote]           = useState("");
  const [loading,        setLoading]        = useState(false);
  const [error,          setError]          = useState<string | null>(null);
  const [quote,          setQuote]          = useState<MCQuote | null>(null);
  const [transfer,       setTransfer]       = useState<MCTransfer | null>(null);
  const [copied,         setCopied]         = useState(false);
  const [availableNets,  setAvailableNets]  = useState<NetOption[]>(ALL_USDT_OPTS);
  const [signPhase,      setSignPhase]      = useState<SignPhase>("ready");
  const [signError,      setSignError]      = useState<string | null>(null);
  /** Unità minime del netto target. Preserva l'importo esatto evitando il
   *  +1 unit di ceiling del backend in quote.netAmount. */
  const [targetNetUnits, setTargetNetUnits] = useState<string | null>(null);

  const busyRef   = useRef(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  const { price, loading: priceLoading, error: priceError, currency, setCurrency } = useBtcPrice();

  const isBtc       = mode === "btc" || network === "bitcoin";
  const isEvm       = !isBtc;
  const selectedNet = [...availableNets, BTC_NET].find(n => n.id === network) ?? availableNets[0]!;
  const rawDec      = MC_DECIMALS[network];
  const dispDec     = MC_DISPLAY_DECIMALS[network];
  const fiatSymbol  = FIAT_SYMBOLS[currency];
  const ticker      = selectedNet.ticker;

  // Step bar: EVM mostra "Firma", BTC mostra "Indirizzo"
  const STEPS: { id: Step; label: string }[] = [
    { id: "form",    label: "Importo"           },
    { id: "confirm", label: "Conferma"          },
    isEvm
      ? { id: "sign",    label: "Firma"    }
      : { id: "address", label: "Indirizzo" },
  ];
  const stepIdx = STEPS.findIndex(s => s.id === step);

  const fiatNum = parseFloat(amount.replace(",", ".")) || 0;
  const satoshi = isBtc ? fiatToSatoshi(amount, currency, price) : null;
  const btcStr  = satoshi != null ? satoshiToBtcStr(satoshi) : null;

  // Carica reti abilitate dal backend
  useEffect(() => {
    if (mode !== "usdt") return;
    apiMCNetworks().then(nets => {
      const ids      = new Set(nets.map(n => n.id));
      const filtered = ALL_USDT_OPTS.filter(n => ids.has(n.id));
      setAvailableNets(filtered.length > 0 ? filtered : ALL_USDT_OPTS);
      if (filtered.length > 0 && !ids.has(network)) setNetwork(filtered[0]!.id);
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // Genera QR code quando si arriva allo step "address" (BTC)
  useEffect(() => {
    if (step !== "address" || !transfer?.escrowWallet) return;
    const btcAmount = satoshisToUriAmount(transfer.minDepositAmount);
    const uri = btcAmount
      ? `bitcoin:${transfer.escrowWallet}?amount=${btcAmount}`
      : `bitcoin:${transfer.escrowWallet}`;
    void QRCode.toDataURL(uri, {
      width:  200,
      margin: 2,
      color:  { dark: "#a855f7", light: "#0F0A1E" },
    }).then(setQrDataUrl).catch(() => setQrDataUrl(null));
  }, [step, transfer]);

  // Recovery iOS: se c'è un pagamento MC in sospeso per questa conversazione
  // (< 30 min) avvia il polling senza richiedere nuova firma.
  useEffect(() => {
    const raw = localStorage.getItem(MC_PENDING_KEY);
    if (!raw) return;
    let pending: MCPendingPayment;
    try { pending = JSON.parse(raw) as MCPendingPayment; }
    catch { localStorage.removeItem(MC_PENDING_KEY); return; }
    if (pending.conversationId !== conversationId) return;
    if (Date.now() - pending.timestamp > 30 * 60 * 1000) {
      localStorage.removeItem(MC_PENDING_KEY);
      return;
    }
    // Riprendi il polling
    setStep("sign");
    setSignPhase("confirming");
    void pollDetect(pending.transferId, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-chiudi dopo done
  useEffect(() => {
    if (signPhase !== "done") return;
    localStorage.removeItem(MC_PENDING_KEY);
    const timer = setTimeout(() => onSent(), 1800);
    return () => clearTimeout(timer);
  }, [signPhase, onSent]);

  // ── Helpers display ─────────────────────────────────────────────────────────

  /** Converte satoshi (raw units stringa) in importo BTC per BIP-21 URI.
   *  Usa il valore esatto del backend — nessun ricalcolo frontend. */
  function satoshisToUriAmount(satStr: string | null | undefined): string | null {
    if (!satStr) return null;
    try {
      const sat = BigInt(satStr);
      if (sat <= 0n) return null;
      // satoshi → BTC: divide per 10^8 mantenendo 8 decimali
      const whole = sat / 100_000_000n;
      const rem   = sat % 100_000_000n;
      const remStr = rem.toString().padStart(8, "0").replace(/0+$/, "");
      return remStr ? `${whole}.${remStr}` : `${whole}`;
    } catch { return null; }
  }

  const fmtQ = (units: string) =>
    isBtc ? fmtDisplay(units, 8, 8) + " BTC" : fmtDisplay(units, rawDec, dispDec) + " " + ticker;

  // Importo che il mittente deve depositare nell'escrow
  const depositDisplay = transfer?.minDepositAmount
    ? fmtDisplay(transfer.minDepositAmount, rawDec, dispDec)
    : quote ? fmtDisplay(quote.grossAmount, rawDec, dispDec) : "0";

  // ── Step 1 → 2 ─────────────────────────────────────────────────────────────

  async function handleContinue() {
    if (isBtc) {
      if (!amount.trim() || fiatNum <= 0)   { setError(t("multichain.invalidAmount")); return; }
      if (!price)                            { setError("Prezzo BTC non disponibile."); return; }
      if (!satoshi || satoshi <= 0n)         { setError(t("multichain.invalidAmount")); return; }
    } else {
      const n = parseFloat(amount.replace(",", "."));
      if (!amount.trim() || isNaN(n) || n <= 0) { setError(t("multichain.invalidAmount")); return; }
    }
    setError(null);
    setLoading(true);
    try {
      const units = isBtc ? satoshi!.toString() : toSmallestUnit(amount, rawDec);
      setTargetNetUnits(units);
      const res = await apiMCQuote({
        network,
        asset:                MC_ASSET[network],
        amountMode:           "recipient_exact",
        targetNetAmountUnits: units,
      });
      setQuote(res.quote);
      setStep("confirm");
    } catch (e: unknown) {
      const err = e as Error & { code?: string; details?: Record<string, unknown> };
      if (err.code === "BTC_PROJECT_FEE_BELOW_DUST") {
        const minSat  = Number(err.details?.minGrossAmountSat ?? 546000);
        const minFiat = price ? Math.ceil(minSat / 1e8 * price[currency]) : null;
        setError(minFiat != null
          ? `Min BTC: ${fiatSymbol}${minFiat.toLocaleString("it-IT")} (${(minSat / 1e8).toFixed(5).replace(/0+$/, "")} BTC)`
          : `Min: ${(minSat / 1e8).toFixed(5)} BTC`);
      } else {
        setError(err.message ?? t("common.error"));
      }
    } finally { setLoading(false); }
  }

  // ── Step 2 → 3: crea il transfer ──────────────────────────────────────────

  const handleCreate = useCallback(async () => {
    if (!quote || !targetNetUnits) return;
    setLoading(true);
    setError(null);
    try {
      const result = await apiMCCreate({
        recipientId:          toUserId,
        conversationId,
        network,
        asset:                MC_ASSET[network],
        amountMode:           "recipient_exact",
        targetNetAmountUnits: targetNetUnits,
        note:                 note.trim() || undefined,
        clientRef:            crypto.randomUUID(),
        expiresInHours:       24,
      });
      setTransfer(result);
      // EVM → step firma; BTC → step copia indirizzo
      setStep(isEvm ? "sign" : "address");
      if (isEvm) setSignPhase("ready");
    } catch (e: unknown) {
      const err = e as Error & { code?: string; details?: Record<string, unknown> };
      if (err.code === "BTC_PROJECT_FEE_BELOW_DUST") {
        const minSat  = Number(err.details?.minGrossAmountSat ?? 546000);
        const minFiat = price ? Math.ceil(minSat / 1e8 * price[currency]) : null;
        setError(minFiat != null
          ? `Min BTC: ${fiatSymbol}${minFiat.toLocaleString("it-IT")} (${(minSat / 1e8).toFixed(5).replace(/0+$/, "")} BTC)`
          : `Min: ${(minSat / 1e8).toFixed(5)} BTC`);
      } else {
        setError(err.message ?? t("common.error"));
      }
    } finally { setLoading(false); }
  }, [quote, targetNetUnits, toUserId, conversationId, network, note, isEvm, price, currency, fiatSymbol, t]);

  // ── Polling backend (fonte di verità on-chain) ─────────────────────────────

  async function pollDetect(transferId: string, showConfirming: boolean): Promise<void> {
    const POLL_INTERVAL_MS = 10_000;
    const POLL_MAX_MS      = 10 * 60 * 1000;
    const pollStart        = Date.now();
    let   first            = true;

    while (Date.now() - pollStart < POLL_MAX_MS) {
      await new Promise<void>(r => setTimeout(r, first ? 2000 : POLL_INTERVAL_MS));
      first = false;
      if (showConfirming) setSignPhase("confirming");

      try {
        await apiMCDetect(transferId);
        setSignPhase("done");
        return;
      } catch (pollErr: unknown) {
        const code = (pollErr as Error & { code?: string })?.code;
        if (code === "DEPOSIT_TX_NOT_DETECTED") continue;
        // Errore reale (es. transfer expired, RPC error)
        throw pollErr;
      }
    }
    throw new Error("Timeout: deposito non rilevato in 10 minuti. Controlla la transazione nel tuo wallet.");
  }

  // ── Firma EVM fire-and-forget + polling ────────────────────────────────────

  const handleSign = useCallback(async () => {
    if (busyRef.current || !account || !transfer) return;
    busyRef.current = true;
    setSignError(null);

    const tokenContract = MC_TOKEN_CONTRACT[network];
    const chainId       = EVM_CHAIN_ID[network];
    if (!tokenContract || !chainId) {
      setSignError("Rete non supportata per la firma.");
      busyRef.current = false;
      return;
    }

    // Importo da inviare: minDepositAmount (raw units) oppure grossAmount come fallback
    const rawAmount = transfer.minDepositAmount ?? transfer.grossAmount;
    if (!rawAmount || BigInt(rawAmount) === 0n) {
      setSignError("Importo deposito non disponibile. Riprova.");
      busyRef.current = false;
      return;
    }

    // Calldata ERC-20 (transfer(escrowWallet, rawAmount))
    const calldata = encodeERC20Transfer(transfer.escrowWallet as `0x${string}`, BigInt(rawAmount));

    // Salva recovery iOS prima di aprire il wallet
    localStorage.setItem(MC_PENDING_KEY, JSON.stringify({
      transferId:     transfer.transferId,
      conversationId,
      timestamp:      Date.now(),
    } satisfies MCPendingPayment));

    setSignPhase("signing");

    // Pre-check: il deposito è già stato rilevato? (es. richiesta stale WalletConnect)
    try {
      await apiMCDetect(transfer.transferId);
      setSignPhase("done");
      busyRef.current = false;
      return;
    } catch {
      // Non ancora rilevato — procediamo con la firma
    }

    let pollAborted  = false;
    let signErrorMsg: string | null = null;

    // fire-and-forget — stessa strategia di USDA
    account.sendTransaction({
      to:      tokenContract as `0x${string}`,
      data:    calldata,
      gas:     BigInt(100_000),
      value:   BigInt(0),
      chainId,
    }).catch((err: unknown) => {
      const msg = (err as Error)?.message ?? "";
      if (/reject|cancel|denied|refused|user.*cancel|user rejected/i.test(msg)) {
        pollAborted  = true;
        signErrorMsg = "Firma rifiutata. Riprova quando vuoi.";
      } else if (/nonce.*too.*low|nonce.*used|nonce.*already/i.test(msg)) {
        // TX già inviata con questo nonce (relay WalletConnect stale) → polling continua
        console.warn("[MCSign] Nonce already used — tx precedente già on-chain, continuo il polling.");
      } else if (/chain.*not.*add|switch.*chain|addEthereumChain|unrecognized.*chain|chain.*not.*support|does not support/i.test(msg)) {
        pollAborted  = true;
        signErrorMsg = `La rete non è configurata nel tuo wallet.\n\nAggiungi la rete ${network.toUpperCase()} (chainId ${chainId}) al wallet e riconnetti.`;
      } else {
        signErrorMsg = msg || "Errore durante la firma.";
      }
    });

    // ── Polling ──────────────────────────────────────────────────────────────
    const POLL_INTERVAL_MS       = 10_000;
    const POLL_MAX_MS            = 10 * 60 * 1000;
    const SIGN_ERROR_GRACE_POLLS = 3;
    const pollStart              = Date.now();
    let   pollCount              = 0;

    try {
      while (Date.now() - pollStart < POLL_MAX_MS) {
        if (pollAborted) throw new Error(signErrorMsg ?? "Firma annullata.");

        await new Promise<void>(r => setTimeout(r, POLL_INTERVAL_MS));
        pollCount++;
        if (pollCount === 1) setSignPhase("confirming");
        if (pollAborted) throw new Error(signErrorMsg ?? "Firma annullata.");

        try {
          await apiMCDetect(transfer.transferId);
          setSignPhase("done");
          return;
        } catch (pollErr: unknown) {
          const code = (pollErr as Error & { code?: string })?.code;
          if (code === "DEPOSIT_TX_NOT_DETECTED") {
            if (signErrorMsg && !pollAborted && pollCount >= SIGN_ERROR_GRACE_POLLS) {
              throw new Error(signErrorMsg + "\n\nSe hai firmato nel wallet, attendi qualche minuto e controlla la bolla in chat.");
            }
            continue;
          }
          if (code === "ADAPTER_NOT_FOUND") {
            // Rete non abilitata lato backend — mostra fallback manuale
            throw new Error(
              "La rete non è ancora disponibile per il rilevamento automatico.\n\n" +
              "Usa \"Invia manualmente\" qui sotto per copiare l'indirizzo escrow e invia dal tuo wallet."
            );
          }
          throw pollErr;
        }
      }
      throw new Error("Timeout: deposito non rilevato. Controlla la transazione nel tuo wallet.");
    } catch (e: unknown) {
      const msg = (e as Error)?.message ?? "Errore sconosciuto.";
      setSignPhase("error");
      setSignError(msg);
    } finally {
      busyRef.current = false;
    }
  }, [account, transfer, network, conversationId]);

  // ── BTC: copia indirizzo ─────────────────────────────────────────────────

  async function handleCopy() {
    if (!transfer?.escrowWallet) return;
    await navigator.clipboard.writeText(transfer.escrowWallet);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const chain = EVM_CHAIN[network];

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={t("multichain.sendTitle")} onClick={onClose}>
      <div className="usda-sheet mc-sheet" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="usda-sheet-header">
          <span className="usda-sheet-title">💸 {t("multichain.sendTitle")}</span>
          <button type="button" className="usda-sheet-close" aria-label="Chiudi" onClick={onClose}>✕</button>
        </div>

        {/* Step bar */}
        <div className="usda-step-bar" role="progressbar" aria-valuenow={stepIdx + 1} aria-valuemax={STEPS.length}>
          {STEPS.map((s, i) => (
            <div key={s.id} className={`usda-step ${i < stepIdx ? "done" : i === stepIdx ? "active" : ""}`}>
              <div className="usda-step-dot" aria-hidden="true">{i < stepIdx ? "✓" : i + 1}</div>
              <div className="usda-step-label">{s.label}</div>
            </div>
          ))}
        </div>

        {/* ── Step 1: form ── */}
        {step === "form" && (
          <>
            <div className="usda-sheet-to">{t("multichain.toLabel")} <strong>{toName}</strong></div>

            {/* Selezione rete */}
            {isBtc ? (
              <div className="mc-btc-card selected" style={{ cursor: "default", marginBottom: 14 }}>
                <span className="mc-btc-symbol">₿</span>
                <div className="mc-btc-text">
                  <span className="mc-btc-name">BTC <em>— Bitcoin nativo</em></span>
                  <span className="mc-btc-net">Bitcoin Network</span>
                </div>
              </div>
            ) : (
              <>
                <div className="mc-section-label">{t("multichain.selectNetwork")}</div>
                <div className="mc-token-group-label">USDT <span className="mc-token-group-desc">· ERC-20 / BEP-20</span></div>
                <div className="mc-network-grid">
                  {availableNets.map(n => (
                    <button key={n.id} type="button"
                      className={`mc-network-item${network === n.id ? " selected" : ""}`}
                      onClick={() => { setNetwork(n.id); setAmount(""); setError(null); setQuote(null); }}
                    >
                      <span className="mc-network-icon">{n.icon}</span>
                      <span className="mc-network-label">{n.label}</span>
                      <span className="mc-network-sublabel">{n.sublabel}</span>
                    </button>
                  ))}
                </div>
              </>
            )}

            {/* Importo */}
            {isBtc ? (
              <div className="usda-sheet-field">
                <label htmlFor="mc-send-amount">IMPORTO ({toName} riceve)</label>
                <div className="usda-amount-row">
                  <input id="mc-send-amount" className="usda-amount-input"
                    type="number" inputMode="decimal" min="0" step="any" placeholder="0,00"
                    value={amount} onChange={e => { setAmount(e.target.value); setError(null); setQuote(null); }} autoFocus />
                  <select className="mc-fiat-select" value={currency}
                    onChange={e => setCurrency(e.target.value as FiatCurrency)} aria-label="Valuta fiat">
                    {(Object.keys(FIAT_LABELS) as FiatCurrency[]).map(c => (
                      <option key={c} value={c}>{c.toUpperCase()}</option>
                    ))}
                  </select>
                </div>
                <div className="mc-btc-equiv">
                  {priceLoading && !price ? (
                    <span className="mc-btc-equiv-loading">Caricamento prezzo…</span>
                  ) : priceError && !price ? (
                    <span className="mc-btc-equiv-error">Prezzo non disponibile</span>
                  ) : (
                    <>
                      <span className="mc-btc-equiv-value">≈ {btcStr ?? "0.00000000"} BTC</span>
                      {price && <span className="mc-btc-equiv-rate">1 BTC = {fiatSymbol}{price[currency].toLocaleString("it-IT", { maximumFractionDigits: 0 })}</span>}
                    </>
                  )}
                </div>
              </div>
            ) : (
              <div className="usda-sheet-field">
                <label htmlFor="mc-send-amount">IMPORTO ({toName} riceve)</label>
                <div className="usda-amount-row">
                  <input id="mc-send-amount" className="usda-amount-input"
                    type="number" inputMode="decimal" min="0" step="any" placeholder="0.00"
                    value={amount} onChange={e => { setAmount(e.target.value); setError(null); setQuote(null); }} autoFocus />
                  <span className="usda-currency">{ticker}</span>
                </div>
              </div>
            )}

            {/* Nota */}
            <div className="usda-sheet-field">
              <label htmlFor="mc-send-note">NOTA (OPZIONALE)</label>
              <input id="mc-send-note" className="usda-note-input"
                type="text" placeholder="Es. Cena, taxi, regalo…" maxLength={200}
                value={note} onChange={e => setNote(e.target.value)} />
            </div>

            {error && <div className="usda-error" role="alert">{error}</div>}

            <div className="usda-sheet-actions">
              <button type="button" className="usda-btn-secondary" onClick={onClose}>{t("multichain.cancelBtn")}</button>
              <button type="button" className="usda-btn-primary"
                onClick={handleContinue}
                disabled={loading || (isBtc && priceLoading && !price)}
                aria-busy={loading}>
                {loading ? <><span className="usda-btn-spinner" aria-hidden="true" /> Calcolo…</> : t("multichain.continueBtn")}
              </button>
            </div>
          </>
        )}

        {/* ── Step 2: confirm ── */}
        {step === "confirm" && quote && (
          <>
            <div className="usda-sheet-to">{t("multichain.toLabel")} <strong>{toName}</strong></div>

            <div className="mc-confirm-summary">
              <div className="mc-confirm-row">
                <span>{t("multichain.networkLabel")}</span>
                <span>{isBtc ? "₿ Bitcoin" : `${selectedNet.label} · ${selectedNet.sublabel}`}</span>
              </div>

              <div className="mc-confirm-row mc-confirm-net">
                <span>{toName} riceve</span>
                <strong>
                  {isBtc
                    ? fmtDisplay(targetNetUnits ?? quote.netAmount, 8, 8) + " BTC"
                    : fmtDisplay(targetNetUnits ?? quote.netAmount, rawDec, dispDec) + " " + ticker}
                </strong>
              </div>

              <div className="mc-confirm-row mc-confirm-fee">
                <span>Fee progetto</span>
                <span>
                  +{fmtQ(quote.projectFee)}
                  {quote.btcFeeFloorApplied && <em style={{ fontSize: "0.72em", opacity: 0.7, marginLeft: 4 }}>(min 546 sat)</em>}
                </span>
              </div>

              {!isBtc && BigInt(quote.networkFeeCharged ?? "0") > 0n && (
                <div className="mc-confirm-row mc-confirm-fee" style={{ opacity: 0.85 }}>
                  <span>
                    Network fee
                    <em style={{ fontSize: "0.72em", opacity: 0.7, marginLeft: 4 }}>(stima gas)</em>
                  </span>
                  <span>+{fmtQ(quote.networkFeeCharged)}</span>
                </div>
              )}

              <div className="mc-confirm-row mc-confirm-total">
                <span>Totale pagato</span>
                <span>
                  {isBtc ? (
                    <>
                      {fmtQ(totalPaidUnits(quote).toString())}
                      {" "}<em style={{ fontSize: "0.76em", opacity: 0.65 }}>(+ fee miner BTC)</em>
                    </>
                  ) : (
                    fmtQ(totalPaidUnits(quote).toString())
                  )}
                </span>
              </div>

              {isBtc && price && (
                <div className="mc-confirm-row" style={{ opacity: 0.6, fontSize: "0.8em" }}>
                  <span>Tasso usato</span>
                  <span>1 BTC ≈ {fiatSymbol}{price[currency].toLocaleString("it-IT", { maximumFractionDigits: 0 })}</span>
                </div>
              )}

              <div className="mc-confirm-row">
                <span>{t("multichain.depositDeadline")}</span>
                <span>24 {t("multichain.hours")}</span>
              </div>

              {note.trim() && (
                <div className="mc-confirm-row">
                  <span>Nota</span>
                  <span style={{ fontStyle: "italic", opacity: 0.8 }}>{note.trim()}</span>
                </div>
              )}
            </div>

            <p className="mc-confirm-note">{t("multichain.confirmNote")}</p>

            {error && <div className="usda-error" role="alert">{error}</div>}

            <div className="usda-sheet-actions">
              <button type="button" className="usda-btn-secondary"
                onClick={() => { setStep("form"); setError(null); }} disabled={loading}>
                {t("multichain.backBtn")}
              </button>
              <button type="button" className="usda-btn-primary"
                onClick={handleCreate} disabled={loading} aria-busy={loading}>
                {loading
                  ? <><span className="usda-btn-spinner" aria-hidden="true" /> {t("multichain.creatingBtn")}…</>
                  : isEvm ? "Continua →" : t("multichain.createAddressBtn")}
              </button>
            </div>
          </>
        )}

        {/* ── Step 3 EVM: firma transazione ── */}
        {step === "sign" && transfer && (
          <>
            <div className="usda-sheet-to">{t("multichain.toLabel")} <strong>{toName}</strong></div>

            {/* Riepilogo importo da firmare */}
            <div className="mc-confirm-summary">
              <div className="mc-confirm-row">
                <span>Rete</span>
                <span>{selectedNet.label} · {selectedNet.sublabel}</span>
              </div>
              <div className="mc-confirm-row mc-confirm-net">
                <span>{toName} riceve</span>
                <strong>{fmtDisplay(targetNetUnits ?? transfer.netAmount, rawDec, dispDec)} {ticker}</strong>
              </div>
              <div className="mc-confirm-row mc-confirm-total">
                <span>Totale da firmare</span>
                <strong>{depositDisplay} {ticker}</strong>
              </div>
            </div>

            {/* Fasi: done */}
            {signPhase === "done" && (
              <div className="usda-phase-box">
                <span className="usda-phase-icon">✅</span>
                <div>
                  <p className="usda-phase-title">Pagamento confermato!</p>
                  <p className="usda-phase-desc">Il deposito è stato rilevato. La chat verrà aggiornata.</p>
                </div>
              </div>
            )}

            {/* Fasi: signing / confirming */}
            {(signPhase === "signing" || signPhase === "confirming") && (
              <div className="usda-phase-box">
                <span className="usda-btn-spinner usda-phase-icon" aria-hidden="true" />
                <div>
                  <p className="usda-phase-title">
                    {signPhase === "signing" ? "In attesa della firma…" : "Verifica deposito in corso…"}
                  </p>
                  <p className="usda-phase-desc">
                    {signPhase === "signing"
                      ? "Conferma la transazione nel tuo wallet."
                      : "Stiamo verificando il pagamento sulla blockchain. Attendi qualche istante."}
                  </p>
                </div>
              </div>
            )}

            {/* Errore firma */}
            {signPhase === "error" && signError && (
              <div className="usda-error" role="alert" style={{ whiteSpace: "pre-line" }}>{signError}</div>
            )}

            {/* Wallet connect / firma — mostrato solo se non in corso */}
            {(signPhase === "ready" || signPhase === "error") && (
              <>
                {!isConnected ? (
                  <div className="mc-wallet-connect-wrap">
                    <p className="mc-wallet-connect-label">Connetti il wallet per firmare la transazione:</p>
                    <ConnectButton
                      client={client}
                      chain={chain}
                      wallets={wallets}
                    />
                  </div>
                ) : (
                  <div className="usda-sheet-actions" style={{ flexDirection: "column", gap: 10 }}>
                    <button
                      type="button"
                      className="usda-btn-primary"
                      onClick={() => void handleSign()}
                      disabled={busyRef.current}
                    >
                      {signPhase === "error" ? "🔄 Riprova firma" : "✍️ Firma transazione →"}
                    </button>
                    {/* Fallback: mostra indirizzo per invio manuale */}
                    <details className="mc-fallback-details">
                      <summary className="mc-fallback-summary">Invia manualmente</summary>
                      <div className="mc-address-box" style={{ marginTop: 8 }}>
                        <span className="mc-address-text">{transfer.escrowWallet}</span>
                      </div>
                      <button type="button" className="mc-copy-btn" onClick={handleCopy} style={{ marginTop: 6 }}>
                        {copied ? "✓ Copiato!" : "📋 Copia indirizzo"}
                      </button>
                      <p className="mc-address-expiry" style={{ marginTop: 4 }}>⏰ {t("multichain.expiresIn24h")}</p>
                    </details>
                  </div>
                )}
              </>
            )}

            {/* Pulsante Chiudi dopo done */}
            {signPhase === "done" && (
              <div className="usda-sheet-actions">
                <button type="button" className="usda-btn-primary" onClick={onSent}>
                  {t("multichain.doneBtn")}
                </button>
              </div>
            )}
          </>
        )}

        {/* ── Step 3 BTC: indirizzo escrow (inalterato) ── */}
        {step === "address" && transfer && (() => {
          const btcAmount = satoshisToUriAmount(transfer.minDepositAmount);
          const bitcoinUri = btcAmount
            ? `bitcoin:${transfer.escrowWallet}?amount=${btcAmount}`
            : `bitcoin:${transfer.escrowWallet}`;
          return (
            <>
              {/* Importo da inviare */}
              <div className="mc-confirm-summary">
                <div className="mc-confirm-row">
                  <span>Rete</span>
                  <span>Bitcoin</span>
                </div>
                <div className="mc-confirm-row mc-confirm-total">
                  <span>Invia esattamente</span>
                  <strong>{depositDisplay} BTC</strong>
                </div>
              </div>

              {/* Azione principale: apri wallet BTC */}
              <a
                href={bitcoinUri}
                className="usda-btn-primary"
                style={{ display: "block", textAlign: "center", textDecoration: "none", padding: "13px", borderRadius: "12px" }}
                onClick={() => { /* deep link — iOS/Android aprono il wallet di default */ }}
              >
                📲 Apri wallet Bitcoin
              </a>

              {/* QR code per desktop o scan */}
              {qrDataUrl && (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                  <img src={qrDataUrl} alt="QR Bitcoin URI" style={{ width: 160, height: 160, borderRadius: 12 }} />
                  <p style={{ fontSize: "0.75rem", color: "rgba(255,255,255,0.4)", margin: 0 }}>
                    Scansiona con il wallet Bitcoin
                  </p>
                </div>
              )}

              {/* Indirizzo escrow + copia (fallback) */}
              <div className="mc-address-block">
                <div className="mc-address-box">
                  <span className="mc-address-text">{transfer.escrowWallet}</span>
                </div>
                <button type="button" className="mc-copy-btn" onClick={handleCopy}>
                  {copied ? t("multichain.addressCopied") : "📋 Copia indirizzo"}
                </button>
                <p className="mc-address-expiry">⏰ {t("multichain.expiresIn24h")}</p>
              </div>

              <div className="usda-sheet-actions">
                <button type="button" className="usda-btn-primary" onClick={onSent}>{t("multichain.doneBtn")}</button>
              </div>
            </>
          );
        })()}

      </div>
    </div>
  );
}
