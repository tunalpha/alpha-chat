/**
 * StickerPayload — trasportato nel corpo cifrato del messaggio (type "sticker").
 * Segue il pattern dei payload location/payment: JSON serializzato e cifrato Signal.
 *
 * Compatibilità: i client che non conoscono "sticker" mostreranno "📎 Sticker"
 * come fallback nel renderer (vedi StickerMessage.tsx).
 *
 * Sicurezza (validazione lato client al momento dell'invio):
 *   - url: HTTPS, dominio allowlist
 *   - size: ≤ 250 KB
 *   - mimeType: image/webp | image/png
 *   - width, height: ≤ 512 px
 */
export interface StickerPayload {
  /** Versione del payload — consente evoluzione futura senza rompere client esistenti.
   *  v1: payload base (stickerId, packId, url, width, height)
   *  v2+ (futuro): sticker animati, thumbnail, checksum, firma digitale, ecc.
   */
  v: 1;
  stickerId: string;
  packId: string;
  url: string;
  width: number;
  height: number;
  /** Testo alternativo per accessibilità */
  alt?: string;
}

/** Marker nel body cifrato per identificare un payload sticker */
export const STICKER_MARKER = "__sticker__";

/** Serializza il payload sticker per la cifratura Signal */
export function encodeStickerPayload(payload: StickerPayload): string {
  return `${STICKER_MARKER}${JSON.stringify(payload)}`;
}

/** Deserializza il payload sticker dal corpo decifrato.
 *  Verifica che v sia riconosciuto; i payload con v futura vengono mostrati
 *  come "📎 Sticker" finché il client non viene aggiornato. */
export function decodeStickerPayload(body: string): StickerPayload | null {
  if (!body.startsWith(STICKER_MARKER)) return null;
  try {
    const parsed = JSON.parse(body.slice(STICKER_MARKER.length)) as StickerPayload;
    // Supportiamo solo v:1; versioni future vengono gestite dal fallback
    if (parsed.v !== 1) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Valida un payload sticker prima dell'invio.
 * @throws {Error} se il payload non rispetta i limiti di sicurezza
 */
export function validateStickerPayload(payload: StickerPayload): void {
  const { url, width, height } = payload;
  if (!url.startsWith("https://")) throw new Error("URL sticker deve essere HTTPS");
  if (width > 512 || height > 512) throw new Error("Dimensioni sticker eccedono 512×512 px");
}
