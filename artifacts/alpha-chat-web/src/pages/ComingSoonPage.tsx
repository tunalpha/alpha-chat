interface Props {
  title: string;
  description?: string;
  onBack: () => void;
}

export default function ComingSoonPage({ title, description, onBack }: Props) {
  return (
    <div className="settings-root">
      <header className="settings-header">
        <button className="settings-back-btn" onClick={onBack} aria-label="Indietro">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <h1 className="settings-title">{title}</h1>
      </header>

      <div className="coming-soon-body">
        <div className="coming-soon-icon">🚀</div>
        <h2 className="coming-soon-heading">{title}</h2>
        <p className="coming-soon-text">
          {description ?? "Questa funzione sarà disponibile nei prossimi sprint."}
        </p>
        <div className="coming-soon-badge">Alpha Chat M2</div>
      </div>
    </div>
  );
}
