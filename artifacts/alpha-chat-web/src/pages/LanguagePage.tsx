import { useState } from "react";
import { useTranslation } from "react-i18next";
import { SUPPORTED_LANGUAGES, type LangCode } from "../i18n";
import { useAppSettings } from "../contexts/AppSettingsContext";

interface Props { onBack: () => void; }

export default function LanguagePage({ onBack }: Props) {
  const { t } = useTranslation();
  const { settings, setLanguage } = useAppSettings();
  const [applying, setApplying] = useState<LangCode | null>(null);
  const [applied, setApplied]   = useState<LangCode | null>(null);

  async function handleSelect(code: LangCode) {
    if (applying || code === settings.language) return;

    setApplying(code);
    try {
      await setLanguage(code);
      setApplied(code);
      // Feedback visivo per 900ms, poi torna alle impostazioni
      setTimeout(() => {
        setApplying(null);
        setApplied(null);
        onBack();
      }, 900);
    } catch {
      setApplying(null);
    }
  }

  return (
    <div className="language-page">
      <div className="language-header">
        <button className="language-back" onClick={onBack} disabled={!!applying}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="20" height="20"><path d="M15 18l-6-6 6-6"/></svg>
        </button>
        <h1 className="language-title">{t("settings.language")}</h1>
      </div>

      <div className="language-body">
        {SUPPORTED_LANGUAGES.map(lang => {
          const code = lang.code as LangCode;
          const isActive  = settings.language === code;
          const isApplied = applied === code;
          const isLoading = applying === code;

          return (
            <button
              key={code}
              className={`language-row ${isActive || isApplied ? "active" : ""} ${isLoading ? "loading" : ""}`}
              onClick={() => void handleSelect(code)}
              disabled={!!applying}
            >
              <span className="language-flag">{lang.flag}</span>
              <span className="language-label">{lang.label}</span>

              {lang.dir === "rtl" && !isLoading && (
                <span className="language-rtl-badge">RTL</span>
              )}

              <span className="language-trailing">
                {isLoading ? (
                  <span className="language-spinner" />
                ) : isApplied ? (
                  <span className="language-applied-badge">✓</span>
                ) : (isActive && (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="18" height="18"><path d="M5 12l5 5L19 7"/></svg>
                ))}
              </span>
            </button>
          );
        })}
      </div>

      {/* Banner informativo */}
      <div className="language-info">
        <span>⚡ </span>
        {t("appearance.preview")}
      </div>
    </div>
  );
}
