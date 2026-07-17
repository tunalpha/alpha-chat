import i18n from "i18next";
import { initReactI18next } from "react-i18next";

// Lazy-loaded locale resources
const resources: Record<string, () => Promise<{ default: Record<string, unknown> }>> = {
  it: () => import("./locales/it.json"),
  en: () => import("./locales/en.json"),
  es: () => import("./locales/es.json"),
  fr: () => import("./locales/fr.json"),
  de: () => import("./locales/de.json"),
  pt: () => import("./locales/pt.json"),
  ar: () => import("./locales/ar.json"),
  ru: () => import("./locales/ru.json"),
  zh: () => import("./locales/zh.json"),
  ja: () => import("./locales/ja.json"),
};

export const SUPPORTED_LANGUAGES = [
  { code: "it", label: "Italiano",    flag: "🇮🇹", dir: "ltr" },
  { code: "en", label: "English",     flag: "🇬🇧", dir: "ltr" },
  { code: "es", label: "Español",     flag: "🇪🇸", dir: "ltr" },
  { code: "fr", label: "Français",    flag: "🇫🇷", dir: "ltr" },
  { code: "de", label: "Deutsch",     flag: "🇩🇪", dir: "ltr" },
  { code: "pt", label: "Português",   flag: "🇵🇹", dir: "ltr" },
  { code: "ar", label: "العربية",     flag: "🇸🇦", dir: "rtl" },
  { code: "ru", label: "Русский",     flag: "🇷🇺", dir: "ltr" },
  { code: "zh", label: "中文",         flag: "🇨🇳", dir: "ltr" },
  { code: "ja", label: "日本語",       flag: "🇯🇵", dir: "ltr" },
] as const;

export type LangCode = typeof SUPPORTED_LANGUAGES[number]["code"];

async function loadLocale(lng: string) {
  const loader = resources[lng];
  if (!loader) return {};
  const mod = await loader();
  return mod.default ?? mod;
}

/** Restituisce la lingua da usare, in ordine di priorità:
 *  1. Preferenza esplicitamente salvata dall'utente in localStorage
 *  2. Lingua del browser (navigator.languages / navigator.language)
 *  3. Italiano come fallback finale
 */
function getSavedLang(): LangCode {
  try {
    const s = JSON.parse(localStorage.getItem("alpha_settings_v1") ?? "{}") as { language?: string };

    // 1. L'utente ha già scelto una lingua esplicitamente
    if (s.language && SUPPORTED_LANGUAGES.find(l => l.code === s.language)) {
      return s.language as LangCode;
    }

    // 2. Prima visita: rileva la lingua del browser
    const browserLangs = navigator.languages?.length
      ? navigator.languages
      : [navigator.language];

    for (const raw of browserLangs) {
      // "ar-SA" → "ar", "zh-TW" → "zh", "fr-FR" → "fr"
      const code = raw.split("-")[0].toLowerCase();
      if (SUPPORTED_LANGUAGES.find(l => l.code === code)) {
        return code as LangCode;
      }
    }
  } catch { /* ignore */ }

  // 3. Fallback
  return "it";
}

export async function initI18n(lng?: LangCode) {
  // Prevent double-init (i18next throws on re-init)
  if (i18n.isInitialized) return i18n;

  const resolved: LangCode = lng ?? getSavedLang();
  const translations = await loadLocale(resolved);

  // Apply dir/lang to <html> immediately
  const lang = SUPPORTED_LANGUAGES.find(l => l.code === resolved);
  document.documentElement.dir  = lang?.dir  ?? "ltr";
  document.documentElement.lang = resolved;

  await i18n
    .use(initReactI18next)
    .init({
      resources: {
        [resolved]: { translation: translations },
      },
      lng:          resolved,
      fallbackLng:  "it",
      interpolation: { escapeValue: false },
      react:        { useSuspense: false },
    });

  return i18n;
}

export async function changeLanguage(lng: LangCode) {
  if (!i18n.hasResourceBundle(lng, "translation")) {
    const translations = await loadLocale(lng);
    i18n.addResourceBundle(lng, "translation", translations, true, true);
  }
  const lang = SUPPORTED_LANGUAGES.find(l => l.code === lng);
  document.documentElement.dir = lang?.dir ?? "ltr";
  document.documentElement.lang = lng;
  await i18n.changeLanguage(lng);
}

export default i18n;
