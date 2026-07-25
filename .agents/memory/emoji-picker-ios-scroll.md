---
name: emoji-picker-react iOS scroll
description: epr-body non scrolla su iOS Safari PWA — nessun fix CSS funziona; serve scroll manuale JS
---

**Problema:** la griglia emoji di `emoji-picker-react` (`.epr-body`) non riceve il pan gesture su iOS Safari standalone (PWA), mentre i div propri (sticker picker) scrollano normalmente.

**Tentativi CSS falliti (5+ deploy):** `overflow: visible` sui container, `clip-path` per il clipping visuale, `touch-action: pan-y !important`, `-webkit-overflow-scrolling: touch`, `overscroll-behavior: contain`, `stopPropagation` su touchmove/touchstart del pannello React. Nessuno ha sbloccato lo scroll.

**Fix definitivo:** scroll guidato manualmente in `EmojiPickerButton.tsx` — useEffect che aggancia listener touch nativi su `.epr-body` (touchstart passive, touchmove `{passive:false}` con `preventDefault()` + `scrollTop` manuale, touchend con momentum via rAF e decay 0.95). Il nodo è lazy-loaded → retry con setInterval 150ms finché `.epr-body` appare.

**Why:** iOS Safari PWA rifiuta il pan nativo su quel container della libreria per cause interne alla libreria; combattere via CSS è tempo perso.

**How to apply:** qualsiasi container di libreria terza che non scrolla su iOS PWA → passare subito allo scroll manuale JS invece di iterare sui CSS.
