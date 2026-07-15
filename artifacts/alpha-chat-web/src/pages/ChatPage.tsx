import { useState, useEffect, useRef, useCallback } from "react";
import { useAuth } from "../contexts/AuthContext";
import { useWebSocket, type WsEvent } from "../hooks/useWebSocket";
import type { AppView } from "../App";
import {
  apiListConversations,
  apiListMessages,
  apiSendMessage,
  apiEditMessage,
  apiDeleteMessage,
  apiSendVoiceMessage,
  apiMarkRead,
  decodeMessage,
  decodeVoiceMeta,
  AuthExpiredError,
  type ConversationItem,
  type MessageItem,
} from "../lib/api";
import VoiceRecorder, { type VoiceBlob } from "../components/VoiceRecorder";
import VoiceMessage from "../components/VoiceMessage";
import InviteModal from "../components/InviteModal";
import RedeemModal from "../components/RedeemModal";

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
}: {
  otherUser: { display_name: string; username: string } | null | undefined;
  isOnline: boolean;
  onBack: () => void;
  onViewProfile: () => void;
  onSearchInChat: () => void;
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

  const menuItems = [
    { label: "Visualizza profilo", icon: "👤", soon: true },
    { label: "Media condivisi", icon: "🖼️", soon: true },
    { label: "Cerca nella chat", icon: "🔍", soon: true },
    { label: "Silenzia", icon: "🔕", soon: true },
    { label: "Blocca utente", icon: "🚫", danger: true, soon: true },
    { label: "Cancella chat", icon: "🗑️", danger: true, soon: true },
  ];

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
        <div className={`chat-header-status ${isOnline ? "online" : "offline"}`}>
          {isOnline ? "● Online" : "○ Offline"}
        </div>
      </div>

      <div className="chat-header-actions">
        <button className="icon-btn icon-btn-header" title="Chiamata" aria-label="Chiamata">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
            <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.61 3.4 2 2 0 0 1 3.6 1.22h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.8a16 16 0 0 0 5.55 5.55l.95-.95a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>
          </svg>
        </button>
        <button className="icon-btn icon-btn-header" title="Video" aria-label="Videochiamata">
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
              {menuItems.map((item) => (
                <button
                  key={item.label}
                  className={`chat-menu-item${item.danger ? " danger" : ""}`}
                  onClick={() => setMenuOpen(false)}
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

// ── Chat input bar ───────────────────────────────────────────────────────────
function ChatInput({
  value,
  onChange,
  onSubmit,
  onVoiceStart,
  disabled,
}: {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onSubmit: (e: React.FormEvent) => void;
  onVoiceStart: () => void;
  disabled: boolean;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
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
      {/* Emoji — non implementata */}
      <button type="button" className="input-icon-btn" aria-label="Emoji" title="Disponibile prossimamente" disabled>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="22" height="22">
          <circle cx="12" cy="12" r="10"/><path d="M8 13s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/>
        </svg>
      </button>
      {/* Allega — non implementata */}
      <button type="button" className="input-icon-btn" aria-label="Allega" title="Disponibile prossimamente" disabled>
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
  onNavigate,
  onLogout,
  onLogoutAll,
  loggingOut,
}: {
  displayName: string;
  username: string;
  connected: boolean;
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
  ];

  return (
    <div className="user-menu-wrapper" ref={ref}>
      <button
        className="avatar-menu-btn"
        onClick={() => setOpen((v) => !v)}
        aria-label="Menu utente"
        aria-expanded={open}
      >
        <div className="avatar avatar-sm">{displayName[0]?.toUpperCase()}</div>
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
  const { connected, on, sendTypingStart, sendTypingStop } = useWebSocket(auth?.accessToken ?? null);

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
  // voice recorder
  const [showVoiceRecorder, setShowVoiceRecorder] = useState(false);
  const [typingUsers, setTypingUsers] = useState<Record<string, Set<string>>>({});
  const [onlineUsers, setOnlineUsers] = useState<Set<string>>(new Set());
  const [atBottom, setAtBottom] = useState(true);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTypingRef = useRef(false);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ctxOpenedAtRef = useRef<number>(0); // ghost-click guard

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

  // ── Load messages ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!activeConvId) { setMessages([]); return; }
    setLoadingMsgs(true);
    apiListMessages(activeConvId, { limit: 50 })
      .then((res) => setMessages([...res.items].reverse()))
      .catch(() => {})
      .finally(() => setLoadingMsgs(false));
  }, [activeConvId]);

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
          if (msg.conversation_id === activeConvId) {
            setMessages((prev) => {
              if (prev.some((m) => m.id === msg.id)) return prev;
              return [...prev, msg];
            });
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
      }
    });
  }, [on, activeConvId]);

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
        // Modalità modifica
        const updated = await apiEditMessage(activeConvId, editingMessage.id, text);
        setMessages((prev) => prev.map((m) => m.id === updated.id ? { ...m, ciphertext: updated.ciphertext, edited_at: updated.edited_at } : m));
        setEditingMessage(null);
      } else {
        // Invio normale o risposta
        await apiSendMessage(activeConvId, text, { replyToMessageId: replyTo?.id });
        setReplyTo(null);
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "Errore invio";
      if (editingMessage && (errMsg.includes("EDIT_EXPIRED") || errMsg.includes("EDIT_FORBIDDEN"))) {
        // Non si può più modificare — pulisci la modalità edit
        setEditingMessage(null);
        setInputText("");
        setSendError("Impossibile modificare: tempo scaduto (15 min)");
      } else {
        setSendError(errMsg.includes("sender_key_id") || errMsg.includes("key")
          ? "Errore JS vecchio — ricarica la pagina (↻)"
          : errMsg);
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
    const text = forwardingMessage.ciphertext ? decodeMessage(forwardingMessage.ciphertext) : "";
    setForwardingMessage(null);
    try {
      await apiSendMessage(targetConvId, text);
      showToast("Messaggio inoltrato ✓");
    } catch {
      showToast("Errore durante l'inoltro");
    }
  }

  async function handleVoiceSend(voice: VoiceBlob) {
    setShowVoiceRecorder(false);
    if (!activeConvId) return;
    setSending(true);
    try {
      await apiSendVoiceMessage(activeConvId, voice.blob, voice.durationMs, voice.waveform);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Errore invio vocale");
    } finally {
      setSending(false);
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
              const other = conv.other_user;
              const isOnline = other ? onlineUsers.has(other.user_id) : false;
              const isActive = conv.conversation_id === activeConvId;
              const hasUnread = conv.unread_count > 0;

              // Anteprima ultimo messaggio
              const preview = conv.last_message_preview;
              const previewText = preview
                ? (preview.ciphertext ? decodeMessage(preview.ciphertext) : "")
                : null;
              const previewLabel = previewText
                ? (preview!.sender_id === auth?.userId ? `Tu: ${previewText}` : previewText)
                : "Nessun messaggio";

              return (
                <button
                  key={conv.conversation_id}
                  className={`conv-item${isActive ? " active" : ""}${hasUnread ? " conv-item-unread" : ""}`}
                  onClick={() => handleSelectConv(conv.conversation_id)}
                >
                  <div className="avatar-wrapper">
                    <div className={`avatar avatar-md${hasUnread ? " avatar-unread" : ""}`}>
                      {other?.display_name[0]?.toUpperCase() ?? "?"}
                    </div>
                    {isOnline && <div className="presence-dot" />}
                  </div>
                  <div className="conv-info">
                    <div className="conv-row-top">
                      <div className={`conv-name${hasUnread ? " conv-name-bold" : ""}`}>
                        {other?.display_name ?? "Chat"}
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
                      const text = m.ciphertext ? decodeMessage(m.ciphertext) : "";
                      return text.toLowerCase().includes(q);
                    })
                  : messages;

                if (q && filtered.length === 0) {
                  return <div className="msg-hint">Nessun messaggio trovato per "<strong>{chatSearchQuery}</strong>"</div>;
                }

                return filtered.map((msg) => {
                  const isMine = msg.sender_id === auth?.userId;
                  const text = msg.ciphertext ? decodeMessage(msg.ciphertext) : "";
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

                  // Messaggio vocale
                  const voiceMeta = msg.message_type === "media" ? decodeVoiceMeta(msg.ciphertext) : null;

                  return (
                    <div
                      key={msg.id}
                      className={`msg-row ${isMine ? "mine" : "theirs"}`}
                      onContextMenu={(e) => handleContextMenu(e, msg)}
                      onTouchStart={(e) => handleTouchStart(e, msg)}
                      onTouchEnd={handleTouchCancel}
                      onTouchMove={handleTouchCancel}
                    >
                      <div className={`msg-bubble ${isMine ? "mine" : "theirs"} ${voiceMeta ? "voice-bubble" : ""}`}>
                        {/* Reply preview */}
                        {repliedMsg && (
                          <div className="msg-reply-preview">
                            <span className="msg-reply-bar" />
                            <span className="msg-reply-text">
                              {repliedMsg.ciphertext ? decodeMessage(repliedMsg.ciphertext) : "Messaggio"}
                            </span>
                          </div>
                        )}
                        {voiceMeta ? (
                          <VoiceMessage
                            mediaId={voiceMeta.media_id}
                            durationMs={voiceMeta.duration_ms}
                            waveform={voiceMeta.waveform}
                            isMine={isMine}
                          />
                        ) : (
                          renderText()
                        )}
                        <div className="msg-meta">
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
                  {replyTo.ciphertext ? decodeMessage(replyTo.ciphertext) : "Messaggio"}
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
              <ChatInput
                value={inputText}
                onChange={handleInputChange}
                onSubmit={handleSend}
                onVoiceStart={() => setShowVoiceRecorder(true)}
                disabled={sending}
              />
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
                setInputText(contextMenu.msg.ciphertext ? decodeMessage(contextMenu.msg.ciphertext) : "");
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
              "{forwardingMessage.ciphertext ? decodeMessage(forwardingMessage.ciphertext).slice(0, 60) : "Messaggio"}"
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

      {/* ── Toast ──────────────────────────────────────────────────────────── */}
      {toastMsg && (
        <div className="toast-msg">{toastMsg}</div>
      )}

      {/* ── Invite modals ──────────────────────────────────────────────────── */}
      {showInvite && (
        <InviteModal onClose={() => setShowInvite(false)} />
      )}
      {showRedeem && (
        <RedeemModal
          onClose={() => setShowRedeem(false)}
          onSuccess={(convId) => void handleRedeemSuccess(convId)}
        />
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
    </div>
  );
}
