/**
 * EmojiPickerButton — pulsante 😊 con pannello emoji + sticker.
 *
 * FIX CRITICO: il pannello è renderizzato via ReactDOM.createPortal in document.body.
 * Questo è necessario perché .chat-area ha transform: translateX() che crea un
 * nuovo containing block per position:fixed, rompendo il posizionamento.
 * Con il portal il pannello vive direttamente nel <body>, fuori da qualsiasi
 * overflow:hidden o transform ancestor.
 *
 * Posizione calcolata inline (non in useEffect) → nessuna race condition,
 * il pannello ha coordinate corrette sin dal primo frame.
 */

import {
  useState,
  useRef,
  useEffect,
  useCallback,
  Suspense,
  lazy,
  type CSSProperties,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import type { StickerPayload } from "../../types/sticker";
import type { AnimatedStickerPayload } from "../../types/animatedSticker";

// Lazy load dei picker — non entrano nel bundle principale
const EmojiPickerLazy = lazy(() => import("emoji-picker-react"));
const StickerPickerLazy = lazy(() =>
  import("./StickerPicker").then((m) => ({ default: m.default })),
);
const AnimatedStickerPickerLazy = lazy(() =>
  import("./AnimatedStickerPicker").then((m) => ({ default: m.default })),
);

// ── Calcola posizione pannello ancorata al pulsante ──────────────────────────
const PICKER_WIDTH   = 320;
const PICKER_MIN_H   = 280;  // minimo su schermi piccoli
const PICKER_MAX_H   = 420;  // massimo su schermi grandi
const TAB_HEIGHT     = 48;
const GAP            = 8;

interface PickerLayout {
  style: CSSProperties;
  /** Altezza effettiva del contenuto (senza tab) in px */
  contentHeight: number;
}

function computePickerLayout(
  anchorRef: RefObject<HTMLButtonElement | null>,
): PickerLayout | null {
  if (!anchorRef.current) return null;
  const rect = anchorRef.current.getBoundingClientRect();
  const vw   = window.innerWidth;
  const vh   = window.innerHeight;

  // Altezza adattiva: massimo 55% del viewport, clampata tra min e max
  const pickerHeight = Math.min(PICKER_MAX_H, Math.max(PICKER_MIN_H, vh * 0.55));

  // Posiziona sopra il pulsante; se non c'è spazio, sotto
  const fitsAbove = rect.top - GAP >= pickerHeight;
  const top       = fitsAbove
    ? rect.top - pickerHeight - GAP
    : Math.min(rect.bottom + GAP, vh - pickerHeight - GAP);

  // Centra orizzontalmente sull'ancoraggio, clampa ai margini
  let left = rect.left + rect.width / 2 - PICKER_WIDTH / 2;
  left = Math.max(GAP, Math.min(left, vw - PICKER_WIDTH - GAP));

  return {
    style: {
      position: "fixed",
      top,
      left,
      width: PICKER_WIDTH,
      height: pickerHeight,
      zIndex: 9999,
    },
    contentHeight: pickerHeight - TAB_HEIGHT,
  };
}

// ── Componente ───────────────────────────────────────────────────────────────

interface Props {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  onEmojiInsert: (native: string) => void;
  onStickerSend: (payload: StickerPayload) => void;
  onAnimatedStickerSend: (payload: AnimatedStickerPayload) => void;
  disabled?: boolean;
}

type Tab = "emoji" | "sticker" | "animated";

export default function EmojiPickerButton({
  textareaRef,
  onEmojiInsert,
  onStickerSend,
  onAnimatedStickerSend,
  disabled = false,
}: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [tab, setTab]   = useState<Tab>("emoji");
  const buttonRef       = useRef<HTMLButtonElement>(null);
  const panelRef        = useRef<HTMLDivElement>(null);

  // Layout calcolato inline — nessun useEffect, nessuna race condition
  const layout = open ? computePickerLayout(buttonRef) : null;

  // Chiudi se si tocca/clicca fuori dal pannello o dal pulsante
  useEffect(() => {
    if (!open) return;
    function onOutside(e: MouseEvent | TouchEvent) {
      if (
        !panelRef.current?.contains(e.target as Node) &&
        !buttonRef.current?.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    // touchstart per iOS (click ha 300 ms delay su Safari)
    document.addEventListener("mousedown", onOutside, true);
    document.addEventListener("touchstart", onOutside, { capture: true, passive: true });
    return () => {
      document.removeEventListener("mousedown", onOutside, true);
      document.removeEventListener("touchstart", onOutside, true);
    };
  }, [open]);

  const handleEmojiClick = useCallback(
    (emojiData: { emoji: string }) => {
      const emoji = emojiData.emoji;
      const ta    = textareaRef.current;
      if (!ta) { onEmojiInsert(emoji); return; }
      const start = ta.selectionStart ?? ta.value.length;
      const end   = ta.selectionEnd   ?? ta.value.length;
      onEmojiInsert(emoji);
      requestAnimationFrame(() => {
        ta.focus();
        const newPos = start + emoji.length;
        ta.setSelectionRange(newPos, newPos);
      });
    },
    [textareaRef, onEmojiInsert],
  );

  const handleStickerSelect = useCallback(
    (payload: StickerPayload) => {
      setOpen(false);
      onStickerSend(payload);
    },
    [onStickerSend],
  );

  const handleAnimatedStickerSelect = useCallback(
    (payload: AnimatedStickerPayload) => {
      setOpen(false);
      onAnimatedStickerSend(payload);
    },
    [onAnimatedStickerSend],
  );

  // Pannello renderizzato via portal in document.body:
  // sfugge a transform/overflow di qualsiasi ancestor nella gerarchia React
  const panel = open && layout ? createPortal(
    <div
      ref={panelRef}
      className="emoji-picker-panel"
      style={layout.style}
      /**
       * preventDefault su mousedown/pointerdown: impedisce a Safari/iOS
       * di togliere il focus alla textarea quando si tocca il pannello.
       */
      onMouseDown={(e) => {
        // Previeni il furto di focus dalla textarea SOLO se l'utente non sta
        // toccando un elemento interattivo (input ricerca, pulsanti tab, ecc.).
        // Senza questo check, la barra di ricerca non riceve il focus su iOS.
        const tag = (e.target as HTMLElement).tagName;
        if (tag !== "INPUT" && tag !== "TEXTAREA") e.preventDefault();
      }}
      onPointerDown={(e) => {
        const tag = (e.target as HTMLElement).tagName;
        if (tag !== "INPUT" && tag !== "TEXTAREA") e.preventDefault();
      }}
    >
      {/* Tab selector */}
      <div className="emoji-picker-tabs" role="tablist">
        <button
          role="tab"
          type="button"
          aria-selected={tab === "emoji"}
          className={`emoji-picker-tab${tab === "emoji" ? " active" : ""}`}
          onClick={() => setTab("emoji")}
          onMouseDown={(e) => e.preventDefault()}
        >
          {t("chat.emojiTab")}
        </button>
        <button
          role="tab"
          type="button"
          aria-selected={tab === "sticker"}
          className={`emoji-picker-tab${tab === "sticker" ? " active" : ""}`}
          onClick={() => setTab("sticker")}
          onMouseDown={(e) => e.preventDefault()}
        >
          {t("chat.stickerTab")}
        </button>
        <button
          role="tab"
          type="button"
          aria-selected={tab === "animated"}
          className={`emoji-picker-tab${tab === "animated" ? " active" : ""}`}
          onClick={() => setTab("animated")}
          onMouseDown={(e) => e.preventDefault()}
        >
          🎬 Animati
        </button>
      </div>

      {/* Contenuto — altezza adattiva al viewport */}
      <div className="emoji-picker-content">
        <Suspense fallback={
          <div className="emoji-picker-loading">
            <div className="emoji-picker-spinner" />
          </div>
        }>
          {tab === "emoji" ? (
            <EmojiPickerLazy
              onEmojiClick={handleEmojiClick}
              lazyLoadEmojis
              searchPlaceholder={t("chat.emojiPickerLabel")}
              width={PICKER_WIDTH}
              height={layout.contentHeight}
            />
          ) : tab === "sticker" ? (
            <div style={{ "--sp-height": `${layout.contentHeight}px` } as React.CSSProperties}>
              <StickerPickerLazy onSelect={handleStickerSelect} />
            </div>
          ) : (
            /* Sticker animati — lottie-react caricato lazy solo qui */
            <div style={{ "--sp-height": `${layout.contentHeight}px` } as React.CSSProperties}>
              <AnimatedStickerPickerLazy onSelect={handleAnimatedStickerSelect} />
            </div>
          )}
        </Suspense>
      </div>
    </div>,
    document.body,
  ) : null;

  return (
    <>
      {/* Pulsante 😊 */}
      <button
        ref={buttonRef}
        type="button"
        className="input-icon-btn"
        aria-label={t("chat.emojiButtonLabel")}
        title={t("chat.emojiButtonLabel")}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="22" height="22">
          <circle cx="12" cy="12" r="10"/>
          <path d="M8 14s1.5 2 4 2 4-2 4-2"/>
          <line x1="9" y1="9" x2="9.01" y2="9"/>
          <line x1="15" y1="9" x2="15.01" y2="9"/>
        </svg>
      </button>

      {/* Portal — montato in document.body, fuori da ogni ancestor transform/overflow */}
      {panel}
    </>
  );
}
