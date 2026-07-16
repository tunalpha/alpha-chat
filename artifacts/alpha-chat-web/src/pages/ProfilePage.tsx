/**
 * ProfilePage — Sprint 24
 * Upload avatar: tap sulla foto → file input → comprimi → PATCH /api/v1/users/me
 */

import { useRef, useState } from "react";
import type { StoredAuth } from "../lib/auth";
import { updateStoredAvatarUrl } from "../lib/auth";
import { apiUpdateMe } from "../lib/api";

interface Props {
  auth: StoredAuth;
  onBack: () => void;
  onAuthUpdate?: (patch: Partial<StoredAuth>) => void;
}

/** Comprimi immagine a max 256 px, JPEG 80%, con timeout di sicurezza (3 s). */
async function compressAvatar(file: File): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    const fallback = setTimeout(() => {
      URL.revokeObjectURL(url);
      // Fallback: leggi direttamente come data URL
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target?.result as string ?? "");
      reader.readAsDataURL(file);
    }, 3000);

    img.onload = () => {
      clearTimeout(fallback);
      URL.revokeObjectURL(url);
      const MAX = 256;
      let { width, height } = img;
      if (width > MAX || height > MAX) {
        if (width >= height) { height = Math.round(height * MAX / width); width = MAX; }
        else                  { width  = Math.round(width  * MAX / height); height = MAX; }
      }
      const canvas = document.createElement("canvas");
      canvas.width  = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) { clearTimeout(fallback); resolve(""); return; }
      ctx.drawImage(img, 0, 0, width, height);
      const blobTimeout = setTimeout(() => {
        clearTimeout(fallback);
        resolve(canvas.toDataURL("image/jpeg", 0.8));
      }, 2000);
      canvas.toBlob((blob) => {
        clearTimeout(blobTimeout);
        clearTimeout(fallback);
        if (!blob) { resolve(canvas.toDataURL("image/jpeg", 0.8)); return; }
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target?.result as string ?? "");
        reader.readAsDataURL(blob);
      }, "image/jpeg", 0.8);
    };
    img.onerror = () => { clearTimeout(fallback); URL.revokeObjectURL(url); resolve(""); };
    img.src = url;
  });
}

export default function ProfilePage({ auth, onBack, onAuthUpdate }: Props) {
  const initial   = auth.displayName?.[0]?.toUpperCase() ?? "?";
  const fileRef   = useRef<HTMLInputElement>(null);
  const [avatarUrl, setAvatarUrl]   = useState<string | null>(auth.avatarUrl ?? null);
  const [uploading, setUploading]   = useState(false);
  const [uploadErr, setUploadErr]   = useState<string | null>(null);

  async function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";  // reset per permitteere di ri-selezionare la stessa foto

    if (!file.type.startsWith("image/")) {
      setUploadErr("Seleziona un'immagine.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setUploadErr("Immagine troppo grande (max 10 MB).");
      return;
    }

    setUploading(true);
    setUploadErr(null);
    try {
      const dataUrl = await compressAvatar(file);
      if (!dataUrl) throw new Error("Compressione fallita");

      const result = await apiUpdateMe({ avatar_url: dataUrl });
      setAvatarUrl(result.avatar_url);
      updateStoredAvatarUrl(result.avatar_url);
      onAuthUpdate?.({ avatarUrl: result.avatar_url });
    } catch (err) {
      setUploadErr(err instanceof Error ? err.message : "Errore caricamento");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="settings-root">
      <header className="settings-header">
        <button className="settings-back-btn" onClick={onBack} aria-label="Indietro">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
               strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <h1 className="settings-title">Profilo</h1>
      </header>

      <div className="profile-hero">
        <div className="profile-avatar-wrap">
          {/* Avatar — immagine se caricata, altrimenti iniziale */}
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt={auth.displayName}
              className="avatar avatar-xl profile-avatar-img"
            />
          ) : (
            <div className="avatar avatar-xl">{initial}</div>
          )}

          {/* Bottone fotocamera */}
          <button
            className={`profile-avatar-edit${uploading ? " profile-avatar-edit--loading" : ""}`}
            aria-label="Cambia avatar"
            disabled={uploading}
            onClick={() => fileRef.current?.click()}
          >
            {uploading
              ? <span className="profile-avatar-spinner" />
              : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
                  <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                  <circle cx="12" cy="13" r="4"/>
                </svg>
              )
            }
          </button>

          {/* Input nascosto */}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            style={{ display: "none" }}
            onChange={handleAvatarChange}
          />
        </div>

        <h2 className="profile-name">{auth.displayName}</h2>
        <p className="profile-username">@{auth.username}</p>
        <div className="profile-status-badge online">● Online</div>

        {uploadErr && (
          <p className="profile-upload-err">{uploadErr}</p>
        )}
      </div>

      <div className="settings-section">
        <div className="settings-section-title">Informazioni</div>

        <div className="settings-item">
          <div className="settings-item-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
              <circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>
            </svg>
          </div>
          <div className="settings-item-content">
            <div className="settings-item-label">Nome</div>
            <div className="settings-item-value">{auth.displayName}</div>
          </div>
        </div>

        <div className="settings-item">
          <div className="settings-item-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
              <rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 9h6M9 13h4"/>
            </svg>
          </div>
          <div className="settings-item-content">
            <div className="settings-item-label">Username</div>
            <div className="settings-item-value">@{auth.username}</div>
          </div>
        </div>

        <div className="settings-item coming-soon" aria-disabled="true">
          <div className="settings-item-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
              <line x1="16" y1="13" x2="8" y2="13"/>
              <line x1="16" y1="17" x2="8" y2="17"/>
            </svg>
          </div>
          <div className="settings-item-content">
            <div className="settings-item-label">Bio</div>
            <div className="settings-item-value muted">Disponibile prossimamente</div>
          </div>
          <span className="settings-item-badge">Presto</span>
        </div>

        <div className="settings-item coming-soon" aria-disabled="true">
          <div className="settings-item-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
            </svg>
          </div>
          <div className="settings-item-content">
            <div className="settings-item-label">Personalizzazione profilo</div>
            <div className="settings-item-value muted">Disponibile prossimamente</div>
          </div>
          <span className="settings-item-badge">Presto</span>
        </div>
      </div>
    </div>
  );
}
