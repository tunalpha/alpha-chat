/**
 * Pack sticker — Twemoji CDN (MIT/CC-BY 4.0).
 * URL formato: https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/{hex}.png
 *
 * Per aggiungere un pack: creare una nuova entry in STICKER_PACKS.
 * L'architettura supporta GIF/WebP animati in futuro.
 */

import type { StickerPayload } from "../types/sticker";

const BASE = "https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72";

interface StickerMeta {
  id: string;
  alt: string;
  hex: string;
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
      { id: "joy",          alt: "😂 Risate",        hex: "1f602" },
      { id: "heart_eyes",   alt: "😍 Innamorato",    hex: "1f60d" },
      { id: "sunglasses",   alt: "😎 Cool",           hex: "1f60e" },
      { id: "thinking",     alt: "🤔 Pensieroso",    hex: "1f914" },
      { id: "wink",         alt: "😉 Occhiolino",    hex: "1f609" },
      { id: "party",        alt: "🎉 Festa",          hex: "1f389" },
      { id: "fire",         alt: "🔥 Fuoco",          hex: "1f525" },
      { id: "heart",        alt: "❤️ Cuore",          hex: "2764"  },
      { id: "thumbs_up",    alt: "👍 Ok",             hex: "1f44d" },
      { id: "clap",         alt: "👏 Applauso",       hex: "1f44f" },
      { id: "wave",         alt: "👋 Ciao",           hex: "1f44b" },
      { id: "hundred",      alt: "💯 Perfetto",       hex: "1f4af" },
      { id: "scream",       alt: "😱 Sorpresa",       hex: "1f631" },
      { id: "cry",          alt: "😢 Triste",         hex: "1f622" },
      { id: "angry",        alt: "😡 Arrabbiato",     hex: "1f621" },
      { id: "star_eyes",    alt: "🤩 Stupito",        hex: "1f929" },
    ],
  },
  {
    packId: "reactions",
    name: "Reazioni",
    stickers: [
      { id: "ok_hand",      alt: "👌 Perfetto",       hex: "1f44c" },
      { id: "muscle",       alt: "💪 Forza",          hex: "1f4aa" },
      { id: "pray",         alt: "🙏 Grazie",         hex: "1f64f" },
      { id: "raised_hands", alt: "🙌 Evviva",         hex: "1f64c" },
      { id: "point_right",  alt: "👉 Quello",         hex: "1f449" },
      { id: "facepalm",     alt: "🤦 Non ci credo",   hex: "1f926" },
      { id: "shrug",        alt: "🤷 Boh",            hex: "1f937" },
      { id: "zap",          alt: "⚡ Energia",         hex: "26a1"  },
      { id: "star",         alt: "⭐ Stella",          hex: "2b50"  },
      { id: "sparkles",     alt: "✨ Brillante",       hex: "2728"  },
      { id: "tada",         alt: "🎊 Evviva",          hex: "1f38a" },
      { id: "skull",        alt: "💀 Morto dal ridere",hex: "1f480" },
    ],
  },
  {
    packId: "food",
    name: "Cibo",
    stickers: [
      { id: "pizza",        alt: "🍕 Pizza",           hex: "1f355" },
      { id: "burger",       alt: "🍔 Burger",          hex: "1f354" },
      { id: "sushi",        alt: "🍣 Sushi",           hex: "1f363" },
      { id: "coffee",       alt: "☕ Caffè",           hex: "2615"  },
      { id: "beer",         alt: "🍺 Birra",           hex: "1f37a" },
      { id: "wine",         alt: "🍷 Vino",            hex: "1f377" },
      { id: "cake",         alt: "🎂 Torta",           hex: "1f382" },
      { id: "icecream",     alt: "🍦 Gelato",          hex: "1f366" },
      { id: "taco",         alt: "🌮 Taco",            hex: "1f32e" },
      { id: "ramen",        alt: "🍜 Ramen",           hex: "1f35c" },
      { id: "croissant",    alt: "🥐 Croissant",       hex: "1f950" },
      { id: "strawberry",   alt: "🍓 Fragola",         hex: "1f353" },
    ],
  },
  {
    packId: "animals",
    name: "Animali",
    stickers: [
      { id: "dog",          alt: "🐶 Cane",            hex: "1f436" },
      { id: "cat",          alt: "🐱 Gatto",           hex: "1f431" },
      { id: "bear",         alt: "🐻 Orso",            hex: "1f43b" },
      { id: "panda",        alt: "🐼 Panda",           hex: "1f43c" },
      { id: "fox",          alt: "🦊 Volpe",           hex: "1f98a" },
      { id: "penguin",      alt: "🐧 Pinguino",        hex: "1f427" },
      { id: "koala",        alt: "🐨 Koala",           hex: "1f428" },
      { id: "unicorn",      alt: "🦄 Unicorno",        hex: "1f984" },
      { id: "dragon",       alt: "🐉 Drago",           hex: "1f409" },
      { id: "frog",         alt: "🐸 Rana",            hex: "1f438" },
      { id: "hamster",      alt: "🐹 Criceto",         hex: "1f439" },
      { id: "octopus",      alt: "🐙 Polpo",           hex: "1f419" },
    ],
  },
  {
    packId: "sports",
    name: "Sport",
    stickers: [
      { id: "trophy",       alt: "🏆 Trofeo",          hex: "1f3c6" },
      { id: "soccer",       alt: "⚽ Calcio",           hex: "26bd"  },
      { id: "basketball",   alt: "🏀 Basket",          hex: "1f3c0" },
      { id: "tennis",       alt: "🎾 Tennis",          hex: "1f3be" },
      { id: "running",      alt: "🏃 Corsa",           hex: "1f3c3" },
      { id: "cycling",      alt: "🚴 Ciclismo",        hex: "1f6b4" },
      { id: "swimming",     alt: "🏊 Nuoto",           hex: "1f3ca" },
      { id: "ski",          alt: "⛷️ Sci",              hex: "26f7"  },
      { id: "gaming",       alt: "🎮 Gaming",          hex: "1f3ae" },
      { id: "dart",         alt: "🎯 Nel segno",       hex: "1f3af" },
      { id: "muscle_sport", alt: "🏋️ Palestra",        hex: "1f3cb" },
      { id: "medal",        alt: "🥇 Medaglia d'oro",  hex: "1f947" },
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
