/**
 * StickerPicker — griglia sticker lazy-loaded.
 *
 * Estendibile per GIF, sticker animati e pack premium senza modifiche strutturali:
 * aggiungere nuovi pack in stickerPacks.ts e il componente li mostra automaticamente.
 */
import { memo } from "react";
import { STICKER_PACKS, stickerMetaToPayload } from "../../data/stickerPacks";
import type { StickerPayload } from "../../types/sticker";
import { useTranslation } from "react-i18next";

interface Props {
  onSelect: (payload: StickerPayload) => void;
}

const StickerPicker = memo(function StickerPicker({ onSelect }: Props) {
  const { t } = useTranslation();

  return (
    <div className="sticker-picker" role="dialog" aria-label={t("chat.stickerPickerLabel")}>
      {STICKER_PACKS.map((pack) => (
        <div key={pack.packId} className="sticker-pack">
          <p className="sticker-pack-name">{pack.name}</p>
          <div className="sticker-grid">
            {pack.stickers.map((sticker) => {
              const payload = stickerMetaToPayload(sticker, pack.packId);
              return (
                <button
                  key={sticker.id}
                  type="button"
                  className="sticker-cell"
                  aria-label={sticker.alt}
                  title={sticker.alt}
                  onClick={() => onSelect(payload)}
                >
                  <img
                    src={payload.url}
                    alt={sticker.alt}
                    width={56}
                    height={56}
                    loading="lazy"
                    decoding="async"
                    draggable={false}
                  />
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
});

export default StickerPicker;
