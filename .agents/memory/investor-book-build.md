---
name: Investor book build command
description: Il build dell'investor-book richiede PORT e BASE_PATH come env vars esplicite
---

# Investor book — build command

## La regola
Per buildare l'investor-book da shell, passare sempre PORT e BASE_PATH:

```bash
cd artifacts/investor-book && PORT=3000 BASE_PATH=/investor-book/ pnpm build
```

**Why:** `vite.config.ts` richiede entrambe le variabili e lancia un'eccezione se mancanti.
Il dev server le riceve automaticamente dal workflow, ma la shell non le ha.

## Storia
Il bundle era fermo al 25 luglio 2026 (LightningSection aggiunta dopo → non nel dist).
Deploy distribuiva il vecchio bundle. Fix: rebuild + republish.

## Come verificare che il bundle sia aggiornato
```bash
grep -c "Lightning\|BOLT11" artifacts/investor-book/dist/public/assets/index-*.js
# deve ritornare > 0
```
