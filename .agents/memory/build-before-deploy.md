---
name: Build before deploy
description: Production serves static dist/public; always run pnpm build after source changes before suggesting deploy
---

# Build before deploy — regola obbligatoria

**Why:** La produzione (`alpha-chat-web`) serve file statici precompilati da `artifacts/alpha-chat-web/dist/public`. Il dev server usa HMR e aggiorna al volo, ma `dist/` NON si aggiorna automaticamente con le modifiche al sorgente.

**How to apply:** Dopo ogni sessione di editing su `artifacts/alpha-chat-web/src/`, eseguire sempre:
```
cd artifacts/alpha-chat-web && pnpm run build
```
Solo dopo che la build è completata con successo, suggerire il deploy. Non suggerire mai deploy prima della build.

**Nota:** La stessa regola vale per qualsiasi altro artifact che abbia un `dist/` statico servito in produzione (admin-panel, investor-book, ecc.).
