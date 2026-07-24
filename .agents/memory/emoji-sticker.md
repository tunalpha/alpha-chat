---
name: Emoji Picker + Sticker system
description: Architettura e decisioni chiave per emoji picker e sticker in Alpha Chat
---

# Emoji Picker + Sticker

## Struttura componenti
- `src/components/chat/EmojiPickerButton.tsx` — pulsante + pannello con 2 tab
- `src/components/chat/StickerPicker.tsx` — griglia sticker
- `src/components/chat/StickerMessage.tsx` — renderer bolla sticker
- `src/types/sticker.ts` — StickerPayload, encode/decode, STICKER_MARKER
- `src/data/stickerPacks.ts` — pack Twemoji CDN

## BUG CRITICO POST-DEPLOY (risolto)

**Sintomo:** pulsante 😊 visibile ma picker mai mostrato; su iOS apriva solo la tastiera.

**Causa 1 — transform breaking fixed:** `.chat-area` ha `transform: translateX()` per le animazioni mobile. Un elemento con `transform` diventa un nuovo containing block per `position: fixed`. Il pannello si posizionava relativo a `.chat-area`, non al viewport → visivamente fuori schermo.

**Causa 2 — race condition style:** lo style era calcolato in `useEffect` (dopo il paint). Al primo frame il pannello aveva `style={}` (position: static) dentro `chat-input-bar` con `overflow: hidden` → clippato immediatamente.

**Fix:** `ReactDOM.createPortal(panel, document.body)` — il pannello vive in `<body>`, sfugge a tutti gli ancestor con transform/overflow. Posizione calcolata inline (non in useEffect), nessuna race condition.

## Decisioni chiave

**Portal obbligatorio:** qualsiasi overlay/pannello che deve apparire sopra tutto in Alpha Chat va renderizzato via `createPortal(el, document.body)`. Il motivo è `transform: translateX()` su `.chat-area` che rompe `position: fixed` per tutti i discendenti.

**Lazy load:** `emoji-picker-react` è importato con `React.lazy()` — chunk separato da 309KB, non caricato finché non si apre il picker.

**Posizionamento iOS-safe:** Nessun `env(keyboard-inset-height)`. Usa `getBoundingClientRect()` sul pulsante anchor per calcolare `top/left` del panel `fixed`. Funziona su iOS Safari, PWA, Android.

**Preservazione focus iOS:** `onMouseDown`/`onPointerDown` con `e.preventDefault()` sull'intero pannello picker. Impedisce a Safari di togliere il focus alla textarea.

**Inserimento emoji al cursore:** `setInputText()` legge `ta.selectionStart/End` dall'`activeElement` (rimane focus grazie a preventDefault), poi `requestAnimationFrame(() => ta.setSelectionRange(newPos, newPos))`.

**Sticker come payload cifrato:** `message_type: "sticker"`, body = `encodeStickerPayload()` → cifrato Signal come testo normale. Backend aggiunge solo `"sticker"` alla union MessageType (nessuna migrazione Mongo).

**Retrocompatibilità:** `StickerMessage` mostra "📎 Sticker" se payload non decodificabile o img fallisce. Client vecchi che non conoscono il tipo sticker vedono il fallback.

**Sicurezza:** `validateStickerPayload()` in sticker.ts controlla HTTPS, max 512×512px.

**Why:**
Requisito esplicito: zero modifiche a Signal, WebSocket, crittografia. Sticker deve essere E2E come i messaggi testo.
