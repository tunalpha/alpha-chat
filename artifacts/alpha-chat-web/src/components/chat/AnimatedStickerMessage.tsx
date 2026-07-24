/**
 * AnimatedStickerMessage — bolla sticker animato in chat.
 *
 * - Decodifica il payload dal body cifrato
 * - Renderizza AnimatedStickerPlayer (lazy-loaded → lottie-web non nel bundle main)
 * - Fallback "🎬 Sticker animato" per client senza supporto v:2
 */
import { lazy, Suspense } from "react";
import { decodeAnimatedStickerPayload } from "../../types/animatedSticker";

// Lazy: lottie-react caricato solo quando arriva/si invia il primo sticker animato
const AnimatedStickerPlayerLazy = lazy(() => import("./AnimatedStickerPlayer"));

interface Props {
  /** Corpo decifrato (ANIMATED_STICKER_MARKER + JSON) */
  body: string;
}

export default function AnimatedStickerMessage({ body }: Props) {
  const payload = decodeAnimatedStickerPayload(body);

  if (!payload) {
    return (
      <span className="sticker-fallback" aria-label="Sticker animato non supportato">
        🎬 Sticker animato
      </span>
    );
  }

  return (
    <div className="animated-sticker-msg" aria-label={payload.alt ?? "Sticker animato"}>
      <Suspense
        fallback={
          <div
            className="animated-sticker-placeholder"
            style={{ width: 160, height: 160 }}
            aria-hidden
          />
        }
      >
        <AnimatedStickerPlayerLazy
          url={payload.url}
          size={160}
          className="animated-sticker-msg-player"
        />
      </Suspense>
    </div>
  );
}
