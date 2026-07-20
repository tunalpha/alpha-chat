import { useState, useEffect, useRef } from "react";

/* ─── keyframe animations ─────────────────────────────────────────────────── */
const STYLES = `
  @import url('https://fonts.googleapis.com/css2?family=Share+Tech+Mono&display=swap');

  .nuke-root {
    font-family: 'Share Tech Mono', 'Courier New', monospace;
    background: #000;
    min-height: 100dvh;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-start;
    padding: 0;
    overflow: hidden;
    position: relative;
    color: #ff2222;
  }

  /* scanlines overlay */
  .nuke-root::before {
    content: '';
    position: fixed;
    inset: 0;
    background: repeating-linear-gradient(
      0deg,
      transparent,
      transparent 2px,
      rgba(0,0,0,0.18) 2px,
      rgba(0,0,0,0.18) 4px
    );
    pointer-events: none;
    z-index: 100;
  }

  /* red edge vignette — intensifies when armed */
  .nuke-vignette {
    position: fixed;
    inset: 0;
    pointer-events: none;
    z-index: 90;
    transition: opacity 0.8s ease;
  }
  .nuke-vignette.idle    { opacity: 0; }
  .nuke-vignette.armed   { opacity: 1; }
  .nuke-vignette.countdown { opacity: 1; }
  .nuke-vignette.exploding  { opacity: 0; }
  .nuke-vignette.destroyed  { opacity: 0; }

  .nuke-vignette-inner {
    position: absolute;
    inset: 0;
    box-shadow: inset 0 0 80px 30px rgba(200,0,0,0.55);
    animation: vignette-pulse 0.8s ease-in-out infinite alternate;
  }
  @keyframes vignette-pulse {
    from { box-shadow: inset 0 0 80px 30px rgba(200,0,0,0.45); }
    to   { box-shadow: inset 0 0 120px 50px rgba(255,0,0,0.75); }
  }

  /* header bar */
  .nuke-header {
    width: 100%;
    border-bottom: 1px solid #330000;
    padding: 12px 20px;
    display: flex;
    align-items: center;
    gap: 10px;
    background: rgba(20,0,0,0.9);
  }
  .nuke-header-badge {
    background: #ff0000;
    color: #000;
    font-size: 9px;
    font-weight: bold;
    padding: 2px 6px;
    letter-spacing: 2px;
    clip-path: polygon(4px 0%, 100% 0%, calc(100% - 4px) 100%, 0% 100%);
  }
  .nuke-header-title {
    font-size: 11px;
    letter-spacing: 3px;
    color: #ff3333;
    text-transform: uppercase;
    flex: 1;
  }
  .nuke-header-dot {
    width: 6px; height: 6px;
    border-radius: 50%;
    background: #ff0000;
    animation: blink-dot 1s step-end infinite;
  }
  @keyframes blink-dot {
    0%, 100% { opacity: 1; }
    50% { opacity: 0; }
  }

  /* warning strip */
  .nuke-warning-strip {
    background: #ff0000;
    color: #000;
    font-size: 10px;
    letter-spacing: 4px;
    font-weight: bold;
    text-align: center;
    padding: 4px 0;
    width: 100%;
    overflow: hidden;
    white-space: nowrap;
  }
  .nuke-warning-inner {
    display: inline-block;
    animation: marquee 12s linear infinite;
  }
  @keyframes marquee {
    0%   { transform: translateX(100%); }
    100% { transform: translateX(-100%); }
  }

  /* main content area */
  .nuke-body {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 24px 24px 20px;
    width: 100%;
    gap: 20px;
  }

  /* skull / icon */
  .nuke-skull {
    font-size: 48px;
    line-height: 1;
    filter: drop-shadow(0 0 16px rgba(255,0,0,0.9));
    animation: skull-float 3s ease-in-out infinite;
  }
  @keyframes skull-float {
    0%, 100% { transform: translateY(0px) rotate(-2deg); }
    50%      { transform: translateY(-8px) rotate(2deg); }
  }

  /* warning text block */
  .nuke-warn-box {
    border: 1px solid #550000;
    background: rgba(80,0,0,0.2);
    padding: 14px;
    width: 100%;
    text-align: center;
  }
  .nuke-warn-title {
    font-size: 13px;
    letter-spacing: 3px;
    color: #ff2222;
    margin-bottom: 8px;
    animation: blink-text 2s step-end infinite;
  }
  @keyframes blink-text {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }
  .nuke-warn-body {
    font-size: 10px;
    color: #aa3333;
    line-height: 1.7;
    letter-spacing: 1px;
  }
  .nuke-warn-body strong { color: #ff4444; }

  /* input */
  .nuke-input-label {
    font-size: 9px;
    letter-spacing: 3px;
    color: #882222;
    text-align: center;
    margin-bottom: 6px;
  }
  .nuke-input {
    width: 100%;
    background: #0a0000;
    border: 1px solid #440000;
    color: #ff2222;
    font-family: 'Share Tech Mono', monospace;
    font-size: 18px;
    text-align: center;
    letter-spacing: 6px;
    padding: 10px;
    outline: none;
    text-transform: uppercase;
    transition: border-color 0.3s, box-shadow 0.3s;
  }
  .nuke-input::placeholder { color: #330000; letter-spacing: 4px; }
  .nuke-input.armed {
    border-color: #ff0000;
    box-shadow: 0 0 20px rgba(255,0,0,0.4), inset 0 0 10px rgba(255,0,0,0.1);
  }
  .nuke-input:focus { border-color: #660000; }

  /* progress bar under input */
  .nuke-progress-bar {
    width: 100%;
    height: 2px;
    background: #1a0000;
    margin-top: -12px;
    position: relative;
    overflow: hidden;
  }
  .nuke-progress-fill {
    height: 100%;
    background: #ff0000;
    transition: width 0.1s;
    box-shadow: 0 0 6px #ff0000;
  }

  /* ── BOMB BUTTON ─────────────────────────────────────────────────────────── */
  .nuke-btn-wrap {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 160px;
    height: 160px;
  }

  /* pulse rings */
  .nuke-ring {
    position: absolute;
    border-radius: 50%;
    border: 1px solid rgba(255, 0, 0, 0.4);
    animation: ring-expand 2s ease-out infinite;
  }
  .nuke-ring:nth-child(1) { width: 160px; height: 160px; animation-delay: 0s; }
  .nuke-ring:nth-child(2) { width: 160px; height: 160px; animation-delay: 0.6s; }
  .nuke-ring:nth-child(3) { width: 160px; height: 160px; animation-delay: 1.2s; }
  @keyframes ring-expand {
    0%   { transform: scale(1);   opacity: 0.8; }
    100% { transform: scale(2.2); opacity: 0; }
  }
  /* faster rings when armed */
  .armed .nuke-ring { animation-duration: 0.9s; }
  .countdown .nuke-ring { animation-duration: 0.4s; }

  .nuke-btn {
    width: 110px;
    height: 110px;
    border-radius: 50%;
    border: none;
    background: radial-gradient(circle at 35% 35%, #ff4444, #aa0000 50%, #550000);
    box-shadow:
      0 0 30px rgba(255,0,0,0.6),
      0 0 60px rgba(200,0,0,0.3),
      inset 0 2px 4px rgba(255,180,180,0.3),
      inset 0 -3px 6px rgba(0,0,0,0.5);
    cursor: pointer;
    position: relative;
    z-index: 1;
    transition: transform 0.1s, box-shadow 0.2s;
    animation: btn-pulse 2s ease-in-out infinite;
    -webkit-tap-highlight-color: transparent;
    user-select: none;
  }
  @keyframes btn-pulse {
    0%, 100% {
      box-shadow: 0 0 30px rgba(255,0,0,0.5), 0 0 60px rgba(200,0,0,0.25), inset 0 2px 4px rgba(255,180,180,0.3), inset 0 -3px 6px rgba(0,0,0,0.5);
      transform: scale(1);
    }
    50% {
      box-shadow: 0 0 50px rgba(255,0,0,0.8), 0 0 100px rgba(200,0,0,0.5), inset 0 2px 4px rgba(255,180,180,0.3), inset 0 -3px 6px rgba(0,0,0,0.5);
      transform: scale(1.04);
    }
  }
  .armed .nuke-btn    { animation-duration: 0.8s; }
  .countdown .nuke-btn { animation-duration: 0.3s; }
  .nuke-btn:disabled {
    cursor: not-allowed;
    filter: grayscale(0.6);
    animation-duration: 3s;
    opacity: 0.5;
  }
  .nuke-btn:not(:disabled):active {
    transform: scale(0.92);
    box-shadow: 0 0 80px rgba(255,0,0,1), 0 0 140px rgba(255,0,0,0.7), inset 0 4px 8px rgba(0,0,0,0.6);
  }

  /* icon inside button */
  .nuke-btn-icon {
    font-size: 40px;
    line-height: 1;
    filter: drop-shadow(0 2px 4px rgba(0,0,0,0.8));
    pointer-events: none;
  }

  /* locked indicator */
  .nuke-locked-label {
    font-size: 9px;
    letter-spacing: 3px;
    color: #551111;
    text-align: center;
    margin-top: -8px;
  }
  .nuke-armed-label {
    font-size: 10px;
    letter-spacing: 4px;
    color: #ff3333;
    text-align: center;
    margin-top: -8px;
    animation: blink-text 0.6s step-end infinite;
  }

  /* ── COUNTDOWN STATE ───────────────────────────────────────────────────────*/
  .nuke-countdown {
    font-size: 96px;
    font-weight: bold;
    color: #ff0000;
    text-align: center;
    line-height: 1;
    text-shadow: 0 0 40px rgba(255,0,0,1), 0 0 80px rgba(255,0,0,0.6);
    animation: countdown-pulse 0.25s ease-in-out infinite alternate;
  }
  @keyframes countdown-pulse {
    from { transform: scale(1);   text-shadow: 0 0 30px rgba(255,0,0,0.8); }
    to   { transform: scale(1.08); text-shadow: 0 0 60px rgba(255,0,0,1), 0 0 100px rgba(255,100,100,0.5); }
  }
  .nuke-countdown-label {
    font-size: 10px;
    letter-spacing: 5px;
    color: #882222;
    text-align: center;
  }

  /* ── SHAKE ─────────────────────────────────────────────────────────────────*/
  @keyframes screen-shake {
    0%  { transform: translate(0, 0); }
    10% { transform: translate(-4px, -3px); }
    20% { transform: translate(5px,  3px); }
    30% { transform: translate(-5px,  2px); }
    40% { transform: translate(4px, -4px); }
    50% { transform: translate(-3px,  5px); }
    60% { transform: translate(4px,  4px); }
    70% { transform: translate(-4px, -3px); }
    80% { transform: translate(5px,  3px); }
    90% { transform: translate(-3px,  4px); }
    100%{ transform: translate(0, 0); }
  }
  .shaking { animation: screen-shake 0.12s ease-in-out infinite; }

  /* ── EXPLOSION FLASH ───────────────────────────────────────────────────────*/
  .nuke-flash {
    position: fixed;
    inset: 0;
    background: #fff;
    z-index: 200;
    pointer-events: none;
    animation: flash-out 1.2s ease-out forwards;
  }
  @keyframes flash-out {
    0%   { opacity: 1; }
    30%  { opacity: 1; }
    100% { opacity: 0; }
  }

  /* ── PARTICLES ─────────────────────────────────────────────────────────────*/
  .nuke-particle {
    position: fixed;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #ff2200;
    z-index: 150;
    pointer-events: none;
    animation: particle-fly var(--dur) ease-out forwards;
  }
  @keyframes particle-fly {
    0%   { transform: translate(0,0) scale(1); opacity: 1; }
    100% { transform: translate(var(--tx), var(--ty)) scale(0); opacity: 0; }
  }

  /* ── DESTROYED STATE ───────────────────────────────────────────────────────*/
  .nuke-destroyed {
    position: fixed;
    inset: 0;
    background: #000;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 20px;
    z-index: 300;
    animation: destroyed-in 1.5s ease-out forwards;
  }
  @keyframes destroyed-in {
    0%   { opacity: 0; }
    40%  { opacity: 0; }
    100% { opacity: 1; }
  }
  .nuke-destroyed-skull {
    font-size: 72px;
    filter: drop-shadow(0 0 30px rgba(255,0,0,0.8));
  }
  .nuke-destroyed-title {
    font-size: 22px;
    letter-spacing: 4px;
    color: #ff0000;
    text-align: center;
    text-shadow: 0 0 20px rgba(255,0,0,0.8);
  }
  .nuke-destroyed-line {
    width: 80px;
    height: 1px;
    background: #330000;
  }
  .nuke-destroyed-sub {
    font-size: 10px;
    letter-spacing: 3px;
    color: #551111;
    text-align: center;
    line-height: 1.8;
    padding: 0 40px;
  }
  .nuke-destroyed-time {
    font-size: 9px;
    color: #220000;
    letter-spacing: 2px;
  }
`;

