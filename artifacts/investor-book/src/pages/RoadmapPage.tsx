import React from 'react';
import PortalLayout from '@/components/PortalLayout';
import { loadPortalSession } from '@/lib/portalSession';
import { useLang } from '@/context/LanguageContext';
import { roadmap as T } from '@/lib/i18n';
import '@/components/portal-layout.css';

const STATUS_COLORS: Record<string, string> = {
  complete:      '#6ee7b7',
  completed:     '#6ee7b7',
  active:        '#a78bfa',
  'in-progress': '#a78bfa',
  upcoming:      'rgba(232,232,240,0.35)',
  planned:       'rgba(232,232,240,0.35)',
};

export default function RoadmapPage() {
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

      <div style={{ position: 'relative', marginBottom: 48 }}>
        {t.phases.map((p, i) => {
          const color = STATUS_COLORS[p.status] ?? STATUS_COLORS.upcoming;
          const label = t.statusLabels[p.status as keyof typeof t.statusLabels] ?? p.status;

          return (
            <div key={i} style={{ display: 'flex', gap: 20, marginBottom: 8 }}>
              {/* Timeline dot */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 24, flexShrink: 0 }}>
                <div style={{
                  width: 12, height: 12, borderRadius: '50%',
                  background: color, boxShadow: `0 0 8px ${color}`,
                  flexShrink: 0, marginTop: 22,
                }} />
                {i < t.phases.length - 1 && (
                  <div style={{
                    width: 2, flex: 1,
                    background: `linear-gradient(${color}, rgba(139,92,246,0.2))`,
                    minHeight: 32,
                  }} />
                )}
              </div>

              {/* Card */}
              <div className="portal-card" style={{ flex: 1, marginBottom: 16 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
                  <h3 className="portal-card-title" style={{ margin: 0, flex: 1 }}>{p.name}</h3>
                  <span style={{ fontSize: 11, fontWeight: 700, color }}>{label}</span>
                </div>
                <p className="portal-card-body">{p.desc}</p>
              </div>
            </div>
          );
        })}
      </div>

      <div className="portal-info-box">
        <p className="portal-info-text">
          {t.note}{' '}
          <a href={`../book/${lang}`} className="portal-link-purple">{t.noteLink}</a>
          {t.noteEnd}
        </p>
      </div>
    </PortalLayout>
  );
}
