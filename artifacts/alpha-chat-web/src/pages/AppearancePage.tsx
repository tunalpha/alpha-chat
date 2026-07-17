import { useTranslation } from "react-i18next";
import {
  useAppSettings,
  type Theme,
  type AccentColor,
  type TextSize,
  type BubbleSize,
  type MotionLevel,
} from "../contexts/AppSettingsContext";

interface Props { onBack: () => void; }

// ─── Accent presets ──────────────────────────────────────────────────────────
const ACCENTS: { value: AccentColor; emoji: string; label: string; color: string }[] = [
  { value: "violet",  emoji: "💜", label: "Viola Alpha", color: "#7C3AED" },
  { value: "blue",    emoji: "💙", label: "Blu",         color: "#2563EB" },
  { value: "green",   emoji: "💚", label: "Verde",       color: "#16A34A" },
  { value: "red",     emoji: "❤️", label: "Rosso",      color: "#DC2626" },
  { value: "cyan",    emoji: "🩵", label: "Azzurro",    color: "#0891B2" },
  { value: "orange",  emoji: "🧡", label: "Arancione",  color: "#EA580C" },
  { value: "pink",    emoji: "🩷", label: "Rosa",       color: "#DB2777" },
  { value: "gray",    emoji: "⚪", label: "Grigio",     color: "#6B7280" },
];

// ─── Wallpaper presets ────────────────────────────────────────────────────────
const WALLPAPERS: { value: string; label: string; preview: string }[] = [
  { value: "none",                                                   label: "Nessuno",         preview: "" },
  { value: "linear-gradient(135deg,#1a0533,#0f0a1e)",               label: "Viola notte",      preview: "linear-gradient(135deg,#1a0533,#0f0a1e)" },
  { value: "linear-gradient(135deg,#0a1628,#1e3a5f)",               label: "Oceano scuro",     preview: "linear-gradient(135deg,#0a1628,#1e3a5f)" },
  { value: "linear-gradient(135deg,#0d1f0d,#1a3d1a)",               label: "Foresta",          preview: "linear-gradient(135deg,#0d1f0d,#1a3d1a)" },
  { value: "linear-gradient(135deg,#1f0d0d,#3d1a1a)",               label: "Rosso militare",   preview: "linear-gradient(135deg,#1f0d0d,#3d1a1a)" },
  { value: "linear-gradient(135deg,#0d0d0d,#1a1a1a)",               label: "AMOLED puro",      preview: "linear-gradient(135deg,#0d0d0d,#1a1a1a)" },
  { value: "linear-gradient(135deg,#1a1a2e,#16213e,#0f3460)",       label: "Galaxy",           preview: "linear-gradient(135deg,#1a1a2e,#16213e,#0f3460)" },
  { value: "linear-gradient(135deg,#2d1b69,#11998e)",               label: "Aurora",           preview: "linear-gradient(135deg,#2d1b69,#11998e)" },
];

