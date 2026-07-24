---
name: Animated Sticker system (Lottie v2)
description: Architettura degli sticker animati Lottie in Alpha Chat — CDN, lazy loading, marker, compatibilità produzione
---

## Regola

Gli sticker animati usano `ANIMATED_STICKER_MARKER = "__animated_sticker__"` nel plaintext cifrato, identico al pattern degli sticker statici (v:1).

Il `message_type` inviato al server è sempre `"text"` (non `"animated_sticker"`) per compatibilità con il server di produzione non ancora aggiornato.

**Why:** Il server di produzione valida `message_type` con Zod enum. Finché non è deployato il codice con `"animated_sticker"`, mandare `"text"` evita il 422 silenzioso che fa sparire la bolla.

**How to apply:** `handleAnimatedStickerSend` in ChatPage usa `messageType: "text"`. Il rendering branch controlla `decryptedTexts.get(msg.id)?.startsWith(ANIMATED_STICKER_MARKER)` PRIMA del branch `"sticker"`.

## CDN

Google Noto Animated Emoji (Apache 2.0):
```
https://fonts.gstatic.com/s/e/notoemoji/latest/{hex}/lottie.json
```
- Vettoriale SVG, alta definizione
- CORS: `Access-Control-Allow-Origin: *` ✓
- Hex = codepoint Unicode senza zero-padding (es: `1f602` per 😂, `2764` per ❤️)

## Bundle lazy loading

- `AnimatedStickerPlayer.tsx` = wrapper lottie-react (modulo pesante ~130KB)
- `AnimatedStickerPicker.tsx` = importa Player direttamente; lazy-loaded da `EmojiPickerButton` → chunk separato
- `AnimatedStickerMessage.tsx` = ha `lazy(() => import('./AnimatedStickerPlayer'))` interno → lottie-web NON nel bundle principale
- Risultato: lottie-web si carica SOLO quando si apre il tab "Animati" O si riceve il primo sticker animato

## Performance

- `AnimatedStickerPlayer` usa `IntersectionObserver` → pausa automatica fuori viewport
- `AnimatedStickerCell` nel picker usa `IntersectionObserver` → carica il Lottie solo quando la cella è visibile
- Totale: 8 pack × 15 = 120 sticker animati

## Protocollo

```json
{ "v": 2, "messageType": "animated_sticker", "packId": "...", "stickerId": "...", "url": "...", "width": 160, "height": 160 }
```
Retrocompat: `decodeAnimatedStickerPayload` ritorna `null` se `v !== 2` → mostra "🎬 Sticker animato".
