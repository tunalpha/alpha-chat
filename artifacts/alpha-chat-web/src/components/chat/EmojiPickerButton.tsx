/**
 * EmojiPickerButton — pulsante 😊 con pannello emoji + sticker.
 *
 * Caratteristiche:
 *  - Lazy import del picker emoji (non blocca il bundle principale)
 *  - Posizionamento ancorato al pulsante (getBoundingClientRect, nessun keyboard-inset-height)
 *  - preventDefault su mousedown/pointerdown: il focus rimane sulla textarea su iOS
 *  - Inserimento emoji nella posizione del cursore (selectionStart/End)
 *  - Due tab: Emoji | Sticker
 *  - Click-outside per chiudere
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
import { useTranslation } from "react-i18next";
import type { StickerPayload } from "../../types/sticker";

// Lazy load del picker — non aumenta il tempo di apertura della chat
const EmojiPickerLazy = lazy(() => import("emoji-picker-react"));
const StickerPickerLazy = lazy(() =>
  import("./StickerPicker").then((m) => ({ default: m.default })),
);

// ── Calcola posizione pannello ancorata al pulsante ──────────────────────────
const PICKER_WIDTH  = 320;
const PICKER_HEIGHT = 380;
const GAP           = 8;

function computePickerStyle(
  anchorRef: RefObject<HTMLButtonElement | null>,
): CSSProperties {
  if (!anchorRef.current) return { display: "none" };
  const rect = anchorRef.current.getBoundingClientRect();
  const vw   = window.innerWidth;
  const vh   = window.innerHeight;

  // Posiziona sopra il pulsante; se non c'è spazio, sotto
  const spaceAbove = rect.top - GAP;
  const fitsAbove  = spaceAbove >= PICKER_HEIGHT;
  const top        = fitsAbove
    ? rect.top - PICKER_HEIGHT - GAP
    : Math.min(rect.bottom + GAP, vh - PICKER_HEIGHT - GAP);

  // Centra orizzontalmente sull'ancoraggio, clampa ai margini
  let left = rect.left + rect.width / 2 - PICKER_WIDTH / 2;
  left = Math.max(GAP, Math.min(left, vw - PICKER_WIDTH - GAP));

  return {
    position: "fixed",
    top,
    left,
    width: PICKER_WIDTH,
    zIndex: 1100,
  };
}

// ── Componente ───────────────────────────────────────────────────────────────

interface Props {
  /** Ref alla textarea — usato per inserire l'emoji alla posizione del cursore */
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  /** Callback testo: inserisce l'emoji nel valore corrente */
  onEmojiInsert: (native: string) => void;
  /** Callback sticker: avvia l'invio */
  onStickerSend: (payload: StickerPayload) => void;
  disabled?: boolean;
}

type Tab = "emoji" | "sticker";

export default function EmojiPickerButton({
  textareaRef,
  onEmojiInsert,
  onStickerSend,
  disabled = false,
}: Props) {
  const { t } = useTranslation();
  const [open, setOpen]   = useState(false);
  const [tab, setTab]     = useState<Tab>("emoji");
  const buttonRef         = useRef<HTMLButtonElement>(null);
  const panelRef          = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<CSSProperties>({});

  // Ricalcola posizione ogni volta che si apre
  useEffect(() => {
    if (open) setStyle(computePickerStyle(buttonRef));
  }, [open]);

  // Click-outside per chiudere
  useEffect(() => {
    if (!open) return;
    function handleOutside(e: MouseEvent | TouchEvent) {
      if (
        !panelRef.current?.contains(e.target as Node) &&
        !buttonRef.current?.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleOutside, true);
    document.addEventListener("touchstart", handleOutside, true);
    return () => {
      document.removeEventListener("mousedown", handleOutside, true);
      document.removeEventListener("touchstart", handleOutside, true);
    };
  }, [open]);

  /** Inserisce l'emoji nella posizione del cursore della textarea */
  const handleEmojiClick = useCallback(
    (emojiData: { emoji: string }) => {
      const emoji = emojiData.emoji;
      const ta    = textareaRef.current;
      if (!ta) {
        onEmojiInsert(emoji);
        return;
      }
      const start = ta.selectionStart ?? ta.value.length;
      const end   = ta.selectionEnd   ?? ta.value.length;
      // Inserisce e notifica il parent
      onEmojiInsert(emoji);
      // Ripristina la posizione del cursore dopo il render
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

      {/* Pannello picker */}
      {open && (
        <div
          ref={panelRef}
          className="emoji-picker-panel"
          style={style}
          /**
           * Impedisce che Safari tolga il focus alla textarea.
           * preventDefault su mousedown/pointerdown è il metodo più affidabile.
           */
          onMouseDown={(e) => e.preventDefault()}
          onPointerDown={(e) => e.preventDefault()}
        >
          {/* Tab selector */}
          <div className="emoji-picker-tabs" role="tablist">
            <button
              role="tab"
              aria-selected={tab === "emoji"}
              className={`emoji-picker-tab${tab === "emoji" ? " active" : ""}`}
              onClick={() => setTab("emoji")}
              onMouseDown={(e) => e.preventDefault()}
            >
              {t("chat.emojiTab")}
            </button>
            <button
              role="tab"
              aria-selected={tab === "sticker"}
              className={`emoji-picker-tab${tab === "sticker" ? " active" : ""}`}
              onClick={() => setTab("sticker")}
              onMouseDown={(e) => e.preventDefault()}
            >
              {t("chat.stickerTab")}
            </button>
          </div>

          {/* Contenuto */}
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
                  height={PICKER_HEIGHT - 48} /* -48 per i tab */
                />
              ) : (
                <StickerPickerLazy onSelect={handleStickerSelect} />
              )}
            </Suspense>
          </div>
        </div>
      )}
    </>
  );
}
