/**
 * WalletSheet — bottom sheet nativo iOS per connettere wallet.
 *
 * Usa wagmi walletConnect connector + deep link iOS nativi.
 * Nessuna dipendenza da cloud registry (bypassa il 403 su .replit.dev).
 *
 * Attivato da walletModal.open() → evento DOM 'alpha:open-wallet-sheet'
 */

import { useEffect, useState, useCallback, useRef } from "react";
import { useConnect, useAccount, useConnectors } from "wagmi";
import { WC_PROJECT_ID } from "../../lib/wallet-client";

// ── Deep link per wallet mobile ───────────────────────────────────────────────

const MOBILE_WALLETS = [
  {
    id:       "metamask"  as const,
    label:    "MetaMask",
    icon:     "🦊",
    deepLink: (uri: string) => `https://metamask.app.link/wc?uri=${uri}`,
    color:    "#F6851B",
  },
  {
    id:       "trust"     as const,
    label:    "Trust Wallet",
    icon:     "🛡️",
    deepLink: (uri: string) => `https://link.trustwallet.com/wc?uri=${uri}`,
    color:    "#3375BB",
  },
  {
    id:       "coinbase"  as const,
    label:    "Coinbase Wallet",
    icon:     "🔵",
    deepLink: (uri: string) => `https://go.cb-w.com/wc?uri=${uri}`,
    color:    "#0052FF",
  },
  {
    id:       "rainbow"   as const,
    label:    "Rainbow",
    icon:     "🌈",
    deepLink: (uri: string) => `https://rnbwapp.com/wc?uri=${uri}`,
    color:    "#174299",
  },
  {
    id:       "imtoken"   as const,
    label:    "imToken",
    icon:     "💙",
    deepLink: (uri: string) => `imtokenv2://wc?uri=${uri}`,
    color:    "#11C4D1",
  },
]

type WalletId = (typeof MOBILE_WALLETS)[number]["id"]

type SheetState =
  | { phase: "idle" }
  | { phase: "connecting"; walletId: WalletId }
  | { phase: "waiting_app"; walletId: WalletId }
  | { phase: "error"; message: string }

// ── Componente ────────────────────────────────────────────────────────────────

