import React, { useState } from 'react';
import PortalLayout from '@/components/PortalLayout';
import { loadPortalSession } from '@/lib/portalSession';
import '@/components/portal-layout.css';

export default function ContactPage() {
  const session = loadPortalSession();
  const [form, setForm] = useState({ subject: '', message: '', name: session?.investorName ?? '' });
  const [sent, setSent] = useState(false);

  const options = [
    { icon: '📅', title: 'Schedule a Call', body: 'Book a 30-minute intro call with the founding team.' },
    { icon: '📊', title: 'Request Financial Model', body: 'Request the full financial model and projections under NDA.' },
    { icon: '🔍', title: 'Due Diligence', body: 'Initiate formal due diligence. We provide full access to supporting data.' },
    { icon: '📧', title: 'Direct Email', body: 'investors@alphachat.sbs — we respond within 24 hours.' },
  ];

  return (
    <PortalLayout investorName={session?.investorName} sessionExpiry={session?.sessionExpiry}>
      <div className="portal-page-header">
        <p className="portal-page-eyebrow">Contact & Next Steps</p>
        <h1 className="portal-page-title">Let's Talk</h1>
        <p className="portal-page-sub">
          Ready to explore further? The founding team is available for calls, questions and due diligence.
        </p>
      </div>

      {/* Options */}
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

      {/* Simple contact form */}
      {sent ? (
        <div style={{
          background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.25)',
          borderRadius: 16, padding: '32px', textAlign: 'center',
        }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>✅</div>
          <h3 style={{ fontSize: 20, fontWeight: 700, color: '#fff', margin: '0 0 8px' }}>Message Sent</h3>
          <p style={{ fontSize: 14, color: 'rgba(232,232,240,0.5)', margin: 0 }}>
            We'll be in touch within 24 hours. Check your email for confirmation.
          </p>
        </div>
      ) : (
        <div style={{ maxWidth: 560 }}>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: '#fff', marginBottom: 20 }}>Send a Message</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, color: 'rgba(232,232,240,0.4)', textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>Your Name</label>
              <input
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="Full name"
                style={{
                  width: '100%', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(139,92,246,0.2)',
                  borderRadius: 10, padding: '12px 16px', fontSize: 14, color: '#e8e8f0',
                  outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit',
                }}
              />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, color: 'rgba(232,232,240,0.4)', textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>Subject</label>
              <select
                value={form.subject}
                onChange={e => setForm(f => ({ ...f, subject: e.target.value }))}
                style={{
                  width: '100%', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(139,92,246,0.2)',
                  borderRadius: 10, padding: '12px 16px', fontSize: 14, color: form.subject ? '#e8e8f0' : 'rgba(232,232,240,0.35)',
                  outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit',
                }}
              >
                <option value="" disabled>Select a topic…</option>
                <option value="call">Schedule a call</option>
                <option value="model">Request financial model</option>
                <option value="dd">Start due diligence</option>
                <option value="question">General question</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, color: 'rgba(232,232,240,0.4)', textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>Message</label>
              <textarea
                value={form.message}
                onChange={e => setForm(f => ({ ...f, message: e.target.value }))}
                placeholder="Your message…"
                rows={5}
                style={{
                  width: '100%', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(139,92,246,0.2)',
                  borderRadius: 10, padding: '12px 16px', fontSize: 14, color: '#e8e8f0',
                  outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit', resize: 'vertical',
                }}
              />
            </div>
            <button
              onClick={() => { if (form.subject && form.message) setSent(true); }}
              style={{
                padding: '14px 24px', background: 'linear-gradient(135deg, #7c3aed, #6d28d9)',
                border: 'none', borderRadius: 10, color: '#fff', fontSize: 15, fontWeight: 600,
                cursor: 'pointer', boxShadow: '0 4px 20px rgba(124,58,237,0.4)',
                transition: 'all 0.2s', alignSelf: 'flex-start',
              }}
            >
              Send Message →
            </button>
          </div>
        </div>
      )}
    </PortalLayout>
  );
}
