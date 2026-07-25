/**
 * Pack sticker — Twemoji CDN (MIT/CC-BY 4.0).
 * URL formato: https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/{hex}.png
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
  /** Emoji usata come icona nella barra di navigazione pack */
  icon: string;
  stickers: StickerMeta[];
}

export const STICKER_PACKS: StickerPack[] = [
  // ── 1. Emozioni classiche ──────────────────────────────────────────────────
  {
    packId: "emotions",
    name: "Emozioni 😂",
    icon: "😂",
    stickers: [
      { id: "joy",           alt: "😂 Ridere",          hex: "1f602" },
      { id: "rofl",          alt: "🤣 Rotolo dal ridere",hex: "1f923" },
      { id: "heart_eyes",    alt: "😍 Innamorato",       hex: "1f60d" },
      { id: "sunglasses",    alt: "😎 Cool",             hex: "1f60e" },
      { id: "thinking",      alt: "🤔 Pensieroso",       hex: "1f914" },
      { id: "wink",          alt: "😉 Occhiolino",       hex: "1f609" },
      { id: "star_eyes",     alt: "🤩 Stupito",          hex: "1f929" },
      { id: "smirk",         alt: "😏 Compiaciuto",      hex: "1f60f" },
      { id: "grin",          alt: "😁 Grossa risata",    hex: "1f601" },
      { id: "scream",        alt: "😱 Shock",            hex: "1f631" },
      { id: "cry",           alt: "😢 Triste",           hex: "1f622" },
      { id: "angry",         alt: "😡 Arrabbiato",       hex: "1f621" },
      { id: "skull",         alt: "💀 Morto dal ridere",  hex: "1f480" },
      { id: "clown",         alt: "🤡 Pagliaccio",        hex: "1f921" },
      { id: "cowboy",        alt: "🤠 Cowboy",           hex: "1f920" },
      { id: "nerd",          alt: "🤓 Nerd",             hex: "1f913" },
    ],
  },

  // ── 2. Visi moderni (trending) ─────────────────────────────────────────────
  {
    packId: "modern_faces",
    name: "Visi trendy 🥺",
    icon: "🥺",
    stickers: [
      { id: "pleading",      alt: "🥺 Ti prego",         hex: "1f97a" },
      { id: "melting",       alt: "🫠 Sciogliersi",       hex: "1fae0" },
      { id: "saluting",      alt: "🫡 Saluto",            hex: "1fae1" },
      { id: "shushing",      alt: "🤫 Silenzio",          hex: "1f92b" },
      { id: "exploding",     alt: "🤯 Mente esplosa",     hex: "1f92f" },
      { id: "hot",           alt: "🥵 Troppo caldo",      hex: "1f975" },
      { id: "cold",          alt: "🥶 Troppo freddo",     hex: "1f976" },
      { id: "nauseated",     alt: "🤢 Nauseato",          hex: "1f922" },
      { id: "sneezing",      alt: "🤧 Starnuto",          hex: "1f927" },
      { id: "monocle",       alt: "🧐 Con monocolo",      hex: "1f9d0" },
      { id: "partying",      alt: "🥳 Festeggiando",      hex: "1f973" },
      { id: "lying",         alt: "🤥 Bugiardo",          hex: "1f925" },
      { id: "hugging",       alt: "🤗 Abbraccio",         hex: "1f917" },
      { id: "money_mouth",   alt: "🤑 Soldi negli occhi", hex: "1f911" },
      { id: "zipper_mouth",  alt: "🤐 Bocca chiusa",      hex: "1f910" },
      { id: "disguised",     alt: "🥸 Travestito",        hex: "1f978" },
    ],
  },

  // ── 3. Cuori e amore ──────────────────────────────────────────────────────
  {
    packId: "hearts",
    name: "Cuori ❤️",
    icon: "❤️",
    stickers: [
      { id: "red_heart",     alt: "❤️ Cuore rosso",       hex: "2764"  },
      { id: "orange_heart",  alt: "🧡 Cuore arancione",   hex: "1f9e1" },
      { id: "yellow_heart",  alt: "💛 Cuore giallo",      hex: "1f49b" },
      { id: "green_heart",   alt: "💚 Cuore verde",       hex: "1f49a" },
      { id: "blue_heart",    alt: "💙 Cuore blu",         hex: "1f499" },
      { id: "purple_heart",  alt: "💜 Cuore viola",       hex: "1f49c" },
      { id: "black_heart",   alt: "🖤 Cuore nero",        hex: "1f5a4" },
      { id: "white_heart",   alt: "🤍 Cuore bianco",      hex: "1f90d" },
      { id: "brown_heart",   alt: "🤎 Cuore marrone",     hex: "1f90e" },
      { id: "pink_heart",    alt: "🩷 Cuore rosa",        hex: "1fa77" },
      { id: "sparkling",     alt: "💖 Cuore brillante",   hex: "1f496" },
      { id: "growing",       alt: "💗 Cuore che cresce",  hex: "1f497" },
      { id: "beating",       alt: "💓 Cuore che batte",   hex: "1f493" },
      { id: "revolving",     alt: "💞 Cuori rotanti",     hex: "1f49e" },
      { id: "two_hearts",    alt: "💕 Due cuori",         hex: "1f495" },
      { id: "kiss_heart",    alt: "💋 Bacio",             hex: "1f48b" },
    ],
  },

  // ── 4. Reazioni rapide ────────────────────────────────────────────────────
  {
    packId: "reactions",
    name: "Reazioni 👍",
    icon: "👍",
    stickers: [
      { id: "thumbs_up",     alt: "👍 Ok",               hex: "1f44d" },
      { id: "thumbs_down",   alt: "👎 No",               hex: "1f44e" },
      { id: "ok_hand",       alt: "👌 Perfetto",         hex: "1f44c" },
      { id: "muscle",        alt: "💪 Forza",            hex: "1f4aa" },
      { id: "pray",          alt: "🙏 Grazie",           hex: "1f64f" },
      { id: "clap",          alt: "👏 Applauso",         hex: "1f44f" },
      { id: "raised_hands",  alt: "🙌 Evviva",           hex: "1f64c" },
      { id: "wave",          alt: "👋 Ciao",             hex: "1f44b" },
      { id: "point_right",   alt: "👉 Quello lì",        hex: "1f449" },
      { id: "facepalm",      alt: "🤦 Non ci credo",     hex: "1f926" },
      { id: "shrug",         alt: "🤷 Boh",              hex: "1f937" },
      { id: "hundred",       alt: "💯 Perfetto",         hex: "1f4af" },
      { id: "fire",          alt: "🔥 Fuoco",            hex: "1f525" },
      { id: "sparkles",      alt: "✨ Brillante",         hex: "2728"  },
      { id: "star",          alt: "⭐ Stella",            hex: "2b50"  },
      { id: "zap",           alt: "⚡ Energia",           hex: "26a1"  },
    ],
  },

  // ── 5. Gesti moderni ──────────────────────────────────────────────────────
  {
    packId: "gestures",
    name: "Gesti ✌️",
    icon: "✌️",
    stickers: [
      { id: "pinched_fin",   alt: "🤌 Perfetto (it)",    hex: "1f90c" },
      { id: "heart_hands",   alt: "🫶 Cuore con mani",   hex: "1faf6" },
      { id: "handshake",     alt: "🤝 Stretta di mano",  hex: "1f91d" },
      { id: "love_you",      alt: "🤟 Ti voglio bene",   hex: "1f91f" },
      { id: "call_me",       alt: "🤙 Chiamami",         hex: "1f919" },
      { id: "peace",         alt: "✌️ Pace",              hex: "270c"  },
      { id: "cross_fingers", alt: "🤞 In bocca al lupo", hex: "1f91e" },
      { id: "nail_polish",   alt: "💅 Nail polish",      hex: "1f485" },
      { id: "pointing_up",   alt: "☝️ Attenzione",       hex: "261d"  },
      { id: "open_hands",    alt: "🤲 Mani aperte",      hex: "1f932" },
      { id: "writing",       alt: "✍️ Scrivendo",         hex: "270d"  },
      { id: "deaf",          alt: "🧏 Sordo",            hex: "1f9cf" },
      { id: "folded_hands",  alt: "🙇 Inchino",          hex: "1f647" },
      { id: "hand_love",     alt: "🫰 Click dita",       hex: "1faf0" },
      { id: "index_up",      alt: "🫵 Punta a te",       hex: "1faf5" },
      { id: "handshake2",    alt: "🫱 Porgi mano",       hex: "1faf1" },
    ],
  },

  // ── 6. Cibo e bevande ─────────────────────────────────────────────────────
  {
    packId: "food",
    name: "Cibo 🍕",
    icon: "🍕",
    stickers: [
      { id: "pizza",         alt: "🍕 Pizza",            hex: "1f355" },
      { id: "burger",        alt: "🍔 Burger",           hex: "1f354" },
      { id: "sushi",         alt: "🍣 Sushi",            hex: "1f363" },
      { id: "taco",          alt: "🌮 Taco",             hex: "1f32e" },
      { id: "ramen",         alt: "🍜 Ramen",            hex: "1f35c" },
      { id: "croissant",     alt: "🥐 Croissant",        hex: "1f950" },
      { id: "boba",          alt: "🧋 Bubble tea",       hex: "1f9cb" },
      { id: "coffee",        alt: "☕ Caffè",            hex: "2615"  },
      { id: "cake",          alt: "🎂 Torta",            hex: "1f382" },
      { id: "icecream",      alt: "🍦 Gelato",           hex: "1f366" },
      { id: "strawberry",    alt: "🍓 Fragola",          hex: "1f353" },
      { id: "avocado",       alt: "🥑 Avocado",          hex: "1f951" },
      { id: "spaghetti",     alt: "🍝 Spaghetti",        hex: "1f35d" },
      { id: "cheese",        alt: "🧀 Formaggio",        hex: "1f9c0" },
      { id: "hot_pepper",    alt: "🌶️ Peperoncino",      hex: "1f336" },
      { id: "wine",          alt: "🍷 Vino",             hex: "1f377" },
    ],
  },

  // ── 7. Animali ────────────────────────────────────────────────────────────
  {
    packId: "animals",
    name: "Animali 🐶",
    icon: "🐶",
    stickers: [
      { id: "dog",           alt: "🐶 Cane",             hex: "1f436" },
      { id: "cat",           alt: "🐱 Gatto",            hex: "1f431" },
      { id: "bear",          alt: "🐻 Orso",             hex: "1f43b" },
      { id: "panda",         alt: "🐼 Panda",            hex: "1f43c" },
      { id: "fox",           alt: "🦊 Volpe",            hex: "1f98a" },
      { id: "penguin",       alt: "🐧 Pinguino",         hex: "1f427" },
      { id: "unicorn",       alt: "🦄 Unicorno",         hex: "1f984" },
      { id: "dragon",        alt: "🐉 Drago",            hex: "1f409" },
      { id: "frog",          alt: "🐸 Rana",             hex: "1f438" },
      { id: "owl",           alt: "🦉 Gufo",             hex: "1f989" },
      { id: "flamingo",      alt: "🦩 Fenicottero",      hex: "1f9a9" },
      { id: "shark",         alt: "🦈 Squalo",           hex: "1f988" },
      { id: "butterfly",     alt: "🦋 Farfalla",         hex: "1f98b" },
      { id: "cat2",          alt: "🐈 Gatto seduto",     hex: "1f408" },
      { id: "sloth",         alt: "🦥 Bradipo",          hex: "1f9a5" },
      { id: "otter",         alt: "🦦 Lontra",           hex: "1f9a6" },
    ],
  },

  // ── 8. Sport e giochi ─────────────────────────────────────────────────────
  {
    packId: "sports",
    name: "Sport 🏆",
    icon: "🏆",
    stickers: [
      { id: "trophy",        alt: "🏆 Trofeo",           hex: "1f3c6" },
      { id: "soccer",        alt: "⚽ Calcio",            hex: "26bd"  },
      { id: "basketball",    alt: "🏀 Basket",           hex: "1f3c0" },
      { id: "tennis",        alt: "🎾 Tennis",           hex: "1f3be" },
      { id: "gaming",        alt: "🎮 Videogiochi",       hex: "1f3ae" },
      { id: "dart",          alt: "🎯 Nel segno",        hex: "1f3af" },
      { id: "medal_gold",    alt: "🥇 Oro",              hex: "1f947" },
      { id: "volleyball",    alt: "🏐 Pallavolo",        hex: "1f3d0" },
      { id: "football",      alt: "🏈 Football",         hex: "1f3c8" },
      { id: "golf",          alt: "⛳ Golf",             hex: "26f3"  },
      { id: "boxing",        alt: "🥊 Boxe",             hex: "1f94a" },
      { id: "ski",           alt: "⛷️ Sci",               hex: "26f7"  },
      { id: "swimming",      alt: "🏊 Nuoto",            hex: "1f3ca" },
      { id: "bicycle",       alt: "🚴 Bici",             hex: "1f6b4" },
      { id: "running",       alt: "🏃 Corsa",            hex: "1f3c3" },
      { id: "gym",           alt: "🏋️ Palestra",         hex: "1f3cb" },
    ],
  },

  // ── 9. Party e celebrazioni ───────────────────────────────────────────────
  {
    packId: "party",
    name: "Festa 🎉",
    icon: "🎉",
    stickers: [
      { id: "party_popper",  alt: "🎉 Festa",            hex: "1f389" },
      { id: "confetti",      alt: "🎊 Coriandoli",       hex: "1f38a" },
      { id: "birthday",      alt: "🎂 Compleanno",       hex: "1f382" },
      { id: "balloon",       alt: "🎈 Palloncino",       hex: "1f388" },
      { id: "fireworks",     alt: "🎆 Fuochi d'artificio",hex:"1f386"  },
      { id: "sparkler",      alt: "🎇 Sparkler",         hex: "1f387" },
      { id: "clinking",      alt: "🥂 Cin cin",          hex: "1f942" },
      { id: "champagne",     alt: "🍾 Champagne",        hex: "1f37e" },
      { id: "gift",          alt: "🎁 Regalo",           hex: "1f381" },
      { id: "ribbon",        alt: "🎀 Fiocco",           hex: "1f380" },
      { id: "tada",          alt: "🎊 Evviva",            hex: "1f38a" },
      { id: "face_party",    alt: "🥳 Festeggiando",     hex: "1f973" },
      { id: "disco",         alt: "🪩 Discoteca",        hex: "1fa69" },
      { id: "microphone",    alt: "🎤 Microfono",         hex: "1f3a4" },
      { id: "notes",         alt: "🎶 Note musicali",    hex: "1f3b6" },
      { id: "guitar",        alt: "🎸 Chitarra",         hex: "1f3b8" },
    ],
  },

  // ── 10. Natura e meteo ────────────────────────────────────────────────────
  {
    packId: "nature",
    name: "Natura 🌸",
    icon: "🌸",
    stickers: [
      { id: "cherry",        alt: "🌸 Ciliegio",         hex: "1f338" },
      { id: "sunflower",     alt: "🌻 Girasole",         hex: "1f33b" },
      { id: "tulip",         alt: "🌷 Tulipano",         hex: "1f337" },
      { id: "four_leaf",     alt: "🍀 Quadrifoglio",     hex: "1f340" },
      { id: "rainbow",       alt: "🌈 Arcobaleno",       hex: "1f308" },
      { id: "sun",           alt: "☀️ Sole",              hex: "2600"  },
      { id: "moon",          alt: "🌙 Luna",             hex: "1f319" },
      { id: "star2",         alt: "🌟 Stella lucente",   hex: "1f31f" },
      { id: "snowflake",     alt: "❄️ Fiocco di neve",   hex: "2744"  },
      { id: "leaf",          alt: "🍃 Foglia",           hex: "1f343" },
      { id: "wave",          alt: "🌊 Onda",             hex: "1f30a" },
      { id: "mountain",      alt: "⛰️ Montagna",          hex: "26f0"  },
      { id: "tornado",       alt: "🌪️ Tornado",           hex: "1f32a" },
      { id: "comet",         alt: "☄️ Cometa",            hex: "2604"  },
      { id: "earth",         alt: "🌍 Terra",            hex: "1f30d" },
      { id: "cactus",        alt: "🌵 Cactus",           hex: "1f335" },
    ],
  },

  // ── 11. Tecnologia ────────────────────────────────────────────────────────
  {
    packId: "tech",
    name: "Tecnologia 💻",
    icon: "💻",
    stickers: [
      { id: "laptop",        alt: "💻 Laptop",           hex: "1f4bb" },
      { id: "phone",         alt: "📱 Telefono",         hex: "1f4f1" },
      { id: "robot",         alt: "🤖 Robot",            hex: "1f916" },
      { id: "alien",         alt: "👾 Alieno",            hex: "1f47e" },
      { id: "headphones",    alt: "🎧 Cuffie",           hex: "1f3a7" },
      { id: "camera",        alt: "📷 Fotocamera",       hex: "1f4f7" },
      { id: "rocket",        alt: "🚀 Razzo",            hex: "1f680" },
      { id: "satellite",     alt: "🛸 Disco volante",     hex: "1f6f8" },
      { id: "joystick",      alt: "🕹️ Joystick",         hex: "1f579" },
      { id: "magnet",        alt: "🧲 Magnete",          hex: "1f9f2" },
      { id: "crystal_ball",  alt: "🔮 Sfera di cristallo",hex:"1f52e"  },
      { id: "dna",           alt: "🧬 DNA",              hex: "1f9ec" },
      { id: "atom",          alt: "⚛️ Atomo",             hex: "269b"  },
      { id: "satellite2",    alt: "📡 Satellite",        hex: "1f4e1" },
      { id: "electric",      alt: "🔋 Batteria",         hex: "1f50b" },
      { id: "ai",            alt: "🧠 Cervello / AI",    hex: "1f9e0" },
    ],
  },

  // ── 12. Viaggi ────────────────────────────────────────────────────────────
  {
    packId: "travel",
    name: "Viaggi ✈️",
    icon: "✈️",
    stickers: [
      { id: "airplane",      alt: "✈️ Aereo",             hex: "2708"  },
      { id: "beach",         alt: "🏖️ Spiaggia",          hex: "1f3d6" },
      { id: "palm",          alt: "🌴 Palma",             hex: "1f334" },
      { id: "luggage",       alt: "🧳 Valigia",           hex: "1f9f3" },
      { id: "compass",       alt: "🧭 Bussola",           hex: "1f9ed" },
      { id: "map",           alt: "🗺️ Mappa",             hex: "1f5fa" },
      { id: "tent",          alt: "⛺ Tenda",             hex: "26fa"  },
      { id: "train",         alt: "🚂 Treno",             hex: "1f682" },
      { id: "ship",          alt: "🛳️ Nave",              hex: "1f6f3" },
      { id: "passport",      alt: "🛂 Passaporto",        hex: "1f6c2" },
      { id: "statue",        alt: "🗽 Statua della Libertà",hex:"1f5fd" },
      { id: "eiffel",        alt: "🗼 Torre Eiffel",      hex: "1f5fc" },
      { id: "moai",          alt: "🗿 Moai",              hex: "1f5ff" },
      { id: "world",         alt: "🌐 Globo",             hex: "1f310" },
      { id: "taxi",          alt: "🚕 Taxi",              hex: "1f695" },
      { id: "motorbike",     alt: "🏍️ Moto",              hex: "1f3cd" },
    ],
  },

  // ── 13. Simboli e icone ───────────────────────────────────────────────────
  {
    packId: "symbols",
    name: "Simboli ✨",
    icon: "✨",
    stickers: [
      { id: "diamond",       alt: "💎 Diamante",          hex: "1f48e" },
      { id: "crown",         alt: "👑 Corona",            hex: "1f451" },
      { id: "trophy2",       alt: "🏆 Coppa",             hex: "1f3c6" },
      { id: "money_bag",     alt: "💰 Soldi",             hex: "1f4b0" },
      { id: "chart",         alt: "📈 Grafico su",        hex: "1f4c8" },
      { id: "lock",          alt: "🔒 Lucchetto",         hex: "1f512" },
      { id: "key",           alt: "🔑 Chiave",            hex: "1f511" },
      { id: "warning",       alt: "⚠️ Attenzione",        hex: "26a0"  },
      { id: "check",         alt: "✅ Ok",                hex: "2705"  },
      { id: "cross",         alt: "❌ No",                hex: "274c"  },
      { id: "bell",          alt: "🔔 Campanella",        hex: "1f514" },
      { id: "megaphone",     alt: "📣 Megafono",          hex: "1f4e3" },
      { id: "pin",           alt: "📌 Puntina",           hex: "1f4cc" },
      { id: "target",        alt: "🎯 Obiettivo",         hex: "1f3af" },
      { id: "gem",           alt: "💠 Gemma",             hex: "1f4a0" },
      { id: "infinity",      alt: "♾️ Infinito",           hex: "267e"  },
    ],
  },

  // ── 14. USDA — Pagamenti & Crypto ─────────────────────────────────────────
  {
    packId: "usda",
    name: "USDA 💸",
    icon: "💸",
    stickers: [
      { id: "money_wings",   alt: "💸 Soldi che volano",  hex: "1f4b8" },
      { id: "money_bag",     alt: "💰 Sacchetto soldi",   hex: "1f4b0" },
      { id: "coin",          alt: "🪙 Moneta",            hex: "1fa99" },
      { id: "credit_card",   alt: "💳 Carta di credito",  hex: "1f4b3" },
      { id: "bank",          alt: "🏦 Banca",             hex: "1f3e6" },
      { id: "dollar",        alt: "💵 Dollaro",           hex: "1f4b5" },
      { id: "euro",          alt: "💶 Euro",              hex: "1f4b6" },
      { id: "chart_up",      alt: "📈 Grafico in salita", hex: "1f4c8" },
      { id: "chart_bar",     alt: "📊 Statistiche",       hex: "1f4ca" },
      { id: "chart_green",   alt: "💹 Al rialzo",         hex: "1f4b9" },
      { id: "moneymouth",    alt: "🤑 Ricco",             hex: "1f911" },
      { id: "gem2",          alt: "💎 Diamante",          hex: "1f48e" },
      { id: "lock_key",      alt: "🔐 Protetto",          hex: "1f510" },
      { id: "chain",         alt: "⛓️ Blockchain",        hex: "26d3"  },
      { id: "globe2",        alt: "🌐 Rete globale",      hex: "1f310" },
      { id: "rocket2",       alt: "🚀 Al rialzo",         hex: "1f680" },
    ],
  },

  // ── 15. AI Mood ───────────────────────────────────────────────────────────
  {
    packId: "ai_mood",
    name: "AI Mood 🤖",
    icon: "🤖",
    stickers: [
      { id: "thinking",     alt: "🤔 Thinking",        hex: "1f914" },
      { id: "loading",      alt: "⌛ Loading",          hex: "231b"  },
      { id: "brain_freeze", alt: "🧊 Brain Freeze",     hex: "1f9ca" },
      { id: "genius",       alt: "💡 Genius",           hex: "1f4a1" },
      { id: "prompt_ok",    alt: "✅ Prompt Accepted",  hex: "2705"  },
      { id: "error_404",    alt: "❌ Error 404",        hex: "274c"  },
      { id: "ai_smile",     alt: "🤖 AI Smile",         hex: "1f916" },
      { id: "ai_love",      alt: "🤍 AI Love",          hex: "1f90d" },
      { id: "ai_shock",     alt: "😲 AI Shock",         hex: "1f632" },
      { id: "ai_laugh",     alt: "😄 AI Laugh",         hex: "1f604" },
    ],
  },

  // ── 16. Crypto Life ───────────────────────────────────────────────────────
  {
    packId: "crypto_life",
    name: "Crypto Life 🚀",
    icon: "🚀",
    stickers: [
      { id: "moon",          alt: "🌕 To The Moon",    hex: "1f315" },
      { id: "wagmi",         alt: "💪 WAGMI",           hex: "1f4aa" },
      { id: "ngmi",          alt: "😭 NGMI",            hex: "1f62d" },
      { id: "diamond_hands", alt: "💎 Diamond Hands",  hex: "1f48e" },
      { id: "paper_hands",   alt: "📄 Paper Hands",    hex: "1f4c4" },
      { id: "bull",          alt: "🐂 Bull",            hex: "1f402" },
      { id: "bear",          alt: "🐻 Bear",            hex: "1f43b" },
      { id: "whale",         alt: "🐋 Whale",           hex: "1f40b" },
      { id: "hodl",          alt: "🔒 HODL",            hex: "1f512" },
      { id: "gm",            alt: "🌅 GM",              hex: "1f305" },
      { id: "gn",            alt: "🌙 GN",              hex: "1f319" },
      { id: "pump",          alt: "📈 Pump",            hex: "1f4c8" },
      { id: "dump",          alt: "📉 Dump",            hex: "1f4c9" },
    ],
  },

  // ── 17. Startup Life ──────────────────────────────────────────────────────
  {
    packId: "startup_life",
    name: "Startup Life 💡",
    icon: "💡",
    stickers: [
      { id: "ship_it",    alt: "🚢 Ship It",              hex: "1f6a2" },
      { id: "deploy",     alt: "🚀 Deploy",               hex: "1f680" },
      { id: "bug_fixed",  alt: "🐛 Bug Fixed",            hex: "1f41b" },
      { id: "coffee",     alt: "☕ Coffee First",          hex: "2615"  },
      { id: "works_omm",  alt: "💻 Works On My Machine",  hex: "1f4bb" },
      { id: "mvp_ready",  alt: "🏆 MVP Ready",            hex: "1f3c6" },
      { id: "merge_ok",   alt: "✅ Merge Approved",       hex: "2705"  },
      { id: "coding",     alt: "📝 Coding",               hex: "1f4dd" },
      { id: "deadline",   alt: "⏰ Deadline",              hex: "23f0"  },
      { id: "success",    alt: "🎉 Success",              hex: "1f389" },
    ],
  },

  // ── 18. Internet Memes ────────────────────────────────────────────────────
  {
    packId: "internet_memes",
    name: "Internet Memes 🗿",
    icon: "🗿",
    stickers: [
      { id: "bruh",    alt: "🗿 Bruh",   hex: "1f5ff" },
      { id: "cringe",  alt: "😬 Cringe", hex: "1f62c" },
      { id: "sus",     alt: "🔴 Sus",    hex: "1f534" },
      { id: "sigma",   alt: "👑 Sigma",  hex: "1f451" },
      { id: "npc",     alt: "🤖 NPC",   hex: "1f916" },
      { id: "rizz",    alt: "😎 Rizz",  hex: "1f60e" },
      { id: "gg",      alt: "🎮 GG",    hex: "1f3ae" },
      { id: "ez",      alt: "😏 EZ",    hex: "1f60f" },
      { id: "cooked",  alt: "🔥 Cooked",hex: "1f525" },
      { id: "sheesh",  alt: "🥶 Sheesh",hex: "1f976" },
    ],
  },

  // ── 19. Alpha Pets ────────────────────────────────────────────────────────
  {
    packId: "alpha_pets",
    name: "Alpha Pets 😺",
    icon: "😺",
    stickers: [
      { id: "hello",   alt: "😺 Hello",   hex: "1f63a" },
      { id: "bye",     alt: "😸 Bye",     hex: "1f638" },
      { id: "love",    alt: "😻 Love",    hex: "1f63b" },
      { id: "thanks",  alt: "🙏 Thanks",  hex: "1f64f" },
      { id: "lol",     alt: "😹 LOL",     hex: "1f639" },
      { id: "angry",   alt: "😾 Angry",   hex: "1f63e" },
      { id: "sleep",   alt: "😴 Sleep",   hex: "1f634" },
      { id: "party",   alt: "🎊 Party",   hex: "1f38a" },
      { id: "victory", alt: "🏅 Victory", hex: "1f3c5" },
      { id: "wow",     alt: "🙀 Wow",     hex: "1f640" },
    ],
  },

  // ── 20. Gaming ────────────────────────────────────────────────────────────
  {
    packId: "gaming",
    name: "Gaming 🎮",
    icon: "🎮",
    stickers: [
      { id: "victory",  alt: "🏆 Victory",        hex: "1f3c6" },
      { id: "headshot", alt: "🎯 Headshot",        hex: "1f3af" },
      { id: "respawn",  alt: "💫 Respawn",          hex: "1f4ab" },
      { id: "afk",      alt: "🛌 AFK",             hex: "1f6cc" },
      { id: "noob",     alt: "🍼 Noob",            hex: "1f37c" },
      { id: "gg",       alt: "🎮 GG",              hex: "1f3ae" },
      { id: "boss",     alt: "👊 Boss Fight",       hex: "1f44a" },
      { id: "level_up", alt: "🆙 Level Up",         hex: "1f199" },
      { id: "mission",  alt: "✅ Mission Complete", hex: "2705"  },
      { id: "rage",     alt: "💢 Rage Quit",        hex: "1f4a2" },
    ],
  },

  // ── 21. Everyday Mood ─────────────────────────────────────────────────────
  {
    packId: "everyday_mood",
    name: "Everyday Mood ☕",
    icon: "☕",
    stickers: [
      { id: "coffee",  alt: "☕ Coffee",   hex: "2615"  },
      { id: "monday",  alt: "😩 Monday",   hex: "1f629" },
      { id: "weekend", alt: "🎉 Weekend",  hex: "1f389" },
      { id: "sleep",   alt: "😴 Sleep",    hex: "1f634" },
      { id: "hungry",  alt: "🍕 Hungry",   hex: "1f355" },
      { id: "relax",   alt: "🛁 Relax",    hex: "1f6c1" },
      { id: "late",    alt: "⏰ Late",      hex: "23f0"  },
      { id: "busy",    alt: "📱 Busy",     hex: "1f4f1" },
      { id: "vacation",alt: "🌴 Vacation", hex: "1f334" },
      { id: "home",    alt: "🏠 Home",     hex: "1f3e0" },
    ],
  },

  // ── 22. Mini Reactions ────────────────────────────────────────────────────
  {
    packId: "mini_reactions",
    name: "Mini Reactions 🎬",
    icon: "🎬",
    stickers: [
      { id: "applause",    alt: "👏 Applause",    hex: "1f44f" },
      { id: "facepalm",    alt: "🤦 Facepalm",    hex: "1f926" },
      { id: "mic_drop",    alt: "🎤 Mic Drop",    hex: "1f3a4" },
      { id: "popcorn",     alt: "🍿 Popcorn",     hex: "1f37f" },
      { id: "fire",        alt: "🔥 Fire",         hex: "1f525" },
      { id: "explosion",   alt: "💥 Explosion",   hex: "1f4a5" },
      { id: "confetti",    alt: "🎊 Confetti",    hex: "1f38a" },
      { id: "happy_dance", alt: "💃 Happy Dance", hex: "1f483" },
      { id: "heart_rain",  alt: "💝 Heart Rain",  hex: "1f49d" },
      { id: "celebration", alt: "🥳 Celebration", hex: "1f973" },
    ],
  },

  // ── 23. Alpha Originals ───────────────────────────────────────────────────
  {
    packId: "alpha_originals",
    name: "Alpha Originals 💜",
    icon: "💜",
    stickers: [
      { id: "welcome",     alt: "🤝 Welcome",          hex: "1f91d" },
      { id: "thank_you",   alt: "🙏 Thank You",         hex: "1f64f" },
      { id: "congrats",    alt: "🎊 Congratulations",  hex: "1f38a" },
      { id: "mission",     alt: "✅ Mission Complete",  hex: "2705"  },
      { id: "secure",      alt: "🔐 Secure Chat",       hex: "1f510" },
      { id: "pay_sent",    alt: "💸 Payment Sent",      hex: "1f4b8" },
      { id: "pay_recv",    alt: "💰 Payment Received",  hex: "1f4b0" },
      { id: "lets_go",     alt: "🚀 Let's Go",          hex: "1f680" },
      { id: "awesome",     alt: "⭐ Awesome",            hex: "2b50"  },
      { id: "stay_safe",   alt: "🔒 Stay Safe",         hex: "1f512" },
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
