/**
 * WalletSheet — bottom sheet nativo iOS per connettere wallet.
 *
 * Stack: wagmi v3 walletConnect connector + subscription diretta al provider WC.
 * Gestisce errori di rete (relay WalletConnect su 4G) con retry automatico.
 */

import { useEffect, useState, useCallback, useRef } from "react";
import { useAccount, useConnectors, useConnect } from "wagmi";
import { WC_PROJECT_ID } from "../../lib/wallet-client";

// ── Wallet list ───────────────────────────────────────────────────────────────

const WALLETS = [
  { id: "metamask" as const, label: "MetaMask",        icon: "🦊", color: "#F6851B", deepLink: (u: string) => `https://metamask.app.link/wc?uri=${u}` },
  { id: "trust"    as const, label: "Trust Wallet",    icon: "🛡️", color: "#3375BB", deepLink: (u: string) => `https://link.trustwallet.com/wc?uri=${u}` },
  { id: "coinbase" as const, label: "Coinbase Wallet", icon: "🔵", color: "#0052FF", deepLink: (u: string) => `https://go.cb-w.com/wc?uri=${u}` },
  { id: "rainbow"  as const, label: "Rainbow",         icon: "🌈", color: "#174299", deepLink: (u: string) => `https://rnbwapp.com/wc?uri=${u}` },
  { id: "imtoken"  as const, label: "imToken",         icon: "💙", color: "#11C4D1", deepLink: (u: string) => `imtokenv2://wc?uri=${u}` },
]

type WalletId = (typeof WALLETS)[number]["id"]

type Phase =
  | { kind: "idle" }
  | { kind: "connecting"; walletId: WalletId }
  | { kind: "redirect";   walletId: WalletId }
  | { kind: "error";      message: string }

// ── Timeout costante ──────────────────────────────────────────────────────────

const CONNECT_TIMEOUT_MS = 25_000   // 25 s — relay WC su mobile può essere lento

// ── Componente ────────────────────────────────────────────────────────────────

