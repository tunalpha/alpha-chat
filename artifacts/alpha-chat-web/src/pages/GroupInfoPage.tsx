/**
 * GroupInfoPage — Sprint 21
 * Info gruppo, lista membri, azioni admin (aggiungi/rimuovi, promuovi, lascia/elimina).
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { useAuth } from "../contexts/AuthContext";
import {
  apiGetGroup,
  apiUpdateGroup,
  apiUploadGroupAvatar,
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
  onGroupRenamed?: (groupId: string, newName: string, avatarUrl?: string | null) => void;
  contacts?: Contact[];
  onlineUsers?: Set<string>; // userId → online
}

export default function GroupInfoPage({ groupId, onBack, onLeft, onGroupRenamed, contacts = [], onlineUsers = new Set() }: Props) {
  const { auth } = useAuth();
  const [group, setGroup]             = useState<GroupDetail | null>(null);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState<string | null>(null);
  const [addUsername, setAddUsername] = useState("");
  const [addError, setAddError]       = useState<string | null>(null);
  const [addLoading, setAddLoading]   = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [editName, setEditName]       = useState(false);
  const [nameInput, setNameInput]     = useState("");
  const [nameError, setNameError]     = useState<string | null>(null);
  const [confirmLeave, setConfirmLeave]   = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [avatarLoading, setAvatarLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  // ── Avatar upload ─────────────────────────────────────────────────────────

  /** Ridimensiona l'immagine a maxW×maxH con crop centrale, restituisce un Blob JPEG. */
  function resizeImageToBlob(file: File, maxW: number, maxH: number): Promise<Blob> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.max(maxW / img.width, maxH / img.height);
        const sw = maxW / scale;
        const sh = maxH / scale;
        const sx = (img.width  - sw) / 2;
        const sy = (img.height - sh) / 2;
        const canvas = document.createElement("canvas");
        canvas.width  = maxW;
        canvas.height = maxH;
        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, maxW, maxH);
        canvas.toBlob(
          (b) => { if (b) resolve(b); else reject(new Error("canvas toBlob failed")); },
          "image/jpeg", 0.88,
        );
        URL.revokeObjectURL(img.src);
      };
      img.onerror = () => { URL.revokeObjectURL(img.src); reject(new Error("image load failed")); };
      img.src = URL.createObjectURL(file);
    });
  }

  async function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) { alert("Seleziona un'immagine (jpg, png, webp)"); return; }
    setAvatarLoading(true);
    try {
      const resized  = await resizeImageToBlob(file, 256, 256);
      const mediaId  = await apiUploadGroupAvatar(groupId, resized);
      const updated  = await apiUpdateGroup(groupId, { avatar_media_id: mediaId });
      setGroup(updated);
      onGroupRenamed?.(groupId, updated.name, updated.avatar_url);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Errore upload avatar");
    } finally {
      setAvatarLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

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
          {/* Avatar cliccabile (solo admin) per cambio foto */}
          <div
            className={`gi-avatar${isAdmin ? " gi-avatar-editable" : ""}`}
            onClick={isAdmin ? () => fileInputRef.current?.click() : undefined}
            title={isAdmin ? "Cambia foto gruppo" : undefined}
          >
            {group.avatar_url ? (
              <img src={group.avatar_url} alt={group.name} className="gi-avatar-img" />
            ) : (
              group.name[0]?.toUpperCase() ?? "G"
            )}
            {isAdmin && (
              <div className="gi-avatar-overlay">
                {avatarLoading ? <span className="gi-avatar-spinner" /> : "📷"}
              </div>
            )}
          </div>
          {/* Input file nascosto */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            style={{ display: "none" }}
            onChange={handleAvatarChange}
          />

          <div className="gi-name-row">
            {editName ? (
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  const trimmed = nameInput.trim();
                  if (!trimmed) { setNameError("Il nome non può essere vuoto"); return; }
                  setNameError(null);
                  try {
                    const updated = await apiUpdateGroup(groupId, { name: trimmed });
                    setGroup(updated);
                    setEditName(false);
                    onGroupRenamed?.(groupId, updated.name, updated.avatar_url);
                  } catch (err) {
                    setNameError(err instanceof Error ? err.message : "Errore salvataggio");
                  }
                }}
                style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "stretch" }}
              >
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input
                    className="gi-name-input"
                    value={nameInput}
                    onChange={(e) => { setNameInput(e.target.value); setNameError(null); }}
                    maxLength={100}
                    autoFocus
                  />
                  <button type="submit" className="gi-name-save">✓</button>
                  <button type="button" className="gi-name-cancel" onClick={() => { setEditName(false); setNameError(null); }}>✕</button>
                </div>
                {nameError && <span style={{ color: "#f87171", fontSize: 12 }}>{nameError}</span>}
              </form>
            ) : (
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span className="gi-group-name">{group.name}</span>
                {isAdmin && (
                  <button className="gi-edit-btn" onClick={() => { setEditName(true); setNameInput(group.name); }} title="Modifica nome">✏️</button>
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

              const isOnline = onlineUsers.has(m.user_id);
              return (
                <div key={m.user_id} className="gi-member-row">
                  <div className="gi-member-avatar-wrap">
                    <div className="gi-member-avatar">{m.display_name[0]?.toUpperCase() ?? "?"}</div>
                    {isOnline && <span className="gi-member-online-dot" />}
                  </div>
                  <div className="gi-member-info">
                    <div className="gi-member-name">
                      {m.display_name}
                      {isSelf && <span className="gi-member-you"> (tu)</span>}
                    </div>
                    <div className="gi-member-username">
                      @{m.username}
                      {isOnline
                        ? <span className="gi-member-status online"> · Online</span>
                        : <span className="gi-member-status offline"> · Offline</span>}
                    </div>
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
