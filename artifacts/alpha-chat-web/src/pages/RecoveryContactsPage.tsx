/**
 * RecoveryContactsPage — Sprint 19
 * Gestione contatti fidati (max 5).
 */
import { useState, useEffect } from "react";
import { useAuth } from "../contexts/AuthContext";

interface Props { onBack: () => void }

interface Contact {
  id: string;
  name: string;
  email: string;
  relation: string | null;
  created_at: string;
}

const BASE = "/api/v1/recovery-contacts";
const MAX = 5;

export default function RecoveryContactsPage({ onBack }: Props) {
  const { auth } = useAuth();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState("");
  const [showForm, setShowForm] = useState(false);

  const [name, setName]         = useState("");
  const [email, setEmail]       = useState("");
  const [relation, setRelation] = useState("");
  const [saving, setSaving]     = useState(false);
  const [formError, setFormError] = useState("");

  useEffect(() => { void load(); }, []);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(BASE, { headers: { Authorization: `Bearer ${auth?.accessToken}` } });
      const data = await res.json() as { contacts: Contact[] };
      setContacts(data.contacts);
    } catch { setError("Errore di caricamento."); }
    finally { setLoading(false); }
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setFormError("");
    try {
      const res = await fetch(BASE, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${auth?.accessToken}` },
        body: JSON.stringify({ name, email, relation: relation || undefined }),
      });
      const data = await res.json();
      if (!res.ok) { setFormError(data.error?.message ?? "Errore."); return; }
      setContacts(c => [...c, data as Contact]);
      setName(""); setEmail(""); setRelation("");
      setShowForm(false);
    } catch { setFormError("Errore di connessione."); }
    finally { setSaving(false); }
  }

  async function remove(id: string) {
    if (!confirm("Rimuovere questo contatto?")) return;
    try {
      await fetch(`${BASE}/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${auth?.accessToken}` } });
      setContacts(c => c.filter(x => x.id !== id));
    } catch { setError("Errore durante la rimozione."); }
  }

  return (
    <div className="rc-root">
      <header className="settings-header">
        <button className="settings-back-btn" onClick={onBack} aria-label="Indietro">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="20" height="20"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <h1 className="settings-title">Recovery Contacts</h1>
      </header>

      <div className="rc-body">
        <div className="rc-hero">
          <p className="rc-desc">
            Fino a <strong>{MAX} contatti fidati</strong> che ricevono avvisi quando il Dead Man Switch si attiva.
            Non vedono mai i tuoi messaggi o i dati dell'account.
          </p>
        </div>

        {error && <div className="rc-error">{error}</div>}

        {loading ? (
          <div className="rc-loading">Caricamento…</div>
        ) : (
          <>
            {contacts.length === 0 && !showForm && (
              <div className="rc-empty">Nessun contatto configurato.</div>
            )}

            <div className="rc-list">
              {contacts.map(c => (
                <div key={c.id} className="rc-item">
                  <div className="rc-item-avatar">{c.name.charAt(0).toUpperCase()}</div>
                  <div className="rc-item-info">
                    <div className="rc-item-name">{c.name}</div>
                    <div className="rc-item-email">{c.email}</div>
                    {c.relation && <div className="rc-item-rel">{c.relation}</div>}
                  </div>
                  <button className="rc-remove-btn" onClick={() => void remove(c.id)} aria-label="Rimuovi">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
                  </button>
                </div>
              ))}
            </div>

            {showForm && (
              <form className="rc-form" onSubmit={add}>
                <input className="rc-input" placeholder="Nome" value={name} onChange={e => setName(e.target.value)} required maxLength={100} />
                <input className="rc-input" type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} required maxLength={254} />
                <input className="rc-input" placeholder="Relazione (es. avvocato) — opzionale" value={relation} onChange={e => setRelation(e.target.value)} maxLength={80} />
                {formError && <div className="rc-error">{formError}</div>}
                <div className="rc-form-actions">
                  <button type="button" className="rc-cancel-btn" onClick={() => { setShowForm(false); setFormError(""); }}>Annulla</button>
                  <button type="submit" className="rc-submit-btn" disabled={saving}>{saving ? "Aggiunta…" : "Aggiungi"}</button>
                </div>
              </form>
            )}

            {!showForm && contacts.length < MAX && (
              <button className="rc-add-btn" onClick={() => setShowForm(true)}>
                + Aggiungi contatto ({contacts.length}/{MAX})
              </button>
            )}
            {contacts.length >= MAX && (
              <div className="rc-limit-note">Hai raggiunto il limite di {MAX} contatti.</div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
