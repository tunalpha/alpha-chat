import React from 'react';
import { Link } from 'wouter';
import PortalLayout from '@/components/PortalLayout';
import { loadPortalSession } from '@/lib/portalSession';
import { useLang } from '@/context/LanguageContext';
import { home as T } from '@/lib/i18n';
import '@/components/portal-layout.css';

const HREFS = [
  '/book/en', '/technology', '/security', '/roadmap', '/market', '/team', '/contact',
];
const ICONS = ['📄','⚡','🔒','🗺','📈','👥','✉'];
const TAG_COLORS = [
  'portal-tag-purple','portal-tag-blue','portal-tag-purple',
  'portal-tag-green','portal-tag-blue','portal-tag-green','portal-tag-purple',
];

export default function PortalHome() {
  const session = loadPortalSession();
  const { lang } = useLang();
  const t = T[lang];

  const now = new Date();
  const lastLogin = now.toLocaleString(lang === 'it' ? 'it-IT' : 'en-GB', { dateStyle: 'long', timeStyle: 'short' });

  const expiry = session?.sessionExpiry ? new Date(session.sessionExpiry) : null;
  const expiryStr = expiry
    ? (expiry.getFullYear() > 2090
        ? t.noExpiry
        : expiry.toLocaleDateString(lang === 'it' ? 'it-IT' : 'en-GB', { dateStyle: 'medium' }))
    : '—';

  const bookHref = `/book/${lang}`;

  return (
    <PortalLayout investorName={session?.investorName} sessionExpiry={session?.sessionExpiry}>
      {/* Welcome header */}
      <div className="ph-hero">
        <div className="ph-hero-left">
          <p className="ph-eyebrow">{t.eyebrow}</p>
          <h1 className="ph-title">
            {t.welcome}{session?.investorName ? `, ${session.investorName.split(' ')[0]}` : ''}
          </h1>
          <p className="ph-sub">{t.sub}</p>
          <div className="ph-meta">
            <div className="ph-meta-item">
              <span className="ph-meta-dot" style={{ background: '#6ee7b7' }} />
              <strong style={{ color: '#6ee7b7' }}>{t.sessionActive}</strong>
            </div>
            <div className="ph-meta-item">
              <span className="ph-meta-label">{t.lastLogin}</span>
              <span className="ph-meta-value">{lastLogin}</span>
            </div>
            <div className="ph-meta-item">
              <span className="ph-meta-label">{t.sessionExpires}</span>
              <span className="ph-meta-value">{expiryStr}</span>
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
        <div className="ph-stat"><span className="ph-stat-value">7</span><span className="ph-stat-label">{t.availableDocs}</span></div>
        <div className="ph-stat"><span className="ph-stat-value">2</span><span className="ph-stat-label">{t.languages}</span></div>
        <div className="ph-stat"><span className="ph-stat-value">Jul 2025</span><span className="ph-stat-label">{t.lastUpdated}</span></div>
        <div className="ph-stat"><span className="ph-stat-value" style={{fontSize:16,paddingTop:4}}>Restricted</span><span className="ph-stat-label">{t.ndaProtected}</span></div>
      </div>

      <div className="portal-section-divider" />
      <h2 className="portal-section-h2">{t.docsSection}</h2>

      {/* Document cards */}
      <div className="ph-cards">
        {t.sections.map((s, idx) => (
          <Link key={s.title} href={idx === 0 ? bookHref : HREFS[idx]} className="ph-card">
            <div className="ph-card-top">
              <span className="ph-card-icon">{ICONS[idx]}</span>
              <span className={`portal-tag ${TAG_COLORS[idx]}`}>{s.tag}</span>
            </div>
            <h3 className="ph-card-title">{s.title}</h3>
            <p className="ph-card-body">{s.body}</p>
            <div className="ph-card-footer">
              <span className="ph-card-updated">{lang === 'it' ? 'Aggiornato' : 'Updated'}: {s.updated}</span>
              {'pages' in s && s.pages && <span className="ph-card-pages">{s.pages}</span>}
              <span className="ph-card-arrow">→</span>
            </div>
          </Link>
        ))}
      </div>

      {/* Notice */}
      <div className="ph-notice">
        <span>⚠</span>
        <p>{t.noticeText}</p>
      </div>

      <style>{`
        .ph-hero {
          display: flex; gap: 40px; align-items: flex-start;
          margin-bottom: 32px; flex-wrap: wrap;
        }
        .ph-hero-left { flex: 1; min-width: 280px; }
        .ph-eyebrow {
          font-size: 10px; font-weight: 700; letter-spacing: 3px;
          color: rgba(139,92,246,0.6); margin-bottom: 12px;
        }
        .ph-title {
          font-size: clamp(30px, 4vw, 52px); font-weight: 800;
          background: linear-gradient(135deg, #fff 0%, #a78bfa 60%);
          -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;
          line-height: 1.1; margin: 0 0 14px;
        }
        .ph-sub {
          font-size: 15px; color: rgba(232,232,240,0.5);
          line-height: 1.65; margin: 0 0 24px; max-width: 500px;
        }
        .ph-meta { display: flex; flex-direction: column; gap: 10px; }
        .ph-meta-item { display: flex; align-items: center; gap: 10px; font-size: 13px; color: rgba(232,232,240,0.55); }
        .ph-meta-dot { width: 7px; height: 7px; border-radius: 50%; box-shadow: 0 0 8px currentColor; animation: portal-pulse 2s infinite; }
        .ph-meta-label { color: rgba(232,232,240,0.35); font-size: 12px; min-width: 90px; }
        .ph-meta-value { color: rgba(232,232,240,0.7); font-size: 12px; }

        .ph-hero-right { flex-shrink: 0; }
        .ph-shield {
          background: rgba(139,92,246,0.06); border: 1px solid rgba(139,92,246,0.2);
          border-radius: 16px; padding: 24px; min-width: 220px;
        }
        .ph-shield-icon { font-size: 32px; display: block; margin-bottom: 16px; }
        .ph-shield-lines { display: flex; flex-direction: column; gap: 8px; }
        .ph-shield-line {
          display: flex; justify-content: space-between; align-items: center;
          font-size: 13px; color: rgba(232,232,240,0.5);
          padding-bottom: 8px; border-bottom: 1px solid rgba(139,92,246,0.1);
        }
        .ph-shield-line:last-child { border-bottom: none; padding-bottom: 0; }
        .ph-ok { color: #6ee7b7; font-weight: 600; font-size: 12px; }

        .ph-stats {
          display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
          gap: 16px; margin-bottom: 32px;
        }
        .ph-stat {
          background: rgba(139,92,246,0.06); border: 1px solid rgba(139,92,246,0.15);
          border-radius: 12px; padding: 20px 16px; text-align: center;
        }
        .ph-stat-value { font-size: 24px; font-weight: 800; color: #a78bfa; display: block; line-height: 1; }
        .ph-stat-label { font-size: 10px; font-weight: 600; letter-spacing: 1px; color: rgba(232,232,240,0.35); text-transform: uppercase; margin-top: 6px; display: block; }

        .ph-cards {
          display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
          gap: 18px; margin-bottom: 40px;
        }
        .ph-card {
          background: rgba(10,8,25,0.7); border: 1px solid rgba(139,92,246,0.18);
          border-radius: 16px; padding: 24px; text-decoration: none; display: block;
          transition: border-color 0.2s, transform 0.2s, background 0.2s; cursor: pointer;
        }
        .ph-card:hover { border-color: rgba(139,92,246,0.45); transform: translateY(-3px); background: rgba(20,12,40,0.9); }
        .ph-card-top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }
        .ph-card-icon { font-size: 26px; }
        .ph-card-title { font-size: 16px; font-weight: 700; color: var(--portal-text); margin: 0 0 8px; }
        .ph-card-body { font-size: 13px; color: rgba(232,232,240,0.5); line-height: 1.6; margin: 0 0 16px; }
        .ph-card-footer {
          display: flex; align-items: center; gap: 10px;
          padding-top: 14px; border-top: 1px solid rgba(139,92,246,0.1); font-size: 11px;
        }
        .ph-card-updated { color: rgba(232,232,240,0.3); }
        .ph-card-pages { color: rgba(139,92,246,0.5); margin-left: auto; }
        .ph-card-arrow { color: #a78bfa; font-size: 14px; margin-left: auto; }

        .ph-notice {
          display: flex; gap: 12px; align-items: flex-start;
          background: rgba(239,68,68,0.05); border: 1px solid rgba(239,68,68,0.15);
          border-radius: 12px; padding: 16px 20px;
        }
        .ph-notice span { color: #f87171; font-size: 16px; flex-shrink: 0; margin-top: 1px; }
        .ph-notice p { font-size: 12px; color: rgba(232,232,240,0.4); line-height: 1.6; margin: 0; }

        /* ── Light mode overrides ─────────────────────── */
        .portal-light .ph-title {
          background: linear-gradient(135deg, #1a1830 0%, #7c3aed 55%);
          -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent;
        }
        .portal-light .ph-sub { color: rgba(26,24,48,0.6); }
        .portal-light .ph-meta-item { color: rgba(26,24,48,0.65); }
        .portal-light .ph-meta-label { color: rgba(26,24,48,0.45); }
        .portal-light .ph-meta-value { color: rgba(26,24,48,0.75); }
        .portal-light .ph-shield { background: rgba(139,92,246,0.04); border-color: rgba(139,92,246,0.15); }
        .portal-light .ph-shield-line { color: rgba(26,24,48,0.65); border-color: rgba(139,92,246,0.1); }
        .portal-light .ph-stat { background: rgba(139,92,246,0.04); border-color: rgba(139,92,246,0.12); }
        .portal-light .ph-stat-label { color: rgba(26,24,48,0.5); }
        .portal-light .ph-card { background: #fff; border-color: rgba(139,92,246,0.14); }
        .portal-light .ph-card:hover { background: #faf9ff; border-color: rgba(139,92,246,0.35); }
        .portal-light .ph-card-body { color: rgba(26,24,48,0.6); }
        .portal-light .ph-card-footer { border-color: rgba(139,92,246,0.1); }
        .portal-light .ph-card-updated { color: rgba(26,24,48,0.4); }
        .portal-light .ph-notice { background: rgba(239,68,68,0.03); border-color: rgba(239,68,68,0.12); }
        .portal-light .ph-notice p { color: rgba(26,24,48,0.5); }
        .portal-light .ph-eyebrow { color: rgba(109,40,217,0.7); }
      `}</style>
    </PortalLayout>
  );
}
