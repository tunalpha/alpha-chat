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
  const { auth, logout } = useAuth();
  const { connected, on, sendTypingStart, sendTypingStop } = useWebSocket(auth?.accessToken ?? null);

  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [inputText, setInputText] = useState("");
  const [sending, setSending] = useState(false);
  const [loadingConvs, setLoadingConvs] = useState(true);
  const [loadingMsgs, setLoadingMsgs] = useState(false);

  // Search
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<UserProfile[]>([]);
  const [searching, setSearching] = useState(false);

  // Typing indicators per conversazione: { convId: Set<userId> }
  const [typingUsers, setTypingUsers] = useState<Record<string, Set<string>>>({});

  // Online users: Set<userId>
  const [onlineUsers, setOnlineUsers] = useState<Set<string>>(new Set());

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTypingRef = useRef(false);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Load conversations ────────────────────────────────────────────────────
  const loadConversations = useCallback(async () => {
    setLoadingConvs(true);
    try {
      const res = await apiListConversations();
      setConversations(res.conversations);
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
      .then((res) => setMessages(res.messages.slice().reverse()))
      .catch(() => {})
      .finally(() => setLoadingMsgs(false));
  }, [activeConvId]);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // ── WebSocket events ──────────────────────────────────────────────────────
  useEffect(() => {
    return on((event: WsEvent) => {
      switch (event.type) {
        case "message.new": {
          const msg = event.payload as unknown as MessageItem & { conversation_id: string };
          // Aggiorna la conversazione attiva
          if (msg.conversation_id === activeConvId) {
            setMessages((prev) => {
              // Evita duplicati
              if (prev.some((m) => m.id === msg.id)) return prev;
              return [...prev, msg];
            });
          }
          // Aggiorna last_activity_at nella lista
          setConversations((prev) =>
            prev.map((c) =>
              c.id === msg.conversation_id
                ? { ...c, last_activity_at: msg.server_received_at }
                : c,
            ).sort((a, b) =>
              (b.last_activity_at ?? "").localeCompare(a.last_activity_at ?? "")
            ),
          );
          break;
        }

        case "typing.start": {
          const { user_id, conversation_id } = event.payload;
          setTypingUsers((prev) => {
            const copy = { ...prev };
            if (!copy[conversation_id]) copy[conversation_id] = new Set();
            copy[conversation_id] = new Set(copy[conversation_id]).add(user_id);
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

        case "presence.online": {
          const { user_id } = event.payload;
          setOnlineUsers((prev) => new Set(prev).add(user_id));
          break;
        }

        case "presence.offline": {
          const { user_id } = event.payload;
          setOnlineUsers((prev) => {
            const s = new Set(prev);
            s.delete(user_id);
            return s;
          });
          break;
        }
      }
    });
  }, [on, activeConvId]);

  // ── Send message ─────────────────────────────────────────────────────────
  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!activeConvId || !inputText.trim() || sending) return;
    const text = inputText.trim();
    setInputText("");

    // Stop typing indicator
    if (isTypingRef.current) {
      sendTypingStop(activeConvId);
      isTypingRef.current = false;
    }

    setSending(true);
    try {
      await apiSendMessage(activeConvId, text);
      // Il messaggio arriva via WebSocket message.new
    } catch (err: unknown) {
      console.error("Send failed:", err);
      setInputText(text); // restore
    } finally {
      setSending(false);
    }
  }

  // ── Typing detection ──────────────────────────────────────────────────────
  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    setInputText(e.target.value);
    if (!activeConvId) return;

    if (!isTypingRef.current) {
      sendTypingStart(activeConvId);
      isTypingRef.current = true;
    }
    // Reset auto-stop timer
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    typingTimerRef.current = setTimeout(() => {
      if (activeConvId && isTypingRef.current) {
        sendTypingStop(activeConvId);
        isTypingRef.current = false;
      }
    }, 3_000);
  }

  // ── User search ───────────────────────────────────────────────────────────
  function handleSearchChange(e: React.ChangeEvent<HTMLInputElement>) {
    const q = e.target.value;
    setSearchQuery(q);
    setSearchResults([]);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    if (!q.trim()) return;
    searchTimerRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await apiSearchUsers(q.trim());
        setSearchResults(res.users.filter((u) => u.id !== auth?.userId));
      } catch { /* ignore */ } finally {
        setSearching(false);
      }
    }, 300);
  }

  async function handleStartChat(username: string) {
    try {
      const res = await apiCreateConversation(username);
      setShowSearch(false);
      setSearchQuery("");
      setSearchResults([]);
      await loadConversations();
      setActiveConvId(res.id);
    } catch (err: unknown) {
      console.error("Create conversation failed:", err);
    }
  }

  // ── Active conversation info ──────────────────────────────────────────────
  const activeConv = conversations.find((c) => c.id === activeConvId);
  const otherUser = activeConv?.other_user;
  const isOtherOnline = otherUser ? onlineUsers.has(otherUser.id) : false;
  const typingInActive = activeConvId ? [...(typingUsers[activeConvId] ?? [])] : [];
  const othersTyping = typingInActive.filter((id) => id !== auth?.userId);

  return (
    <div className="chat-root">
      {/* ── Sidebar ───────────────────────────────────────────────────── */}
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="sidebar-user">
            <div className="avatar avatar-sm">{auth?.displayName?.[0]?.toUpperCase()}</div>
            <div>
              <div className="sidebar-username">{auth?.displayName}</div>
              <div className={`sidebar-status ${connected ? "online" : "offline"}`}>
                {connected ? "● Online" : "○ Connessione..."}
              </div>
            </div>
          </div>
          <button className="icon-btn" title="Nuova chat" onClick={() => setShowSearch(true)}>＋</button>
        </div>

        {/* Search overlay */}
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

        {/* Conversations list */}
        <div className="conv-list">
          {loadingConvs && <div className="conv-hint">Caricamento...</div>}
          {!loadingConvs && conversations.length === 0 && (
            <div className="conv-hint">Nessuna conversazione.<br />Premi ＋ per iniziare.</div>
          )}
          {conversations.map((conv) => {
            const other = conv.other_user;
            const isOnline = other ? onlineUsers.has(other.id) : false;
            return (
              <button
                key={conv.id}
                className={`conv-item ${conv.id === activeConvId ? "active" : ""}`}
                onClick={() => setActiveConvId(conv.id)}
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

        <button className="logout-btn" onClick={() => void logout()}>Esci</button>
      </aside>

      {/* ── Chat area ─────────────────────────────────────────────────── */}
      <main className="chat-area">
        {!activeConvId ? (
          <div className="chat-empty">
            <div className="chat-empty-icon">💬</div>
            <div className="chat-empty-text">Seleziona una conversazione</div>
            <button className="auth-btn" style={{ marginTop: 16, width: "auto" }}
              onClick={() => setShowSearch(true)}>Nuova chat</button>
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="chat-header">
              <div className="avatar">{otherUser?.display_name[0]?.toUpperCase() ?? "?"}</div>
              <div>
                <div className="chat-header-name">{otherUser?.display_name ?? "Chat"}</div>
                <div className={`chat-header-status ${isOtherOnline ? "online" : "offline"}`}>
                  {isOtherOnline ? "● Online" : "○ Offline"}
                </div>
              </div>
            </div>

            {/* Messages */}
            <div className="messages">
              {loadingMsgs && <div className="msg-hint">Caricamento messaggi...</div>}
              {messages.map((msg) => {
                const isMine = msg.sender_id === auth?.userId;
                const text = msg.ciphertext ? decodeMessage(msg.ciphertext) : "";
                const time = new Date(msg.sent_at).toLocaleTimeString("it-IT", {
                  hour: "2-digit", minute: "2-digit",
                });
                return (
                  <div key={msg.id} className={`msg-row ${isMine ? "mine" : "theirs"}`}>
                    <div className={`msg-bubble ${isMine ? "mine" : "theirs"}`}>
                      <span className="msg-text">{text}</span>
                      <span className="msg-time">{time}</span>
                    </div>
                  </div>
                );
              })}
              {/* Typing indicator */}
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

            {/* Input */}
            <form className="chat-input-row" onSubmit={handleSend}>
              <input
                className="chat-input"
                type="text"
                placeholder="Scrivi un messaggio..."
                value={inputText}
                onChange={handleInputChange}
                disabled={sending}
              />
              <button className="send-btn" type="submit" disabled={sending || !inputText.trim()}>
                ➤
              </button>
            </form>
          </>
        )}
      </main>
    </div>
  );
}
