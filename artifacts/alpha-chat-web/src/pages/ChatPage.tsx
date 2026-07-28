import { useState, useEffect, useRef, useCallback, memo } from "react";
import { createPortal } from "react-dom";
// ── USDA Payments ─────────────────────────────────────────────────────────
import { UsdaPaymentBubble }    from "../components/usda/UsdaPaymentBubble";
import { ChatPaymentBubble }    from "../components/usda/ChatPaymentBubble";
import type { ChatPaymentData } from "../lib/payment-api";
import { UsdaRequestBubble } from "../components/usda/UsdaRequestBubble";
import { SendUsdaSheet } from "../components/usda/SendUsdaSheet";
import { SendPaymentSheet } from "../components/usda/SendPaymentSheet";
import { RequestUsdaSheet } from "../components/usda/RequestUsdaSheet";
import { UsdaPaymentDetail } from "../components/usda/UsdaPaymentDetail";

import type { UsdaPaymentData } from "../lib/usda-types";
import { useAuth } from "../contexts/AuthContext";
import { useCall } from "../contexts/CallContext";
import { useWs } from "../contexts/WebSocketContext";
import type { WsEvent } from "../hooks/useWebSocket";
import type { AppView } from "../App";
import {
  apiListConversations,
  apiListMessages,
  apiSendMessage,
  apiEditMessage,
  apiDeleteMessage,
  apiSecureDestroy,
  apiSendVoiceMessage,
  apiSendFileMessage,
  apiUploadEncryptedMedia,
  apiSendMediaMessage,
  apiMarkRead,
  apiSetDisappearing,
  apiGetAllKeyBundles,
  apiGetKeyBundle,
  apiGetGroup,
  apiSignalAudit,
  apiFetchAndDecryptMediaBlob,
  decodeMessage,
  decodeVoiceMeta,
  decodeMediaMeta,
  decodeLocationMeta,
  type LocationMeta,
  AuthExpiredError,
  type ConversationItem,
  type MessageItem,
  type MediaMeta,
} from "../lib/api";

/** Fire-and-forget: invia evento di audit Signal al server invece di console.debug. */
function reportAudit(tag: string, data: Record<string, unknown>): void {
  void apiSignalAudit(tag, data).catch(() => {});
}
import {
  signalEncrypt,
  signalDecrypt,
  safeDecodeForPreview,
  encryptMediaBlob,
  encryptBlobWithKey,
  signalEncryptMulti,
  signalDecryptFromDeviceCiphertexts,
  maybeReplenishOtpks,
  SessionLostError,
} from "../lib/signal";
import {
  initMediaCache,
  cacheOwnMessageMeta,
  cacheDecryptedMeta,
  getMetaByMessageId,
  getMetaByClientId,
  cacheOwnText,
  cacheOwnTextByServerId,
  getTextByClientId,
  getTextByServerId,
} from "../lib/media-cache";
import { type VoiceBlob } from "../hooks/useVoiceRecorder";
import VoiceHoldRecorder from "../components/VoiceHoldRecorder";
import { attachAudioUnlockListener, playNotifSound, unlockNotifAudio } from "../lib/notifSound";
import { primeRemoteAudio } from "../lib/remoteAudio";
import VoiceMessage from "../components/VoiceMessage";
import MediaMessage from "../components/MediaMessage";
import PendingMediaBubble, { type MediaUploadState, type MediaUploadPhase } from "../components/PendingMediaBubble";
import MediaViewer from "../components/MediaViewer";
import LocationMessage from "../components/LocationMessage";
import LocationViewer from "../components/LocationViewer";
import InviteModal from "../components/InviteModal";
import CreateGroupModal from "../components/CreateGroupModal";
import GroupInfoPage from "./GroupInfoPage";
import RedeemModal from "../components/RedeemModal";
import DeviceManager from "../components/DeviceManager";
// Fase 5 — Safety Number + TOFU
import SafetyNumberModal from "../components/SafetyNumberModal";
import {
  getSignalStore,
  checkAndUpdateTrust,
  markVerified,
  acceptKeyChange,
  hashDeviceId,
  type TrustStatus,
} from "../lib/signal";
import { arrayBufferToBase64 } from "@workspace/libsignal-ts";
import { resetAndRebuildSession } from "../lib/signal/signal-session";
import ConfirmModal from "../components/ConfirmModal";
import { apiClearConversationMessages } from "../lib/api";
import { archiveConversation } from "./ArchivioPage";
import { useTranslation } from "react-i18next";
import EmojiPickerButton from "../components/chat/EmojiPickerButton";
import StickerMessage from "../components/chat/StickerMessage";
import AnimatedStickerMessage from "../components/chat/AnimatedStickerMessage";
import {
  encodeStickerPayload,
  decodeStickerPayload,
  type StickerPayload,
  STICKER_MARKER,
} from "../types/sticker";
import {
  encodeAnimatedStickerPayload,
  type AnimatedStickerPayload,
  ANIMATED_STICKER_MARKER,
} from "../types/animatedSticker";

interface Props {
  onNavigate: (view: AppView) => void;
  /** Quando impostato, apre direttamente quella conversazione (es. da cronologia chiamate). */
  requestedConvId?: string | null;
  /** Chiamato dopo aver aperto la conversazione richiesta, per azzerare il valore nel parent. */
  onConvOpened?: () => void;
}

// ── BurnParticles — scintille stile Telegram per dissoluzione BAR ────────────
// Direzioni pre-calcolate (sin/cos di 0°,45°…315° × 40px) — nessun Math.random
const SPARK_DIRS: Array<{ dx: number; dy: number; delay: number; color: string }> = [
  { dx:   0, dy: -40, delay: 0.00, color: '#ffd700' },
  { dx:  28, dy: -28, delay: 0.04, color: '#ff6b35' },
  { dx:  40, dy:   0, delay: 0.08, color: '#ffd700' },
  { dx:  28, dy:  28, delay: 0.03, color: '#ff4500' },
  { dx:   0, dy:  40, delay: 0.06, color: '#ff6b35' },
  { dx: -28, dy:  28, delay: 0.02, color: '#ffd700' },
  { dx: -40, dy:   0, delay: 0.07, color: '#ff4500' },
  { dx: -28, dy: -28, delay: 0.05, color: '#ff6b35' },
  { dx:  15, dy: -38, delay: 0.01, color: '#fff' },
  { dx:  38, dy: -15, delay: 0.09, color: '#fff' },
  { dx: -15, dy:  38, delay: 0.02, color: '#fff' },
  { dx: -38, dy:  15, delay: 0.06, color: '#fff' },
];

const BurnParticles = memo(function BurnParticles() {
  return (
    <div className="burn-particles" aria-hidden="true">
      {SPARK_DIRS.map((s, i) => (
        <span
          key={i}
          className="burn-spark"
          style={{
            '--dx': `${s.dx}px`,
            '--dy': `${s.dy}px`,
            '--delay': `${s.delay}s`,
            '--color': s.color,
          } as React.CSSProperties}
        />
      ))}
    </div>
  );
});

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Ritorna true se il testo contiene SOLO emoji (max ~5) senza testo alfanumerico.
 * Usato per mostrare emoji-only senza bolla, stile Telegram/WhatsApp.
 */
function isEmojiOnly(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 28) return false;
  // \p{Extended_Pictographic} cattura emoji reali senza includere cifre/punteggiatura
  const nonEmoji = trimmed.replace(
    /[\p{Extended_Pictographic}\p{Emoji_Modifier}\uFE0F\u20E3\u200D\s]/gu,
    "",
  );
  return nonEmoji.length === 0;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
}

function formatConvTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  return isToday
    ? d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString("it-IT", { day: "2-digit", month: "short" });
}

