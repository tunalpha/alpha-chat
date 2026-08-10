/**
 * MultiChainPayRequestSheet — pagamento di una richiesta MultiChain (EVM: Polygon/BSC/Ethereum)
 *
 * Aperto quando il pagatore clicca "Paga X USDT" sulla bolla mc_payment (is_request=true).
 * Il transfer è già creato: escrow wallet già assegnato, nessun step form/confirm.
 *
 * Flusso:
 *   idle
 *   → checking   (pre-check apiMCDetect — deposito già presente?)
 *   → switching  (chain switch esplicito, se necessario)
 *   → signing    (sendTransaction fire-and-forget → Trust Wallet / MetaMask)
 *   → confirming (polling apiMCDetect ogni 10 s — source of truth = backend)
 *   → done
 *   | error
 *
 * Reference:
 *   - UX "Paga ora":        UsdaRequestBubble
 *   - Pattern firma EVM:    MultiChainSendSheet.handleSign()
 *   - Recovery iOS/PWA:     SendPaymentSheet + MultiChainSendSheet
 *
 * NON modificare:
 *   - USDA flow
 *   - BTC flow
 *   - Auto-release backend
 *   - MultiChainSendSheet "Invia Cripto"
 */

import { useState, useEffect, useCallback } from "react";
import { useActiveAccount, useActiveWalletChain, useSwitchActiveWalletChain, ConnectButton } from "thirdweb/react";
import { client, wallets, polygon, bsc, ethereum } from "../../lib/thirdweb";
import {
  apiMCDetect,
  MC_TOKEN_CONTRACT,
  MC_DECIMALS,
  MC_DISPLAY_DECIMALS,
  fmtDisplay,
  type MCNetwork,
  type MCAsset,
} from "../../lib/multichain-api";

// ─── EVM chain mapping (identico a MultiChainSendSheet) ───────────────────────

const EVM_CHAIN = { polygon, bsc, ethereum } as const;

const EVM_CHAIN_ID: Partial<Record<MCNetwork, number>> = {
  polygon:  137,
  bsc:      56,
  ethereum: 1,
};

const EVM_NATIVE_SYMBOL: Partial<Record<MCNetwork, string>> = {
  polygon:  "POL",
  bsc:      "BNB",
  ethereum: "ETH",
};

const NETWORK_LABEL: Partial<Record<MCNetwork, string>> = {
  polygon:  "Polygon",
  bsc:      "BSC",
  ethereum: "Ethereum",
};

const NETWORK_ICON: Partial<Record<MCNetwork, string>> = {
  polygon:  "🔵",
  bsc:      "🟡",
  ethereum: "⬡",
};

// ─── ERC-20 calldata manuale ──────────────────────────────────────────────────
//
// Identico a MultiChainSendSheet.encodeERC20Transfer() — evita wallet_sendCalls
// (EIP-5792) che causa doppio popup firma su Trust Wallet ("nonce too low").

function encodeERC20Transfer(to: string, amount: bigint): `0x${string}` {
  const toHex  = to.toLowerCase().replace("0x", "").padStart(64, "0");
  const amtHex = amount.toString(16).padStart(64, "0");
  return `0xa9059cbb${toHex}${amtHex}` as `0x${string}`;
}

// ─── iOS/PWA recovery ─────────────────────────────────────────────────────────
//
// Stesso MC_PENDING_KEY di MultiChainSendSheet — una sola chiave per tutti i
// transfer EVM pending (il campo transferId distingue quale transfer si sta pagando).

const MC_PENDING_KEY = "ac_mc_pending";

interface MCPendingPayment {
  transferId:     string;
  conversationId: string;
  network:        string;
  timestamp:      number;
  signed:         boolean;
}

// ─── Phase ────────────────────────────────────────────────────────────────────

type Phase =
  | "idle"       // pronto per firmare (wallet connesso)
  | "checking"   // pre-check apiMCDetect in corso
  | "switching"  // chain switch esplicito in corso
  | "signing"    // sendTransaction fire-and-forget — wallet aperto
  | "confirming" // polling apiMCDetect ogni 10 s
  | "done"
  | "error";

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  transferId:       string;
  escrowWallet:     string;
  grossAmount:      string;
  minDepositAmount: string | null;
  network:          MCNetwork;
  asset:            MCAsset;
  expiresAt:        string;
  conversationId:   string;
  onClose:          () => void;
  onPaid:           () => void;
}

// ─── Componente ───────────────────────────────────────────────────────────────

