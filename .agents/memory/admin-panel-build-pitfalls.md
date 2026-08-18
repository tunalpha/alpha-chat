---
name: Admin Panel build pitfalls
description: Import errors that silently break the admin-panel Vite build at publish time.
---

# Admin Panel build pitfalls

## Rule
Always import React hooks from `"react"`, never from `"preact/hooks"` — the admin-panel uses React + Vite, not Preact.

**Why:** `preact/hooks` is not installed in the admin-panel workspace. The dev server may not surface this (HMR may work) but `vite build` fails hard with "Rollup failed to resolve import".

## Rule
Use `"../lib/api"` (not `"../lib/apiFetch"` or any other name) for the apiFetch helper.

**Why:** The admin-panel's API client lives at `artifacts/admin-panel/src/lib/api.ts` and exports `apiFetch`. Any other import path causes a Rollup resolution error that only surfaces at build time.

## How to apply
- Any new admin-panel page: check imports before committing.
- Run `pnpm --filter @workspace/admin-panel exec vite build --config vite.config.ts` locally to verify before suggesting publish.
- Both errors occurred in `swap-providers.tsx` (created 2026-08-18) and broke the publish build.
