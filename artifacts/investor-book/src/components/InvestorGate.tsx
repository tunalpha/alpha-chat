/**
 * InvestorGate — Virtual Data Room access control
 *
 * DEVE essere montato DENTRO WouterRouter per poter usare useLocation.
 *
 * Flow:
 *   1. GateCover  — fullscreen dark premium cover + access card
 *   2. DecryptingScreen — cinematic "verifying credentials" animation
 *   3. UnlockAnimation  — lock opening + folder + logo
 *   4. → naviga a /home
 *
 * Sessione in sessionStorage via portalSession.ts
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useLocation } from 'wouter';
import { loadPortalSession, savePortalSession, type PortalSession } from '@/lib/portalSession';
import './investor-gate.css';

// ─────────────────────────────────────────────────────────────────────────────
const API_BASE = '/api/v1/investor';
type GatePhase = 'gate' | 'decrypting' | 'unlocking' | 'granted';

// ─────────────────────────────────────────────────────────────────────────────
// Particle canvas
// ─────────────────────────────────────────────────────────────────────────────

function ParticleCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    let w = canvas.width  = window.innerWidth;
    let h = canvas.height = window.innerHeight;
    const onResize = () => { w = canvas.width = window.innerWidth; h = canvas.height = window.innerHeight; };
    window.addEventListener('resize', onResize);

    interface P { x: number; y: number; vx: number; vy: number; r: number; alpha: number; da: number; }
    const particles: P[] = Array.from({ length: 120 }, () => ({
      x: Math.random() * w, y: Math.random() * h,
      vx: (Math.random() - 0.5) * 0.4, vy: (Math.random() - 0.5) * 0.4,
      r: Math.random() * 1.5 + 0.5, alpha: Math.random() * 0.6 + 0.1, da: (Math.random() - 0.5) * 0.005,
    }));

    let raf: number;
    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      for (const p of particles) {
        p.x += p.vx; p.y += p.vy; p.alpha += p.da;
        if (p.x < 0) p.x = w; if (p.x > w) p.x = 0;
        if (p.y < 0) p.y = h; if (p.y > h) p.y = 0;
        if (p.alpha < 0.05 || p.alpha > 0.75) p.da *= -1;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(139,92,246,${p.alpha})`; ctx.fill();
      }
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx = particles[i].x - particles[j].x, dy = particles[i].y - particles[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 100) {
            ctx.beginPath();
            ctx.strokeStyle = `rgba(139,92,246,${0.12 * (1 - dist / 100)})`;
            ctx.lineWidth = 0.5;
            ctx.moveTo(particles[i].x, particles[i].y); ctx.lineTo(particles[j].x, particles[j].y); ctx.stroke();
          }
        }
      }
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => { window.removeEventListener('resize', onResize); cancelAnimationFrame(raf); };
  }, []);

  return <canvas ref={canvasRef} className="ig-particles" />;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3D Lock SVG
// ─────────────────────────────────────────────────────────────────────────────

function LockIcon({ open = false }: { open?: boolean }) {
  return (
    <svg className={`ig-lock-icon${open ? ' ig-lock-open' : ''}`} viewBox="0 0 64 64" fill="none">
      <defs>
        <linearGradient id="lg1" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#a78bfa"/><stop offset="100%" stopColor="#7c3aed"/>
        </linearGradient>
        <filter id="glow"><feGaussianBlur stdDeviation="2" result="coloredBlur"/>
          <feMerge><feMergeNode in="coloredBlur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
      </defs>
      <path className={`ig-shackle${open ? ' ig-shackle-open' : ''}`}
        d="M20 28 V20 C20 11.2 44 11.2 44 20 V28"
        stroke="url(#lg1)" strokeWidth="5" strokeLinecap="round" fill="none" filter="url(#glow)"/>
      <rect x="14" y="28" width="36" height="26" rx="6" fill="url(#lg1)" filter="url(#glow)"/>
      <circle cx="32" cy="40" r="4" fill="rgba(0,0,0,0.5)"/>
      <rect x="30" y="40" width="4" height="6" rx="2" fill="rgba(0,0,0,0.5)"/>
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Request Access Modal
// ─────────────────────────────────────────────────────────────────────────────

function RequestAccessModal({ onClose }: { onClose: () => void }) {
  const [form, setForm] = useState({ name: '', company: '', email: '', message: '' });
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setError('');
    if (!form.email.trim()) { setError('Email is required'); return; }
    setLoading(true);
    try {
      const r = await fetch(`${API_BASE}/request`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form),
      });
      if (!r.ok) throw new Error();
      setDone(true);
    } catch { setError('Failed to submit. Please try again.'); }
    finally { setLoading(false); }
  };

  return (
    <div className="ig-modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="ig-modal">
        <button className="ig-modal-close" onClick={onClose}>✕</button>
        {done ? (
          <div className="ig-request-done">
            <div className="ig-request-done-icon">✓</div>
            <h3>Request Received</h3>
            <p>Your request has been received.</p>
            <p>Our investment team will review your request.</p>
            <p>If approved, you will receive an access code via email.</p>
            <button className="ig-btn-primary" onClick={onClose}>Close</button>
          </div>
        ) : (
          <>
            <div className="ig-modal-header">
              <span className="ig-modal-icon">📋</span>
              <h3>Request Access Code</h3>
              <p>Fill in your details to request access to the Investor Data Room.</p>
            </div>
            <form className="ig-form" onSubmit={submit}>
              <div className="ig-field"><label>Full Name</label>
                <input type="text" placeholder="John Smith" value={form.name}
                  onChange={e => setForm(f => ({...f, name: e.target.value}))} required /></div>
              <div className="ig-field"><label>Company / Organization</label>
                <input type="text" placeholder="Acme Capital Partners" value={form.company}
                  onChange={e => setForm(f => ({...f, company: e.target.value}))} required /></div>
              <div className="ig-field"><label>Email Address <span className="ig-required">*</span></label>
                <input type="email" placeholder="j.smith@acmecapital.com" value={form.email}
                  onChange={e => setForm(f => ({...f, email: e.target.value}))} required /></div>
              <div className="ig-field"><label>Message <span className="ig-optional">(optional)</span></label>
                <textarea placeholder="Brief introduction…" rows={3} value={form.message}
                  onChange={e => setForm(f => ({...f, message: e.target.value}))} /></div>
              {error && <p className="ig-error">{error}</p>}
              <button type="submit" className="ig-btn-primary" disabled={loading}>
                {loading ? 'Submitting…' : 'Submit Request'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin Login Modal
// ─────────────────────────────────────────────────────────────────────────────

function AdminLoginModal({ onClose }: { onClose: () => void }) {
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setError(''); setLoading(true);
    try {
      const r = await fetch('/api/v1/admin/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.message || 'Invalid password');
      if (data.token) localStorage.setItem('alpha_admin_token', data.token);
      window.location.href = '/admin/';
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Authentication failed');
    } finally { setLoading(false); }
  };

  return (
    <div className="ig-modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="ig-modal ig-modal-sm">
        <button className="ig-modal-close" onClick={onClose}>✕</button>
        <div className="ig-modal-header">
          <span className="ig-modal-icon">🛡️</span>
          <h3>Administrator Authentication</h3>
          <p>This area is restricted to authorized administrators only.</p>
        </div>
        <form className="ig-form" onSubmit={submit}>
          <div className="ig-field"><label>Admin Password</label>
            <input type="password" placeholder="••••••••••••" value={password}
              onChange={e => setPassword(e.target.value)} required autoFocus /></div>
          {error && <p className="ig-error">{error}</p>}
          <button type="submit" className="ig-btn-primary" disabled={loading}>
            {loading ? 'Authenticating…' : 'Login'}
          </button>
        </form>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Decrypting Screen
// ─────────────────────────────────────────────────────────────────────────────

const DECRYPT_STEPS = [
  '🔒 Decrypting secure archive…',
  'Checking authorization…',
  'Verifying credentials…',
  'Establishing encrypted session…',
  'Access granted.',
];

function DecryptingScreen({ onComplete }: { onComplete: () => void }) {
  const [step, setStep]             = useState(0);
  const [progress, setProgress]     = useState(0);
  const [visibleSteps, setVisible]  = useState<string[]>([]);

  useEffect(() => {
    const totalMs = 2800, stepMs = totalMs / DECRYPT_STEPS.length;
    let elapsed = 0;
    const pInterval = setInterval(() => { elapsed += 40; setProgress(Math.min((elapsed / totalMs) * 100, 100)); }, 40);
    const stepTimers = DECRYPT_STEPS.map((s, i) =>
      setTimeout(() => { setStep(i); setVisible(prev => [...prev, s]); }, i * stepMs)
    );
    const done = setTimeout(() => { clearInterval(pInterval); onComplete(); }, totalMs + 600);
    return () => { clearInterval(pInterval); stepTimers.forEach(clearTimeout); clearTimeout(done); };
  }, [onComplete]);

  return (
    <div className="ig-decrypt">
      <ParticleCanvas />
      <div className="ig-decrypt-inner">
        <LockIcon />
        <div className="ig-decrypt-steps">
          {visibleSteps.map((s, i) => (
            <p key={i} className={`ig-decrypt-step${i === step ? ' ig-step-active' : ' ig-step-done'}`}>
              {i < step ? <span className="ig-step-check">✓</span> : <span className="ig-step-dot" />}
              {s}
            </p>
          ))}
        </div>
        <div className="ig-progress-bar">
          <div className="ig-progress-fill" style={{ width: `${progress}%` }} />
        </div>
        <p className="ig-decrypt-sub">Quantum-grade encryption · Zero-knowledge protocol</p>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Unlock Animation
// ─────────────────────────────────────────────────────────────────────────────

function UnlockAnimation({ investorName, onComplete }: { investorName: string; onComplete: () => void }) {
  useEffect(() => { const t = setTimeout(onComplete, 2400); return () => clearTimeout(t); }, [onComplete]);
  return (
    <div className="ig-unlock">
      <ParticleCanvas />
      <div className="ig-unlock-inner">
        <div className="ig-unlock-glow" />
        <LockIcon open />
        <div className="ig-unlock-logo">
          <img
            src={`${import.meta.env.BASE_URL}alphachat-logo.png`}
            alt="AlphaChat"
            style={{ height: 36, width: 'auto', objectFit: 'contain' }}
          />
        </div>
        <p className="ig-unlock-name">Welcome, {investorName}</p>
        <p className="ig-unlock-sub">Access Granted · Investor Portal</p>
        <div className="ig-unlock-badge"><span>🔒</span> END-TO-END ENCRYPTED SESSION</div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Gate Cover
// ─────────────────────────────────────────────────────────────────────────────

const BADGES = ['TOP SECRET', 'STRICTLY CONFIDENTIAL', 'PRIVATE INVESTOR DOCUMENTS'];

function GateCover({ onVerified }: { onVerified: (name: string, expiry: string) => void }) {
  const [code, setCode]           = useState('');
  const [email, setEmail]         = useState('');
  const [error, setError]         = useState('');
  const [loading, setLoading]     = useState(false);
  const [showRequest, setShowRequest] = useState(false);
  const [showAdmin, setShowAdmin]     = useState(false);
  const [badgePulse, setBadgePulse]   = useState(0);

  useEffect(() => { const t = setInterval(() => setBadgePulse(p => (p + 1) % BADGES.length), 3000); return () => clearInterval(t); }, []);

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim()) { setError('Please enter an access code.'); return; }
    setError(''); setLoading(true);
    try {
      const r = await fetch(`${API_BASE}/verify`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code.trim(), email: email.trim() || undefined }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.message || data.error || 'Invalid access code');
      onVerified(data.investorName || 'Investor', data.sessionExpiry);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Invalid access code. Please verify and try again.');
    } finally { setLoading(false); }
  };

  return (
    <div className="ig-gate">
      <ParticleCanvas />
      <div className="ig-orb ig-orb-1" /><div className="ig-orb ig-orb-2" /><div className="ig-orb ig-orb-3" />

      <header className="ig-topbar">
        <div className="ig-topbar-logo">
          <img
            src={`${import.meta.env.BASE_URL}alphachat-logo.png`}
            alt="AlphaChat"
            style={{ height: 28, width: 'auto', objectFit: 'contain' }}
          />
        </div>
        <div className="ig-topbar-badge"><span className="ig-badge-dot" />SECURE CONNECTION</div>
      </header>

      <main className="ig-center">
        <div className="ig-hero">
          <LockIcon />
          <div className="ig-confidential-badge">
            <span className="ig-badge-pulse">{BADGES[badgePulse]}</span>
          </div>
          <h1 className="ig-title">INVESTOR SECURE ACCESS</h1>
          <p className="ig-subtitle">Confidential documents reserved exclusively for authorized investors.</p>
          <div className="ig-texture-tag">
            <span>VIRTUAL DATA ROOM</span><span className="ig-sep">·</span>
            <span>INSTITUTIONAL GRADE</span><span className="ig-sep">·</span>
            <span>256-BIT ENCRYPTED</span>
          </div>
        </div>

        <div className="ig-card">
          <div className="ig-card-corner ig-card-corner-tl" /><div className="ig-card-corner ig-card-corner-tr" />
          <div className="ig-card-corner ig-card-corner-bl" /><div className="ig-card-corner ig-card-corner-br" />
          <div className="ig-card-header">
            <span className="ig-card-icon">🔐</span>
            <h2>Access Reserved</h2>
            <p>Enter your investor access code to access the portal.</p>
          </div>
          <form className="ig-form" onSubmit={handleUnlock}>
            <div className="ig-field"><label>Access Code</label>
              <input type="text" placeholder="XXXX-XXXX-XXXX" value={code}
                onChange={e => setCode(e.target.value.toUpperCase())}
                className="ig-code-input" autoComplete="off" spellCheck={false} /></div>
            <div className="ig-field"><label>Email <span className="ig-optional">(optional)</span></label>
              <input type="email" placeholder="your@email.com" value={email}
                onChange={e => setEmail(e.target.value)} /></div>
            {error && <p className="ig-error">⚠ {error}</p>}
            <button type="submit" className="ig-btn-primary ig-btn-unlock" disabled={loading}>
              {loading ? <><span className="ig-spinner" /> Verifying…</> : <>🔓 Unlock Investor Portal</>}
            </button>
          </form>
          <div className="ig-divider"><span>OR</span></div>
          <button className="ig-btn-secondary" onClick={() => setShowRequest(true)}>📩 Request Access Code</button>
          <div className="ig-admin-link-wrap">
            <button className="ig-admin-link" onClick={() => setShowAdmin(true)}>Administrator Access</button>
          </div>
        </div>

        <div className="ig-trust">
          <span>🔒 End-to-end encrypted</span><span className="ig-sep">·</span>
          <span>📋 All access logged</span><span className="ig-sep">·</span>
          <span>🛡️ NDA protected</span>
        </div>
      </main>

      <footer className="ig-footer">
        <span>© 2025 AlphaChat. All rights reserved.</span>
        <span className="ig-sep">·</span>
        <span>Unauthorized access is strictly prohibited.</span>
      </footer>

      {showRequest && <RequestAccessModal onClose={() => setShowRequest(false)} />}
      {showAdmin   && <AdminLoginModal   onClose={() => setShowAdmin(false)} />}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Export
// ─────────────────────────────────────────────────────────────────────────────

interface InvestorGateProps { children: React.ReactNode; }

export default function InvestorGate({ children }: InvestorGateProps) {
  const [, setLocation] = useLocation();

  const [phase, setPhase] = useState<GatePhase>(() => {
    const s = loadPortalSession();
    return s ? 'granted' : 'gate';
  });
  const [investorName, setInvestorName] = useState(() => loadPortalSession()?.investorName ?? '');

  // Controlla se il gate è abilitato. Se disabilitato dall'admin, entra direttamente.
  useEffect(() => {
    fetch(`${API_BASE}/settings`)
      .then(r => r.json())
      .then((d: { gateEnabled?: boolean }) => {
        if (d.gateEnabled === false) {
          // Gate OFF → accesso diretto senza codice
          const session = loadPortalSession();
          if (!session) {
            savePortalSession({
              investorName: 'Guest',
              sessionExpiry: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
              grantedAt: Date.now(),
            });
          }
          setPhase('granted');
        }
      })
      .catch(() => {}); // fallback: gate rimane attivo
  }, []);

  const handleVerified = useCallback((name: string, expiry: string) => {
    setInvestorName(name);
    savePortalSession({ investorName: name, sessionExpiry: expiry, grantedAt: Date.now() });
    setPhase('decrypting');
  }, []);

  const handleDecryptDone = useCallback(() => setPhase('unlocking'), []);

  const handleUnlockDone = useCallback(() => {
    setPhase('granted');
    setLocation('/home');
  }, [setLocation]);

  if (phase === 'granted')    return <>{children}</>;
  if (phase === 'decrypting') return <DecryptingScreen onComplete={handleDecryptDone} />;
  if (phase === 'unlocking')  return <UnlockAnimation investorName={investorName} onComplete={handleUnlockDone} />;
  return <GateCover onVerified={handleVerified} />;
}
