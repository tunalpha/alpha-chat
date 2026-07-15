interface Props { onBack: () => void; }

interface SettingRow {
  icon: React.ReactNode;
  label: string;
  value?: string;
  soon?: boolean;
}

export default function SettingsPage({ onBack }: Props) {
  const sections: { title: string; rows: SettingRow[] }[] = [
    {
      title: "Aspetto",
      rows: [
        {
          icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>,
          label: "Tema",
          value: "Scuro",
          soon: true,
        },
        {
          icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>,
          label: "Lingua",
          value: "Italiano",
          soon: true,
        },
        {
          icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20"><path d="M12 22c1.1 0 2-.9 2-2H10c0 1.1.9 2 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z"/></svg>,
          label: "Notifiche",
          value: "Attive",
          soon: true,
        },
      ],
    },
    {
      title: "Privacy",
      rows: [
        {
          icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>,
          label: "Privacy e Sicurezza",
          soon: true,
        },
        {
          icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>,
          label: "Blocco applicazione",
          soon: true,
        },
      ],
    },
    {
      title: "Dati",
      rows: [
        {
          icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>,
          label: "Download media",
          soon: true,
        },
        {
          icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>,
          label: "Archiviazione",
          soon: true,
        },
      ],
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
        <h1 className="settings-title">Impostazioni</h1>
      </header>

      <div className="settings-body">
        {sections.map((section) => (
          <div key={section.title} className="settings-section">
            <div className="settings-section-title">{section.title}</div>
            {section.rows.map((row) => (
              <div key={row.label} className={`settings-item${row.soon ? " coming-soon" : ""}`}>
                <div className="settings-item-icon">{row.icon}</div>
                <div className="settings-item-content">
                  <div className="settings-item-label">{row.label}</div>
                  {row.value && <div className="settings-item-value muted">{row.value}</div>}
                </div>
                {row.soon
                  ? <span className="settings-item-badge">Presto</span>
                  : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16" className="settings-item-chevron"><polyline points="9 18 15 12 9 6"/></svg>
                }
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
