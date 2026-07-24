/**
 * Pack sticker animati — Google Noto Animated Emoji (Apache 2.0).
 * CDN: https://fonts.gstatic.com/s/e/notoemoji/latest/{hex}/lottie.json
 *
 * Alta definizione: vettoriale Lottie JSON, renderer SVG, 160×160 px in chat.
 * Il picker mostra preview Lottie 64×64 lazy-loaded per cella visibile.
 */

import type { AnimatedStickerPayload } from "../types/animatedSticker";

const BASE = "https://fonts.gstatic.com/s/e/notoemoji/latest";

interface AnimatedStickerMeta {
  id: string;
  alt: string;
  hex: string;
}

interface AnimatedStickerPack {
  packId: string;
  name: string;
  stickers: AnimatedStickerMeta[];
}

export const ANIMATED_STICKER_PACKS: AnimatedStickerPack[] = [
  // ── 1. Festeggiamenti 🎉 ───────────────────────────────────────────────────
  {
    packId: "anim_celebration",
    name: "Festeggiamenti 🎉",
    stickers: [
      { id: "party_popper",  alt: "🎉 Fuochi",             hex: "1f389" },
      { id: "confetti",      alt: "🎊 Coriandoli",         hex: "1f38a" },
      { id: "balloon",       alt: "🎈 Palloncino",         hex: "1f388" },
      { id: "partying",      alt: "🥳 Festeggiando",       hex: "1f973" },
      { id: "birthday",      alt: "🎂 Torta compleanno",   hex: "1f382" },
      { id: "fireworks",     alt: "🎆 Fuochi d'artificio",  hex: "1f386" },
      { id: "sparkler",      alt: "🎇 Sparkler",           hex: "1f387" },
      { id: "trophy",        alt: "🏆 Trofeo",             hex: "1f3c6" },
      { id: "gold_medal",    alt: "🥇 Medaglia d'oro",     hex: "1f947" },
      { id: "crown",         alt: "👑 Corona",             hex: "1f451" },
      { id: "sparkles",      alt: "✨ Brillante",           hex: "2728"  },
      { id: "glowing_star",  alt: "🌟 Stella splendente",  hex: "1f31f" },
      { id: "gift",          alt: "🎁 Regalo",             hex: "1f381" },
      { id: "clinking",      alt: "🥂 Cin cin",            hex: "1f942" },
      { id: "champagne",     alt: "🍾 Champagne",          hex: "1f37e" },
    ],
  },

  // ── 2. Amore ❤️ ─────────────────────────────────────────────────────────────
  {
    packId: "anim_love",
    name: "Amore ❤️",
    stickers: [
      { id: "red_heart",     alt: "❤️ Cuore rosso",        hex: "2764"  },
      { id: "pink_heart",    alt: "🩷 Cuore rosa",         hex: "1fa77" },
      { id: "two_hearts",    alt: "💕 Due cuori",          hex: "1f495" },
      { id: "sparkling_h",   alt: "💖 Cuore brillante",   hex: "1f496" },
      { id: "growing_h",     alt: "💗 Cuore crescente",   hex: "1f497" },
      { id: "heart_eyes",    alt: "😍 Occhi cuori",        hex: "1f60d" },
      { id: "in_love",       alt: "🥰 Innamorato",         hex: "1f970" },
      { id: "blowing_kiss",  alt: "😘 Bacio volante",      hex: "1f618" },
      { id: "kiss_mark",     alt: "💋 Impronta bacio",     hex: "1f48b" },
      { id: "heart_hands",   alt: "🫶 Mani a cuore",       hex: "1faf6" },
      { id: "rose",          alt: "🌹 Rosa",               hex: "1f339" },
      { id: "hugging",       alt: "🤗 Abbraccio",          hex: "1f917" },
      { id: "ribbon_heart",  alt: "💝 Cuore con nastro",   hex: "1f49d" },
      { id: "love_letter",   alt: "💌 Lettera d'amore",    hex: "1f48c" },
      { id: "revolving_h",   alt: "💞 Cuori rotanti",      hex: "1f49e" },
    ],
  },

  // ── 3. Facce divertenti 😂 ────────────────────────────────────────────────
  {
    packId: "anim_funny",
    name: "Divertenti 😂",
    stickers: [
      { id: "joy",           alt: "😂 Risate",             hex: "1f602" },
      { id: "rofl",          alt: "🤣 Rotolo dal ridere",  hex: "1f923" },
      { id: "skull",         alt: "💀 Morto dal ridere",   hex: "1f480" },
      { id: "clown",         alt: "🤡 Pagliaccio",         hex: "1f921" },
      { id: "scream",        alt: "😱 Shock",              hex: "1f631" },
      { id: "exploding",     alt: "🤯 Mente esplosa",      hex: "1f92f" },
      { id: "woozy",         alt: "🥴 Stordito",           hex: "1f974" },
      { id: "zany",          alt: "🤪 Pazzo",              hex: "1f92a" },
      { id: "winking_tongue",alt: "😜 Occhiolino lingua",  hex: "1f61c" },
      { id: "see_no",        alt: "🙈 Non vedere",         hex: "1f648" },
      { id: "hear_no",       alt: "🙉 Non sentire",        hex: "1f649" },
      { id: "speak_no",      alt: "🙊 Non parlare",        hex: "1f64a" },
      { id: "hand_mouth",    alt: "🤭 Mano sulla bocca",   hex: "1f92d" },
      { id: "hot_face",      alt: "🥵 Troppo caldo",       hex: "1f975" },
      { id: "cold_face",     alt: "🥶 Troppo freddo",      hex: "1f976" },
    ],
  },

  // ── 4. Reazioni 🔥 ───────────────────────────────────────────────────────
  {
    packId: "anim_reactions",
    name: "Reazioni 🔥",
    stickers: [
      { id: "fire",          alt: "🔥 Fuoco",              hex: "1f525" },
      { id: "hundred",       alt: "💯 Perfetto",           hex: "1f4af" },
      { id: "thumbs_up",     alt: "👍 Pollice su",         hex: "1f44d" },
      { id: "clap",          alt: "👏 Applauso",           hex: "1f44f" },
      { id: "raising_hands", alt: "🙌 Mani alzate",        hex: "1f64c" },
      { id: "muscle",        alt: "💪 Forza",              hex: "1f4aa" },
      { id: "bullseye",      alt: "🎯 Nel segno",          hex: "1f3af" },
      { id: "check",         alt: "✅ Fatto",              hex: "2705"  },
      { id: "rocket",        alt: "🚀 Al rialzo",          hex: "1f680" },
      { id: "gem",           alt: "💎 Diamante",           hex: "1f48e" },
      { id: "ok_hand",       alt: "👌 Perfetto",           hex: "1f44c" },
      { id: "pinched",       alt: "🤌 Bellissimo",         hex: "1f90c" },
      { id: "lightning",     alt: "⚡ Energia",             hex: "26a1"  },
      { id: "handshake",     alt: "🤝 Accordo",            hex: "1f91d" },
      { id: "wave",          alt: "👋 Ciao",               hex: "1f44b" },
    ],
  },

  // ── 5. Tecnologia 🤖 ─────────────────────────────────────────────────────
  {
    packId: "anim_tech",
    name: "Tecnologia 🤖",
    stickers: [
      { id: "robot",         alt: "🤖 Robot",              hex: "1f916" },
      { id: "laptop",        alt: "💻 Laptop",             hex: "1f4bb" },
      { id: "phone",         alt: "📱 Telefono",           hex: "1f4f1" },
      { id: "gamepad",       alt: "🎮 Videogiochi",        hex: "1f3ae" },
      { id: "headphones",    alt: "🎧 Cuffie",             hex: "1f3a7" },
      { id: "light_bulb",    alt: "💡 Idea",               hex: "1f4a1" },
      { id: "brain",         alt: "🧠 Intelligenza",       hex: "1f9e0" },
      { id: "alien",         alt: "👾 Alieno",             hex: "1f47e" },
      { id: "globe",         alt: "🌐 Rete globale",       hex: "1f310" },
      { id: "battery",       alt: "🔋 Batteria",           hex: "1f50b" },
      { id: "crystal_ball",  alt: "🔮 Sfera di cristallo", hex: "1f52e" },
      { id: "flying_saucer", alt: "🛸 Disco volante",      hex: "1f6f8" },
      { id: "planet",        alt: "🪐 Pianeta",            hex: "1fa90" },
      { id: "satellite",     alt: "📡 Satellite",          hex: "1f4e1" },
      { id: "gear",          alt: "⚙️ Ingranaggio",        hex: "2699"  },
    ],
  },

  // ── 6. Animaletti 🐱 ─────────────────────────────────────────────────────
  {
    packId: "anim_animals",
    name: "Animaletti 🐱",
    stickers: [
      { id: "cat",           alt: "🐱 Gatto",              hex: "1f431" },
      { id: "dog",           alt: "🐶 Cane",               hex: "1f436" },
      { id: "bear",          alt: "🐻 Orso",               hex: "1f43b" },
      { id: "panda",         alt: "🐼 Panda",              hex: "1f43c" },
      { id: "fox",           alt: "🦊 Volpe",              hex: "1f98a" },
      { id: "rabbit",        alt: "🐰 Coniglio",           hex: "1f430" },
      { id: "frog",          alt: "🐸 Rana",               hex: "1f438" },
      { id: "penguin",       alt: "🐧 Pinguino",           hex: "1f427" },
      { id: "unicorn",       alt: "🦄 Unicorno",           hex: "1f984" },
      { id: "butterfly",     alt: "🦋 Farfalla",           hex: "1f98b" },
      { id: "lion",          alt: "🦁 Leone",              hex: "1f981" },
      { id: "koala",         alt: "🐨 Koala",              hex: "1f428" },
      { id: "owl",           alt: "🦉 Gufo",               hex: "1f989" },
      { id: "dolphin",       alt: "🐬 Delfino",            hex: "1f42c" },
      { id: "turtle",        alt: "🐢 Tartaruga",          hex: "1f422" },
    ],
  },

  // ── 7. Natura e meteo 🌈 ─────────────────────────────────────────────────
  {
    packId: "anim_nature",
    name: "Natura 🌈",
    stickers: [
      { id: "rainbow",       alt: "🌈 Arcobaleno",         hex: "1f308" },
      { id: "sun",           alt: "☀️ Sole",               hex: "2600"  },
      { id: "moon",          alt: "🌙 Luna",               hex: "1f319" },
      { id: "star",          alt: "⭐ Stella",              hex: "2b50"  },
      { id: "snowflake",     alt: "❄️ Fiocco di neve",     hex: "2744"  },
      { id: "wave",          alt: "🌊 Onda",               hex: "1f30a" },
      { id: "cherry",        alt: "🌸 Ciliegio",           hex: "1f338" },
      { id: "sunflower",     alt: "🌻 Girasole",           hex: "1f33b" },
      { id: "tulip",         alt: "🌷 Tulipano",           hex: "1f337" },
      { id: "four_leaf",     alt: "🍀 Quadrifoglio",       hex: "1f340" },
      { id: "palm",          alt: "🌴 Palma",              hex: "1f334" },
      { id: "cactus",        alt: "🌵 Cactus",             hex: "1f335" },
      { id: "volcano",       alt: "🌋 Vulcano",            hex: "1f30b" },
      { id: "comet",         alt: "☄️ Cometa",             hex: "2604"  },
      { id: "earth",         alt: "🌍 Terra",              hex: "1f30d" },
    ],
  },

  // ── 8. Gaming e sport 🎮 ─────────────────────────────────────────────────
  {
    packId: "anim_gaming",
    name: "Gaming e Sport 🎮",
    stickers: [
      { id: "gamepad2",      alt: "🎮 Controller",         hex: "1f3ae" },
      { id: "joystick",      alt: "🕹️ Joystick",           hex: "1f579" },
      { id: "trophy2",       alt: "🏆 Trofeo",             hex: "1f3c6" },
      { id: "game_die",      alt: "🎲 Dado",               hex: "1f3b2" },
      { id: "puzzle",        alt: "🧩 Puzzle",             hex: "1f9e9" },
      { id: "bomb",          alt: "💣 Bomba",              hex: "1f4a3" },
      { id: "alien2",        alt: "👾 Alieno pixel",       hex: "1f47e" },
      { id: "basketball",    alt: "🏀 Basket",             hex: "1f3c0" },
      { id: "soccer",        alt: "⚽ Calcio",              hex: "26bd"  },
      { id: "tennis",        alt: "🎾 Tennis",             hex: "1f3be" },
      { id: "boxing",        alt: "🥊 Boxe",               hex: "1f94a" },
      { id: "dart",          alt: "🎯 Freccette",          hex: "1f3af" },
      { id: "running",       alt: "🏃 Corsa",              hex: "1f3c3" },
      { id: "muscle2",       alt: "💪 Forza",              hex: "1f4aa" },
      { id: "medal",         alt: "🏅 Medaglia",           hex: "1f3c5" },
    ],
  },
];

/** Converte una AnimatedStickerMeta in AnimatedStickerPayload */
export function animatedStickerMetaToPayload(
  meta: AnimatedStickerMeta,
  packId: string,
): AnimatedStickerPayload {
  return {
    v: 2,
    stickerId: meta.id,
    packId,
    url: `${BASE}/${meta.hex}/lottie.json`,
    width: 160,
    height: 160,
    alt: meta.alt,
    format: "lottie",
  };
}
