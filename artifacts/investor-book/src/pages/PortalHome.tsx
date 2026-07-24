/**
 * PortalHome — dashboard principale dopo il login.
 * Stile VDR premium: session info, documento disponibili, quick-access cards.
 */
import React from 'react';
import { Link } from 'wouter';
import PortalLayout from '@/components/PortalLayout';
import { loadPortalSession } from '@/lib/portalSession';
import '@/components/portal-layout.css';

const SECTIONS = [
  {
    href: '/book/en',
    icon: '📄',
    title: 'Investor Book',
    body: 'Complete overview of AlphaChat — vision, product, financials, market and team. Available in EN and IT.',
    tag: 'Core Document',
    tagColor: 'portal-tag-purple',
    updated: 'Jul 2025',
    pages: '48 pages',
  },
  {
    href: '/technology',
    icon: '⚡',
    title: 'Technology',
    body: 'E2E encryption (Signal Protocol), USDA payment layer, WebRTC calls, React Native mobile — a full deep-dive.',
    tag: 'Technical',
    tagColor: 'portal-tag-blue',
    updated: 'Jul 2025',
  },
  {
    href: '/security',
    icon: '🔒',
    title: 'Security Architecture',
    body: 'Zero-knowledge design, Phoenix Protocol, biometric lock, multi-device key management and audit trail.',
    tag: 'Confidential',
    tagColor: 'portal-tag-purple',
    updated: 'Jul 2025',
  },
  {
    href: '/roadmap',
    icon: '🗺',
    title: 'Product Roadmap',
    body: 'Phased execution plan from MVP to global expansion. 12-month milestones, delivery targets and KPIs.',
    tag: 'Strategic',
    tagColor: 'portal-tag-green',
    updated: 'Jul 2025',
  },
  {
    href: '/market',
    icon: '📈',
    title: 'Market Opportunity',
    body: 'TAM, SAM, SOM analysis. Competitive landscape. Why privacy-first messaging is a $50B+ opportunity.',
    tag: 'Market Data',
    tagColor: 'portal-tag-blue',
    updated: 'Jul 2025',
  },
  {
    href: '/team',
    icon: '👥',
    title: 'Team & Vision',
    body: 'The founder story, the team, the thesis. Built by engineers who experienced firsthand why privacy matters.',
    tag: 'Leadership',
    tagColor: 'portal-tag-green',
    updated: 'Jul 2025',
  },
  {
    href: '/contact',
    icon: '✉',
    title: 'Contact & Next Steps',
    body: 'Schedule a call, request financial models, or initiate due diligence. Direct line to the founding team.',
    tag: 'Action',
    tagColor: 'portal-tag-purple',
    updated: 'Always open',
  },
];