// ── Chat header with call/video/menu ────────────────────────────────────────
function ChatHeader({
  otherUser,
  isOnline,
  isGroup,
  groupName,
  onBack,
  onViewProfile,
  onSearchInChat,
  onCallAudio,
  onCallVideo,
  onBlockUser,
  onToast,
  isMuted,
  onSilenzia,
  onMediaGallery,
  onClearChat,
  trustStatus,
  onOpenSafetyNumber,
  onSessionReset,
  onGroupInfo,
}: {
  otherUser: { display_name: string; username: string; avatar_url?: string | null } | null | undefined;
  isOnline: boolean;
  isGroup?: boolean;
  groupName?: string;
  onBack: () => void;
  onViewProfile: () => void;
  onSearchInChat: () => void;
  onCallAudio: () => void;
  onCallVideo: () => void;
  onBlockUser: () => void;
  onToast: (msg: string) => void;
  isMuted: boolean;
  onSilenzia: () => void;
  onMediaGallery: () => void;
  onClearChat: () => void;
  trustStatus?: TrustStatus | "loading" | null;
  onOpenSafetyNumber?: () => void;
  onSessionReset?: () => void;
  onGroupInfo?: () => void;
}) {
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [showContactPhoto, setShowContactPhoto] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  const closeMenu = () => setMenuOpen(false);

  const menuItems: {
    label: string;
    icon: string;
    danger?: boolean;
    soon?: boolean;
    onClick: () => void;
  }[] = [
    ...(isGroup
      ? [{ label: "Info gruppo", icon: "ℹ️", onClick: () => { closeMenu(); onGroupInfo?.(); } },
         { label: "Aggiungi membri", icon: "➕", onClick: () => { closeMenu(); onGroupInfo?.(); } }]
      : [{ label: t("profile.title"), icon: "👤", onClick: () => { closeMenu(); onViewProfile(); } }]
    ),
    { label: t("chat.sendImage"), icon: "🖼️", onClick: () => { closeMenu(); onMediaGallery(); } },
    { label: t("chat.searchMessages"), icon: "🔍", onClick: () => { closeMenu(); onSearchInChat(); } },
    { label: isMuted ? t("notifications.messages") : t("notifications.messages"), icon: isMuted ? "🔔" : "🔕", onClick: () => { closeMenu(); onSilenzia(); } },
    { label: "Reset E2E session", icon: "🔄", onClick: () => { closeMenu(); onSessionReset?.(); } },
    ...(!isGroup
      ? [{ label: t("chat.blockUser"), icon: "🚫", danger: true, onClick: () => { closeMenu(); onBlockUser(); } }]
      : []
    ),
    { label: t("chat.clearHistory"), icon: "🗑️", danger: true, onClick: () => { closeMenu(); onClearChat(); } },
  ];

  const trustBadge = trustStatus && trustStatus !== "loading"
    ? { verified: "✅", unverified: "⚠️", key_changed: "🔴" }[trustStatus]
    : null;

  return (
    <div className="chat-header">
      <button className="chat-back-btn" onClick={onBack} aria-label="Torna alla lista">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
          <polyline points="15 18 9 12 15 6" />
        </svg>
      </button>

      <button
        className={`avatar avatar-md${isGroup ? " avatar-group" : ""} avatar-tapable`}
        onClick={() => { if (!isGroup) setShowContactPhoto(true); }}
        aria-label={isGroup ? undefined : "Vedi foto profilo"}
        style={{ cursor: isGroup ? "default" : "pointer" }}
      >
        {isGroup ? "👥" : (otherUser?.display_name[0]?.toUpperCase() ?? "?")}
      </button>

      {showContactPhoto && !isGroup && otherUser && (
        <ProfilePhotoModal
          avatarUrl={otherUser.avatar_url}
          displayName={otherUser.display_name}
          username={otherUser.username}
          connected={isOnline}
          onClose={() => setShowContactPhoto(false)}
        />
      )}

      <div className="chat-header-info">
        <div className="chat-header-name">{isGroup ? (groupName ?? "Gruppo") : (otherUser?.display_name ?? otherUser?.username ?? "Utente sconosciuto")}</div>
        <div className="chat-header-status-row">
          <div className={`chat-header-status ${isGroup ? "offline" : (isOnline ? "online" : "offline")}`}>
            {isGroup ? `◎ Gruppo` : (isOnline ? `● ${t("chat.online")}` : `○ ${t("chat.offline")}`)}
          </div>
          {trustBadge && (
            <button
              className="trust-badge-btn"
              onClick={onOpenSafetyNumber}
              title={{ verified: "Identità verificata", unverified: "Non verificata — tocca per verificare", key_changed: "Chiave cambiata — tocca per verificare" }[trustStatus as TrustStatus]}
              aria-label="Stato verifica identità"
            >
              {trustBadge}
            </button>
          )}
        </div>
      </div>

      <div className="chat-header-actions">
        <button className="icon-btn icon-btn-header" title="Chiamata vocale (prossimamente)" aria-label="Chiamata" onClick={onCallAudio}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
            <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.61 3.4 2 2 0 0 1 3.6 1.22h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.8a16 16 0 0 0 5.55 5.55l.95-.95a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>
          </svg>
        </button>
        <button className="icon-btn icon-btn-header" title="Videochiamata (prossimamente)" aria-label="Videochiamata" onClick={onCallVideo}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
            <polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/>
          </svg>
        </button>

        <div className="chat-menu-wrapper" ref={menuRef}>
          <button
            className="icon-btn icon-btn-header"
            aria-label="Menu"
            onClick={() => setMenuOpen((v) => !v)}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
              <circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/>
            </svg>
          </button>
          {menuOpen && (
            <div className="chat-menu-dropdown">
              {onOpenSafetyNumber && (
                <button
                  className="chat-menu-item"
                  onClick={() => { setMenuOpen(false); onOpenSafetyNumber(); }}
                >
                  <span className="chat-menu-icon">🔐</span>
                  Numero di sicurezza
                  {trustStatus === "key_changed" && <span className="chat-menu-badge trust-badge-alert">!</span>}
                </button>
              )}
              {menuItems.map((item) => (
                <button
                  key={item.label}
                  className={`chat-menu-item${item.danger ? " danger" : ""}`}
                  onClick={item.onClick}
                >
                  <span className="chat-menu-icon">{item.icon}</span>
                  {item.label}
                  {item.soon && <span className="chat-menu-badge">Presto</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Expires countdown (messaggi a scomparsa) ─────────────────────────────────
function ExpiresCountdown({ expiresAt }: { expiresAt: string }) {
  const [remaining, setRemaining] = useState<string>("");

  useEffect(() => {
    function update() {
      const ms = new Date(expiresAt).getTime() - Date.now();
      if (ms <= 0) { setRemaining("scaduto"); return; }
      if (ms < 60_000)       setRemaining(`${Math.ceil(ms / 1_000)}s`);
      else if (ms < 3_600_000) setRemaining(`${Math.ceil(ms / 60_000)}m`);
      else if (ms < 86_400_000) setRemaining(`${Math.ceil(ms / 3_600_000)}h`);
      else                   setRemaining(`${Math.ceil(ms / 86_400_000)}g`);
    }
    update();
    const t = setInterval(update, 1_000);
    return () => clearInterval(t);
  }, [expiresAt]);

  return (
    <span className="msg-expires" title={`Scade: ${new Date(expiresAt).toLocaleString("it-IT")}`}>
      ⏱ {remaining}
    </span>
  );
}

// ── Chat input bar ───────────────────────────────────────────────────────────
function ChatInput({
  value,
  onChange,
  onSubmit,
  onVoiceSend,
  onRecordingChange,
  onAttach,
  onAttachMenu,
  onEmojiInsert,
  onStickerSend,
  onAnimatedStickerSend,
  disabled,
  burnAfterRead,
  onToggleBurn,
}: {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onSubmit: (e: React.FormEvent) => void;
  onVoiceSend: (voice: VoiceBlob) => void;
  onRecordingChange: (active: boolean) => void;
  onAttach?: (files: FileList) => void;
  /** Quando fornito, il pulsante 📎 apre il menu allegati invece del file picker diretto */
  onAttachMenu?: () => void;
  /** Callback per inserire un'emoji nella posizione del cursore */
  onEmojiInsert?: (emoji: string) => void;
  /** Callback per inviare uno sticker statico */
  onStickerSend?: (payload: StickerPayload) => void;
  /** Callback per inviare uno sticker animato */
  onAnimatedStickerSend?: (payload: AnimatedStickerPayload) => void;
  disabled: boolean;
  burnAfterRead?: boolean;
  onToggleBurn?: () => void;
}) {
  const { t } = useTranslation();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const localFileRef = useRef<HTMLInputElement>(null);
  const hasText = value.trim().length > 0;
  const [showHoldHint, setShowHoldHint] = useState(false);
  const holdHintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function flashHoldHint() {
    setShowHoldHint(true);
    if (holdHintTimerRef.current) clearTimeout(holdHintTimerRef.current);
    holdHintTimerRef.current = setTimeout(() => setShowHoldHint(false), 1800);
  }
  useEffect(() => () => { if (holdHintTimerRef.current) clearTimeout(holdHintTimerRef.current); }, []);

  // Auto-resize textarea up to 6 lines
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    const lineHeight = 22;
    const maxHeight = lineHeight * 6 + 24;
    ta.style.height = Math.min(ta.scrollHeight, maxHeight) + "px";
  }, [value]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (hasText && !disabled) onSubmit(e as unknown as React.FormEvent);
    }
  }

  return (
    <form className="chat-input-bar" onSubmit={onSubmit}>
      {/* Burn After Read toggle */}
      {onToggleBurn && (
        <button
          type="button"
          className={`input-icon-btn bar-toggle${burnAfterRead ? " bar-active" : ""}`}
          aria-label="Burn After Read"
          title={burnAfterRead ? "Burn After Read attivo — il messaggio si autodistrugge alla lettura" : "Attiva Burn After Read"}
          onClick={onToggleBurn}
          disabled={disabled}
        >
          🔥
        </button>
      )}
      {/* Allega — Sprint 13: foto, video, documenti */}
      <input
        ref={localFileRef}
        type="file"
        accept="image/*,video/*,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.*,text/plain,audio/*"
        style={{ display: "none" }}
        onChange={(e) => {
          if (e.target.files && onAttach) onAttach(e.target.files);
          // FIX: reset il valore così la stessa foto può essere riselezionata (iOS fix)
          e.target.value = "";
        }}
      />
      <button
        type="button"
        className="input-icon-btn"
        aria-label={t("chat.attachShare")}
        title={t("chat.attachShare")}
        disabled={disabled}
        onClick={() => onAttachMenu ? onAttachMenu() : localFileRef.current?.click()}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="22" height="22">
          <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
        </svg>
      </button>

      {/* Pulsante 😊 Emoji + Sticker — ordine: 🔥 | 📎 | 😊 | textarea | invia/🎤 */}
      {onEmojiInsert && onStickerSend && onAnimatedStickerSend && (
        <EmojiPickerButton
          textareaRef={textareaRef}
          onEmojiInsert={onEmojiInsert}
          onStickerSend={onStickerSend}
          onAnimatedStickerSend={onAnimatedStickerSend}
          disabled={disabled}
        />
      )}

      <textarea
        ref={textareaRef}
        className="chat-textarea"
        placeholder="Scrivi un messaggio…"
        value={value}
        onChange={onChange}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        rows={1}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={true}
      />

      {hasText ? (
        <button type="submit" className="send-btn" disabled={disabled} aria-label="Invia">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
            <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
          </svg>
        </button>
      ) : (
        <VoiceHoldRecorder
          onSend={onVoiceSend}
          onRecordingChange={onRecordingChange}
          onTapHint={flashHoldHint}
          disabled={disabled}
        />
      )}

      {showHoldHint && (
        <div className="voice-hold-hint" role="status">{t("chat.holdToRecord")}</div>
      )}
    </form>
  );
}

// ── Profile photo fullscreen viewer ──────────────────────────────────────────
function ProfilePhotoModal({
  avatarUrl,
  displayName,
  username,
  connected,
  onClose,
  onAction,
  actionLabel,
  actionIcon,
}: {
  avatarUrl?: string | null;
  displayName: string;
  username: string;
  connected: boolean;
  onClose: () => void;
  onAction?: () => void;
  actionLabel?: string;
  actionIcon?: React.ReactNode;
}) {
  const { t } = useTranslation();
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  return createPortal(
    <div className="profile-photo-overlay" onClick={onClose}>
      <div className="profile-photo-modal" onClick={(e) => e.stopPropagation()}>
        <button className="profile-photo-close" onClick={onClose} aria-label="Chiudi">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="20" height="20">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>

        <div className="profile-photo-img-wrap">
          {avatarUrl
            ? <img src={avatarUrl} alt={displayName} className="profile-photo-img" />
            : <div className="avatar avatar-xl profile-photo-initial">{displayName[0]?.toUpperCase()}</div>
          }
        </div>

        <div className="profile-photo-info">
          <div className="profile-photo-name">{displayName}</div>
          <div className="profile-photo-username">@{username}</div>
          <div className={`profile-photo-status ${connected ? "online" : "offline"}`}>
            {connected ? `● ${t("chat.online")}` : `○ ${t("chat.offline")}`}
          </div>
        </div>

        {onAction && actionLabel && (
          <button className="profile-photo-edit-btn" onClick={() => { onClose(); onAction(); }}>
            {actionIcon}
            {actionLabel}
          </button>
        )}
      </div>
    </div>,
    document.body
  );
}

// ── Sidebar user menu ────────────────────────────────────────────────────────
function SidebarMenu({
  displayName,
  username,
  connected,
  avatarUrl,
  onNavigate,
  onLogout,
  onLogoutAll,
  loggingOut,
}: {
  displayName: string;
  username: string;
  connected: boolean;
  avatarUrl?: string | null;
  onNavigate: (v: AppView) => void;
  onLogout: () => void;
  onLogoutAll: () => void;
  loggingOut: boolean;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const navItems: { label: string; view: AppView; icon: React.ReactNode }[] = [
    {
      label: t("nav.profile"),
      view: "profile",
      icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>,
    },
    {
      label: t("settings.privacySecurity"),
      view: "privacy",
      icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>,
    },
    {
      label: t("settings.devices"),
      view: "devices",
      icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16"><rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>,
    },
    {
      label: t("nav.settings"),
      view: "settings",
      icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>,
    },
    {
      label: t("nav.archive"),
      view: "archive",
      icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/></svg>,
    },
    {
      label: t("nav.usdaPayments"),
      view: "usda-settings",
      icon: null,
    },
    {
      label: `🛡️ ${t("settings.securityCenterLabel")}`,
      view: "security-center",
      icon: null,
    },
    {
      label: t("calls:historyTitle", "Chiamate"),
      view: "call-history",
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
             strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
          <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.62 3.37 2 2 0 0 1 3.62 1h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.6a16 16 0 0 0 6 6l.96-.96a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>
        </svg>
      ),
    },
  ];

  return (
    <div className="user-menu-wrapper" ref={ref}>
      {/* Avatar → apre menu impostazioni (comportamento originale) */}
      <button
        className="avatar-menu-btn"
        onClick={() => setOpen((v) => !v)}
        aria-label={t("nav.settings")}
        aria-expanded={open}
      >
        {avatarUrl
          ? <img src={avatarUrl} alt={displayName} className="avatar avatar-sm" style={{ objectFit: "cover", borderRadius: "50%" }} />
          : <div className="avatar avatar-sm">{displayName[0]?.toUpperCase()}</div>
        }
      </button>

      {open && (
        <div className="user-menu-dropdown">
          <div className="user-menu-header">
            <div className="user-menu-name">{displayName}</div>
            <div className="user-menu-username">@{username}</div>
            <div className={`user-menu-status ${connected ? "online" : "offline"}`}>
              {connected ? `● ${t("chat.online")}` : `○ ${t("chat.offline")}`}
            </div>
          </div>

          <div className="user-menu-section">
            {navItems.map((item) => (
              <button
                key={item.view}
                className="user-menu-item"
                onClick={() => { setOpen(false); onNavigate(item.view); }}
              >
                {item.icon}
                {item.label}
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14" className="menu-chevron">
                  <polyline points="9 18 15 12 9 6"/>
                </svg>
              </button>
            ))}
          </div>

          <div className="user-menu-divider" />

          <div className="user-menu-section">
            <button className="user-menu-item danger" onClick={onLogout} disabled={loggingOut}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
              {loggingOut ? t("chat.loggingOut") : t("settings.logout")}
            </button>
            <button className="user-menu-item danger" onClick={onLogoutAll} disabled={loggingOut}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/><line x1="5" y1="8" x2="5" y2="16" strokeDasharray="2 2"/></svg>
              {t("settings.logoutAll")}
            </button>
            <button
              className="user-menu-item user-menu-nuclear"
              onClick={() => { setOpen(false); onNavigate("nuclear-destroy"); }}
            >
              ☢
              {t("nav.nuclearProtocol")}
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14" className="menu-chevron"><polyline points="9 18 15 12 9 6"/></svg>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main ChatPage ────────────────────────────────────────────────────────────
export default function ChatPage({ onNavigate, requestedConvId, onConvOpened }: Props) {
  const { auth, logout, logoutAll } = useAuth();
  const { connected, on, send: wsSend, sendTypingStart, sendTypingStop, onlineUsers } = useWs();
  const { initiateCall } = useCall();

  const { t } = useTranslation();
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [inputText, setInputText] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [loadingConvs, setLoadingConvs] = useState(true);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [mobileShowChat, setMobileShowChat] = useState(false);
  // Ref specchio per il popstate listener (evita closure stale)
  const mobileShowChatRef = useRef(false);
  // Traccia se abbiamo fatto un pushState per il tasto back OS
  const chatHistoryPushedRef = useRef(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [showRedeem, setShowRedeem] = useState(false);
  const [showDeviceManager, setShowDeviceManager] = useState(false);
  const [showContactProfile, setShowContactProfile] = useState(false);
  const [showChatSearch, setShowChatSearch] = useState(false);
  const [chatSearchQuery, setChatSearchQuery] = useState("");
  // read receipts: convId → ISO timestamp dell'ultima lettura dell'altro utente
  const [readReceipts, setReadReceipts] = useState<Record<string, string>>({});
  // context menu
  const [contextMenu, setContextMenu] = useState<{ msg: MessageItem; x: number; y: number } | null>(null);
  // reply
  const [replyTo, setReplyTo] = useState<MessageItem | null>(null);
  // edit
  const [editingMessage, setEditingMessage] = useState<MessageItem | null>(null);
  // forward
  const [forwardingMessage, setForwardingMessage] = useState<MessageItem | null>(null);
  // attach sheet
  const [showAttachSheet, setShowAttachSheet] = useState(false);
  const mediaInputRef = useRef<HTMLInputElement>(null);
  const docInputRef   = useRef<HTMLInputElement>(null);
  // toast
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  // Banner "messaggi non decifrabili" — mostra se c'è un evento non ancora dismissal
  const [showUndecifrableAlert, setShowUndecifrableAlert] = useState<boolean>(() => {
    const eventTs     = sessionStorage.getItem("undecifrable_event_ts") ?? "";
    const dismissedTs = sessionStorage.getItem("undecifrable_dismissed_ts") ?? "";
    return eventTs !== "" && eventTs !== dismissedTs;
  });
  const undecifrableAlertShownRef = useRef(false);
  // secure destroy
  const [destroyTarget, setDestroyTarget] = useState<MessageItem | null>(null);
  const [destroyingIds, setDestroyingIds] = useState<Set<string>>(new Set());
  const [destroying, setDestroying] = useState(false);
  // multi-select
  const [selectMode, setSelectMode] = useState(false);
  const [selectedMsgIds, setSelectedMsgIds] = useState<Set<string>>(new Set());
  // voice recorder
  const [typingUsers, setTypingUsers] = useState<Record<string, Set<string>>>({});
  // Utenti che stanno registrando un vocale (per-conversazione) — presenza real-time
  const [recordingUsers, setRecordingUsers] = useState<Record<string, Set<string>>>({});
  const [atBottom, setAtBottom] = useState(true);
  // Sprint 21 — Gruppi
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [showGroupInfo, setShowGroupInfo]     = useState(false);
  const [groupInfoId, setGroupInfoId]         = useState<string | null>(null);

  // Photo viewer contatti (lista conversazioni)
  const [convPhotoModal, setConvPhotoModal] = useState<{
    avatarUrl: string | null;
    displayName: string;
    username: string;
    isOnline: boolean;
  } | null>(null);
  // Archivio — long press su conversazione
  const [convActionSheet, setConvActionSheet] = useState<{ convId: string; displayName: string } | null>(null);
  // Swipe-to-action su conversazione (mobile)
  const [swipedConvId, setSwipedConvId]       = useState<string | null>(null);
  const swipeStartX = useRef<number>(0);
  const swipeStartY = useRef<number>(0);
  const convLongPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  /** Stato di avanzamento per i messaggi media in attesa di conferma server.
   *  Chiave = pendingMsgId ("pending-<clientMessageId>") */
  const [mediaUploadStates, setMediaUploadStates] = useState<Map<string, MediaUploadState>>(new Map());
  const [viewerMedia, setViewerMedia] = useState<{ url: string; type: "image" | "video"; filename?: string; mimeType?: string } | null>(null);
  // ── USDA Payments ──────────────────────────────────────────────────────
  const [showSendUsda,    setShowSendUsda]    = useState(false);   // legacy — non più connesso al pulsante
  const [showSendPayment, setShowSendPayment] = useState(false);   // nuovo Payment Engine
  const [sendPrefill, setSendPrefill] = useState<{ amount?: string; requestPaymentId?: string } | null>(null);
  // RETRY FIRMA: transfer_id per cui riaprire la firma (bolla awaiting_deposit).
  const [resumeTransferId, setResumeTransferId] = useState<string | null>(null);
  const [showRequestUsda, setShowRequestUsda] = useState(false);
  const [usdaDetailId,    setUsdaDetailId]    = useState<string | null>(null);

  /** Location sharing */
  const [locationModal,  setLocationModal]  = useState<"acquiring" | "ready" | "error" | null>(null);
  const [locationData,   setLocationData]   = useState<{ lat: number; lon: number; accuracy: number } | null>(null);
  const [locationError,  setLocationError]  = useState<string | null>(null);
  const [locationViewer, setLocationViewer] = useState<LocationMeta | null>(null);
  // Sprint 23 — Silenzia + Media condivisi + Cancella chat
  const [showMediaGallery, setShowMediaGallery] = useState(false);
  const [showClearChatModal, setShowClearChatModal] = useState(false);
  const [clearChatLoading, setClearChatLoading] = useState(false);
  const [mutedConvIds, setMutedConvIds] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem("alpha_muted_convs") ?? "[]") as string[]); }
    catch { return new Set(); }
  });
  // Sprint 15 — Privacy avanzata
  const [burnAfterRead, setBurnAfterRead] = useState(false);
  const [disappearingSettings, setDisappearingSettings] = useState<{
    enabled: boolean; duration_ms: number | null;
  } | null>(null);

  // ── Sprint 16 Fase 5 — Trust / Safety Number ────────────────────────────
  const [trustStatus, setTrustStatus] = useState<TrustStatus | "loading" | null>(null);
  const [showSafetyModal, setShowSafetyModal] = useState(false);
  const [myIKBase64, setMyIKBase64] = useState<string | null>(null);
  const [theirIKBase64, setTheirIKBase64] = useState<string | null>(null);

  // ── Signal Protocol — Fase 2 ────────────────────────────────────────────
  /** Testi decifrati (async) indicizzati per messageId */
  const [decryptedTexts, setDecryptedTexts] = useState<Map<string, string>>(new Map());
  /** Cache dei testi inviati da noi: clientMessageId → plaintext
   * Necessario per visualizzare i propri messaggi dopo l'invio
   * (i ciphertext uscenti non sono decifrabili senza il plaintext originale) */
  const sentCacheRef = useRef(new Map<string, string>());

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTypingRef = useRef(false);
  // Keep-alive presenza "sta registrando" (il server auto-stoppa typing a 5s)
  const recordingKeepAliveRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordingActiveConvRef = useRef<string | null>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const msgSwipeState = useRef<{
    el: HTMLElement | null;
    bubble: HTMLElement | null;
    hint: HTMLElement | null;
    startX: number;
    startY: number;
    msgId: string;
    active: boolean;
    triggered: boolean;
  } | null>(null);
  const ctxOpenedAtRef = useRef<number>(0); // ghost-click guard
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Debounce ref per apiMarkRead — evita chiamate multiple in rapida successione
  const markReadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Signal helpers ───────────────────────────────────────────────────────

  /**
   * Restituisce il testo da mostrare per un messaggio.
   * Usa il testo già decifrato (state async) se disponibile,
   * altrimenti fallback a legacy decode (funziona per messaggi pre-Fase 2).
   */
  function getDisplayText(msg: MessageItem): string {
    if (!msg.ciphertext) return "";
    // Fase 3: media messages also go through Signal decrypt → decryptedTexts
    // FIX: non usare decodeMessage come fallback — produce garbled text dal binary Signal
    return decryptedTexts.get(msg.id) ?? "";
  }

  /**
   * Restituisce un'etichetta leggibile per reply preview e reply bar.
   * Per messaggi media/sticker/payment mostra emoji + tipo invece del JSON interno.
   */
  function getReplyPreviewText(msg: MessageItem): string {
    const raw = getDisplayText(msg);
    if (raw.startsWith(ANIMATED_STICKER_MARKER) || msg.message_type === "animated_sticker") return "🎬 Sticker animato";
    if (raw.startsWith(STICKER_MARKER) || msg.message_type === "sticker") return "🎭 Sticker";
    if (msg.message_type === "payment")             return "💸 Pagamento";
    if (msg.message_type === "payment_notification") return "✅ Pagamento completato";
    if (msg.message_type === "usda_send")           return "💵 USDA inviato";
    if (msg.message_type === "usda_request")        return "💵 Richiesta USDA";
    if (msg.message_type === "media") {
      const meta = decodeMediaMeta(raw);
      if (!meta) return "📎 Media";
      if (meta.type === "voice") return "🎙 Vocale";
      const mime = (meta as { mime_type?: string }).mime_type ?? "";
      if (mime.startsWith("video/")) return "🎥 Video";
      if (mime.startsWith("image/")) return "📷 Foto";
      return "📄 Documento";
    }
    if (msg.message_type === "text" && decodeLocationMeta(raw)) return "📍 Posizione";
    if (msg.message_type === "forward") return raw || "↪ Inoltrato";
    return raw || "💬 Messaggio";
  }

  /**
   * Ritorna true SOLO se l'errore è un fallimento crittografico genuino
   * (Bad MAC, sessione mancante, chiave cambiata, ecc.).
   * Ritorna false per errori IDB, rete, timeout, AbortError, ecc.
   * Usato per evitare falsi positivi nel banner "messaggi non decifrabili".
   */
  function isCryptoDecryptError(err: unknown): boolean {
    if (!(err instanceof Error)) return false;
    // DOMException copre: AbortError, QuotaExceededError, InvalidStateError, UnknownError
    if (err instanceof DOMException) return false;
    // Altri nomi noti di errori non-crittografici
    const nonCryptoNames = [
      "AbortError", "QuotaExceededError", "InvalidStateError",
      "UnknownError", "NotSupportedError", "NetworkError",
      "TypeError", "SyntaxError", "RangeError",
    ];
    if (nonCryptoNames.includes(err.name)) return false;
    // Pattern di rete/timeout/IDB nel messaggio
    const msg = err.message.toLowerCase();
    if (
      msg.includes("timeout")  || msg.includes("network")  ||
      msg.includes("fetch")    || msg.includes("http")     ||
      msg.includes("indexeddb")|| msg.includes("idb")      ||
      msg.includes("database") || msg.includes("quota")    ||
      msg.includes("abort")
    ) return false;
    // Tutto il resto è considerato un errore crittografico
    // (Bad MAC, No record for device, Unknown identity key, ecc.)
    return true;
  }

  /** Decifra un singolo messaggio e aggiorna lo state */
  async function decryptSingleMsg(msg: MessageItem): Promise<void> {
    if (!auth) return;
    if (!msg.ciphertext) {
      setDecryptedTexts((prev) => new Map(prev).set(msg.id, ""));
      return;
    }

    if (msg.sender_id === auth.userId) {
      // Messaggio inviato da noi — catena di lookup:
      // 1. sentCacheRef (in-memory, sessione corrente)
      // 2. localStorage per serverId (alpha_si:) — stabile, sopravvive logout
      // 3. localStorage per clientId (alpha_mt:) — salvato al momento dell'invio
      // 4. IDB cifrato (backup)
      // 5. [messaggio precedente] se niente trovato

      const cached = sentCacheRef.current.get(msg.client_message_id);
      if (cached !== undefined) {
        setDecryptedTexts((prev) => new Map(prev).set(msg.id, cached));
        // Persisti per server ID se non già fatto (es. WS echo prima sessione)
        cacheOwnTextByServerId(msg.id, cached);
        return;
      }

      // Fase 4: media cache per messaggi propri dopo reload
      if (msg.message_type === "media") {
        // 1. Controlla per server ID (salvato da cacheOwnTextByServerId nelle sessioni precedenti)
        const cachedByServer = getTextByServerId(msg.id);
        if (cachedByServer) {
          setDecryptedTexts((prev) => new Map(prev).set(msg.id, cachedByServer));
          void cacheDecryptedMeta(msg.id, cachedByServer);
          return;
        }
        // 2. Controlla per client ID (localStorage-backed dopo il fix)
        const cachedByClient = await getMetaByClientId(msg.client_message_id);
        if (cachedByClient) {
          setDecryptedTexts((prev) => new Map(prev).set(msg.id, cachedByClient));
          void cacheDecryptedMeta(msg.id, cachedByClient);
          cacheOwnTextByServerId(msg.id, cachedByClient); // promuovi a server ID per lookup futuro
          return;
        }
      } else {
        // Controlla per server ID prima (più stabile, set quando WS echo arriva)
        const cachedById = getTextByServerId(msg.id);
        if (cachedById !== null) {
          setDecryptedTexts((prev) => new Map(prev).set(msg.id, cachedById));
          return;
        }
        // Poi per client ID (set al momento dell'invio)
        const cachedText = await getTextByClientId(msg.client_message_id);
        if (cachedText !== null) {
          setDecryptedTexts((prev) => new Map(prev).set(msg.id, cachedText));
          // Promuovi anche a server ID per lookup futuro più veloce
          cacheOwnTextByServerId(msg.id, cachedText);
          return;
        }
      }
      // Fallback: plaintext non disponibile (messaggio inviato prima del caching)
      // Non mostrare "🔒 Messaggio cifrato" per messaggi PROPRI — è confusivo;
      // mostriamo invece che il messaggio è stato inviato ma non più leggibile localmente.
      setDecryptedTexts((prev) =>
        new Map(prev).set(
          msg.id,
          msg.message_type === "media" ? "" : "📨 Messaggio inviato",
        ),
      );
      return;
    }

    // Messaggio ricevuto
    try {
      let text: string;
      // Sprint 21: gruppo — rileva formato fan-out dal contenuto di device_ciphertexts
      // (device_id = userId, non deviceId) per evitare race condition con conversations state.
      // I messaggi 1:1 multi-device usano device_id = deviceUUID; i gruppi usano device_id = userId.
      const hasGroupStyleEntry = msg.device_ciphertexts?.some((d) => d.device_id === auth.userId) ?? false;
      const convType = conversations.find((c) => c.conversation_id === activeConvId)?.type;
      const isGroupMsg = hasGroupStyleEntry || convType === "group";
      // AUDIT-5: ricezione messaggio — ogni campo critico per il routing decrypt
      reportAudit("AUDIT-5-rx", {
        msgId: msg.id,
        senderId: msg.sender_id,
        myUserId: auth.userId,
        myDeviceId: auth.deviceId,
        convType,
        hasGroupStyleEntry,
        isGroupMsg,
        dcLength: msg.device_ciphertexts?.length ?? 0,
        dcEntries: msg.device_ciphertexts?.map((d) => ({ device_id: d.device_id, type: d.type })) ?? [],
      });
      if (isGroupMsg && msg.device_ciphertexts && msg.device_ciphertexts.length > 0) {
        // ── Lettura IDB prima del tentativo Signal ──────────────────────────
        // L'OTPK (type 3) viene consumato al primo decrypt. Reload di pagina →
        // stato React svuotato → secondo tentativo Signal → null → 🔒.
        // Se già decifrato in una sessione precedente, usiamo la cache IDB e
        // non tocchiamo il ratchet.
        const cachedPlaintext = await getMetaByMessageId(msg.id);
        if (cachedPlaintext) {
          setDecryptedTexts((prev) => new Map(prev).set(msg.id, cachedPlaintext));
          return;
        }
        const myEntry = msg.device_ciphertexts.find((d) => d.device_id === auth.userId);
        reportAudit("AUDIT-5-match", {
          msgId: msg.id,
          senderId: msg.sender_id,
          myUserId: auth.userId,
          myDeviceId: auth.deviceId,
          hasMyEntry: !!myEntry,
          entryType: myEntry?.type ?? null,
          allEntryIds: msg.device_ciphertexts.map((d) => d.device_id),
        });
        if (myEntry) {
          try {
            const found = await signalDecryptFromDeviceCiphertexts(
              auth.userId, auth.deviceId, msg.sender_id,
              [{ ...myEntry, device_id: auth.deviceId }],
            );
            if (found !== null) {
              reportAudit("AUDIT-6-decrypt-ok", { msgId: msg.id, entryType: myEntry.type });
              // Persisti in IDB: l'OTPK è ora consumato, le sessioni future
              // leggeranno da cache invece di ritentare Signal (e ottenere null).
              // await: garantisce che l'IDB write completi prima del return;
              // senza await, una navigazione rapida via può svuotare il plaintext
              // dall'IDB → al reload Signal riprova, OTPK assente → 🔒 permanente.
              await cacheDecryptedMeta(msg.id, found);
              setDecryptedTexts((prev) => new Map(prev).set(msg.id, found));
              return;
            }
            reportAudit("AUDIT-6-decrypt-null", { msgId: msg.id, entryType: myEntry.type });
          } catch (err) {
            reportAudit("AUDIT-6-decrypt-error", {
              msgId: msg.id,
              error: err instanceof Error ? err.message : String(err),
              stack: err instanceof Error ? err.stack : undefined,
            });
          }
        } else {
          reportAudit("AUDIT-5-no-entry", {
            msgId: msg.id,
            myUserId: auth.userId,
            allEntryIds: msg.device_ciphertexts.map((d) => d.device_id),
          });
        }
        // Il campo `ciphertext` contiene il placeholder "_grp_" — non decifrabile.
        // ⚠️ Non sovrascrivere un plaintext già decifrato con successo in un tentativo
        // precedente: Signal PreKey (type 3) consuma l'OTPK al primo decrypt; il secondo
        // tentativo (es. re-fetch messaggi, riconnessione WS) restituisce null ma il
        // plaintext è già in state e NON va perso.
        setDecryptedTexts((prev) => {
          const existing = prev.get(msg.id);
          if (existing && existing !== "🔒 Messaggio cifrato") return prev;
          return new Map(prev).set(msg.id, "🔒 Messaggio cifrato");
        });
        return;
      }
      if (isGroupMsg) {
        // Gruppo senza device_ciphertexts (messaggio vecchio/pre-fanout) —
        // il placeholder NON è decifrabile, mostra indicatore invece di "_grp_".
        setDecryptedTexts((prev) => {
          const existing = prev.get(msg.id);
          if (existing && existing !== "🔒 Messaggio cifrato") return prev;
          return new Map(prev).set(msg.id, "🔒 Messaggio cifrato");
        });
        return;
      }
      // Cache guard 1:1 — se già decifrato e salvato in IDB non tocchiamo il ratchet.
      // L'OTPK è one-shot: un secondo tentativo Signal fallisce sempre.
      const _cached1to1 = await getMetaByMessageId(msg.id);
      if (_cached1to1 !== null) {
        setDecryptedTexts((prev) => new Map(prev).set(msg.id, _cached1to1));
        return;
      }
      // Fase 4: prova prima device_ciphertexts (multi-device 1:1)
      if (msg.device_ciphertexts && msg.device_ciphertexts.length > 0) {
        const found = await signalDecryptFromDeviceCiphertexts(
          auth.userId, auth.deviceId, msg.sender_id, msg.device_ciphertexts,
        );
        if (found !== null) {
          text = found;
        } else {
          // Il mio device non è nella lista → fallback campo principale
          text = await signalDecrypt(
            auth.userId, auth.deviceId, msg.sender_id,
            msg.ciphertext, msg.ciphertext_type ?? null,
          );
        }
      } else {
        text = await signalDecrypt(
          auth.userId, auth.deviceId, msg.sender_id,
          msg.ciphertext, msg.ciphertext_type ?? null,
        );
      }
      setDecryptedTexts((prev) => new Map(prev).set(msg.id, text));
      // Cache per TUTTI i tipi — OTPK è one-shot, non ri-decifrabile dopo il primo decrypt.
      // await garantisce che l'IDB write sia completato prima del return,
      // così un reconnect quasi-simultaneo trova già il plaintext in cache.
      await cacheDecryptedMeta(msg.id, text);
    } catch (decryptErr) {
      // Controlla IDB per tutti i tipi (testo e media) prima di mostrare errore.
      const cached = await getMetaByMessageId(msg.id);
      if (cached) {
        setDecryptedTexts((prev) => new Map(prev).set(msg.id, cached));
        return;
      }

      // ── Sessione Signal persa (SessionLostError) ──────────────────────────
      // WhisperMessage (tipo 1) arrivato ma IDB non ha la sessione per il
      // mittente (es. clear browser, nuovo device). Il messaggio è perso
      // per sempre, ma possiamo ri-stabilire la sessione per i messaggi futuri:
      //   1. Mostriamo un placeholder informativo (diverso da "non decifrabile")
      //   2. Lo cachiamo in IDB per non ritentare il decrypt (OTPK protection)
      //   3. Inviamo signal.session.reset al mittente via WS:
      //      - mittente riceve → cancella sessione locale verso di noi
      //      - prossimo signalEncrypt() → PreKeyWhisperMessage → nuova sessione
      if (decryptErr instanceof SessionLostError && msg.message_type !== "media") {
        const placeholder = "[🔄 Sessione Signal rinnovata — richiedi al mittente di reinviare]";
        setDecryptedTexts((prev) => new Map(prev).set(msg.id, placeholder));
        // Cache: evita retry futuri sul messaggio irrecuperabile
        void cacheDecryptedMeta(msg.id, placeholder).catch(() => {});
        // Notifica il mittente: reset session → prossimo msg sarà PreKey
        wsSend({
          type: "signal.session.reset",
          payload: {
            to_user_id:       msg.sender_id,
            sender_device_id: decryptErr.senderDeviceId,
          },
        });
        reportAudit("SESSION-LOST-RESET-SENT", {
          msgId:          msg.id,
          senderUserId:   msg.sender_id,
          senderDeviceId: decryptErr.senderDeviceId,
        });
        return;
      }

      if (msg.message_type === "media") {
        // FIX: non usare msg.ciphertext come fallback — produce base64 grezzo nel bubble
        // Lasciare stringa vuota → mediaMeta=null → UI "media non disponibile"
        setDecryptedTexts((prev) => new Map(prev).set(msg.id, ""));
      } else {
        setDecryptedTexts((prev) =>
          new Map(prev).set(msg.id, "[Messaggio non decifrabile]"),
        );
        // Mostra banner sidebar SOLO se l'errore è genuinamente crittografico
        // (Bad MAC, No record for device, Unknown identity key, ecc.).
        // NON mostrarlo per: errori IDB, AbortError, timeout, network error.
        // Condizione 4 del documento: evitare falsi positivi.
        if (!undecifrableAlertShownRef.current && isCryptoDecryptError(decryptErr)) {
          undecifrableAlertShownRef.current = true;
          // Marca la sessione corrente come "nuovo evento crittografico"
          // con timestamp per distinguere eventi diversi → riappare dopo dismiss
          // se il timestamp è cambiato (nuovo deploy/nuovo evento chiave).
          const nowTs = String(Math.floor(Date.now() / 60_000)); // granularità 1 minuto
          const lastDismissedTs = sessionStorage.getItem("undecifrable_dismissed_ts") ?? "";
          const lastEventTs     = sessionStorage.getItem("undecifrable_event_ts") ?? "";
          if (lastEventTs !== nowTs) {
            // Nuovo evento (diverso dal precedente dismiss) → reset e mostra
            sessionStorage.setItem("undecifrable_event_ts", nowTs);
            sessionStorage.removeItem("undecifrable_dismissed_ts");
            setShowUndecifrableAlert(true);
          } else if (lastDismissedTs !== nowTs) {
            // Stesso minuto ma non ancora dismissal → mostra
            setShowUndecifrableAlert(true);
          }
        }
      }
    }
  }

  /** Decifra un batch di messaggi (caricamento conversazione) */
  /**
   * Attende che Signal sia pronto (initSignalKeys completato).
   * Ritorna subito se le chiavi sono già inizializzate.
   * Safety timeout 10s per non bloccare indefinitamente.
   */
  function waitForSignalReady(userId: string): Promise<void> {
    if (localStorage.getItem(`signal_keys_ready:${userId}`) === "1") {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const timeout = setTimeout(resolve, 10_000);
      const handler = () => { clearTimeout(timeout); resolve(); };
      window.addEventListener("signal:ready", handler, { once: true });
    });
  }

  async function decryptBatch(msgs: MessageItem[]): Promise<void> {
    if (!auth) return;
    // FIX race condition: attende che Signal sia inizializzato prima di
    // tentare qualsiasi decrypt. Senza questo guard, setAuth() nel loadAuth()
    // di AuthContext monta ChatPage mentre initSignalKeys() è ancora in esecuzione
    // → decrypt fallisce → [Messaggio non decifrabile] per alcuni utenti dopo deploy.
    await waitForSignalReady(auth.userId);
    // Messaggi PROPRI: lookup in cache (localStorage/IDB), nessuno stato Signal →
    //   parallelo sicuro.
    // Messaggi RICEVUTI: il Double Ratchet è stateful (IDB).
    //   Decrypt concorrenti leggono la stessa sessione, applicano step diversi e
    //   si sovrascrivono → stato corrotto → "[Messaggio non decifrabile]" su tutti.
    //   Soluzione: serializzare i decrypt dei messaggi altrui.
    const mine   = msgs.filter((m) => m.sender_id === auth!.userId);
    const theirs = msgs.filter((m) => m.sender_id !== auth!.userId);
    await Promise.allSettled(mine.map((m) => decryptSingleMsg(m)));
    for (const msg of theirs) {
      await decryptSingleMsg(msg).catch(() => {});
    }
  }

  // ── Load conversations ──────────────────────────────────────────────────
  const loadConversations = useCallback(async () => {
    setLoadingConvs(true);
    try {
      const res = await apiListConversations();
      setConversations(res.items);
    } catch (err) {
      if (err instanceof AuthExpiredError) {
        void logout();
      }
      // altri errori (rete, etc.) ignorati silenziosamente
    } finally {
      setLoadingConvs(false);
    }
  }, [logout]);

  useEffect(() => { void loadConversations(); }, [loadConversations]);

  // Apre direttamente una conversazione richiesta dall'esterno (es. da cronologia chiamate).
  // handleSelectConv è una function declaration → è hoistata, accessibile qui.
  useEffect(() => {
    if (requestedConvId) {
      // Assicurati che le conversazioni siano caricate prima di aprirla
      void loadConversations().then(() => {
        handleSelectConv(requestedConvId);
        onConvOpened?.(); // azzera requestedConvId nel parent → evita re-trigger
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedConvId]);

  // Gestione tasto Back hardware (Android) e swipe-back iOS nella PWA.
  // Quando la chat mobile è aperta e il sistema emette popstate, intercettiamo
  // la navigazione e chiudiamo la chat anziché uscire dalla PWA.
  useEffect(() => {
    function onPopstate() {
      if (mobileShowChatRef.current) {
        setMobileShowChat(false);
        mobileShowChatRef.current = false;
        chatHistoryPushedRef.current = false;
        setShowChatSearch(false);
        setChatSearchQuery("");
      }
    }
    window.addEventListener("popstate", onPopstate);
    return () => window.removeEventListener("popstate", onPopstate);
  }, []); // refs — nessuna dipendenza stale

  // Sblocca audio al primo gesto utente (necessario su iOS Safari / Chrome iOS)
  useEffect(() => { attachAudioUnlockListener(); }, []);

  // iOS Safari keyboard: gestito con interactive-widget=resizes-content nel viewport meta
  // (nessun listener JS necessario — 100dvh si aggiorna automaticamente)

  // ── Sprint 16 Fase 5 — Trust helpers ────────────────────────────────────

  /**
   * Rilegge lo stato di fiducia dall'IDB locale e aggiorna lo stato React.
   * Non fa API call, zero network. Chiamato:
   *   1. All'apertura di ogni conversazione (useEffect sotto)
   *   2. Dopo ogni invio (encryptForActive può aver aggiornato il trust IDB)
   */
  const refreshTrust = useCallback(async (theirId: string) => {
    if (!auth) return;
    try {
      const store = getSignalStore(auth.userId, auth.deviceId);

      // IK di me
      const myIKPair = await store.getIdentityKeyPair();
      if (myIKPair) setMyIKBase64(arrayBufferToBase64(myIKPair.pubKey));

      // Stato fiducia (confronta trust IDB con Signal IDB)
      const status = await checkAndUpdateTrust(auth.userId, auth.deviceId, theirId);
      setTrustStatus(status ?? "unverified");

      // IK del contatto (per Safety Number)
      const theirIK = await store.getRemoteIdentityKey(theirId);
      if (theirIK) setTheirIKBase64(arrayBufferToBase64(theirIK));
    } catch {
      setTrustStatus("unverified");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth?.userId, auth?.deviceId]);

  // ── Sprint 16 Fase 5 — Trust check when conversation changes ────────────
  useEffect(() => {
    const theirId = conversations.find((c) => c.conversation_id === activeConvId)?.other_user?.user_id;
    if (!auth || !theirId) {
      setTrustStatus(null);
      setMyIKBase64(null);
      setTheirIKBase64(null);
      return;
    }
    let cancelled = false;
    setTrustStatus("loading");
    void refreshTrust(theirId).catch(() => { if (!cancelled) setTrustStatus("unverified"); });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConvId, conversations]);

  // ── Load messages + suono apertura conversazione ─────────────────────────
  useEffect(() => {
    if (!activeConvId) { setMessages([]); setDecryptedTexts(new Map()); return; }
    void playNotifSound('received');   // suono apertura conversazione
    setLoadingMsgs(true);
    apiListMessages(activeConvId, { limit: 50 })
      .then((res) => {
        const msgs = [...res.items].reverse();
        setMessages((prev) => {
          reportAudit("DIAG-HTTP-LIST", {
            activeConvId,
            msgsFromServer: msgs.length,
            lengthBeforeOverwrite: prev.length,
            lengthAfterOverwrite: msgs.length,
          });
          return msgs;
        });
        // Scroll immediato al fondo dopo il caricamento iniziale.
        // Doppio rAF: il primo attende il commit React, il secondo attende
        // il reflow del layout (necessario su iOS Safari PWA con molti messaggi).
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            const c = messagesContainerRef.current;
            if (c) c.scrollTop = c.scrollHeight;
          });
        });
        // Decifra tutti i messaggi in background (Signal + legacy)
        void decryptBatch(msgs);
      })
      .catch(() => {})
      .finally(() => setLoadingMsgs(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConvId]);

  // ── Robustezza navigazione: nessun overlay/timer può bloccare il back ──────
  // Bug intermittente iOS PWA: un timer long-press (messaggio o conversazione)
  // poteva scattare DOPO che si era già cambiato/aperto una chat, montando un
  // overlay full-screen (ctx-overlay trasparente z-200 / action-sheet) sopra
  // l'header → tasto indietro non cliccabile. Ad ogni cambio conversazione
  // azzeriamo i timer pendenti e chiudiamo eventuali overlay residui.
  useEffect(() => {
    if (longPressTimerRef.current) { clearTimeout(longPressTimerRef.current); longPressTimerRef.current = null; }
    if (convLongPressTimerRef.current) { clearTimeout(convLongPressTimerRef.current); convLongPressTimerRef.current = null; }
    setContextMenu(null);
    setConvActionSheet(null);
  }, [activeConvId]);

  // Cleanup timer long-press su unmount (evita che scattino a componente smontato).
  useEffect(() => {
    return () => {
      if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
      if (convLongPressTimerRef.current) clearTimeout(convLongPressTimerRef.current);
    };
  }, []);

  // ── Refetch messaggi alla riconnessione WS ────────────────────────────────
  // Quando il WS si disconnette e rientra (iOS bg, network flap, ecc.)
  // i messaggi arrivati durante l'assenza non vengono consegnati via WS.
  // Alla riconnessione (false→true) rifetchiamo silenziosamente la lista.
  const prevConnectedRef = useRef(false);
  useEffect(() => {
    const wasConnected = prevConnectedRef.current;
    prevConnectedRef.current = connected;
    // Intervieni solo sulla transizione false → true (non al primo mount)
    if (!wasConnected && connected && activeConvId) {
      apiListMessages(activeConvId, { limit: 50 })
        .then((res) => {
          const msgs = [...res.items].reverse();
          setMessages(msgs);
          void decryptBatch(msgs);
        })
        .catch(() => {});
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected]);

  // ── Refetch messaggi al ritorno in foreground (iOS bg → fg) ─────────────
  // Scenario: app in background → WS cade → messaggio arriva → push inviata.
  // Quando l'utente riporta l'app in foreground il WS potrebbe non essersi
  // ancora riconnesso (backoff esponenziale). Il visibilitychange garantisce
  // un refetch silenzioso senza attendere il prossimo auth.ok.
  // Usa activeConvId come dep → il listener viene ri-registrato al cambio
  // conversazione e cattura sempre il valore corretto senza ref extra.
  useEffect(() => {
    if (!activeConvId) return;
    function onVisibility() {
      if (!document.hidden && activeConvId) {
        apiListMessages(activeConvId, { limit: 50 })
          .then((res) => {
            const msgs = [...res.items].reverse();
            setMessages(msgs);
            void decryptBatch(msgs);
          })
          .catch(() => {});
      }
    }
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConvId]);

  // ── Auto-scroll when at bottom ─────────────────────────────────────────
  // Usa scrollTop diretto invece di scrollIntoView({smooth}) — su iOS Safari PWA
  // la smooth animation parte da 0 e spesso non raggiunge il fondo prima che
  // l'utente veda il top della chat.
  useEffect(() => {
    if (!atBottom) return;
    requestAnimationFrame(() => {
      const c = messagesContainerRef.current;
      if (c) c.scrollTop = c.scrollHeight;
    });
  }, [messages, atBottom]);

  function handleScroll() {
    const el = messagesContainerRef.current;
    if (!el) return;
    const threshold = 60;
    setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < threshold);
  }

  // ── Typing cleanup su disconnessione WS ────────────────────────────────
  // Se il WS cade, gli eventi typing.stop potrebbero non arrivare mai →
  // il pallino di scrittura rimarrebbe bloccato. Azzera tutti i typing
  // indicator quando la connessione cade.
  useEffect(() => {
    if (!connected) { setTypingUsers({}); setRecordingUsers({}); }
  }, [connected]);

  // Ferma il keep-alive presenza registrazione all'unmount / cambio conversazione
  useEffect(() => {
    return () => {
      if (recordingKeepAliveRef.current) { clearInterval(recordingKeepAliveRef.current); recordingKeepAliveRef.current = null; }
      const cid = recordingActiveConvRef.current;
      if (cid) { sendTypingStop(cid); recordingActiveConvRef.current = null; }
    };
  }, [activeConvId, sendTypingStop]);

  // ── WebSocket events ────────────────────────────────────────────────────
  useEffect(() => {
    return on((event: WsEvent) => {
      switch (event.type) {
        case "message.new": {
          const msg = event.payload as unknown as MessageItem & { conversation_id: string };
          // Suono "received" solo per messaggi altrui (non per conferma dei propri)
          const isOwnMsg = msg.sender_id === auth?.userId;
          if (!isOwnMsg && !mutedConvIds.has(msg.conversation_id)) void playNotifSound('received');
          if (msg.conversation_id === activeConvId) {
            setMessages((prev) => {
              // Sostituisci il messaggio ottimistico (pending-*) con quello reale del server
              const pendingIdx = prev.findIndex(
                (m) => m.client_message_id === msg.client_message_id && m.id.startsWith("pending-"),
              );
              if (pendingIdx >= 0) {
                const pendingId = prev[pendingIdx].id;
                // Cleanup stato upload + revoca objectURL locale
                setMediaUploadStates((upd) => {
                  const s = upd.get(pendingId);
                  if (s?.localUrl) URL.revokeObjectURL(s.localUrl);
                  const next = new Map(upd);
                  next.delete(pendingId);
                  return next;
                });
                const next = [...prev];
                next[pendingIdx] = msg;
                return next;
              }
              const isDup = prev.some((m) => m.id === msg.id);
              reportAudit("DIAG-WS-NEW", {
                msgId: msg.id,
                msgConvId: msg.conversation_id,
                activeConvId,
                equal: msg.conversation_id === activeConvId,
                lengthBefore: prev.length,
                lengthAfter: isDup ? prev.length : prev.length + 1,
                isDuplicate: isDup,
              });
              if (isDup) return prev;
              return [...prev, msg];
            });
            // Decifra il messaggio appena arrivato (popola decryptedTexts con id reale)
            void decryptSingleMsg(msg);
            // Marca sempre come letto quando la conversazione è aperta.
            // Debounce 800ms: se arrivano più messaggi in rapida successione
            // una sola chiamata copre tutti.
            if (markReadTimerRef.current) clearTimeout(markReadTimerRef.current);
            markReadTimerRef.current = setTimeout(() => {
              void apiMarkRead(activeConvId).catch(() => {});
            }, 800);
          }
          setConversations((prev) =>
            prev.map((c) => {
              if (c.conversation_id !== msg.conversation_id) return c;
              // Se la conversazione è aperta, il messaggio è già letto (mark-read
              // parte sotto): niente incremento badge, forziamo unread a 0.
              const isOpen = msg.conversation_id === activeConvId;
              return {
                ...c,
                last_activity_at: msg.server_received_at,
                unread_count: isOpen ? 0 : c.unread_count,
              };
            }).sort((a, b) => b.last_activity_at.localeCompare(a.last_activity_at)),
          );
          break;
        }
        case "typing.start": {
          const { user_id, conversation_id, activity } = event.payload;
          const isRecording = activity === "recording";
          setTypingUsers((prev) => {
            const copy = { ...prev };
            copy[conversation_id] = new Set([...(copy[conversation_id] ?? []), user_id]);
            return copy;
          });
          // Retro-compat: activity assente → typing normale (l'utente NON registra).
          setRecordingUsers((prev) => {
            const copy = { ...prev };
            const s = new Set(copy[conversation_id] ?? []);
            if (isRecording) s.add(user_id); else s.delete(user_id);
            copy[conversation_id] = s;
            return copy;
          });
          break;
        }
        case "typing.stop": {
          const { user_id, conversation_id } = event.payload;
          setTypingUsers((prev) => {
            const copy = { ...prev };
            if (copy[conversation_id]) {
              const s = new Set(copy[conversation_id]);
              s.delete(user_id);
              copy[conversation_id] = s;
            }
            return copy;
          });
          setRecordingUsers((prev) => {
            const copy = { ...prev };
            if (copy[conversation_id]) {
              const s = new Set(copy[conversation_id]);
              s.delete(user_id);
              copy[conversation_id] = s;
            }
            return copy;
          });
          break;
        }
        // presence.online / presence.offline → gestiti in WebSocketContext (sempre montato)
        case "read.receipt": {
          const { conversation_id, read_at } = event.payload;
          setReadReceipts((prev) => {
            const existing = prev[conversation_id];
            if (existing && existing >= read_at) return prev;
            return { ...prev, [conversation_id]: read_at };
          });
          break;
        }
        case "message.edited": {
          const edited = event.payload as unknown as MessageItem;
          if (edited.conversation_id === activeConvId) {
            setMessages((prev) =>
              prev.map((m) => m.id === edited.id ? { ...m, ciphertext: edited.ciphertext, edited_at: edited.edited_at } : m)
            );
            // Decifra il nuovo ciphertext del messaggio modificato
            void decryptSingleMsg(edited);
          }
          break;
        }
        case "message.deleted": {
          const { message_id, conversation_id, for_everyone } = event.payload;
          if (for_everyone && conversation_id === activeConvId) {
            setMessages((prev) => prev.filter((m) => m.id !== message_id));
          }
          break;
        }
        case "message.destroyed": {
          const { message_id, conversation_id } = event.payload;
          if (conversation_id === activeConvId) {
            // avvia animazione dissoluzione stile Telegram, poi rimuovi dopo 900ms
            setDestroyingIds((prev) => { const s = new Set(prev); s.add(message_id); return s; });
            setTimeout(() => {
              setMessages((prev) => prev.filter((m) => m.id !== message_id));
              setDestroyingIds((prev) => { const s = new Set(prev); s.delete(message_id); return s; });
              // Fase 3: rimuove la chiave AES dalla memoria (Secure Destroy completo)
              setDecryptedTexts((prev) => { const next = new Map(prev); next.delete(message_id); return next; });
            }, 900);
          }
          break;
        }
        // Sprint 15 — messaggi a scomparsa aggiornati da un altro membro
        case "conversation.disappearing_updated": {
          const { conversation_id, enabled, duration_ms } = event.payload as {
            conversation_id: string; enabled: boolean; duration_ms: number | null;
          };
          if (conversation_id === activeConvId) {
            setDisappearingSettings({ enabled, duration_ms });
          }
          break;
        }

        // Sprint 18 — Phoenix Protocol: gestito in AppContent (sempre attivo)
        // Sprint 23 — Call signaling: gestito in AppContent (sempre attivo)

        // Chat Payment Engine — aggiorna system_metadata in-place (Sprint 4)
        case "payment.state_changed": {
          const {
            transfer_id, message_id, conversation_id, status,
            tx_hash_release, amount, expires_at, asset_symbol,
          } = event.payload as {
            transfer_id:     string;
            conversation_id: string;
            message_id:      string | null;
            status:          string;
            asset_symbol:    string;
            amount:          string;
            expires_at:      string | null;
            tx_hash_release: string | null;
          };
          if (conversation_id !== activeConvId) break;
          setMessages((prev) =>
            prev.map((m) => {
              const meta = (m.system_metadata as Record<string, unknown>) ?? {};
              // Match robusto: per transfer_id (affidabile lato mittente E
              // destinatario) con fallback al message_id.
              const isMatch =
                (meta.transfer_id && meta.transfer_id === transfer_id) ||
                (message_id != null && m.id === message_id);
              if (!isMatch) return m;
              return {
                ...m,
                system_metadata: {
                  ...meta,
                  status,
                  tx_hash_release: tx_hash_release ?? meta.tx_hash_release ?? null,
                  amount:          amount          ?? meta.amount,
                  expires_at:      expires_at      ?? meta.expires_at      ?? null,
                  asset_symbol:    asset_symbol    ?? meta.asset_symbol,
                },
              };
            }),
          );
          break;
        }

        // USDA Payments (getusda.xyz) — aggiorna stato del pagamento nel messaggio in-place
        case "usda.payment.update": {
          const { message_id, conversation_id, status, tx_hash } = event.payload as {
            payment_id: string;
            message_id: string | null;
            conversation_id: string;
            status: string;
            tx_hash: string | null;
          };
          if (conversation_id !== activeConvId || !message_id) break;
          setMessages((prev) =>
            prev.map((m) => {
              if (m.id !== message_id) return m;
              const meta = (m.system_metadata as Record<string, unknown>) ?? {};
              return {
                ...m,
                system_metadata: { ...meta, status, tx_hash: tx_hash ?? meta.tx_hash },
              };
            }),
          );
          break;
        }
      }
    });
  }, [on, activeConvId]);

  // ── Helpers Signal — encrypt per un gruppo (fan-out per membro) ──────────
  async function encryptForGroup(groupId: string, text: string): Promise<{
    body: string;
    type: number;
    deviceCiphertexts: Array<{ device_id: string; body: string; type: number }>;
  } | undefined> {
    if (!auth) return undefined;
    try {
      const group = await apiGetGroup(groupId);
      const others = group.members.filter((m) => m.user_id !== auth.userId);
      const deviceCiphertexts: Array<{ device_id: string; body: string; type: number }> = [];
      await Promise.all(
        others.map(async (member) => {
          // bundle dichiarato fuori dal try per renderlo accessibile nel catch
          // (serve per il retry post-identity-reset senza un ulteriore round-trip).
          let bundle: Awaited<ReturnType<typeof apiGetKeyBundle>> | undefined;
          try {
            bundle = await apiGetKeyBundle(member.user_id);
            // AUDIT-1-raw: log safe prima di toccare bundle.deviceId — diagnosi bundle undefined
            reportAudit("AUDIT-1-raw", {
              memberId: member.user_id,
              bundleType: typeof bundle,
              isNull: bundle === null,
              bundleKeys: (bundle != null && typeof bundle === "object")
                ? (Object.keys(bundle as object) as string[]).slice(0, 6)
                : null,
            });
            // AUDIT-1: cosa restituisce apiGetKeyBundle (già loggato lato server — qui log lato client)
            reportAudit("AUDIT-1-bundle", {
              memberId: member.user_id,
              bundleDeviceId: bundle.deviceId,
              identityKeyPrefix: bundle.identityKey?.slice(0, 20) + "…",
              signedPreKeyId: bundle.signedPreKeyId,
              hasOtpk: bundle.oneTimePreKey !== null,
              otpkKeyId: bundle.oneTimePreKey?.keyId ?? null,
            });
            // AUDIT-IK-CHECK: mostra le due chiavi confrontate prima di signalEncryptMulti.
            // Permette di verificare se storedIdentityKey ≠ bundleIdentityKey (causa "Identity key changed").
            {
              const _ikStore = getSignalStore(auth.userId, auth.deviceId);
              const _storedIk = await _ikStore.getRemoteIdentityKey(member.user_id);
              const _devIdInt = Math.abs(hashDeviceId(bundle.deviceId));
              const _sessionKey = `${member.user_id}.${_devIdInt}`;
              const _sessionExists = !!(await _ikStore.loadSession(_sessionKey));
              reportAudit("AUDIT-IK-CHECK", {
                memberId: member.user_id,
                bundleDeviceId: bundle.deviceId,
                bundleIK: bundle.identityKey.slice(0, 28),
                storedIK: _storedIk ? arrayBufferToBase64(_storedIk).slice(0, 28) : null,
                keysMatch: _storedIk ? bundle.identityKey.slice(0, 28) === arrayBufferToBase64(_storedIk).slice(0, 28) : "no-stored-key",
                sessionExists: _sessionExists,
              });
            }
            // signalEncryptMulti con un solo bundle → usa device_id del bundle come chiave
            const { deviceCiphertexts: dcs } = await signalEncryptMulti(
              auth.userId, auth.deviceId, member.user_id, text, [bundle],
              // NON forceNewSession: il normale ciclo Signal usa tipo-3 solo alla
              // prima sessione (X3DH) e tipo-1 (Double Ratchet) nelle successive.
              // forceNewSession consumerebbe 1 OTPK per messaggio → esaurimento pool.
            );
            reportAudit("AUDIT-2-encrypt", {
              memberId: member.user_id,
              dcsCount: dcs.length,
              entries: dcs.map((d) => ({ device_id: d.device_id, type: d.type, bodyLen: d.body?.length ?? 0 })),
            });
            if (dcs[0]) {
              deviceCiphertexts.push({ device_id: member.user_id, body: dcs[0].body, type: dcs[0].type });
            } else {
              reportAudit("AUDIT-2-no-ciphertext", { memberId: member.user_id });
            }
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            if (errMsg === "Identity key changed" && bundle !== undefined) {
              // La sessione Signal ha una identity key stale (es. destinatario ha rigenerato
              // le chiavi dopo un reset IDB o nuovo login). Reset TOFU e riprova con lo
              // stesso bundle — nessun round-trip aggiuntivo al server.
              try {
                reportAudit("AUDIT-2-identity-reset", { memberId: member.user_id });
                await resetAndRebuildSession(auth.userId, auth.deviceId, member.user_id);
                const { deviceCiphertexts: dcs2 } = await signalEncryptMulti(
                  auth.userId, auth.deviceId, member.user_id, text, [bundle],
                );
                reportAudit("AUDIT-2-encrypt-retry-ok", {
                  memberId: member.user_id,
                  dcsCount: dcs2.length,
                  entries: dcs2.map((d) => ({ device_id: d.device_id, type: d.type })),
                });
                if (dcs2[0]) {
                  deviceCiphertexts.push({ device_id: member.user_id, body: dcs2[0].body, type: dcs2[0].type });
                } else {
                  reportAudit("AUDIT-2-retry-no-ciphertext", { memberId: member.user_id });
                }
              } catch (retryErr) {
                reportAudit("AUDIT-2-encrypt-error", {
                  memberId: member.user_id,
                  error: `Identity key changed [retry: ${retryErr instanceof Error ? retryErr.message : String(retryErr)}]`,
                  stack: retryErr instanceof Error ? retryErr.stack : undefined,
                });
              }
            } else {
              reportAudit("AUDIT-2-encrypt-error", {
                memberId: member.user_id,
                error: errMsg,
                stack: err instanceof Error ? err.stack : undefined,
              });
            }
          }
        }),
      );
      // Ripristino mid-session: controlla OTPK dopo ogni messaggio di gruppo
      // (non solo al login) per evitare esaurimento del pool.
      void maybeReplenishOtpks(auth.userId, auth.deviceId);
      reportAudit("AUDIT-3-payload", {
        groupId,
        deviceCiphertextsCount: deviceCiphertexts.length,
        entries: deviceCiphertexts.map((d) => ({ device_id: d.device_id, type: d.type })),
      });
      // body/type primario: placeholder non-vuoto per passare la validazione backend.
      return { body: btoa("_grp_"), type: 1, deviceCiphertexts };
    } catch (err) {
      reportAudit("AUDIT-3-outer-error", {
        groupId,
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      return undefined;
    }
  }

  // ── Helpers Signal — encrypt per il destinatario attivo ─────────────────
  async function encryptForActive(text: string): Promise<{
    body: string;
    type: number;
    deviceCiphertexts: Array<{ device_id: string; body: string; type: number }>;
  } | undefined> {
    if (!auth || !activeConvId) return undefined;
    const activeConv = conversations.find((c) => c.conversation_id === activeConvId);

    // Sprint 21: Gruppo → fan-out per ogni membro
    if (activeConv?.type === "group") {
      return encryptForGroup(activeConvId, text);
    }

    const recipientId = activeConv?.other_user?.user_id;
    if (!recipientId) return undefined;
    try {
      // Fase 4: fan-out multi-device
      const allBundles = await apiGetAllKeyBundles(recipientId);
      const { primary, deviceCiphertexts } = await signalEncryptMulti(
        auth.userId, auth.deviceId, recipientId, text, allBundles,
      );
      return { ...primary, deviceCiphertexts };
    } catch {
      // Fallback a single-device (backward compat / primo avvio)
      try {
        const ct = await signalEncrypt(auth.userId, auth.deviceId, recipientId, text);
        return { ...ct, deviceCiphertexts: [] };
      } catch {
        return undefined;
      }
    }
  }

  // ── Handlers ────────────────────────────────────────────────────────────
  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!activeConvId || !inputText.trim() || sending) return;
    const text = inputText.trim();
    setInputText("");
    setSendError(null);
    if (isTypingRef.current) { sendTypingStop(activeConvId); isTypingRef.current = false; }
    setSending(true);
    try {
      if (editingMessage) {
        // Modalità modifica — cifra con Signal
        const signal = await encryptForActive(text);
        const updated = await apiEditMessage(activeConvId, editingMessage.id, text, signal);
        // Aggiorna il testo decifrato nello state (conosciamo il plaintext)
        setDecryptedTexts((prev) => new Map(prev).set(updated.id, text));
        // FIX: aggiorna anche i cache (sentCacheRef + localStorage) con il nuovo testo
        // così quando l'evento WS message.edited chiama decryptSingleMsg, trova il testo
        // aggiornato invece di quello originale (che sovrascriveva il nuovo testo nello state).
        sentCacheRef.current.set(editingMessage.client_message_id ?? updated.id, text);
        cacheOwnTextByServerId(updated.id, text);
        setMessages((prev) => prev.map((m) =>
          m.id === updated.id
            ? { ...m, ciphertext: updated.ciphertext, edited_at: updated.edited_at }
            : m,
        ));
        setEditingMessage(null);
      } else {
        // Invio normale o risposta — cifra con Signal
        const clientMessageId = crypto.randomUUID();
        const replyToId      = replyTo?.id ?? null;
        const currentBurn    = burnAfterRead;
        const pendingMsgId   = `pending-${clientMessageId}`;
        const nowIso         = new Date().toISOString();

        // Salva il plaintext prima di cifrare (per display dei propri messaggi)
        sentCacheRef.current.set(clientMessageId, text);
        // FIX: persiste il plaintext in IDB — sopravvive al reload
        void cacheOwnText(clientMessageId, text);

        // ── OPTIMISTIC UPDATE ────────────────────────────────────────────────
        // Mostra il messaggio immediatamente nella UI senza aspettare encrypt+WS.
        // Il WS handler lo sostituisce con il messaggio reale appena confermato.
        const optimisticMsg: MessageItem = {
          id:                  pendingMsgId,
          client_message_id:   clientMessageId,
          conversation_id:     activeConvId,
          sender_id:           auth?.userId ?? "",
          message_type:        "text",
          ciphertext:          null,
          ciphertext_type:     null,
          sequence_number:     0,
          sent_at:             nowIso,
          server_received_at:  nowIso,
          status:              "sent",
          deleted_for_everyone: false,
          reply_to_message_id: replyToId,
          burn_after_read:     currentBurn,
          expires_at:          null,
        };
        setDecryptedTexts((prev) => new Map(prev).set(pendingMsgId, text));
        setMessages((prev) => [...prev, optimisticMsg]);
        setAtBottom(true);
        // Scroll diretto al fondo — non aspetta il re-render dell'effect
        requestAnimationFrame(() => {
          const c = messagesContainerRef.current;
          if (c) c.scrollTop = c.scrollHeight;
        });
        setReplyTo(null);
        if (currentBurn) setBurnAfterRead(false);
        void playNotifSound('sent');

        // Encrypt + send in background — se fallisce rimuove il pending
        try {
          const signal = await encryptForActive(text);
          reportAudit("AUDIT-4-send", {
            convId: activeConvId,
            signalType: signal?.type,
            deviceCiphertextsCount: signal?.deviceCiphertexts?.length ?? 0,
            entries: signal?.deviceCiphertexts?.map((d) => ({ device_id: d.device_id, type: d.type })) ?? [],
          });
          await apiSendMessage(activeConvId, text, {
            replyToMessageId: replyToId ?? undefined,
            burnAfterRead:    currentBurn,
            signal,
            clientMessageId,
            deviceCiphertexts: signal?.deviceCiphertexts,
          });
          // Fase 5: dopo ogni invio, rileggi il trust status dal IDB locale.
          const theirId = conversations.find((c) => c.conversation_id === activeConvId)?.other_user?.user_id;
          if (theirId) void refreshTrust(theirId);
        } catch (sendErr) {
          // Rimuovi il messaggio ottimistico e ripristina la UI
          setMessages((prev) => prev.filter((m) => m.id !== pendingMsgId));
          setDecryptedTexts((prev) => { const next = new Map(prev); next.delete(pendingMsgId); return next; });
          setReplyTo(replyTo);       // ripristina reply bar (closure cattura il valore originale)
          if (currentBurn) setBurnAfterRead(true);
          throw sendErr;             // gestito dall'outer catch (setSendError + setInputText)
        }
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : t("chat.sendError");
      if (editingMessage && (errMsg.includes("EDIT_EXPIRED") || errMsg.includes("EDIT_FORBIDDEN"))) {
        setEditingMessage(null);
        setInputText("");
        setSendError(t("chat.editExpiredError"));
      } else {
        setSendError(errMsg);
        setInputText(text);
      }
    } finally {
      setSending(false);
    }
  }

  // ── Emoji insert (cursore) ───────────────────────────────────────────────────
  /**
   * Inserisce l'emoji nella posizione del cursore all'interno di inputText.
   * L'inserimento fisico nella textarea è gestito da EmojiPickerButton.
   * Qui aggiorniamo lo state React in modo coerente.
   */
  const handleEmojiInsert = useCallback((emoji: string) => {
    // Aggiorniamo lo state — EmojiPickerButton ripristinerà il cursore con rAF
    setInputText((prev) => {
      // Otteniamo selectionStart dalla textarea via ref — già disponibile perché
      // il picker preserva il focus con preventDefault
      const ta = document.activeElement as HTMLTextAreaElement | null;
      const start = (ta?.tagName === "TEXTAREA" ? ta.selectionStart : null) ?? prev.length;
      const end   = (ta?.tagName === "TEXTAREA" ? ta.selectionEnd   : null) ?? prev.length;
      return prev.slice(0, start) + emoji + prev.slice(end);
    });
  }, []);

  // ── Sticker send ─────────────────────────────────────────────────────────────
  /**
   * Invia uno sticker come messaggio con message_type "sticker".
   * Il payload è serializzato con encodeStickerPayload e cifrato Signal
   * esattamente come un messaggio di testo normale — E2E invariato.
   *
   * Compatibilità: client senza supporto sticker leggono il body decifrato
   * e lo mostrano come "📎 Sticker" (il marker STICKER_MARKER è human-readable).
   */
  async function handleStickerSend(payload: StickerPayload) {
    if (!activeConvId) return;
    const body = encodeStickerPayload(payload);
    const clientMessageId = crypto.randomUUID();
    const pendingMsgId    = `pending-${clientMessageId}`;
    const nowIso          = new Date().toISOString();

    // Cache del plaintext (marker + JSON) per display dei propri messaggi
    sentCacheRef.current.set(clientMessageId, body);
    void cacheOwnText(clientMessageId, body);

    // Optimistic update — bolla sticker visibile immediatamente
    const optimisticMsg: MessageItem = {
      id:                   pendingMsgId,
      client_message_id:    clientMessageId,
      conversation_id:      activeConvId,
      sender_id:            auth?.userId ?? "",
      message_type:         "sticker",
      ciphertext:           null,
      ciphertext_type:      null,
      sequence_number:      0,
      sent_at:              nowIso,
      server_received_at:   nowIso,
      status:               "sent",
      deleted_for_everyone: false,
      reply_to_message_id:  null,
      burn_after_read:      false,
      expires_at:           null,
    };
    setDecryptedTexts((prev) => new Map(prev).set(pendingMsgId, body));
    setMessages((prev) => [...prev, optimisticMsg]);
    // Forza scroll-to-bottom: lo sticker è appena aggiunto in fondo
    // (se l'utente era scrollato in alto, la bolla sarebbe fuori view)
    setAtBottom(true);
    void playNotifSound("sent");

    try {
      const signal = await encryptForActive(body);
      // message_type "text" per compatibilità con il server di produzione:
      // lo sticker è identificato dal STICKER_MARKER nel plaintext decifrato,
      // non dal campo message_type (che il server vede cifrato/opaco).
      await apiSendMessage(activeConvId, body, {
        signal,
        clientMessageId,
        deviceCiphertexts: signal?.deviceCiphertexts,
        messageType: "text",
      });
    } catch {
      setMessages((prev) => prev.filter((m) => m.id !== pendingMsgId));
      setDecryptedTexts((prev) => { const next = new Map(prev); next.delete(pendingMsgId); return next; });
    }
  }

  /**
   * Invia uno sticker animato (Lottie v:2).
   * Stesso pattern di handleStickerSend — E2E invariato.
   * Compatibilità: client senza supporto v:2 mostrano "🎬 Sticker animato".
   */
  async function handleAnimatedStickerSend(payload: AnimatedStickerPayload) {
    if (!activeConvId) return;
    const body = encodeAnimatedStickerPayload(payload);
    const clientMessageId = crypto.randomUUID();
    const pendingMsgId    = `pending-${clientMessageId}`;
    const nowIso          = new Date().toISOString();

    sentCacheRef.current.set(clientMessageId, body);
    void cacheOwnText(clientMessageId, body);

    const optimisticMsg: MessageItem = {
      id:                   pendingMsgId,
      client_message_id:    clientMessageId,
      conversation_id:      activeConvId,
      sender_id:            auth?.userId ?? "",
      message_type:         "text",
      ciphertext:           null,
      ciphertext_type:      null,
      sequence_number:      0,
      sent_at:              nowIso,
      server_received_at:   nowIso,
      status:               "sent",
      deleted_for_everyone: false,
      reply_to_message_id:  null,
      burn_after_read:      false,
      expires_at:           null,
    };
    setDecryptedTexts((prev) => new Map(prev).set(pendingMsgId, body));
    setMessages((prev) => [...prev, optimisticMsg]);
    setAtBottom(true);
    void playNotifSound("sent");

    try {
      const signal = await encryptForActive(body);
      await apiSendMessage(activeConvId, body, {
        signal,
        clientMessageId,
        deviceCiphertexts: signal?.deviceCiphertexts,
        messageType: "text",
      });
    } catch {
      setMessages((prev) => prev.filter((m) => m.id !== pendingMsgId));
      setDecryptedTexts((prev) => { const next = new Map(prev); next.delete(pendingMsgId); return next; });
    }
  }

  /** Invia un messaggio di testo direttamente, senza passare da inputText.
   *  Usato per il messaggio di invito wallet USDA. */
  async function sendProgrammatic(text: string) {
    if (!activeConvId || !text.trim() || sending) return;
    setSending(true);
    setSendError(null);
    const clientMessageId = crypto.randomUUID();
    const pendingMsgId    = `pending-${clientMessageId}`;
    const nowIso          = new Date().toISOString();
    sentCacheRef.current.set(clientMessageId, text);
    void cacheOwnText(clientMessageId, text);
    const optimisticMsg: MessageItem = {
      id:                   pendingMsgId,
      client_message_id:    clientMessageId,
      conversation_id:      activeConvId,
      sender_id:            auth!.userId,
      message_type:         "text",
      ciphertext:           null,
      ciphertext_type:      null,
      sequence_number:      0,
      sent_at:              nowIso,
      server_received_at:   nowIso,
      status:               "sent",
      deleted_for_everyone: false,
      reply_to_message_id:  null,
      burn_after_read:      false,
      expires_at:           null,
    };
    setDecryptedTexts((prev) => new Map(prev).set(pendingMsgId, text));
    setMessages((prev) => [...prev, optimisticMsg]);
    void playNotifSound("sent");
    try {
      const signal = await encryptForActive(text);
      await apiSendMessage(activeConvId, text, {
        signal,
        clientMessageId,
        deviceCiphertexts: signal?.deviceCiphertexts,
      });
    } catch {
      setMessages((prev) => prev.filter((m) => m.id !== pendingMsgId));
      setDecryptedTexts((prev) => { const next = new Map(prev); next.delete(pendingMsgId); return next; });
    } finally {
      setSending(false);
    }
  }

  function openContextMenuAt(msg: MessageItem, rawX: number, rawY: number) {
    // Evita che il menu esca fuori schermo
    const menuW = 180, menuH = 220;
    const x = Math.min(rawX, window.innerWidth - menuW - 8);
    const y = Math.min(rawY, window.innerHeight - menuH - 8);
    ctxOpenedAtRef.current = Date.now(); // timestamp per ghost-click guard
    setContextMenu({ msg, x, y });
  }

  /** Esegue l'azione solo se il menu è aperto da almeno 350ms (anti ghost-click iOS) */
  function ctxAction(fn: () => void) {
    return () => {
      if (Date.now() - ctxOpenedAtRef.current < 350) return;
      fn();
    };
  }

  function handleContextMenu(e: React.MouseEvent, msg: MessageItem) {
    e.preventDefault();
    openContextMenuAt(msg, e.clientX, e.clientY);
  }

  function handleTouchStart(e: React.TouchEvent, msg: MessageItem) {
    const touch = e.touches[0];
    if (!touch) return;
    const x = touch.clientX;
    const y = touch.clientY;
    longPressTimerRef.current = setTimeout(() => {
      longPressTimerRef.current = null;
      openContextMenuAt(msg, x, y - 60); // sposta sopra il dito
      if (navigator.vibrate) navigator.vibrate(30);
    }, 500);
  }

  function handleTouchCancel() {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }

  // ── Swipe-to-reply su messaggi ───────────────────────────────────────────
  function handleMsgTouchStart(e: React.TouchEvent, msg: MessageItem) {
    if (selectMode) return;
    const touch = e.touches[0];
    if (!touch) return;
    const el = e.currentTarget as HTMLElement;
    msgSwipeState.current = {
      el,
      bubble: el.querySelector<HTMLElement>('.msg-bubble'),
      hint:   el.querySelector<HTMLElement>('.msg-swipe-hint'),
      startX: touch.clientX,
      startY: touch.clientY,
      msgId:  msg.id,
      active:    false,
      triggered: false,
    };
    // Avvia long-press per context menu
    handleTouchStart(e, msg);
  }

  function handleMsgTouchMove(e: React.TouchEvent) {
    if (selectMode || !msgSwipeState.current) return;
    const touch = e.touches[0];
    if (!touch) return;
    const state = msgSwipeState.current;
    const dx = touch.clientX - state.startX;
    const dy = Math.abs(touch.clientY - state.startY);

    if (!state.active) {
      if (Math.abs(dx) > 10 && Math.abs(dx) > dy) {
        // Swipe orizzontale confermato: entra in swipe mode e cancella long-press
        state.active = true;
        if (longPressTimerRef.current) { clearTimeout(longPressTimerRef.current); longPressTimerRef.current = null; }
      }
      return;
    }

    if (dx <= 0) {
      if (state.bubble) state.bubble.style.transform = '';
      if (state.hint)   state.hint.style.opacity = '0';
      return;
    }

    const clamped = Math.min(dx, 72);
    const opacity = Math.min(clamped / 56, 1);
    if (state.bubble) state.bubble.style.transform = `translateX(${clamped}px)`;
    if (state.hint)   state.hint.style.opacity  = String(opacity);

    if (dx >= 64 && !state.triggered) {
      state.triggered = true;
      if (navigator.vibrate) navigator.vibrate(20);
    }
  }

  function handleMsgTouchEnd(_e: React.TouchEvent) {
    if (longPressTimerRef.current) { clearTimeout(longPressTimerRef.current); longPressTimerRef.current = null; }
    const state = msgSwipeState.current;
    msgSwipeState.current = null;
    if (!state) return;

    // Animazione di ritorno della bolla
    if (state.bubble) {
      state.bubble.style.transition = 'transform 0.22s ease';
      state.bubble.style.transform  = '';
      setTimeout(() => { if (state.bubble) state.bubble.style.transition = ''; }, 230);
    }
    if (state.hint) state.hint.style.opacity = '0';

    if (state.triggered) {
      const target = messages.find(m => m.id === state.msgId);
      if (target) setReplyTo(target);
    }
  }

  /** Scrolla al messaggio con l'id dato e lo evidenzia brevemente. */
  function scrollToMessage(targetId: string) {
    const el        = document.querySelector<HTMLElement>(`[data-msg-id="${targetId}"]`);
    const container = messagesContainerRef.current;
    if (!el || !container) return;

    // scrollIntoView scorre l'antenato scrollable più vicino (il container overflow-y)
    // senza toccare il viewport — più affidabile del calcolo manuale scrollTop su iOS PWA.
    el.scrollIntoView({ behavior: "smooth", block: "center" });

    // Flash evidenziazione
    setTimeout(() => {
      el.classList.remove("msg-highlighted");
      void el.offsetWidth; // force reflow
      el.classList.add("msg-highlighted");
      setTimeout(() => el.classList.remove("msg-highlighted"), 1900);
    }, 350); // aspetta che lo smooth scroll sia quasi completato
  }

  function closeContextMenu() { setContextMenu(null); }

  // ── Multi-select ─────────────────────────────────────────────────────────
  function exitSelectMode() { setSelectMode(false); setSelectedMsgIds(new Set()); }

  function toggleSelectMsg(id: string) {
    setSelectedMsgIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function handleShare(msgs: MessageItem[]) {
    const texts = msgs
      .map((m) => getDisplayText(m))
      .filter(Boolean)
      .join("\n\n");
    if (!texts) { showToast(t("chat.toastNoText")); return; }
    const nav = navigator as Navigator & { share?: (data: ShareData) => Promise<void> };
    if (nav.share) {
      try { await nav.share({ text: texts }); }
      catch (e) {
        if ((e as Error).name !== "AbortError") {
          await navigator.clipboard.writeText(texts);
          showToast(t("chat.toastCopied"));
        }
      }
    } else {
      await navigator.clipboard.writeText(texts);
      showToast(t("chat.toastCopied"));
    }
  }

  /** Condividi un messaggio media (foto/video/documento) via share sheet nativo */
  async function handleShareMedia(msg: MessageItem) {
    const meta = decodeMediaMeta(getDisplayText(msg));
    if (!meta || meta.type === "voice") { showToast(t("chat.toastShareUnavailable")); return; }
    if (!meta.key || !meta.iv) { showToast(t("chat.toastNoKeys")); return; }
    showToast(t("chat.toastPreparing"));
    try {
      const objectUrl = await apiFetchAndDecryptMediaBlob(meta.media_id, meta.key, meta.iv);
      const res        = await fetch(objectUrl);
      const blob       = await res.blob();
      URL.revokeObjectURL(objectUrl);
      const ext      = meta.mime_type?.split("/")[1] ?? "bin";
      const filename = meta.filename ?? `media.${ext}`;
      const file     = new File([blob], filename, { type: meta.mime_type ?? blob.type });
      const nav = navigator as Navigator & {
        share?: (d: ShareData) => Promise<void>;
        canShare?: (d: ShareData) => boolean;
      };
      if (nav.share && nav.canShare?.({ files: [file] })) {
        await nav.share({ files: [file], title: filename });
      } else if (nav.share) {
        await nav.share({ text: filename });
      } else {
        showToast(t("chat.toastShareNotSupported"));
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") showToast(t("chat.toastShareError"));
    }
  }

  async function handleDeleteSelected() {
    const toDelete = messages.filter((m) => selectedMsgIds.has(m.id));
    exitSelectMode();
    for (const m of toDelete) await handleDeleteForMe(m);
  }

  function showToast(text: string) {
    setToastMsg(text);
    setTimeout(() => setToastMsg(null), 2500);
  }

  async function handleForwardTo(targetConvId: string) {
    if (!forwardingMessage) return;
    const text = getDisplayText(forwardingMessage);
    setForwardingMessage(null);
    const targetConv       = conversations.find((c) => c.conversation_id === targetConvId);
    const targetRecipientId = targetConv?.other_user?.user_id;

    try {
      const clientMessageId = crypto.randomUUID();

      // ── Media/voice forward ──────────────────────────────────────────────
      // Il testo decodificato per i messaggi media È il JSON con media_id+key+iv.
      // Lo re-inviamo come messaggio media corretto invece di testo raw.
      const fwdMediaMeta = forwardingMessage.message_type === "media" ? decodeMediaMeta(text) : null;
      const fwdVoiceMeta = forwardingMessage.message_type === "media" ? decodeVoiceMeta(text) : null;

      if (fwdMediaMeta || fwdVoiceMeta) {
        const metaJson = text; // contiene e2e key+iv intatti
        const mediaId  = fwdMediaMeta?.media_id ?? fwdVoiceMeta!.media_id;

        // Cache per il WS handler (permette decrypt lato mittente nella conv target)
        sentCacheRef.current.set(clientMessageId, metaJson);
        void cacheOwnMessageMeta(clientMessageId, metaJson);

        let signal: { body: string; type: number } | undefined;
        let dcs:    Array<{ device_id: string; body: string; type: number }> | undefined;

        if (auth && targetRecipientId) {
          try {
            const allBundles = await apiGetAllKeyBundles(targetRecipientId);
            const { primary, deviceCiphertexts } = await signalEncryptMulti(
              auth.userId, auth.deviceId, targetRecipientId, metaJson, allBundles,
            );
            signal = primary;
            dcs    = deviceCiphertexts;
          } catch {
            try {
              signal = await signalEncrypt(auth.userId, auth.deviceId, targetRecipientId, metaJson);
            } catch { /* no Signal → fallback legacy */ }
          }
        }

        await apiSendMediaMessage(targetConvId, mediaId, signal, clientMessageId, metaJson, dcs);

      } else {
        // ── Testo forward ──────────────────────────────────────────────────
        if (text) sentCacheRef.current.set(clientMessageId, text);
        let signal: { body: string; type: number } | undefined;
        if (auth && targetRecipientId) {
          try { signal = await signalEncrypt(auth.userId, auth.deviceId, targetRecipientId, text); }
          catch { /* fallback legacy */ }
        }
        await apiSendMessage(targetConvId, text, { signal, clientMessageId, forward: true });
      }

      showToast(t("chat.toastForwarded"));
    } catch {
      showToast(t("chat.toastForwardError"));
    }
  }

  async function handleVoiceSend(voice: VoiceBlob) {
    if (!activeConvId || !auth) return;

    // ── OPTIMISTIC UPDATE ────────────────────────────────────────────────────
    const clientMessageId = crypto.randomUUID();
    const pendingMsgId    = `pending-${clientMessageId}`;
    const nowIso          = new Date().toISOString();
    const convId          = activeConvId; // cattura per il retry (l'utente potrebbe cambiare conv)
    const localUrl        = URL.createObjectURL(voice.blob);

    setMediaUploadStates((prev) =>
      new Map(prev).set(pendingMsgId, {
        phase:     "preparing",
        localUrl,
        mimeType:  voice.blob.type || "audio/webm",
        mediaType: "voice",
        durationMs: voice.durationMs,
        waveform:  voice.waveform,
      }),
    );
    setMessages((prev) => [
      ...prev,
      {
        id:                   pendingMsgId,
        client_message_id:    clientMessageId,
        conversation_id:      convId,
        sender_id:            auth.userId,
        message_type:         "media",
        ciphertext:           null,
        ciphertext_type:      null,
        sequence_number:      0,
        sent_at:              nowIso,
        server_received_at:   nowIso,
        status:               "sent",
        deleted_for_everyone: false,
      },
    ]);
    setSending(true);

    /** Aggiorna solo la fase nel map, senza toccare il resto */
    const updPhase = (phase: MediaUploadPhase, extra?: Partial<MediaUploadState>) =>
      setMediaUploadStates((prev) => {
        const s = prev.get(pendingMsgId);
        if (!s) return prev;
        return new Map(prev).set(pendingMsgId, { ...s, phase, retryFn: undefined, ...extra });
      });

    async function doUpload() {
      try {
        // 1. Cifratura
        updPhase("encrypting");
        const { encryptedBlob, keyBase64, ivBase64 } = await encryptMediaBlob(voice.blob);

        // 2. Upload
        updPhase("uploading", { progress: 0 });
        const media = await apiUploadEncryptedMedia(convId, encryptedBlob, voice.blob.type || "audio/webm", {
          durationMs: voice.durationMs,
          waveform:   voice.waveform,
          onProgress: (pct: number) =>
            setMediaUploadStates((prev) => {
              const s = prev.get(pendingMsgId);
              if (!s) return prev;
              return new Map(prev).set(pendingMsgId, { ...s, phase: "uploading", progress: Math.round(pct) });
            }),
        });

        // 3. Signal-cifra e invia
        updPhase("sending");
        const metaJson = JSON.stringify({
          e2e:         true,
          type:        "voice",
          media_id:    media.media_id,
          key:         keyBase64,
          iv:          ivBase64,
          duration_ms: media.duration_ms ?? voice.durationMs,
          waveform:    media.waveform.length > 0 ? media.waveform : voice.waveform,
          mime_type:   voice.blob.type || "audio/webm",
        });
        sentCacheRef.current.set(clientMessageId, metaJson);
        void cacheOwnMessageMeta(clientMessageId, metaJson);
        const signal = await encryptForActive(metaJson);
        await apiSendMediaMessage(convId, media.media_id, signal, clientMessageId, metaJson, signal?.deviceCiphertexts);
        // WS confirmation replaces the pending message — nessuna azione necessaria qui
      } catch (err) {
        // Mostra stato "failed" con possibilità di riprovare
        setMediaUploadStates((prev) => {
          const s = prev.get(pendingMsgId);
          if (!s) return prev;
          return new Map(prev).set(pendingMsgId, { ...s, phase: "failed", retryFn: doUpload });
        });
        // Non mostrare toast generico — la bolla stessa mostra l'errore
      } finally {
        setSending(false);
      }
    }

    await doUpload();
  }

  /** Comprimi un'immagine via Canvas prima del caricamento.
   * Riduce foto iPhone da 4-8 MB a ~300-600 KB → upload 10-20x più veloce.
   * Non tocca video, audio, o documenti. */
  /** Comprimi immagine via Canvas con timeout di sicurezza (3 s).
   * Su iOS alcune immagini (HEIC Live Photo) non triggherano mai onload →
   * senza timeout la Promise non si risolve mai e l'app si blocca. */
  async function compressImage(file: File): Promise<Blob> {
    const compress = new Promise<Blob>((resolve) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        const MAX = 1920;
        let { width, height } = img;
        if (width > MAX || height > MAX) {
          if (width >= height) { height = Math.round(height * MAX / width); width = MAX; }
          else                 { width  = Math.round(width  * MAX / height); height = MAX; }
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) { resolve(file); return; }
        ctx.drawImage(img, 0, 0, width, height);
        // toBlob ha un proprio timeout di 3 s
        const blobTimeout = setTimeout(() => resolve(file), 3000);
        canvas.toBlob((blob) => { clearTimeout(blobTimeout); resolve(blob ?? file); }, "image/jpeg", 0.85);
      };
      img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
      img.src = url;
    });
    // Se onload non scatta entro 3 s → usa il file originale
    const timeout = new Promise<Blob>((resolve) => setTimeout(() => resolve(file), 3000));
    return Promise.race([compress, timeout]);
  }

  async function handleFilePick(files: FileList) {
    if (!activeConvId || !auth || files.length === 0) return;
    const convId = activeConvId;

    // Limiti client-side (backend li rifiuta comunque)
    const LIMIT: Record<string, number> = { image: 10, video: 15, audio: 5, document: 10 };

    // Valida tutti i file prima di iniziare
    for (const file of Array.from(files)) {
      const categ = file.type.startsWith("image/") ? "image"
                  : file.type.startsWith("video/") ? "video"
                  : file.type.startsWith("audio/") ? "audio"
                  : "document";
      const maxBytes = (LIMIT[categ] ?? 10) * 1024 * 1024;
      if (file.size > maxBytes) {
        setSendError(`"${file.name}" troppo grande (max ${maxBytes / 1024 / 1024} MB per ${categ})`);
        return;
      }
    }

    setSending(true);

    // Invia i file in sequenza (Signal è stateful, la cifratura è seriale)
    for (const file of Array.from(files)) {
      const categ = file.type.startsWith("image/") ? "image"
                  : file.type.startsWith("video/") ? "video"
                  : file.type.startsWith("audio/") ? "audio"
                  : "document";
      const mtype = categ === "audio" ? "voice" : categ as "image" | "video" | "document";

      // ── OPTIMISTIC UPDATE per questo file ──────────────────────────────────
      const clientMessageId = crypto.randomUUID();
      const pendingMsgId    = `pending-${clientMessageId}`;
      const nowIso          = new Date().toISOString();
      const localUrl        = URL.createObjectURL(file);

      setMediaUploadStates((prev) =>
        new Map(prev).set(pendingMsgId, {
          phase: "preparing", localUrl,
          filename: file.name, mimeType: file.type,
          mediaType: mtype, size: file.size,
        }),
      );
      setMessages((prev) => [
        ...prev,
        {
          id:                   pendingMsgId,
          client_message_id:    clientMessageId,
          conversation_id:      convId,
          sender_id:            auth.userId,
          message_type:         "media",
          ciphertext:           null,
          ciphertext_type:      null,
          sequence_number:      0,
          sent_at:              nowIso,
          server_received_at:   nowIso,
          status:               "sent",
          deleted_for_everyone: false,
        },
      ]);
      setUploadProgress(0);

      const updPhase = (phase: MediaUploadPhase, extra?: Partial<MediaUploadState>) =>
        setMediaUploadStates((prev) => {
          const s = prev.get(pendingMsgId);
          if (!s) return prev;
          return new Map(prev).set(pendingMsgId, { ...s, phase, retryFn: undefined, ...extra });
        });

      async function doUpload() {
        try {
          // 1. Compressione (solo immagini grandi)
          updPhase("preparing");
          const blobToEncrypt: File | Blob =
            file.type.startsWith("image/") && file.size > 300_000
              ? await compressImage(file)
              : file;

          // 2. Cifratura AES-256-GCM
          updPhase("encrypting");
          const { encryptedBlob, keyBase64, ivBase64 } = await encryptMediaBlob(blobToEncrypt);
          setUploadProgress(10);

          // 3. Upload su R2
          updPhase("uploading", { progress: 0 });
          const media = await apiUploadEncryptedMedia(convId, encryptedBlob, file.type, {
            originalFilename: file.name,
            onProgress: (pct: number) => {
              const rounded = Math.round(pct);
              setUploadProgress(Math.round(10 + pct * 0.8));
              setMediaUploadStates((prev) => {
                const s = prev.get(pendingMsgId);
                if (!s) return prev;
                return new Map(prev).set(pendingMsgId, { ...s, phase: "uploading", progress: rounded });
              });
            },
          });
          setUploadProgress(90);

          // 4. Signal-cifra e invia
          updPhase("sending");
          const metaJson = JSON.stringify({
            e2e:       true,
            type:      mtype,
            media_id:  media.media_id,
            key:       keyBase64,
            iv:        ivBase64,
            mime_type: file.type,
            filename:  file.name,
            size:      file.size,
            ...(media.duration_ms != null ? { duration_ms: media.duration_ms } : {}),
            ...(media.waveform.length > 0 ? { waveform:    media.waveform }    : {}),
          });
          sentCacheRef.current.set(clientMessageId, metaJson);
          void cacheOwnMessageMeta(clientMessageId, metaJson);
          const signal = await encryptForActive(metaJson);
          await apiSendMediaMessage(convId, media.media_id, signal, clientMessageId, metaJson, signal?.deviceCiphertexts);
          setUploadProgress(100);
        } catch {
          setMediaUploadStates((prev) => {
            const s = prev.get(pendingMsgId);
            if (!s) return prev;
            return new Map(prev).set(pendingMsgId, { ...s, phase: "failed", retryFn: doUpload });
          });
          setUploadProgress(null);
        }
      }

      await doUpload();
    }

    setSending(false);
    setUploadProgress(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  // ── Location sharing ──────────────────────────────────────────────────────

  function handleLocationRequest() {
    if (!activeConvId || !auth) return;
    if (!navigator.geolocation) {
      showToast(t("chat.toastGeoNotSupported"));
      return;
    }
    setLocationModal("acquiring");
    setLocationError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocationData({
          lat:      pos.coords.latitude,
          lon:      pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        });
        setLocationModal("ready");
      },
      (err) => {
        const msg =
          err.code === err.PERMISSION_DENIED
            ? "Permesso posizione negato. Abilitalo nelle impostazioni del browser."
          : err.code === err.POSITION_UNAVAILABLE
            ? "GPS non disponibile. Verifica di essere all'aperto."
          : err.code === err.TIMEOUT
            ? "Timeout GPS — riprova in un'area con segnale migliore."
          : "Impossibile ottenere la posizione.";
        setLocationError(msg);
        setLocationModal("error");
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 30_000 },
    );
  }

  async function handleSendLocation() {
    if (!activeConvId || !auth || !locationData) return;
    setLocationModal(null);
    const precise  = localStorage.getItem("ac_precise_location") !== "false";
    const round3   = (n: number) => Math.round(n * 1000) / 1000; // ~100 m
    const lat      = precise ? locationData.lat : round3(locationData.lat);
    const lon      = precise ? locationData.lon : round3(locationData.lon);
    const accuracy = precise ? locationData.accuracy : Math.ceil(locationData.accuracy / 100) * 100;
    const payload: LocationMeta = {
      e2e: true, type: "location",
      latitude: lat, longitude: lon, accuracy,
      timestamp: Math.floor(Date.now() / 1000),
    };
    const locJson         = JSON.stringify(payload);
    const clientMessageId = crypto.randomUUID();
    const pendingMsgId    = `pending-${clientMessageId}`;
    const nowIso          = new Date().toISOString();
    const convId          = activeConvId;
    sentCacheRef.current.set(clientMessageId, locJson);
    void cacheOwnText(clientMessageId, locJson);
    setDecryptedTexts((prev) => new Map(prev).set(pendingMsgId, locJson));
    setMessages((prev) => [
      ...prev,
      {
        id: pendingMsgId, client_message_id: clientMessageId,
        conversation_id: convId, sender_id: auth.userId,
        message_type: "text", ciphertext: null, ciphertext_type: null,
        sequence_number: 0, sent_at: nowIso, server_received_at: nowIso,
        status: "sent", deleted_for_everyone: false,
      },
    ]);
    try {
      const signal = await encryptForActive(locJson);
      await apiSendMessage(convId, locJson, { signal, clientMessageId, deviceCiphertexts: signal?.deviceCiphertexts });
      void playNotifSound("sent");
    } catch (err) {
      setMessages((prev) => prev.filter((m) => m.id !== pendingMsgId));
      setDecryptedTexts((prev) => { const n = new Map(prev); n.delete(pendingMsgId); return n; });
      showToast(err instanceof Error ? err.message : t("chat.toastSendPositionError"));
    }
  }

  async function handleConfirmSecureDestroy() {
    if (!destroyTarget || !activeConvId || destroying) return;
    setDestroying(true);
    try {
      await apiSecureDestroy(activeConvId, destroyTarget.id);
      void playNotifSound('destroy');
      // avvia dissoluzione locale (il WS arriverà anche per noi)
      const id = destroyTarget.id;
      setDestroyingIds((prev) => { const s = new Set(prev); s.add(id); return s; });
      setTimeout(() => {
        setMessages((prev) => prev.filter((m) => m.id !== id));
        setDestroyingIds((prev) => { const s = new Set(prev); s.delete(id); return s; });
      }, 600);
      showToast(t("chat.toastSecureDestroy"));
    } catch (err) {
      showToast(err instanceof Error ? err.message : t("chat.toastSecureDestroyError"));
    } finally {
      setDestroying(false);
      setDestroyTarget(null);
    }
  }

  function toggleMuteConversation() {
    if (!activeConvId) return;
    setMutedConvIds((prev) => {
      const next = new Set(prev);
      if (next.has(activeConvId!)) next.delete(activeConvId!);
      else next.add(activeConvId!);
      try { localStorage.setItem("alpha_muted_convs", JSON.stringify([...next])); } catch {}
      const muted = next.has(activeConvId!);
      showToast(muted ? t("chat.toastMuted") : t("chat.toastUnmuted"));
      return next;
    });
  }

  function handleClearChat() {
    if (!activeConvId) return;
    setShowClearChatModal(true);
  }

  async function confirmClearChat() {
    if (!activeConvId) return;
    setClearChatLoading(true);
    try {
      await apiClearConversationMessages(activeConvId);
      setMessages([]);
      setDecryptedTexts(new Map());
      setShowClearChatModal(false);
      showToast(t("chat.toastChatDeleted"));
    } catch (err) {
      showToast(err instanceof Error ? err.message : t("chat.toastChatDeleteError"));
    } finally {
      setClearChatLoading(false);
    }
  }

  async function handleBlockUser() {
    const conv = conversations.find((c) => c.conversation_id === activeConvId);
    const targetId = conv?.other_user?.user_id;
    if (!targetId) return;
    const name = conv?.other_user?.display_name ?? conv?.other_user?.username ?? "questo utente";
    const confirmed = window.confirm(`Bloccare ${name}?\n\nNon potrà più inviarti messaggi.`);
    if (!confirmed) return;
    try {
      const { apiBlockUser } = await import("../lib/api");
      await apiBlockUser(targetId);
      showToast(t("chat.toastUserBlocked", { name }));
    } catch {
      showToast(t("chat.toastBlockError"));
    }
  }

  async function handleDeleteForMe(msg: MessageItem) {
    closeContextMenu();
    if (!activeConvId) return;
    await apiDeleteMessage(activeConvId, msg.id, false).catch(() => {});
    setMessages((prev) => prev.filter((m) => m.id !== msg.id));
  }

  async function handleDeleteForAll(msg: MessageItem) {
    closeContextMenu();
    if (!activeConvId) return;
    await apiDeleteMessage(activeConvId, msg.id, true).catch(() => {});
    setMessages((prev) => prev.filter((m) => m.id !== msg.id));
  }

  function handleInputChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setInputText(e.target.value);
    if (!activeConvId) return;
    if (!isTypingRef.current) { sendTypingStart(activeConvId); isTypingRef.current = true; }
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    typingTimerRef.current = setTimeout(() => {
      if (activeConvId && isTypingRef.current) { sendTypingStop(activeConvId); isTypingRef.current = false; }
    }, 3_000);
  }

  /**
   * Presenza "sta registrando un vocale". Riusa l'infrastruttura typing
   * (activity="recording"). Il server auto-stoppa typing dopo 5s, quindi
   * durante una registrazione lunga ri-inviamo l'evento ogni 3s (keep-alive).
   * Lo stop viene inviato in tutti i percorsi di uscita (invio/annulla/tap).
   */
  function handleRecordingChange(active: boolean) {
    if (!activeConvId) return;
    if (active) {
      sendTypingStart(activeConvId, "recording");
      recordingActiveConvRef.current = activeConvId;
      if (recordingKeepAliveRef.current) clearInterval(recordingKeepAliveRef.current);
      recordingKeepAliveRef.current = setInterval(() => {
        const cid = recordingActiveConvRef.current;
        if (cid) sendTypingStart(cid, "recording");
      }, 3_000);
    } else {
      if (recordingKeepAliveRef.current) { clearInterval(recordingKeepAliveRef.current); recordingKeepAliveRef.current = null; }
      const cid = recordingActiveConvRef.current ?? activeConvId;
      recordingActiveConvRef.current = null;
      sendTypingStop(cid);
    }
  }

  async function handleRedeemSuccess(conversationId: string) {
    setShowRedeem(false);
    await loadConversations();
    setActiveConvId(conversationId);
    if (!chatHistoryPushedRef.current) {
      window.history.pushState({ chatOpen: true }, "");
      chatHistoryPushedRef.current = true;
    }
    setMobileShowChat(true);
    mobileShowChatRef.current = true;
  }

  /** Chiude la chat mobile sincronizzando anche il history state */
  function closeChatMobile() {
    setMobileShowChat(false);
    mobileShowChatRef.current = false;
    setShowChatSearch(false);
    setChatSearchQuery("");
    if (chatHistoryPushedRef.current) {
      chatHistoryPushedRef.current = false;
      // Rimuovi lo stato pushato; se popstate si triggera, mobileShowChatRef è già false → no-op
      window.history.back();
    }
  }

  function handleSelectConv(convId: string) {
    // Push history entry così il tasto Back OS chiude la chat invece di uscire dalla PWA
    if (!chatHistoryPushedRef.current) {
      window.history.pushState({ chatOpen: true }, "");
      chatHistoryPushedRef.current = true;
    }
    setActiveConvId(convId);
    setMobileShowChat(true);
    mobileShowChatRef.current = true;
    setAtBottom(true);
    setShowChatSearch(false);
    setChatSearchQuery("");
    // Azzeramento OTTIMISTICO del badge non letti: aprire = leggere.
    // Senza questo il conteggio (calcolato dal server all'ultimo load) resta
    // visibile finché non si ricarica la lista, anche dopo apiMarkRead.
    setConversations((prev) =>
      prev.map((c) => (c.conversation_id === convId && c.unread_count > 0
        ? { ...c, unread_count: 0 }
        : c)),
    );
    // Inizializza read receipt dalla lista conversazioni
    const conv = conversations.find((c) => c.conversation_id === convId);
    if (conv?.other_user_last_read_at) {
      setReadReceipts((prev) => ({
        ...prev,
        [convId]: conv.other_user_last_read_at as string,
      }));
    }
    // Notifica il backend che abbiamo letto i messaggi
    void apiMarkRead(convId).catch(() => {/* silenzioso */});
  }

  async function handleLogout() {
    setLoggingOut(true);
    await logout();
  }

  async function handleLogoutAll() {
    setLoggingOut(true);
    await logoutAll();
  }

  // ── Derived ──────────────────────────────────────────────────────────────
  const activeConv = conversations.find((c) => c.conversation_id === activeConvId);
  const otherUser = activeConv?.other_user;
  const isOtherOnline = otherUser ? onlineUsers.has(otherUser.user_id) : false;
  const typingInActive = activeConvId ? [...(typingUsers[activeConvId] ?? [])] : [];
  const othersTyping = typingInActive.filter((id) => id !== auth?.userId);
  const recordingInActive = activeConvId ? [...(recordingUsers[activeConvId] ?? [])] : [];
  const othersRecording = recordingInActive.filter((id) => id !== auth?.userId);

  return (
    <div className="chat-root">
      {/* ── Sidebar ──────────────────────────────────────────────────────── */}
      <aside className={`sidebar${mobileShowChat ? " sidebar-mobile-hidden" : ""}`}>
        {/* Header */}
        <div className="sidebar-header">
          <SidebarMenu
            displayName={auth?.displayName ?? ""}
            username={auth?.username ?? ""}
            connected={connected}
            avatarUrl={auth?.avatarUrl}
            onNavigate={onNavigate}
            onLogout={handleLogout}
            onLogoutAll={handleLogoutAll}
            loggingOut={loggingOut}
          />
          <div className="sidebar-user-info">
            <div className="sidebar-username">{auth?.displayName}</div>
            <div className={`sidebar-status ${connected ? "online" : "offline"}`}>
              {connected ? `● ${t("chat.online")}` : `○ ${t("chat.offline")}`}
            </div>
          </div>
          {/* Registro chiamate */}
          <button
            className="invite-sidebar-btn"
            title={t("calls:historyTitle", "Chiamate")}
            onClick={() => onNavigate("call-history")}
            aria-label={t("calls:historyTitle", "Chiamate")}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
                 strokeLinecap="round" strokeLinejoin="round" width="17" height="17">
              <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.62 3.37 2 2 0 0 1 3.62 1h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.6a16 16 0 0 0 6 6l.96-.96a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>
            </svg>
          </button>

          {/* Nuovo gruppo */}
          <button
            className="invite-sidebar-btn"
            title="Nuovo gruppo"
            onClick={() => setShowCreateGroup(true)}
            aria-label="Nuovo gruppo"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="17" height="17">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
              <circle cx="9" cy="7" r="4"/>
              <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
              <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
            </svg>
          </button>
          {/* Invite button */}
          <button
            className="invite-sidebar-btn"
            title="Invita persona"
            onClick={() => setShowInvite(true)}
            aria-label="Invita persona"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="17" height="17">
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
              <circle cx="9" cy="7" r="4"/>
              <line x1="19" y1="8" x2="19" y2="14"/>
              <line x1="22" y1="11" x2="16" y2="11"/>
            </svg>
          </button>
        </div>

        {/* Conversation list */}
        <div className="conv-list">
            {/* Redeem banner — sempre visibile in cima alla lista */}
            <button className="redeem-banner" onClick={() => setShowRedeem(true)}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="15" height="15">
                <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
                <rect x="3" y="14" width="7" height="7"/>
                <circle cx="17" cy="17" r="3"/>
              </svg>
              {t("chat.redeemBanner")}
              <span className="redeem-banner-arrow">›</span>
            </button>

            {/* Banner messaggi non decifrabili — appare quando Signal fallisce
                dopo un deploy/aggiornamento. Persiste finché l'utente non chiude. */}
            {showUndecifrableAlert && (
              <div className="undecifrable-alert">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16" style={{ flexShrink: 0 }}>
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                  <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
                </svg>
                <div className="undecifrable-alert-text">
                  <strong>Aggiornamento app completato</strong>
                  <span>Alcuni messaggi ricevuti prima dell'aggiornamento potrebbero non essere decifrabili. I nuovi messaggi funzioneranno normalmente.</span>
                </div>
                <button
                  className="undecifrable-alert-close"
                  onClick={() => {
                    // Salva il timestamp dell'evento corrente come "dismissal".
                    // Se arriva un NUOVO evento crittografico (timestamp diverso),
                    // il banner riapparirà — Condizione 3 del documento.
                    const eventTs = sessionStorage.getItem("undecifrable_event_ts") ?? "";
                    sessionStorage.setItem("undecifrable_dismissed_ts", eventTs);
                    setShowUndecifrableAlert(false);
                  }}
                  aria-label="Chiudi"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="14" height="14">
                    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                  </svg>
                </button>
              </div>
            )}

            {loadingConvs && <div className="conv-hint">{t("common.loading")}</div>}
            {!loadingConvs && conversations.length === 0 && (
              <div className="conv-hint conv-hint-empty">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="40" height="40" style={{ opacity: 0.3, marginBottom: 12 }}>
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                </svg>
                {t("chat.noChatsYet")}<br />
                <span style={{ fontSize: 13 }}>{t("chat.inviteHint")}</span>
              </div>
            )}
            {conversations.map((conv) => {
              const other     = conv.other_user;
              const isGroup   = conv.type === "group";
              const isOnline  = other ? onlineUsers.has(other.user_id) : false;
              const isActive  = conv.conversation_id === activeConvId;
              const hasUnread = conv.unread_count > 0;
              const displayName = isGroup
                ? (conv.name ?? "Gruppo")
                : (other?.display_name ?? other?.username ?? "Utente sconosciuto");
              if (!isGroup && !other) {
                console.warn("[ChatPage] other_user null per conversazione diretta — dati incompleti dal backend", conv.conversation_id);
              }
              const avatarChar = isGroup ? "👥" : (displayName[0]?.toUpperCase() ?? "?");

              // Anteprima ultimo messaggio
              const preview = conv.last_message_preview;
              const previewText = (() => {
                // USDA messages hanno ciphertext null — gestirli prima
                if (preview && !preview.ciphertext) {
                  const mt = (preview as { message_type?: string }).message_type;
                  const sm = (preview as { system_metadata?: Record<string, unknown> }).system_metadata;
                  if (mt === "usda_send") {
                    const amount = sm?.amount ?? "";
                    return preview.sender_id === auth?.userId
                      ? `💰 Hai inviato ${amount} USDA`
                      : `💰 Ricevuto ${amount} USDA`;
                  }
                  if (mt === "usda_request") {
                    const amount = sm?.amount ?? "";
                    return preview.sender_id === auth?.userId
                      ? `💸 Hai richiesto ${amount} USDA`
                      : `💸 Richiesta di ${amount} USDA`;
                  }
                  if (mt === "usda_receipt") return "💰 Pagamento confermato";
                  return null;
                }
                if (!preview?.ciphertext) return null;

                /** Converte il meta JSON di un media in etichetta leggibile */
                function mediaLabel(text: string): string | null {
                  const lm = decodeLocationMeta(text);
                  if (lm) return t("chat.mediaLocation");
                  const mm = decodeMediaMeta(text);
                  if (!mm) return null;
                  if (mm.type === "voice")    return t("chat.voiceNote");
                  if (mm.type === "image")    return t("chat.mediaPhoto");
                  if (mm.type === "video")    return t("chat.mediaVideo");
                  if (mm.type === "document") return `📄 ${mm.filename ?? t("chat.mediaDocument")}`;
                  return null;
                }

                // 1. Vocale (decodeVoiceMeta — legacy + nuovo)
                const vm = decodeVoiceMeta(preview.ciphertext);
                if (vm) return t("chat.voiceNote");

                // 2. Media con JSON diretto nel ciphertext (es. invio senza Signal E2E)
                const directLabel = mediaLabel(preview.ciphertext);
                if (directLabel) return directLabel;

                // 3. Messaggi ricevuti da altri → lucchetto (ciphertext = binario cifrato)
                if (preview.sender_id !== auth?.userId) return "🔒 Messaggio cifrato";

                // 4. Gruppi: cerca prima nella cache dei testi decifrati
                if (isGroup) {
                  const cached = decryptedTexts.get(preview.message_id);
                  if (cached && cached !== "🔒 Messaggio cifrato") {
                    return mediaLabel(cached) ?? cached;
                  }
                  return "📨 Messaggio inviato";
                }

                // 5. Proprio messaggio 1:1: cache dei testi decifrati (popolata dopo decrypt)
                const cachedPlaintext = decryptedTexts.get(preview.message_id);
                if (cachedPlaintext && cachedPlaintext !== "🔒 Messaggio cifrato") {
                  return mediaLabel(cachedPlaintext) ?? cachedPlaintext;
                }

                // 6. Fallback legacy base64
                const decoded = safeDecodeForPreview(preview.ciphertext);
                return mediaLabel(decoded) ?? decoded;
              })();
              const previewLabel = previewText
                ? (preview!.sender_id === auth?.userId ? `${t("chat.youPrefix")}${previewText}` : previewText)
                : t("chat.noMessages");

              const convId = conv.conversation_id;
              const convDisplayName = displayName;
              const isSwiped = swipedConvId === convId;
              return (
                <div key={convId} className={`conv-swipe-wrapper${isSwiped ? " swiped" : ""}`}>
                  {/* Swipe action buttons (behind) */}
                  <div className="conv-swipe-actions">
                    <button
                      className="conv-swipe-btn conv-swipe-archive"
                      onClick={() => {
                        setSwipedConvId(null);
                        archiveConversation(convId);
                        setConversations((prev) => prev.filter((c) => c.conversation_id !== convId));
                        if (activeConvId === convId) { setActiveConvId(null); closeChatMobile(); }
                        showToast(t("chat.toastArchived"));
                      }}
                    >📦</button>
                    <button
                      className="conv-swipe-btn conv-swipe-delete"
                      onClick={async () => {
                        setSwipedConvId(null);
                        // Optimistic update: rimuoviamo subito dalla lista
                        setConversations((prev) => prev.filter((c) => c.conversation_id !== convId));
                        if (activeConvId === convId) { setActiveConvId(null); closeChatMobile(); }
                        try {
                          if (isGroup) {
                            const { apiLeaveGroup } = await import("../lib/api");
                            await apiLeaveGroup(convId);
                          } else {
                            // Vera eliminazione: soft-delete della membership (non solo messaggi)
                            const { apiDeleteConversation } = await import("../lib/api");
                            await apiDeleteConversation(convId);
                          }
                        } catch { /* silenzioso — optimistic update già applicato */ }
                        showToast(isGroup ? t("chat.toastLeft") : t("chat.toastDeleted"));
                      }}
                    >🗑️</button>
                  </div>

                  {/* Conv item (slide left on swipe) */}
                  <button
                    className={`conv-item${isActive ? " active" : ""}${hasUnread ? " conv-item-unread" : ""}${isGroup ? " conv-item-group" : ""}`}
                    onClick={() => {
                      if (isSwiped) { setSwipedConvId(null); return; }
                      handleSelectConv(convId);
                    }}
                    onTouchStart={(e) => {
                      swipeStartX.current = e.touches[0].clientX;
                      swipeStartY.current = e.touches[0].clientY;
                      convLongPressTimerRef.current = setTimeout(() => {
                        convLongPressTimerRef.current = null;
                        setConvActionSheet({ convId, displayName: convDisplayName });
                      }, 600);
                    }}
                    onTouchMove={(e) => {
                      const dx = e.touches[0].clientX - swipeStartX.current;
                      const dy = Math.abs(e.touches[0].clientY - swipeStartY.current);
                      if (Math.abs(dx) > 10 && dy < 30) {
                        if (convLongPressTimerRef.current) {
                          clearTimeout(convLongPressTimerRef.current);
                          convLongPressTimerRef.current = null;
                        }
                        if (dx < -50) setSwipedConvId(convId);
                        else if (dx > 20 && isSwiped) setSwipedConvId(null);
                      }
                    }}
                    onTouchEnd={() => {
                      if (convLongPressTimerRef.current) {
                        clearTimeout(convLongPressTimerRef.current);
                        convLongPressTimerRef.current = null;
                      }
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setConvActionSheet({ convId, displayName: convDisplayName });
                    }}
                  >
                    <button
                      className="avatar-wrapper avatar-tapable"
                      onClick={(e) => {
                        if (!isGroup && other) {
                          e.stopPropagation();
                          setConvPhotoModal({
                            avatarUrl: other.avatar_url,
                            displayName,
                            username: other.username,
                            isOnline,
                          });
                        }
                      }}
                      aria-label={isGroup ? undefined : "Vedi foto profilo"}
                      style={{ background: "none", border: "none", padding: 0, cursor: isGroup ? "default" : "pointer" }}
                    >
                      <div className={`avatar avatar-md${hasUnread ? " avatar-unread" : ""}${isGroup ? " avatar-group" : ""}`}>
                        {avatarChar}
                      </div>
                      {!isGroup && isOnline && <div className="presence-dot" />}
                    </button>
                    <div className="conv-info">
                      <div className="conv-row-top">
                        <div className={`conv-name${hasUnread ? " conv-name-bold" : ""}`}>
                          {displayName}
                          {isGroup && <span className="conv-group-badge"> · {t("chat.group")}</span>}
                        </div>
                        <div className={`conv-time${hasUnread ? " conv-time-unread" : ""}`}>
                          {formatConvTime(conv.last_activity_at)}
                        </div>
                      </div>
                      <div className="conv-row-bottom">
                        <div className="conv-last-msg">{previewLabel}</div>
                        {hasUnread && (
                          <div className="conv-unread-badge">
                            {conv.unread_count > 99 ? "99+" : conv.unread_count}
                          </div>
                        )}
                      </div>
                    </div>
                  </button>
                </div>
              );
            })}
          </div>
      </aside>

      {/* ── Chat area ─────────────────────────────────────────────────────── */}
      {/* Group Info — renderizzata dentro chat-area (stessa slide-in usata per la chat)
          per evitare tutti i problemi di position:fixed su iOS Safari */}
      <main className={`chat-area${(!mobileShowChat && !showGroupInfo) ? " chat-area-mobile-hidden" : ""}`}>
        {showGroupInfo && groupInfoId ? (
          <GroupInfoPage
            groupId={groupInfoId}
            onBack={() => setShowGroupInfo(false)}
            onNavigate={onNavigate}
            onLeft={() => {
              setShowGroupInfo(false);
              setActiveConvId(null);
              void apiListConversations().then((r) => setConversations(r.items ?? []));
            }}
            contacts={conversations
              .filter((c) => c.type !== "group" && c.other_user)
              .map((c) => ({ username: c.other_user!.username, display_name: c.other_user!.display_name }))}
          />
        ) : !activeConvId ? (
          <div className="chat-empty">
            <div className="chat-empty-logo">α</div>
            <h2 className="chat-empty-title">Alpha Chat</h2>
            <p className="chat-empty-text">{t("chat.selectConversation")}</p>
            <div style={{ display: "flex", gap: 10 }}>
              <button className="chat-empty-btn" onClick={() => setShowInvite(true)}>
                {t("chat.invitePerson")}
              </button>
              <button className="chat-empty-btn" style={{ background: "var(--bg-3)", color: "var(--text-1)" }} onClick={() => setShowRedeem(true)}>
                {t("chat.redeemBtn")}
              </button>
            </div>
          </div>
        ) : (
          <>
            <ChatHeader
              otherUser={otherUser}
              isOnline={isOtherOnline}
              isGroup={activeConv?.type === "group"}
              groupName={activeConv?.name ?? undefined}
              onBack={closeChatMobile}
              onViewProfile={() => setShowContactProfile(true)}
              onSearchInChat={() => setShowChatSearch((v) => !v)}
              onCallAudio={() => {
                const conv = conversations.find((c) => c.conversation_id === activeConvId);
                const toId = conv?.other_user?.user_id;
                const name = conv?.other_user?.display_name ?? conv?.other_user?.username ?? "Utente";
                if (toId) {
                  // Sblocca iOS audio nel user gesture prima di initiateCall:
                  // unlockNotifAudio → sblocca ring, primeRemoteAudio → sblocca audio remoto WebRTC
                  // Fire-and-forget: non aspettiamo prime/unlock — initiateCall
                  // deve partire nel primo tick del gesture iOS (getUserMedia)
                  void primeRemoteAudio().catch(() => {});
                  void unlockNotifAudio().catch(() => {});
                  void initiateCall(toId, name, "audio");
                }
              }}
              onCallVideo={() => {
                const conv = conversations.find((c) => c.conversation_id === activeConvId);
                const toId = conv?.other_user?.user_id;
                const name = conv?.other_user?.display_name ?? conv?.other_user?.username ?? "Utente";
                if (toId) {
                  void primeRemoteAudio().catch(() => {});
                  void unlockNotifAudio().catch(() => {});
                  void initiateCall(toId, name, "video");
                }
              }}
              onBlockUser={handleBlockUser}
              onToast={showToast}
              isMuted={activeConvId ? mutedConvIds.has(activeConvId) : false}
              onSilenzia={toggleMuteConversation}
              onMediaGallery={() => setShowMediaGallery(true)}
              onClearChat={handleClearChat}
              trustStatus={trustStatus}
              onGroupInfo={() => {
                if (activeConvId) {
                  setGroupInfoId(activeConvId);
                  setShowGroupInfo(true);
                }
              }}
              onOpenSafetyNumber={() => setShowSafetyModal(true)}
              onSessionReset={async () => {
                if (!auth || !activeConvId) return;
                const conv = conversations.find((c) => c.conversation_id === activeConvId);
                const toId = conv?.other_user?.user_id;
                if (!toId) return;
                try {
                  await resetAndRebuildSession(auth.userId, auth.deviceId, toId);
                  showToast(t("chat.toastSessionRestored"));
                } catch {
                  showToast(t("chat.toastSessionError"));
                }
              }}
            />

            {/* ── Search bar (inline) ─────────────────────────── */}
            {showChatSearch && (
              <div className="chat-search-bar">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16" style={{ flexShrink: 0, opacity: 0.5 }}>
                  <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                </svg>
                <input
                  className="chat-search-input"
                  type="search"
                  placeholder="Cerca nei messaggi…"
                  value={chatSearchQuery}
                  onChange={(e) => setChatSearchQuery(e.target.value)}
                  autoFocus
                />
                <button
                  className="chat-search-close"
                  onClick={() => { setShowChatSearch(false); setChatSearchQuery(""); }}
                  aria-label="Chiudi ricerca"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="16" height="16">
                    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                  </svg>
                </button>
              </div>
            )}

            {/* ── Fase 5: key-change warning banner ─────────────── */}
            {trustStatus === "key_changed" && (
              <div className="key-change-banner">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16" style={{ flexShrink: 0 }}>
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                  <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
                </svg>
                <span>
                  La chiave di sicurezza di <strong>{otherUser?.display_name}</strong> è cambiata.
                  {" "}
                  <button className="key-change-link" onClick={() => setShowSafetyModal(true)}>
                    Verifica l'identità →
                  </button>
                </span>
              </div>
            )}

            <div
              className="messages"
              ref={messagesContainerRef}
              onScroll={handleScroll}
            >
              {loadingMsgs && <div className="msg-hint">Caricamento messaggi…</div>}

              {(() => {
                const q = chatSearchQuery.trim().toLowerCase();
                const filtered = q
                  ? messages.filter((m) => {
                      const text = getDisplayText(m);
                      return text.toLowerCase().includes(q);
                    })
                  : messages;

                if (q && filtered.length === 0) {
                  return <div className="msg-hint">Nessun messaggio trovato per "<strong>{chatSearchQuery}</strong>"</div>;
                }

                // Determina se ci sono messaggi non decifrabili (reinstall/cambio chiavi)
                const UNDECIPHERABLE = "[Messaggio non decifrabile]";
                const hasUndecipherable = filtered.some(
                  (m) => decryptedTexts.get(m.id) === UNDECIPHERABLE
                );
                let undecipherableBannerShown = false;

                return filtered.map((msg) => {
                  const isMine = msg.sender_id === auth?.userId;
                  const text = getDisplayText(msg);

                  // Banner "chiavi cambiate" — mostrato UNA sola volta prima del
                  // primo messaggio non decifrabile (es. dopo reinstallazione app).
                  const showKeyLostBanner =
                    hasUndecipherable &&
                    !undecipherableBannerShown &&
                    text === UNDECIPHERABLE &&
                    (() => { undecipherableBannerShown = true; return true; })();
                  const time = formatTime(msg.sent_at);
                  // Evidenzia la query nel testo
                  const renderText = () => {
                    if (!q) return <span className="msg-text">{text}</span>;
                    const idx = text.toLowerCase().indexOf(q);
                    if (idx === -1) return <span className="msg-text">{text}</span>;
                    return (
                      <span className="msg-text">
                        {text.slice(0, idx)}
                        <mark className="msg-search-highlight">{text.slice(idx, idx + q.length)}</mark>
                        {text.slice(idx + q.length)}
                      </span>
                    );
                  };
                  // ✓ = inviato, ✓✓ = letto dall'altro utente
                  const otherReadAt = activeConvId ? readReceipts[activeConvId] : null;
                  const isRead = isMine && otherReadAt != null && msg.sent_at <= otherReadAt;

                  // Messaggio a cui si risponde (lookup locale)
                  const repliedMsg = msg.reply_to_message_id
                    ? messages.find((m) => m.id === msg.reply_to_message_id)
                    : null;

                  // Media meta (audio, immagine, video, documento)
                  // Fase 3: usa il testo Signal-decifrato (contiene key AES per E2E)
                  const mediaMeta: MediaMeta | null = msg.message_type === "media"
                    ? decodeMediaMeta(getDisplayText(msg))
                    : null;
                  const voiceMeta    = mediaMeta?.type === "voice" ? mediaMeta : null;
                  const isMedia      = mediaMeta !== null;
                  const locationMeta: LocationMeta | null = msg.message_type === "text"
                    ? decodeLocationMeta(text)
                    : null;

                  return (
                    <div key={msg.id}>
                    {showKeyLostBanner && (
                      <div className="key-lost-banner">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18" style={{ flexShrink: 0, marginTop: 1 }}>
                          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                          <path d="M7 11V7a5 5 0 0 1 9.9-1"/>
                        </svg>
                        <div className="key-lost-banner-text">
                          <strong>Messaggi precedenti non recuperabili</strong>
                          <span>
                            Dopo la reinstallazione dell'app le chiavi crittografiche sono cambiate.
                            I messaggi cifrati con le vecchie chiavi non possono più essere decifrati.
                            I <strong>nuovi messaggi</strong> saranno visualizzati normalmente.
                          </span>
                        </div>
                      </div>
                    )}
                    <div
                      data-msg-id={msg.id}
                      className={`msg-row ${msg.message_type === "payment_notification" ? "system" : isMine ? "mine" : "theirs"}${destroyingIds.has(msg.id) ? " msg-dissolve" : ""}${selectMode && selectedMsgIds.has(msg.id) ? " msg-selected" : ""}`}
                      onContextMenu={(e) => { if (selectMode) { e.preventDefault(); return; } handleContextMenu(e, msg); }}
                      onTouchStart={(e) => handleMsgTouchStart(e, msg)}
                      onTouchMove={selectMode ? undefined : handleMsgTouchMove}
                      onTouchEnd={selectMode ? undefined : handleMsgTouchEnd}
                      onClick={selectMode ? () => toggleSelectMsg(msg.id) : undefined}
                    >
                      {/* Swipe-to-reply hint icon */}
                      {!selectMode && (
                        <div className="msg-swipe-hint" aria-hidden="true">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="14" height="14">
                            <polyline points="9 17 4 12 9 7"/><line x1="20" y1="12" x2="4" y2="12"/>
                          </svg>
                        </div>
                      )}
                      {/* Checkbox selezione */}
                      {selectMode && (
                        <div className={`msg-select-check ${selectedMsgIds.has(msg.id) ? "checked" : ""}`}>
                          {selectedMsgIds.has(msg.id) && (
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" width="12" height="12"><polyline points="20 6 9 17 4 12"/></svg>
                          )}
                        </div>
                      )}
                      {destroyingIds.has(msg.id) && <BurnParticles />}
                      <div className={`msg-bubble ${msg.message_type === "payment_notification" ? "payment-notification-bubble" : isMine ? "mine" : "theirs"} ${voiceMeta ? "voice-bubble" : ""} ${(msg.message_type === "payment" || msg.message_type === "usda_request" || msg.message_type === "usda_send") ? "payment-bubble" : ""} ${(msg.message_type === "sticker" || msg.message_type === "animated_sticker" || (decryptedTexts.get(msg.id) ?? "").startsWith(STICKER_MARKER) || (decryptedTexts.get(msg.id) ?? "").startsWith(ANIMATED_STICKER_MARKER)) ? "sticker-bubble" : ""} ${(msg.message_type === "text" || msg.message_type === "forward") && !voiceMeta && isEmojiOnly(decryptedTexts.get(msg.id) ?? "") ? "emoji-only-bubble" : ""}`}>
                        {/* Reply preview — cliccabile per scrollare al messaggio originale */}
                        {msg.reply_to_message_id && (
                          <div
                            className="msg-reply-preview"
                            role="button"
                            tabIndex={0}
                            onClick={(e) => { e.stopPropagation(); if (msg.reply_to_message_id) scrollToMessage(msg.reply_to_message_id); }}
                            onTouchEnd={(e) => {
                              e.stopPropagation();
                              e.preventDefault(); // blocca momentum iOS che potrebbe annullare scrollIntoView
                              if (msg.reply_to_message_id) scrollToMessage(msg.reply_to_message_id);
                            }}
                            onKeyDown={(e) => { if (e.key === "Enter" && msg.reply_to_message_id) scrollToMessage(msg.reply_to_message_id); }}
                          >
                            <span className="msg-reply-bar" />
                            <span className="msg-reply-text">
                              {repliedMsg
                                ? getReplyPreviewText(repliedMsg)
                                : <em className="msg-reply-destroyed">🛡 Messaggio non più disponibile</em>
                              }
                            </span>
                          </div>
                        )}
                        {/* Forwarded indicator */}
                        {msg.message_type === "forward" && (
                          <div className="msg-forwarded-label">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="11" height="11">
                              <polyline points="15 17 20 12 15 7"/>
                              <path d="M4 18v-2a4 4 0 0 1 4-4h12"/>
                            </svg>
                            Inoltrato
                          </div>
                        )}
                        {/* Pending media: upload in corso o fallito — mostra bolla con progresso */}
                        {msg.id.startsWith("pending-") && msg.message_type === "media" && mediaUploadStates.has(msg.id) ? (
                          <PendingMediaBubble state={mediaUploadStates.get(msg.id)!} />
                        ) : voiceMeta ? (
                          <VoiceMessage
                            mediaId={voiceMeta.media_id}
                            durationMs={voiceMeta.duration_ms}
                            waveform={voiceMeta.waveform}
                            isMine={isMine}
                            encryptedKey={voiceMeta.key}
                            encryptedIv={voiceMeta.iv}
                            mimeType={voiceMeta.mime_type}
                          />
                        ) : mediaMeta && (mediaMeta.type === "image" || mediaMeta.type === "video" || mediaMeta.type === "document") ? (
                          <MediaMessage
                            meta={mediaMeta}
                            isMine={isMine}
                            onView={(url, type, filename, mimeType) => setViewerMedia({ url, type, filename, mimeType })}
                          />
                        ) : msg.message_type === "media" && !mediaMeta ? (
                          /* FIX: media non decriptabile — placeholder invece di testo garbled */
                          <div className="msg-media-unavailable">
                            <span className="msg-media-unavailable-icon">🔒</span>
                            <span>Media non disponibile</span>
                          </div>
                        ) : locationMeta ? (
                          <LocationMessage
                            meta={locationMeta}
                            isMine={isMine}
                            onView={setLocationViewer}
                          />
                        ) : msg.message_type === "payment" ? (
                          // Guard: system_metadata può essere null se il backend
                          // ha scritto il messaggio ma non ancora i metadati.
                          (msg.system_metadata as unknown as ChatPaymentData)?.status
                            ? <ChatPaymentBubble
                                data={msg.system_metadata as unknown as ChatPaymentData}
                                isMine={isMine}
                                onRetryDeposit={(transferId) => {
                                  setShowSendPayment(false);
                                  setSendPrefill(null);
                                  setResumeTransferId(transferId);
                                }}
                                onLocalMeta={(transferId, patch) =>
                                  setMessages((prev) =>
                                    prev.map((m) => {
                                      const meta = (m.system_metadata as Record<string, unknown>) ?? {};
                                      if (meta.transfer_id !== transferId) return m;
                                      return { ...m, system_metadata: { ...meta, ...patch } };
                                    }),
                                  )
                                }
                              />
                            : null
                        ) : msg.message_type === "usda_send" ? (
                          <UsdaPaymentBubble
                            data={msg.system_metadata as unknown as UsdaPaymentData}
                            isMine={isMine}
                            onDetail={(id) => setUsdaDetailId(id)}
                          />
                        ) : msg.message_type === "usda_request" ? (
                          <UsdaRequestBubble
                            data={msg.system_metadata as unknown as UsdaPaymentData}
                            isMine={isMine}
                            myUserId={auth?.userId ?? ""}
                            onPay={(reqData) => {
                              // Apre il flusso interno pre-compilato: destinatario = il
                              // richiedente (in una chat 1:1 è l'altro utente), importo bloccato.
                              setSendPrefill({ amount: reqData.amount, requestPaymentId: reqData.payment_id });
                              setShowSendPayment(true);
                            }}
                            onDetail={(id) => setUsdaDetailId(id)}
                          />
                        ) : msg.message_type === "payment_notification" ? (
                          (() => {
                            const meta = (msg.system_metadata ?? {}) as Record<string, string>;
                            const amount = meta.amount ?? "?";
                            const symbol = meta.asset_symbol ?? "USDA";
                            const isISender = meta.sender_id === auth?.userId;
                            return (
                              <div className="payment-completed-notification">
                                <span className="pcn-icon">✅</span>
                                <div className="pcn-body">
                                  <span className="pcn-title">Pagamento completato</span>
                                  <span className="pcn-sub">
                                    {isISender
                                      ? `${amount} ${symbol} inviati con successo`
                                      : `Hai ricevuto ${amount} ${symbol}`}
                                  </span>
                                </div>
                              </div>
                            );
                          })()
                        ) : (decryptedTexts.get(msg.id) ?? "").startsWith(ANIMATED_STICKER_MARKER) ? (
                          /* Sticker animato Lottie v:2 — rilevato da ANIMATED_STICKER_MARKER */
                          <AnimatedStickerMessage body={decryptedTexts.get(msg.id) ?? ""} />
                        ) : (msg.message_type === "sticker" || (decryptedTexts.get(msg.id) ?? "").startsWith(STICKER_MARKER)) ? (
                          /* Sticker statico — rilevato da message_type O da STICKER_MARKER nel plaintext */
                          <StickerMessage body={decryptedTexts.get(msg.id) ?? ""} />
                        ) : (
                          renderText()
                        )}
                        <div className="msg-meta">
                          {msg.burn_after_read && (
                            <span className="msg-bar-badge" title="Burn After Read — si autodistrugge alla lettura">🔥</span>
                          )}
                          {msg.expires_at && (
                            <ExpiresCountdown expiresAt={msg.expires_at} />
                          )}
                          {msg.edited_at && <span className="msg-edited">Modificato</span>}
                          <span className="msg-time">{time}</span>
                          {isMine && (
                            <span className={`msg-status${isRead ? " msg-status-read" : ""}`} title={isRead ? "Letto" : "Inviato"}>
                              {isRead ? (
                                <svg viewBox="0 0 22 12" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="12">
                                  <polyline points="1 6 5 10 13 2"/>
                                  <polyline points="8 6 12 10 20 2"/>
                                </svg>
                              ) : (
                                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12">
                                  <polyline points="1 8 5 12 15 4"/>
                                </svg>
                              )}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    </div>
                  );
                });
              })()}

              {othersRecording.length > 0 ? (
                <div className="msg-row theirs">
                  <div className="msg-bubble theirs recording-bubble">
                    <span className="recording-dot" />
                    <span className="recording-text">{t("chat.recordingVoice")}</span>
                  </div>
                </div>
              ) : othersTyping.length > 0 && (
                <div className="msg-row theirs">
                  <div className="msg-bubble theirs typing-bubble">
                    <span className="typing-dot" />
                    <span className="typing-dot" />
                    <span className="typing-dot" />
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {!atBottom && (
              <button
                className="scroll-to-bottom"
                onClick={() => { setAtBottom(true); messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }); }}
                aria-label="Scorri in fondo"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="18" height="18">
                  <polyline points="6 9 12 15 18 9"/>
                </svg>
              </button>
            )}

            {sendError && (
              <div className="send-error-banner">
                ⚠ {sendError}
                <button className="send-error-close" onClick={() => setSendError(null)}>✕</button>
              </div>
            )}

            {/* Reply bar */}
            {replyTo && (
              <div className="reply-bar">
                <span className="reply-bar-icon">↩</span>
                <span className="reply-bar-text">
                  {getReplyPreviewText(replyTo)}
                </span>
                <button className="reply-bar-close" onClick={() => setReplyTo(null)} aria-label="Annulla risposta">✕</button>
              </div>
            )}

            {/* Edit bar */}
            {editingMessage && (
              <div className="reply-bar edit-bar">
                <span className="reply-bar-icon">✏</span>
                <span className="reply-bar-text">Modifica messaggio</span>
                <button className="reply-bar-close" onClick={() => { setEditingMessage(null); setInputText(""); }} aria-label="Annulla modifica">✕</button>
              </div>
            )}

            {/* ── Barra selezione multipla ──────────────────────────────────── */}
            {selectMode ? (
              <div className="select-bar">
                <button className="select-bar-cancel" onClick={exitSelectMode} aria-label="Annulla selezione">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="18" height="18"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
                <span className="select-bar-count">
                  {selectedMsgIds.size === 0 ? "Seleziona messaggi" : `${selectedMsgIds.size} selezionat${selectedMsgIds.size === 1 ? "o" : "i"}`}
                </span>
                <div className="select-bar-actions">
                  <button
                    className="select-bar-btn"
                    disabled={selectedMsgIds.size === 0}
                    onClick={() => { void handleShare(messages.filter((m) => selectedMsgIds.has(m.id))); }}
                    aria-label="Condividi"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
                    <span>Condividi</span>
                  </button>
                  <button
                    className="select-bar-btn"
                    disabled={selectedMsgIds.size !== 1}
                    onClick={() => {
                      const msg = messages.find((m) => selectedMsgIds.has(m.id));
                      if (msg) { setForwardingMessage(msg); exitSelectMode(); }
                    }}
                    aria-label="Inoltra"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20"><polyline points="15 17 20 12 15 7"/><path d="M4 18v-2a4 4 0 0 1 4-4h12"/></svg>
                    <span>Inoltra</span>
                  </button>
                  <button
                    className="select-bar-btn danger"
                    disabled={selectedMsgIds.size === 0}
                    onClick={() => void handleDeleteSelected()}
                    aria-label="Elimina"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M9 6V4h6v2"/></svg>
                    <span>Elimina</span>
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ position: "relative" }}>
                {uploadProgress !== null && (
                  <div className="upload-progress-wrap">
                    <div className="upload-progress-bar" style={{ width: `${uploadProgress}%` }} />
                  </div>
                )}
                <ChatInput
                  value={inputText}
                  onChange={handleInputChange}
                  onSubmit={handleSend}
                  onVoiceSend={(v) => void handleVoiceSend(v)}
                  onRecordingChange={handleRecordingChange}
                  onAttachMenu={() => setShowAttachSheet(true)}
                  onEmojiInsert={handleEmojiInsert}
                  onStickerSend={(p) => void handleStickerSend(p)}
                  onAnimatedStickerSend={(p) => void handleAnimatedStickerSend(p)}
                  disabled={sending}
                  burnAfterRead={burnAfterRead}
                  onToggleBurn={() => setBurnAfterRead((v) => !v)}
                />
              </div>
            )}
          </>
        )}
      </main>

      {/* ── Context menu ───────────────────────────────────────────────────── */}
      {contextMenu && (
        <div
          className="ctx-overlay"
          onClick={closeContextMenu}
          // iOS Safari NON emette sempre `click` sui <div> non interattivi →
          // il backdrop trasparente poteva restare montato sopra l'header e
          // bloccare il tasto indietro. touchend sul solo backdrop garantisce
          // la chiusura anche quando il click sintetico non parte.
          onTouchEnd={(e) => {
            if (e.target === e.currentTarget) { e.preventDefault(); closeContextMenu(); }
          }}
        >
          <div
            className="ctx-menu"
            style={{ top: contextMenu.y, left: contextMenu.x }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Seleziona */}
            <button className="ctx-item" onClick={ctxAction(() => {
              setSelectMode(true);
              setSelectedMsgIds(new Set([contextMenu.msg.id]));
              closeContextMenu();
            })}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><circle cx="12" cy="12" r="10"/><polyline points="9 12 11 14 15 10"/></svg>
              Seleziona
            </button>
            {/* Condividi — testo, forward, media (foto/video/documento) */}
            {(contextMenu.msg.message_type === "text" || contextMenu.msg.message_type === "forward")
              && getDisplayText(contextMenu.msg) && (
              <button className="ctx-item" onClick={ctxAction(() => { void handleShare([contextMenu.msg]); closeContextMenu(); })}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
                Condividi
              </button>
            )}
            {contextMenu.msg.message_type === "media" && (() => {
              const mm = decodeMediaMeta(getDisplayText(contextMenu.msg));
              if (!mm || mm.type === "voice") return null;
              return (
                <button className="ctx-item" onClick={ctxAction(() => { void handleShareMedia(contextMenu.msg); closeContextMenu(); })}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
                  Condividi
                </button>
              );
            })()}
            <button className="ctx-item" onClick={ctxAction(() => { setReplyTo(contextMenu.msg); closeContextMenu(); })}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg>
              Rispondi
            </button>
            {contextMenu.msg.sender_id === auth?.userId && (
              <button className="ctx-item" onClick={ctxAction(() => {
                setEditingMessage(contextMenu.msg);
                setInputText(getDisplayText(contextMenu.msg));
                closeContextMenu();
              })}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                Modifica
              </button>
            )}
            <button className="ctx-item" onClick={ctxAction(() => { setForwardingMessage(contextMenu.msg); closeContextMenu(); })}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><polyline points="15 17 20 12 15 7"/><path d="M4 18v-2a4 4 0 0 1 4-4h12"/></svg>
              {t("chat.forward")}
            </button>
            <button className="ctx-item" onClick={ctxAction(() => void handleDeleteForMe(contextMenu.msg))}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
              {t("chat.deleteForMe")}
            </button>
            {contextMenu.msg.sender_id === auth?.userId && (
              <button className="ctx-item danger" onClick={ctxAction(() => void handleDeleteForAll(contextMenu.msg))}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M9 6V4h6v2"/></svg>
                {t("chat.deleteForAll")}
              </button>
            )}
            {contextMenu.msg.sender_id === auth?.userId && (
              <button className="ctx-item secure-destroy" onClick={ctxAction(() => { setDestroyTarget(contextMenu.msg); closeContextMenu(); })}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                Secure Destroy
              </button>
            )}
            {/* Location actions — visibili solo su messaggi posizione */}
            {(() => {
              const lm = decodeLocationMeta(getDisplayText(contextMenu.msg));
              if (!lm) return null;
              const ua = navigator.userAgent;
              const mapsUrl = /iPhone|iPad|iPod/i.test(ua)
                ? `https://maps.apple.com/?ll=${lm.latitude},${lm.longitude}`
                : /Android/i.test(ua)
                  ? `https://maps.google.com/?q=${lm.latitude},${lm.longitude}`
                  : `https://www.openstreetmap.org/?mlat=${lm.latitude}&mlon=${lm.longitude}#map=15/${lm.latitude}/${lm.longitude}`;
              return (
                <>
                  <button className="ctx-item" onClick={ctxAction(() => { window.open(mapsUrl, "_blank", "noopener"); closeContextMenu(); })}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg>
                    Apri in Mappe
                  </button>
                  <button className="ctx-item" onClick={ctxAction(() => {
                    void navigator.clipboard.writeText(`${lm.latitude.toFixed(6)}, ${lm.longitude.toFixed(6)}`);
                    closeContextMenu();
                    showToast(t("chat.toastCoordsCopied"));
                  })}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                    Copia coordinate
                  </button>
                </>
              );
            })()}
          </div>
        </div>
      )}

      {/* ── Hidden file inputs per attach sheet ──────────────────────────────── */}
      <input
        ref={mediaInputRef}
        type="file"
        accept="image/*,video/*,audio/*"
        multiple
        style={{ display: "none" }}
        onChange={(e) => { if (e.target.files) handleFilePick(e.target.files); e.target.value = ""; }}
      />
      <input
        ref={docInputRef}
        type="file"
        accept="application/pdf,application/msword,application/vnd.openxmlformats-officedocument.*,text/plain"
        style={{ display: "none" }}
        onChange={(e) => { if (e.target.files) handleFilePick(e.target.files); e.target.value = ""; }}
      />

      {/* ── Attach sheet ──────────────────────────────────────────────────────── */}
      {showAttachSheet && (
        <div className="modal-backdrop" onClick={() => setShowAttachSheet(false)}>
          <div className="attach-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="attach-sheet-title">{t("chat.attachShare")}</div>
            <div className="attach-sheet-grid">
              <button
                className="attach-sheet-item"
                onClick={() => { setShowAttachSheet(false); setTimeout(() => mediaInputRef.current?.click(), 80); }}
              >
                <span className="attach-sheet-icon">📷</span>
                <span>{t("chat.attachPhoto")}</span>
              </button>
              <button
                className="attach-sheet-item"
                onClick={() => { setShowAttachSheet(false); setTimeout(() => docInputRef.current?.click(), 80); }}
              >
                <span className="attach-sheet-icon">📄</span>
                <span>{t("chat.attachDocument")}</span>
              </button>
              <button
                className="attach-sheet-item"
                onClick={() => { setShowAttachSheet(false); void handleLocationRequest(); }}
              >
                <span className="attach-sheet-icon">📍</span>
                <span>{t("chat.attachLocation")}</span>
              </button>
              {activeConv?.type !== "group" && (
                <>
                  <button
                    className="attach-sheet-item"
                    onClick={() => { setShowAttachSheet(false); setSendPrefill(null); setTimeout(() => setShowSendPayment(true), 80); }}
                  >
                    <span className="attach-sheet-icon">💰</span>
                    <span>{t("chat.attachSendUsda")}</span>
                  </button>
                  <button
                    className="attach-sheet-item"
                    onClick={() => { setShowAttachSheet(false); setTimeout(() => setShowRequestUsda(true), 80); }}
                  >
                    <span className="attach-sheet-icon">💸</span>
                    <span>{t("chat.attachRequestUsda")}</span>
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Forward modal ──────────────────────────────────────────────────── */}
      {forwardingMessage && (
        <div className="modal-backdrop" onClick={() => setForwardingMessage(null)}>
          <div className="forward-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="forward-sheet-header">
              <span className="forward-sheet-title">{t("chat.forwardTo")}</span>
              <button className="forward-sheet-close" onClick={() => setForwardingMessage(null)} aria-label="Chiudi">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="16" height="16">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>
            <div className="forward-sheet-preview">
              {(() => {
                const t2 = getDisplayText(forwardingMessage);
                const vm = decodeVoiceMeta(t2);
                if (vm) return t("chat.mediaVoiceForward");
                const mm = decodeMediaMeta(t2);
                if (mm?.type === "image")    return `📷 ${mm.filename ?? t("chat.attachPhoto")}`;
                if (mm?.type === "video")    return `🎥 ${mm.filename ?? "Video"}`;
                if (mm?.type === "document") return `📄 ${mm.filename ?? t("chat.mediaDocument")}`;
                const lm = decodeLocationMeta(t2);
                if (lm) return t("chat.mediaSharedLocation");
                return `"${t2.slice(0, 60)}${t2.length > 60 ? "…" : ""}"`;
              })()}
            </div>
            <div className="forward-conv-list">
              {conversations
                .filter((c) => c.conversation_id !== activeConvId)
                .map((conv) => {
                  const letter = (conv.other_user?.display_name?.[0] ?? conv.other_user?.username?.[0] ?? "?").toUpperCase();
                  return (
                    <button
                      key={conv.conversation_id}
                      className="forward-conv-item"
                      onClick={() => void handleForwardTo(conv.conversation_id)}
                    >
                      <div className="forward-conv-avatar">{letter}</div>
                      <div className="forward-conv-info">
                        <span className="forward-conv-name">{conv.other_user?.display_name ?? conv.other_user?.username ?? "Utente sconosciuto"}</span>
                        <span className="forward-conv-sub">@{conv.other_user?.username}</span>
                      </div>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16" style={{ opacity: 0.4 }}>
                        <polyline points="15 17 20 12 15 7"/><path d="M4 18v-2a4 4 0 0 1 4-4h12"/>
                      </svg>
                    </button>
                  );
                })}
              {conversations.filter((c) => c.conversation_id !== activeConvId).length === 0 && (
                <div className="forward-empty">{t("chat.noOtherContacts")}</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Secure Destroy dialog ──────────────────────────────────────────── */}
      {destroyTarget && (
        <div className="modal-backdrop sd-backdrop" onClick={() => !destroying && setDestroyTarget(null)}>
          <div className="sd-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="sd-dialog-icon">🛡</div>
            <h2 className="sd-dialog-title">Secure Destroy</h2>
            <p className="sd-dialog-body">
              Il messaggio verrà distrutto definitivamente.<br />
              L&apos;operazione è irreversibile.<br />
              Una volta completata non sarà più possibile recuperarlo.
            </p>
            <div className="sd-dialog-actions">
              <button
                className="sd-btn-cancel"
                onClick={() => setDestroyTarget(null)}
                disabled={destroying}
              >
                ANNULLA
              </button>
              <button
                className="sd-btn-confirm"
                onClick={() => void handleConfirmSecureDestroy()}
                disabled={destroying}
              >
                {destroying ? "…" : "SECURE DESTROY"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Toast ──────────────────────────────────────────────────────────── */}
      {toastMsg && (
        <div className="toast-msg">{toastMsg}</div>
      )}

      {/* ── Photo viewer contatti (da lista conversazioni) ─────────────────── */}
      {convPhotoModal && (
        <ProfilePhotoModal
          avatarUrl={convPhotoModal.avatarUrl}
          displayName={convPhotoModal.displayName}
          username={convPhotoModal.username}
          connected={convPhotoModal.isOnline}
          onClose={() => setConvPhotoModal(null)}
        />
      )}

      {/* ── Archivio action sheet (long press su conversazione) ────────────── */}
      {convActionSheet && (
        <div
          className="conv-action-overlay"
          onClick={() => setConvActionSheet(null)}
          onTouchEnd={(e) => {
            if (e.target === e.currentTarget) { e.preventDefault(); setConvActionSheet(null); }
          }}
        >
          <div className="conv-action-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="conv-action-title">{convActionSheet.displayName}</div>
            <button
              className="conv-action-btn"
              onClick={() => {
                archiveConversation(convActionSheet.convId);
                setConversations((prev) => prev.filter((c) => c.conversation_id !== convActionSheet.convId));
                if (activeConvId === convActionSheet.convId) {
                  setActiveConvId(null);
                  closeChatMobile();
                }
                setConvActionSheet(null);
                showToast(t("chat.toastArchived"));
              }}
            >
              📦 {t("chat.archiveConversation")}
            </button>
            <button
              className="conv-action-btn conv-action-danger"
              onClick={async () => {
                const cid = convActionSheet.convId;
                const isGrp = conversations.find((c) => c.conversation_id === cid)?.type === "group";
                setConvActionSheet(null);
                setConversations((prev) => prev.filter((c) => c.conversation_id !== cid));
                if (activeConvId === cid) { setActiveConvId(null); closeChatMobile(); }
                try {
                  if (isGrp) {
                    const { apiLeaveGroup } = await import("../lib/api");
                    await apiLeaveGroup(cid);
                  } else {
                    const { apiClearConversationMessages } = await import("../lib/api");
                    await apiClearConversationMessages(cid);
                  }
                } catch { /* silenzioso */ }
                showToast(isGrp ? t("chat.toastLeft") : t("chat.toastDeleted"));
              }}
            >
              🗑️ {conversations.find((c) => c.conversation_id === convActionSheet.convId)?.type === "group" ? "Lascia gruppo" : "Elimina conversazione"}
            </button>
            <button
              className="conv-action-btn conv-action-cancel"
              onClick={() => setConvActionSheet(null)}
            >
              {t("common.cancel")}
            </button>
          </div>
        </div>
      )}

      {/* ── Sprint 21: Crea gruppo ─────────────────────────────────────────── */}
      {showCreateGroup && (
        <CreateGroupModal
          onClose={() => setShowCreateGroup(false)}
          contacts={conversations
            .filter((c) => c.type !== "group" && c.other_user)
            .map((c) => ({ username: c.other_user!.username, displayName: c.other_user!.display_name }))}
          onCreated={(gid) => {
            setShowCreateGroup(false);
            void (async () => {
              const convs = await apiListConversations();
              setConversations(convs.items ?? []);
              const newConv = (convs.items ?? []).find((c) => c.conversation_id === gid);
              if (newConv) handleSelectConv(gid);
            })();
          }}
        />
      )}


      {/* ── Invite modals ──────────────────────────────────────────────────── */}
      {showInvite && (
        <InviteModal onClose={() => setShowInvite(false)} />
      )}

      {/* ── Device Manager (Fase 4) ─────────────────────────────────────────── */}
      {showDeviceManager && (
        <DeviceManager onClose={() => setShowDeviceManager(false)} />
      )}
      {showRedeem && (
        <RedeemModal
          onClose={() => setShowRedeem(false)}
          onSuccess={(convId) => void handleRedeemSuccess(convId)}
        />
      )}

      {/* ── Media Gallery ─────────────────────────────────────────────────── */}
      {/* ── Conferma cancellazione chat ─────────────────────────────────────── */}
      {showClearChatModal && (
        <ConfirmModal
          title="Cancella chat"
          message="Tutti i messaggi verranno eliminati definitivamente e in modo irreversibile per entrambi gli utenti. Questa operazione non può essere annullata."
          confirmLabel="Elimina definitivamente"
          danger
          loading={clearChatLoading}
          onConfirm={() => void confirmClearChat()}
          onCancel={() => setShowClearChatModal(false)}
        />
      )}

      {showMediaGallery && (
        <div className="modal-backdrop" onClick={() => setShowMediaGallery(false)}>
          <div className="media-gallery-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="media-gallery-header">
              <h3>Media condivisi</h3>
              <button className="contact-profile-close" onClick={() => setShowMediaGallery(false)} aria-label="Chiudi">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="18" height="18">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>
            {(() => {
              const mediaMessages = messages.filter((m) => m.message_type === "media");
              const items = mediaMessages
                .map((m) => ({ msg: m, meta: decodeMediaMeta(getDisplayText(m)) }))
                .filter((x) => x.meta && (x.meta.type === "image" || x.meta.type === "video" || x.meta.type === "document"));
              if (items.length === 0) {
                return (
                  <div className="media-gallery-empty">
                    <div style={{ fontSize: 40 }}>🖼️</div>
                    <p>Nessun media condiviso in questa chat</p>
                  </div>
                );
              }
              return (
                <div className="media-gallery-grid">
                  {items.map(({ msg, meta }) => {
                    const isImg = meta!.type === "image";
                    const isDoc = meta!.type === "document";
                    return (
                      <div
                        key={msg.id}
                        className={`media-gallery-item${isDoc ? " media-gallery-doc" : ""}`}
                        title={"filename" in meta! ? (meta as {filename:string}).filename : ""}
                      >
                        {isDoc ? (
                          <>
                            <div className="media-gallery-doc-icon">📄</div>
                            <div className="media-gallery-doc-name">{"filename" in meta! ? (meta as {filename:string}).filename : t("chat.mediaDocument")}</div>
                          </>
                        ) : (
                          <div className="media-gallery-thumb-placeholder">
                            {isImg ? "🖼️" : "🎬"}
                          </div>
                        )}
                        <div className="media-gallery-time">
                          {new Date(msg.sent_at).toLocaleDateString("it-IT", { day: "2-digit", month: "short" })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* ── Contact profile sheet ───────────────────────────────────────────── */}
      {showContactProfile && otherUser && (
        <div className="modal-backdrop" onClick={() => setShowContactProfile(false)}>
          <div className="contact-profile-sheet" onClick={(e) => e.stopPropagation()}>
            <button
              className="contact-profile-close"
              onClick={() => setShowContactProfile(false)}
              aria-label="Chiudi"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="18" height="18">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>

            <div className="contact-profile-avatar">
              {otherUser.display_name[0]?.toUpperCase() ?? "?"}
            </div>
            <h2 className="contact-profile-name">{otherUser.display_name}</h2>
            <p className="contact-profile-username">@{otherUser.username}</p>
            <div className={`contact-profile-status ${isOtherOnline ? "online" : "offline"}`}>
              {isOtherOnline ? "● Online" : "○ Offline"}
            </div>

            <div className="contact-profile-info">
              <div className="contact-profile-row">
                <span className="contact-profile-row-label">Username</span>
                <span className="contact-profile-row-value">@{otherUser.username}</span>
              </div>
              <div className="contact-profile-row">
                <span className="contact-profile-row-label">Crittografia</span>
                <span className="contact-profile-row-value" style={{ color: "#4ade80" }}>
                  ✓ E2E attiva
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Media viewer full-screen ──────────────────────────────────────── */}
      {viewerMedia && (
        <MediaViewer
          blobUrl={viewerMedia.url}
          type={viewerMedia.type}
          filename={viewerMedia.filename}
          mimeType={viewerMedia.mimeType}
          onClose={() => setViewerMedia(null)}
        />
      )}

      {/* ── Location confirm modal ─────────────────────────────────────────── */}
      {locationModal !== null && (
        <div
          className="loc-confirm-backdrop"
          onClick={() => locationModal !== "acquiring" && setLocationModal(null)}
        >
          <div className="loc-confirm-sheet" onClick={(e) => e.stopPropagation()}>
            {locationModal === "acquiring" && (
              <>
                <div className="loc-confirm-spinner" />
                <p className="loc-confirm-status">📍 Recupero posizione…</p>
                <button className="loc-confirm-cancel" onClick={() => setLocationModal(null)}>Annulla</button>
              </>
            )}
            {locationModal === "ready" && locationData && (() => {
              const previewUrl =
                `https://www.openstreetmap.org/export/embed.html` +
                `?bbox=${locationData.lon - 0.003},${locationData.lat - 0.003},` +
                `${locationData.lon + 0.003},${locationData.lat + 0.003}` +
                `&layer=mapnik&marker=${locationData.lat},${locationData.lon}`;
              return (
                <>
                  <iframe
                    src={previewUrl}
                    className="loc-confirm-iframe"
                    title="Anteprima mappa"
                    referrerPolicy="no-referrer"
                    loading="lazy"
                  />
                  <p className="loc-confirm-status">{t("chat.locationReady")}</p>
                  <p className="loc-confirm-coords">
                    {locationData.lat.toFixed(5)}° N, {locationData.lon.toFixed(5)}° E
                    {locationData.accuracy > 0 && ` · ±${Math.round(locationData.accuracy)} m`}
                  </p>
                  <div className="loc-confirm-actions">
                    <button className="loc-confirm-cancel" onClick={() => setLocationModal(null)}>Annulla</button>
                    <button className="loc-confirm-send"   onClick={() => void handleSendLocation()}>✓ Invia posizione</button>
                  </div>
                </>
              );
            })()}
            {locationModal === "error" && (
              <>
                <p className="loc-confirm-status loc-confirm-error">⚠ {locationError}</p>
                <div className="loc-confirm-actions">
                  <button className="loc-confirm-cancel" onClick={() => setLocationModal(null)}>Chiudi</button>
                  <button className="loc-confirm-send"   onClick={() => { setLocationModal(null); setTimeout(handleLocationRequest, 100); }}>Riprova</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── LocationViewer ────────────────────────────────────────────────── */}
      {locationViewer && (
        <LocationViewer
          meta={locationViewer}
          onClose={() => setLocationViewer(null)}
        />
      )}

      {/* ── USDA Payments ─────────────────────────────────────────────────── */}

      {/* Nuovo Payment Engine — entry point principale dal pulsante "Invia USDA" */}
      {showSendPayment && activeConv && auth && activeConv.type !== "group" && (
        <SendPaymentSheet
          conversationId={activeConvId ?? ""}
          toUserId={activeConv.other_user?.user_id ?? ""}
          toName={activeConv.other_user?.display_name ?? activeConv.other_user?.username ?? "Utente"}
          initialAmount={sendPrefill?.amount}
          requestPaymentId={sendPrefill?.requestPaymentId}
          onClose={() => { setShowSendPayment(false); setSendPrefill(null); }}
          onSent={() => { setShowSendPayment(false); setSendPrefill(null); }}
        />
      )}

      {/* RETRY FIRMA — riapre la firma per un transfer esistente in awaiting_deposit */}
      {resumeTransferId && activeConv && auth && activeConv.type !== "group" && (
        <SendPaymentSheet
          conversationId={activeConvId ?? ""}
          toUserId={activeConv.other_user?.user_id ?? ""}
          toName={activeConv.other_user?.display_name ?? activeConv.other_user?.username ?? "Utente"}
          resumeTransferId={resumeTransferId}
          onClose={() => setResumeTransferId(null)}
          onSent={() => setResumeTransferId(null)}
        />
      )}

      {/* Legacy SendUsdaSheet — mantenuto per compatibilità, non più collegato al pulsante */}
      {showSendUsda && activeConv && auth && activeConv.type !== "group" && (
        <SendUsdaSheet
          conversationId={activeConvId ?? ""}
          toUserId={activeConv.other_user?.user_id ?? ""}
          toName={activeConv.other_user?.display_name ?? activeConv.other_user?.username ?? "Utente"}
          onClose={() => setShowSendUsda(false)}
          onSent={() => setShowSendUsda(false)}
          onInvite={(inviteText) => { setShowSendUsda(false); void sendProgrammatic(inviteText); }}
        />
      )}
      {showRequestUsda && activeConv && auth && activeConv.type !== "group" && (
        <RequestUsdaSheet
          conversationId={activeConvId ?? ""}
          toUserId={activeConv.other_user?.user_id ?? ""}
          toName={activeConv.other_user?.display_name ?? activeConv.other_user?.username ?? "Utente"}
          onClose={() => setShowRequestUsda(false)}
          onRequested={() => setShowRequestUsda(false)}
        />
      )}
      {usdaDetailId && (
        <UsdaPaymentDetail
          paymentId={usdaDetailId}
          onClose={() => setUsdaDetailId(null)}
        />
      )}

      {/* ── Fase 5: Safety Number Modal ─────────────────────────────────── */}
      {showSafetyModal && auth && otherUser && (
        <SafetyNumberModal
          myUsername={auth.username}
          theirUsername={otherUser.username}
          theirDisplayName={otherUser.display_name}
          myIKBase64={myIKBase64}
          theirIKBase64={theirIKBase64}
          trustStatus={(trustStatus as TrustStatus) ?? "unverified"}
          onMarkVerified={async () => {
            if (!auth || !otherUser) return;
            await markVerified(auth.userId, otherUser.user_id ?? (activeConv?.other_user?.user_id ?? ""));
            setTrustStatus("verified");
            setShowSafetyModal(false);
          }}
          onAcceptKeyChange={trustStatus === "key_changed" ? async () => {
            if (!auth || !otherUser) return;
            await acceptKeyChange(auth.userId, otherUser.user_id ?? (activeConv?.other_user?.user_id ?? ""));
            setTrustStatus("unverified");
            setShowSafetyModal(false);
          } : undefined}
          onClose={() => setShowSafetyModal(false)}
        />
      )}
    </div>
  );
}
