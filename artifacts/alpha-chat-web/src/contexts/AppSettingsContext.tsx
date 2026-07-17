/**
 * AppSettingsContext — gestione centralizzata di tutte le preferenze utente.
 *
 * Persistenza: localStorage
 * Applicazione: attributi data-* su <html> → CSS vars reagiscono immediatamente
 */

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
} from "react";
import { changeLanguage, type LangCode } from "../i18n";

// ─── Tipi ────────────────────────────────────────────────────────────────────

export type Theme        = "dark" | "light" | "system" | "amoled";
export type AccentColor  = "violet" | "blue" | "green" | "red" | "cyan" | "orange" | "pink" | "gray";
export type TextSize     = "small" | "normal" | "large" | "x-large";
export type BubbleSize   = "compact" | "normal" | "wide";
export type MotionLevel  = "normal" | "reduced" | "none";

export interface NotifPrefs {
  messages:       boolean;
  groups:         boolean;
  calls:          boolean;
  videoCalls:     boolean;
  phoenix:        boolean;
  emergencyLock:  boolean;
  recovery:       boolean;
  previewText:    boolean;
  sounds:         boolean;
  vibration:      boolean;
  badge:          boolean;
  silenceUnknown: boolean;
  contactsOnly:   boolean;
  doNotDisturb:   boolean;
}

export interface AppSettings {
  theme:       Theme;
  accent:      AccentColor;
  textSize:    TextSize;
  bubbleSize:  BubbleSize;
  motion:      MotionLevel;
  language:    LangCode;
  wallpaper:   string | null; // null = nessuno, "color:xxx" | "gradient:xxx" | "data:..." custom
  notif:       NotifPrefs;
}

const DEFAULT_NOTIF: NotifPrefs = {
  messages:       true,
  groups:         true,
  calls:          true,
  videoCalls:     true,
  phoenix:        true,
  emergencyLock:  true,
  recovery:       true,
  previewText:    false,
  sounds:         true,
  vibration:      true,
  badge:          true,
  silenceUnknown: false,
  contactsOnly:   false,
  doNotDisturb:   false,
};

const DEFAULT_SETTINGS: AppSettings = {
  theme:      "dark",
  accent:     "violet",
  textSize:   "normal",
  bubbleSize: "normal",
  motion:     "normal",
  language:   "it",
  wallpaper:  null,
  notif:      DEFAULT_NOTIF,
};

const STORAGE_KEY = "alpha_settings_v1";

// ─── Persistenza ─────────────────────────────────────────────────────────────

function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      notif: { ...DEFAULT_NOTIF, ...(parsed.notif ?? {}) },
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function saveSettings(s: AppSettings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch { /* storage full */ }
}

// ─── Applicazione CSS ─────────────────────────────────────────────────────────

function resolveTheme(theme: Theme): "dark" | "light" | "amoled" {
  if (theme === "system") {
    return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  }
  return theme;
}

function applySettings(s: AppSettings) {
  const html = document.documentElement;
  html.setAttribute("data-theme",   resolveTheme(s.theme));
  html.setAttribute("data-accent",  s.accent);
  html.setAttribute("data-text",    s.textSize);
  html.setAttribute("data-bubble",  s.bubbleSize);
  html.setAttribute("data-motion",  s.motion);

  // Wallpaper come CSS var
  if (s.wallpaper) {
    html.style.setProperty("--chat-wallpaper", s.wallpaper);
  } else {
    html.style.removeProperty("--chat-wallpaper");
  }
}

// ─── Context ──────────────────────────────────────────────────────────────────

interface AppSettingsContextValue {
  settings: AppSettings;
  setTheme:       (t: Theme)       => void;
  setAccent:      (a: AccentColor) => void;
  setTextSize:    (s: TextSize)    => void;
  setBubbleSize:  (s: BubbleSize)  => void;
  setMotion:      (m: MotionLevel) => void;
  setLanguage:    (l: LangCode)    => Promise<void>;
  setWallpaper:   (w: string | null) => void;
  setNotif:       (patch: Partial<NotifPrefs>) => void;
}

const AppSettingsContext = createContext<AppSettingsContextValue | null>(null);

export function AppSettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());

  // Applica al mount e ad ogni cambio
  useEffect(() => {
    applySettings(settings);
    saveSettings(settings);
  }, [settings]);

  // Segui il cambio sistema dark/light se theme="system"
  useEffect(() => {
    if (settings.theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const handler = () => applySettings(settings);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [settings]);

  const update = useCallback((patch: Partial<AppSettings>) => {
    setSettings(prev => {
      const next = { ...prev, ...patch };
      return next;
    });
  }, []);

  const setTheme      = useCallback((t: Theme)       => update({ theme: t }),      [update]);
  const setAccent     = useCallback((a: AccentColor) => update({ accent: a }),     [update]);
  const setTextSize   = useCallback((s: TextSize)    => update({ textSize: s }),   [update]);
  const setBubbleSize = useCallback((s: BubbleSize)  => update({ bubbleSize: s }), [update]);
  const setMotion     = useCallback((m: MotionLevel) => update({ motion: m }),     [update]);
  const setWallpaper  = useCallback((w: string | null) => update({ wallpaper: w }), [update]);
  const setNotif      = useCallback((patch: Partial<NotifPrefs>) => {
    setSettings(prev => ({
      ...prev,
      notif: { ...prev.notif, ...patch },
    }));
  }, []);

  const setLanguage = useCallback(async (l: LangCode) => {
    await changeLanguage(l);
    update({ language: l });
  }, [update]);

  const value = useMemo<AppSettingsContextValue>(() => ({
    settings,
    setTheme, setAccent, setTextSize, setBubbleSize,
    setMotion, setLanguage, setWallpaper, setNotif,
  }), [settings, setTheme, setAccent, setTextSize, setBubbleSize, setMotion, setLanguage, setWallpaper, setNotif]);

  return (
    <AppSettingsContext.Provider value={value}>
      {children}
    </AppSettingsContext.Provider>
  );
}

export function useAppSettings(): AppSettingsContextValue {
  const ctx = useContext(AppSettingsContext);
  if (!ctx) throw new Error("useAppSettings must be used inside AppSettingsProvider");
  return ctx;
}
