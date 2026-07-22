/**
 * WalletSheet — bottom sheet nativo iOS per connettere wallet.
 *
 * ── Root Cause Analysis (completa) ────────────────────────────────────────────
 *
 * Problema: "Connection interrupted while trying to subscribe"
 *
 * Causa strutturale:
 *   wagmi createConfig() chiama setup() → getProvider() → EthereumProvider.init()
 *   → @walletconnect/core Core.start() → relay WebSocket aperto ALL'AVVIO.
 *   Quando l'utente preme il wallet (anche 30s dopo, su 4G), il WS relay è già
 *   caduto (4G idle timeout). provider.connect() tenta waku_subscribe sul WS morto
 *   → "Connection interrupted while trying to subscribe".
 *
 * Fix:
 *   Prima di ogni connect, chiamare connector.disconnect() che setta:
 *     provider_       = undefined
 *     providerPromise = undefined
 *   Il successivo connectAsync → getProvider() → EthereumProvider.init() fresco
 *   → nuovo relay WS → subscribe funziona.
 *
 * Subscription display_uri:
 *   wagmi connector.connect() fa provider.on('display_uri', onDisplayUri)
 *   onDisplayUri → config.emitter.emit('message', { type: 'display_uri', data: uri })
 *   Noi ascoltiamo wcConnector.emitter.on('message', handler) — sempre corretto
 *   (dopo il reset il provider è nuovo, l'emitter è lo stesso oggetto wagmi).
 */

import { useEffect, useState, useCallback, useRef } from "react"
import { useAccount, useConnectors, useConnect }    from "wagmi"
import { WC_PROJECT_ID }                            from "../../lib/wallet-client"

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
  | { kind: "connecting"; walletId: WalletId; attempt: number }
  | { kind: "redirect";   walletId: WalletId }
  | { kind: "error";      message: string }

const MAX_RETRIES     = 3
const CONNECT_TIMEOUT = 25_000

// ── Componente ────────────────────────────────────────────────────────────────