export default function PortalHome() {
  const session = loadPortalSession();
  const now = new Date();
  const lastLogin = now.toLocaleString('en-GB', { dateStyle: 'long', timeStyle: 'short' });

  return (
    <PortalLayout investorName={session?.investorName} sessionExpiry={session?.sessionExpiry}>
      {/* Welcome header */}
      <div className="ph-hero">
        <div className="ph-hero-left">
          <p className="ph-eyebrow">INVESTOR PORTAL · RESTRICTED ACCESS</p>
          <h1 className="ph-title">
            Welcome{session?.investorName ? `, ${session.investorName.split(' ')[0]}` : ''}
          </h1>
          <p className="ph-sub">
            You have secure access to AlphaChat's confidential investor materials.
            All access is logged and monitored.
          </p>
          <div className="ph-meta">
            <div className="ph-meta-item">
              <span className="ph-meta-dot" style={{ background: '#6ee7b7' }} />
              <span><strong style={{ color: '#6ee7b7' }}>Secure Session Active</strong></span>
            </div>
            <div className="ph-meta-item">
              <span className="ph-meta-label">Last login</span>
              <span className="ph-meta-value">{lastLogin}</span>
            </div>
            <div className="ph-meta-item">
              <span className="ph-meta-label">Session expires</span>
              <span className="ph-meta-value">
                {session?.sessionExpiry
                  ? new Date(session.sessionExpiry).getFullYear() > 2090
                    ? 'No expiry'
                    : new Date(session.sessionExpiry).toLocaleDateString('en-GB', { dateStyle: 'medium' })
                  : '—'}
              </span>
            </div>
          </div>
        </div>
        <div className="ph-hero-right">
          <div className="ph-shield">
            <span className="ph-shield-icon">🔐</span>
            <div className="ph-shield-lines">
              <div className="ph-shield-line"><span>Encryption</span><span className="ph-ok">AES-256 ✓</span></div>
              <div className="ph-shield-line"><span>Protocol</span><span className="ph-ok">Signal ✓</span></div>
              <div className="ph-shield-line"><span>Session</span><span className="ph-ok">Active ✓</span></div>
              <div className="ph-shield-line"><span>Monitoring</span><span className="ph-ok">On ✓</span></div>
            </div>
          </div>
        </div>
      </div>

      {/* Quick stats */}
      <div className="ph-stats">
        <div className="ph-stat">
          <span className="ph-stat-value">7</span>
          <span className="ph-stat-label">Documents Available</span>
        </div>
        <div className="ph-stat">
          <span className="ph-stat-value">2</span>
          <span className="ph-stat-label">Languages</span>
        </div>
        <div className="ph-stat">
          <span className="ph-stat-value">Jul 2025</span>
          <span className="ph-stat-label">Last Updated</span>
        </div>
        <div className="ph-stat">
          <span className="ph-stat-value">NDA</span>
          <span className="ph-stat-label">Protected</span>
        </div>
      </div>

      {/* Section divider */}
      <div className="portal-section-divider" />

      <h2 className="ph-section-title">Available Documents</h2>

      {/* Document cards */}
      <div className="ph-cards">
        {SECTIONS.map(s => (
          <Link key={s.href} href={s.href} className="ph-card">
            <div className="ph-card-top">
              <span className="ph-card-icon">{s.icon}</span>
              <span className={`portal-tag ${s.tagColor}`}>{s.tag}</span>
            </div>
            <h3 className="ph-card-title">{s.title}</h3>
            <p className="ph-card-body">{s.body}</p>
            <div className="ph-card-footer">
              <span className="ph-card-updated">Updated: {s.updated}</span>
              {s.pages && <span className="ph-card-pages">{s.pages}</span>}
              <span className="ph-card-arrow">→</span>
            </div>
          </Link>
        ))}
      </div>

      {/* Notice */}
      <div className="ph-notice">
        <span>⚠</span>
        <p>
          These documents are strictly confidential and subject to NDA. By accessing this portal you agree not to
          disclose, reproduce or distribute any information contained herein without prior written consent from AlphaChat.
        </p>
      </div>

      <style>{`
        .ph-hero {
          display: flex;
          gap: 40px;
          align-items: flex-start;
          margin-bottom: 32px;
          flex-wrap: wrap;
        }
        .ph-hero-left { flex: 1; min-width: 280px; }
        .ph-eyebrow {
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 3px;
          color: rgba(139,92,246,0.6);
          margin-bottom: 12px;
        }
        .ph-title {
          font-size: clamp(30px, 4vw, 52px);
          font-weight: 800;
          background: linear-gradient(135deg, #fff 0%, #a78bfa 60%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
          line-height: 1.1;
          margin: 0 0 14px;
        }
        .ph-sub {
          font-size: 15px;
          color: rgba(232,232,240,0.5);
          line-height: 1.65;
          margin: 0 0 24px;
          max-width: 500px;
        }
        .ph-meta { display: flex; flex-direction: column; gap: 10px; }
        .ph-meta-item {
          display: flex; align-items: center; gap: 10px;
          font-size: 13px; color: rgba(232,232,240,0.55);
        }
        .ph-meta-dot {
          width: 7px; height: 7px; border-radius: 50%;
          box-shadow: 0 0 8px currentColor;
          animation: portal-pulse 2s infinite;
        }
        .ph-meta-label { color: rgba(232,232,240,0.35); font-size: 12px; min-width: 90px; }
        .ph-meta-value { color: rgba(232,232,240,0.7); font-size: 12px; }

        .ph-hero-right { flex-shrink: 0; }
        .ph-shield {
          background: rgba(139,92,246,0.06);
          border: 1px solid rgba(139,92,246,0.2);
          border-radius: 16px;
          padding: 24px;
          min-width: 220px;
        }
        .ph-shield-icon { font-size: 32px; display: block; margin-bottom: 16px; }
        .ph-shield-lines { display: flex; flex-direction: column; gap: 8px; }
        .ph-shield-line {
          display: flex; justify-content: space-between; align-items: center;
          font-size: 13px; color: rgba(232,232,240,0.5);
          padding-bottom: 8px;
          border-bottom: 1px solid rgba(139,92,246,0.1);
        }
        .ph-shield-line:last-child { border-bottom: none; padding-bottom: 0; }
        .ph-ok { color: #6ee7b7; font-weight: 600; font-size: 12px; }

        .ph-stats {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
          gap: 16px;
          margin-bottom: 32px;
        }
        .ph-stat {
          background: rgba(139,92,246,0.06);
          border: 1px solid rgba(139,92,246,0.15);
          border-radius: 12px;
          padding: 20px 16px;
          text-align: center;
        }
        .ph-stat-value {
          font-size: 24px; font-weight: 800; color: #a78bfa;
          display: block; line-height: 1;
        }
        .ph-stat-label {
          font-size: 10px; font-weight: 600; letter-spacing: 1px;
          color: rgba(232,232,240,0.35); text-transform: uppercase;
          margin-top: 6px; display: block;
        }

        .ph-section-title {
          font-size: 20px; font-weight: 700; color: #fff;
          margin: 0 0 20px;
        }

        .ph-cards {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
          gap: 18px;
          margin-bottom: 40px;
        }
        .ph-card {
          background: rgba(10,8,25,0.7);
          border: 1px solid rgba(139,92,246,0.18);
          border-radius: 16px;
          padding: 24px;
          text-decoration: none;
          display: block;
          transition: border-color 0.2s, transform 0.2s, background 0.2s;
          cursor: pointer;
        }
        .ph-card:hover {
          border-color: rgba(139,92,246,0.45);
          transform: translateY(-3px);
          background: rgba(20,12,40,0.9);
        }
        .ph-card-top {
          display: flex; align-items: center; justify-content: space-between;
          margin-bottom: 14px;
        }
        .ph-card-icon { font-size: 26px; }
        .ph-card-title {
          font-size: 16px; font-weight: 700; color: #fff;
          margin: 0 0 8px;
        }
        .ph-card-body {
          font-size: 13px; color: rgba(232,232,240,0.5);
          line-height: 1.6; margin: 0 0 16px;
        }
        .ph-card-footer {
          display: flex; align-items: center; gap: 10px;
          padding-top: 14px;
          border-top: 1px solid rgba(139,92,246,0.1);
          font-size: 11px;
        }
        .ph-card-updated { color: rgba(232,232,240,0.3); }
        .ph-card-pages { color: rgba(139,92,246,0.5); margin-left: auto; }
        .ph-card-arrow { color: #a78bfa; font-size: 14px; margin-left: auto; }

        .ph-notice {
          display: flex; gap: 12px; align-items: flex-start;
          background: rgba(239,68,68,0.05);
          border: 1px solid rgba(239,68,68,0.15);
          border-radius: 12px;
          padding: 16px 20px;
        }
        .ph-notice span { color: #f87171; font-size: 16px; flex-shrink: 0; margin-top: 1px; }
        .ph-notice p {
          font-size: 12px; color: rgba(232,232,240,0.4);
          line-height: 1.6; margin: 0;
        }
      `}</style>
    </PortalLayout>
  );
}
