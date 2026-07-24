import React from 'react';
import PortalLayout from '@/components/PortalLayout';
import { loadPortalSession } from '@/lib/portalSession';
import { useLang } from '@/context/LanguageContext';
import { market as T } from '@/lib/i18n';
import '@/components/portal-layout.css';

export default function MarketPage() {
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

      {/* TAM/SAM/SOM */}
      <div className="portal-stat-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', marginBottom: 48 }}>
        {t.segments.map(s => (
          <div key={s.label} className="portal-stat" style={{ padding: '24px 20px' }}>
            <span className="portal-stat-value" style={{ fontSize: 32 }}>{s.value}</span>
            <span className="portal-stat-label" style={{ marginTop: 8 }}>{s.label}</span>
            <span className="portal-stat-sub">{s.sub}</span>
          </div>
        ))}
      </div>

      <div className="portal-section-divider" />

      <h2 className="portal-section-h2">{t.driversTitle}</h2>
      <div className="portal-card-grid" style={{ marginBottom: 48 }}>
        {t.drivers.map(d => (
          <div key={d.title} className="portal-card">
            <span className="portal-card-icon">{d.icon}</span>
            <h3 className="portal-card-title">{d.title}</h3>
            <p className="portal-card-body">{d.body}</p>
          </div>
        ))}
      </div>

      <div className="portal-section-divider" />

      <h2 className="portal-section-h2">{t.competitorsTitle}</h2>
      <div className="portal-table-box" style={{ marginBottom: 40, overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 500 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid rgba(139,92,246,0.15)', background: 'rgba(139,92,246,0.06)' }}>
              {t.tableHeaders.map(h => (
                <th key={h} style={{ textAlign: 'left', padding: '12px 20px', fontSize: 11, fontWeight: 700, letterSpacing: 1, color: 'rgba(139,92,246,0.7)', textTransform: 'uppercase' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {t.competitors.map((c, i) => (
              <tr key={c.name} style={{ borderBottom: i < t.competitors.length - 1 ? '1px solid rgba(139,92,246,0.08)' : 'none' }}>
                <td className="portal-td-bold">{c.name}</td>
                <td className="portal-td">{c.strength}</td>
                <td className="portal-td-danger">{c.weakness}</td>
                <td style={{ padding: '14px 20px' }}>
                  <span style={{
                    fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 100,
                    background: (c.threat === 'Low' || c.threat === 'Bassa')
                      ? 'rgba(16,185,129,0.12)' : 'rgba(245,158,11,0.12)',
                    color: (c.threat === 'Low' || c.threat === 'Bassa') ? '#6ee7b7' : '#fbbf24',
                    border: `1px solid ${(c.threat === 'Low' || c.threat === 'Bassa') ? 'rgba(16,185,129,0.25)' : 'rgba(245,158,11,0.25)'}`,
                  }}>{c.threat}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="portal-info-box">
        <p className="portal-info-text">
          {t.note}{' '}
          <a href={`../book/${lang}`} className="portal-link-purple">{t.noteLink}</a>.
        </p>
      </div>
    </PortalLayout>
  );
}