export default function WalletSheet() {
  const [open,  setOpen]  = useState(false)
  const [state, setState] = useState<SheetState>({ phase: "idle" })

  const { isConnected }     = useAccount()
  const { connectAsync }    = useConnect()
  const connectors          = useConnectors()
  const unsubRef            = useRef<(() => void) | null>(null)

  // Apri lo sheet via evento DOM (da walletModal.open())
  useEffect(() => {
    const handler = () => {
      setState({ phase: "idle" })
      setOpen(true)
    }
    window.addEventListener("alpha:open-wallet-sheet", handler)
    return () => window.removeEventListener("alpha:open-wallet-sheet", handler)
  }, [])

  // Chiudi automaticamente quando il wallet è connesso
  useEffect(() => {
    if (isConnected && open) {
      setOpen(false)
      setState({ phase: "idle" })
    }
  }, [isConnected, open])

  const close = useCallback(() => {
    unsubRef.current?.()
    unsubRef.current = null
    setOpen(false)
    setState({ phase: "idle" })
  }, [])

  // ── Connessione wallet mobile via deep link ────────────────────────────────
  const connectMobile = useCallback(async (wallet: typeof MOBILE_WALLETS[number]) => {
    // Controllo upfront
    if (!WC_PROJECT_ID) {
      setState({ phase: "error", message: "WalletConnect Project ID non configurato. Contatta il supporto." })
      return
    }

    const wcConnector = connectors.find(c => c.type === "walletConnect")
    if (!wcConnector) {
      setState({ phase: "error", message: "Connettore WalletConnect non trovato. Ricarica l'app." })
      return
    }

    setState({ phase: "connecting", walletId: wallet.id })

    // Pulisce listener precedenti
    unsubRef.current?.()
    unsubRef.current = null

    // Sottoscrivi display_uri PRIMA di chiamare connectAsync
    let uriReceived = false
    const onMessage = (data: { type: string; data?: unknown }) => {
      if (data.type !== "display_uri") return
      if (uriReceived) return
      uriReceived = true

      // Rimuovi il listener
      unsubRef.current?.()
      unsubRef.current = null

      const uri      = data.data as string
      const encoded  = encodeURIComponent(uri)
      const deepLink = wallet.deepLink(encoded)

      console.info("[WalletSheet] URI ricevuto per", wallet.label, "→ deeplink", deepLink.slice(0, 60))
      setState({ phase: "waiting_app", walletId: wallet.id })

      setTimeout(() => {
        window.location.href = deepLink
      }, 80)
    }

    // Abbonamento all'emitter del connettore
    if (wcConnector.emitter && typeof wcConnector.emitter.on === "function") {
      const unsubFn = wcConnector.emitter.on("message", onMessage as Parameters<typeof wcConnector.emitter.on>[1])
      // on() potrebbe restituire una funzione unsubscribe OPPURE void
      if (typeof unsubFn === "function") {
        unsubRef.current = unsubFn as () => void
      } else if (typeof wcConnector.emitter.off === "function") {
        unsubRef.current = () => wcConnector.emitter.off("message", onMessage as Parameters<typeof wcConnector.emitter.off>[1])
      }
    } else {
      // Fallback: ascolta tramite il provider WC direttamente
      console.warn("[WalletSheet] emitter non disponibile sul connettore, provo provider")
      try {
        const provider = await wcConnector.getProvider?.() as { on?: (e: string, cb: (uri: string) => void) => void } | undefined
        if (provider?.on) {
          const cb = (uri: string) => {
            onMessage({ type: "display_uri", data: uri })
          }
          provider.on("display_uri", cb)
          unsubRef.current = null
        }
      } catch {
        // ignora
      }
    }

    // Avvia la connessione
    try {
      await connectAsync({ connector: wcConnector })
      // Se arriviamo qui senza redirect (es. già connessi), chiudi
      setState({ phase: "idle" })
    } catch (err) {
      unsubRef.current?.()
      unsubRef.current = null

      const msg = (err as Error)?.message ?? String(err)
      console.error("[WalletSheet] connectAsync errore:", msg, err)

      if (
        msg.includes("already") ||
        msg.includes("rejected") ||
        msg.includes("User denied") ||
        msg.includes("cancelled") ||
        // WC lancia questo quando il tab torna dall'app e la sessione è già stabilita
        msg.includes("session")
      ) {
        setState({ phase: "idle" })
      } else {
        setState({ phase: "error", message: msg.length > 150 ? msg.slice(0, 147) + "…" : msg })
      }
    }
  }, [connectors, connectAsync])

  // ── Connessione iniettata (MetaMask browser extension / desktop) ───────────
  const connectInjected = useCallback(async () => {
    const inj = connectors.find(c => c.type === "injected")
    if (!inj) {
      // Su mobile non c'è MetaMask iniettato — usa deep link
      const mm = MOBILE_WALLETS.find(w => w.id === "metamask")!
      void connectMobile(mm)
      return
    }

    setState({ phase: "connecting", walletId: "metamask" })
    try {
      await connectAsync({ connector: inj })
      setState({ phase: "idle" })
    } catch (err) {
      const msg = (err as Error)?.message ?? String(err)
      console.error("[WalletSheet] injected error:", msg)
      if (!msg.includes("rejected") && !msg.includes("denied")) {
        setState({ phase: "error", message: msg.length > 150 ? msg.slice(0, 147) + "…" : msg })
      } else {
        setState({ phase: "idle" })
      }
    }
  }, [connectors, connectAsync, connectMobile])

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
          background:   "var(--bg-secondary, #1c1c2e)",
          borderRadius: "24px 24px 0 0",
          padding:      "20px 16px 40px",
          boxShadow:    "0 -8px 40px rgba(0,0,0,0.5)",
          maxHeight:    "82vh",
          overflowY:    "auto",
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

        {/* Banner stato */}
        {state.phase === "connecting" && (
          <div style={{
            background: "#1e2a3a", borderRadius: 12, padding: "12px 14px",
            marginBottom: 14, color: "#94a3b8", fontSize: "0.88rem", textAlign: "center",
          }}>
            ⏳ Connessione in corso…
          </div>
        )}

        {state.phase === "waiting_app" && (
          <div style={{
            background: "#1e293b", borderRadius: 12, padding: "14px 16px",
            marginBottom: 14, textAlign: "center",
          }}>
            <div style={{ fontSize: "1.5rem", marginBottom: 6 }}>
              {MOBILE_WALLETS.find(w => w.id === state.walletId)?.icon}
            </div>
            <div style={{ color: "#94a3b8", fontSize: "0.88rem" }}>
              Apertura <strong>{MOBILE_WALLETS.find(w => w.id === state.walletId)?.label}</strong>…
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
            marginBottom: 14, color: "#f87171", fontSize: "0.83rem",
            wordBreak: "break-word",
          }}>
            ⚠️ {state.message}
            <button
              onClick={() => setState({ phase: "idle" })}
              style={{
                display: "block", marginTop: 8, color: "#f87171",
                background: "none", border: "none", cursor: "pointer",
                fontSize: "0.82rem", textDecoration: "underline", padding: 0,
              }}
            >
              Riprova
            </button>
          </div>
        )}

        {/* Wallet list — mostrata in tutti gli stati tranne connecting */}
        {state.phase !== "connecting" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {/* MetaMask — injected se disponibile, altrimenti deep link */}
            <WalletButton
              icon="🦊"
              label="MetaMask"
              sublabel="Browser extension o app mobile"
              color="#F6851B"
              disabled={state.phase === "waiting_app"}
              onClick={connectInjected}
            />

            {MOBILE_WALLETS.filter(w => w.id !== "metamask").map((wallet) => (
              <WalletButton
                key={wallet.id}
                icon={wallet.icon}
                label={wallet.label}
                sublabel="Apre l'app wallet sul tuo telefono"
                color={wallet.color}
                disabled={state.phase === "waiting_app"}
                onClick={() => void connectMobile(wallet)}
              />
            ))}
          </div>
        )}

        {/* Nota */}
        <div style={{
          marginTop: 18, textAlign: "center",
          color: "var(--text-tertiary, #666)", fontSize: "0.76rem", lineHeight: 1.5,
        }}>
          🔒 Connessione via WalletConnect — nessuna chiave privata condivisa
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
  disabled: boolean
  onClick:  () => void
}

