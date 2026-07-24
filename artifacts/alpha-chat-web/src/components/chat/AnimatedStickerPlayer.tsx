/**
 * AnimatedStickerPlayer — Lottie player ad alta definizione.
 *
 * Usa lottie-react (wrapper ufficiale lottie-web) con:
 * - renderer SVG (vettoriale, infinite resolution)
 * - autoplay + loop
 * - IntersectionObserver: pausa automatica fuori dal viewport
 *   → zero impatto su scrolling e React quando fuori schermo
 * - memo: nessun re-render su cambi di stato del parent
 *
 * IMPORTANTE: questo file è lazy-loaded dai consumer (AnimatedStickerPicker,
 * AnimatedStickerMessage) — lottie-web non entra nel bundle principale.
 */
import { memo, useRef, useEffect } from "react";
import Lottie from "lottie-react";
import type { LottieRefCurrentProps } from "lottie-react";

interface Props {
  /** URL Lottie JSON (Google Noto Animated Emoji CDN) */
  url: string;
  /** Dimensione in px (quadrato) — default 160 per chat, 64 per picker */
  size?: number;
  /** Classe CSS aggiuntiva */
  className?: string;
}

const AnimatedStickerPlayer = memo(function AnimatedStickerPlayer({
  url,
  size = 160,
  className,
}: Props) {
  const lottieRef = useRef<LottieRefCurrentProps>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Pausa automatica quando esce dal viewport — fondamentale per le performance
  // su chat con molti sticker animati in sequenza.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        const lottie = lottieRef.current;
        if (!lottie) return;
        if (entry.isIntersecting) {
          lottie.play();
        } else {
          lottie.pause();
        }
      },
      { threshold: 0.1 },
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ width: size, height: size, display: "inline-flex", alignItems: "center", justifyContent: "center" }}
    >
      <Lottie
        lottieRef={lottieRef}
        path={url}
        loop
        autoplay
        rendererSettings={{ preserveAspectRatio: "xMidYMid meet" }}
        style={{ width: size, height: size }}
      />
    </div>
  );
});

export default AnimatedStickerPlayer;