export default function WalletSheet() {
  const [open,  setOpen]  = useState(false)
  const [phase, setPhase] = useState<Phase>({ kind: "idle" })
  const cancelRef = useRef(false)

  const { isConnected }  = useAccount()
  const connectors       = useConnectors()
  const { connectAsync } = useConnect()

  // Apri da walletModal.open()
  useEffect(() => {
    const h = () => { setPhase({ kind: "idle" }); setOpen(true) }
    window.addEventListener("alpha:open-wallet-sheet", h)
    return () => window.removeEventListener("alpha:open-wallet-sheet", h)
  }, [])

  // Chiudi quando connesso
  useEffect(() => {
    if (isConnected && open) {
      cancelRef.current = true
      setOpen(false)
      setPhase({ kind: "idle" })
    }
  }, [isConnected, open])

  const close = useCallback(() => {
    cancelRef.current = true
    setOpen(false)
    setPhase({ kind: "idle" })
  }, [])

  // ── Un singolo tentativo ───────────────────────────────────────────────────
  const attemptConnect = useCallback(async (
    wallet:      typeof WALLETS[number],
    wcConnector: ReturnType<typeof useConnectors>[number],
    attempt:     number,
  ): Promise<"success" | "retry" | { error: string }> => {

    // ── 1. Reset provider stantio ─────────────────────────────────────────
    //   connector.disconnect() → provider_ = undefined, providerPromise = undefined
    //   Il successivo connectAsync chiamerà EthereumProvider.init() fresco.
    try {
      await (wcConnector as unknown as { disconnect(): Promise<void> }).disconnect()
    } catch {
      // Normale se non c'è sessione attiva — ignora
    }
    // Pausa breve per lasciar propagare il cambio di stato wagmi
    await new Promise(r => setTimeout(r, 250))

    if (cancelRef.current) return "success"

    // ── 2. Subscription display_uri via emitter wagmi ─────────────────────
    //   wagmi connector.connect() fa:
    //     provider.on('display_uri', onDisplayUri)
    //     onDisplayUri → config.emitter.emit('message', { type: 'display_uri', data: uri })
    //   Noi ascoltiamo wcConnector.emitter.on('message', ...) — riceve l'evento.
    let uriHandled = false

    const msgHandler = (data: { type: string; data?: unknown }) => {
      if (data.type !== "display_uri" || uriHandled || cancelRef.current) return
      uriHandled = true

      const uri      = String(data.data)
      const encoded  = encodeURIComponent(uri)
      console.info("[WalletSheet] ✅ display_uri →", uri.slice(0, 60))
      setPhase({ kind: "redirect", walletId: wallet.id })
      setTimeout(() => {
        if (!cancelRef.current) window.location.href = wallet.deepLink(encoded)
      }, 60)
    }

    // wagmi v3 Emitter.on() restituisce la funzione unsub
    const emitterUnsub = wcConnector.emitter.on(
      "message" as never,
      msgHandler as never,
    ) as unknown as (() => void) | undefined
    const cleanup = () => {
      try {
        if (typeof emitterUnsub === "function") {
          emitterUnsub()
        } else {
          wcConnector.emitter.off?.("message" as never, msgHandler as never)
        }
      } catch { /* */ }
    }

    // ── 3. Connect con timeout ─────────────────────────────────────────────
    let timeoutId: ReturnType<typeof setTimeout> | null = null

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(
        () => reject(new Error(`Timeout dopo ${CONNECT_TIMEOUT / 1000}s`)),
        CONNECT_TIMEOUT,
      )
    })

    try {
      await Promise.race([
        connectAsync({ connector: wcConnector }),
        timeoutPromise,
      ])
      if (timeoutId) clearTimeout(timeoutId)
      cleanup()
      return "success"
    } catch (err) {
      if (timeoutId) clearTimeout(timeoutId)
      cleanup()

      if (cancelRef.current) return "success"

      const msg = (err as Error)?.message ?? String(err)
      console.error(`[WalletSheet] tentativo ${attempt} fallito:`, msg)

      // Errori attesi → chiudi silenziosamente
      if (
        msg.includes("already") ||
        msg.includes("rejected") ||
        msg.includes("User denied") ||
        /connection request reset/i.test(msg)
      ) return { error: "" }

      // Errori relay / rete → retry (risolti dal fresh init al prossimo tentativo)
      if (
        msg.includes("Connection interrupted") ||
        msg.includes("subscribe") ||
        msg.includes("WebSocket") ||
        msg.includes("socket")   ||
        msg.includes("Timeout")
      ) {
        if (attempt < MAX_RETRIES) return "retry"
        return {
          error:
            "Il relay WalletConnect non risponde.\n" +
            "Suggerimento: prova su WiFi o ricarica l'app.",
        }
      }

      return { error: msg.length > 200 ? msg.slice(0, 197) + "…" : msg }
    }
  }, [connectAsync])

  // ── handleConnect — retry loop ─────────────────────────────────────────────
  const handleConnect = useCallback(async (wallet: typeof WALLETS[number]) => {
    if (!WC_PROJECT_ID) {
      setPhase({ kind: "error", message: "VITE_WALLETCONNECT_PROJECT_ID non configurato." })
      return
    }

    const wcConnector = connectors.find(c => c.type === "walletConnect")
    if (!wcConnector) {
      setPhase({ kind: "error", message: "Connettore WalletConnect non trovato. Ricarica." })
      return
    }

    cancelRef.current = false

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      if (cancelRef.current) return

      setPhase({ kind: "connecting", walletId: wallet.id, attempt })

      const result = await attemptConnect(wallet, wcConnector, attempt)

      if (result === "success") { setPhase({ kind: "idle" }); return }
      if (result === "retry") {
        console.info(`[WalletSheet] retry ${attempt}/${MAX_RETRIES} (provider resettato al prossimo giro)`)
        // Nessun sleep extra: il reset via disconnect() avviene all'inizio del prossimo attempt
        continue
      }
      setPhase(result.error === "" ? { kind: "idle" } : { kind: "error", message: result.error })
      return
    }
  }, [connectors, attemptConnect])

  // ── handleInjected (MetaMask desktop / extension) ─────────────────────────
  const handleInjected = useCallback(async () => {
    const inj = connectors.find(c => c.type === "injected")
    if (!inj) { void handleConnect(WALLETS.find(w => w.id === "metamask")!); return }

    setPhase({ kind: "connecting", walletId: "metamask", attempt: 1 })
    try {
      await connectAsync({ connector: inj })
      setPhase({ kind: "idle" })
    } catch (err) {
      const msg = (err as Error)?.message ?? ""
      if (!msg.includes("rejected") && !msg.includes("denied")) {
        setPhase({ kind: "error", message: msg || "Connessione rifiutata." })
      } else {
        setPhase({ kind: "idle" })
      }
    }
  }, [connectors, connectAsync, handleConnect])

  if (!open) return null

  const isConnecting    = phase.kind === "connecting" || phase.kind === "redirect"
  const activeWallet    = (phase.kind === "connecting" || phase.kind === "redirect")
    ? WALLETS.find(w => w.id === phase.walletId)
    : null

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        display: "flex", flexDirection: "column", justifyContent: "flex-end",
        background: "rgba(0,0,0,0.55)",
        backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)",
        touchAction: "none",
      }}
      onClick={e => { if (e.target === e.currentTarget) close() }}
    >
      <div
        style={{
          background: "var(--bg-secondary, #1c1c2e)",
          borderRadius: "24px 24px 0 0",
          padding: "20px 16px 40px",
          boxShadow: "0 -8px 40px rgba(0,0,0,0.5)",
          maxHeight: "82vh", overflowY: "auto",
        }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ width: 40, height: 4, background: "#555", borderRadius: 2, margin: "0 auto 20px" }} />

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
          <span style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--text-primary, #fff)" }}>
            Connetti Wallet
          </span>
          <button onClick={close} style={{ background: "none", border: "none", color: "#999", fontSize: "1.4rem", cursor: "pointer", padding: "4px 8px", touchAction: "manipulation" }}>✕</button>
        </div>

        {/* Banner connecting */}
        {phase.kind === "connecting" && (
          <div style={{ background: "#1e2a3a", borderRadius: 12, padding: "14px 16px", marginBottom: 14, textAlign: "center" }}>
            <div style={{ fontSize: "1.4rem", marginBottom: 4 }}>{activeWallet?.icon}</div>
            <div style={{ color: "#94a3b8", fontSize: "0.88rem" }}>
              Connessione a <strong>{activeWallet?.label}</strong>…
              {phase.attempt > 1 && (
                <span style={{ color: "#64748b", fontSize: "0.8rem" }}> (tentativo {phase.attempt}/{MAX_RETRIES})</span>
              )}
            </div>
          </div>
        )}

        {/* Banner redirect */}
        {phase.kind === "redirect" && activeWallet && (
          <div style={{ background: "#1e293b", borderRadius: 12, padding: "14px 16px", marginBottom: 14, textAlign: "center" }}>
            <div style={{ fontSize: "1.5rem", marginBottom: 6 }}>{activeWallet.icon}</div>
            <div style={{ color: "#94a3b8", fontSize: "0.88rem" }}>
              Apertura <strong>{activeWallet.label}</strong>…<br />
              <span style={{ color: "#64748b", fontSize: "0.8rem" }}>Approva nell'app, poi torna qui</span>
            </div>
          </div>
        )}

        {/* Banner errore */}
        {phase.kind === "error" && (
          <div style={{ background: "#2d1b1b", borderRadius: 12, padding: "12px 14px", marginBottom: 14, color: "#f87171", fontSize: "0.83rem", wordBreak: "break-word", whiteSpace: "pre-line" }}>
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
