import React from 'react';
import PortalLayout from '@/components/PortalLayout';
import { loadPortalSession } from '@/lib/portalSession';
import { en } from '@/content/en';
import '@/components/portal-layout.css';

export default function TeamPage() {
  const session = loadPortalSession();
  const founder = en.founder;
  const letter  = en.founderLetter;
  const story   = en.story;

  return (
    <PortalLayout investorName={session?.investorName} sessionExpiry={session?.sessionExpiry}>
      <div className="portal-page-header">
        <p className="portal-page-eyebrow">Team & Vision</p>
        <h1 className="portal-page-title">Built by Practitioners</h1>
        <p className="portal-page-sub">
          Not academics building privacy theory — engineers who experienced first-hand why it matters.
        </p>
      </div>

      {/* Founder card */}
      {founder && (
        <div style={{
          background: 'rgba(10,8,25,0.7)',
          border: '1px solid rgba(139,92,246,0.25)',
          borderRadius: 20,
          padding: '32px',
          marginBottom: 32,
          display: 'flex',
          gap: 32,
          flexWrap: 'wrap',
        }}>
          <div style={{
            width: 80, height: 80, borderRadius: '50%',
            background: 'linear-gradient(135deg, #7c3aed, #4f46e5)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 36, flexShrink: 0,
            boxShadow: '0 0 30px rgba(124,58,237,0.4)',
          }}>
            {founder.emoji ?? '👤'}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
              <h2 style={{ fontSize: 22, fontWeight: 800, color: '#fff', margin: 0 }}>{founder.name}</h2>
              <span className="portal-tag portal-tag-purple">{founder.role}</span>
            </div>
            {founder.tagline && <p style={{ fontSize: 14, color: 'rgba(167,139,250,0.8)', fontStyle: 'italic', margin: '0 0 12px' }}>"{founder.tagline}"</p>}
            {founder.bio && <p style={{ fontSize: 14, color: 'rgba(232,232,240,0.55)', lineHeight: 1.7, margin: 0 }}>{founder.bio}</p>}
            {founder.skills && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 16 }}>
                {(founder.skills as string[]).map((s: string) => (
                  <span key={s} className="portal-tag portal-tag-blue">{s}</span>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Founder letter excerpt */}
      {letter && (
        <>
          <div className="portal-section-divider" />
          <h2 style={{ fontSize: 20, fontWeight: 700, color: '#fff', marginBottom: 16 }}>Letter from the Founder</h2>
          <div style={{
            background: 'rgba(139,92,246,0.05)',
            border: '1px solid rgba(139,92,246,0.2)',
            borderRadius: 16,
            padding: '28px 32px',
            marginBottom: 32,
            borderLeft: '3px solid rgba(139,92,246,0.5)',
          }}>
            {letter.paragraphs && (letter.paragraphs as string[]).slice(0, 3).map((p: string, i: number) => (
              <p key={i} style={{ fontSize: 14, color: 'rgba(232,232,240,0.65)', lineHeight: 1.8, margin: i < 2 ? '0 0 16px' : 0 }}>{p}</p>
            ))}
          </div>
        </>
      )}

      {/* Story timeline */}
      {story?.milestones && (
        <>
          <div className="portal-section-divider" />
          <h2 style={{ fontSize: 20, fontWeight: 700, color: '#fff', marginBottom: 20 }}>The Journey</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 40 }}>
            {(story.milestones as Array<Record<string, string>>).map((m, i) => (
              <div key={i} style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>
                <div style={{
                  background: 'rgba(139,92,246,0.15)',
                  border: '1px solid rgba(139,92,246,0.3)',
                  borderRadius: 8,
                  padding: '4px 10px',
                  fontSize: 11, fontWeight: 700, color: '#a78bfa',
                  flexShrink: 0, whiteSpace: 'nowrap', marginTop: 2,
                }}>{m.year}</div>
                <div>
                  {m.title && <p style={{ fontSize: 14, fontWeight: 600, color: '#fff', margin: '0 0 4px' }}>{m.title}</p>}
                  {m.body && <p style={{ fontSize: 13, color: 'rgba(232,232,240,0.5)', margin: 0, lineHeight: 1.6 }}>{m.body}</p>}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </PortalLayout>
  );
}