export default function WalletSheet() {
  const [open,  setOpen]  = useState(false)
  const [phase, setPhase] = useState<Phase>({ kind: "idle" })
  const abortRef = useRef<(() => void) | null>(null)

  const { isConnected }  = useAccount()
  const connectors       = useConnectors()
  const { connectAsync } = useConnect()

  // Apri da walletModal.open()
  useEffect(() => {
    const h = () => { setPhase({ kind: "idle" }); setOpen(true) }
    window.addEventListener("alpha:open-wallet-sheet", h)
    return () => window.removeEventListener("alpha:open-wallet-sheet", h)
  }, [])

  // Chiudi quando il wallet risulta connesso
  useEffect(() => {
    if (isConnected && open) {
      abortRef.current?.()
      setOpen(false)
      setPhase({ kind: "idle" })
    }
  }, [isConnected, open])

  const close = useCallback(() => {
    abortRef.current?.()
    abortRef.current = null
    setOpen(false)
    setPhase({ kind: "idle" })
  }, [])

  // ── handleConnect ──────────────────────────────────────────────────────────
  const handleConnect = useCallback(async (wallet: typeof WALLETS[number]) => {
    if (!WC_PROJECT_ID) {
      setPhase({ kind: "error", message: "WalletConnect Project ID non configurato." })
      return
    }

    const wcConnector = connectors.find(c => c.type === "walletConnect")
    if (!wcConnector) {
      setPhase({ kind: "error", message: "Connettore WalletConnect non trovato. Ricarica l'app." })
      return
    }

    setPhase({ kind: "connecting", walletId: wallet.id })

    // Cancella operazione precedente se esiste
    abortRef.current?.()
    let cancelled = false
    abortRef.current = () => { cancelled = true }

    const handleUri = (uri: unknown) => {
      if (cancelled) return
      const uriStr  = String(uri)
      const encoded = encodeURIComponent(uriStr)
      console.info("[WalletSheet] display_uri →", uriStr.slice(0, 60))
      setPhase({ kind: "redirect", walletId: wallet.id })
      setTimeout(() => {
        if (!cancelled) window.location.href = wallet.deepLink(encoded)
      }, 60)
    }

    // ── Subscription: PRIMA prova il provider WC direttamente ─────────────
    //    (più affidabile del doppio-wrap wagmi emitter)
    type AnyProvider = { on: (e: string, cb: (...a: unknown[]) => void) => void; off: (e: string, cb: (...a: unknown[]) => void) => void }
    let wcProvider: AnyProvider | null = null

    try {
      wcProvider = await (wcConnector as { getProvider?: () => Promise<AnyProvider> }).getProvider?.() ?? null
      if (wcProvider?.on) {
        wcProvider.on("display_uri", handleUri)
        console.info("[WalletSheet] provider subscription OK")
      }
    } catch (e) {
      console.warn("[WalletSheet] getProvider fallito:", e)
    }

    // ── Fallback: emitter wagmi ────────────────────────────────────────────
    type MsgEvt = { type: string; data?: unknown }
    const emitterHandler = (data: MsgEvt) => {
      if (data.type === "display_uri") handleUri(data.data)
    }
    let emitterUnsub: (() => void) | null = null
    try {
      if (wcConnector.emitter?.on) {
        const ret = (wcConnector.emitter.on as (e: string, h: (d: MsgEvt) => void) => unknown)("message", emitterHandler)
        if (typeof ret === "function") {
          emitterUnsub = ret as () => void
        } else if (wcConnector.emitter?.off) {
          emitterUnsub = () => (wcConnector.emitter.off as (e: string, h: (d: MsgEvt) => void) => void)("message", emitterHandler)
        }
      }
    } catch { /* ignora */ }

    const cleanup = () => {
      try { wcProvider?.off?.("display_uri", handleUri) } catch { /* */ }
      try { emitterUnsub?.() } catch { /* */ }
    }

    // ── Connect con timeout ────────────────────────────────────────────────
    let timeoutId: ReturnType<typeof setTimeout> | null = null

    const connectPromise = connectAsync({ connector: wcConnector })

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error("Timeout: relay WalletConnect non risponde. Verifica la connessione e riprova."))
      }, CONNECT_TIMEOUT_MS)
    })

    try {
      await Promise.race([connectPromise, timeoutPromise])
      if (timeoutId) clearTimeout(timeoutId)
      cleanup()
      if (!cancelled) setPhase({ kind: "idle" })
    } catch (err) {
      if (timeoutId) clearTimeout(timeoutId)
      cleanup()
      if (cancelled) return

      const msg = (err as Error)?.message ?? String(err)
      console.error("[WalletSheet] errore connessione:", msg)

      const isExpected =
        msg.includes("already") ||
        msg.includes("rejected") ||
        msg.includes("User denied") ||
        msg.includes("cancelled") ||
        msg.includes("session") ||
        // Errori che succedono quando l'utente approva e torna: il connect
        // lato Safari si considera interrotto anche se la sessione è OK
        msg.includes("Connection request reset")

      // Errori di rete / relay — mostrare un messaggio chiaro
      const isNetworkError =
        msg.includes("Connection interrupted") ||
        msg.includes("subscribe") ||
        msg.includes("WebSocket") ||
        msg.includes("socket")

      if (isExpected) {
        setPhase({ kind: "idle" })
      } else if (isNetworkError) {
        setPhase({
          kind: "error",
          message: "Connessione al relay WalletConnect interrotta. Prova con una rete più stabile o riprova.",
        })
      } else {
        setPhase({ kind: "error", message: msg.length > 160 ? msg.slice(0, 157) + "…" : msg })
      }
    }
  }, [connectors, connectAsync])

  // ── handleInjected (MetaMask desktop) ─────────────────────────────────────
  const handleInjected = useCallback(async () => {
    const inj = connectors.find(c => c.type === "injected")
    if (!inj) {
      void handleConnect(WALLETS.find(w => w.id === "metamask")!)
      return
    }
    setPhase({ kind: "connecting", walletId: "metamask" })
    try {
      await connectAsync({ connector: inj })
      setPhase({ kind: "idle" })
    } catch (err) {
      const msg = (err as Error)?.message ?? String(err)
      if (!msg.includes("rejected") && !msg.includes("denied")) {
        setPhase({ kind: "error", message: msg })
      } else {
        setPhase({ kind: "idle" })
      }
    }
  }, [connectors, connectAsync, handleConnect])

  if (!open) return null

  const isConnecting = phase.kind === "connecting" || phase.kind === "redirect"
  const redirectWallet = phase.kind === "redirect" ? WALLETS.find(w => w.id === phase.walletId) : null

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        display: "flex", flexDirection: "column", justifyContent: "flex-end",
        background: "rgba(0,0,0,0.55)",
        backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)",
        touchAction: "none",
      }}
      onClick={(e) => { if (e.target === e.currentTarget) close() }}
    >
      <div
        style={{
          background: "var(--bg-secondary, #1c1c2e)",
          borderRadius: "24px 24px 0 0",
          padding: "20px 16px 40px",
          boxShadow: "0 -8px 40px rgba(0,0,0,0.5)",
          maxHeight: "82vh", overflowY: "auto",
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
          <button onClick={close} style={{ background: "none", border: "none", color: "#999", fontSize: "1.4rem", cursor: "pointer", padding: "4px 8px", touchAction: "manipulation" }}>
            ✕
          </button>
        </div>

        {/* Banner stato */}
        {phase.kind === "connecting" && (
          <div style={{ background: "#1e2a3a", borderRadius: 12, padding: "12px 14px", marginBottom: 14, color: "#94a3b8", fontSize: "0.88rem", textAlign: "center" }}>
            ⏳ Connessione in corso… (max 25 s)
          </div>
        )}
        {phase.kind === "redirect" && redirectWallet && (
          <div style={{ background: "#1e293b", borderRadius: 12, padding: "14px 16px", marginBottom: 14, textAlign: "center" }}>
            <div style={{ fontSize: "1.5rem", marginBottom: 6 }}>{redirectWallet.icon}</div>
            <div style={{ color: "#94a3b8", fontSize: "0.88rem" }}>
              Apertura <strong>{redirectWallet.label}</strong>…<br />
              <span style={{ color: "#64748b", fontSize: "0.8rem" }}>Approva nell'app, poi torna qui</span>
            </div>
          </div>
        )}
        {phase.kind === "error" && (
          <div style={{ background: "#2d1b1b", borderRadius: 12, padding: "12px 14px", marginBottom: 14, color: "#f87171", fontSize: "0.83rem", wordBreak: "break-word" }}>
            ⚠️ {phase.message}
            <button onClick={() => setPhase({ kind: "idle" })} style={{ display: "block", marginTop: 8, color: "#f87171", background: "none", border: "none", cursor: "pointer", fontSize: "0.82rem", textDecoration: "underline", padding: 0 }}>
              Riprova
            </button>
          </div>
        )}

        {/* Wallet list */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <WBtn icon="🦊" label="MetaMask"        sub="Browser extension o app mobile" color="#F6851B" disabled={isConnecting} onClick={handleInjected} />
          {WALLETS.filter(w => w.id !== "metamask").map(w => (
            <WBtn key={w.id} icon={w.icon} label={w.label} sub="Apre l'app wallet sul tuo telefono" color={w.color} disabled={isConnecting} onClick={() => void handleConnect(w)} />
          ))}
        </div>

        <div style={{ marginTop: 18, textAlign: "center", color: "#555", fontSize: "0.76rem", lineHeight: 1.5 }}>
          🔒 Connessione via WalletConnect — nessuna chiave privata condivisa
        </div>
      </div>
    </div>
  )
}

// ── WalletButton ──────────────────────────────────────────────────────────────

function WBtn({ icon, label, sub, color, disabled, onClick }: {
  icon: string; label: string; sub: string; color: string; disabled: boolean; onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        display: "flex", alignItems: "center", gap: 14,
        background: "var(--bg-tertiary, #16213e)",
        border: "1px solid rgba(255,255,255,0.07)",
        borderRadius: 14, padding: "13px 16px",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        textAlign: "left", width: "100%",
        touchAction: "manipulation", WebkitTapHighlightColor: "transparent",
      }}
    >
      <span style={{ width: 40, height: 40, borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1.4rem", background: `${color}18`, flexShrink: 0 }}>
        {icon}
      </span>
      <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <span style={{ color: "var(--text-primary, #fff)", fontSize: "0.95rem", fontWeight: 600 }}>{label}</span>
        <span style={{ color: "#888", fontSize: "0.78rem" }}>{sub}</span>
      </span>
      <span style={{ marginLeft: "auto", color: "#555", fontSize: "0.9rem" }}>›</span>
    </button>
  )
}
