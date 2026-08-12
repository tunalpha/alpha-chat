---
name: iOS PWA — position:fixed clippato da overflow:hidden
description: Su iOS Safari PWA, position:fixed viene clippato da un parent con overflow:hidden, contrariamente allo spec CSS.
---

# iOS Safari PWA — position:fixed + overflow:hidden = invisible

## Il bug
Su iOS Safari in modalità PWA (Add to Home Screen), elementi con `position: fixed` vengono **clippati** da un ancestor con `overflow: hidden`, come se fossero `position: absolute`. Questo NON avviene su desktop.

## Contesto in alpha-chat-web
`.aw-root { overflow: hidden; height: 100dvh; display: flex; flex-direction: column; }` — il container principale di Alpha Wallet. Qualsiasi overlay `position: fixed` inserito DENTRO `.aw-root` sarà invisibile su iPhone.

## La soluzione
Usare il **flex layout** invece di `position: fixed`. Il pannello (o qualsiasi elemento che deve stare "in fondo") diventa un figlio `flex-shrink: 0` nel flex column di `.aw-root`:

```jsx
// NON fare:
<div style={{ position: "fixed", bottom: 72, ... }} />

// FARE:
<div className="aw-root">
  <header />
  <main className="aw-content">{renderContent()}</main>
  <div style={{ flexShrink: 0, ... }}>pannello</div>  {/* àncora in fondo */}
</div>
```

**Why:** iOS Safari gestisce fixed positioning in modo non-standard in PWA standalone mode. Un parent con `overflow: hidden` diventa un containing block anche per fixed children.

**How to apply:** Qualsiasi floating UI dentro `.aw-root` deve usare flex layout, non `position: fixed`.
