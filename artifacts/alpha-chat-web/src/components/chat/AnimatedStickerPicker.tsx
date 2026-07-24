/**
 * AnimatedStickerPicker — griglia sticker animati con lazy loading per cella.
 *
 * Ogni cella carica il player Lottie solo quando entra nel viewport
 * (IntersectionObserver) → zero network requests per sticker fuori schermo.
 *
 * IMPORTANTE: questo file è lazy-loaded da EmojiPickerButton.
 * lottie-react (importato da AnimatedStickerPlayer) è nel chunk separato.
 */
import { memo, useState, useRef, useEffect, lazy, Suspense } from "react";
import {
  ANIMATED_STICKER_PACKS,
  animatedStickerMetaToPayload,
} from "../../data/animatedStickerPacks";
import type { AnimatedStickerPayload } from "../../types/animatedSticker";

// Player lazy: lottie-web caricato una sola volta quando il tab "Animati" è aperto
const AnimatedStickerPlayerLazy = lazy(() => import("./AnimatedStickerPlayer"));

// ── Singola cella del picker ────────────────────────────────────────────────
interface CellProps {
  payload: AnimatedStickerPayload;
  alt: string;
  onSelect: (payload: AnimatedStickerPayload) => void;
}

const AnimatedStickerCell = memo(function AnimatedStickerCell({
  payload,
  alt,
  onSelect,
}: CellProps) {
  const [inView, setInView] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const el = btnRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setInView(true);
      },
      { threshold: 0.05, rootMargin: "60px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <button
      ref={btnRef}
      type="button"
      className="animated-sticker-cell"
      aria-label={alt}
      title={alt}
      onClick={() => onSelect(payload)}
      onMouseDown={(e) => e.preventDefault()}
    >
      {inView ? (
        <Suspense
          fallback={<div className="animated-sticker-cell-placeholder" />}
        >
          <AnimatedStickerPlayerLazy url={payload.url} size={64} />
        </Suspense>
      ) : (
        <div className="animated-sticker-cell-placeholder" />
      )}
    </button>
  );
});

// ── Picker completo ──────────────────────────────────────────────────────────
interface Props {
  onSelect: (payload: AnimatedStickerPayload) => void;
}

const AnimatedStickerPicker = memo(function AnimatedStickerPicker({ onSelect }: Props) {
  return (
    <div className="sticker-picker animated-sticker-picker" role="dialog" aria-label="Sticker animati">
      {ANIMATED_STICKER_PACKS.map((pack) => (
        <div key={pack.packId} className="sticker-pack">
          <p className="sticker-pack-name">{pack.name}</p>
          <div className="animated-sticker-grid">
            {pack.stickers.map((sticker) => {
              const payload = animatedStickerMetaToPayload(sticker, pack.packId);
              return (
                <AnimatedStickerCell
                  key={sticker.id}
                  payload={payload}
                  alt={sticker.alt}
                  onSelect={onSelect}
                />
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
});

export default AnimatedStickerPicker;
