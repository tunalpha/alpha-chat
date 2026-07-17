/**
 * GroupInfoPage — Sprint 21
 * Info gruppo, lista membri, azioni admin (aggiungi/rimuovi, promuovi, lascia/elimina).
 */

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "../contexts/AuthContext";
import {
  apiGetGroup,
  apiAddGroupMember,
  apiRemoveGroupMember,
  apiLeaveGroup,
  apiDeleteGroup,
  apiChangeGroupMemberRole,
  type GroupDetail,
  type GroupMemberInfo,
} from "../lib/api";
import type { AppView } from "../App";

interface Contact {
  username: string;
  display_name: string;
}

interface Props {
  groupId: string;
  onBack: () => void;
  onNavigate: (view: AppView) => void;
  onLeft?: () => void; // chiamato dopo leaveGroup/deleteGroup
  contacts?: Contact[];
}

export default function GroupInfoPage({ groupId, onBack, onLeft, contacts = [] }: Props) {
  const { auth } = useAuth();
  const [group, setGroup]       = useState<GroupDetail | null>(null);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const [addUsername, setAddUsername] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [addLoading, setAddLoading] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [editName, setEditName] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const g = await apiGetGroup(groupId);
      setGroup(g);
      setNameInput(g.name);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Errore caricamento gruppo");
    } finally {
      setLoading(false);
    }
  }, [groupId]);

  useEffect(() => { void load(); }, [load]);

  const isAdmin = group?.my_role === "admin";

  async function handleAddMember(e: React.FormEvent) {
    e.preventDefault();
    if (!addUsername.trim()) return;
    setAddError(null);
    setAddLoading(true);
    try {
      const member = await apiAddGroupMember(groupId, addUsername.trim());
      setGroup((g) => g ? { ...g, members: [...g.members, member], member_count: g.member_count + 1 } : g);
      setAddUsername("");
    } catch (e) {
      setAddError(e instanceof Error ? e.message : "Errore aggiunta membro");
    } finally {
      setAddLoading(false);
    }
  }

  async function handleRemove(member: GroupMemberInfo) {
    if (!confirm(`Rimuovere ${member.display_name} dal gruppo?`)) return;
    try {
      await apiRemoveGroupMember(groupId, member.user_id);
      setGroup((g) => g ? {
        ...g,
        members: g.members.filter((m) => m.user_id !== member.user_id),
        member_count: g.member_count - 1,
      } : g);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Errore rimozione membro");
    }
  }

  async function handleRoleChange(member: GroupMemberInfo, role: "admin" | "member") {
    try {
      await apiChangeGroupMemberRole(groupId, member.user_id, role);
      setGroup((g) => g ? {
        ...g,
        members: g.members.map((m) => m.user_id === member.user_id ? { ...m, role } : m),
      } : g);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Errore cambio ruolo");
    }
  }

  async function handleLeave() {
    setActionLoading(true);
    try {
      await apiLeaveGroup(groupId);
      onLeft?.();
      onBack();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Errore uscita gruppo");
    } finally {
      setActionLoading(false);
      setConfirmLeave(false);
    }
  }

  async function handleDelete() {
    setActionLoading(true);
    try {
      await apiDeleteGroup(groupId);
      onLeft?.();
      onBack();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Errore eliminazione gruppo");
    } finally {
      setActionLoading(false);
      setConfirmDelete(false);
    }
  }

  if (loading) return (
    <div className="gi-root">
      <div className="gi-header"><button className="back-btn" onClick={onBack}>←</button></div>
      <div className="gi-body"><div className="gi-loading">Caricamento…</div></div>
    </div>
  );

  if (error || !group) return (
    <div className="gi-root">
      <div className="gi-header"><button className="back-btn" onClick={onBack}>←</button></div>
      <div className="gi-body"><div className="gi-error">{error ?? "Gruppo non trovato"}</div></div>
    </div>
  );

  return (
    <div className="gi-root">
      {/* Header */}
      <div className="gi-header">
        <button className="back-btn" onClick={onBack}>←</button>
        <span className="gi-title">Info gruppo</span>
      </div>

      <div className="gi-body">
        {/* Avatar + nome gruppo */}
        <div className="gi-hero">
          <div className="gi-avatar">{group.name[0]?.toUpperCase() ?? "G"}</div>
          <div className="gi-name-row">
            {editName ? (
              <form onSubmit={async (e) => {
                e.preventDefault();
                try {
                  const updated = await apiGetGroup(groupId);
                  setGroup({ ...updated, name: nameInput });
                  setEditName(false);
                } catch { setEditName(false); }
              }} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  className="gi-name-input"
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  maxLength={100}
                  autoFocus
                />
                <button type="submit" className="gi-name-save">✓</button>
                <button type="button" className="gi-name-cancel" onClick={() => setEditName(false)}>✕</button>
              </form>
            ) : (
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span className="gi-group-name">{group.name}</span>
                {isAdmin && (
                  <button className="gi-edit-btn" onClick={() => setEditName(true)} title="Modifica nome">✏️</button>
                )}
              </div>
            )}
          </div>
          {group.description && <p className="gi-description">{group.description}</p>}
          <div className="gi-meta">
            {group.member_count} di {group.max_members} partecipanti · Il tuo ruolo: <strong>{group.my_role === "admin" ? "👑 Admin" : "Membro"}</strong>
          </div>
        </div>

        {/* Aggiungi membro (solo admin) */}
        {isAdmin && (
          <div className="gi-section">
            <div className="gi-section-title">Aggiungi partecipante</div>
            <form onSubmit={handleAddMember} className="gi-add-form">
              <div className="gi-add-input-wrap">
                <input
                  className="gi-add-input"
                  type="text"
                  placeholder="Username o nome…"
                  value={addUsername}
                  autoComplete="off"
                  onChange={(e) => { setAddUsername(e.target.value); setAddError(null); setShowSuggestions(true); }}
                  onFocus={() => setShowSuggestions(true)}
                  onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                />
                {/* Suggestion dropdown — contatti esistenti filtrati */}
                {showSuggestions && addUsername.trim().length > 0 && (() => {
                  const q = addUsername.trim().toLowerCase();
                  const alreadyIn = new Set(group.members.map((m) => m.username));
                  const hits = contacts.filter(
                    (c) => !alreadyIn.has(c.username) &&
                      (c.username.toLowerCase().includes(q) || c.display_name.toLowerCase().includes(q)),
                  );
                  if (hits.length === 0) return null;
                  return (
                    <div className="gi-suggestions">
                      {hits.map((c) => (
                        <button
                          key={c.username}
                          type="button"
                          className="gi-suggestion-item"
                          onPointerDown={(e) => { e.preventDefault(); setAddUsername(c.username); setShowSuggestions(false); }}
                        >
                          <span className="gi-suggestion-name">{c.display_name}</span>
                          <span className="gi-suggestion-username">@{c.username}</span>
                        </button>
                      ))}
                    </div>
                  );
                })()}
              </div>
              <button type="submit" className="gi-add-btn" disabled={addLoading}>
                {addLoading ? "…" : "Aggiungi"}
              </button>
            </form>
            {addError && <div className="gi-add-error">{addError}</div>}
          </div>
        )}

        {/* Lista membri */}
        <div className="gi-section">
          <div className="gi-section-title">{group.member_count} Partecipanti</div>
          <div className="gi-members-list">
            {group.members.map((m) => {
              const isSelf    = m.user_id === auth?.userId;
              const isMemAdmin = m.role === "admin";

              return (
                <div key={m.user_id} className="gi-member-row">
                  <div className="gi-member-avatar">{m.display_name[0]?.toUpperCase() ?? "?"}</div>
                  <div className="gi-member-info">
                    <div className="gi-member-name">
                      {m.display_name}
                      {isSelf && <span className="gi-member-you"> (tu)</span>}
                    </div>
                    <div className="gi-member-username">@{m.username}</div>
                  </div>
                  <div className="gi-member-actions">
                    {isMemAdmin && <span className="gi-badge-admin">👑 Admin</span>}
                    {isAdmin && !isSelf && (
                      <>
                        <button
                          className="gi-action-btn"
                          onClick={() => handleRoleChange(m, isMemAdmin ? "member" : "admin")}
                          title={isMemAdmin ? "Rimuovi admin" : "Rendi admin"}
                        >
                          {isMemAdmin ? "↓" : "↑"}
                        </button>
                        <button
                          className="gi-action-btn gi-action-remove"
                          onClick={() => handleRemove(m)}
                          title="Rimuovi dal gruppo"
                        >✕</button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Azioni pericolose */}
        <div className="gi-danger-zone">
          {!confirmLeave ? (
            <button className="gi-danger-btn" onClick={() => setConfirmLeave(true)}>
              🚪 Lascia il gruppo
            </button>
          ) : (
            <div className="gi-confirm">
              <span>Sei sicuro di voler lasciare il gruppo?</span>
              <button className="gi-confirm-yes" onClick={handleLeave} disabled={actionLoading}>
                {actionLoading ? "…" : "Sì, lascia"}
              </button>
              <button className="gi-confirm-no" onClick={() => setConfirmLeave(false)}>Annulla</button>
            </div>
          )}

          {isAdmin && (
            !confirmDelete ? (
              <button className="gi-danger-btn gi-danger-delete" onClick={() => setConfirmDelete(true)}>
                🗑️ Elimina gruppo
              </button>
            ) : (
              <div className="gi-confirm">
                <span>Eliminare definitivamente il gruppo?</span>
                <button className="gi-confirm-yes" onClick={handleDelete} disabled={actionLoading}>
                  {actionLoading ? "…" : "Sì, elimina"}
                </button>
                <button className="gi-confirm-no" onClick={() => setConfirmDelete(false)}>Annulla</button>
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
}
