/**
 * TrustWalletConnector — flow di connessione personalizzato per Trust Wallet su iOS.
 *
 * Problema root-cause:
 *   ThirdWeb's WalletConnectConnection.js chiama openWindow() dentro onDisplayUri(),
 *   che è un callback asincrono. iOS Safari blocca window.location.href verso custom
 *   scheme (trust://) in contesti async.
 *   In più, formatNativeUrl("trust://", uri) produce "trust:///wc?uri=..." (3 slash)
 *   mentre Trust Wallet si aspetta "trust://wc?uri=..." (2 slash).
 *
 * Soluzione:
 *   1. Avviamo wallet.connect() in background — otteniamo l'URI WC via onDisplayUri.
 *   2. Mostriamo un pulsante all'utente.
 *   3. Al tap (gesto utente diretto) apriamo Trust Wallet con l'URI corretto.
 *      window.location.href in un click handler diretto NON viene bloccato da iOS.
 *      La pagina resta in background, la Promise wallet.connect() rimane pending.
 *   4. L'utente approva in Trust Wallet → WC relay notifica la Promise pending → ok.
 */
import { useState, useCallback, useRef } from "react";
import { useConnect } from "thirdweb/react";
import { createWallet } from "thirdweb/wallets";
import { thirdwebClient, polygonMainnet, WC_PROJECT_ID } from "../../lib/thirdweb-client";

type Status = "idle" | "pending" | "ready" | "error";

interface Props {
  onConnected?: () => void;
}

export default function TrustWalletConnector({ onConnected }: Props) {
  const [status,  setStatus]  = useState<Status>("idle");
  const [wcUri,   setWcUri]   = useState<string | null>(null);
  const { connect } = useConnect();
  const walletRef = useRef(createWallet("com.trustwallet.app"));

  const startConnect = useCallback(() => {
    if (status === "pending") return;
    setStatus("pending");
    setWcUri(null);

    // Nuova istanza per ogni tentativo (evita sessioni WC stantie)
    walletRef.current = createWallet("com.trustwallet.app");
    const wallet = walletRef.current;

    connect(async () => {
      await wallet.connect({
        client: thirdwebClient,
        chain:  polygonMainnet,
        walletConnect: {
          // Non passare mai stringa vuota — causa fallimento immediato (linea guida USDA)
          ...(WC_PROJECT_ID ? { projectId: WC_PROJECT_ID } : {}),
          showQrModal:  false,
          onDisplayUri(uri) {
            // L'URI è pronto — aggiorniamo lo stato per mostrare il bottone
            // Il deep link verrà sparato SOLO al tap diretto dell'utente
            setWcUri(uri);
            setStatus("ready");
          },
        },
      });
      // wallet.connect() risolve quando Trust Wallet approva la sessione
      setStatus("idle");
      onConnected?.();
      return wallet;
    }).catch(() => setStatus("error"));
  }, [status, connect, onConnected]);

  /** Apre Trust Wallet con il formato URL corretto (2 slash, non 3) */
  const openTrustWallet = useCallback(() => {
    if (!wcUri) return;
    // CORRETTO:  trust://wc?uri=<encoded>
    // SBAGLIATO: trust:///wc?uri=<encoded>  ← quello che genera ThirdWeb
    window.location.href = `trust://wc?uri=${encodeURIComponent(wcUri)}`;
  }, [wcUri]);

  /* ── Idle / Error ───────────────────────────────────────────────────────── */
  if (status === "idle" || status === "error") {
    return (
      <button
        type="button"
        onClick={startConnect}
        style={{
          display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
          background: "rgba(255,255,255,0.06)",
          border: "1px solid rgba(255,255,255,0.15)",
          borderRadius: 12, color: "#fff",
          fontSize: "0.88rem", fontWeight: 600,
          padding: "12px 18px", width: "100%", cursor: "pointer",
          touchAction: "manipulation", WebkitTapHighlightColor: "transparent",
        }}
      >
        <img
          src="https://trustwallet.com/assets/images/media/assets/TWT.png"
          width={20} height={20}
          style={{ borderRadius: 4, objectFit: "cover", flexShrink: 0 }}
          alt=""
          onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
        />
        <span>Connetti Trust Wallet</span>
        {status === "error" && (
          <span style={{ color: "#f87171", fontSize: "0.72rem", marginLeft: 2 }}>(riprova)</span>
        )}
      </button>
    );
  }

  /* ── Pending — URI non ancora pronto ───────────────────────────────────── */
  if (status === "pending") {
    return (
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.1)",
        borderRadius: 12, color: "rgba(255,255,255,0.45)",
        fontSize: "0.82rem", padding: "12px 18px",
      }}>
        <span style={{ fontSize: "1rem" }}>⏳</span>
        <span>Preparando connessione…</span>
      </div>
    );
  }

  /* ── Ready — URI pronto, aspettiamo il gesto utente ────────────────────── */
  if (status === "ready" && wcUri) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <button
          type="button"
          onClick={openTrustWallet}
          style={{
            display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
            background: "linear-gradient(135deg,#1565c0,#0d47a1)",
            border: "none", borderRadius: 12, color: "#fff",
            fontSize: "0.95rem", fontWeight: 700,
            padding: "14px 20px", width: "100%", cursor: "pointer",
            touchAction: "manipulation", WebkitTapHighlightColor: "transparent",
            boxShadow: "0 4px 18px rgba(21,101,192,0.45)",
          }}
        >
          <img
            src="https://trustwallet.com/assets/images/media/assets/TWT.png"
            width={22} height={22}
            style={{ borderRadius: 4, objectFit: "cover", flexShrink: 0 }}
            alt=""
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
          />
          <span>Apri Trust Wallet per approvare →</span>
        </button>
        <p style={{
          margin: 0, fontSize: "0.7rem",
          color: "rgba(255,255,255,0.35)", textAlign: "center",
        }}>
          Tocca, approva in Trust Wallet, poi torna qui.
        </p>
      </div>
    );
  }

  return null;
}
