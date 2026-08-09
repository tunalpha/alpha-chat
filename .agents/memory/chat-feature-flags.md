---
name: Chat Feature Flags — USDT/BTC toggle
description: Toggle admin per mostrare/nascondere i pulsanti USDT e BTC nel menu condivisione della chat. Quando OFF, rimane solo USDA nativo.
---

## Regola principale
Il flag `multichain_payments_enabled` in `AdminSettings` (singleton MongoDB "default") controlla
la visibilità dei bottoni Invia/Richiedi USDT + Invia/Richiedi BTC nell'attach sheet di ChatPage.

**Why:** L'operatore vuole poter disabilitare rapidamente USDT/BTC senza fare un deploy,
mantenendo sempre visibili USDA nativo (Invia/Richiedi USDA).

## Endpoint pubblico (no auth)
`GET /api/v1/admin/app-feature-flags` → `{ multichain_payments_enabled: boolean }`

Fail-open: se l'endpoint fallisce, `apiGetAppFeatureFlags()` restituisce `{ multichain_payments_enabled: true }`.
Questo significa che in caso di errore la chat mostra tutto (comportamento sicuro per gli utenti).

## File toccati
- `api-server/src/models/admin-settings.model.ts` — aggiunto campo `multichain_payments_enabled` (default: true)
- `api-server/src/routes/v1/admin.routes.ts` — aggiornato GET/PATCH notification-settings + nuovo endpoint pubblico
- `admin-panel/src/lib/api.ts` — `AdminNotifSettings` aggiornato, `patchNotifSettings` aggiornato
- `admin-panel/src/pages/email-settings.tsx` — rinominata "Impostazioni & Feature Flag", nuova sezione Feature Flag con toggle verde
- `alpha-chat-web/src/lib/api.ts` — aggiunto `apiGetAppFeatureFlags()` con fail-open
- `alpha-chat-web/src/pages/ChatPage.tsx` — `multichainEnabled` state + useEffect fetch + gate sui 4 bottoni USDT/BTC

## Come funziona
1. Admin panel → Impostazioni & Feature Flag → toggle "Pagamenti USDT / BTC in chat"
2. La modifica viene salvata in MongoDB (PATCH /admin/notification-settings)
3. Al prossimo caricamento di ChatPage (o ricarica app), `apiGetAppFeatureFlags()` legge il nuovo valore
4. I 4 bottoni (Invia USDT, Richiedi USDT, Invia BTC, Richiedi BTC) appaiono/scompaiono
5. USDA (Invia USDA, Richiedi USDA) non è mai toccato dal flag

## Note importanti
- Le bolle USDT/BTC già inviate rimangono sempre visibili (il flag controlla solo l'entry point, non la visualizzazione delle bolle esistenti)
- Il flag non bypassa i FEATURE_FLAGS del payment engine (es. ENABLE_POLYGON_USDT) — sono due layer separati
- L'endpoint /admin/app-feature-flags è senza auth per semplicità; non espone dati sensibili
