import { useTranslation } from "react-i18next";
import { SUPPORTED_LANGUAGES, type LangCode } from "../i18n";
import { useAppSettings } from "../contexts/AppSettingsContext";

interface Props { onBack: () => void; }

export default function LanguagePage({ onBack }: Props) {
  const { t } = useTranslation();
  const { settings, setLanguage } = useAppSettings();

  async function handleSelect(code: LangCode) {
    await setLanguage(code);
  }

  return (
    <div className="language-page">
      <div className="language-header">
        <button className="language-back" onClick={onBack}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="20" height="20"><path d="M15 18l-6-6 6-6"/></svg>
        </button>
        <h1 className="language-title">{t("settings.language")}</h1>
      </div>

      <div className="language-body">
        {SUPPORTED_LANGUAGES.map(lang => (
          <button
            key={lang.code}
            className={`language-row ${settings.language === lang.code ? "active" : ""}`}
            onClick={() => void handleSelect(lang.code as LangCode)}
          >
            <span className="language-flag">{lang.flag}</span>
            <span className="language-label">{lang.label}</span>
            {lang.dir === "rtl" && <span className="language-rtl-badge">RTL</span>}
            {settings.language === lang.code && (
              <svg className="language-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="18" height="18"><path d="M5 12l5 5L19 7"/></svg>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
