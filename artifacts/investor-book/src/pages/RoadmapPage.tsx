import React from 'react';
import PortalLayout from '@/components/PortalLayout';
import { loadPortalSession } from '@/lib/portalSession';
import { en } from '@/content/en';
import '@/components/portal-layout.css';

interface RoadmapPhase {
  name?: string;
  status?: string;
  desc?: string;
  // legacy fallback fields
  phase?: string;
  period?: string;
  items?: string[];
}

const STATUS_COLORS: Record<string, string> = {
  complete:    '#6ee7b7',
  completed:   '#6ee7b7',
  active:      '#a78bfa',
  'in-progress': '#a78bfa',
  upcoming:    'rgba(232,232,240,0.35)',
  planned:     'rgba(232,232,240,0.35)',
};

const STATUS_LABELS: Record<string, string> = {
  complete:    '✓ Completato',
  completed:   '✓ Completato',
  active:      '⟳ In corso',
  'in-progress': '⟳ In corso',
  upcoming:    '◯ Pianificato',
  planned:     '◯ Pianificato',
};

export default function RoadmapPage() {
  const session = loadPortalSession();
  const rawPhases: RoadmapPhase[] = (en.roadmap?.phases ?? []) as RoadmapPhase[];

  const fallbackPhases: RoadmapPhase[] = [
    { name: 'Phase 1 — Foundation', status: 'complete',  desc: 'Signal E2E encryption, multi-device sync, Phoenix Protocol, React Native app.' },
    { name: 'Phase 2 — Payments',   status: 'complete',  desc: 'USDA P2P transfers, escrow system, Gas Station automation, wallet integration.' },
    { name: 'Phase 3 — Scale',      status: 'active',    desc: 'Group E2E encryption, WebRTC secure calls, Cloudflare R2 migration, i18n (10 lingue).' },
    { name: 'Phase 4 — Growth',     status: 'upcoming',  desc: 'Enterprise tier, SDK for developers, GDPR/SOC2 compliance, Marketplace launch.' },
    { name: 'Phase 5 — Global',     status: 'upcoming',  desc: 'Series A fundraise, US & EU regulatory approval, white-label offering, global expansion.' },
  ];

  const phases = rawPhases.length > 0 ? rawPhases : fallbackPhases;

  return (
    <PortalLayout investorName={session?.investorName} sessionExpiry={session?.sessionExpiry}>
      <div className="portal-page-header">
        <p className="portal-page-eyebrow">Product Roadmap</p>
        <h1 className="portal-page-title">Execution, Not Promises</h1>
        <p className="portal-page-sub">
          Un approccio per fasi dalla crittografia di base alla piattaforma di
          messaggistica finanziaria globale. Ogni fase si autofinanzia con quella precedente.
        </p>
      </div>

      <div style={{ position: 'relative', marginBottom: 48 }}>
        {phases.map((p, i) => {
          const status = p.status ?? 'upcoming';
          const color  = STATUS_COLORS[status] ?? STATUS_COLORS.upcoming;
          const label  = STATUS_LABELS[status] ?? status;
          // Support both new (name/desc) and legacy (phase/items) field shapes
          const title  = p.name  ?? p.phase ?? `Phase ${i + 1}`;
          const period = p.period ?? null;

          return (
            <div key={i} style={{ display: 'flex', gap: 20, marginBottom: 8 }}>
              {/* Timeline */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 24, flexShrink: 0 }}>
                <div style={{
                  width: 12, height: 12, borderRadius: '50%',
                  background: color, boxShadow: `0 0 8px ${color}`,
                  flexShrink: 0, marginTop: 22,
                }} />
                {i < phases.length - 1 && (
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
                  <h3 className="portal-card-title" style={{ margin: 0, flex: 1 }}>{title}</h3>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2, flexShrink: 0 }}>
                    {period && (
                      <span style={{ fontSize: 11, color: 'rgba(232,232,240,0.45)' }}>{period}</span>
                    )}
                    <span style={{ fontSize: 11, fontWeight: 700, color }}>{label}</span>
                  </div>
                </div>

                {/* Description (new content shape) */}
                {p.desc && (
                  <p className="portal-card-body">{p.desc}</p>
                )}

                {/* Items list (legacy content shape) */}
                {p.items && p.items.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
                    {p.items.map((item: string) => (
                      <span key={item} style={{
                        fontSize: 12, padding: '4px 10px', borderRadius: 100,
                        background: 'rgba(139,92,246,0.08)',
                        border: '1px solid rgba(139,92,246,0.15)',
                        color: 'rgba(232,232,240,0.75)',
                      }}>{item}</span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div style={{
        background: 'rgba(139,92,246,0.06)',
        border: '1px solid rgba(139,92,246,0.2)',
        borderRadius: 16, padding: '20px 24px',
      }}>
        <p style={{ fontSize: 13, color: 'rgba(232,232,240,0.55)', lineHeight: 1.7, margin: 0 }}>
          📋 Roadmap completa con date di consegna, KPI e allocazione risorse disponibile nell'
          <a href="../book/en" style={{ color: '#a78bfa' }}>Investor Book → Roadmap section</a>.
          Un piano di esecuzione dettagliato su 12 mesi è disponibile previa firma NDA.
        </p>
      </div>
    </PortalLayout>
  );
}
