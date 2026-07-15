/**
 * Token storage — localStorage per semplicità nel test client.
 * In produzione si userebbero httpOnly cookie.
 */

const KEYS = {
  ACCESS_TOKEN: "ac_access_token",
  REFRESH_TOKEN: "ac_refresh_token",
  USER_ID: "ac_user_id",
  USERNAME: "ac_username",
  DISPLAY_NAME: "ac_display_name",
  DEVICE_ID: "ac_device_id",
} as const;

export interface StoredAuth {
  accessToken: string;
  refreshToken: string;
  userId: string;
  username: string;
  displayName: string;
  deviceId: string;
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
}

export function loadAuth(): StoredAuth | null {
  const accessToken = localStorage.getItem(KEYS.ACCESS_TOKEN);
  const refreshToken = localStorage.getItem(KEYS.REFRESH_TOKEN);
  const userId = localStorage.getItem(KEYS.USER_ID);
  const username = localStorage.getItem(KEYS.USERNAME);
  const displayName = localStorage.getItem(KEYS.DISPLAY_NAME);
  const deviceId = getDeviceId();

  if (!accessToken || !refreshToken || !userId || !username || !displayName) {
    return null;
  }
  return { accessToken, refreshToken, userId, username, displayName, deviceId };
}

export function clearAuth(): void {
  localStorage.removeItem(KEYS.ACCESS_TOKEN);
  localStorage.removeItem(KEYS.REFRESH_TOKEN);
  localStorage.removeItem(KEYS.USER_ID);
  localStorage.removeItem(KEYS.USERNAME);
  localStorage.removeItem(KEYS.DISPLAY_NAME);
}

export function updateAccessToken(token: string): void {
  localStorage.setItem(KEYS.ACCESS_TOKEN, token);
}

export function getAccessToken(): string | null {
  return localStorage.getItem(KEYS.ACCESS_TOKEN);
}

export function getRefreshToken(): string | null {
  return localStorage.getItem(KEYS.REFRESH_TOKEN);
}
