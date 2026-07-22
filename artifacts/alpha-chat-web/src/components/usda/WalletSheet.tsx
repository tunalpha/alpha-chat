/**
 * WalletSheet — bottom sheet nativo iOS per connettere wallet.
 *
 * Sostituisce @reown/appkit che dipende dal cloud registry WalletConnect
 * (blocca su .replit.dev con 403). Questo componente:
 *   • Mostra wallet options con icone
 *   • Usa wagmi `walletConnect` connector + deep link iOS (no cloud)
 *   • Usa `injected` per MetaMask desktop
 *   • Si chiude automaticamente quando l'utente approva in wallet
 *
 * Attivato da walletModal.open() → evento DOM 'alpha:open-wallet-sheet'
 */

import { useEffect, useState, useCallback, useRef } from "react";
import { useConnect, useAccount, useConnectors } from "wagmi";

// ── Deep link URL per wallet mobile ──────────────────────────────────────────
//
// Usiamo universal links (https) dove possibile — più affidabili su iOS Safari.
// La variabile {uri} viene sostituita con l'URI WalletConnect encodato.

const MOBILE_WALLETS = [
  {
    id:        "metamask",
    label:     "MetaMask",
    icon:      "🦊",
    deepLink:  (uri: string) => `https://metamask.app.link/wc?uri=${uri}`,
    color:     "#F6851B",
  },
  {
    id:        "trust",
    label:     "Trust Wallet",
    icon:      "🛡️",
    deepLink:  (uri: string) => `https://link.trustwallet.com/wc?uri=${uri}`,
    color:     "#3375BB",
  },
  {
    id:        "coinbase",
    label:     "Coinbase Wallet",
    icon:      "🔵",
    deepLink:  (uri: string) => `https://go.cb-w.com/wc?uri=${uri}`,
    color:     "#0052FF",
  },
  {
    id:        "rainbow",
    label:     "Rainbow",
    icon:      "🌈",
    deepLink:  (uri: string) => `https://rnbwapp.com/wc?uri=${uri}`,
    color:     "#174299",
  },
  {
    id:        "imtoken",
    label:     "imToken",
    icon:      "💙",
    deepLink:  (uri: string) => `imtokenv2://wc?uri=${uri}`,
    color:     "#11C4D1",
  },
] as const

type WalletId = (typeof MOBILE_WALLETS)[number]["id"]

type SheetState =
  | { phase: "idle" }
  | { phase: "connecting"; walletId: WalletId }
  | { phase: "waiting_app"; walletId: WalletId }
  | { phase: "error"; message: string }

// ── Componente ────────────────────────────────────────────────────────────────

