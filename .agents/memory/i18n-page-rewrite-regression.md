---
name: i18n page rewrite regression
description: Perché UsdaSettingsPage e PwaGuidePage sono state ripristinate dal git dopo la fase i18n
---

Durante i18n Phase 3, UsdaSettingsPage e PwaGuidePage sono state RISCRITTE invece che solo tradotte: perse HowItWorksDialog (bubble chat animate, flow escrow), ManualAddDialog, phone-mock negli step PWA, e usate classi CSS nuove senza stili. L'utente le ha percepite come "crashate".

**Fix (lug 2026):** ripristinate verbatim dal git (`git show 6e618d2:...UsdaSettingsPage.tsx`, `de5b017:...PwaGuidePage.tsx`) — versioni con stringhe italiane hardcoded. Le classi CSS (hiw-*, pwa-mock-*) sono ancora in index.css.

**Regola:** per i18n sostituire SOLO le stringhe dentro il JSX esistente, mai riscrivere markup/struttura. Se in futuro si ri-traducono queste due pagine, applicare t() stringa-per-stringa sulla struttura originale.

**Aggiornamento:** anche WalletCenterPage era stata riscritta → ripristinata (commit 440187d). Poi tutte e 3 le pagine ritradotte con sostituzione stringa-per-stringa (154 chiavi × 10 lingue, namespace usdaSettings/walletCenter/pwa); struttura verificata intatta via E2E + review. Stringhe con <strong>/<em> gestite con chiavi-segmento (es. iphoneStep1DescA/Strong/B).

**Nota deploy:** l'utente testa da produzione (janeway/alphachat.sbs) — le modifiche source non si vedono finché non si fa build + publish.
