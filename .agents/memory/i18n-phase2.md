---
name: i18n Phase 2 — audit hardcoded strings
description: Pattern, decisioni e residui dell'audit i18n Phase 2 su Alpha Chat PWA (luglio 2026)
---

## Componenti completati (Phase 2)

| Componente | Tecnica usata |
|---|---|
| `UsdaPaymentBubble.tsx` | `statusCopy(t)` — t passato come parametro alla pure function |
| `UsdaHistory.tsx` | `FILTER_KEYS` con `tKey` stringhe, rendered con `t(f.tKey)` |
| `ChatPaymentBubble.tsx` | `getStatusLabel(status, isMine, isRequest, t, ...)` — t passato come parametro |
| `SendPaymentSheet.tsx` | STEPS e PHASE_LABEL calcolati dentro il componente (non più module-level) |
| `EmergencyPage.tsx` | Aggiunto `useTranslation()` da zero |
| `ActiveCallScreen.tsx` | `qualityLabel(q, t)` — t passato come parametro; import `useTranslation` aggiunto |
| `ChatPage.tsx` | Solo toast: 25 `showToast("...")` → `showToast(t("chat.toast*"))` |

## Regole critiche

**Pure functions fuori componente che hanno bisogno di t:** passare `t` come parametro `(key: string) => string` — stabilito come pattern per `statusCopy`, `getStatusLabel`, `qualityLabel`.

**Costanti module-level con stringhe UI:** devono diventare computed dentro il componente con `t()`. Esempio: `STEPS` e `PHASE_LABEL` in `SendPaymentSheet`.

**`useCallback` che usa `t`:** aggiungere `t` alle deps. La funzione `t` di i18next è stabile tra i render (non cambia se la lingua non cambia), quindi non causa loop.

**`confirmDesc*` in emergency namespace:** i valori includono il prefisso frase completo (es. IT: "Stai per disconnettere tutti i dispositivi di") perché la struttura grammaticale varia troppo tra le lingue per spezzarli.

## Residui NON nel perimetro Phase 2 (ChatPage.tsx)

Le sotto-componenti inline di `ChatPage.tsx` (ChatHeader, InputBar, timer ExpiryBadge) hanno ancora stringhe italiane:
- Menu items: "Info gruppo", "Aggiungi membri"
- Trust badge titles: "Identità verificata", "Non verificata…", "Chiave cambiata…"
- Header fallbacks: "Gruppo", "Utente sconosciuto"
- Placeholder: "Scrivi un messaggio…"
- Burn After Read title
- "scaduto" nel timer

Questi NON erano nel scope Phase 2 (ChatPage.tsx era "toasts only"). Lasciati per un futuro audit.

**Why:** Module isolation policy (Messaggi CONGELATO) limita i cambi a ChatPage. Le modifiche ai toast erano esplicitamente approvate; le sotto-componenti no.

## Namespace aggiunti ai 10 file locale

- `usda.*` — ~120 chiavi: stati pagamento, label form, step UI, hint firma, error messages, bubble labels
- `emergency.*` — ~30 chiavi: tutti gli stati UI dell'EmergencyPage
- `calls.*` ext — ~25 nuove chiavi: qualità, statistiche, pulsanti, menu, label connessione
- `chat.toast*` — ~25 chiavi: tutti i toast di ChatPage
- `common.cancel`, `common.retry`, `common.more`, `common.close`, `common.error`, `common.loading`
