/**
 * ArchivioPage — Sprint 24
 *
 * Mostra le conversazioni archiviate (IDs in localStorage "alpha_archived_convs").
 * Il caricamento è lazy: fetcha solo le conversazioni archiviate.
 */

import { useEffect, useState } from "react";
import { apiListConversations } from "../lib/api";

interface ArchivedConv {
  conversation_id: string;
  display_name: string;
  last_message_text?: string;
  last_activity_at?: string;
  initial: string;
}

interface Props {
  onBack: () => void;
  onOpen: (convId: string) => void;
}

function getArchivedIds(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem("alpha_archived_convs") ?? "[]") as string[]); }
  catch { return new Set(); }
}

export function archiveConversation(convId: string): void {
  const ids = getArchivedIds();
  ids.add(convId);
  localStorage.setItem("alpha_archived_convs", JSON.stringify([...ids]));
}

export function unarchiveConversation(convId: string): void {
  const ids = getArchivedIds();
  ids.delete(convId);
  localStorage.setItem("alpha_archived_convs", JSON.stringify([...ids]));
}

export function isArchived(convId: string): boolean {
  return getArchivedIds().has(convId);
}

export default function ArchivioPage({ onBack, onOpen }: Props) {
  const [items, setItems] = useState<ArchivedConv[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const archivedIds = getArchivedIds();
    if (archivedIds.size === 0) { setLoading(false); return; }

    apiListConversations().then((res) => {
      const filtered = res.items
        .filter((c) => archivedIds.has(c.conversation_id))
        .map((c) => ({
          conversation_id: c.conversation_id,
          display_name: c.other_user?.display_name ?? c.other_user?.username ?? c.name ?? "Sconosciuto",
          last_message_text: undefined as string | undefined,
          last_activity_at: c.last_activity_at,
          initial: (c.other_user?.display_name ?? c.name ?? "?")[0]?.toUpperCase() ?? "?",
        }));
      setItems(filtered);
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  function handleUnarchive(convId: string, e: React.MouseEvent) {
    e.stopPropagation();
    unarchiveConversation(convId);
    setItems((prev) => prev.filter((c) => c.conversation_id !== convId));
  }

  return (
    <div className="archivio-page">
      {/* Header */}
      <div className="archivio-header">
        <button className="archivio-back-btn" onClick={onBack} aria-label="Indietro">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="20" height="20">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
        </button>
        <h2 className="archivio-title">Archivio</h2>
      </div>

      {/* Content */}
      {loading ? (
        <div className="archivio-empty">
          <div className="archivio-spinner" />
        </div>
      ) : items.length === 0 ? (
        <div className="archivio-empty">
          <div className="archivio-empty-icon">📦</div>
          <p className="archivio-empty-title">Nessuna chat archiviata</p>
          <p className="archivio-empty-sub">
            Tieni premuto una conversazione per archiviarla.
          </p>
        </div>
      ) : (
        <ul className="archivio-list">
          {items.map((item) => (
            <li
              key={item.conversation_id}
              className="archivio-item"
              onClick={() => onOpen(item.conversation_id)}
            >
              <div className="archivio-avatar">{item.initial}</div>
              <div className="archivio-info">
                <div className="archivio-name">{item.display_name}</div>
                {item.last_message_text && (
                  <div className="archivio-last">{item.last_message_text}</div>
                )}
              </div>
              <button
                className="archivio-unarchive-btn"
                onClick={(e) => handleUnarchive(item.conversation_id, e)}
                title="Rimuovi dall'archivio"
                aria-label="Rimuovi dall'archivio"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
                  <polyline points="20 9 20 20 4 20 4 9"/>
                  <rect x="2" y="3" width="20" height="6" rx="1"/>
                  <line x1="10" y1="14" x2="14" y2="14"/>
                </svg>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
