/**
 * AppSettingsContext — gestione centralizzata di tutte le preferenze utente.
 *
 * Persistenza : localStorage (alpha_settings_v1), con campo _v per la versione
 * Applicazione: attributi data-* su <html> → CSS vars reagiscono immediatamente
 *
 * Robustezza:
 *  • Versionamento con migrazione automatica (migrateSettings)
 *  • Validazione completa dei valori prima dell'applicazione
 *  • Listener prefers-color-scheme stabile (useRef, non si re-iscrive ad ogni render)
 *  • syncNotifFromBackend() per merge dei dati dal server senza triggering di write
 */

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from "react";
import { changeLanguage, SUPPORTED_LANGUAGES, type LangCode } from "../i18n";

// ─── Versione dello schema ─────────────────────────────────────────────────────
// Incrementare quando la struttura cambia; migrateSettings gestirà la conversione.
const SETTINGS_VERSION = 1;

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
  wallpaper:   string | null;
  notif:       NotifPrefs;
}

// ─── Valori validi (per validazione) ─────────────────────────────────────────

const VALID_THEMES:   Theme[]       = ["dark","light","system","amoled"];
const VALID_ACCENTS:  AccentColor[] = ["violet","blue","green","red","cyan","orange","pink","gray"];
const VALID_TEXTS:    TextSize[]    = ["small","normal","large","x-large"];
const VALID_BUBBLES:  BubbleSize[]  = ["compact","normal","wide"];
const VALID_MOTIONS:  MotionLevel[] = ["normal","reduced","none"];
const VALID_LANGS     = SUPPORTED_LANGUAGES.map(l => l.code);

// ─── Default ──────────────────────────────────────────────────────────────────

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

// ─── Validazione ──────────────────────────────────────────────────────────────

/** Garantisce che ogni campo NotifPrefs sia un booleano; usa il default per valori invalidi. */
function validateNotif(raw: Partial<NotifPrefs>): NotifPrefs {
  const bool = (v: unknown, def: boolean): boolean =>
    typeof v === "boolean" ? v : def;

  return {
    messages:       bool(raw.messages,       DEFAULT_NOTIF.messages),
    groups:         bool(raw.groups,         DEFAULT_NOTIF.groups),
    calls:          bool(raw.calls,          DEFAULT_NOTIF.calls),
    videoCalls:     bool(raw.videoCalls,     DEFAULT_NOTIF.videoCalls),
    phoenix:        bool(raw.phoenix,        DEFAULT_NOTIF.phoenix),
    emergencyLock:  bool(raw.emergencyLock,  DEFAULT_NOTIF.emergencyLock),
    recovery:       bool(raw.recovery,       DEFAULT_NOTIF.recovery),
    previewText:    bool(raw.previewText,    DEFAULT_NOTIF.previewText),
    sounds:         bool(raw.sounds,         DEFAULT_NOTIF.sounds),
    vibration:      bool(raw.vibration,      DEFAULT_NOTIF.vibration),
    badge:          bool(raw.badge,          DEFAULT_NOTIF.badge),
    silenceUnknown: bool(raw.silenceUnknown, DEFAULT_NOTIF.silenceUnknown),
    contactsOnly:   bool(raw.contactsOnly,   DEFAULT_NOTIF.contactsOnly),
    doNotDisturb:   bool(raw.doNotDisturb,   DEFAULT_NOTIF.doNotDisturb),
  };
}

/** Valida ogni campo; ripristina il default per qualunque valore non riconosciuto. */
function validateSettings(raw: Partial<AppSettings & { _v?: number }>): AppSettings {
  // <T,> evita l'ambiguità con JSX nei file .tsx
  const pick = <T,>(val: unknown, valid: T[], def: T): T =>
    valid.includes(val as T) ? (val as T) : def;

  return {
    theme:      pick(raw.theme,      VALID_THEMES,   DEFAULT_SETTINGS.theme),
    accent:     pick(raw.accent,     VALID_ACCENTS,  DEFAULT_SETTINGS.accent),
    textSize:   pick(raw.textSize,   VALID_TEXTS,    DEFAULT_SETTINGS.textSize),
    bubbleSize: pick(raw.bubbleSize, VALID_BUBBLES,  DEFAULT_SETTINGS.bubbleSize),
    motion:     pick(raw.motion,     VALID_MOTIONS,  DEFAULT_SETTINGS.motion),
    language:   pick(raw.language,   VALID_LANGS,    DEFAULT_SETTINGS.language) as LangCode,
    // wallpaper: solo stringhe o null; scarta qualsiasi altro tipo
    wallpaper:  (typeof raw.wallpaper === "string" || raw.wallpaper === null)
      ? raw.wallpaper ?? null
      : null,
    notif: validateNotif(
      (raw.notif && typeof raw.notif === "object") ? raw.notif as Partial<NotifPrefs> : {}
    ),
  };
}

