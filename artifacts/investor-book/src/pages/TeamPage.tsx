import React from 'react';
import PortalLayout from '@/components/PortalLayout';
import { loadPortalSession } from '@/lib/portalSession';
import { useLang } from '@/context/LanguageContext';
import { team as T } from '@/lib/i18n';
import { en } from '@/content/en';
import { it } from '@/content/it';
import '@/components/portal-layout.css';

export default function TeamPage() {
  const session = loadPortalSession();
  const { lang } = useLang();
  const t = T[lang];
  const content = lang === 'it' ? it : en;
  const founder = content.founder;
  const letter  = content.founderLetter;
  const story   = content.story;

  return (
    <PortalLayout investorName={session?.investorName} sessionExpiry={session?.sessionExpiry}>
      <div className="portal-page-header">
        <p className="portal-page-eyebrow">{t.eyebrow}</p>
        <h1 className="portal-page-title">{t.title}</h1>
        <p className="portal-page-sub">{t.sub}</p>
      </div>

      {/* Founder card */}
      {founder && (
        <div className="portal-card" style={{ display: 'flex', gap: 32, flexWrap: 'wrap', marginBottom: 32, borderRadius: 20, padding: 32, borderColor: 'rgba(139,92,246,0.25)' }}>
          <img
            src={`${import.meta.env.BASE_URL}founder.png`}
            alt="Enrico Maria Giaquinta — Founder"
            style={{
              width: 100, height: 100, borderRadius: '50%',
              objectFit: 'cover', objectPosition: 'center top',
              flexShrink: 0,
              boxShadow: '0 0 30px rgba(124,58,237,0.45)',
              border: '2px solid rgba(139,92,246,0.35)',
            }}
          />
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
              <h2 className="portal-founder-name">{founder.name}</h2>
              <span className="portal-tag portal-tag-purple">{founder.role}</span>
            </div>
            {founder.tagline && <p className="portal-founder-tagline">"{founder.tagline}"</p>}
            {founder.bio && <p className="portal-card-body" style={{ margin: 0 }}>{founder.bio}</p>}
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

      {/* Founder letter */}
      {letter && (
        <>
          <div className="portal-section-divider" />
          <h2 className="portal-section-h2">{t.letterTitle}</h2>
          <div className="portal-quote-box" style={{ marginBottom: 32 }}>
            {letter.paragraphs && (letter.paragraphs as string[]).slice(0, 3).map((p: string, i: number) => (
              <p key={i} className="portal-quote-p" style={{ marginBottom: i < 2 ? 16 : 0 }}>{p}</p>
            ))}
          </div>
        </>
      )}

      {/* Story timeline */}
      {story?.milestones && (
        <>
          <div className="portal-section-divider" />
          <h2 className="portal-section-h2">{t.journeyTitle}</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 40 }}>
            {(story.milestones as Array<Record<string, string>>).map((m, i) => (
              <div key={i} style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>
                <div className="portal-year-badge">{m.year}</div>
                <div>
                  {m.title && <p className="portal-milestone-title">{m.title}</p>}
                  {m.body && <p className="portal-card-body" style={{ margin: 0 }}>{m.body}</p>}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </PortalLayout>
  );
}