/* ─── Particle component ─────────────────────────────────────────────────── */
interface Particle { id: number; x: number; y: number; tx: number; ty: number; dur: number; color: string; }

function ParticleField({ particles }: { particles: Particle[] }) {
  return (
    <>
      {particles.map(p => (
        <div
          key={p.id}
          className="nuke-particle"
          style={{
            left: p.x,
            top: p.y,
            background: p.color,
            "--tx": `${p.tx}px`,
            "--ty": `${p.ty}px`,
            "--dur": `${p.dur}ms`,
          } as React.CSSProperties}
        />
      ))}
    </>
  );
}

/* ─── Main component ─────────────────────────────────────────────────────── */
type Phase = "idle" | "armed" | "countdown" | "exploding" | "destroyed";

export function NuclearDestroy() {
  const [input, setInput] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [countdown, setCountdown] = useState(5);
  const [particles, setParticles] = useState<Particle[]>([]);
  const [showFlash, setShowFlash] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const target = "DISTRUGGI";
  const progress = Math.min(input.toUpperCase().split("").filter((c, i) => c === target[i]).length / target.length, 1);
  const isArmed = input.toUpperCase() === target;

  // Sync phase with armed state
  useEffect(() => {
    if (isArmed && phase === "idle") setPhase("armed");
    if (!isArmed && phase === "armed") setPhase("idle");
  }, [isArmed, phase]);

  // Countdown logic
  useEffect(() => {
    if (phase !== "countdown") { countdownRef.current && clearInterval(countdownRef.current); return; }
    setCountdown(5);
    countdownRef.current = setInterval(() => {
      setCountdown(n => {
        if (n <= 1) {
          clearInterval(countdownRef.current!);
          triggerExplosion();
          return 0;
        }
        return n - 1;
      });
    }, 1000);
    return () => { countdownRef.current && clearInterval(countdownRef.current); };
  }, [phase]);

  function triggerExplosion() {
    setPhase("exploding");
    setShowFlash(true);
    // spawn particles from center
    const cx = window.innerWidth / 2;
    const cy = window.innerHeight / 2;
    const ps: Particle[] = Array.from({ length: 40 }, (_, i) => {
      const angle = (i / 40) * Math.PI * 2;
      const dist = 100 + Math.random() * 300;
      const colors = ["#ff2200", "#ff6600", "#ffaa00", "#ff0000", "#ffffff"];
      return {
        id: i,
        x: cx,
        y: cy,
        tx: Math.cos(angle) * dist,
        ty: Math.sin(angle) * dist,
        dur: 600 + Math.random() * 800,
        color: colors[Math.floor(Math.random() * colors.length)],
      };
    });
    setParticles(ps);
    setTimeout(() => setShowFlash(false), 1200);
    setTimeout(() => setPhase("destroyed"), 2000);
  }

  function handleBtnClick() {
    if (!isArmed || phase === "countdown" || phase === "exploding" || phase === "destroyed") return;
    setPhase("countdown");
  }

  function handleCancel() {
    countdownRef.current && clearInterval(countdownRef.current);
    setPhase(isArmed ? "armed" : "idle");
    setCountdown(5);
  }

  const nowStr = new Date().toISOString().replace("T", " ").substring(0, 19) + " UTC";

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: STYLES }} />

      {/* Flash */}
      {showFlash && <div className="nuke-flash" />}

      {/* Particles */}
      <ParticleField particles={particles} />

      {/* Destroyed overlay */}
      {phase === "destroyed" && (
        <div className="nuke-destroyed">
          <div className="nuke-destroyed-skull">💀</div>
          <div className="nuke-destroyed-title">ACCOUNT ELIMINATO</div>
          <div className="nuke-destroyed-line" />
          <div className="nuke-destroyed-sub">
            TUTTI I DATI SONO STATI<br />
            DISTRUTTI DEFINITIVAMENTE.<br />
            NESSUN RECUPERO POSSIBILE.
          </div>
          <div className="nuke-destroyed-time">{nowStr}</div>
        </div>
      )}

      {/* Main UI */}
      <div className={`nuke-root ${phase} ${phase === "countdown" ? "shaking" : ""}`}>

        {/* Red edge vignette */}
        <div className={`nuke-vignette ${phase}`}>
          <div className="nuke-vignette-inner" />
        </div>

        {/* Header */}
        <div className="nuke-header">
          <div className="nuke-header-badge">⚠ TOP SECRET</div>
          <div className="nuke-header-title">PROTOCOLLO NUCLEARE</div>
          <div className="nuke-header-dot" />
        </div>

        {/* Warning marquee */}
        <div className="nuke-warning-strip">
          <span className="nuke-warning-inner">
            ⚠ ACCESSO AUTORIZZATO — OPERAZIONE IRREVERSIBILE — TUTTI I DATI VERRANNO ELIMINATI ⚠
            &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
            ⚠ ACCESSO AUTORIZZATO — OPERAZIONE IRREVERSIBILE — TUTTI I DATI VERRANNO ELIMINATI ⚠
          </span>
        </div>

        {/* Body */}
        <div className="nuke-body">

          {/* Countdown view */}
          {phase === "countdown" ? (
            <>
              <div style={{ flex: 1 }} />
              <div className="nuke-countdown">{countdown}</div>
              <div className="nuke-countdown-label">DETONAZIONE IN CORSO</div>
              <div style={{ flex: 1 }} />
              <button
                onClick={handleCancel}
                style={{
                  background: "transparent",
                  border: "1px solid #440000",
                  color: "#882222",
                  fontFamily: "inherit",
                  fontSize: "10px",
                  letterSpacing: "4px",
                  padding: "12px 32px",
                  cursor: "pointer",
                  width: "100%",
                }}
              >
                ✕ ANNULLA
              </button>
            </>
          ) : phase === "exploding" ? (
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <div style={{ fontSize: 80, animation: "skull-float 0.2s ease-in-out infinite" }}>💥</div>
            </div>
          ) : phase !== "destroyed" ? (
            <>
              {/* Skull */}
              <div className="nuke-skull">☢️</div>

              {/* Warning box */}
              <div className="nuke-warn-box">
                <div className="nuke-warn-title">⚠ ATTENZIONE — PUNTO DI NON RITORNO</div>
                <div className="nuke-warn-body">
                  Questa procedura distruggerà <strong>permanentemente</strong> l'account,
                  tutti i messaggi, le chiavi crittografiche, i media e ogni dato associato.
                  <br /><br />
                  <strong>L'operazione è irreversibile.</strong><br />
                  Nessun recupero sarà possibile.
                </div>
              </div>

              {/* Input */}
              <div style={{ width: "100%" }}>
                <div className="nuke-input-label">DIGITA PER ARMARE IL SISTEMA</div>
                <input
                  className={`nuke-input ${isArmed ? "armed" : ""}`}
                  placeholder="DISTRUGGI"
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  maxLength={9}
                  autoComplete="off"
                  spellCheck={false}
                />
                <div className="nuke-progress-bar">
                  <div className="nuke-progress-fill" style={{ width: `${progress * 100}%` }} />
                </div>
              </div>

              {/* Bomb button */}
              <div className={`nuke-btn-wrap ${phase}`}>
                <div className="nuke-ring" />
                <div className="nuke-ring" />
                <div className="nuke-ring" />
                <button
                  ref={btnRef}
                  className="nuke-btn"
                  disabled={!isArmed}
                  onClick={handleBtnClick}
                  aria-label="Distruggi account"
                >
                  <div className="nuke-btn-icon">☢</div>
                </button>
              </div>

              {/* Status label under button */}
              {!isArmed
                ? <div className="nuke-locked-label">🔒 SISTEMA BLOCCATO</div>
                : <div className="nuke-armed-label">⚡ SISTEMA ARMATO — PREMI IL BOTTONE</div>
              }

              {/* Cancel link */}
              <div style={{ marginTop: "auto", paddingTop: 12 }}>
                <button
                  onClick={() => { setInput(""); setPhase("idle"); }}
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "#331111",
                    fontFamily: "inherit",
                    fontSize: "9px",
                    letterSpacing: "3px",
                    cursor: "pointer",
                    textDecoration: "underline",
                  }}
                >
                  ANNULLA — TORNA INDIETRO
                </button>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </>
  );
}
