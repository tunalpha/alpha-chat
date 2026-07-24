import React from 'react';
import PortalLayout from '@/components/PortalLayout';
import { loadPortalSession } from '@/lib/portalSession';
import { en } from '@/content/en';
import '@/components/portal-layout.css';

export default function TechnologyPage() {
  const session = loadPortalSession();
  const c = en;

  const pillars = [
    { icon: '🔐', title: 'Signal Protocol E2E', body: c.architecture?.items?.[0] ?? 'Double Ratchet + X3DH key exchange — every message encrypted with ephemeral keys. Zero server knowledge.', tag: 'Cryptography' },
    { icon: '💳', title: 'USDA Payment Layer', body: 'Native stablecoin payments embedded in conversations. Escrow-based P2P transfers with on-chain verification on Polygon.', tag: 'Blockchain' },
    { icon: '📞', title: 'WebRTC Secure Calls', body: 'E2E encrypted audio/video calls. TURN/STUN with ICE restart, quality monitoring (RTT, jitter, packet loss), call log and history.', tag: 'Real-time' },
    { icon: '📱', title: 'React Native Mobile', body: 'Single codebase for iOS and Android via Expo. Biometric lock (Face ID / Fingerprint), push notifications, PWA support.', tag: 'Cross-platform' },
    { icon: '☁️', title: 'Cloudflare R2 Storage', body: 'E2E encrypted media files stored in R2. Signed URLs, multipart upload, automatic cleanup. Zero egress costs.', tag: 'Infrastructure' },
    { icon: '🛡️', title: 'Phoenix Protocol', body: 'Emergency account protection: argon2id-protected destruction trigger, Dead Man Switch, Recovery Card, multi-device key sync.', tag: 'Security' },
  ];

  const stack = [
    { layer: 'Frontend',    tech: 'React Native (Expo) · React (Vite) · TypeScript' },
    { layer: 'Backend',     tech: 'Node.js · Express · TypeScript · MongoDB (Mongoose)' },
    { layer: 'Crypto',      tech: 'Signal Protocol · AES-256-GCM · Argon2id · X25519' },
    { layer: 'Blockchain',  tech: 'Polygon · Viem · ThirdWeb v5 · ERC-20 (USDA)' },
    { layer: 'Infra',       tech: 'Cloudflare R2 · Nodemailer SMTP · WebRTC · VAPID Push' },
    { layer: 'Auth',        tech: 'JWT ES256 · Session tokens · Biometrics · PKCE' },
  ];

  return (
    <PortalLayout investorName={session?.investorName} sessionExpiry={session?.sessionExpiry}>
      <div className="portal-page-header">
        <p className="portal-page-eyebrow">Technology</p>
        <h1 className="portal-page-title">Built for the Paranoid</h1>
        <p className="portal-page-sub">
          Every component of AlphaChat is designed with adversarial thinking.
          Military-grade cryptography, zero server knowledge, and open protocols.
        </p>
      </div>

      <div className="portal-card-grid" style={{ marginBottom: 48 }}>
        {pillars.map(p => (
          <div key={p.title} className="portal-card">
            <span className="portal-card-icon">{p.icon}</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <h3 className="portal-card-title" style={{ margin: 0 }}>{p.title}</h3>
              <span className="portal-tag portal-tag-blue" style={{ fontSize: 10 }}>{p.tag}</span>
            </div>
            <p className="portal-card-body">{p.body}</p>
          </div>
        ))}
      </div>

      <div className="portal-section-divider" />

      <h2 style={{ fontSize: 20, fontWeight: 700, color: '#fff', marginBottom: 16 }}>Tech Stack</h2>
      <div style={{ background: 'rgba(10,8,25,0.7)', border: '1px solid rgba(139,92,246,0.18)', borderRadius: 16, overflow: 'hidden', marginBottom: 40 }}>
        {stack.map((s, i) => (
          <div key={s.layer} style={{
            display: 'flex', gap: 24, padding: '14px 24px',
            borderBottom: i < stack.length - 1 ? '1px solid rgba(139,92,246,0.1)' : 'none',
            flexWrap: 'wrap',
          }}>
            <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: 1, color: 'rgba(139,92,246,0.8)', minWidth: 90, textTransform: 'uppercase' }}>{s.layer}</span>
            <span style={{ fontSize: 13, color: 'rgba(232,232,240,0.65)', fontFamily: 'monospace' }}>{s.tech}</span>
          </div>
        ))}
      </div>

      <div style={{ background: 'rgba(139,92,246,0.06)', border: '1px solid rgba(139,92,246,0.2)', borderRadius: 16, padding: '24px 28px' }}>
        <p style={{ fontSize: 13, color: 'rgba(232,232,240,0.5)', lineHeight: 1.7, margin: 0 }}>
          💡 For a complete technical deep-dive including sequence diagrams, key derivation details and protocol specifics,
          see the <a href="../book/en" style={{ color: '#a78bfa' }}>Investor Book → Architecture section</a>.
        </p>
      </div>
    </PortalLayout>
  );
}
