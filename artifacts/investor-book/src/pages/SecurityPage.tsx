import React from 'react';
import PortalLayout from '@/components/PortalLayout';
import { loadPortalSession } from '@/lib/portalSession';
import '@/components/portal-layout.css';

export default function SecurityPage() {
  const session = loadPortalSession();

  const layers = [
    {
      icon: '🔑', title: 'Signal Protocol',
      points: [
        'Double Ratchet algorithm — forward secrecy on every message',
        'X3DH key agreement — asynchronous session init without server mediation',
        'OTPK one-time prekeys — exhaustion auto-replenishment',
        'Identity key verification with Safety Numbers and QR scan',
      ],
    },
    {
      icon: '🛡️', title: 'Phoenix Protocol',
      points: [
        'Emergency account lock/destroy triggered by argon2id-protected code',
        'Requires email confirmation token (15-min expiry)',
        'Dead Man Switch — automated destruction if no check-in within set interval',
        'Recovery Card — offline backup generated at registration',
      ],
    },
    {
      icon: '📱', title: 'Device & Session',
      points: [
        'Multi-device key fan-out — messages encrypted per device',
        'Biometric-only mode (Face ID / Fingerprint) — no PIN fallback',
        'Session revocation propagated via WebSocket to all devices',
        'JTI blocklist on Redis for instant token invalidation',
      ],
    },
    {
      icon: '🌐', title: 'Infrastructure',
      points: [
        'E2E encrypted media on Cloudflare R2 — server never sees plaintext',
        'AES-256-GCM for blob encryption, key wrapped via Signal',
        'VAPID web push — payload encrypted per RFC 8291',
        'All access logged with IP, userAgent and outcome',
      ],
    },
  ];

  return (
    <PortalLayout investorName={session?.investorName} sessionExpiry={session?.sessionExpiry}>
      <div className="portal-page-header">
        <p className="portal-page-eyebrow">Security Architecture</p>
        <h1 className="portal-page-title">Zero Trust. Zero Knowledge.</h1>
        <p className="portal-page-sub">
          AlphaChat operates on the principle that the server should never be trusted.
          All sensitive data is encrypted client-side before it ever leaves the device.
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 20, marginBottom: 48 }}>
        {layers.map(l => (
          <div key={l.title} className="portal-card">
            <span className="portal-card-icon">{l.icon}</span>
            <h3 className="portal-card-title">{l.title}</h3>
            <ul style={{ margin: 0, padding: '0 0 0 16px' }}>
              {l.points.map(p => (
                <li key={p} style={{ fontSize: 13, color: 'rgba(232,232,240,0.55)', lineHeight: 1.7, marginBottom: 4 }}>{p}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="portal-section-divider" />

      <div className="portal-stat-grid" style={{ marginBottom: 40 }}>
        {[
          { v: 'AES-256', l: 'Encryption standard' },
          { v: 'Argon2id', l: 'Password hashing' },
          { v: 'X25519', l: 'Key exchange' },
          { v: 'ES256', l: 'JWT signing' },
          { v: '0', l: 'Plaintext on server' },
          { v: '100%', l: 'Open protocols' },
        ].map(s => (
          <div key={s.l} className="portal-stat">
            <span className="portal-stat-value">{s.v}</span>
            <span className="portal-stat-label">{s.l}</span>
          </div>
        ))}
      </div>

      <div style={{ background: 'rgba(16,185,129,0.05)', border: '1px solid rgba(16,185,129,0.2)', borderRadius: 16, padding: '20px 24px' }}>
        <p style={{ fontSize: 13, color: 'rgba(232,232,240,0.5)', lineHeight: 1.7, margin: 0 }}>
          🔒 AlphaChat's security model has been designed to withstand nation-state level adversaries.
          The founding team includes engineers with backgrounds in cryptography, infosec, and privacy compliance.
        </p>
      </div>
    </PortalLayout>
  );
}
