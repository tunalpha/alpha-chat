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
  const isIt = lang === 'it';

  return (
    <PortalLayout investorName={session?.investorName} sessionExpiry={session?.sessionExpiry}>
      <div className="portal-page-header">
        <p className="portal-page-eyebrow">{t.eyebrow}</p>
        <h1 className="portal-page-title">{t.title}</h1>
        <p className="portal-page-sub">{t.sub}</p>
      </div>

      {/* Technology pillars grid */}
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

      {/* ═══════════════════════════════════════════════════════════════
          ALPHA WALLET — blocco hero emozionale e tecnico
      ════════════════════════════════════════════════════════════════ */}
      <div style={{
        position: 'relative',
        borderRadius: 24,
        overflow: 'hidden',
        marginBottom: 40,
        background: 'linear-gradient(135deg, #060215 0%, #0d0628 55%, #07041c 100%)',
        border: '1px solid rgba(139,92,246,0.35)',
      }}>
        <div style={{ position: 'absolute', top: 0, right: 0, width: 280, height: 280, background: 'radial-gradient(circle, rgba(139,92,246,0.18) 0%, transparent 70%)', pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', bottom: 0, left: 0, width: 200, height: 200, background: 'radial-gradient(circle, rgba(59,130,246,0.10) 0%, transparent 70%)', pointerEvents: 'none' }} />

        <div style={{ position: 'relative', zIndex: 1, padding: '28px 28px 24px' }}>

          {/* Header */}
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 12px', borderRadius: 100, background: 'rgba(139,92,246,0.15)', border: '1px solid rgba(139,92,246,0.30)', marginBottom: 14 }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#a78bfa' }} />
            <span style={{ fontSize: 9, fontFamily: 'monospace', fontWeight: 600, color: '#c4b5fd', letterSpacing: '0.15em', textTransform: 'uppercase' }}>
              {isIt ? 'Wallet Self-Custodial · 4 Blockchain · BIP-39/44/84' : 'Self-Custodial Wallet · 4 Blockchains · BIP-39/44/84'}
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
            <span style={{ fontSize: 28 }}>🗝️</span>
            <h2 style={{ fontSize: 28, fontWeight: 700, color: '#fff', margin: 0, lineHeight: 1.2 }}>
              Alpha Wallet
            </h2>
          </div>
          <p style={{ fontSize: 16, color: '#a78bfa', fontWeight: 300, marginBottom: 8, marginTop: 0 }}>
            {isIt ? 'Il tuo denaro, matematicamente tuo. Su quattro blockchain.' : 'Your money, mathematically yours. Across four blockchains.'}
          </p>

          {/* Emotional statement */}
          <div style={{ borderLeft: '2px solid rgba(139,92,246,0.45)', paddingLeft: 14, marginBottom: 24, fontSize: 14, color: 'rgba(255,255,255,0.65)', lineHeight: 1.65 }}>
            {isIt
              ? 'Alpha Wallet è un wallet HD (Hierarchical Deterministic) self-custodial integrato nativamente in AlphaChat. Non è un wrapper attorno a un wallet di terze parti — è un\'implementazione crittografica completa, costruita da zero con BIP-39/44/84. Le chiavi private non lasciano mai il dispositivo.'
              : 'Alpha Wallet is a self-custodial HD wallet natively integrated in AlphaChat. Not a wrapper around a third-party wallet — a complete cryptographic implementation built from scratch with BIP-39/44/84. Private keys never leave the device.'
            }
          </div>

          {/* 3-col feature cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 14, marginBottom: 24 }}>
            {(isIt ? [
              {
                icon: '🧬', badge: 'Client-Side Only', badgeBg: 'rgba(52,211,153,0.15)', badgeBorder: 'rgba(52,211,153,0.25)', badgeColor: '#6ee7b7',
                title: 'Frase Seme BIP-39',
                desc: '12–24 parole generate localmente con crypto.getRandomValues. Mai trasmessa al server, mai loggata.',
              },
              {
                icon: '🔑', badge: 'Memory Zeroing', badgeBg: 'rgba(59,130,246,0.15)', badgeBorder: 'rgba(59,130,246,0.25)', badgeColor: '#93c5fd',
                title: 'Firma Offline',
                desc: 'Chiave privata derivata, usata per firmare TX, azzerata in try/finally. Zero esposizione al server.',
              },
              {
                icon: '🪪', badge: 'WebAuthn AES-GCM', badgeBg: 'rgba(139,92,246,0.15)', badgeBorder: 'rgba(139,92,246,0.25)', badgeColor: '#c4b5fd',
                title: 'Face ID / PIN Seal',
                desc: 'Wallet cifrato AES-256-GCM in IndexedDB. Sbloccabile solo con biometria (Face ID/Impronta) via WebAuthn.',
              },
            ] : [
              {
                icon: '🧬', badge: 'Client-Side Only', badgeBg: 'rgba(52,211,153,0.15)', badgeBorder: 'rgba(52,211,153,0.25)', badgeColor: '#6ee7b7',
                title: 'BIP-39 Seed Phrase',
                desc: '12–24 words generated locally with crypto.getRandomValues. Never transmitted to server, never logged.',
              },
              {
                icon: '🔑', badge: 'Memory Zeroing', badgeBg: 'rgba(59,130,246,0.15)', badgeBorder: 'rgba(59,130,246,0.25)', badgeColor: '#93c5fd',
                title: 'Offline Signing',
                desc: 'Private key derived, used to sign TX, zeroed in try/finally. Zero exposure to server.',
              },
              {
                icon: '🪪', badge: 'WebAuthn AES-GCM', badgeBg: 'rgba(139,92,246,0.15)', badgeBorder: 'rgba(139,92,246,0.25)', badgeColor: '#c4b5fd',
                title: 'Face ID / PIN Seal',
                desc: 'Wallet encrypted AES-256-GCM in IndexedDB. Unlockable only by biometrics (Face ID/Fingerprint) via WebAuthn.',
              },
            ]).map((card) => (
              <div key={card.title} style={{
                background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 16, padding: 18,
              }}>
                <div style={{ fontSize: 24, marginBottom: 10 }}>{card.icon}</div>
                <div style={{
                  display: 'inline-flex', padding: '2px 8px', borderRadius: 100, marginBottom: 10,
                  background: card.badgeBg, border: `1px solid ${card.badgeBorder}`,
                  fontSize: 9, fontFamily: 'monospace', fontWeight: 600, color: card.badgeColor,
                }}>
                  {card.badge}
                </div>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#fff', marginBottom: 7 }}>{card.title}</div>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.48)', lineHeight: 1.55 }}>{card.desc}</div>
              </div>
            ))}
          </div>

          {/* Derivation path + 4 chains */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 14, marginBottom: 20 }}>

            {/* Derivation path */}
            <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 14, padding: 16 }}>
              <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.28)', fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: '0.15em', display: 'block', marginBottom: 12 }}>
                {isIt ? 'Percorso HD Standard' : 'HD Standard Path'}
              </span>
              <div style={{ fontFamily: 'monospace', fontSize: 11, color: 'rgba(255,255,255,0.58)', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ color: '#c4b5fd' }}>m</span>
                  <span style={{ color: 'rgba(255,255,255,0.20)' }}>→</span>
                  <span>BIP-39 Mnemonic <span style={{ color: 'rgba(255,255,255,0.30)' }}>(128–256 bit)</span></span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ color: '#a5b4fc', paddingLeft: 12 }}>44'</span>
                  <span style={{ color: 'rgba(255,255,255,0.20)' }}>→</span>
                  <span>BIP-44 HD Derivation</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ color: '#93c5fd', paddingLeft: 24 }}>60'</span>
                  <span style={{ color: 'rgba(255,255,255,0.20)' }}>→</span>
                  <span>EVM <span style={{ color: 'rgba(255,255,255,0.30)' }}>(ETH/POL/BNB)</span></span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ color: '#fed7aa', paddingLeft: 24 }}>84'</span>
                  <span style={{ color: 'rgba(255,255,255,0.20)' }}>→</span>
                  <span>BIP-84 <span style={{ color: 'rgba(255,255,255,0.30)' }}>(BTC SegWit)</span></span>
                </div>
              </div>
            </div>

            {/* 4 chains */}
            <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 14, padding: 16 }}>
              <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.28)', fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: '0.15em', display: 'block', marginBottom: 12 }}>
                {isIt ? '4 Blockchain Native' : '4 Native Blockchains'}
              </span>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                {[
                  { icon: '🔵', name: 'Polygon PoS',  tag: 'USDT · USDC · POL', bg: 'rgba(59,130,246,0.08)',  border: 'rgba(59,130,246,0.20)' },
                  { icon: '⬡',  name: 'Ethereum L1',  tag: 'ETH · ERC-20',      bg: 'rgba(100,116,139,0.08)', border: 'rgba(100,116,139,0.20)' },
                  { icon: '🟡', name: 'BSC',           tag: 'BNB · USDT 18d',    bg: 'rgba(234,179,8,0.08)',  border: 'rgba(234,179,8,0.20)' },
                  { icon: '🟠', name: 'Bitcoin',       tag: 'BTC SegWit PSBT',   bg: 'rgba(249,115,22,0.08)', border: 'rgba(249,115,22,0.20)' },
                ].map((c) => (
                  <div key={c.name} style={{ background: c.bg, border: `1px solid ${c.border}`, borderRadius: 12, padding: '10px 12px' }}>
                    <div style={{ fontSize: 18, marginBottom: 4 }}>{c.icon}</div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: '#fff', marginBottom: 3 }}>{c.name}</div>
                    <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.35)', fontFamily: 'monospace' }}>{c.tag}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Bottom strip */}
          <div style={{ paddingTop: 16, borderTop: '1px solid rgba(255,255,255,0.08)', display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            {['BIP-39/44/84','secp256k1','P2WPKH SegWit','AES-256-GCM','WebAuthn Face ID','PSBT Bitcoin','Platform Fee Model'].map(s => (
              <span key={s} style={{ fontSize: 9, fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: '0.12em', color: 'rgba(255,255,255,0.22)' }}>{s}</span>
            ))}
          </div>
        </div>
      </div>
      {/* ═══════════════════════════════════════════════════════════════ */}

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
