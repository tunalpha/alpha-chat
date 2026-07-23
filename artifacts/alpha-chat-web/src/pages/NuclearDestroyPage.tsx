/**
 * NuclearDestroyPage — Protocollo Nucleare
 * Hold-to-arm su iOS: usa onTouchStart/End nativi.
 */
import { useState, useEffect, useRef, useCallback } from "react";
import { apiDestroyAccountDirect } from "../lib/api";
import { clearAuth } from "../lib/auth";

const HOLD_MS = 5000;

const STYLES = `
  @import url('https://fonts.googleapis.com/css2?family=Oswald:wght@700&family=Share+Tech+Mono&display=swap');

  /* ── Root ── */
  .nk { font-family:'Share Tech Mono','Courier New',monospace; background:#0d0d0d;
        min-height:100dvh; display:flex; flex-direction:column; align-items:center;
        color:#eee; position:relative; }

  /* ── Header ── */
  .nk-hdr { width:100%; padding:10px 16px; padding-top:calc(10px + env(safe-area-inset-top,0px));
             background:#111; border-bottom:2px solid #1a1a1a;
             display:flex; align-items:center; gap:10px; }
  .nk-hdr-back { background:transparent; border:none; color:#cc3333; font-size:26px;
                  cursor:pointer; padding:8px 8px 8px 0; line-height:1;
                  min-width:44px; min-height:44px; display:flex; align-items:center;
                  touch-action:manipulation; -webkit-tap-highlight-color:transparent; }
  .nk-hdr-badge { background:#cc0000; color:#fff; font-size:9px; font-weight:bold;
                   padding:3px 8px; border-radius:2px; letter-spacing:1px; white-space:nowrap; }
  .nk-hdr-title { font-size:12px; letter-spacing:3px; color:#ff7777;
                   text-transform:uppercase; flex:1; }
  .nk-hdr-dot { width:8px; height:8px; border-radius:50%; background:#ff0000;
                 box-shadow:0 0 6px #ff0000; animation:blink 1s step-end infinite; flex-shrink:0; }
  @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }

  /* ── Banner ── */
  .nk-banner { background:#bb0000; color:#fff; font-size:12px; font-weight:bold;
               letter-spacing:2px; padding:5px 0; width:100%; overflow:hidden; white-space:nowrap; }
  .nk-banner-inner { display:inline-block; animation:marquee 28s linear infinite; }
  @keyframes marquee { from{transform:translateX(100vw)} to{transform:translateX(-100%)} }

  /* ── Body ── */
  .nk-body { flex:1; display:flex; flex-direction:column; align-items:center;
              padding:20px 20px 28px; width:100%; gap:18px; }

  /* ── Warning box ── */
  .nk-warn { border:1px solid #333; background:#161616; padding:18px; width:100%;
              border-radius:8px; }
  .nk-warn-ttl { font-size:11px; letter-spacing:3px; color:#ff4444; margin-bottom:10px;
                  text-align:center; }
  .nk-warn-body { font-size:14px; color:#cccccc; line-height:1.8;
                   font-family:-apple-system,sans-serif; text-align:center; }
  .nk-warn-body strong { color:#ff5555; }

  /* ── Panel (around button) ── */
  .nk-panel {
    width:100%; background:#111;
    border:2px solid #222; border-radius:12px;
    padding:20px 16px 24px;
    display:flex; flex-direction:column; align-items:center; gap:14px;
    position:relative; overflow:hidden;
  }
  /* Hazard stripe top */
  .nk-panel::before {
    content:'';
    position:absolute; top:0; left:0; right:0; height:6px;
    background:repeating-linear-gradient(90deg,#cc0000 0,#cc0000 18px,#ffaa00 18px,#ffaa00 36px);
  }
  /* Hazard stripe bottom */
  .nk-panel::after {
    content:'';
    position:absolute; bottom:0; left:0; right:0; height:6px;
    background:repeating-linear-gradient(90deg,#cc0000 0,#cc0000 18px,#ffaa00 18px,#ffaa00 36px);
  }

  /* Side danger labels */
  .nk-panel-labels {
    display:flex; align-items:center; justify-content:space-between; width:100%; padding:0 4px;
  }
  .nk-danger-label {
    display:flex; flex-direction:column; align-items:center; gap:3px;
    border:1px solid #333; border-radius:4px; padding:6px 10px; background:#0d0d0d;
  }
  .nk-danger-label span:first-child { font-size:18px; }
  .nk-danger-label span:last-child { font-size:8px; letter-spacing:1px; color:#ff4444; font-weight:bold; }

  .nk-panel-center { display:flex; flex-direction:column; align-items:center; gap:8px; }

  /* ── Button wrap ── */
  .nk-btn-wrap {
    position:relative; width:160px; height:160px;
    display:flex; align-items:center; justify-content:center;
  }

  /* SVG ring */
  .nk-svg { position:absolute; top:0; left:0; transform:rotate(-90deg); pointer-events:none; }
  .nk-ring-track { fill:none; stroke:rgba(255,80,0,.15); stroke-width:6; }
  .nk-ring-fill  { fill:none; stroke:#ff4400; stroke-width:6; stroke-linecap:round;
                   filter:drop-shadow(0 0 5px rgba(255,100,0,.8)); }

  /* Big dome button */
  .nk-btn {
    width:124px; height:124px; border-radius:50%; border:none; cursor:pointer;
    position:relative; z-index:1;
    /* 3D dome */
    background:
      radial-gradient(ellipse at 38% 28%, rgba(255,180,180,.7) 0%, transparent 40%),
      radial-gradient(ellipse at 60% 70%, rgba(0,0,0,.6) 0%, transparent 60%),
      radial-gradient(circle at 50% 50%, #ff3a00 0%, #cc0000 45%, #880000 75%, #550000 100%);
    box-shadow:
      0 0 0 5px #1a1a1a,
      0 0 0 7px #333,
      0 8px 30px rgba(255,60,0,.6),
      0 0 60px rgba(255,40,0,.3),
      inset 0 -6px 16px rgba(0,0,0,.6),
      inset 0 6px 12px rgba(255,160,100,.2);
    -webkit-tap-highlight-color:transparent;
    touch-action:none;
    /* idle pulse */
    animation:btn-pulse 2.5s ease-in-out infinite;
    transition:transform .1s, box-shadow .15s;
  }
  @keyframes btn-pulse {
    0%,100% { box-shadow:0 0 0 5px #1a1a1a,0 0 0 7px #333,0 8px 30px rgba(255,60,0,.5),0 0 60px rgba(255,40,0,.2),inset 0 -6px 16px rgba(0,0,0,.6),inset 0 6px 12px rgba(255,160,100,.2); }
    50%      { box-shadow:0 0 0 5px #1a1a1a,0 0 0 7px #333,0 8px 50px rgba(255,80,0,.8),0 0 100px rgba(255,60,0,.4),inset 0 -6px 16px rgba(0,0,0,.6),inset 0 6px 12px rgba(255,160,100,.2); }
  }
  .nk-btn.holding {
    animation:none;
    transform:scale(.93) translateY(3px);
    box-shadow:0 0 0 5px #1a1a1a,0 0 0 7px #555,0 4px 60px rgba(255,80,0,1),0 0 120px rgba(255,60,0,.6),inset 0 -3px 8px rgba(0,0,0,.8),inset 0 4px 8px rgba(255,100,50,.15);
  }
  .nk-btn-label {
    font-family:'Oswald',sans-serif; font-size:30px; font-weight:700;
    color:#fff; letter-spacing:4px; text-shadow:2px 2px 6px rgba(0,0,0,.8),0 0 20px rgba(255,150,100,.6);
    pointer-events:none; user-select:none;
    /* embossed effect */
    -webkit-text-stroke:1px rgba(0,0,0,.5);
  }
  .nk-btn-sub {
    font-family:'Share Tech Mono',monospace; font-size:9px; color:rgba(255,220,200,.6);
    letter-spacing:1px; pointer-events:none; margin-top:2px;
  }

  /* Hold counter badge */
  .nk-counter {
    position:absolute; bottom:-4px; left:50%; transform:translateX(-50%);
    background:#ff4400; color:#fff; font-size:14px; font-weight:bold;
    padding:2px 12px; border-radius:12px; white-space:nowrap;
    box-shadow:0 0 12px rgba(255,80,0,.7); font-family:'Share Tech Mono',monospace;
  }

  /* Label below panel */
  .nk-panel-label {
    font-family:-apple-system,sans-serif; font-size:13px; color:#aaaaaa;
    text-align:center; line-height:1.5;
  }
  .nk-panel-label strong { color:#ffffff; }

  /* Status */
  .nk-status { font-size:10px; letter-spacing:2px; color:#555; text-align:center;
               text-transform:uppercase; min-height:16px; }
  .nk-status.on { color:#ff5522; animation:blink-text .4s step-end infinite; }
  @keyframes blink-text { 0%,100%{opacity:1} 50%{opacity:.3} }

  /* Bottom plate */
  .nk-plate {
    border:1px solid #2a2a2a; border-radius:6px; padding:10px 16px;
    background:#0d0d0d; text-align:center; width:100%;
  }
  .nk-plate-top { font-size:9px; letter-spacing:2px; color:#555; margin-bottom:2px; }
  .nk-plate-main { font-family:'Oswald',sans-serif; font-size:18px; letter-spacing:4px; color:#cc2222; }
  .nk-plate-sub { font-size:8px; letter-spacing:2px; color:#444; margin-top:2px; }

  .nk-back-link { background:transparent; border:none; color:#555; font-size:11px;
                  cursor:pointer; text-decoration:underline; -webkit-tap-highlight-color:transparent; }

  /* Countdown */
  .nk-cntdwn-num { font-size:96px; font-weight:bold; color:#ff2200; text-align:center;
                    line-height:1; text-shadow:0 0 40px rgba(255,40,0,1),0 0 80px rgba(255,40,0,.5);
                    animation:cnt-scale .3s ease-in-out infinite alternate; }
  @keyframes cnt-scale { from{transform:scale(1)} to{transform:scale(1.1)} }
  .nk-cntdwn-lbl { font-size:11px; letter-spacing:4px; color:#aa4444; text-align:center; }
  .nk-cancel { background:transparent; border:1px solid #333; color:#888;
               font-family:'Share Tech Mono',monospace; font-size:11px; letter-spacing:3px;
               padding:14px 32px; cursor:pointer; width:100%; border-radius:4px;
               -webkit-tap-highlight-color:transparent; }

  /* Shake */
  @keyframes shake {
    0%{transform:translate(0,0)} 15%{transform:translate(-5px,-3px)} 30%{transform:translate(5px,3px)}
    45%{transform:translate(-4px,4px)} 60%{transform:translate(4px,-4px)}
    75%{transform:translate(-3px,3px)} 90%{transform:translate(3px,-2px)} 100%{transform:translate(0,0)}
  }
  .shaking { animation:shake .12s ease-in-out infinite; }

  /* Flash */
  .nk-flash { position:fixed;inset:0;background:#fff;z-index:500;pointer-events:none;
              animation:flash-out 1.4s ease-out forwards; }
  @keyframes flash-out { 0%,25%{opacity:1} 100%{opacity:0} }

  /* Particles */
  .nk-particle { position:fixed;width:7px;height:7px;border-radius:50%;z-index:400;pointer-events:none;
                 animation:particle-fly var(--dur) ease-out forwards; }
  @keyframes particle-fly {
    0%{transform:translate(0,0) scale(1);opacity:1}
    100%{transform:translate(var(--tx),var(--ty)) scale(0);opacity:0}
  }

  /* Destroyed */
  .nk-destroyed { position:fixed;inset:0;background:#000;display:flex;flex-direction:column;
                  align-items:center;justify-content:center;gap:20px;z-index:600;
                  animation:di 1.8s ease-out forwards; }
  @keyframes di { 0%,40%{opacity:0} 100%{opacity:1} }
  .nk-d-skull { font-size:72px; }
  .nk-d-title { font-family:'Oswald',sans-serif;font-size:24px;letter-spacing:4px;color:#ff2222;
                text-align:center;text-shadow:0 0 20px rgba(255,0,0,.8); }
  .nk-d-line { width:80px;height:1px;background:#330000; }
  .nk-d-sub { font-size:13px;color:#888;text-align:center;line-height:1.8;
               font-family:-apple-system,sans-serif;padding:0 32px; }
  .nk-d-time { font-size:10px;color:#333;letter-spacing:1px;font-family:monospace; }
`;

