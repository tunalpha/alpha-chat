import React from 'react';
import PortalLayout from '@/components/PortalLayout';
import { loadPortalSession } from '@/lib/portalSession';
import { useLang } from '@/context/LanguageContext';
import { security as T } from '@/lib/i18n';
import '@/components/portal-layout.css';

// BIP-39 wordlist è pubblica — è la COMBINAZIONE il segreto
const SEED_WORDS = ['abandon','ability','able','about','above','absent','absorb','abstract','absurd','abuse','access','accuse'];

export default function SecurityPage() {
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

      {/* ═══════════════════════════════════════════════════════════════
          ALPHA WALLET VAULT — blocco hero visivo ed emozionale
      ════════════════════════════════════════════════════════════════ */}
      <div style={{
        position: 'relative',
        borderRadius: 24,
        overflow: 'hidden',
        marginBottom: 40,
        background: 'linear-gradient(135deg, #060215 0%, #0d0628 50%, #07041c 100%)',
        border: '1px solid rgba(139,92,246,0.35)',
      }}>
        {/* Glow blobs */}
        <div style={{ position: 'absolute', top: 0, right: 0, width: 300, height: 300, background: 'radial-gradient(circle, rgba(139,92,246,0.18) 0%, transparent 70%)', pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', bottom: 0, left: 0, width: 220, height: 220, background: 'radial-gradient(circle, rgba(59,130,246,0.10) 0%, transparent 70%)', pointerEvents: 'none' }} />

        <div style={{ position: 'relative', zIndex: 1, padding: '28px 28px 24px' }}>
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
            <div style={{ width: 44, height: 44, borderRadius: 12, background: 'rgba(139,92,246,0.18)', border: '1px solid rgba(139,92,246,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, flexShrink: 0 }}>🗝️</div>
            <div>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '2px 10px', borderRadius: 100, background: 'rgba(139,92,246,0.15)', border: '1px solid rgba(139,92,246,0.30)', marginBottom: 4 }}>
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#a78bfa' }} />
                <span style={{ fontSize: 9, fontFamily: 'monospace', fontWeight: 600, color: '#c4b5fd', letterSpacing: '0.15em', textTransform: 'uppercase' }}>Self-Custodial · BIP-39/44/84 · 4 Blockchain</span>
              </div>
              <div style={{ fontSize: 22, fontWeight: 700, color: '#fff', lineHeight: 1.2 }}>
                Alpha Wallet — {isIt ? 'Vault Crittografico' : 'Cryptographic Vault'}
              </div>
            </div>
          </div>

          {/* Lead statement */}
          <div style={{ borderLeft: '2px solid rgba(139,92,246,0.45)', paddingLeft: 14, marginBottom: 24, fontSize: 14, color: 'rgba(255,255,255,0.65)', lineHeight: 1.6 }}>
            {isIt
              ? 'Le chiavi private non lasciano mai il dispositivo. Matematicamente impossibile per chiunque — incluso AlphaChat — accedere ai tuoi fondi senza la tua autorizzazione esplicita.'
              : 'Private keys never leave the device. Mathematically impossible for anyone — including AlphaChat — to access funds without the user\'s explicit authorization.'
            }
          </div>

          {/* Two-column: seed phrase grid + derivation chain */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16, marginBottom: 20 }}>

            {/* Seed phrase visualization */}
            <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 16, padding: 18 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.30)', fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: '0.15em' }}>
                  {isIt ? 'Frase Seme (12–24 parole)' : 'Seed Phrase (12–24 words)'}
                </span>
                <span style={{ fontSize: 9, background: 'rgba(52,211,153,0.15)', color: '#6ee7b7', border: '1px solid rgba(52,211,153,0.25)', borderRadius: 100, padding: '2px 8px', fontFamily: 'monospace' }}>
                  {isIt ? 'Solo su dispositivo' : 'Device only'}
                </span>
              </div>

              {/* 3×4 blurred seed word grid */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 14 }}>
                {SEED_WORDS.map((word, i) => (
                  <div key={i} style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.06)',
                    borderRadius: 8, padding: '6px 8px',
                    filter: 'blur(4px)', userSelect: 'none',
                  }} aria-hidden="true">
                    <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.25)', fontFamily: 'monospace', minWidth: 12 }}>{i+1}.</span>
                    <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.70)', fontFamily: 'monospace' }}>{word}</span>
                  </div>
                ))}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 12, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#34d399', flexShrink: 0 }} />
                <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.38)', fontFamily: 'monospace' }}>
                  {isIt
                    ? <>Generata con <strong style={{ color: 'rgba(255,255,255,0.55)' }}>crypto.getRandomValues</strong> · mai sul server</>
                    : <>Generated with <strong style={{ color: 'rgba(255,255,255,0.55)' }}>crypto.getRandomValues</strong> · never on server</>
                  }
                </span>
              </div>
            </div>

            {/* Derivation chain */}
            <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 16, padding: 18 }}>
              <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.30)', fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: '0.15em', display: 'block', marginBottom: 14 }}>
                {isIt ? 'Percorso di Derivazione' : 'Derivation Path'}
              </span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {[
                  { label: 'BIP-39 Mnemonic',       detail: '128–256 bit CSPRNG',            c: ['rgba(139,92,246,0.20)','rgba(139,92,246,0.35)','#c4b5fd'] },
                  { label: 'Seed 512-bit',           detail: 'PBKDF2-SHA512 · 2048 iter',     c: ['rgba(99,102,241,0.20)','rgba(99,102,241,0.35)','#a5b4fc'] },
                  { label: 'BIP-44 HD Derivation',   detail: "m/44'/coin_type'/0'/0/n",       c: ['rgba(59,130,246,0.20)','rgba(59,130,246,0.35)','#93c5fd'] },
                  { label: 'secp256k1 (EVM)',         detail: 'Polygon · ETH · BSC',          c: ['rgba(6,182,212,0.20)','rgba(6,182,212,0.35)','#67e8f9'] },
                  { label: 'P2WPKH BIP-84 (BTC)',    detail: 'bc1... Native SegWit',          c: ['rgba(249,115,22,0.20)','rgba(249,115,22,0.35)','#fed7aa'] },
                ].map((step, i) => (
                  <React.Fragment key={i}>
                    {i > 0 && (
                      <div style={{ textAlign: 'center', fontSize: 10, color: 'rgba(255,255,255,0.18)', fontFamily: 'monospace', lineHeight: 1 }}>↓</div>
                    )}
                    <div style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '7px 10px', borderRadius: 8, border: `1px solid ${step.c[1]}`,
                      background: step.c[0], fontSize: 10, fontFamily: 'monospace',
                    }}>
                      <span style={{ fontWeight: 600, color: step.c[2] }}>{step.label}</span>
                      <span style={{ color: step.c[2], opacity: 0.65 }}>{step.detail}</span>
                    </div>
                  </React.Fragment>
                ))}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 12, marginTop: 6, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#f87171', flexShrink: 0 }} />
                <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.38)', fontFamily: 'monospace' }}>
                  {isIt
                    ? <>Chiave privata azzerata in <strong style={{ color: 'rgba(255,255,255,0.55)' }}>try/finally</strong> subito dopo la firma</>
                    : <>Private key zeroed in <strong style={{ color: 'rgba(255,255,255,0.55)' }}>try/finally</strong> immediately after signing</>
                  }
                </span>
              </div>
            </div>
          </div>

          {/* 4 guarantees row */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12, marginBottom: 20 }}>
            {(isIt ? [
              { icon: '🧬', title: 'Frase Seme BIP-39',   desc: 'Generata localmente con entropia CSPRNG. Mai trasmessa, mai loggata.' },
              { icon: '⚡', title: 'Firma Offline',         desc: 'Chiave privata usata solo per firmare, azzerata in try/finally. Il server vede solo la TX.' },
              { icon: '🪪', title: 'Face ID / WebAuthn',   desc: 'PIN sigillato con biometria. La chiave AES è protetta da credenziale WebAuthn.' },
              { icon: '🔵', title: '4 Blockchain Native',   desc: 'Polygon · Ethereum · BSC · Bitcoin. Un\'unica frase seme, tutte le reti.' },
            ] : [
              { icon: '🧬', title: 'BIP-39 Seed Phrase',   desc: 'Generated locally with CSPRNG entropy. Never transmitted, never logged.' },
              { icon: '⚡', title: 'Offline Signing',       desc: 'Private key used only to sign, zeroed in try/finally. Server only sees the TX.' },
              { icon: '🪪', title: 'Face ID / WebAuthn',   desc: 'PIN sealed with biometrics. AES key protected by WebAuthn credential.' },
              { icon: '🔵', title: '4 Native Blockchains', desc: 'Polygon · Ethereum · BSC · Bitcoin. One seed phrase, all networks.' },
            ]).map((g) => (
              <div key={g.title} style={{
                background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 14, padding: 16,
              }}>
                <div style={{ fontSize: 20, marginBottom: 8 }}>{g.icon}</div>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#fff', marginBottom: 6 }}>{g.title}</div>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', lineHeight: 1.5 }}>{g.desc}</div>
              </div>
            ))}
          </div>

          {/* 4 chain badges */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {[
              { icon: '🔵', name: 'Polygon PoS',  tag: 'USDT · USDC · POL', bg: 'rgba(59,130,246,0.12)', border: 'rgba(59,130,246,0.30)', color: '#93c5fd' },
              { icon: '⬡',  name: 'Ethereum L1',  tag: 'ETH · ERC-20',      bg: 'rgba(100,116,139,0.12)', border: 'rgba(100,116,139,0.30)', color: '#cbd5e1' },
              { icon: '🟡', name: 'BSC',           tag: 'BNB · USDT 18dec',  bg: 'rgba(234,179,8,0.12)',  border: 'rgba(234,179,8,0.30)',  color: '#fde68a' },
              { icon: '🟠', name: 'Bitcoin',       tag: 'BTC · SegWit PSBT', bg: 'rgba(249,115,22,0.12)', border: 'rgba(249,115,22,0.30)', color: '#fed7aa' },
            ].map((c) => (
              <div key={c.name} style={{
                display: 'flex', alignItems: 'center', gap: 7,
                padding: '6px 12px', borderRadius: 100,
                background: c.bg, border: `1px solid ${c.border}`,
                fontSize: 11, fontFamily: 'monospace', fontWeight: 600, color: c.color,
              }}>
                <span>{c.icon}</span>
                <span>{c.name}</span>
                <span style={{ opacity: 0.55, fontWeight: 400 }}>· {c.tag}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      {/* ═══════════════════════════════════════════════════════════════ */}

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
