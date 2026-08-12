---
name: Spark Monitor — URL doppio /admin/ e tema colori
description: Due bug critici risolti nella pagina spark-monitor e spark-monitoring-api dopo il primo deploy
---

## Bug 1 — Doppio /admin/ nel path (kill switch + monitoring API)

`apiFetch` in admin-panel usa `BASE = "/api/v1/admin"`.
Passare `"/admin/notification-settings"` → `/api/v1/admin/admin/notification-settings` → **404**.
Passare `"/spark/monitoring/dashboard"` → `/api/v1/admin/spark/monitoring/dashboard` → **404** (route sotto `/api/v1/spark/`, non `/api/v1/admin/`).

**Fix kill switch (`spark-api.ts`):**
- SBAGLIATO: `apiFetch("/admin/notification-settings")`
- CORRETTO: `apiFetch("/notification-settings")` (BASE già include `/admin`)

**Fix monitoring API (`spark-monitoring-api.ts`):**
- Non usare `apiFetch` per route sotto `/api/v1/spark/*`
- Creare `sparkMonitorFetch` con `SPARK_MONITOR_BASE = "/api/v1/spark"` che usa `getToken()` direttamente

**How to apply:** Qualsiasi chiamata da admin-panel verso `/api/v1/spark/*` deve usare un fetch custom, non `apiFetch`. Verificare sempre il BASE prima di costruire i path.

## Bug 2 — Colori dark su tema chiaro (illeggibile)

Il panel admin ha tema **chiaro** (light). Le classi `text-white`, `bg-white/5`, `border-white/10` sono invisibili su sfondo chiaro.

**Fix:** usare classi semantiche shadcn:
- `text-foreground` (testo primario)
- `text-muted-foreground` (testo secondario)
- `bg-card` (card background)
- `border-border` (bordi)
- Per stati colorati: `bg-green-50 border-green-200 text-green-800` (non `/30` trasparente)

**Why:** I colori con opacità (`/20`, `/30`) su sfondo bianco = beige/quasi-trasparente. Su sfondo dark sarebbero visibili ma il panel è light.
