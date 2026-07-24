/**
 * AnimatedStickerPayload v:2 — sticker animati Lottie.
 *
 * Compatibilità retroattiva: client senza supporto v:2 mostrano
 * "🎬 Sticker animato" come fallback (identico al pattern v:1).
 *
 * Sicurezza:
 *   - url: HTTPS, CDN allowlist (fonts.gstatic.com, lottie.host, assets.lottiefiles.com)
 *   - width/height: ≤ 512 px
 *   - format: "lottie" (solo Lottie JSON — NO GIF, NO MP4, NO WebM)
 */
export interface AnimatedStickerPayload {
  /** v:2 — distingue dagli sticker statici (v:1) */
  v: 2;
  stickerId: string;
  packId: string;
  /** URL al file Lottie JSON (.json) */
  url: string;
  width: number;
  height: number;
  /** Testo alternativo per accessibilità */
  alt?: string;
  /** Formato always "lottie" — riserva spazio per future estensioni */
  format?: "lottie";
}

/** Marker nel body cifrato per identificare un payload sticker animato */
export const ANIMATED_STICKER_MARKER = "__animated_sticker__";

/** Serializza il payload per la cifratura Signal */
export function encodeAnimatedStickerPayload(payload: AnimatedStickerPayload): string {
  return `${ANIMATED_STICKER_MARKER}${JSON.stringify(payload)}`;
}

/**
 * Deserializza il payload dal corpo decifrato.
 * - Accetta solo v:2, format "lottie", URL HTTPS da CDN allowlist.
 * - Qualsiasi anomalia → null (mostra fallback "🎬 Sticker animato").
 */
export function decodeAnimatedStickerPayload(body: string): AnimatedStickerPayload | null {
  if (!body.startsWith(ANIMATED_STICKER_MARKER)) return null;
  try {
    const parsed = JSON.parse(body.slice(ANIMATED_STICKER_MARKER.length)) as AnimatedStickerPayload;
    if (parsed.v !== 2) return null;
    if (!parsed.url.startsWith("https://")) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Allowlist CDN per URL Lottie */
const ALLOWED_HOSTS = [
  "fonts.gstatic.com",
  "lottie.host",
  "assets.lottiefiles.com",
  "raw.githubusercontent.com",
];

/** Valida il payload prima dell'invio */
export function validateAnimatedStickerPayload(payload: AnimatedStickerPayload): void {
  const { url, width, height } = payload;
  if (!url.startsWith("https://")) throw new Error("URL sticker deve essere HTTPS");
  const host = new URL(url).hostname;
  if (!ALLOWED_HOSTS.some((h) => host.endsWith(h))) {
    throw new Error(`CDN non autorizzato: ${host}`);
  }
  if (width > 512 || height > 512) throw new Error("Dimensioni sticker eccedono 512×512 px");
}
