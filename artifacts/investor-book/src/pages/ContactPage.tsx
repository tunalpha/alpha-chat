import React, { useState } from 'react';
import PortalLayout from '@/components/PortalLayout';
import { loadPortalSession } from '@/lib/portalSession';
import { useLang } from '@/context/LanguageContext';
import { contact as T } from '@/lib/i18n';
import '@/components/portal-layout.css';

export default function ContactPage() {
  const session = loadPortalSession();
  const { lang } = useLang();
  const t = T[lang];
  const [form, setForm] = useState({ subject: '', message: '', name: session?.investorName ?? '' });
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);

  const handleSend = async () => {
    if (!form.subject || !form.message || !form.name) return;
    setSending(true);
    try {
      const base = import.meta.env.BASE_URL.replace(/\/$/, '');
      const r = await fetch(`${base}/api/v1/investor/contact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          investorName: form.name,
          subject: form.subject,
          message: form.message,
        }),
      });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        throw new Error((data as Record<string, string>).message || 'Send failed');
      }
      setSent(true);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Could not send message. Try again.');
    } finally {
      setSending(false);
    }
  };

  return (
    <PortalLayout investorName={session?.investorName} sessionExpiry={session?.sessionExpiry}>
      <div className="portal-page-header">
        <p className="portal-page-eyebrow">{t.eyebrow}</p>
        <h1 className="portal-page-title">{t.title}</h1>
        <p className="portal-page-sub">{t.sub}</p>
      </div>

      <div className="portal-card-grid" style={{ marginBottom: 48 }}>
        {t.options.map(o => (
          <div key={o.title} className="portal-card">
            <span className="portal-card-icon">{o.icon}</span>
            <h3 className="portal-card-title">{o.title}</h3>
            <p className="portal-card-body">{o.body}</p>
          </div>
        ))}
      </div>

      <div className="portal-section-divider" />

      {sent ? (
        <div style={{
          background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.25)',
          borderRadius: 16, padding: '32px', textAlign: 'center',
        }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>✅</div>
          <h3 className="portal-sent-title">{t.sentTitle}</h3>
          <p className="portal-sent-sub">{t.sentSub}</p>
        </div>
      ) : (
        <div style={{ maxWidth: 560 }}>
          <h2 className="portal-section-h2">{t.sendTitle}</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <label className="portal-form-label">{t.nameLabel}</label>
              <input
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder={t.namePH}
                className="portal-form-input"
              />
            </div>
            <div>
              <label className="portal-form-label">{t.subjectLabel}</label>
              <select
                value={form.subject}
                onChange={e => setForm(f => ({ ...f, subject: e.target.value }))}
                className="portal-form-input"
                style={{ color: form.subject ? 'var(--portal-text)' : 'var(--portal-text-muted)' }}
              >
                <option value="" disabled>{t.subjectPH}</option>
                {t.subjects.map(s => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="portal-form-label">{t.msgLabel}</label>
              <textarea
                value={form.message}
                onChange={e => setForm(f => ({ ...f, message: e.target.value }))}
                placeholder={t.msgPH}
                rows={5}
                className="portal-form-input"
                style={{ resize: 'vertical' }}
              />
            </div>
            <button
              onClick={handleSend}
              disabled={sending || !form.subject || !form.message || !form.name}
              className="portal-send-btn"
              style={{ opacity: (!form.subject || !form.message || !form.name) ? 0.5 : 1 }}
            >
              {sending ? t.sending : t.sendBtn}
            </button>
          </div>
        </div>
      )}
    </PortalLayout>
  );
}
