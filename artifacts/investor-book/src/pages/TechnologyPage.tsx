import React from 'react';
import PortalLayout from '@/components/PortalLayout';
import { loadPortalSession } from '@/lib/portalSession';
import { useLang } from '@/context/LanguageContext';
import { technology as T } from '@/lib/i18n';
import '@/components/portal-layout.css';

export default function TechnologyPage() {
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

      <div className="portal-card-grid" style={{ marginBottom: 48 }}>
        {t.pillars.map(p => (
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

      <h2 className="portal-section-h2">{t.stackTitle}</h2>
      <div className="portal-table-box" style={{ marginBottom: 40 }}>
        {t.stack.map((s, i) => (
          <div key={s.layer} className="portal-table-row"
            style={{ borderBottom: i < t.stack.length - 1 ? '1px solid rgba(139,92,246,0.1)' : 'none' }}>
            <span className="portal-table-key">{s.layer}</span>
            <span className="portal-table-val">{s.tech}</span>
          </div>
        ))}
      </div>

      <div className="portal-info-box">
        <p className="portal-info-text">
          {t.deepDive}{' '}
          <a href={`../book/${lang}`} className="portal-link-purple">{t.deepDiveLink}</a>.
        </p>
      </div>
    </PortalLayout>
  );
}
