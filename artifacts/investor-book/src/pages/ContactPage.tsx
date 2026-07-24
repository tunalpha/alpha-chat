import React, { useState } from 'react';
import PortalLayout from '@/components/PortalLayout';
import { loadPortalSession } from '@/lib/portalSession';
import '@/components/portal-layout.css';

export default function ContactPage() {
  const session = loadPortalSession();
  const [form, setForm] = useState({ subject: '', message: '', name: session?.investorName ?? '' });
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);

  const options = [
    {
      icon: '📅',
      title: 'Prenota una call',
      body: 'Prenota una call introduttiva di 30 minuti con il team fondatore. Disponibilità su richiesta.',
    },
    {
      icon: '📊',
      title: 'Richiedi il Financial Model',
      body: 'Accedi al modello finanziario completo con proiezioni e KPI. Disponibile sotto NDA.',
    },
    {
      icon: '🔍',
      title: 'Due Diligence',
      body: 'Avvia una due diligence formale. Forniamo accesso completo ai dati di supporto.',
    },
    {
      icon: '💬',
      title: 'Domanda diretta',
      body: 'Usa il modulo qui sotto per inviare qualsiasi domanda al team. Risposta entro 24 ore.',
    },
  ];

  const handleSend = async () => {
    if (!form.subject || !form.message || !form.name) return;
    setSending(true);
    // Simulated send — il backend non ha ancora questo endpoint
    await new Promise(r => setTimeout(r, 800));
    setSending(false);
    setSent(true);
  };

  return (
    <PortalLayout investorName={session?.investorName} sessionExpiry={session?.sessionExpiry}>
      <div className="portal-page-header">
        <p className="portal-page-eyebrow">Contact &amp; Next Steps</p>
        <h1 className="portal-page-title">Parliamo</h1>
        <p className="portal-page-sub">
          Il team fondatore è disponibile per chiamate, domande e attività di due diligence.
          Tutte le comunicazioni avvengono in modo riservato.
        </p>
      </div>

      {/* Opzioni */}
      <div className="portal-card-grid" style={{ marginBottom: 48 }}>
        {options.map(o => (
          <div key={o.title} className="portal-card">
            <span className="portal-card-icon">{o.icon}</span>
            <h3 className="portal-card-title">{o.title}</h3>
            <p className="portal-card-body">{o.body}</p>
          </div>
        ))}
      </div>

      <div className="portal-section-divider" />

      {/* Form di contatto */}
      {sent ? (
        <div style={{
          background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.25)',
          borderRadius: 16, padding: '32px', textAlign: 'center',
        }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>✅</div>
          <h3 style={{ fontSize: 20, fontWeight: 700, color: 'var(--portal-text)', margin: '0 0 8px' }}>Messaggio inviato</h3>
          <p style={{ fontSize: 14, color: 'var(--portal-text-muted)', margin: 0 }}>
            Ti risponderemo entro 24 ore. Controlla la tua email.
          </p>
        </div>
      ) : (
        <div style={{ maxWidth: 560 }}>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: 'var(--portal-text)', marginBottom: 20 }}>
            Invia un messaggio
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <label className="portal-form-label">Il tuo nome</label>
              <input
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="Nome completo"
                className="portal-form-input"
              />
            </div>
            <div>
              <label className="portal-form-label">Oggetto</label>
              <select
                value={form.subject}
                onChange={e => setForm(f => ({ ...f, subject: e.target.value }))}
                className="portal-form-input"
                style={{ color: form.subject ? 'var(--portal-text)' : 'var(--portal-text-muted)' }}
              >
                <option value="" disabled>Seleziona un argomento…</option>
                <option value="call">Prenota una call</option>
                <option value="model">Richiedi il financial model</option>
                <option value="dd">Avvia due diligence</option>
                <option value="question">Domanda generale</option>
                <option value="other">Altro</option>
              </select>
            </div>
            <div>
              <label className="portal-form-label">Messaggio</label>
              <textarea
                value={form.message}
                onChange={e => setForm(f => ({ ...f, message: e.target.value }))}
                placeholder="Il tuo messaggio…"
                rows={5}
                className="portal-form-input"
                style={{ resize: 'vertical' }}
              />
            </div>
            <button
              onClick={handleSend}
              disabled={sending || !form.subject || !form.message || !form.name}
              style={{
                padding: '14px 24px',
                background: sending ? 'rgba(124,58,237,0.5)' : 'linear-gradient(135deg, #7c3aed, #6d28d9)',
                border: 'none', borderRadius: 10, color: '#fff', fontSize: 15, fontWeight: 600,
                cursor: sending ? 'not-allowed' : 'pointer',
                boxShadow: '0 4px 20px rgba(124,58,237,0.4)',
                transition: 'all 0.2s', alignSelf: 'flex-start',
                opacity: (!form.subject || !form.message || !form.name) ? 0.5 : 1,
              }}
            >
              {sending ? 'Invio in corso…' : 'Invia Messaggio →'}
            </button>
          </div>
        </div>
      )}
    </PortalLayout>
  );
}