export default function AppearancePage({ onBack }: Props) {
  const { t } = useTranslation();
  const { settings, setTheme, setAccent, setTextSize, setBubbleSize, setMotion, setWallpaper } = useAppSettings();

  const themes: { value: Theme; label: string; icon: string }[] = [
    { value: "dark",   label: t("appearance.dark"),   icon: "🌙" },
    { value: "light",  label: t("appearance.light"),  icon: "☀️" },
    { value: "system", label: t("appearance.system"), icon: "📱" },
    { value: "amoled", label: t("appearance.amoled"), icon: "⚫" },
  ];

  const textSizes: { value: TextSize; label: string }[] = [
    { value: "small",   label: t("appearance.textSizeSmall") },
    { value: "normal",  label: t("appearance.textSizeNormal") },
    { value: "large",   label: t("appearance.textSizeLarge") },
    { value: "x-large", label: t("appearance.textSizeXLarge") },
  ];

  const bubbleSizes: { value: BubbleSize; label: string }[] = [
    { value: "compact", label: t("appearance.bubbleSizeCompact") },
    { value: "normal",  label: t("appearance.bubbleSizeNormal") },
    { value: "wide",    label: t("appearance.bubbleSizeWide") },
  ];

  const motions: { value: MotionLevel; label: string }[] = [
    { value: "normal",  label: t("appearance.animationsNormal") },
    { value: "reduced", label: t("appearance.animationsReduced") },
    { value: "none",    label: t("appearance.animationsNone") },
  ];

  function handleWallpaperUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const data = ev.target?.result as string;
      setWallpaper(`url("${data}")`);
    };
    reader.readAsDataURL(file);
  }

  return (
    <div className="appearance-page">
      {/* Header */}
      <div className="appearance-header">
        <button className="appearance-back" onClick={onBack}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="20" height="20"><path d="M15 18l-6-6 6-6"/></svg>
        </button>
        <h1 className="appearance-title">{t("appearance.title")}</h1>
      </div>

      <div className="appearance-body">

        {/* Tema */}
        <section className="appearance-section">
          <h2 className="appearance-section-title">{t("appearance.theme")}</h2>
          <p className="appearance-section-desc">{t("appearance.themeDesc")}</p>
          <div className="appearance-grid-4">
            {themes.map(th => (
              <button
                key={th.value}
                className={`appearance-option-btn ${settings.theme === th.value ? "active" : ""}`}
                onClick={() => setTheme(th.value)}
              >
                <span className="appearance-option-icon">{th.icon}</span>
                <span className="appearance-option-label">{th.label}</span>
              </button>
            ))}
          </div>
        </section>

        {/* Colore principale */}
        <section className="appearance-section">
          <h2 className="appearance-section-title">{t("appearance.accentColor")}</h2>
          <p className="appearance-section-desc">{t("appearance.accentColorDesc")}</p>
          <div className="accent-grid">
            {ACCENTS.map(a => (
              <button
                key={a.value}
                className={`accent-swatch ${settings.accent === a.value ? "active" : ""}`}
                style={{ background: a.color }}
                onClick={() => setAccent(a.value)}
                aria-label={a.label}
                title={a.label}
              >
                {settings.accent === a.value && (
                  <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" width="14" height="14"><path d="M5 12l5 5L19 7"/></svg>
                )}
              </button>
            ))}
          </div>
        </section>

        {/* Dimensione testo */}
        <section className="appearance-section">
          <h2 className="appearance-section-title">{t("appearance.textSize")}</h2>
          <div className="appearance-grid-4">
            {textSizes.map(s => (
              <button
                key={s.value}
                className={`appearance-option-btn ${settings.textSize === s.value ? "active" : ""}`}
                onClick={() => setTextSize(s.value)}
              >
                <span className="appearance-option-label">{s.label}</span>
              </button>
            ))}
          </div>
          <div className="appearance-preview-text">
            Aa — {textSizes.find(s => s.value === settings.textSize)?.label}
          </div>
        </section>

        {/* Dimensione bolle */}
        <section className="appearance-section">
          <h2 className="appearance-section-title">{t("appearance.bubbleSize")}</h2>
          <div className="appearance-grid-3">
            {bubbleSizes.map(s => (
              <button
                key={s.value}
                className={`appearance-option-btn ${settings.bubbleSize === s.value ? "active" : ""}`}
                onClick={() => setBubbleSize(s.value)}
              >
                <span className="appearance-option-label">{s.label}</span>
              </button>
            ))}
          </div>
        </section>

        {/* Animazioni */}
        <section className="appearance-section">
          <h2 className="appearance-section-title">{t("appearance.animations")}</h2>
          <div className="appearance-grid-3">
            {motions.map(m => (
              <button
                key={m.value}
                className={`appearance-option-btn ${settings.motion === m.value ? "active" : ""}`}
                onClick={() => setMotion(m.value)}
              >
                <span className="appearance-option-label">{m.label}</span>
              </button>
            ))}
          </div>
        </section>

        {/* Sfondo chat */}
        <section className="appearance-section">
          <h2 className="appearance-section-title">{t("appearance.wallpaper")}</h2>
          <div className="wallpaper-grid">
            {WALLPAPERS.map(w => (
              <button
                key={w.value}
                className={`wallpaper-swatch ${(settings.wallpaper ?? "none") === w.value || (w.value === "none" && !settings.wallpaper) ? "active" : ""}`}
                style={w.preview ? { background: w.preview } : { background: "var(--bg-3)", border: "1px dashed var(--border-2)" }}
                onClick={() => setWallpaper(w.value === "none" ? null : w.value)}
                title={w.label}
              >
                {!w.preview && <span style={{ fontSize: 16 }}>✕</span>}
                {(settings.wallpaper ?? "none") === w.value || (w.value === "none" && !settings.wallpaper) ? (
                  <span className="wallpaper-check">✓</span>
                ) : null}
              </button>
            ))}
            {/* Upload immagine personalizzata */}
            <label className="wallpaper-swatch wallpaper-upload" title={t("appearance.wallpaperCustom")}>
              <span style={{ fontSize: 20 }}>📷</span>
              <input type="file" accept="image/*" style={{ display: "none" }} onChange={handleWallpaperUpload} />
            </label>
          </div>
        </section>

      </div>
    </div>
  );
}
