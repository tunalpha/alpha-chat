/**
 * StickerPicker — navigazione pack orizzontale (stile Telegram) + griglia lazy.
 *
 * Architettura data-driven: aggiungere un pack richiede solo un'entry in
 * stickerPacks.ts — zero modifiche qui.
 */
import { memo, useState, useEffect, useRef, useMemo } from "react";
import { STICKER_PACKS, stickerMetaToPayload } from "../../data/stickerPacks";
import type { StickerPayload } from "../../types/sticker";
import { useTranslation } from "react-i18next";

interface Props {
  onSelect: (payload: StickerPayload) => void;
}

const StickerPicker = memo(function StickerPicker({ onSelect }: Props) {
  const { t } = useTranslation();
  const [selectedPackId, setSelectedPackId] = useState(STICKER_PACKS[0].packId);
  const activeNavRef = useRef<HTMLButtonElement>(null);

  // Porta il pulsante pack selezionato al centro della nav bar
  useEffect(() => {
    activeNavRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
      inline: "center",
    });
  }, [selectedPackId]);

  const selectedPack = useMemo(
    () => STICKER_PACKS.find((p) => p.packId === selectedPackId) ?? STICKER_PACKS[0],
    [selectedPackId],
  );

  return (
    <div className="sticker-picker" role="dialog" aria-label={t("chat.stickerPickerLabel")}>
      {/* ── Barra pack orizzontale scrollabile ── */}
      <div className="sticker-pack-nav" role="tablist" aria-label="Pack sticker">
        {STICKER_PACKS.map((pack) => {
          const isActive = pack.packId === selectedPackId;
          return (
            <button
              key={pack.packId}
              ref={isActive ? activeNavRef : undefined}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-label={pack.name}
              title={pack.name}
              className={`sticker-pack-nav-item${isActive ? " active" : ""}`}
              onClick={() => setSelectedPackId(pack.packId)}
            >
              {pack.icon}
            </button>
          );
        })}
      </div>

      {/* ── Nome pack selezionato ── */}
      <p className="sticker-pack-name">{selectedPack.name}</p>

      {/* ── Griglia sticker (solo pack selezionato — lazy nativa) ── */}
      <div className="sticker-pack-grid-area">
        <div className="sticker-grid">
          {selectedPack.stickers.map((sticker) => {
            const payload = stickerMetaToPayload(sticker, selectedPack.packId);
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
    </div>
  );
});

export default StickerPicker;