type Phase = "idle" | "countdown" | "exploding" | "destroyed";
interface Particle { id:number; x:number; y:number; tx:number; ty:number; dur:number; color:string }
interface Props { onBack:()=>void }

const CIRCUMF = 2 * Math.PI * 70; // r=70

export default function NuclearDestroyPage({ onBack }: Props) {
  const [phase, setPhase]         = useState<Phase>("idle");
  const [holdPct, setHoldPct]     = useState(0);
  const [isHolding, setIsHolding] = useState(false);
  const [countdown, setCd]        = useState(5);
  const [particles, setParticles] = useState<Particle[]>([]);
  const [showFlash, setFlash]     = useState(false);

  const holdStart    = useRef<number|null>(null);
  const holdRaf      = useRef<number|null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval>|null>(null);

  // ── Hold loop ─────────────────────────────────────────────────────────────
  const tick = useCallback(() => {
    if (!holdStart.current) return;
    const pct = Math.min((Date.now() - holdStart.current) / HOLD_MS * 100, 100);
    setHoldPct(pct);
    if (pct < 100) { holdRaf.current = requestAnimationFrame(tick); }
    else { stopHold(); startCountdown(); }
  }, []);

  function startHold() {
    if (phase !== "idle") return;
    holdStart.current = Date.now();
    setIsHolding(true);
    holdRaf.current = requestAnimationFrame(tick);
  }

  function stopHold() {
    holdStart.current = null;
    setIsHolding(false);
    setHoldPct(0);
    if (holdRaf.current) { cancelAnimationFrame(holdRaf.current); holdRaf.current = null; }
  }

  function startCountdown() {
    setPhase("countdown");
    setCd(5);
  }

  // ── Countdown ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (phase !== "countdown") { countdownRef.current && clearInterval(countdownRef.current); return; }
    setCd(5);
    countdownRef.current = setInterval(() => {
      setCd(n => { if (n <= 1) { clearInterval(countdownRef.current!); boom(); return 0; } return n-1; });
    }, 1000);
    return () => { countdownRef.current && clearInterval(countdownRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  async function boom() {
    setPhase("exploding");
    setFlash(true);
    const cx = window.innerWidth/2, cy = window.innerHeight/2;
    const cols = ["#ff2200","#ff6600","#ffaa00","#ff0000","#ffffff","#ffdd00"];
    setParticles(Array.from({length:40},(_,i)=>{
      const a=(i/40)*Math.PI*2, d=120+Math.random()*280;
      return {id:i,x:cx,y:cy,tx:Math.cos(a)*d,ty:Math.sin(a)*d,dur:600+Math.random()*900,color:cols[i%cols.length]};
    }));
    setTimeout(()=>setFlash(false),1400);
    try { await apiDestroyAccountDirect(); } catch {}
    setTimeout(()=>setPhase("destroyed"),2200);
    setTimeout(()=>{ clearAuth(); window.dispatchEvent(new Event("auth:expired")); },5500);
  }

  function cancel() {
    countdownRef.current && clearInterval(countdownRef.current);
    setPhase("idle"); setCd(5);
  }

  const dashOffset = CIRCUMF * (1 - holdPct/100);
  const secsLeft   = isHolding && holdStart.current
    ? Math.max(0, Math.ceil((HOLD_MS - (Date.now() - holdStart.current))/1000))
    : 5;
  const nowStr = new Date().toISOString().replace("T"," ").substring(0,19)+" UTC";

  return (
    <>
      <style dangerouslySetInnerHTML={{__html:STYLES}} />

      {showFlash && <div className="nk-flash" />}
      {particles.map(p=>(
        <div key={p.id} className="nk-particle" style={{
          left:p.x,top:p.y,background:p.color,
          "--tx":`${p.tx}px`,"--ty":`${p.ty}px`,"--dur":`${p.dur}ms`,
        } as React.CSSProperties} />
      ))}
      {phase==="destroyed" && (
        <div className="nk-destroyed">
          <div className="nk-d-skull">💀</div>
          <div className="nk-d-title">ACCOUNT ELIMINATO</div>
          <div className="nk-d-line" />
          <div className="nk-d-sub">Tutti i dati sono stati distrutti definitivamente.<br/>Nessun recupero è possibile.</div>
          <div className="nk-d-time">{nowStr}</div>
        </div>
      )}

      <div className={`nk${phase==="countdown"?" shaking":""}`}>

        {/* Header */}
        <div className="nk-hdr">
          <button className="nk-hdr-back" onClick={onBack}>‹</button>
          <div className="nk-hdr-badge">⚠ TOP SECRET</div>
          <div className="nk-hdr-title">PROTOCOLLO NUCLEARE</div>
          <div className="nk-hdr-dot" />
        </div>

        {/* Banner */}
        <div className="nk-banner">
          <span className="nk-banner-inner">
            ⚠ OPERAZIONE IRREVERSIBILE — TUTTI I DATI VERRANNO ELIMINATI DEFINITIVAMENTE — NESSUN RECUPERO POSSIBILE
            &nbsp;&nbsp;&nbsp;&nbsp;
            ⚠ OPERAZIONE IRREVERSIBILE — TUTTI I DATI VERRANNO ELIMINATI DEFINITIVAMENTE — NESSUN RECUPERO POSSIBILE
          </span>
        </div>

        {/* Body */}
        <div className="nk-body">
          {phase==="countdown" ? (
            <>
              <div style={{flex:1}} />
              <div className="nk-cntdwn-num">{countdown}</div>
              <div className="nk-cntdwn-lbl">DETONAZIONE IN CORSO</div>
              <div style={{flex:1}} />
              <button className="nk-cancel" onClick={cancel}>✕ ANNULLA</button>
            </>
          ) : phase==="exploding" ? (
            <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",fontSize:80}}>💥</div>
          ) : phase!=="destroyed" ? (
            <>
              {/* Warning */}
              <div className="nk-warn">
                <div className="nk-warn-ttl">⚠ PUNTO DI NON RITORNO</div>
                <div className="nk-warn-body">
                  Questa procedura distruggerà <strong>permanentemente</strong> l'account,
                  tutti i messaggi, le chiavi crittografiche e ogni dato associato.<br/><br/>
                  <strong>L'operazione è irreversibile.</strong>
                </div>
              </div>

              {/* Industrial panel */}
              <div className="nk-panel">
                {/* Danger labels */}
                <div className="nk-panel-labels">
                  <div className="nk-danger-label">
                    <span>☢️</span>
                    <span>DANGER</span>
                  </div>
                  <div className="nk-panel-center">
                    <div className="nk-panel-label">
                      <strong>Tieni premuto 5 secondi</strong><br/>
                      <span style={{color:"#666",fontSize:12}}>Rilascia per annullare</span>
                    </div>
                  </div>
                  <div className="nk-danger-label">
                    <span>☢️</span>
                    <span>DANGER</span>
                  </div>
                </div>

                {/* Button + ring */}
                <div className="nk-btn-wrap">
                  <svg className="nk-svg" width="160" height="160" viewBox="0 0 160 160">
                    <circle className="nk-ring-track" cx="80" cy="80" r="70"/>
                    <circle
                      className="nk-ring-fill"
                      cx="80" cy="80" r="70"
                      strokeDasharray={CIRCUMF}
                      strokeDashoffset={dashOffset}
                    />
                  </svg>

                  {/* iOS-safe: both touch and mouse events */}
                  <button
                    className={`nk-btn${isHolding?" holding":""}`}
                    onTouchStart={(e)=>{ e.preventDefault(); startHold(); }}
                    onTouchEnd={(e)=>{ e.preventDefault(); stopHold(); }}
                    onTouchCancel={()=>stopHold()}
                    onMouseDown={startHold}
                    onMouseUp={stopHold}
                    onMouseLeave={stopHold}
                    aria-label="Tieni premuto per distruggere l'account"
                  >
                    <div className="nk-btn-label">AVVIA</div>
                    <div className="nk-btn-sub">HOLD TO ARM</div>
                  </button>

                  {isHolding && <div className="nk-counter">{secsLeft}s</div>}
                </div>

                <div className={`nk-status${isHolding?" on":""}`}>
                  {isHolding ? "⚡ SISTEMA IN ARMAMENTO…" : "● IN ATTESA"}
                </div>

                {/* Bottom plate */}
                <div className="nk-plate">
                  <div className="nk-plate-top">▲ LAUNCH PROTOCOL ▲</div>
                  <div className="nk-plate-main">NUCLEAR MODE</div>
                  <div className="nk-plate-sub">— AUTHORIZED PERSONNEL ONLY —</div>
                </div>
              </div>

              <button className="nk-back-link" onClick={onBack}>Annulla — torna indietro</button>
            </>
          ) : null}
        </div>
      </div>
    </>
  );
}
