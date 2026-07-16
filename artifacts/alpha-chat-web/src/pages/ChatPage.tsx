import { useState, useEffect, useRef, useCallback } from "react";
import { useAuth } from "../contexts/AuthContext";
import { useCall } from "../contexts/CallContext";
import { useWebSocket, type WsEvent } from "../hooks/useWebSocket";
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
  decodeMessage,
  decodeVoiceMeta,
  decodeMediaMeta,
  AuthExpiredError,
  type ConversationItem,
  type MessageItem,
  type MediaMeta,
} from "../lib/api";
import {
  signalEncrypt,
  signalDecrypt,
  safeDecodeForPreview,
  encryptMediaBlob,
  encryptBlobWithKey,
  signalEncryptMulti,
  signalDecryptFromDeviceCiphertexts,
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
import VoiceRecorder, { type VoiceBlob } from "../components/VoiceRecorder";
import { attachAudioUnlockListener, playNotifSound, unlockNotifAudio } from "../lib/notifSound";
import { primeRemoteAudio } from "../lib/remoteAudio";
import VoiceMessage from "../components/VoiceMessage";
import MediaMessage from "../components/MediaMessage";
import MediaViewer from "../components/MediaViewer";
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
  type TrustStatus,
} from "../lib/signal";
import { arrayBufferToBase64 } from "@workspace/libsignal-ts";
import { resetAndRebuildSession } from "../lib/signal/signal-session";
import ConfirmModal from "../components/ConfirmModal";
import { apiClearConversationMessages } from "../lib/api";
import { archiveConversation } from "./ArchivioPage";

interface Props {
  onNavigate: (view: AppView) => void;
}

