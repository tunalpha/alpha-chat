import React from 'react';
import PortalLayout from '@/components/PortalLayout';
import { loadPortalSession } from '@/lib/portalSession';
import '@/components/portal-layout.css';

export default function MarketPage() {
  const session = loadPortalSession();

  const segments = [
    { label: 'TAM — Global Messaging', value: '$120B+', sub: 'Total addressable market by 2028' },
    { label: 'SAM — Privacy-first niche', value: '$18B', sub: 'Serviceable addressable market' },
    { label: 'SOM — Target Year 3', value: '$240M', sub: 'Realistic capture at scale' },
  ];

  const competitors = [
    { name: 'Signal', strength: 'E2E encryption', weakness: 'No payments, no monetisation model', threat: 'Low' },
    { name: 'WhatsApp', strength: '2B+ users', weakness: 'Meta ownership, no real privacy', threat: 'Medium' },
    { name: 'Telegram', strength: 'Crypto community', weakness: 'Not truly E2E by default', threat: 'Medium' },
    { name: 'Wire', strength: 'Enterprise focus', weakness: 'Poor UX, no payments', threat: 'Low' },
  ];

  const drivers = [
    { icon: '📜', title: 'Regulatory tailwinds', body: 'GDPR, DSA, EU AI Act. Enterprises need provably private comms or face heavy fines.' },
    { icon: '🏛️', title: 'Institutional demand', body: 'Law firms, banks, government agencies actively seeking Signal-class security with enterprise controls.' },
    { icon: '💰', title: 'Embedded finance', body: '$4.6T in annual stablecoin volume. Messaging + payments is the next super-app layer.' },
    { icon: '🌍', title: 'Global south growth', body: 'LATAM, SEA, MEA: mobile-first populations with high crypto adoption and low trust in traditional banking.' },
  ];

  return (
    <PortalLayout investorName={session?.investorName} sessionExpiry={session?.sessionExpiry}>
      <div className="portal-page-header">
        <p className="portal-page-eyebrow">Market Opportunity</p>
        <h1 className="portal-page-title">A $120B Market Waiting to be Won</h1>
        <p className="portal-page-sub">
          Privacy-first messaging at the intersection of encrypted communications and embedded finance.
          The regulatory environment has never been more favourable.
        </p>
      </div>

      {/* TAM/SAM/SOM */}
      <div className="portal-stat-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', marginBottom: 48 }}>
        {segments.map(s => (
          <div key={s.label} className="portal-stat" style={{ padding: '24px 20px' }}>
            <span className="portal-stat-value" style={{ fontSize: 32 }}>{s.value}</span>
            <span className="portal-stat-label" style={{ marginTop: 8 }}>{s.label}</span>
            <span style={{ fontSize: 11, color: 'rgba(232,232,240,0.3)', marginTop: 4, display: 'block' }}>{s.sub}</span>
          </div>
        ))}
      </div>

      <div className="portal-section-divider" />

      <h2 style={{ fontSize: 20, fontWeight: 700, color: '#fff', marginBottom: 20 }}>Market Drivers</h2>
      <div className="portal-card-grid" style={{ marginBottom: 48 }}>
        {drivers.map(d => (
          <div key={d.title} className="portal-card">
            <span className="portal-card-icon">{d.icon}</span>
            <h3 className="portal-card-title">{d.title}</h3>
            <p className="portal-card-body">{d.body}</p>
          </div>
        ))}
      </div>

      <div className="portal-section-divider" />

      <h2 style={{ fontSize: 20, fontWeight: 700, color: '#fff', marginBottom: 16 }}>Competitive Landscape</h2>
      <div style={{ background: 'rgba(10,8,25,0.7)', border: '1px solid rgba(139,92,246,0.18)', borderRadius: 16, overflow: 'hidden', marginBottom: 40 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid rgba(139,92,246,0.15)', background: 'rgba(139,92,246,0.06)' }}>
              {['Competitor', 'Strength', 'Weakness', 'Threat'].map(h => (
                <th key={h} style={{ textAlign: 'left', padding: '12px 20px', fontSize: 11, fontWeight: 700, letterSpacing: 1, color: 'rgba(139,92,246,0.7)', textTransform: 'uppercase' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {competitors.map((c, i) => (
              <tr key={c.name} style={{ borderBottom: i < competitors.length - 1 ? '1px solid rgba(139,92,246,0.08)' : 'none' }}>
                <td style={{ padding: '14px 20px', fontWeight: 700, color: '#fff', fontSize: 14 }}>{c.name}</td>
                <td style={{ padding: '14px 20px', fontSize: 13, color: 'rgba(232,232,240,0.55)' }}>{c.strength}</td>
                <td style={{ padding: '14px 20px', fontSize: 13, color: 'rgba(248,113,113,0.6)' }}>{c.weakness}</td>
                <td style={{ padding: '14px 20px' }}>
                  <span style={{
                    fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 100,
                    background: c.threat === 'Low' ? 'rgba(16,185,129,0.12)' : 'rgba(245,158,11,0.12)',
                    color: c.threat === 'Low' ? '#6ee7b7' : '#fbbf24',
                    border: `1px solid ${c.threat === 'Low' ? 'rgba(16,185,129,0.25)' : 'rgba(245,158,11,0.25)'}`,
                  }}>{c.threat}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ background: 'rgba(139,92,246,0.06)', border: '1px solid rgba(139,92,246,0.2)', borderRadius: 16, padding: '20px 24px' }}>
        <p style={{ fontSize: 13, color: 'rgba(232,232,240,0.5)', lineHeight: 1.7, margin: 0 }}>
          📈 Full market analysis with sources, SWOT matrix and financial projections is in the
          <a href="../book/en" style={{ color: '#a78bfa' }}> Investor Book</a>.
        </p>
      </div>
    </PortalLayout>
  );
}