// ─── Migrazione versioni ──────────────────────────────────────────────────────

type RawStored = Partial<AppSettings> & { _v?: number };

function migrateSettings(raw: RawStored): RawStored {
  const v = raw._v ?? 0;
  // v0 → v1: nessuna modifica strutturale (prima versione formale)
  if (v < 1) {
    // noop — la struttura è la stessa
    raw._v = 1;
  }
  // Future: if (v < 2) { /* trasforma raw */ raw._v = 2; }
  return raw;
}

// ─── Persistenza ─────────────────────────────────────────────────────────────

function loadSettings(): AppSettings {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return DEFAULT_SETTINGS;
    const raw = JSON.parse(stored) as RawStored;
    const migrated = migrateSettings(raw);
    return validateSettings(migrated);
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function saveSettings(s: AppSettings) {
  try {
    const toStore: RawStored = { _v: SETTINGS_VERSION, ...s };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toStore));
  } catch { /* storage full — skip */ }
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
  html.setAttribute("data-theme",  resolveTheme(s.theme));
  html.setAttribute("data-accent", s.accent);
  html.setAttribute("data-text",   s.textSize);
  html.setAttribute("data-bubble", s.bubbleSize);
  html.setAttribute("data-motion", s.motion);

  if (s.wallpaper) {
    html.style.setProperty("--chat-wallpaper", s.wallpaper);
  } else {
    html.style.removeProperty("--chat-wallpaper");
  }
}

// ─── Context ──────────────────────────────────────────────────────────────────

interface AppSettingsContextValue {
  settings:          AppSettings;
  setTheme:          (t: Theme)           => void;
  setAccent:         (a: AccentColor)     => void;
  setTextSize:       (s: TextSize)        => void;
  setBubbleSize:     (s: BubbleSize)      => void;
  setMotion:         (m: MotionLevel)     => void;
  setLanguage:       (l: LangCode)        => Promise<void>;
  setWallpaper:      (w: string | null)   => void;
  setNotif:          (patch: Partial<NotifPrefs>) => void;
  /** Merge campi ricevuti dal backend — NON triggera ulteriori scritture al server. */
  syncNotifFromBackend: (patch: Partial<NotifPrefs>) => void;
}

const AppSettingsContext = createContext<AppSettingsContextValue | null>(null);

export function AppSettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());

  // Ref stabile per il listener di sistema: evita re-subscribe ad ogni render
  const settingsRef = useRef(settings);
  useEffect(() => { settingsRef.current = settings; }, [settings]);

  // Applica CSS + salva localStorage ad ogni cambio
  useEffect(() => {
    applySettings(settings);
    saveSettings(settings);
  }, [settings]);

  // Listener prefers-color-scheme — si registra una volta sola,
  // legge sempre l'ultimo settings tramite ref → nessun re-subscribe
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const handler = () => {
      if (settingsRef.current.theme === "system") {
        applySettings(settingsRef.current);
      }
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []); // ← dipendenze vuote intenzionali: ref è stabile

  // ── Setter ─────────────────────────────────────────────────────────────────

  const update = useCallback((patch: Partial<AppSettings>) => {
    setSettings(prev => ({ ...prev, ...patch }));
  }, []);

  const setTheme      = useCallback((t: Theme)         => update({ theme: t }),      [update]);
  const setAccent     = useCallback((a: AccentColor)   => update({ accent: a }),     [update]);
  const setTextSize   = useCallback((s: TextSize)      => update({ textSize: s }),   [update]);
  const setBubbleSize = useCallback((s: BubbleSize)    => update({ bubbleSize: s }), [update]);
  const setMotion     = useCallback((m: MotionLevel)   => update({ motion: m }),     [update]);
  const setWallpaper  = useCallback((w: string | null) => update({ wallpaper: w }),  [update]);

  const setNotif = useCallback((patch: Partial<NotifPrefs>) => {
    setSettings(prev => ({
      ...prev,
      notif: validateNotif({ ...prev.notif, ...patch }),
    }));
  }, []);

  /**
   * Merge dei campi notifiche ricevuti dal server dopo un fetch.
   * Semanticamente identico a setNotif ma distinguibile per il chiamante
   * (useNotifSync) che non deve generare un ulteriore write al backend.
   */
  const syncNotifFromBackend = useCallback((patch: Partial<NotifPrefs>) => {
    setSettings(prev => ({
      ...prev,
      notif: validateNotif({ ...prev.notif, ...patch }),
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
    syncNotifFromBackend,
  }), [settings, setTheme, setAccent, setTextSize, setBubbleSize,
       setMotion, setLanguage, setWallpaper, setNotif, syncNotifFromBackend]);

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
