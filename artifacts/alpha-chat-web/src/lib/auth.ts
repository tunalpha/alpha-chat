/**
 * Token storage — localStorage per semplicità nel test client.
 * In produzione si userebbero httpOnly cookie.
 */

const KEYS = {
  ACCESS_TOKEN:     "ac_access_token",
  ACCESS_TOKEN_EXP: "ac_access_token_exp", // ISO string — scadenza dell'access token
  REFRESH_TOKEN:    "ac_refresh_token",
  USER_ID:          "ac_user_id",
  USERNAME:         "ac_username",
  DISPLAY_NAME:     "ac_display_name",
  DEVICE_ID:        "ac_device_id",
  AVATAR_URL:       "ac_avatar_url",
} as const;

export interface StoredAuth {
  avatarUrl?: string | null;
  accessToken: string;
  /** ISO string della scadenza — usato per il refresh proattivo (avvio PWA, visibilitychange). */
  accessTokenExpiresAt?: string;
  refreshToken: string;
  userId: string;
  username: string;
  displayName: string;
  deviceId: string;
  /** Sprint 22: true dopo recovery con password temporanea — blocca l'app fino al cambio */
  requirePasswordChange?: boolean;
}

export function getDeviceId(): string {
  let id = localStorage.getItem(KEYS.DEVICE_ID);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(KEYS.DEVICE_ID, id);
  }
  return id;
}

export function saveAuth(data: Omit<StoredAuth, "deviceId">): void {
  localStorage.setItem(KEYS.ACCESS_TOKEN, data.accessToken);
  localStorage.setItem(KEYS.REFRESH_TOKEN, data.refreshToken);
  localStorage.setItem(KEYS.USER_ID, data.userId);
  localStorage.setItem(KEYS.USERNAME, data.username);
  localStorage.setItem(KEYS.DISPLAY_NAME, data.displayName);

  // Persiste la scadenza se fornita — non tocca il valore esistente se undefined.
  if (data.accessTokenExpiresAt !== undefined) {
    localStorage.setItem(KEYS.ACCESS_TOKEN_EXP, data.accessTokenExpiresAt);
  }

  // avatarUrl: null esplicito → rimuovi; undefined → non toccare (preserva valore corrente).
  if (data.avatarUrl === null) {
    localStorage.removeItem(KEYS.AVATAR_URL);
  } else if (data.avatarUrl !== undefined) {
    localStorage.setItem(KEYS.AVATAR_URL, data.avatarUrl);
  }

  // requirePasswordChange: false esplicito → rimuovi; undefined → non toccare.
  if (data.requirePasswordChange) {
    localStorage.setItem("alpha_require_pwd_change", "1");
  } else if (data.requirePasswordChange === false) {
    localStorage.removeItem("alpha_require_pwd_change");
  }
}

export function loadAuth(): StoredAuth | null {
  const accessToken  = localStorage.getItem(KEYS.ACCESS_TOKEN);
  const refreshToken = localStorage.getItem(KEYS.REFRESH_TOKEN);
  const userId       = localStorage.getItem(KEYS.USER_ID);
  const username     = localStorage.getItem(KEYS.USERNAME);
  const displayName  = localStorage.getItem(KEYS.DISPLAY_NAME);
  const deviceId     = getDeviceId();

  if (!accessToken || !refreshToken || !userId || !username || !displayName) {
    return null;
  }
  const requirePasswordChange  = localStorage.getItem("alpha_require_pwd_change") === "1";
  const avatarUrl              = localStorage.getItem(KEYS.AVATAR_URL) ?? null;
  const accessTokenExpiresAt   = localStorage.getItem(KEYS.ACCESS_TOKEN_EXP) ?? undefined;

  return {
    accessToken,
    accessTokenExpiresAt,
    refreshToken,
    userId,
    username,
    displayName,
    deviceId,
    requirePasswordChange,
    avatarUrl,
  };
}

export function clearRequirePasswordChange(): void {
  localStorage.removeItem("alpha_require_pwd_change");
}

/** Aggiorna solo l'avatar URL in localStorage senza toccare gli altri dati. */
export function updateStoredAvatarUrl(url: string | null): void {
  if (url != null) {
    localStorage.setItem(KEYS.AVATAR_URL, url);
  } else {
    localStorage.removeItem(KEYS.AVATAR_URL);
  }
}

export function clearAuth(): void {
  localStorage.removeItem(KEYS.ACCESS_TOKEN);
  localStorage.removeItem(KEYS.ACCESS_TOKEN_EXP);
  localStorage.removeItem(KEYS.REFRESH_TOKEN);
  localStorage.removeItem(KEYS.USER_ID);
  localStorage.removeItem(KEYS.USERNAME);
  localStorage.removeItem(KEYS.DISPLAY_NAME);
  localStorage.removeItem(KEYS.AVATAR_URL);
  localStorage.removeItem("alpha_require_pwd_change");
}

export function updateAccessToken(token: string): void {
  localStorage.setItem(KEYS.ACCESS_TOKEN, token);
}

/** Aggiorna la scadenza dell'access token in localStorage (chiamato dopo ogni refresh). */
export function updateAccessTokenExpiry(expiresAt: string): void {
  localStorage.setItem(KEYS.ACCESS_TOKEN_EXP, expiresAt);
}

export function getAccessToken(): string | null {
  return localStorage.getItem(KEYS.ACCESS_TOKEN);
}

export function getRefreshToken(): string | null {
  return localStorage.getItem(KEYS.REFRESH_TOKEN);
}

/**
 * Ritorna true se l'access token è scaduto (o se la scadenza non è nota).
 * Usato per il refresh proattivo all'avvio PWA.
 */
export function isAccessTokenExpired(): boolean {
  const exp = localStorage.getItem(KEYS.ACCESS_TOKEN_EXP);
  if (!exp) return true; // scadenza ignota → tratta come scaduto, forza refresh
  return Date.now() >= new Date(exp).getTime();
}

/**
 * Ritorna true se l'access token è scaduto o sta per scadere entro `withinMs` ms.
 * Default: 2 minuti. Usato dal listener visibilitychange per il refresh proattivo.
 */
export function isAccessTokenExpiringSoon(withinMs = 2 * 60 * 1000): boolean {
  const exp = localStorage.getItem(KEYS.ACCESS_TOKEN_EXP);
  if (!exp) return true;
  return Date.now() >= new Date(exp).getTime() - withinMs;
}
