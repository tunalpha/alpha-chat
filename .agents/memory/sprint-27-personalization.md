---
name: Sprint 27 — Personalizzazione Globale
description: Tema, accento, testo, bolle, animazioni, i18n (10 lingue), notifiche, sfondo chat
---

## Cosa è stato costruito

### i18n (src/i18n/)
- `index.ts` — i18next + react-i18next, lazy loading per lingua, `getSavedLang()` legge da `alpha_settings_v1`
- `initI18n()` — chiama `i18n.isInitialized` guard per evitare doppio-init; applica dir/lang a `<html>` subito
- `changeLanguage()` — addResourceBundle on-demand, aggiorna dir/lang su `<html>`
- 10 locale JSON: it, en, es, fr, de, pt, ar, ru, zh, ja (tutti in `src/i18n/locales/`)
- `SUPPORTED_LANGUAGES` array con `{ code, label, flag, dir }`

### AppSettingsContext (src/contexts/AppSettingsContext.tsx)
- Persiste in `localStorage` chiave `alpha_settings_v1`
- Applica via `data-theme`, `data-accent`, `data-text`, `data-bubble`, `data-motion` su `<html>`
- `--chat-wallpaper` come CSS custom property su `<html>`
- `NotifPrefs` — 14 booleani (4 backendizzati: messages, calls, groups, preview_text; resto solo localStorage)

### CSS (src/index.css — appended)
- `[data-theme="light"]` — palette chiara
- `[data-theme="amoled"]` — palette AMOLED pura nera
- `[data-accent="blue/green/red/cyan/orange/pink/gray"]` — ridefinisce `--brand-*`, `--accent`, `--bubble-mine`, `--bg-active`
- `:root { --accent: #7C3AED }` — default violet già in `:root`
- `[data-text="small/normal/large/x-large"]` — `--fs-msg`, `--fs-ui`
- `[data-bubble="compact/normal/wide"]` — `--bubble-px`, `--bubble-py`
- `[data-motion="reduced/none"]` — override animation/transition durations
- `.chat-messages-area` — applica `--chat-wallpaper`
- Stili completi per AppearancePage, NotificationsPage, LanguagePage

### Pagine nuove
- `AppearancePage.tsx` — tema, accento (8 colori), dimensione testo, bolle, animazioni, 8 wallpaper preset + upload custom
- `NotificationsPage.tsx` — 14 toggle, sincronizza 4 al backend via `apiUpdateNotificationSettings`
- `LanguagePage.tsx` — lista 10 lingue con flag, RTL badge per Arabic

### Backend
- `notification.controller.ts` — `getNotificationSettings`, `updateNotificationSettings`
- Route: `GET /api/v1/users/me/notifications`, `PATCH /api/v1/users/me/notifications`

### API client
- `apiGetNotificationSettings()`, `apiUpdateNotificationSettings()` in `src/lib/api.ts`

### App.tsx
- `AppSettingsProvider` wrappa tutto
- `void initI18n()` chiamato a livello modulo (prima del render)
- `AppView` esteso con `"appearance" | "notifications-settings" | "language"`
- Import + case switch per le 3 nuove pagine

### SettingsPage.tsx
- Rimossi tutti i `soon: true` da Tema/Lingua/Notifiche
- Aggiunto `onClick` per navigare a `appearance`, `language`, `notifications-settings`

## Robustezza (v2 — requisiti aggiuntivi)

### 1. Versionamento impostazioni
- Campo `_v: number` serializzato insieme ai dati in `alpha_settings_v1`
- Costante `SETTINGS_VERSION = 1` — da incrementare ad ogni cambio strutturale
- `migrateSettings()` — funzione versione-aware da estendere per future migrazioni

### 2. Validazione valori
- `validateSettings()` — controlla ogni campo contro set di valori validi; usa default per invalidi
- `validateNotif()` — verifica che tutti i 14 booleani siano effettivamente boolean
- Qualunque valore corrotto/non riconosciuto → fallback a default sicuro

### 3. Sincronizzazione tra dispositivi (`useNotifSync.ts`)
- Al login (userId cambia) → GET backend → merge locale con `syncNotifFromBackend()`
- Modifiche locali → PATCH backend immediato (da `NotificationsPage`)
- Offline → `savePendingNotif()` scrive in `alpha_pending_notif` localStorage
- Prossimo login → `useNotifSync` fa flush del pending prima del fetch
- `syncNotifFromBackend` in context è semanticamente distinto da `setNotif` (non triggera ulteriori write)

### 4. Tema Sistema dinamico
- Listener `prefers-color-scheme` stabile con `useRef` — si registra una volta sola (deps `[]`)
- `settingsRef` aggiornato ad ogni render; il handler legge sempre l'ultimo valore
- Nessun re-subscribe inutile ad ogni cambio impostazione

### 5. Resize immagini wallpaper
- `compressImage(file, maxSide=1280, quality=0.82)` — usa Canvas API
- Riduzione ~80-95% su foto grandi prima di salvare in localStorage
- Fallback `FileReader` se canvas non disponibile (browser molto vecchi)

## Decisioni chiave
- **Why accent default in :root**: `--accent: #7C3AED` in `:root` permette a qualsiasi componente di usare `var(--accent)` senza `[data-accent="violet"]` esplicito (violet è il default)
- **Why guard `i18n.isInitialized`**: in dev HMR, `initI18n` può essere chiamato più volte; i18next lancia eccezione al doppio-init
- **Why 4 campi backend notifiche**: il modello `notification_settings` ha solo `messages, calls, groups, preview_text`; gli altri 10 (sounds, vibration, badge, ecc.) restano localStorage-only
- **Why `AppSettingsProvider` fuori da tutto**: le impostazioni devono essere disponibili anche prima dell'auth (per applicare il tema alla landing page)
