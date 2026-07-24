---
name: PDF export via headless Chromium + print CSS pitfalls
description: How to export artifact pages to PDF and the dark-theme print CSS rules needed
---

**Rule:** For PDF export of a dark-theme web artifact, use the nix-store ungoogled-chromium binary (find via `ls /nix/store | grep chromium`, e.g. 131.x) with `--headless --no-sandbox --virtual-time-budget=20000 --no-pdf-header-footer --print-to-pdf=... http://127.0.0.1:80/<preview-path>`. No puppeteer/playwright needed.

**Why:** No chrome on PATH; installing playwright browsers on NixOS is fragile. The nix-store binary works directly (used for the Investor Book, lug 2026).

**How to apply — print CSS for dark themes:**
- `.text-white`, `.text-foreground` AND `[class*='text-foreground']`/`[class*='text-white/']` must be forced to black in `@media print`, otherwise text is invisible white-on-white (opacity variants like `text-foreground/80` escape exact-class selectors).
- `.overflow-x-auto { overflow: visible !important }` + `table { min-width:0 !important; font-size:9pt }` or tables get clipped with a printed scrollbar.
- Use `page-break-before: always` per section (not `page-break-inside: avoid` globally — clips long chapters); `table, tr { page-break-inside: avoid }`.
- Verify by rasterizing pages with `pdftoppm -png` and viewing them.
