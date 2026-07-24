import React from 'react';
import PortalLayout from '@/components/PortalLayout';
import { loadPortalSession } from '@/lib/portalSession';
import { en } from '@/content/en';
import '@/components/portal-layout.css';

export default function RoadmapPage() {
  const session = loadPortalSession();
  const phases = en.roadmap?.phases ?? [];

  const fallbackPhases = [
    { phase: 'Phase 1 — Foundation', period: 'Q1–Q2 2025', status: 'completed', items: ['Signal E2E encryption', 'Multi-device sync', 'Phoenix Protocol', 'React Native app'] },
    { phase: 'Phase 2 — Payments', period: 'Q3 2025', status: 'completed', items: ['USDA P2P transfers', 'Escrow system', 'Gas Station automation', 'Wallet integration'] },
    { phase: 'Phase 3 — Scale', period: 'Q4 2025', status: 'in-progress', items: ['Group E2E encryption', 'WebRTC secure calls', 'Cloudflare R2 migration', 'i18n (10 languages)'] },
    { phase: 'Phase 4 — Growth', period: 'Q1–Q2 2026', status: 'planned', items: ['Enterprise tier', 'SDK for developers', 'Compliance suite (GDPR, SOC2)', 'Marketplace launch'] },
    { phase: 'Phase 5 — Global', period: 'H2 2026', status: 'planned', items: ['Series A fundraise', 'US & EU regulatory approval', 'White-label offering', 'Global expansion'] },
  ];

  const displayPhases = phases.length > 0 ? phases : fallbackPhases;

  const statusColors: Record<string, string> = {
    completed: '#6ee7b7',
    'in-progress': '#a78bfa',
    planned: 'rgba(232,232,240,0.25)',
  };
  const statusLabels: Record<string, string> = {
    completed: '✓ Completed',
    'in-progress': '⟳ In Progress',
    planned: '◯ Planned',
  };

  return (
    <PortalLayout investorName={session?.investorName} sessionExpiry={session?.sessionExpiry}>
      <div className="portal-page-header">
        <p className="portal-page-eyebrow">Product Roadmap</p>
        <h1 className="portal-page-title">Execution, Not Promises</h1>
        <p className="portal-page-sub">
          A phased approach from cryptographic foundation to global financial messaging platform.
          Each phase is self-funding through the previous milestone.
        </p>
      </div>

      <div style={{ position: 'relative', marginBottom: 48 }}>
        {displayPhases.map((phase: Record<string, unknown>, i: number) => {
          const status = (phase.status as string) ?? 'planned';
          const color = statusColors[status] ?? statusColors.planned;
          return (
            <div key={i} style={{ display: 'flex', gap: 24, marginBottom: 8 }}>
              {/* Timeline */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 24, flexShrink: 0 }}>
                <div style={{ width: 12, height: 12, borderRadius: '50%', background: color, boxShadow: `0 0 8px ${color}`, flexShrink: 0, marginTop: 20 }} />
                {i < displayPhases.length - 1 && <div style={{ width: 2, flex: 1, background: `linear-gradient(${color}, rgba(139,92,246,0.2))`, minHeight: 32 }} />}
              </div>
              {/* Card */}
              <div className="portal-card" style={{ flex: 1, marginBottom: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
                  <h3 className="portal-card-title" style={{ margin: 0 }}>{phase.phase as string}</h3>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span style={{ fontSize: 11, color: 'rgba(232,232,240,0.4)' }}>{phase.period as string}</span>
                    <span style={{ fontSize: 11, fontWeight: 600, color }}>
                      {statusLabels[status] ?? status}
                    </span>
                  </div>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {((phase.items as string[]) ?? []).map((item: string) => (
                    <span key={item} style={{
                      fontSize: 12, padding: '4px 10px', borderRadius: 100,
                      background: 'rgba(139,92,246,0.08)',
                      border: '1px solid rgba(139,92,246,0.15)',
                      color: 'rgba(232,232,240,0.65)',
                    }}>{item}</span>
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ background: 'rgba(139,92,246,0.06)', border: '1px solid rgba(139,92,246,0.2)', borderRadius: 16, padding: '20px 24px' }}>
        <p style={{ fontSize: 13, color: 'rgba(232,232,240,0.5)', lineHeight: 1.7, margin: 0 }}>
          📋 Full roadmap with delivery dates, KPIs and resource allocation is available in the
          <a href="../book/en" style={{ color: '#a78bfa' }}> Investor Book → Roadmap section</a>.
          A detailed 12-month execution plan is available upon NDA signature.
        </p>
      </div>
    </PortalLayout>
  );
}
