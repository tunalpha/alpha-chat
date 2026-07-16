/**
 * PrivacyOverlay — Sprint 17
 * Schermata nera quando l'app va in background / app switcher.
 */

export default function PrivacyOverlay() {
  return (
    <div className="privacy-overlay" aria-hidden="true">
      <div className="privacy-overlay-logo">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          width="48"
          height="48"
        >
          <rect x="3" y="11" width="18" height="11" rx="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
      </div>
      <div className="privacy-overlay-name">Alpha Chat</div>
    </div>
  );
}
