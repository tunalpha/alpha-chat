import { useState, useEffect, useRef, useCallback } from "react";
import { useAuth } from "../contexts/AuthContext";
import { useWebSocket, type WsEvent } from "../hooks/useWebSocket";
import {
  apiListConversations,
  apiCreateConversation,
  apiListMessages,
  apiSendMessage,
  apiSearchUsers,
  decodeMessage,
  type ConversationItem,
  type MessageItem,
  type UserProfile,
} from "../lib/api";

export default function ChatPage() {
  const { auth, logout, logoutAll } = useAuth();
  const { connected, on, sendTypingStart, sendTypingStop } = useWebSocket(auth?.accessToken ?? null);

  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [inputText, setInputText] = useState("");
  const [sending, setSending] = useState(false);
  const [loadingConvs, setLoadingConvs] = useState(true);
  const [loadingMsgs, setLoadingMsgs] = useState(false);

  // Mobile: mostra sidebar (false) o chat (true)
  const [mobileShowChat, setMobileShowChat] = useState(false);

  // User menu dropdown
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);

  // Search
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<UserProfile[]>([]);
  const [searching, setSearching] = useState(false);

  // Typing indicators: { conversation_id: Set<user_id> }
  const [typingUsers, setTypingUsers] = useState<Record<string, Set<string>>>({});

  // Online users: Set<user_id>
  const [onlineUsers, setOnlineUsers] = useState<Set<string>>(new Set());

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTypingRef = useRef(false);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Close user menu on outside click ─────────────────────────────────────
  useEffect(() => {
    if (!userMenuOpen) return;
    function handleClick(e: MouseEvent) {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [userMenuOpen]);

  // ── Load conversations ────────────────────────────────────────────────────
  const loadConversations = useCallback(async () => {
    setLoadingConvs(true);
    try {
      const res = await apiListConversations();
      setConversations(res.items);
    } catch { /* ignore */ } finally {
      setLoadingConvs(false);
    }
  }, []);

  useEffect(() => { void loadConversations(); }, [loadConversations]);

  // ── Load messages when conversation changes ───────────────────────────────
  useEffect(() => {
    if (!activeConvId) { setMessages([]); return; }
    setLoadingMsgs(true);
    apiListMessages(activeConvId, { limit: 50 })
      .then((res) => setMessages([...res.items].reverse()))
      .catch(() => {})
      .finally(() => setLoadingMsgs(false));
  }, [activeConvId]);

  // Scroll al fondo su nuovi messaggi
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // ── WebSocket events ──────────────────────────────────────────────────────
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
            prev
              .map((c) =>
                c.conversation_id === msg.conversation_id
                  ? { ...c, last_activity_at: msg.server_received_at }
                  : c,
              )
              .sort((a, b) => b.last_activity_at.localeCompare(a.last_activity_at)),
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
      }
    });
  }, [on, activeConvId]);

  // ── Handlers ──────────────────────────────────────────────────────────────
  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!activeConvId || !inputText.trim() || sending) return;
    const text = inputText.trim();
    setInputText("");
    if (isTypingRef.current) { sendTypingStop(activeConvId); isTypingRef.current = false; }
    setSending(true);
    try {
      await apiSendMessage(activeConvId, text);
    } catch (err) {
      console.error("Send failed:", err);
      setInputText(text);
    } finally {
      setSending(false);
    }
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    setInputText(e.target.value);
    if (!activeConvId) return;
    if (!isTypingRef.current) { sendTypingStart(activeConvId); isTypingRef.current = true; }
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    typingTimerRef.current = setTimeout(() => {
      if (activeConvId && isTypingRef.current) { sendTypingStop(activeConvId); isTypingRef.current = false; }
    }, 3_000);
  }

  function handleSearchChange(e: React.ChangeEvent<HTMLInputElement>) {
    const q = e.target.value;
    setSearchQuery(q);
    setSearchResults([]);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    if (q.trim().length < 2) return;
    searchTimerRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await apiSearchUsers(q.trim());
        setSearchResults(res.items.filter((u) => u.id !== auth?.userId));
      } catch { /* ignore */ } finally { setSearching(false); }
    }, 300);
  }

  async function handleStartChat(username: string) {
    try {
      const res = await apiCreateConversation(username);
      setShowSearch(false);
      setSearchQuery("");
      setSearchResults([]);
      await loadConversations();
      setActiveConvId(res.conversation_id);
      setMobileShowChat(true);
    } catch (err) { console.error("Create conversation failed:", err); }
  }

  function handleSelectConv(convId: string) {
    setActiveConvId(convId);
    setMobileShowChat(true);
  }

  function handleBackToSidebar() {
    setMobileShowChat(false);
  }

  async function handleLogout() {
    setLoggingOut(true);
    setUserMenuOpen(false);
    await logout();
  }

  async function handleLogoutAll() {
    setLoggingOut(true);
    setUserMenuOpen(false);
    await logoutAll();
  }

  // ── Derived state ─────────────────────────────────────────────────────────
  const activeConv = conversations.find((c) => c.conversation_id === activeConvId);
  const otherUser = activeConv?.other_user;
  const isOtherOnline = otherUser ? onlineUsers.has(otherUser.user_id) : false;
  const typingInActive = activeConvId ? [...(typingUsers[activeConvId] ?? [])] : [];
  const othersTyping = typingInActive.filter((id) => id !== auth?.userId);

  return (
    <div className="chat-root">
      {/* ── Sidebar ─────────────────────────────────────────────────────── */}
      <aside className={`sidebar${mobileShowChat ? " sidebar-mobile-hidden" : ""}`}>

        {/* Header */}
        <div className="sidebar-header">
          {/* Avatar → apre il menu utente */}
          <div className="user-menu-wrapper" ref={userMenuRef}>
            <button
              className="avatar-menu-btn"
              onClick={() => setUserMenuOpen((v) => !v)}
              aria-label="Menu utente"
              aria-expanded={userMenuOpen}
            >
              <div className="avatar avatar-sm">{auth?.displayName?.[0]?.toUpperCase()}</div>
            </button>

            {/* Dropdown */}
            {userMenuOpen && (
              <div className="user-menu-dropdown" role="menu">
                {/* Info utente */}
                <div className="user-menu-header">
                  <div className="user-menu-name">{auth?.displayName}</div>
                  <div className="user-menu-username">@{auth?.username}</div>
                  <div className={`user-menu-status ${connected ? "online" : "offline"}`}>
                    {connected ? "● Online" : "○ Offline"}
                  </div>
                </div>

                {/* Voci placeholder */}
                <div className="user-menu-section">
                  <button className="user-menu-item disabled" role="menuitem" disabled>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>
                    Profilo
                    <span className="user-menu-badge">presto</span>
                  </button>
                  <button className="user-menu-item disabled" role="menuitem" disabled>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
                    Impostazioni
                    <span className="user-menu-badge">presto</span>
                  </button>
                  <button className="user-menu-item disabled" role="menuitem" disabled>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16"><rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>
                    Dispositivi
                    <span className="user-menu-badge">presto</span>
                  </button>
                </div>

                <div className="user-menu-divider" />

                {/* Logout */}
                <div className="user-menu-section">
                  <button
                    className="user-menu-item danger"
                    role="menuitem"
                    onClick={handleLogout}
                    disabled={loggingOut}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
                    {loggingOut ? "Uscita..." : "Esci"}
                  </button>
                  <button
                    className="user-menu-item danger"
                    role="menuitem"
                    onClick={handleLogoutAll}
                    disabled={loggingOut}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/><path d="M3 12h6" strokeDasharray="2 2"/></svg>
                    Esci da tutti i dispositivi
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Stato utente */}
          <div className="sidebar-user-info">
            <div className="sidebar-username">{auth?.displayName}</div>
            <div className={`sidebar-status ${connected ? "online" : "offline"}`}>
              {connected ? "● Online" : "○ Offline"}
            </div>
          </div>

          {/* Nuova chat */}
          <button className="icon-btn" title="Nuova chat" onClick={() => setShowSearch(true)}>＋</button>
        </div>

        {/* Search panel */}
        {showSearch && (
          <div className="search-panel">
            <div className="search-header">
              <input
                className="search-input"
                type="text"
                placeholder="Cerca utente..."
                value={searchQuery}
                onChange={handleSearchChange}
                autoFocus
              />
              <button className="icon-btn" onClick={() => { setShowSearch(false); setSearchQuery(""); setSearchResults([]); }}>✕</button>
            </div>
            <div className="search-results">
              {searching && <div className="search-hint">Ricerca...</div>}
              {!searching && searchQuery && searchResults.length === 0 && (
                <div className="search-hint">Nessun utente trovato</div>
              )}
              {searchResults.map((user) => (
                <button
                  key={user.id}
                  className="search-result"
                  onClick={() => void handleStartChat(user.username)}
                >
                  <div className="avatar">{user.display_name[0]?.toUpperCase()}</div>
                  <div>
                    <div className="result-name">{user.display_name}</div>
                    <div className="result-username">@{user.username}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Conversation list */}
        {!showSearch && (
          <div className="conv-list">
            {loadingConvs && <div className="conv-hint">Caricamento...</div>}
            {!loadingConvs && conversations.length === 0 && (
              <div className="conv-hint">Nessuna conversazione.<br />Premi ＋ per iniziare.</div>
            )}
            {conversations.map((conv) => {
              const other = conv.other_user;
              const isOnline = other ? onlineUsers.has(other.user_id) : false;
              return (
                <button
                  key={conv.conversation_id}
                  className={`conv-item ${conv.conversation_id === activeConvId ? "active" : ""}`}
                  onClick={() => handleSelectConv(conv.conversation_id)}
                >
                  <div className="avatar-wrapper">
                    <div className="avatar">{other?.display_name[0]?.toUpperCase() ?? "?"}</div>
                    {isOnline && <div className="presence-dot" />}
                  </div>
                  <div className="conv-info">
                    <div className="conv-name">{other?.display_name ?? "Chat"}</div>
                    <div className="conv-username">@{other?.username ?? ""}</div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </aside>

      {/* ── Chat area ───────────────────────────────────────────────────── */}
      <main className={`chat-area${!mobileShowChat ? " chat-area-mobile-hidden" : ""}`}>
        {!activeConvId ? (
          <div className="chat-empty">
            <div className="chat-empty-icon">💬</div>
            <div className="chat-empty-text">Seleziona una conversazione</div>
            <button
              className="auth-btn"
              style={{ marginTop: 16, width: "auto", padding: "10px 24px" }}
              onClick={() => setShowSearch(true)}
            >
              Nuova chat
            </button>
          </div>
        ) : (
          <>
            <div className="chat-header">
              {/* Back button (mobile only) */}
              <button className="chat-back-btn" onClick={handleBackToSidebar} aria-label="Torna alla lista">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
                  <polyline points="15 18 9 12 15 6"/>
                </svg>
              </button>
              <div className="avatar">{otherUser?.display_name[0]?.toUpperCase() ?? "?"}</div>
              <div>
                <div className="chat-header-name">{otherUser?.display_name ?? "Chat"}</div>
                <div className={`chat-header-status ${isOtherOnline ? "online" : "offline"}`}>
                  {isOtherOnline ? "● Online" : "○ Offline"}
                </div>
              </div>
            </div>

            <div className="messages">
              {loadingMsgs && <div className="msg-hint">Caricamento messaggi...</div>}
              {messages.map((msg) => {
                const isMine = msg.sender_id === auth?.userId;
                const text = msg.ciphertext ? decodeMessage(msg.ciphertext) : "";
                const time = new Date(msg.sent_at).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
                return (
                  <div key={msg.id} className={`msg-row ${isMine ? "mine" : "theirs"}`}>
                    <div className={`msg-bubble ${isMine ? "mine" : "theirs"}`}>
                      <span className="msg-text">{text}</span>
                      <span className="msg-time">{time}</span>
                    </div>
                  </div>
                );
              })}
              {othersTyping.length > 0 && (
                <div className="msg-row theirs">
                  <div className="msg-bubble theirs typing-bubble">
                    <span className="typing-dot" /><span className="typing-dot" /><span className="typing-dot" />
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            <form className="chat-input-row" onSubmit={handleSend}>
              <input
                className="chat-input"
                type="text"
                placeholder="Scrivi un messaggio..."
                value={inputText}
                onChange={handleInputChange}
                disabled={sending}
              />
              <button className="send-btn" type="submit" disabled={sending || !inputText.trim()}>➤</button>
            </form>
          </>
        )}
      </main>
    </div>
  );
}
