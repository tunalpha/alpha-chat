/**
 * CreateGroupModal — Sprint 21
 * Modal per creare un gruppo E2E con nome, descrizione opzionale e lista membri.
 */

import { useState } from "react";
import { apiCreateGroup } from "../lib/api";

interface Props {
  onClose: () => void;
  onCreated: (groupId: string) => void;
}

export default function CreateGroupModal({ onClose, onCreated }: Props) {
  const [name, setName]               = useState("");
  const [description, setDescription] = useState("");
  const [usernameInput, setUsernameInput] = useState("");
  const [members, setMembers]         = useState<string[]>([]);
  const [error, setError]             = useState<string | null>(null);
  const [loading, setLoading]         = useState(false);

  function addMember() {
    const u = usernameInput.trim().toLowerCase();
    if (!u) return;
    if (members.includes(u)) { setError("Utente già aggiunto"); return; }
    setMembers((prev) => [...prev, u]);
    setUsernameInput("");
    setError(null);
  }

  function removeMember(username: string) {
    setMembers((prev) => prev.filter((m) => m !== username));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setError("Il nome del gruppo è obbligatorio"); return; }
    if (members.length === 0) { setError("Aggiungi almeno un membro"); return; }
    setError(null);
    setLoading(true);
    try {
      const group = await apiCreateGroup(name.trim(), description.trim(), members);
      onCreated(group.group_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Errore creazione gruppo");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card cg-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="modal-header">
          <span className="modal-title">👥 Nuovo gruppo</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <form onSubmit={handleSubmit} className="cg-form">
          {/* Nome gruppo */}
          <div className="cg-field">
            <label className="cg-label">Nome gruppo *</label>
            <input
              className="cg-input"
              type="text"
              placeholder="es. Amici, Team dev…"
              maxLength={100}
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>

          {/* Descrizione */}
          <div className="cg-field">
            <label className="cg-label">Descrizione <span style={{ color: "var(--text-3)" }}>(opzionale)</span></label>
            <input
              className="cg-input"
              type="text"
              placeholder="Di cosa parla questo gruppo?"
              maxLength={300}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          {/* Aggiungi membri */}
          <div className="cg-field">
            <label className="cg-label">Membri *</label>
            <div className="cg-add-row">
              <input
                className="cg-input"
                type="text"
                placeholder="Username (es. alice)"
                value={usernameInput}
                onChange={(e) => setUsernameInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addMember(); } }}
              />
              <button type="button" className="cg-add-btn" onClick={addMember}>
                Aggiungi
              </button>
            </div>
          </div>

          {/* Lista membri */}
          {members.length > 0 && (
            <div className="cg-members">
              {members.map((m) => (
                <div key={m} className="cg-member-chip">
                  <span className="cg-chip-avatar">{m[0]?.toUpperCase()}</span>
                  <span className="cg-chip-name">{m}</span>
                  <button
                    type="button"
                    className="cg-chip-remove"
                    onClick={() => removeMember(m)}
                    title="Rimuovi"
                  >✕</button>
                </div>
              ))}
            </div>
          )}

          {error && <div className="cg-error">{error}</div>}

          {/* Submit */}
          <button
            type="submit"
            className="cg-submit"
            disabled={loading || !name.trim() || members.length === 0}
          >
            {loading ? "Creazione…" : `Crea gruppo (${members.length + 1} partecipanti)`}
          </button>
        </form>
      </div>
    </div>
  );
}
