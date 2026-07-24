/**
 * StickerMessage — renderizza una bolla sticker.
 *
 * Compatibilità retroattiva: se il payload non è decodificabile,
 * mostra il fallback testuale "📎 Sticker" per i client senza supporto.
 */
import { useState } from "react";
import { decodeStickerPayload } from "../../types/sticker";
import { useTranslation } from "react-i18next";

interface Props {
  /** Testo decifrato del messaggio (contiene il marker + payload JSON) */
  body: string;
}

export default function StickerMessage({ body }: Props) {
  const { t } = useTranslation();
  const [imgError, setImgError] = useState(false);
  const payload = decodeStickerPayload(body);

  // Fallback per client vecchi o payload corrotti
  if (!payload || imgError) {
    return (
      <span className="sticker-fallback" aria-label={t("chat.stickerAlt")}>
        {t("chat.stickerSent")}
      </span>
    );
  }

  return (
    <img
      src={payload.url}
      alt={payload.alt ?? t("chat.stickerAlt")}
      aria-label={payload.alt ?? t("chat.stickerAlt")}
      width={120}
      height={120}
      loading="lazy"
      decoding="async"
      className="sticker-img"
      onError={() => setImgError(true)}
      draggable={false}
    />
  );
}
