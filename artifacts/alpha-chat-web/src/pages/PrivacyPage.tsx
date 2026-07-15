interface Props { onBack: () => void; }

interface PrivacyRow {
  icon: React.ReactNode;
  label: string;
  description: string;
  soon?: boolean;
}

export default function PrivacyPage({ onBack }: Props) {
  const rows: PrivacyRow[] = [
    {
      icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>,
      label: "Ultimo accesso",
      description: "Chi può vedere quando sei stato online",
      soon: true,
    },
    {
      icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>,
      label: "Foto profilo",
      description: "Chi può vedere la tua foto profilo",
      soon: true,
    },
    {
      icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>,
      label: "Bio",
      description: "Chi può vedere la tua biografia",
      soon: true,
    },
    {
      icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>,
      label: "Utenti bloccati",
      description: "Gestisci gli utenti che hai bloccato",
      soon: true,
    },
    {
      icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>,
      label: "PIN di accesso",
      description: "Proteggi l'app con un PIN",
      soon: true,
    },
    {
      icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>,
      label: "Biometria",
      description: "Face ID / Touch ID per sbloccare",
      soon: true,
    },
    {
      icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>,
      label: "Messaggi effimeri",
      description: "Autodistruzione automatica dei messaggi",
      soon: true,
    },
    {
      icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>,
      label: "Verifica sicurezza Signal",
      description: "Verifica l'identità dei tuoi contatti",
      soon: true,
    },
  ];

  return (
    <div className="settings-root">
      <header className="settings-header">
        <button className="settings-back-btn" onClick={onBack} aria-label="Indietro">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <h1 className="settings-title">Privacy e Sicurezza</h1>
      </header>

      <div className="settings-body">
        <div className="privacy-hero">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="48" height="48">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
          </svg>
          <p className="privacy-hero-text">
            Alpha Chat è progettato con la privacy al centro. Le tue conversazioni sono protette dalla crittografia end-to-end.
          </p>
        </div>

        <div className="settings-section">
          <div className="settings-section-title">Controllo della privacy</div>
          {rows.map((row) => (
            <div key={row.label} className="settings-item coming-soon">
              <div className="settings-item-icon">{row.icon}</div>
              <div className="settings-item-content">
                <div className="settings-item-label">{row.label}</div>
                <div className="settings-item-value muted">{row.description}</div>
              </div>
              <span className="settings-item-badge">Presto</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
