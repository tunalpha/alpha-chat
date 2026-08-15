/**
 * MultiChainSendSheet — "Invia Cripto"
 *
 * Step 1 (Importo):   rete + importo netto destinatario + nota
 * Step 2 (Conferma):  breakdown quote (singola riga "Network fee")
 * Step 3 EVM (Firma): ConnectButton se non connesso → "✍️ Firma transazione →"
 *                     ERC-20 calldata manuale, fire-and-forget, polling backend.
 *                     Fallback manuale nascosto in "Problemi con il wallet?".
 * Step 3 BTC (Indirizzo): native share sheet + QR + copia indirizzo.
 *
 * PATTERN EVM identico a SendPaymentSheet (USDA):
 *   account.sendTransaction() fire-and-forget (NO await txHash)
 *   calldata ERC-20 manuale — evita wallet_sendCalls (EIP-5792) / doppio popup
 *   backend è source of truth (apiMCDetect)
 *
 * Sheet NON bloccante: X sempre attiva. Bubble esegue polling indipendente ogni 30s.
 * NON modificare USDA.
 */

import { useState, useCallback, useEffect, useRef } from "react";
import { isNetworkError } from "../../lib/multichain-poll";
import { useTranslation } from "react-i18next";
import QRCode from "qrcode";
import { useActiveAccount, useActiveWallet, useActiveWalletChain, useSwitchActiveWalletChain, ConnectButton } from "thirdweb/react";
import { client, wallets, walletsBsc, polygon, bsc, ethereum } from "../../lib/thirdweb";
import {
  apiMCCreate,
  apiMCCancel,
  apiMCDetect,
  apiMCGet,
  apiMCQuote,
  apiMCNetworks,
  apiMCBtcLimits,
  MC_DECIMALS,
  MC_DISPLAY_DECIMALS,
  MC_ASSET,
  MC_TOKEN_CONTRACT,
  toSmallestUnit,
  fmtDisplay,
  type MCNetwork,
  type MCTransfer,
  type MCQuote,
  type MCBtcLimits,
} from "../../lib/multichain-api";
import {
  useBtcPrice,
  fiatToSatoshi,
  satoshiToBtcStr,
  FIAT_SYMBOLS,
  FIAT_LABELS,
  type FiatCurrency,
} from "../../hooks/useBtcPrice";

// ─── EVM chain mapping ────────────────────────────────────────────────────────

const EVM_CHAIN = { polygon, bsc, ethereum } as const;

const EVM_CHAIN_ID: Partial<Record<MCNetwork, number>> = {
  polygon:  137,
  bsc:      56,
  ethereum: 1,
};

/**
 * Encoda ERC-20 transfer(address,uint256) manualmente.
 * Identico al pattern USDA — evita wallet_sendCalls (EIP-5792) che causa
 * doppio popup firma su Trust Wallet ("nonce too low" al secondo).
 */
function encodeERC20Transfer(to: string, amount: bigint): `0x${string}` {
  const toHex  = to.toLowerCase().replace("0x", "").padStart(64, "0");
  const amtHex = amount.toString(16).padStart(64, "0");
  return `0xa9059cbb${toHex}${amtHex}` as `0x${string}`;
}

/** Traduce errori di firma in messaggi leggibili. */
function humanizeSignError(err: unknown, networkLabel: string): string {
  const msg = ((err as Error)?.message ?? "").toLowerCase();
  if (msg.includes("unrecognized chain") || msg.includes("does not support") || msg.includes("wrong network")) {
    return `Seleziona la rete ${networkLabel} nel tuo wallet prima di firmare.`;
  }
  if (/reject|cancel|denied|refused|user rejected/i.test(msg)) {
    return "Firma rifiutata. Premi di nuovo per riprovare.";
  }
  if (msg.includes("insufficient funds") || msg.includes("insufficient balance")) {
    return "Fondi insufficienti per la gas fee nel tuo wallet.";
  }
  return (err as Error)?.message || "Errore durante la firma.";
}

// ─── iOS recovery ─────────────────────────────────────────────────────────────

const MC_PENDING_KEY = "ac_mc_pending";

interface MCPendingPayment {
  transferId:     string;
  conversationId: string;
  network:        string;
  timestamp:      number;
  signed:         boolean; // true dopo sendTransaction (EVM) o dopo create (BTC)
}

// ─── Steps ────────────────────────────────────────────────────────────────────

type Step = "form" | "confirm" | "sign" | "address";

type SignPhase =
  | "ready"      // wallet connesso, pronto per firmare (EVM) o indirizzo mostrato (BTC)
  | "switching"  // chain switch esplicito in corso (await useSwitchActiveWalletChain)
  | "signing"    // sendTransaction in corso — wallet modal aperto per la TX
  | "confirming" // TX inviata o BTC atteso, polling backend
  | "done"
  | "error"
  | "uncertain"; // TX potrebbe essere già in mempool — NON mostrare "Firma transazione" (prevenire double-spend)

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

// ─── Helpers fee/amount ───────────────────────────────────────────────────────

function totalFeeUnits(q: MCQuote): bigint {
  try { return BigInt(q.projectFee ?? "0") + BigInt(q.networkFeeCharged ?? "0"); }
  catch { return 0n; }
}

function totalPaidUnits(q: MCQuote): bigint {
  try { return BigInt(q.grossAmount ?? "0") + BigInt(q.networkFeeCharged ?? "0"); }
  catch { return 0n; }
}

// ─── Componente ───────────────────────────────────────────────────────────────

