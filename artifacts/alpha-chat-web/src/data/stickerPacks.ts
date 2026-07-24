/**
 * Pack sticker demo — Twemoji CDN (MIT/CC-BY 4.0).
 * URL formato: https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/{hex}.png
 *
 * Per aggiungere un pack: creare una nuova entry in STICKER_PACKS
 * con lo stesso schema. L'architettura supporta GIF/WebP animati in futuro.
 */

import type { StickerPayload } from "../types/sticker";

const BASE = "https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72";

interface StickerMeta {
  id: string;
  alt: string;
  hex: string; // nome file senza estensione
}

interface StickerPack {
  packId: string;
  name: string;
  stickers: StickerMeta[];
}

export const STICKER_PACKS: StickerPack[] = [
  {
    packId: "emotions",
    name: "Emozioni",
    stickers: [
      { id: "joy",          alt: "😂 Risate",       hex: "1f602" },
      { id: "heart_eyes",   alt: "😍 Innamorato",   hex: "1f60d" },
      { id: "sunglasses",   alt: "😎 Cool",          hex: "1f60e" },
      { id: "thinking",     alt: "🤔 Pensieroso",   hex: "1f914" },
      { id: "wink",         alt: "😉 Occhiolino",   hex: "1f609" },
      { id: "party",        alt: "🎉 Festa",         hex: "1f389" },
      { id: "fire",         alt: "🔥 Fuoco",         hex: "1f525" },
      { id: "heart",        alt: "❤️ Cuore",         hex: "2764"  },
      { id: "thumbs_up",    alt: "👍 Ok",            hex: "1f44d" },
      { id: "clap",         alt: "👏 Applauso",      hex: "1f44f" },
      { id: "wave",         alt: "👋 Ciao",          hex: "1f44b" },
      { id: "hundred",      alt: "💯 Perfetto",      hex: "1f4af" },
    ],
  },
];

/** Converte una StickerMeta in StickerPayload pronto per l'invio */
export function stickerMetaToPayload(meta: StickerMeta, packId: string): StickerPayload {
  return {
    v: 1,
    stickerId: meta.id,
    packId,
    url: `${BASE}/${meta.hex}.png`,
    width: 72,
    height: 72,
    alt: meta.alt,
  };
}
