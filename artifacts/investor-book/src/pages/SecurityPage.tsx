import React from 'react';
import PortalLayout from '@/components/PortalLayout';
import { loadPortalSession } from '@/lib/portalSession';
import { useLang } from '@/context/LanguageContext';
import { security as T } from '@/lib/i18n';
import '@/components/portal-layout.css';

export default function SecurityPage() {
  const session = loadPortalSession();
  const { lang } = useLang();
  const t = T[lang];

  return (
    <PortalLayout investorName={session?.investorName} sessionExpiry={session?.sessionExpiry}>
      <div className="portal-page-header">
        <p className="portal-page-eyebrow">{t.eyebrow}</p>
        <h1 className="portal-page-title">{t.title}</h1>
        <p className="portal-page-sub">{t.sub}</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 20, marginBottom: 48 }}>
        {t.layers.map(l => (
          <div key={l.title} className="portal-card">
            <span className="portal-card-icon">{l.icon}</span>
            <h3 className="portal-card-title">{l.title}</h3>
            <ul style={{ margin: 0, padding: '0 0 0 16px' }}>
              {l.points.map(p => (
                <li key={p} className="portal-list-item">{p}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="portal-section-divider" />

      <div className="portal-stat-grid" style={{ marginBottom: 40 }}>
        {t.stats.map(s => (
          <div key={s.l} className="portal-stat">
            <span className="portal-stat-value">{s.v}</span>
            <span className="portal-stat-label">{s.l}</span>
          </div>
        ))}
      </div>

      <div className="portal-success-box">
        <p className="portal-info-text">{t.note}</p>
      </div>
    </PortalLayout>
  );
}
