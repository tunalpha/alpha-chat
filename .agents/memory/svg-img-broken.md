---
name: SVG broken in img tag — malformed XML
description: iOS Safari strict SVG parser rejects malformed SVG in <img> tags; logo.svg had invalid `/ filter=` attribute syntax causing broken image placeholder
---

# SVG broken-image in iOS Safari `<img>` tag

## The rule

Never use a malformed SVG as `<img src>` — iOS Safari uses a strict XML parser for images and will show a broken-image placeholder even when the same SVG renders fine inline or on desktop browsers.

**Why:** Desktop browsers (Chrome, Firefox) are lenient SVG parsers and silently fix malformed attributes. iOS Safari in `<img>` mode uses a strict parser — any XML error causes a complete load failure with no console error.

**How to apply:** For logo/icon images loaded via `<img>` in production:
- Prefer PNG (binary format, no parser) — universally safe
- If SVG is required, validate it as strict XML before bundling
- Vite asset import (`import logoUrl from "../assets/logo.png"`) is the correct pattern for either format — generates a hashed URL, bypasses BASE_URL/proxy path issues

## Incident

`logo.svg` contained `/ filter="url(#shadow-inner)"` (space + slash before the attribute name) on `<path>` elements. This is invalid XML — the `/` is interpreted as a premature self-close in strict mode. Desktop showed the logo fine; iOS Safari showed a blue "?" broken-image placeholder every time.

Attempts that failed:
1. `/logo.svg` (absolute URL) → 404 through proxy
2. `${import.meta.env.BASE_URL}logo.svg` → still 404 (BASE_PATH not set in dev → BASE_URL=`/` → proxy root mismatch)  
3. `import logoAwUrl from "../assets/logo-aw.svg"` → Vite import correct, but SVG content itself malformed → iOS still broken

Fix: `import logoAwUrl from "../assets/logo-aw.png"` — PNG from `public/logo.png` copied to `src/assets/logo-aw.png`.