export function MultiChainSendSheet({ conversationId, toUserId, toName, onClose, onSent, mode = "usdt" }: Props) {
  const { t } = useTranslation();

  // ThirdWeb — condiviso con USDA, NON un wallet system separato
  const account           = useActiveAccount();
  const activeWallet      = useActiveWallet();   // per auto-open iOS (wallet native scheme)
  const activeWalletChain = useActiveWalletChain();
  const switchChain       = useSwitchActiveWalletChain();
  const isConnected       = !!account;

  // Ref per leggere l'account più aggiornato in handleSign (evita closure stale).
  // ThirdWeb v5 può sostituire l'oggetto account quando la chain cambia:
  // la closure di handleSign cattura il valore al momento del render, ma dopo
  // await switchChain() il componente si ri-renderizza con un nuovo account →
  // accountRef.current punta sempre all'istanza più recente.
  const accountRef = useRef(account);
  useEffect(() => { accountRef.current = account; }, [account]);

  // State
  const [step,           setStep]           = useState<Step>("form");
  const [network,        setNetwork]        = useState<MCNetwork>(mode === "btc" ? "bitcoin" : "polygon");
  const [amount,         setAmount]         = useState("");
  const [note,           setNote]           = useState("");
  const [loading,        setLoading]        = useState(false);
  const [error,          setError]          = useState<string | null>(null);
  const [quote,          setQuote]          = useState<MCQuote | null>(null);
  const [transfer,       setTransfer]       = useState<MCTransfer | null>(null);
  const [copied,         setCopied]         = useState(false);
  const [showManual,     setShowManual]     = useState(false);
  const [availableNets,  setAvailableNets]  = useState<NetOption[]>(ALL_USDT_OPTS);
  const [signPhase,      setSignPhase]      = useState<SignPhase>("ready");
  const [signError,      setSignError]      = useState<string | null>(null);
  const [targetNetUnits, setTargetNetUnits] = useState<string | null>(null);
  const [qrDataUrl,      setQrDataUrl]      = useState<string | null>(null);
  const [cancelling,     setCancelling]     = useState(false);
  const [btcLimits,      setBtcLimits]      = useState<MCBtcLimits | null>(null);
  const [copiedAmount,   setCopiedAmount]   = useState(false);

  const { price, loading: priceLoading, error: priceError, currency, setCurrency } = useBtcPrice();

  // Aborting stale recovery polling when a new transfer is created or session resets.
  // A plain object (not state) — mutations don't need re-renders.
  const recoveryAbortRef = useRef<{ aborted: boolean }>({ aborted: false });

  const isBtc       = mode === "btc" || network === "bitcoin";
  const isEvm       = !isBtc;
  const selectedNet = [...availableNets, BTC_NET].find(n => n.id === network) ?? availableNets[0]!;
  const rawDec      = MC_DECIMALS[network];
  const dispDec     = MC_DISPLAY_DECIMALS[network];
  const fiatSymbol  = FIAT_SYMBOLS[currency];
  const ticker      = selectedNet.ticker;
  const evmChain    = isEvm ? EVM_CHAIN[network as keyof typeof EVM_CHAIN] : null;
  const evmChainId  = isEvm ? (EVM_CHAIN_ID[network] ?? null) : null;

  const STEPS: { id: Step; label: string }[] = [
    { id: "form",                              label: "Importo"  },
    { id: "confirm",                           label: "Conferma" },
    { id: isEvm ? "sign" : "address",         label: isEvm ? "Firma" : "Indirizzo" },
  ];
  const stepIdx = STEPS.findIndex(s => s.id === step);

  const fiatNum = parseFloat(amount.replace(",", ".")) || 0;
  const satoshi = isBtc ? fiatToSatoshi(amount, currency, price) : null;
  const btcStr  = satoshi != null ? satoshiToBtcStr(satoshi) : null;

  // ── Soglie minime BTC (derivate da btcLimits fetch) ─────────────────────────
  // Soglia 1: netSat >= minNetSat. Soglia 2: fiatNum >= minFiat[currency].
  // Logica AND: entrambe devono essere vere. Solo mostra il warning se l'utente
  // ha già inserito un valore (fiatNum > 0).
  const btcMinNetSat: bigint = btcLimits ? BigInt(btcLimits.minNetSat) : 10_000n;
  const btcMinFiat:   number = btcLimits
    ? (currency === "usd" ? btcLimits.minFiatUsd : btcLimits.minFiatEur)
    : (currency === "usd" ? 11 : 10);

  const btcBelowMinSat  = isBtc && fiatNum > 0 && satoshi != null && satoshi > 0n && satoshi < btcMinNetSat;
  const btcBelowMinFiat = isBtc && fiatNum > 0 && fiatNum < btcMinFiat;
  const btcBelowMin     = btcBelowMinSat || btcBelowMinFiat;

  // Carica soglie minime BTC una volta al mount (quando in modalità BTC)
  useEffect(() => {
    if (!isBtc) return;
    apiMCBtcLimits().then(setBtcLimits).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isBtc]);

  // Carica reti abilitate
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

  // Genera QR allo step 3 (sia EVM che BTC — EVM è per il fallback manuale)
  useEffect(() => {
    if (!transfer?.escrowWallet) return;
    if (step !== "address" && step !== "sign") return;
    let uri: string;
    if (isBtc) {
      const btcAmt = satoshisToUriAmount(transfer.minDepositAmount);
      uri = btcAmt
        ? `bitcoin:${transfer.escrowWallet}?amount=${btcAmt}`
        : `bitcoin:${transfer.escrowWallet}`;
    } else {
      uri = transfer.escrowWallet; // EVM: indirizzo plain per il fallback manuale
    }
    void QRCode.toDataURL(uri, {
      width: 200, margin: 2,
      color: { dark: "#a855f7", light: "#0F0A1E" },
    }).then(setQrDataUrl).catch(() => setQrDataUrl(null));
  }, [step, transfer, isBtc]);

  // Recovery iOS: recupera un transfer pending valido
  useEffect(() => {
    const raw = localStorage.getItem(MC_PENDING_KEY);
    if (!raw) return;
    let pending: MCPendingPayment;
    try { pending = JSON.parse(raw) as MCPendingPayment; }
    catch { localStorage.removeItem(MC_PENDING_KEY); return; }
    if (pending.conversationId !== conversationId) return;
    if (Date.now() - pending.timestamp > 30 * 60 * 1000) {
      localStorage.removeItem(MC_PENDING_KEY); return;
    }
    void apiMCGet(pending.transferId).then(t => {
      // ── Validazione 0: race condition guard ─────────────────────────────────
      // handleCreate o handleReset potrebbero essere stati chiamati MENTRE
      // apiMCGet era in volo (l'utente ha già riempito il form e premuto Continua).
      // Se localStorage non ha più lo stesso transferId (handleCreate → nuovo ID)
      // o è stato rimosso (handleReset), questa sessione recovery è obsoleta.
      // Abort senza toccare lo state: il nuovo transfer gestisce da solo la sua UI.
      let postCheckPending: MCPendingPayment | null = null;
      try { postCheckPending = JSON.parse(localStorage.getItem(MC_PENDING_KEY) ?? "") as MCPendingPayment; } catch {}
      if (!postCheckPending || postCheckPending.transferId !== pending.transferId) return;

      // ── Validazione 1: stato terminale → non ripristinare ──────────────────
      const terminal = ["cancelled", "expired", "released", "refunded", "failed"];
      if (terminal.includes(t.status)) {
        localStorage.removeItem(MC_PENDING_KEY);
        return;
      }

      // ── Validazione 2: BTC con indirizzo EVM (transfer pre-fix) → scarta ──
      // Prima del fix generateBtcEscrowWallet(), tutti i BTC transfer avevano
      // un escrow 0x... (Ethereum) invece di bc1... (SegWit). Non recuperare.
      if (t.network === "bitcoin" && /^0x/i.test(t.escrowWallet)) {
        localStorage.removeItem(MC_PENDING_KEY);
        return;
      }

      setTransfer(t);
      if (t.network === "bitcoin") {
        setStep("address");
        setSignPhase("confirming");
        // Fresca abort-ref per questo poll: sarà invalidata da handleCreate/handleReset
        const abort = { aborted: false };
        recoveryAbortRef.current = abort;
        void pollDetect(pending.transferId, abort).catch((e: unknown) => {
          if (abort.aborted) return; // session già superata — ignora
          setSignPhase("error");
          setSignError((e as Error)?.message ?? "Errore verifica deposito.");
        });
      } else {
        setStep("sign");
        if (pending.signed) {
          setSignPhase("confirming");
          const abort = { aborted: false };
          recoveryAbortRef.current = abort;
          void pollDetect(pending.transferId, abort).catch((e: unknown) => {
            if (abort.aborted) return;
            setSignPhase("error");
            setSignError((e as Error)?.message ?? "Errore verifica deposito.");
          });
        } else {
          setSignPhase("ready");
        }
      }
    }).catch(() => {
      // 404 o errore → transfer non più disponibile, ricomincia da capo
      localStorage.removeItem(MC_PENDING_KEY);
    });
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

  function satoshisToUriAmount(satStr: string | null | undefined): string | null {
    if (!satStr) return null;
    try {
      const sat = BigInt(satStr);
      if (sat <= 0n) return null;
      const whole  = sat / 100_000_000n;
      const rem    = sat % 100_000_000n;
      const remStr = rem.toString().padStart(8, "0").replace(/0+$/, "");
      return remStr ? `${whole}.${remStr}` : `${whole}`;
    } catch { return null; }
  }

  /** Formato importo principale (2 dec USDT, 8 dec BTC) */
  const fmtQ = (units: string) =>
    isBtc ? fmtDisplay(units, 8, 8) + " BTC" : fmtDisplay(units, rawDec, dispDec) + " " + ticker;

  /**
   * Formato fee: usa almeno 4 decimali per evitare "0.00" su fee piccole.
   * Es: project fee 0.001 USDT → "0.0010 USDT" (con dispDec=2 mostrerebbe "0.00")
   */
  const fmtFee = (units: string) => {
    try {
      const val = BigInt(units || "0");
      if (val === 0n) return "0.00 " + (isBtc ? "BTC" : ticker);
      return isBtc
        ? fmtDisplay(units, 8, 8) + " BTC"
        : fmtDisplay(units, rawDec, Math.max(dispDec, 4)) + " " + ticker;
    } catch { return "— " + ticker; }
  };

  const depositDisplay = transfer?.minDepositAmount
    ? fmtDisplay(transfer.minDepositAmount, rawDec, dispDec)
    : quote ? fmtDisplay(quote.grossAmount, rawDec, dispDec) : "0";

  // ── Step 1 → 2: calcola quote ──────────────────────────────────────────────

  async function handleContinue() {
    if (isBtc) {
      if (!amount.trim() || fiatNum <= 0)   { setError(t("multichain.invalidAmount")); return; }
      if (!price)                            { setError("Prezzo BTC non disponibile."); return; }
      if (!satoshi || satoshi <= 0n)         { setError(t("multichain.invalidAmount")); return; }
      // Doppia soglia minima BTC: blocca anche qui (difesa vs bypass)
      if (btcBelowMin) {
        setError(`Importo minimo: ${fiatSymbol}${btcMinFiat} / ${Number(btcMinNetSat).toLocaleString()} sat (0.0001 BTC)`);
        return;
      }
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
        // (Solo BTC) Invia anche il valore fiat per la doppia soglia backend
        ...(isBtc && fiatNum > 0 ? {
          btcFiatAmount:   fiatNum,
          btcFiatCurrency: currency,
        } : {}),
      });
      setTransfer(result);

      // Salva recovery: signed=false per EVM (firma ancora da fare), signed=true per BTC
      localStorage.setItem(MC_PENDING_KEY, JSON.stringify({
        transferId:     result.transferId,
        conversationId,
        network,
        timestamp:      Date.now(),
        signed:         isBtc,
      } satisfies MCPendingPayment));

      if (isBtc) {
        // BTC: avvia subito il polling — l'utente invierà dal wallet Bitcoin
        // Invalida qualsiasi recovery poll stale prima di avviarne uno nuovo.
        recoveryAbortRef.current.aborted = true;
        setStep("address");
        setSignPhase("confirming");
        const abort = { aborted: false };
        recoveryAbortRef.current = abort;
        void pollDetect(result.transferId, abort).catch((e: unknown) => {
          if (abort.aborted) return;
          setSignPhase("error");
          setSignError((e as Error)?.message ?? "Errore verifica deposito.");
        });
      } else {
        // EVM: invalida recovery poll stale, poi mostra step firma
        // (il polling EVM inizia solo dopo che l'utente preme "Firma transazione")
        recoveryAbortRef.current.aborted = true;
        setStep("sign");
        setSignPhase("ready");
      }
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
  }, [quote, targetNetUnits, toUserId, conversationId, network, note, isBtc, price, currency, fiatSymbol, t]);

  // ── Step 3 EVM: firma transazione ─────────────────────────────────────────
  //
  // Architettura (spec definitiva):
  //   1. Chain switch ESPLICITO (await useSwitchActiveWalletChain) se chain ≠ richiesta
  //   2. sendTransaction fire-and-forget (NO chainId — la chain è già corretta)
  //   3. Polling backend come source of truth
  //
  // NON usare sendTransaction({ chainId }) come meccanismo di switch implicito:
  // causa "Missing or invalid chainId" su Trust Wallet iOS via WalletConnect
  // per catene non-Polygon (BSC / Ethereum).

  async function handleSign() {
    if (!account || !transfer || !evmChain || !evmChainId) return;

    const tokenAddress = MC_TOKEN_CONTRACT[network] as `0x${string}` | null | undefined;
    if (!tokenAddress) { setSignError("Rete non supportata per USDT."); return; }

    const depositAmount = BigInt(transfer.minDepositAmount ?? transfer.grossAmount ?? "0");
    if (depositAmount === 0n) { setSignError("Importo deposito non valido."); return; }

    setSignError(null);

    // ── iOS: pre-open wallet PRIMA di qualsiasi await ────────────────────────
    //
    // Root cause: dopo await switchChain() + await apiMCDetect() il contesto
    // user-gesture iOS è perso. ThirdWeb chiama window.location.href="trust://"
    // per aprire il wallet → iOS WebKit BLOCCA la navigazione (nessun gesture).
    // Il relay WC consegna comunque la richiesta via WebSocket, ma Trust Wallet
    // rimane in background e l'utente deve aprirlo manualmente.
    //
    // Fix: sparare window.location.href PRIMA del primo await, nel tick sincrono
    // del click handler. Trust Wallet/SafePal vengono portati in foreground ORA;
    // la richiesta WC arriverà via relay pochi istanti dopo.
    //
    // Il map è un subset sicuro — solo schemi nativi confermati su iOS.
    // Nessun rischio di doppia TX: apriamo solo l'app, non inviamo nulla.
    if (/iphone|ipad|ipod/i.test(navigator.userAgent)) {
      const NATIVE_SCHEME: Record<string, string> = {
        "com.trustwallet.app": "trust://",
        "io.metamask":         "metamask://",
        "com.coinbase.wallet": "cbwallet://",
        "me.rainbow":          "rainbow://",
        "io.zerion.wallet":    "zerion://",
      };
      const scheme = activeWallet?.id ? NATIVE_SCHEME[activeWallet.id] : undefined;
      if (scheme) {
        console.log("[MC] pre-open wallet iOS:", activeWallet?.id, "→", scheme);
        window.location.href = scheme;
      }
    }

    // ── 1. Chain switch esplicito (awaited) ───────────────────────────────
    //
    // Confronta la chain attiva con quella richiesta.
    // Se diversa: useSwitchActiveWalletChain aggiorna la sessione WalletConnect
    // in modo sincrono PRIMA di inviare la TX — al contrario del chainId implicito
    // in sendTransaction che fallisce su Trust Wallet per BSC/ETH.

    if (activeWalletChain?.id !== evmChainId) {
      setSignPhase("switching");
      try {
        await switchChain(evmChain);
      } catch (err: unknown) {
        const msg = (err as Error)?.message ?? "";
        if (/reject|cancel|denied|refused|user rejected/i.test(msg)) {
          setSignError(`Cambio rete rifiutato. Tocca "Firma transazione" e accetta il cambio rete nel wallet.`);
        } else if (/not supported|not recognized|missing.*chain|unsupported/i.test(msg)) {
          setSignError(`${selectedNet.sublabel} non è supportata da questo wallet. Apri Trust Wallet → Impostazioni → Reti → abilita ${selectedNet.sublabel}, poi riconnetti.`);
        } else if (/disconnected|not connected/i.test(msg)) {
          setSignError("Wallet disconnesso durante il cambio rete. Riconnetti il wallet e riprova.");
        } else {
          setSignError(`Impossibile passare a ${selectedNet.sublabel}: ${msg || "Errore sconosciuto."}`);
        }
        setSignPhase("ready");
        return;
      }
      // Verifica post-switch: la chain attiva deve corrispondere (best-effort)
      // activeWalletChain è reattivo — il valore aggiornato arriverà al prossimo render.
      // switchChain risolve solo dopo il successo → possiamo procedere.
    }

    // ── 2. Stato "firma in corso" ──────────────────────────────────────────
    setSignPhase("signing");

    // ── 3. Pre-sign check: deposito già rilevato? (stale WC relay) ─────────
    //
    // IMPORTANTE: il backend restituisce HTTP 200 in ENTRAMBI i casi:
    //   • balance < required  → status "awaiting_deposit"  (non ancora trovato)
    //   • balance >= required → status "pending"           (trovato)
    // Dobbiamo controllare t.status, NON solo il fatto che la chiamata non abbia
    // lanciato un'eccezione.  Ignorare questo controllo causa "Pagamento confermato!"
    // immediato anche con escrow vuoto (bug critico BTC + EVM).
    try {
      const preCheck = await apiMCDetect(transfer.transferId);
      if (preCheck.status !== "awaiting_deposit") {
        // Deposito già rilevato on-chain prima della firma (stale WC relay)
        setSignPhase("done");
        return;
      }
      // status === "awaiting_deposit" → deposito non ancora arrivato, procedi con firma
    } catch {
      // Errore di rete / 401 / non trovato — procedi con la firma
    }

    // ── 4. sendTransaction fire-and-forget ────────────────────────────────
    //
    // NON await txHash — fonte di verità = backend detect.
    // Usa accountRef.current (non la closure `account`) per ottenere l'account
    // aggiornato dopo switchChain: ThirdWeb v5 può rimpiazzare l'oggetto account
    // al cambio chain; la closure stale causa "connect() before request()".

    const currentAccount = accountRef.current;
    if (!currentAccount) {
      setSignError("Wallet disconnesso dopo il cambio rete. Riconnetti il wallet e riprova.");
      setSignPhase("ready");
      return;
    }

    // ── Diagnostica ────────────────────────────────────────────────────────
    console.log("[MC] wallet_send_start", { network, chainId: evmChainId });
    console.log("[MC] wallet_provider_detected");

    // Cattura transferId ora (chiusura safe — transfer è non-null per il guard sopra).
    const capturedTransferId = transfer.transferId;

    let pollAborted     = false;
    let signedUncertain = false; // true = TX potrebbe essere già in mempool → NON mostrare "Firma"
    let signErrorMsg: string | null = null;

    // ── sendTransaction fire-and-forget ─────────────────────────────────────
    //
    // Il pattern rimane fire-and-forget per evitare problemi di nonce/iOS già risolti.
    //
    // CORREZIONE STATO UI (bug del 14/08/2026):
    //   PRIMA: setSignPhase("confirming") subito dopo .catch() → "Transazione inviata"
    //          appariva nel momento della chiamata, PRIMA che il wallet firmasse.
    //   ORA:   setSignPhase("confirming") è dentro .then() → scatta solo quando
    //          ThirdWeb ha ricevuto il TX hash dal wallet.
    //   INVARIANTE: signPhase resta "signing" ("In attesa della firma nel wallet…")
    //               finché il wallet non risponde o non fallisce.
    console.log("[MC] wallet_signature_requested");
    currentAccount.sendTransaction({
      to:    tokenAddress,
      data:  encodeERC20Transfer(transfer.escrowWallet, depositAmount),
      gas:   BigInt(150000),
      value: BigInt(0),
      chainId: evmChainId,
    }).then(() => {
      // ── TX hash ricevuto: il wallet ha firmato e la TX è broadcast ─────────
      // Solo in questo punto è corretto mostrare "Transazione inviata".
      console.log("[MC] wallet_signature_returned, transaction_hash_received");
      setSignPhase(prev => {
        // Guard anti-regressione: il polling potrebbe aver già rilevato il deposito
        // (setSignPhase("done")) durante il round-trip WalletConnect. In quel caso
        // non tornare indietro a "confirming".
        if (prev === "done" || prev === "error" || prev === "uncertain") return prev;
        return "confirming";
      });
      // Aggiorna recovery: signed=true — solo dopo TX hash confermato
      localStorage.setItem(MC_PENDING_KEY, JSON.stringify({
        transferId:     capturedTransferId,
        conversationId,
        network,
        timestamp:      Date.now(),
        signed:         true,
      } satisfies MCPendingPayment));
    }).catch((err: unknown) => {
      const msg = (err as Error)?.message ?? "";
      if (/reject|cancel|denied|refused|user rejected/i.test(msg)) {
        // Rifiuto esplicito utente: la TX NON è stata inviata → retry sicuro
        console.log("[MC] wallet_signature_rejected:", msg);
        pollAborted  = true;
        signErrorMsg = "Firma rifiutata. Premi \"Firma transazione\" per riprovare.";
      } else if (/nonce.*too.*low|nonce.*used|nonce.*already/i.test(msg)) {
        // TX già inviata con questo nonce — il polling la rileverà on-chain.
        console.warn("[MC] Nonce già usato — polling rileverà il deposito.");
      } else if (/insufficient funds|insufficient balance/i.test(msg)) {
        // Balance insufficiente: la TX è stata rifiutata dal nodo prima del broadcast
        pollAborted  = true;
        signErrorMsg = `Gas insufficiente. Aggiungi ${selectedNet.sublabel === "BSC" ? "BNB" : selectedNet.sublabel === "Ethereum" ? "ETH" : "POL"} per le fee di rete.`;
      } else if (/connect.*before.*request|please.*call.*connect/i.test(msg)) {
        // Wallet non connesso quando sendTransaction ha tentato di firmare.
        // ThirdWeb lancia questo PRIMA di inviare al wallet → TX definitivamente NON inviata.
        pollAborted  = true;
        signErrorMsg = "Wallet non connesso. Chiudi, riconnetti il wallet e riprova.";
      } else if (/missing or invalid|eip155|unrecognized chain|does not support|wrong network/i.test(msg)) {
        // Errore chain: la TX è stata rifiutata dal wallet — retry sicuro dopo reconnessione
        pollAborted  = true;
        signErrorMsg = `Errore di rete: il wallet non ha accettato ${selectedNet.sublabel}. Disconnetti, riconnetti e riprova.`;
      } else if (
        // ⚠️  CASO CRITICO — double-spend risk:
        // "Load failed" (iOS Safari), "Failed to fetch" (Chrome), "NetworkError" (Firefox),
        // timeout WalletConnect: il relay di rete è caduto DOPO che il wallet ha firmato
        // e inviato la TX. La TX è probabilmente già in mempool.
        // NON abortire, NON mostrare "Firma transazione" → prevenire double-spend.
        isNetworkError(err) ||
        msg.includes("Load failed") ||
        msg.includes("Failed to fetch") ||
        msg.startsWith("NetworkError") ||
        /timeout|timed out/i.test(msg)
      ) {
        signedUncertain = true;
        signErrorMsg    = "⚠️ Connessione interrotta durante la firma. La transazione potrebbe essere già stata inviata — stiamo verificando automaticamente.";
        console.warn("[MC] wallet_signature_timeout — TX potrebbe essere in mempool:", msg);
      } else if (
        // ─── Pre-dispatch: BSC non presente nel namespace WC2 ────────────────
        // Crash sincrono PRIMA che la richiesta raggiunga il relay WalletConnect.
        // La TX non è mai stata inviata al wallet → pollAborted (mai signedUncertain).
        //
        // Causa: Trust Wallet / SafePal approvano solo ETH+Polygon dalla sessione
        // iniziale; eip155:56 non è nel namespace → EIP155Provider.namespace.methods
        // === undefined → TypeError.
        //
        // Fix per l'utente: disconnettere il wallet corrente (sessione Polygon/ETH)
        // e riconnettersi — il ConnectButton per BSC usa walletsBsc che propone
        // solo BSC+ETH, forzando Trust Wallet ad approvare BSC nel nuovo namespace.
        /namespace.*methods|methods.*namespace/i.test(msg) ||
        /is not an object.*evaluating.*namespace/i.test(msg) ||
        /Cannot read.*properties.*undefined.*includes/i.test(msg)
      ) {
        pollAborted  = true;
        signErrorMsg = `Sessione wallet non compatibile con BSC.\n\nDisconnetti il wallet (tocca l'indirizzo in alto), poi premi "Connetti wallet" e approva BSC nella nuova sessione.`;
        console.warn("[MC] wc2_namespace_bsc_missing — TX mai inviata:", msg);
      } else if (/rpc|provider/i.test(msg)) {
        signedUncertain = true;
        signErrorMsg    = `Errore RPC su ${selectedNet.sublabel}. La transazione potrebbe essere già stata inviata — stiamo verificando.`;
        console.warn("[MC] wallet_provider_error:", msg);
      } else {
        // Errore sconosciuto: trattare come incerto (TX potrebbe essere in mempool)
        signedUncertain = true;
        signErrorMsg    = `⚠️ Errore firma: ${msg || "Errore sconosciuto."} La transazione potrebbe essere già stata inviata — stiamo verificando.`;
        console.warn("[MC] wallet_provider_error (sconosciuto):", msg);
      }
    });

    console.log("[MC] transaction_polling_started");

    // Polling con grace period per errori firma (identico a USDA)
    const POLL_INTERVAL_MS       = 10_000;
    const POLL_MAX_MS            = 10 * 60 * 1000;
    const SIGN_ERROR_GRACE_POLLS = 3;
    const pollStart              = Date.now();
    let   first                  = true;
    let   pollCount              = 0;

    while (Date.now() - pollStart < POLL_MAX_MS) {
      await new Promise<void>(r => setTimeout(r, first ? 2000 : POLL_INTERVAL_MS));
      first = false;
      pollCount++;

      if (pollAborted) {
        setSignPhase("error");
        setSignError(signErrorMsg ?? "Firma annullata.");
        return;
      }

      try {
        const t = await apiMCDetect(transfer.transferId);
        // Il backend risponde 200 sia quando il deposito è assente (status "awaiting_deposit")
        // che quando è rilevato (status "pending" o successivo).
        // Solo lo status post-"awaiting_deposit" costituisce una conferma reale.
        if (t.status === "awaiting_deposit") {
          if (signErrorMsg && pollCount >= SIGN_ERROR_GRACE_POLLS) {
            if (signedUncertain) {
              // ⚠️ TX potrebbe essere già in mempool — NON mostrare "Firma transazione".
              // Mostra avviso "uncertain" e CONTINUA il polling (non fare return).
              setSignPhase("uncertain");
              setSignError(signErrorMsg);
              // continua il loop — la TX potrebbe arrivare nei prossimi blocchi
            } else {
              // Rifiuto esplicito o errore pre-broadcast confermato: retry sicuro
              setSignPhase("error");
              setSignError(signErrorMsg);
              return;
            }
          }
          continue; // Deposito non ancora presente — ripolla
        }
        console.log("[MC] transaction_confirmed");
        setSignPhase("done");
        return;
      } catch (pollErr: unknown) {
        const code = (pollErr as Error & { code?: string })?.code;
        if (code === "DEPOSIT_TX_NOT_DETECTED" || code === "ADAPTER_NOT_FOUND") {
          if (signErrorMsg && pollCount >= SIGN_ERROR_GRACE_POLLS) {
            if (signedUncertain) {
              setSignPhase("uncertain");
              setSignError(signErrorMsg);
              // continua polling
            } else {
              setSignPhase("error");
              setSignError(signErrorMsg);
              return;
            }
          }
          continue;
        }
        // Errore di RETE transitorio nel polling (iOS Safari aborta la fetch
        // in-flight quando l'app va in background durante la firma nel wallet:
        // "Load failed" / "Failed to fetch" / "NetworkError").
        // NON è un fallimento del pagamento: la TX potrebbe essere già in mempool.
        // → continua il polling; MAI setSignPhase("error") (ri-mostrerebbe "Firma"
        //   → rischio double-spend). isNetworkError() riconosce SOLO TypeError di
        //   fetch: gli errori applicativi (con .code o custom) restano fatali sotto.
        // Gate `!code`: un errore applicativo con .code resta SEMPRE fatale,
        // anche se per qualche ragione fosse un TypeError con messaggio da fetch.
        if (!code && isNetworkError(pollErr)) {
          console.warn("[MC] poll_network_abort — transitorio, continuo il polling:",
            (pollErr as Error)?.message);
          continue;
        }
        // Errore reale (applicativo): stop
        setSignPhase("error");
        setSignError((pollErr as Error)?.message ?? "Errore verifica deposito.");
        return;
      }
    }

    // Timeout 10 minuti: se la TX era incerta, non mostrare il bottone firma
    if (signedUncertain) {
      setSignPhase("uncertain");
      setSignError("⚠️ Verifica automatica scaduta. Se hai firmato la transazione nel wallet, premi \"Ho inviato\" per confermare manualmente.");
    } else {
      setSignPhase("error");
      setSignError("Timeout: deposito non rilevato in 10 minuti. Controlla la transazione nel tuo wallet.");
    }
  }

  // ── Polling BTC e recovery EVM (senza la logica firma) ───────────────────

  /**
   * pollDetect — polling backend finché il deposito è rilevato.
   *
   * @param transferId  Transfer da monitorare.
   * @param abort       Oggetto condiviso: se `abort.aborted === true` il loop si ferma
   *                    silenziosamente (usato per interrompere il recovery in background
   *                    quando l'utente crea un nuovo transfer o resetta il flusso).
   */
  async function pollDetect(transferId: string, abort?: { aborted: boolean }): Promise<void> {
    const POLL_INTERVAL_MS = 10_000;
    const POLL_MAX_MS      = 10 * 60 * 1000;
    const pollStart        = Date.now();
    let   first            = true;

    while (Date.now() - pollStart < POLL_MAX_MS) {
      await new Promise<void>(r => setTimeout(r, first ? 2000 : POLL_INTERVAL_MS));
      first = false;

      // Se il flusso è stato resettato / un nuovo transfer è stato creato,
      // interrompi silenziosamente questo poll stale.
      if (abort?.aborted) return;

      try {
        const t = await apiMCDetect(transferId);
        // Il backend risponde 200 sia quando il deposito è assente ("awaiting_deposit")
        // che quando è rilevato ("pending" o successivo).
        // Avanzare a "done" solo se il deposito è stato realmente confermato.
        if (t.status === "awaiting_deposit") continue; // ancora in attesa — ripolla
        // Guard finale: un nuovo transfer o un reset potrebbe essere avvenuto durante l'await
        if (abort?.aborted) return;
        setSignPhase("done");
        return;
      } catch (pollErr: unknown) {
        const code = (pollErr as Error & { code?: string })?.code;
        // Deposito non ancora trovato dalla blockchain — transitorio, riprova.
        if (code === "DEPOSIT_TX_NOT_DETECTED") continue;
        // Errore di rete transitorio (iOS Safari "Load failed", Chrome "Failed to fetch", …):
        // non terminare il monitor — riprova al prossimo ciclo senza mostrare banner rosso.
        if (isNetworkError(pollErr)) continue;
        // Qualsiasi altro errore (ADAPTER_NOT_FOUND, FEATURE_DISABLED, errori applicativi): fatale.
        throw pollErr;
      }
    }
    throw new Error("Timeout: deposito non rilevato in 10 minuti.");
  }

  // ── Cancella transfer e ricomincia ────────────────────────────────────────
  //
  // Usato quando l'utente è bloccato (transfer pre-fix, errore rete, timeout).
  // Chiama il backend per segnare "cancelled", poi pulisce localStorage e
  // riporta la sheet allo step 1.

  async function handleReset() {
    // Interrompi qualsiasi poll in background (recovery o BTC) prima di resettare
    recoveryAbortRef.current.aborted = true;
    setCancelling(true);
    try {
      if (transfer?.transferId && transfer.status === "awaiting_deposit") {
        await apiMCCancel(transfer.transferId).catch(() => {}); // best-effort
      }
    } finally {
      localStorage.removeItem(MC_PENDING_KEY);
      setTransfer(null);
      setStep("form");
      setSignPhase("ready");
      setSignError(null);
      setError(null);
      setQuote(null);
      setTargetNetUnits(null);
      setQrDataUrl(null);
      setCancelling(false);
    }
  }

  // ── Copia indirizzo ────────────────────────────────────────────────────────

  async function handleCopy(addr: string) {
    await navigator.clipboard.writeText(addr);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={t("multichain.sendTitle")} onClick={onClose}>
      <div className="usda-sheet mc-sheet" onClick={e => e.stopPropagation()}>

        {/* Header — X SEMPRE attiva, mai bloccata */}
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

        {/* ── Step 1: form ─────────────────────────────────────────────── */}
        {step === "form" && (
          <>
            <div className="usda-sheet-to">{t("multichain.toLabel")} <strong>{toName}</strong></div>

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
                {/* Warning soglia minima BTC — visibile solo quando l'importo è troppo basso */}
                {btcBelowMin && fiatNum > 0 && (
                  <div className="mc-btc-min-warning" role="status">
                    ⚠️ Importo minimo: <strong>{fiatSymbol}{btcMinFiat}</strong> / {Number(btcMinNetSat).toLocaleString()} sat (0.0001 BTC)
                  </div>
                )}
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
                disabled={loading || (isBtc && priceLoading && !price) || (isBtc && btcBelowMin && fiatNum > 0)}
                aria-busy={loading}>
                {loading ? <><span className="usda-btn-spinner" aria-hidden="true" /> Calcolo…</> : t("multichain.continueBtn")}
              </button>
            </div>
          </>
        )}

        {/* ── Step 2: conferma + wallet status ─────────────────────────── */}
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
                <span>
                  Network fee
                  {!isBtc && <em style={{ fontSize: "0.72em", opacity: 0.7, marginLeft: 4 }}>(stima gas)</em>}
                  {quote.btcFeeFloorApplied && <em style={{ fontSize: "0.72em", opacity: 0.7, marginLeft: 4 }}>(min 546 sat)</em>}
                </span>
                <span>+{fmtFee(totalFeeUnits(quote).toString())}</span>
              </div>
              <div className="mc-confirm-row mc-confirm-total">
                <span>Totale pagato</span>
                <span>
                  {isBtc ? (
                    <>
                      {fmtQ(totalPaidUnits(quote).toString())}
                      {" "}<em style={{ fontSize: "0.76em", opacity: 0.65 }}>(+ fee miner BTC)</em>
                    </>
                  ) : (
                    /* fmtFee usa Math.max(dispDec,4) → mostra decimali sufficienti
                       per evidenziare la differenza rispetto al netto (es. 1.0082 USDT) */
                    fmtFee(totalPaidUnits(quote).toString())
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

            {/* Stato wallet EVM nella conferma */}
            {isEvm && (
              !isConnected ? (
                <div className="sp-wallet-prompt">
                  <p className="sp-wallet-prompt-text">Connetti il wallet per firmare la transazione</p>
                  <div className="usda-connect-btn-wrap">
                    <ConnectButton client={client} chain={evmChain ?? polygon} wallets={network === "bsc" ? walletsBsc : wallets} />
                  </div>
                </div>
              ) : (
                <div className="sp-wallet-ready">
                  <span className="usda-wallet-dot" aria-hidden="true" />
                  <span className="sp-wallet-addr">
                    {account.address.slice(0, 6)}…{account.address.slice(-4)} · {selectedNet.sublabel}
                  </span>
                </div>
              )
            )}

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

        {/* ── Step 3 EVM: firma transazione ────────────────────────────── */}
        {step === "sign" && transfer && (
          <>
            <div className="usda-sheet-to">{t("multichain.toLabel")} <strong>{toName}</strong></div>

            {/* Riepilogo */}
            <div className="mc-confirm-summary">
              <div className="mc-confirm-row">
                <span>Rete</span>
                <span>{selectedNet.label} · {selectedNet.sublabel}</span>
              </div>
              <div className="mc-confirm-row mc-confirm-total">
                <span>Invia esattamente</span>
                <strong>{depositDisplay} {ticker}</strong>
              </div>
            </div>

            {/* Fasi visive */}
            {signPhase === "done" && (
              <div className="usda-phase-box">
                <span className="usda-phase-icon">✅</span>
                <div>
                  <p className="usda-phase-title">Pagamento confermato!</p>
                  <p className="usda-phase-desc">Il deposito è stato rilevato. La chat verrà aggiornata.</p>
                </div>
              </div>
            )}
            {signPhase === "switching" && (
              <div className="usda-phase-box">
                <span className="usda-btn-spinner usda-phase-icon" aria-hidden="true" />
                <div>
                  <p className="usda-phase-title">Cambio rete in corso…</p>
                  <p className="usda-phase-desc">Approva il cambio a {selectedNet.sublabel} nel wallet.</p>
                </div>
              </div>
            )}
            {signPhase === "signing" && (
              <div className="usda-phase-box">
                <span className="usda-btn-spinner usda-phase-icon" aria-hidden="true" />
                <div>
                  <p className="usda-phase-title">In attesa della firma nel wallet…</p>
                  <p className="usda-phase-desc">Approva la transazione USDT nel wallet. Se il wallet non si apre automaticamente, aprilo manualmente e cerca la richiesta in sospeso.</p>
                </div>
              </div>
            )}
            {signPhase === "confirming" && (
              <div className="usda-phase-box">
                <span className="usda-btn-spinner usda-phase-icon" aria-hidden="true" />
                <div>
                  <p className="usda-phase-title">Transazione inviata</p>
                  <p className="usda-phase-desc">Stiamo verificando il pagamento sulla blockchain…</p>
                </div>
              </div>
            )}
            {signPhase === "error" && signError && (
              <div className="usda-error" role="alert" style={{ whiteSpace: "pre-line" }}>{signError}</div>
            )}

            {/* Stato incerto: TX potrebbe essere già in mempool — NON mostrare retry firma */}
            {signPhase === "uncertain" && (
              <div style={{
                background: "rgba(251,191,36,0.08)",
                border: "1px solid rgba(251,191,36,0.3)",
                borderRadius: 10,
                padding: "12px 14px",
                display: "flex",
                gap: 10,
                alignItems: "flex-start",
                marginTop: 4,
              }} role="alert">
                <span style={{ fontSize: 18, flexShrink: 0, marginTop: 1 }}>⚠️</span>
                <div>
                  <p style={{ fontWeight: 600, color: "#fbbf24", fontSize: 14, margin: "0 0 4px" }}>
                    Connessione interrotta dopo la firma
                  </p>
                  <p style={{ fontSize: 13, color: "rgba(255,255,255,0.65)", margin: 0, lineHeight: 1.4 }}>
                    {signError ?? "La transazione potrebbe essere già stata inviata. Stiamo continuando la verifica automatica — non firmare di nuovo."}
                  </p>
                  <p style={{ fontSize: 12, color: "rgba(251,191,36,0.7)", marginTop: 6 }}>
                    🔄 Verifica automatica in corso…
                  </p>
                </div>
              </div>
            )}

            {/* Azione principale: connetti o firma */}
            {/* "uncertain" escluso deliberatamente: la TX potrebbe essere già in mempool → prevenire double-spend */}
            {signPhase !== "done" && signPhase !== "confirming" && signPhase !== "switching" && signPhase !== "signing" && signPhase !== "uncertain" && (
              !isConnected ? (
                <div className="sp-wallet-prompt">
                  <p className="sp-wallet-prompt-text">Connetti il wallet per firmare</p>
                  <div className="usda-connect-btn-wrap">
                    <ConnectButton client={client} chain={evmChain ?? polygon} wallets={network === "bsc" ? walletsBsc : wallets} />
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  className="usda-btn-primary"
                  onClick={handleSign}
                >
                  ✍️ Firma transazione →
                </button>
              )
            )}

            {/* Fallback manuale: nascosto, accessibile in caso di problemi */}
            {signPhase !== "done" && (
              <details
                style={{ marginTop: 12 }}
                onToggle={e => setShowManual((e.target as HTMLDetailsElement).open)}
              >
                <summary style={{ cursor: "pointer", opacity: 0.55, fontSize: "0.82em", userSelect: "none" }}>
                  Problemi con il wallet? → Invia manualmente
                </summary>
                {showManual && (
                  <div style={{ marginTop: 10 }}>
                    <p style={{ fontSize: "0.8em", opacity: 0.6, marginBottom: 8 }}>
                      Invia esattamente <strong>{depositDisplay} {ticker}</strong> su <strong>{selectedNet.sublabel}</strong> all'indirizzo:
                    </p>
                    {qrDataUrl && (
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, marginBottom: 8 }}>
                        <img src={qrDataUrl} alt="QR indirizzo" style={{ width: 140, height: 140, borderRadius: 10 }} />
                        <p style={{ fontSize: "0.72rem", color: "rgba(255,255,255,0.35)", margin: 0 }}>Scansiona per copiare l'indirizzo</p>
                      </div>
                    )}
                    <div className="mc-address-block">
                      <div className="mc-address-box">
                        <span className="mc-address-text">{transfer.escrowWallet}</span>
                      </div>
                      <button type="button" className="mc-copy-btn" onClick={() => handleCopy(transfer.escrowWallet)}>
                        {copied ? t("multichain.addressCopied") : "📋 Copia indirizzo"}
                      </button>
                    </div>
                  </div>
                )}
              </details>
            )}

            <p className="mc-address-expiry" style={{ marginTop: 8 }}>⏰ {t("multichain.expiresIn24h")}</p>

            <div className="usda-sheet-actions" style={{ marginTop: 8 }}>
              {/* Pulsante escape: visibile quando bloccato (confirming/error) — permette di ricominciare */}
              {(signPhase === "confirming" || signPhase === "error") && (
                <button
                  type="button"
                  className="usda-btn-secondary"
                  onClick={handleReset}
                  disabled={cancelling}
                  style={{ fontSize: "0.82em" }}
                >
                  {cancelling ? "…" : "✕ Nuova transazione"}
                </button>
              )}
              <button type="button" className="usda-btn-primary" onClick={onSent}>
                {signPhase === "done" ? t("multichain.doneBtn") : "Ho inviato →"}
              </button>
            </div>
          </>
        )}

        {/* ── Step 3 BTC: indirizzo escrow ─────────────────────────────── */}
        {step === "address" && transfer && (() => {
          const btcAmt    = satoshisToUriAmount(transfer.minDepositAmount);
          const bitcoinUri = btcAmt
            ? `bitcoin:${transfer.escrowWallet}?amount=${btcAmt}`
            : `bitcoin:${transfer.escrowWallet}`;

          return (
            <>
              <div className="usda-sheet-to">{t("multichain.toLabel")} <strong>{toName}</strong></div>

              <div className="mc-confirm-summary">
                <div className="mc-confirm-row">
                  <span>Rete</span>
                  <span>₿ Bitcoin</span>
                </div>
                <div className="mc-confirm-row mc-confirm-total">
                  <span>Invia esattamente</span>
                  <span style={{ display: "flex", alignItems: "center", gap: 7 }}>
                    <strong>{depositDisplay} BTC</strong>
                    <button
                      type="button"
                      className={`mc-copy-amount-btn${copiedAmount ? " copied" : ""}`}
                      title="Copia importo"
                      aria-label="Copia importo BTC"
                      onClick={async () => {
                        await navigator.clipboard.writeText(depositDisplay);
                        setCopiedAmount(true);
                        setTimeout(() => setCopiedAmount(false), 2000);
                      }}
                    >
                      {copiedAmount ? "✓" : "📋"}
                    </button>
                  </span>
                </div>
              </div>

              {/* Polling state */}
              {signPhase === "done" && (
                <div className="usda-phase-box">
                  <span className="usda-phase-icon">✅</span>
                  <div>
                    <p className="usda-phase-title">Pagamento confermato!</p>
                    <p className="usda-phase-desc">Il deposito Bitcoin è stato rilevato.</p>
                  </div>
                </div>
              )}
              {signPhase === "confirming" && (
                <div className="usda-phase-box">
                  <span className="usda-btn-spinner usda-phase-icon" aria-hidden="true" />
                  <div>
                    <p className="usda-phase-title">In attesa del deposito…</p>
                    <p className="usda-phase-desc">Invia BTC all'indirizzo qui sotto. Rileveremo il pagamento automaticamente.</p>
                  </div>
                </div>
              )}
              {signPhase === "error" && signError && (
                <div className="usda-error" role="alert">{signError}</div>
              )}

              {/* Istruzione: apri tu il tuo wallet Bitcoin e incolla l'indirizzo */}
              {signPhase !== "done" && (
                <div className="mc-btc-instruction">
                  <p className="mc-btc-instruction-title">Come inviare</p>
                  <ol className="mc-btc-instruction-steps">
                    <li>Copia l'indirizzo qui sotto</li>
                    <li>Apri il tuo wallet Bitcoin (Trust Wallet, Blue Wallet…)</li>
                    <li>Invia esattamente <strong>{depositDisplay} BTC</strong> all'indirizzo copiato</li>
                  </ol>
                </div>
              )}

              {/* Indirizzo escrow — pulsante copia primario */}
              <div className="mc-address-block">
                <div className="mc-address-box">
                  <span className="mc-address-text">{transfer.escrowWallet}</span>
                </div>
                {/* Pulsante copia grande — azione primaria */}
                <button
                  type="button"
                  className={`usda-btn-primary${copied ? " mc-copy-success" : ""}`}
                  style={{ marginTop: 8 }}
                  onClick={() => handleCopy(transfer.escrowWallet)}
                >
                  {copied ? "✅ Indirizzo copiato!" : "📋 Copia indirizzo"}
                </button>
                <p className="mc-address-expiry" style={{ marginTop: 10 }}>⏰ {t("multichain.expiresIn24h")}</p>
              </div>

              {/* QR code — per scansionare con il wallet */}
              {qrDataUrl && (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, marginTop: 4 }}>
                  <p style={{ fontSize: "0.75rem", color: "rgba(255,255,255,0.4)", margin: 0 }}>
                    oppure scansiona con il wallet Bitcoin
                  </p>
                  <img src={qrDataUrl} alt="QR Bitcoin" style={{ width: 150, height: 150, borderRadius: 12 }} />
                </div>
              )}

              <div className="usda-sheet-actions">
                {/* Escape: ricomincia con un transfer pulito */}
                {(signPhase === "confirming" || signPhase === "error") && (
                  <button
                    type="button"
                    className="usda-btn-secondary"
                    onClick={handleReset}
                    disabled={cancelling}
                    style={{ fontSize: "0.82em" }}
                  >
                    {cancelling ? "…" : "✕ Nuova transazione"}
                  </button>
                )}
                <button type="button" className="usda-btn-primary" onClick={onSent}>
                  {signPhase === "done" ? t("multichain.doneBtn") : "Ho inviato →"}
                </button>
              </div>
            </>
          );
        })()}

      </div>
    </div>
  );
}