export default function WalletSheet() {
  const [open,       setOpen]       = useState(false)
  const [state,      setState]      = useState<SheetState>({ phase: "idle" })
  const unsubRef     = useRef<(() => void) | null>(null)

  const { isConnected }  = useAccount()
  const { connect }      = useConnect()
  const connectors       = useConnectors()

  // Apri lo sheet via evento DOM (da walletModal.open())
  useEffect(() => {
    const handler = () => { setOpen(true); setState({ phase: "idle" }) }
    window.addEventListener("alpha:open-wallet-sheet", handler)
    return () => window.removeEventListener("alpha:open-wallet-sheet", handler)
  }, [])

  // Chiudi automaticamente quando il wallet viene connesso
  useEffect(() => {
    if (isConnected && open) {
      setOpen(false)
      setState({ phase: "idle" })
      unsubRef.current?.()
      unsubRef.current = null
    }
  }, [isConnected, open])

  const close = useCallback(() => {
    setOpen(false)
    setState({ phase: "idle" })
    unsubRef.current?.()
    unsubRef.current = null
  }, [])

  // ── Connessione con deep link mobile ───────────────────────────────────────
  const connectMobile = useCallback((wallet: typeof MOBILE_WALLETS[number]) => {
    const wcConnector = connectors.find(c => c.type === "walletConnect")
    if (!wcConnector) {
      setState({ phase: "error", message: "WalletConnect non disponibile. Ricarica l'app." })
      return
    }

    setState({ phase: "connecting", walletId: wallet.id })

    // Pulisce eventuali listener precedenti
    unsubRef.current?.()
    unsubRef.current = null

    const onMessage = (data: { type: string; data?: unknown }) => {
      if (data.type !== "display_uri") return

      // Rimuovi questo listener
      unsubRef.current?.()
      unsubRef.current = null

      const uri     = data.data as string
      const encoded = encodeURIComponent(uri)
      const deepLink = wallet.deepLink(encoded)

      setState({ phase: "waiting_app", walletId: wallet.id })

      // Piccolo delay per dare tempo al DOM di aggiornarsi
      setTimeout(() => {
        window.location.href = deepLink
      }, 80)
    }

    // Ascolta l'URI dal connector prima di chiamare connect
    // In wagmi v3 il connector estende Emitter
    const handler = (evt: { type: string; data?: unknown }) => onMessage(evt)
    wcConnector.emitter.on("message", handler)
    unsubRef.current = () => wcConnector.emitter.off("message", handler)

    connect(
      { connector: wcConnector },
      {
        onError: (err) => {
          unsubRef.current?.()
          unsubRef.current = null
          // Ignora errori "already connected" o "user rejected"
          const msg = err.message ?? ""
          if (msg.includes("already") || msg.includes("rejected")) {
            setState({ phase: "idle" })
          } else {
            setState({ phase: "error", message: "Connessione fallita. Riprova." })
          }
        },
      }
    )
  }, [connectors, connect])

  // ── Connessione iniettata (MetaMask browser extension) ─────────────────────
  const connectInjected = useCallback(() => {
    const inj = connectors.find(c => c.type === "injected")
    if (!inj) {
      // Nessun wallet browser — mostra il deep link MetaMask mobile
      const mm = MOBILE_WALLETS.find(w => w.id === "metamask")!
      connectMobile(mm)
      return
    }
    connect(
      { connector: inj },
      {
        onError: (err) => {
          const msg = err.message ?? ""
          if (!msg.includes("rejected")) {
            setState({ phase: "error", message: "Connessione rifiutata dal wallet." })
          } else {
            setState({ phase: "idle" })
          }
        },
      }
    )
  }, [connectors, connect, connectMobile])

  if (!open) return null

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div
      style={{
        position:        "fixed",
        inset:           0,
        zIndex:          9999,
        display:         "flex",
        flexDirection:   "column",
        justifyContent:  "flex-end",
        background:      "rgba(0,0,0,0.55)",
        backdropFilter:  "blur(4px)",
        WebkitBackdropFilter: "blur(4px)",
        touchAction:     "none",
      }}
      onClick={(e) => { if (e.target === e.currentTarget) close() }}
    >
      <div
        style={{
          background:    "var(--bg-secondary, #1c1c2e)",
          borderRadius:  "24px 24px 0 0",
          padding:       "20px 16px 36px",
          boxShadow:     "0 -8px 40px rgba(0,0,0,0.5)",
          maxHeight:     "82vh",
          overflowY:     "auto",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Handle */}
        <div style={{ width: 40, height: 4, background: "#555", borderRadius: 2, margin: "0 auto 20px" }} />

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
          <span style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--text-primary, #fff)" }}>
            Connetti Wallet
          </span>
          <button
            onClick={close}
            style={{
              background: "none", border: "none", color: "#999",
              fontSize: "1.4rem", cursor: "pointer", padding: "4px 8px",
              touchAction: "manipulation",
            }}
            aria-label="Chiudi"
          >
            ✕
          </button>
        </div>

        {/* Stato */}
        {state.phase === "connecting" && (
          <div style={{ textAlign: "center", padding: "12px 0", color: "#aaa", fontSize: "0.9rem" }}>
            ⏳ Avvio connessione…
          </div>
        )}
        {state.phase === "waiting_app" && (
          <div style={{
            background: "#1e293b", borderRadius: 12, padding: "14px 16px",
            marginBottom: 16, textAlign: "center",
          }}>
            <div style={{ fontSize: "1.5rem", marginBottom: 6 }}>
              {MOBILE_WALLETS.find(w => w.id === state.walletId)?.icon}
            </div>
            <div style={{ color: "#94a3b8", fontSize: "0.88rem" }}>
              Apertura {MOBILE_WALLETS.find(w => w.id === state.walletId)?.label}…
              <br />
              <span style={{ color: "#64748b", fontSize: "0.8rem" }}>
                Approva la connessione nell'app, poi torna qui
              </span>
            </div>
          </div>
        )}
        {state.phase === "error" && (
          <div style={{
            background: "#2d1b1b", borderRadius: 12, padding: "12px 14px",
            marginBottom: 16, color: "#f87171", fontSize: "0.88rem",
          }}>
            ⚠️ {state.message}
          </div>
        )}

        {/* Wallet list */}
        {(state.phase === "idle" || state.phase === "error") && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>

            {/* MetaMask — injected se disponibile, altrimenti deep link */}
            <WalletButton
              icon="🦊"
              label="MetaMask"
              sublabel="Browser extension o app mobile"
              color="#F6851B"
              onClick={connectInjected}
            />

            {/* Mobile wallets */}
            {MOBILE_WALLETS.filter(w => w.id !== "metamask").map((wallet) => (
              <WalletButton
                key={wallet.id}
                icon={wallet.icon}
                label={wallet.label}
                sublabel="Apre l'app wallet sul tuo telefono"
                color={wallet.color}
                onClick={() => connectMobile(wallet)}
              />
            ))}

          </div>
        )}

        {/* Nota informativa */}
        <div style={{
          marginTop: 20, textAlign: "center",
          color: "var(--text-tertiary, #666)", fontSize: "0.76rem", lineHeight: 1.5,
        }}>
          🔒 La connessione avviene via WalletConnect — nessuna chiave privata condivisa
        </div>
      </div>
    </div>
  )
}

// ── WalletButton ──────────────────────────────────────────────────────────────

interface WalletButtonProps {
  icon:     string
  label:    string
  sublabel: string
  color:    string
  onClick:  () => void
}

function WalletButton({ icon, label, sublabel, color, onClick }: WalletButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display:         "flex",
        alignItems:      "center",
        gap:             14,
        background:      "var(--bg-tertiary, #16213e)",
        border:          "1px solid rgba(255,255,255,0.07)",
        borderRadius:    14,
        padding:         "13px 16px",
        cursor:          "pointer",
        textAlign:       "left",
        width:           "100%",
        touchAction:     "manipulation",
        WebkitTapHighlightColor: "transparent",
        transition:      "background 0.15s",
      }}
    >
      {/* Icona */}
      <span style={{
        width: 40, height: 40, borderRadius: 12, display: "flex",
        alignItems: "center", justifyContent: "center", fontSize: "1.4rem",
        background: `${color}18`, flexShrink: 0,
      }}>
        {icon}
      </span>

      {/* Testo */}
      <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <span style={{ color: "var(--text-primary, #fff)", fontSize: "0.95rem", fontWeight: 600 }}>
          {label}
        </span>
        <span style={{ color: "var(--text-tertiary, #888)", fontSize: "0.78rem" }}>
          {sublabel}
        </span>
      </span>

      {/* Freccia */}
      <span style={{ marginLeft: "auto", color: "#555", fontSize: "0.9rem" }}>›</span>
    </button>
  )
}