export function MultiChainPayRequestSheet({
  transferId,
  escrowWallet,
  grossAmount,
  minDepositAmount,
  network,
  asset,
  expiresAt,
  conversationId,
  onClose,
  onPaid,
}: Props) {
  const account           = useActiveAccount();
  const activeWalletChain = useActiveWalletChain();
  const switchChain       = useSwitchActiveWalletChain();
  const isConnected       = !!account;

  const [phase,       setPhase]       = useState<Phase>("idle");
  const [error,       setError]       = useState<string | null>(null);
  const [alreadyDone, setAlreadyDone] = useState(false); // deposito già rilevato prima della firma

  const rawDec       = MC_DECIMALS[network] ?? 6;
  const dispDec      = MC_DISPLAY_DECIMALS[network] ?? 6;
  const evmChain     = EVM_CHAIN[network as keyof typeof EVM_CHAIN] ?? null;
  const evmChainId   = EVM_CHAIN_ID[network] ?? null;
  const networkLabel = NETWORK_LABEL[network] ?? network;
  const networkIcon  = NETWORK_ICON[network] ?? "🔗";
  const nativeSym    = EVM_NATIVE_SYMBOL[network] ?? "ETH";

  // Importo che il pagatore deve depositare nell'escrow:
  //   min_deposit_amount = grossAmount + networkFeeCharged (se presente)
  //   altrimenti: grossAmount
  const depositUnits   = minDepositAmount ?? grossAmount ?? "0";
  const depositBigInt  = (() => { try { return BigInt(depositUnits); } catch { return 0n; } })();
  const depositDisplay = fmtDisplay(depositUnits, rawDec, dispDec);

  // Recovery iOS: se c'è un pending con questo transferId già firmato → verifica backend
  // PRIMA di tornare in confirming. Se il deposito non è ancora arrivato, il
  // sendTransaction precedente non ha raggiunto Trust Wallet (stale WC session) →
  // torna a idle per permettere una nuova firma senza ricaricare l'app.
  useEffect(() => {
    const raw = localStorage.getItem(MC_PENDING_KEY);
    if (!raw) return;
    let pending: MCPendingPayment;
    try { pending = JSON.parse(raw) as MCPendingPayment; }
    catch { return; }
    if (pending.transferId !== transferId) return;
    if (Date.now() - pending.timestamp > 30 * 60 * 1000) {
      localStorage.removeItem(MC_PENDING_KEY); return;
    }
    if (!pending.signed) return;

    // Signed=true ma non sappiamo se Trust Wallet ha davvero ricevuto la TX.
    // Chiedi al backend lo stato reale prima di decidere.
    void (async () => {
      try {
        const result = await apiMCDetect(transferId);
        if (result.status !== "awaiting_deposit") {
          // Deposito già rilevato → il send era andato a buon fine
          setPhase("confirming");
          void runPolling(undefined);
        } else {
          // Deposito non arrivato → la firma non ha raggiunto il wallet.
          // Pulisci il pending e torna a idle per permettere una nuova firma.
          localStorage.removeItem(MC_PENDING_KEY);
          setPhase("idle");
        }
      } catch {
        // Errore rete: meglio permettere retry che bloccare in confirming
        localStorage.removeItem(MC_PENDING_KEY);
        setPhase("idle");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-chiudi dopo done
  useEffect(() => {
    if (phase !== "done") return;
    localStorage.removeItem(MC_PENDING_KEY);
    const timer = setTimeout(() => onPaid(), 1800);
    return () => clearTimeout(timer);
  }, [phase, onPaid]);

  // ── Polling backend (source of truth) ───────────────────────────────────────
  //
  // SPEC: HTTP 200 NON significa deposito — solo status !== "awaiting_deposit" è conferma.
  // Il backend risponde 200 in entrambi i casi: deposito assente (awaiting_deposit)
  // e deposito presente (pending/releasing/released).

  async function runPolling(signErrRef: { msg: string | null } | undefined): Promise<void> {
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

      try {
        const result = await apiMCDetect(transferId);
        // Controlla SEMPRE lo status — non basta il 200
        if (result.status === "awaiting_deposit") {
          // Deposito non ancora arrivato — ripolla
          if (signErrRef?.msg && pollCount >= SIGN_ERROR_GRACE_POLLS) {
            setPhase("error");
            setError(signErrRef.msg);
            return;
          }
          continue;
        }
        // status !== "awaiting_deposit" → deposito rilevato dal backend
        setPhase("done");
        return;
      } catch (err: unknown) {
        const code    = (err as Error & { code?: string })?.code;
        const message = (err as Error)?.message ?? "";
        const is429   = message.includes("429") || code === "RATE_LIMIT_EXCEEDED" || code === "TOO_MANY_REQUESTS";

        if (is429 || code === "DEPOSIT_TX_NOT_DETECTED" || code === "ADAPTER_NOT_FOUND") {
          // Errori transitori/rate-limit: aspetta il prossimo ciclo senza fallire.
          // Il 429 si verifica quando la bolla e lo sheet pollano /detect in contemporanea.
          if (!is429 && signErrRef?.msg && pollCount >= SIGN_ERROR_GRACE_POLLS) {
            setPhase("error");
            setError(signErrRef.msg);
            return;
          }
          if (is429) {
            // Attendi il doppio del normale interval per ridurre la pressione sul rate limit
            await new Promise<void>(r => setTimeout(r, POLL_INTERVAL_MS));
          }
          continue;
        }
        // Errore reale (rete, auth, ecc.)
        setPhase("error");
        setError(message || "Errore verifica deposito.");
        return;
      }
    }

    setPhase("error");
    setError("Timeout: deposito non rilevato in 10 minuti. Controlla la transazione nel tuo wallet.");
  }

  // ── handlePay — orchestrazione completa ─────────────────────────────────────

  const handlePay = useCallback(async () => {
    if (!account || !evmChain || !evmChainId) return;

    const tokenAddress = MC_TOKEN_CONTRACT[network] as `0x${string}` | null | undefined;
    if (!tokenAddress) {
      setPhase("error");
      setError("Rete non supportata per USDT.");
      return;
    }
    if (depositBigInt === 0n) {
      setPhase("error");
      setError("Importo deposito non valido.");
      return;
    }

    setError(null);

    // ── 1. Pre-check: deposito già presente? ──────────────────────────────────
    //
    // Evita una firma inutile se il deposito è già arrivato (stale WC relay,
    // doppio click, o retry dopo chiusura app iOS).
    setPhase("checking");
    try {
      const preCheck = await apiMCDetect(transferId);
      if (preCheck.status !== "awaiting_deposit") {
        // Deposito già rilevato — nessuna TX necessaria
        setAlreadyDone(true);
        setPhase("done");
        return;
      }
      // status === "awaiting_deposit" → escrow vuoto, procedi con la firma
    } catch {
      // Errore rete → continua con la firma (meglio inviare che bloccare)
    }

    // ── 2. Chain switch ESPLICITO (awaited, con timeout 45 s) ────────────────
    //
    // NON usare sendTransaction({ chainId }) come meccanismo implicito di switch:
    // causa "Missing or invalid chainId" su Trust Wallet iOS via WalletConnect
    // per BSC ed Ethereum. Pattern verificato funzionante in MultiChainSendSheet.
    //
    // Se il wallet è già sulla chain corretta lo switch è un no-op velocissimo.
    // Timeout 45 s: se il dialog di cambio rete non appare in Trust Wallet
    // (push notification persa, app in background) il flusso non resta bloccato.
    if (activeWalletChain?.id !== evmChainId) {
      setPhase("switching");
      try {
        const SWITCH_TIMEOUT_MS = 45_000;
        await Promise.race([
          switchChain(evmChain),
          new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new Error("__switch_timeout__")),
              SWITCH_TIMEOUT_MS,
            )
          ),
        ]);
      } catch (err: unknown) {
        const msg = (err as Error)?.message ?? "";
        if (msg === "__switch_timeout__") {
          setError(`Apri Trust Wallet e accetta il cambio rete a ${networkLabel}, poi premi di nuovo "Paga".`);
        } else if (/reject|cancel|denied|refused|user rejected/i.test(msg)) {
          setError(`Cambio rete rifiutato. Premi "Paga" e accetta il cambio a ${networkLabel} nel wallet.`);
        } else if (/not supported|not recognized|missing.*chain|unsupported/i.test(msg)) {
          setError(`${networkLabel} non è supportata da questo wallet. Apri Trust Wallet → Impostazioni → Reti → abilita ${networkLabel}, poi riconnetti.`);
        } else if (/disconnected|not connected/i.test(msg)) {
          setError("Wallet disconnesso durante il cambio rete. Riconnetti e riprova.");
        } else {
          setError(`Impossibile passare a ${networkLabel}: ${msg || "Errore sconosciuto."}`);
        }
        setPhase("idle");
        return;
      }
    }

    // ── 3. sendTransaction fire-and-forget ───────────────────────────────────
    //
    // Identico al pattern di MultiChainSendSheet che funziona su BSC:
    // NON await txHash — fonte di verità = polling backend.
    // Nessun delay post-switchChain: il delay dà tempo al wallet iOS di chiudersi
    // dopo il chain-switch → sendTransaction arriva quando il wallet non è più
    // in foreground → popup firma non appare.
    // chainId: routing WC corretto verso eip155:${evmChainId}.
    //
    // DESTINAZIONE:  PAGATORE WALLET → USDT ERC-20 → ESCROW WALLET

    setPhase("signing");

    const calldata   = encodeERC20Transfer(escrowWallet, depositBigInt);
    const signErrRef = { msg: null as string | null };

    account.sendTransaction({
      to:    tokenAddress,
      data:  calldata,
      gas:   BigInt(150_000),
      value: BigInt(0),
      chainId: evmChainId,
    }).catch((err: unknown) => {
      const msg = (err as Error)?.message ?? "";
      if (/reject|cancel|denied|refused|user rejected/i.test(msg)) {
        signErrRef.msg = `Firma rifiutata. Premi "Paga ${depositDisplay} ${asset}" per riprovare.`;
      } else if (/nonce.*too.*low|nonce.*used|nonce.*already/i.test(msg)) {
        // TX già inviata con questo nonce — il polling la rileverà on-chain
        console.warn("[MCPayReq] Nonce già usato — polling rileverà il deposito automaticamente.");
      } else if (/insufficient funds|insufficient balance/i.test(msg)) {
        signErrRef.msg = `Gas insufficiente. Aggiungi ${nativeSym} al tuo wallet per le fee di rete.`;
      } else if (/missing or invalid|eip155|unrecognized chain|does not support|wrong network/i.test(msg)) {
        signErrRef.msg = `Errore di rete: ${networkLabel} non accettata. Disconnetti, riconnetti e riprova.`;
      } else if (/timeout|timed out/i.test(msg)) {
        signErrRef.msg = "Timeout firma. Se la TX è partita verrà rilevata automaticamente.";
      } else if (/rpc|provider/i.test(msg)) {
        signErrRef.msg = `Errore RPC su ${networkLabel}. Riprova tra qualche secondo.`;
      } else {
        signErrRef.msg = `Errore firma: ${(err as Error)?.message || "Errore sconosciuto."}`;
      }
    });

    // Salva recovery iOS: signed=true subito dopo aver lanciato sendTransaction
    localStorage.setItem(MC_PENDING_KEY, JSON.stringify({
      transferId,
      conversationId,
      network,
      timestamp: Date.now(),
      signed:    true,
    } satisfies MCPendingPayment));

    setPhase("confirming");

    // ── 4. Polling backend ─────────────────────────────────────────────────────
    await runPolling(signErrRef);
  }, [
    account, evmChain, evmChainId, network, depositBigInt, depositDisplay,
    asset, escrowWallet, conversationId, activeWalletChain, switchChain,
    networkLabel, nativeSym, transferId,
  ]);

  // ─── UI ──────────────────────────────────────────────────────────────────────

  const isWorking = ["checking", "switching", "signing", "confirming"].includes(phase);
  const isDone    = phase === "done";

  function phaseLabel(): string {
    switch (phase) {
      case "checking":   return "Controllo deposito…";
      case "switching":  return `Cambio rete a ${networkLabel}…`;
      case "signing":    return "Attesa firma nel wallet…";
      case "confirming": return "Attesa conferma deposito…";
      case "done":       return alreadyDone ? "Deposito già rilevato ✓" : "Deposito rilevato ✓";
      default:           return "";
    }
  }

  /** Hint aggiuntivo mostrato sotto lo spinner durante switching e signing */
  function phaseHint(): string | null {
    if (phase === "switching") return `Apri Trust Wallet e accetta il cambio a ${networkLabel}`;
    if (phase === "signing")   return "Apri Trust Wallet e firma la transazione";
    return null;
  }

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={`Paga ${depositDisplay} ${asset}`}
      onClick={() => !isWorking && onClose()}
    >
      <div className="usda-sheet mc-sheet" onClick={e => e.stopPropagation()}>

        {/* ── Header ── */}
        <div className="usda-sheet-header">
          <span className="usda-sheet-title">💸 Paga {depositDisplay} {asset}</span>
          <button
            type="button"
            className="usda-sheet-close"
            aria-label="Chiudi"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        {/* ── Badge rete ── */}
        <div className="mc-network-badge" style={{ margin: "8px 0 16px" }}>
          <span aria-hidden="true">{networkIcon}</span>
          <span>{networkLabel} · {asset}</span>
        </div>

        {/* ── Importo principale ── */}
        <div style={{ textAlign: "center", margin: "8px 0 20px" }}>
          <span style={{ fontSize: "2.2rem", fontWeight: 700, letterSpacing: "-0.5px" }}>
            {depositDisplay}
          </span>
          {" "}
          <span style={{ fontSize: "1.1rem", opacity: 0.65, fontWeight: 600 }}>{asset}</span>
        </div>

        {/* ── Riepilogo ── */}
        <div className="mc-confirm-summary">
          <div className="mc-confirm-row">
            <span>Destinazione</span>
            <span style={{ fontFamily: "monospace", fontSize: "0.8em", wordBreak: "break-all" }}>
              {escrowWallet.slice(0, 10)}…{escrowWallet.slice(-8)}
            </span>
          </div>
          <div className="mc-confirm-row">
            <span>Rete</span>
            <span>{networkLabel}</span>
          </div>
          <div className="mc-confirm-row">
            <span>Scade il</span>
            <span>
              {new Date(expiresAt).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })}
            </span>
          </div>
        </div>

        {/* ── Nota sicurezza ── */}
        <p className="mc-confirm-note" style={{ marginTop: 12, marginBottom: 8 }}>
          Il tuo pagamento viene depositato in un indirizzo escrow temporaneo e
          inoltrato automaticamente al richiedente dopo la verifica on-chain.
        </p>

        {/* ── Stato: working ── */}
        {isWorking && (
          <div aria-live="polite" style={{ padding: "14px 0" }}>
            <div className="cp-bubble-status" style={{ justifyContent: "center", gap: 10 }}>
              <span className="cp-spinner" aria-hidden="true" />
              <span style={{ fontWeight: 500 }}>{phaseLabel()}</span>
            </div>
            {phaseHint() && (
              <p style={{
                textAlign: "center",
                fontSize: "0.8rem",
                opacity: 0.6,
                margin: "6px 0 0",
              }}>
                {phaseHint()}
              </p>
            )}
          </div>
        )}

        {/* ── Stato: done ── */}
        {isDone && (
          <div
            className="cp-bubble-status"
            aria-live="polite"
            style={{ justifyContent: "center", color: "#22c55e", fontWeight: 600, padding: "14px 0", gap: 8 }}
          >
            <span aria-hidden="true">✅</span>
            <span>{phaseLabel()}</span>
          </div>
        )}

        {/* ── Errore ── */}
        {phase === "error" && error && (
          <div className="usda-error" role="alert" style={{ margin: "10px 0" }}>
            {error}
          </div>
        )}

        {/* ── Azioni ── */}
        {!isDone && (
          <div className="usda-sheet-actions" style={{ marginTop: 16 }}>
            {/* In fase "confirming" mostra solo "Chiudi" a piena larghezza —
                lo spinner sopra già comunica lo stato. Evita il doppio pulsante troncato. */}
            {phase === "confirming" ? (
              <button
                type="button"
                className="usda-btn-secondary"
                onClick={onClose}
                style={{ width: "100%" }}
              >
                Chiudi (continua in background)
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="usda-btn-secondary"
                  onClick={onClose}
                  disabled={phase === "signing"}
                  aria-label="Annulla"
                >
                  Annulla
                </button>

                {!isConnected ? (
                  /* Wallet non connesso — mostra ConnectButton (UX spec) */
                  <ConnectButton
                    client={client}
                    wallets={wallets}
                    connectButton={{ label: "🔗 Collega wallet per pagare" }}
                    connectModal={{ size: "compact" }}
                  />
                ) : (
                  /* Wallet connesso — pulsante firma principale */
                  <button
                    type="button"
                    className="usda-btn-primary"
                    onClick={handlePay}
                    disabled={isWorking}
                    aria-busy={isWorking}
                  >
                    {isWorking ? (
                      <><span className="usda-btn-spinner" aria-hidden="true" />{" "}{phaseLabel()}</>
                    ) : (
                      `💸 Paga ${depositDisplay} ${asset}`
                    )}
                  </button>
                )}
              </>
            )}
          </div>
        )}

        {/* ── Done: solo chiudi ── */}
        {isDone && (
          <div className="usda-sheet-actions" style={{ marginTop: 16 }}>
            <button
              type="button"
              className="usda-btn-primary"
              onClick={onClose}
              style={{ width: "100%" }}
            >
              Chiudi
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
