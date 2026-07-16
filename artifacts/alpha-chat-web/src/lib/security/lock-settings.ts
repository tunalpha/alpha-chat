/**
 * Preferenze di sicurezza — Sprint 17
 */

export interface LockSettings {
  /** Timeout inattività in ms. 0 = mai. */
  autoLockMs: number;
  /** Mostra schermata nera quando l'app va in background. */
  privacyScreen: boolean;
  /** Biometria abilitata (richiede che sia registrata). */
  biometricEnabled: boolean;
  /** Panic Mode abilitato. */
  panicEnabled: boolean;
}

export const DEFAULT_LOCK_SETTINGS: LockSettings = {
  autoLockMs: 5 * 60 * 1000, // 5 minuti
  privacyScreen: true,
  biometricEnabled: false,
  panicEnabled: false,
};

export const TIMEOUT_OPTIONS = [
  { label: "Subito", ms: 0 },
  { label: "1 minuto", ms: 60_000 },
  { label: "5 minuti", ms: 5 * 60_000 },
  { label: "15 minuti", ms: 15 * 60_000 },
  { label: "30 minuti", ms: 30 * 60_000 },
  { label: "Mai", ms: -1 },
];

const KEY = (userId: string) => `alpha-chat-security:${userId}`;

export function loadLockSettings(userId: string): LockSettings {
  try {
    const raw = localStorage.getItem(KEY(userId));
    if (!raw) return { ...DEFAULT_LOCK_SETTINGS };
    return { ...DEFAULT_LOCK_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_LOCK_SETTINGS };
  }
}

export function saveLockSettings(userId: string, s: LockSettings): void {
  localStorage.setItem(KEY(userId), JSON.stringify(s));
}