// ── Helpers ─────────────────────────────────────────────────────────────────
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
}: {
  otherUser: { display_name: string; username: string } | null | undefined;
  isOnline: boolean;
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
}) {
  const [menuOpen, setMenuOpen] = useState(false);
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
    { label: "Visualizza profilo", icon: "👤", onClick: () => { closeMenu(); onViewProfile(); } },
    { label: "Media condivisi", icon: "🖼️", onClick: () => { closeMenu(); onMediaGallery(); } },
    { label: "Cerca nella chat", icon: "🔍", onClick: () => { closeMenu(); onSearchInChat(); } },
    { label: isMuted ? "Riattiva notifiche" : "Silenzia", icon: isMuted ? "🔔" : "🔕", onClick: () => { closeMenu(); onSilenzia(); } },
    { label: "Resetta sessione E2E", icon: "🔄", onClick: () => { closeMenu(); onSessionReset?.(); } },
    { label: "Blocca utente", icon: "🚫", danger: true, onClick: () => { closeMenu(); onBlockUser(); } },
    { label: "Cancella chat", icon: "🗑️", danger: true, onClick: () => { closeMenu(); onClearChat(); } },
  ];

  const trustBadge = trustStatus && trustStatus !== "loading"
    ? { verified: "🟢", unverified: "🟡", key_changed: "🔴" }[trustStatus]
    : null;

  return (
    <div className="chat-header">
      <button className="chat-back-btn" onClick={onBack} aria-label="Torna alla lista">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
          <polyline points="15 18 9 12 15 6" />
        </svg>
      </button>

      <div className="avatar avatar-md">
        {otherUser?.display_name[0]?.toUpperCase() ?? "?"}
      </div>

      <div className="chat-header-info">
        <div className="chat-header-name">{otherUser?.display_name ?? "Chat"}</div>
        <div className="chat-header-status-row">
          <div className={`chat-header-status ${isOnline ? "online" : "offline"}`}>
            {isOnline ? "● Online" : "○ Offline"}
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
  onVoiceStart,
  onAttach,
  disabled,
  burnAfterRead,
  onToggleBurn,
}: {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onSubmit: (e: React.FormEvent) => void;
  onVoiceStart: () => void;
  onAttach?: (files: FileList) => void;
  disabled: boolean;
  burnAfterRead?: boolean;
  onToggleBurn?: () => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const localFileRef = useRef<HTMLInputElement>(null);
  const hasText = value.trim().length > 0;

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
        aria-label="Allega file"
        title="Allega foto, video o documento"
        disabled={disabled}
        onClick={() => localFileRef.current?.click()}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="22" height="22">
          <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
        </svg>
      </button>

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
        <button type="button" className="send-btn mic-btn" onClick={onVoiceStart} disabled={disabled} aria-label="Messaggio vocale">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
            <path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>
          </svg>
        </button>
      )}
    </form>
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
      label: "Profilo",
      view: "profile",
      icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>,
    },
    {
      label: "Privacy e Sicurezza",
      view: "privacy",
      icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>,
    },
    {
      label: "Dispositivi",
      view: "devices",
      icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16"><rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>,
    },
    {
      label: "Impostazioni",
      view: "settings",
      icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>,
    },
    {
      label: "Archivio",
      view: "archive",
      icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/></svg>,
    },
    {
      label: "🛡️ Perché Alpha Chat",
      view: "security-center",
      icon: null,
    },
  ];

  return (
    <div className="user-menu-wrapper" ref={ref}>
      <button
        className="avatar-menu-btn"
        onClick={() => setOpen((v) => !v)}
        aria-label="Menu utente"
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
              {connected ? "● Online" : "○ Offline"}
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
              {loggingOut ? "Uscita…" : "Esci"}
            </button>
            <button className="user-menu-item danger" onClick={onLogoutAll} disabled={loggingOut}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/><line x1="5" y1="8" x2="5" y2="16" strokeDasharray="2 2"/></svg>
              Esci da tutti i dispositivi
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main ChatPage ────────────────────────────────────────────────────────────
export default function ChatPage({ onNavigate }: Props) {
  const { auth, logout, logoutAll } = useAuth();
  const { connected, on, send: wsSend, sendTypingStart, sendTypingStop } = useWebSocket(auth?.accessToken ?? null);
  const { initiateCall, setWsSend, handleWsCallEvent } = useCall();

  // Registra il sender WS nel CallContext in modo che le chiamate possano segnalare
  useEffect(() => { setWsSend(wsSend); }, [wsSend, setWsSend]);

  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [inputText, setInputText] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [loadingConvs, setLoadingConvs] = useState(true);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [mobileShowChat, setMobileShowChat] = useState(false);
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
  // toast
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  // secure destroy
  const [destroyTarget, setDestroyTarget] = useState<MessageItem | null>(null);
  const [destroyingIds, setDestroyingIds] = useState<Set<string>>(new Set());
  const [destroying, setDestroying] = useState(false);
  // voice recorder
  const [showVoiceRecorder, setShowVoiceRecorder] = useState(false);
  const [typingUsers, setTypingUsers] = useState<Record<string, Set<string>>>({});
  const [onlineUsers, setOnlineUsers] = useState<Set<string>>(new Set());
  const [atBottom, setAtBottom] = useState(true);
  // Sprint 21 — Gruppi
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [showGroupInfo, setShowGroupInfo]     = useState(false);
  const [groupInfoId, setGroupInfoId]         = useState<string | null>(null);

  // Archivio — long press su conversazione
  const [convActionSheet, setConvActionSheet] = useState<{ convId: string; displayName: string } | null>(null);
  const convLongPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [viewerMedia, setViewerMedia] = useState<{ url: string; type: "image" | "video" } | null>(null);
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
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ctxOpenedAtRef = useRef<number>(0); // ghost-click guard
  const fileInputRef = useRef<HTMLInputElement>(null);

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
      // Fallback: plaintext non disponibile (messaggio precedente al fix)
      setDecryptedTexts((prev) =>
        new Map(prev).set(
          msg.id,
          msg.message_type === "media" ? "" : "[messaggio precedente]",
        ),
      );
      return;
    }

    // Messaggio ricevuto
    try {
      let text: string;
      // Sprint 21: gruppo — cerca ciphertext con device_id === userId (fan-out)
      const isGroupMsg = conversations.find((c) => c.conversation_id === activeConvId)?.type === "group";
      if (isGroupMsg && msg.device_ciphertexts && msg.device_ciphertexts.length > 0) {
        const myEntry = msg.device_ciphertexts.find((d) => d.device_id === auth.userId);
        if (myEntry) {
          try {
            const found = await signalDecryptFromDeviceCiphertexts(
              auth.userId, auth.deviceId, msg.sender_id,
              [{ ...myEntry, device_id: auth.deviceId }],
            );
            if (found !== null) {
              setDecryptedTexts((prev) => new Map(prev).set(msg.id, found));
              return;
            }
          } catch { /* fallthrough */ }
        }
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
      // Fase 4: cache metadata media per reload futuro
      if (msg.message_type === "media") {
        void cacheDecryptedMeta(msg.id, text);
      }
    } catch {
      if (msg.message_type === "media") {
        // Fase 4: controlla la cache prima del fallback legacy
        const cached = await getMetaByMessageId(msg.id);
        if (cached) {
          setDecryptedTexts((prev) => new Map(prev).set(msg.id, cached));
          return;
        }
        // FIX: non usare msg.ciphertext come fallback — produce base64 grezzo nel bubble
        // Lasciare stringa vuota → mediaMeta=null → UI "media non disponibile"
        setDecryptedTexts((prev) => new Map(prev).set(msg.id, ""));
      } else {
        setDecryptedTexts((prev) =>
          new Map(prev).set(msg.id, "[Messaggio non decifrabile]"),
        );
      }
    }
  }

  /** Decifra un batch di messaggi (caricamento conversazione) */
  async function decryptBatch(msgs: MessageItem[]): Promise<void> {
    if (!auth) return;
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
        setMessages(msgs);
        // Decifra tutti i messaggi in background (Signal + legacy)
        void decryptBatch(msgs);
      })
      .catch(() => {})
      .finally(() => setLoadingMsgs(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConvId]);

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

  // ── Auto-scroll only when at bottom ────────────────────────────────────
  useEffect(() => {
    if (atBottom) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, atBottom]);

  function handleScroll() {
    const el = messagesContainerRef.current;
    if (!el) return;
    const threshold = 60;
    setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < threshold);
  }

  // ── WebSocket events ────────────────────────────────────────────────────
  useEffect(() => {
    return on((event: WsEvent) => {
      switch (event.type) {
        case "message.new": {
          const msg = event.payload as unknown as MessageItem & { conversation_id: string };
          if (!mutedConvIds.has(msg.conversation_id)) void playNotifSound('received');
          if (msg.conversation_id === activeConvId) {
            setMessages((prev) => {
              if (prev.some((m) => m.id === msg.id)) return prev;
              return [...prev, msg];
            });
            // Decifra il messaggio appena arrivato
            void decryptSingleMsg(msg);
            // BAR: se il messaggio è burn_after_read, informa il server che lo
            // abbiamo "letto" (anche se la conv era già aperta) → avvia il timer 10s
            if ((msg as MessageItem & { burn_after_read?: boolean }).burn_after_read) {
              void apiMarkRead(activeConvId).catch(() => {});
            }
          }
          setConversations((prev) =>
            prev.map((c) =>
              c.conversation_id === msg.conversation_id
                ? { ...c, last_activity_at: msg.server_received_at }
                : c,
            ).sort((a, b) => b.last_activity_at.localeCompare(a.last_activity_at)),
          );
          break;
        }
        case "typing.start": {
          const { user_id, conversation_id } = event.payload;
          setTypingUsers((prev) => {
            const copy = { ...prev };
            copy[conversation_id] = new Set([...(copy[conversation_id] ?? []), user_id]);
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
          break;
        }
        case "presence.online":
          setOnlineUsers((prev) => new Set(prev).add(event.payload.user_id));
          break;
        case "presence.offline": {
          const id = event.payload.user_id;
          setOnlineUsers((prev) => { const s = new Set(prev); s.delete(id); return s; });
          break;
        }
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
            // avvia animazione dissoluzione, poi rimuovi dopo 600ms
            setDestroyingIds((prev) => { const s = new Set(prev); s.add(message_id); return s; });
            setTimeout(() => {
              setMessages((prev) => prev.filter((m) => m.id !== message_id));
              setDestroyingIds((prev) => { const s = new Set(prev); s.delete(message_id); return s; });
              // Fase 3: rimuove la chiave AES dalla memoria (Secure Destroy completo)
              setDecryptedTexts((prev) => { const next = new Map(prev); next.delete(message_id); return next; });
            }, 600);
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

        // Sprint 18 — Phoenix Protocol
        case "phoenix:lock": {
          void logout();
          break;
        }
        case "phoenix:destroy": {
          localStorage.clear();
          sessionStorage.clear();
          void logout();
          break;
        }

        // Sprint 23 — WebRTC call signaling (routing verso CallContext)
        case "call.incoming":
        case "call.answered":
        case "call.ice_candidate":
        case "call.rejected":
        case "call.ended":
        case "call.busy":
          handleWsCallEvent(event.type, event.payload as Record<string, unknown>);
          break;
      }
    });
  }, [on, activeConvId, handleWsCallEvent]);

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
          try {
            const bundle = await apiGetKeyBundle(member.user_id);
            // signalEncryptMulti con un solo bundle → usa device_id del bundle come chiave
            const { deviceCiphertexts: dcs } = await signalEncryptMulti(
              auth.userId, auth.deviceId, member.user_id, text, [bundle],
            );
            if (dcs[0]) {
              // Sovrascrivi device_id con userId per il fan-out di gruppo
              deviceCiphertexts.push({ device_id: member.user_id, body: dcs[0].body, type: dcs[0].type });
            }
          } catch { /* un membro irraggiungibile non blocca il gruppo */ }
        }),
      );
      // body/type primario vuoto — in un gruppo non c'è un "destinatario principale"
      return { body: "", type: 1, deviceCiphertexts };
    } catch { return undefined; }
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
        setMessages((prev) => prev.map((m) =>
          m.id === updated.id
            ? { ...m, ciphertext: updated.ciphertext, edited_at: updated.edited_at }
            : m,
        ));
        setEditingMessage(null);
      } else {
        // Invio normale o risposta — cifra con Signal
        const clientMessageId = crypto.randomUUID();
        // Salva il plaintext prima di cifrare (per display dei propri messaggi)
        sentCacheRef.current.set(clientMessageId, text);
        // FIX: persiste il plaintext in IDB — sopravvive al reload
        void cacheOwnText(clientMessageId, text);
        const signal = await encryptForActive(text);
        await apiSendMessage(activeConvId, text, {
          replyToMessageId: replyTo?.id,
          burnAfterRead,
          signal,
          clientMessageId,
          deviceCiphertexts: signal?.deviceCiphertexts,
        });
        void playNotifSound('sent');   // suono invio messaggio
        setReplyTo(null);
        if (burnAfterRead) setBurnAfterRead(false); // reset dopo invio BAR
        // Fase 5: dopo ogni invio, rileggi il trust status dal IDB locale.
        // Se ensureSession ha rilevato un cambio di Identity Key durante la cifratura,
        // updateTrustFromBundle avrà già aggiornato il trust IDB → aggiorna la UI.
        const theirId = conversations.find((c) => c.conversation_id === activeConvId)?.other_user?.user_id;
        if (theirId) void refreshTrust(theirId);
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "Errore invio";
      if (editingMessage && (errMsg.includes("EDIT_EXPIRED") || errMsg.includes("EDIT_FORBIDDEN"))) {
        setEditingMessage(null);
        setInputText("");
        setSendError("Impossibile modificare: tempo scaduto (15 min)");
      } else {
        setSendError(errMsg);
        setInputText(text);
      }
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

  function closeContextMenu() { setContextMenu(null); }

  function showToast(text: string) {
    setToastMsg(text);
    setTimeout(() => setToastMsg(null), 2500);
  }

  async function handleForwardTo(targetConvId: string) {
    if (!forwardingMessage) return;
    const text = getDisplayText(forwardingMessage);
    setForwardingMessage(null);
    const targetConv = conversations.find((c) => c.conversation_id === targetConvId);
    const targetRecipientId = targetConv?.other_user?.user_id;
    try {
      const clientMessageId = crypto.randomUUID();
      if (text) sentCacheRef.current.set(clientMessageId, text);
      let signal: { body: string; type: number } | undefined;
      if (auth && targetRecipientId) {
        try { signal = await signalEncrypt(auth.userId, auth.deviceId, targetRecipientId, text); }
        catch { /* fallback legacy */ }
      }
      await apiSendMessage(targetConvId, text, { signal, clientMessageId });
      showToast("Messaggio inoltrato ✓");
    } catch {
      showToast("Errore durante l'inoltro");
    }
  }

  async function handleVoiceSend(voice: VoiceBlob) {
    setShowVoiceRecorder(false);
    if (!activeConvId || !auth) return;
    setSending(true);
    try {
      // Fase 3: cifra il blob audio con AES-256-GCM prima dell'upload
      const { encryptedBlob, keyBase64, ivBase64 } = await encryptMediaBlob(voice.blob);
      const media = await apiUploadEncryptedMedia(activeConvId, encryptedBlob, voice.blob.type || "audio/webm", {
        durationMs: voice.durationMs,
        waveform:   voice.waveform,
      });

      // Metadata JSON con chiave AES — verrà Signal-cifrato (server non vede la chiave)
      // mime_type incluso per compatibilità cross-platform (iOS→Android e viceversa)
      const metaJson = JSON.stringify({
        e2e:        true,
        type:       "voice",
        media_id:   media.media_id,
        key:        keyBase64,
        iv:         ivBase64,
        duration_ms: media.duration_ms ?? voice.durationMs,
        waveform:   media.waveform.length > 0 ? media.waveform : voice.waveform,
        mime_type:  voice.blob.type || "audio/webm",
      });

      const clientMessageId = crypto.randomUUID();
      sentCacheRef.current.set(clientMessageId, metaJson);
      void cacheOwnMessageMeta(clientMessageId, metaJson);
      const signal = await encryptForActive(metaJson);
      await apiSendMediaMessage(
        activeConvId, media.media_id, signal, clientMessageId, metaJson,
        signal?.deviceCiphertexts,
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Errore invio vocale");
    } finally {
      setSending(false);
    }
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
    const file = files[0];

    // Limiti client-side (backend li rifiuta comunque)
    const LIMIT: Record<string, number> = { image: 10, video: 15, audio: 5, document: 10 };
    const categ = file.type.startsWith("image/") ? "image"
                : file.type.startsWith("video/") ? "video"
                : file.type.startsWith("audio/") ? "audio"
                : "document";
    const maxBytes = (LIMIT[categ] ?? 10) * 1024 * 1024;
    if (file.size > maxBytes) {
      setSendError(`File troppo grande (max ${maxBytes / 1024 / 1024} MB per ${categ})`);
      return;
    }

    setSending(true);
    setUploadProgress(0);
    try {
      // Comprimi immagini prima di cifrare (riduce freeze su iOS con foto grandi)
      const blobToEncrypt: File | Blob =
        file.type.startsWith("image/") && file.size > 300_000
          ? await compressImage(file)
          : file;
      // Fase 3: cifra il file con AES-256-GCM prima dell'upload
      const { encryptedBlob, keyBase64, ivBase64 } = await encryptMediaBlob(blobToEncrypt);
      setUploadProgress(10);

      const media = await apiUploadEncryptedMedia(activeConvId, encryptedBlob, file.type, {
        originalFilename: file.name,
        onProgress: (pct) => setUploadProgress(Math.round(10 + pct * 0.8)),
      });
      setUploadProgress(90);

      const mtype = file.type.startsWith("image/")  ? "image"
                  : file.type.startsWith("video/")   ? "video"
                  : file.type.startsWith("audio/")   ? "voice"
                  : "document";

      // Thumbnail: nessun re-processing aggiuntivo — la Fase 4 è rimandata.
      // FIX: il vecchio codice ri-cifrava l'intero file originale (8MB) e
      // usava String.fromCharCode(...spread) O(n²) causando freeze totale
      // su iOS Safari. Il risultato veniva poi scartato → rimosso.
      const thumbIvBase64: string | undefined = undefined;

      const metaJson = JSON.stringify({
        e2e:       true,
        type:      mtype,
        media_id:  media.media_id,
        key:       keyBase64,
        iv:        ivBase64,
        mime_type: file.type,
        filename:  file.name,
        size:      file.size,
        ...(thumbIvBase64                 ? { thumb_iv: thumbIvBase64 }      : {}),
        ...(media.duration_ms != null     ? { duration_ms: media.duration_ms }: {}),
        ...(media.waveform.length > 0     ? { waveform: media.waveform }      : {}),
      });

      const clientMessageId = crypto.randomUUID();
      sentCacheRef.current.set(clientMessageId, metaJson);
      void cacheOwnMessageMeta(clientMessageId, metaJson);
      const signal = await encryptForActive(metaJson);
      await apiSendMediaMessage(
        activeConvId, media.media_id, signal, clientMessageId, metaJson,
        signal?.deviceCiphertexts,
      );
      setUploadProgress(100);
    } catch (err) {
      setSendError(err instanceof Error ? err.message : "Errore upload file");
    } finally {
      setSending(false);
      setUploadProgress(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
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
      showToast("🛡 Secure Destroy completato");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Errore Secure Destroy");
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
      showToast(muted ? "🔕 Conversazione silenziata" : "🔔 Notifiche riattivate");
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
      showToast("Chat cancellata definitivamente");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Errore durante la cancellazione");
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
      showToast(`🚫 ${name} bloccato`);
    } catch {
      showToast("Errore durante il blocco dell'utente");
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

  async function handleRedeemSuccess(conversationId: string) {
    setShowRedeem(false);
    await loadConversations();
    setActiveConvId(conversationId);
    setMobileShowChat(true);
  }

  function handleSelectConv(convId: string) {
    setActiveConvId(convId);
    setMobileShowChat(true);
    setAtBottom(true);
    setShowChatSearch(false);
    setChatSearchQuery("");
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
              {connected ? "● Online" : "○ Offline"}
            </div>
          </div>
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
              Ho ricevuto un codice invito
              <span className="redeem-banner-arrow">›</span>
            </button>

            {loadingConvs && <div className="conv-hint">Caricamento…</div>}
            {!loadingConvs && conversations.length === 0 && (
              <div className="conv-hint conv-hint-empty">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="40" height="40" style={{ opacity: 0.3, marginBottom: 12 }}>
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                </svg>
                Nessuna conversazione ancora.<br />
                <span style={{ fontSize: 13 }}>Premi <strong>Invita persona</strong> →</span>
              </div>
            )}
            {conversations.map((conv) => {
              const other     = conv.other_user;
              const isGroup   = conv.type === "group";
              const isOnline  = other ? onlineUsers.has(other.user_id) : false;
              const isActive  = conv.conversation_id === activeConvId;
              const hasUnread = conv.unread_count > 0;
              const displayName = isGroup ? (conv.name ?? "Gruppo") : (other?.display_name ?? "Chat");
              const avatarChar  = isGroup ? "👥" : (other?.display_name[0]?.toUpperCase() ?? "?");

              // Anteprima ultimo messaggio
              const preview = conv.last_message_preview;
              const previewText = (() => {
                if (!preview?.ciphertext) return null;
                const vm = decodeVoiceMeta(preview.ciphertext);
                if (vm) return "🎙 Messaggio vocale";
                return safeDecodeForPreview(preview.ciphertext);
              })();
              const previewLabel = previewText
                ? (preview!.sender_id === auth?.userId ? `Tu: ${previewText}` : previewText)
                : "Nessun messaggio";

              const convId = conv.conversation_id;
              const convDisplayName = displayName;
              return (
                <button
                  key={convId}
                  className={`conv-item${isActive ? " active" : ""}${hasUnread ? " conv-item-unread" : ""}${isGroup ? " conv-item-group" : ""}`}
                  onClick={() => handleSelectConv(convId)}
                  onTouchStart={() => {
                    convLongPressTimerRef.current = setTimeout(() => {
                      convLongPressTimerRef.current = null;
                      setConvActionSheet({ convId, displayName: convDisplayName });
                    }, 600);
                  }}
                  onTouchEnd={() => {
                    if (convLongPressTimerRef.current) {
                      clearTimeout(convLongPressTimerRef.current);
                      convLongPressTimerRef.current = null;
                    }
                  }}
                  onTouchMove={() => {
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
                  <div className="avatar-wrapper">
                    <div className={`avatar avatar-md${hasUnread ? " avatar-unread" : ""}${isGroup ? " avatar-group" : ""}`}>
                      {avatarChar}
                    </div>
                    {!isGroup && isOnline && <div className="presence-dot" />}
                  </div>
                  <div className="conv-info">
                    <div className="conv-row-top">
                      <div className={`conv-name${hasUnread ? " conv-name-bold" : ""}`}>
                        {displayName}
                        {isGroup && <span className="conv-group-badge"> · Gruppo</span>}
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
              );
            })}
          </div>
      </aside>

      {/* ── Chat area ─────────────────────────────────────────────────────── */}
      <main className={`chat-area${!mobileShowChat ? " chat-area-mobile-hidden" : ""}`}>
        {!activeConvId ? (
          <div className="chat-empty">
            <div className="chat-empty-logo">α</div>
            <h2 className="chat-empty-title">Alpha Chat</h2>
            <p className="chat-empty-text">Seleziona una conversazione o iniziane una nuova</p>
            <div style={{ display: "flex", gap: 10 }}>
              <button className="chat-empty-btn" onClick={() => setShowInvite(true)}>
                Invita persona
              </button>
              <button className="chat-empty-btn" style={{ background: "var(--bg-3)", color: "var(--text-1)" }} onClick={() => setShowRedeem(true)}>
                Ho un codice
              </button>
            </div>
          </div>
        ) : (
          <>
            <ChatHeader
              otherUser={otherUser}
              isOnline={isOtherOnline}
              onBack={() => { setMobileShowChat(false); setShowChatSearch(false); setChatSearchQuery(""); }}
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
              onOpenSafetyNumber={() => setShowSafetyModal(true)}
              onSessionReset={async () => {
                if (!auth || !activeConvId) return;
                const conv = conversations.find((c) => c.conversation_id === activeConvId);
                const toId = conv?.other_user?.user_id;
                if (!toId) return;
                try {
                  await resetAndRebuildSession(auth.userId, auth.deviceId, toId);
                  showToast("Sessione E2E ripristinata. Invia un messaggio per confermare.");
                } catch {
                  showToast("Errore nel ripristino sessione. Riprova.");
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

                return filtered.map((msg) => {
                  const isMine = msg.sender_id === auth?.userId;
                  const text = getDisplayText(msg);
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
                  const voiceMeta = mediaMeta?.type === "voice" ? mediaMeta : null;
                  const isMedia   = mediaMeta !== null;

                  return (
                    <div
                      key={msg.id}
                      className={`msg-row ${isMine ? "mine" : "theirs"}${destroyingIds.has(msg.id) ? " msg-dissolve" : ""}`}
                      onContextMenu={(e) => handleContextMenu(e, msg)}
                      onTouchStart={(e) => handleTouchStart(e, msg)}
                      onTouchEnd={handleTouchCancel}
                      onTouchMove={handleTouchCancel}
                    >
                      <div className={`msg-bubble ${isMine ? "mine" : "theirs"} ${voiceMeta ? "voice-bubble" : ""}`}>
                        {/* Reply preview */}
                        {msg.reply_to_message_id && (
                          <div className="msg-reply-preview">
                            <span className="msg-reply-bar" />
                            <span className="msg-reply-text">
                              {repliedMsg
                                ? getDisplayText(repliedMsg)
                                : <em className="msg-reply-destroyed">🛡 Messaggio non più disponibile</em>
                              }
                            </span>
                          </div>
                        )}
                        {voiceMeta ? (
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
                            onView={(url, type) => setViewerMedia({ url, type })}
                          />
                        ) : msg.message_type === "media" && !mediaMeta ? (
                          /* FIX: media non decriptabile — placeholder invece di testo garbled */
                          <div className="msg-media-unavailable">
                            <span className="msg-media-unavailable-icon">🔒</span>
                            <span>Media non disponibile</span>
                          </div>
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
                  );
                });
              })()}

              {othersTyping.length > 0 && (
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
                  {getDisplayText(replyTo)}
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

            {showVoiceRecorder ? (
              <VoiceRecorder
                onSend={(v) => void handleVoiceSend(v)}
                onCancel={() => setShowVoiceRecorder(false)}
              />
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
                  onVoiceStart={() => setShowVoiceRecorder(true)}
                  onAttach={handleFilePick}
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
        <div className="ctx-overlay" onClick={closeContextMenu}>
          <div
            className="ctx-menu"
            style={{ top: contextMenu.y, left: contextMenu.x }}
            onClick={(e) => e.stopPropagation()}
          >
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
              Inoltra
            </button>
            <button className="ctx-item" onClick={ctxAction(() => void handleDeleteForMe(contextMenu.msg))}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
              Elimina per me
            </button>
            {contextMenu.msg.sender_id === auth?.userId && (
              <button className="ctx-item danger" onClick={ctxAction(() => void handleDeleteForAll(contextMenu.msg))}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M9 6V4h6v2"/></svg>
                Elimina per tutti
              </button>
            )}
            {contextMenu.msg.sender_id === auth?.userId && (
              <button className="ctx-item secure-destroy" onClick={ctxAction(() => { setDestroyTarget(contextMenu.msg); closeContextMenu(); })}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                Secure Destroy
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── Forward modal ──────────────────────────────────────────────────── */}
      {forwardingMessage && (
        <div className="modal-backdrop" onClick={() => setForwardingMessage(null)}>
          <div className="forward-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="forward-sheet-header">
              <span className="forward-sheet-title">Inoltra a…</span>
              <button className="forward-sheet-close" onClick={() => setForwardingMessage(null)} aria-label="Chiudi">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="16" height="16">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>
            <div className="forward-sheet-preview">
              "{getDisplayText(forwardingMessage).slice(0, 60)}"
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
                        <span className="forward-conv-name">{conv.other_user?.display_name ?? conv.other_user?.username ?? "Chat"}</span>
                        <span className="forward-conv-sub">@{conv.other_user?.username}</span>
                      </div>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16" style={{ opacity: 0.4 }}>
                        <polyline points="15 17 20 12 15 7"/><path d="M4 18v-2a4 4 0 0 1 4-4h12"/>
                      </svg>
                    </button>
                  );
                })}
              {conversations.filter((c) => c.conversation_id !== activeConvId).length === 0 && (
                <div className="forward-empty">Nessun altro contatto disponibile</div>
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

      {/* ── Archivio action sheet (long press su conversazione) ────────────── */}
      {convActionSheet && (
        <div
          className="conv-action-overlay"
          onClick={() => setConvActionSheet(null)}
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
                  setMobileShowChat(false);
                }
                setConvActionSheet(null);
                showToast("Conversazione archiviata");
              }}
            >
              📦 Archivia conversazione
            </button>
            <button
              className="conv-action-btn conv-action-cancel"
              onClick={() => setConvActionSheet(null)}
            >
              Annulla
            </button>
          </div>
        </div>
      )}

      {/* ── Sprint 21: Crea gruppo ─────────────────────────────────────────── */}
      {showCreateGroup && (
        <CreateGroupModal
          onClose={() => setShowCreateGroup(false)}
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

      {/* ── Sprint 21: Group Info overlay ──────────────────────────────────── */}
      {showGroupInfo && groupInfoId && (
        <div className="group-info-overlay">
          <GroupInfoPage
            groupId={groupInfoId}
            onBack={() => setShowGroupInfo(false)}
            onNavigate={onNavigate}
            onLeft={() => {
              setShowGroupInfo(false);
              setActiveConvId(null);
              void apiListConversations().then((r) => setConversations(r.items ?? []));
            }}
          />
        </div>
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
                            <div className="media-gallery-doc-name">{"filename" in meta! ? (meta as {filename:string}).filename : "Documento"}</div>
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
          onClose={() => setViewerMedia(null)}
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