function WalletButton({ icon, label, sublabel, color, disabled, onClick }: WalletButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        display:         "flex",
        alignItems:      "center",
        gap:             14,
        background:      "var(--bg-tertiary, #16213e)",
        border:          "1px solid rgba(255,255,255,0.07)",
        borderRadius:    14,
        padding:         "13px 16px",
        cursor:          disabled ? "not-allowed" : "pointer",
        opacity:         disabled ? 0.5 : 1,
        textAlign:       "left",
        width:           "100%",
        touchAction:     "manipulation",
        WebkitTapHighlightColor: "transparent",
      }}
    >
      <span style={{
        width: 40, height: 40, borderRadius: 12, display: "flex",
        alignItems: "center", justifyContent: "center", fontSize: "1.4rem",
        background: `${color}18`, flexShrink: 0,
      }}>
        {icon}
      </span>

      <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <span style={{ color: "var(--text-primary, #fff)", fontSize: "0.95rem", fontWeight: 600 }}>
          {label}
        </span>
        <span style={{ color: "var(--text-tertiary, #888)", fontSize: "0.78rem" }}>
          {sublabel}
        </span>
      </span>

      <span style={{ marginLeft: "auto", color: "#555", fontSize: "0.9rem" }}>›</span>
    </button>
  )
}
