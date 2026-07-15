import type { StoredAuth } from "../lib/auth";

interface Props {
  auth: StoredAuth;
  onBack: () => void;
}

export default function ProfilePage({ auth, onBack }: Props) {
  const initial = auth.displayName?.[0]?.toUpperCase() ?? "?";

  return (
    <div className="settings-root">
      <header className="settings-header">
        <button className="settings-back-btn" onClick={onBack} aria-label="Indietro">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <h1 className="settings-title">Profilo</h1>
      </header>

      <div className="profile-hero">
        <div className="profile-avatar-wrap">
          <div className="avatar avatar-xl">{initial}</div>
          <button className="profile-avatar-edit" aria-label="Cambia avatar" disabled title="Disponibile prossimamente">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
              <circle cx="12" cy="13" r="4"/>
            </svg>
          </button>
        </div>
        <h2 className="profile-name">{auth.displayName}</h2>
        <p className="profile-username">@{auth.username}</p>
        <div className="profile-status-badge online">● Online</div>
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
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
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
