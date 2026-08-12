---
name: Spark Phase 5 — Pre-Go-Live Validation
description: Stato finale Phase 5, production COOP/COEP fix, kill switch admin, deploy instructions
---

## Stato completato

- 993/993 test PASS (alpha-chat-web)
- 56/56 test PASS (admin-panel)
- Build SUCCESS tutti gli artifact

## COOP/COEP in produzione — soluzione adottata

**Problema:** `serve = "static"` in artifact.toml non invia COOP/COEP headers → SharedArrayBuffer non disponibile → Breez SDK WASM fallisce in produzione.

**Soluzione:** `artifacts/alpha-chat-web/server.mjs` — server Node.js built-in (nessuna dipendenza npm) che:
- Imposta `Cross-Origin-Opener-Policy: same-origin`
- Imposta `Cross-Origin-Embedder-Policy: require-corp`
- Serve i file statici da `dist/public` con MIME types corretti
- SPA fallback → `index.html` per React Router DOM
- Cache immutable per asset con hash Vite, no-cache per index.html/sw.js

artifact.toml aggiornato: `serve = "static"` → `deploymentTarget = "autoscale"` con `run = ["node", "artifacts/alpha-chat-web/server.mjs"]`

**Verifica:** `curl -I localhost:29999/ | grep Cross-Origin` → `same-origin` + `require-corp` ✅

## Kill switch admin

**Where:** Admin Panel → Spark / Lightning (sidebar)
**Toggle:** "Abilita Go-Live" / "Kill Switch"
**API:** PATCH /api/v1/admin/settings `{ spark_lightning_enabled: true/false }`
**Auth:** solo super_admin

## Procedura go-live

1. Pubblica il deploy (Replit → Deploy)
2. Verifica produzione: apri https://alphachat.sbs su iPhone, controlla devtools `crossOriginIsolated = true`
3. Admin Panel → Spark / Lightning → "Abilita Go-Live" → conferma
4. Testa invio/ricezione Lightning su mainnet (importo piccolo)
5. Se problemi → "Kill Switch" in admin panel → immediato
6. Post-test: lasciare `spark_lightning_enabled = true` se OK, altrimenti kill switch

## Flag stato attuale

- `spark_lightning_enabled = false` (default DB)
- Cambiare a `true` DOPO il deploy tramite admin panel

## Prerequisiti Sprint successivo (Admin Monitoring Spark)

Concordato dopo go-live: volume Lightning, fee revenue, Treasury reconciliation, health Breez node.
