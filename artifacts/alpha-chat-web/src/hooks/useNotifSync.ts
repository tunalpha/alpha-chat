/**
 * useNotifSync — sincronizza le impostazioni notifiche col backend.
 *
 * Logica di precedenza:
 *  1. Al login (auth.userId cambia) → GET backend → merge locale
 *  2. Modifica locale → PATCH backend immediato (gestito da NotificationsPage)
 *  3. Offline → modifica salvata in localStorage (PENDING_KEY) → flush al prossimo mount
 *
 * Questo hook va chiamato dentro AppContent (che ha accesso a useAuth).
 */

import { useEffect, useRef } from "react";
import { useAppSettings, type NotifPrefs } from "../contexts/AppSettingsContext";
import {
  apiGetNotificationSettings,
  apiUpdateNotificationSettings,
  type BackendNotificationSettings,
} from "../lib/api";

const PENDING_KEY = "alpha_pending_notif";

// ─── Pending offline queue ─────────────────────────────────────────────────────

export function savePendingNotif(patch: Partial<BackendNotificationSettings>) {
  try {
    const existing = loadPendingNotif();
    localStorage.setItem(PENDING_KEY, JSON.stringify({ ...existing, ...patch }));
  } catch { /* storage full */ }
}

function loadPendingNotif(): Partial<BackendNotificationSettings> | null {
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    return raw ? (JSON.parse(raw) as Partial<BackendNotificationSettings>) : null;
  } catch { return null; }
}

function clearPendingNotif() {
  try { localStorage.removeItem(PENDING_KEY); } catch { /* noop */ }
}

// ─── Mapping backend → NotifPrefs ─────────────────────────────────────────────

function backendToNotif(b: BackendNotificationSettings): Partial<NotifPrefs> {
  return {
    messages:    b.messages,
    calls:       b.calls,
    groups:      b.groups,
    previewText: b.preview_text,
  };
}

function notifToBackend(patch: Partial<NotifPrefs>): Partial<BackendNotificationSettings> {
  const out: Partial<BackendNotificationSettings> = {};
  if (patch.messages    !== undefined) out.messages     = patch.messages;
  if (patch.calls       !== undefined) out.calls        = patch.calls;
  if (patch.groups      !== undefined) out.groups       = patch.groups;
  if (patch.previewText !== undefined) out.preview_text = patch.previewText;
  return out;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * @param userId  – ID dell'utente corrente (null = non autenticato)
 */
export function useNotifSync(userId: string | null) {
  const { syncNotifFromBackend } = useAppSettings();
  const syncedUserRef = useRef<string | null>(null);

  useEffect(() => {
    if (!userId) {
      syncedUserRef.current = null;
      return;
    }

    // Evita doppia sincronizzazione per lo stesso utente nella stessa sessione
    if (syncedUserRef.current === userId) return;
    syncedUserRef.current = userId;

    void (async () => {
      try {
        // 1. Flush modifiche offline in sospeso
        const pending = loadPendingNotif();
        if (pending && Object.keys(pending).length > 0) {
          await apiUpdateNotificationSettings(pending);
          clearPendingNotif();
        }

        // 2. Fetch impostazioni correnti dal backend
        const serverSettings = await apiGetNotificationSettings();

        // 3. Merge nel contesto locale (senza triggering di write al backend)
        syncNotifFromBackend(backendToNotif(serverSettings));
      } catch {
        // Offline o server non raggiungibile — le impostazioni locali rimangono valide
      }
    })();
  }, [userId, syncNotifFromBackend]);
}

// Esporta helper per NotificationsPage
export { notifToBackend };
