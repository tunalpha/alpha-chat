/**
 * Investor Access — Pagina Admin
 *
 * Tab A: Richieste di accesso
 * Tab B: Codici di accesso
 * Tab C: Log accessi
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { useToast } from "@/hooks/use-toast";
import { getToken } from "@/lib/api";

// ─── Gate Toggle ─────────────────────────────────────────────────────────────

function GateToggle() {
  const { toast } = useToast();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    // Usa l'endpoint pubblico (GET /api/v1/investor/settings) perché
    // GET /api/v1/investor/admin/settings non esiste come route separata.
    fetch("/api/v1/investor/settings")
      .then(r => r.json())
      .then((d: { gateEnabled: boolean }) => setEnabled(d.gateEnabled))
      .catch(() => {});
  }, []);

  const toggle = async () => {
    if (enabled === null) return;
    setSaving(true);
    try {
      const d = await invFetch<{ gateEnabled: boolean }>("/settings", {
        method: "PATCH",
        body: JSON.stringify({ gateEnabled: !enabled }),
      });
      setEnabled(d.gateEnabled);
      toast({
        title: d.gateEnabled ? "Gate abilitato" : "Gate disabilitato",
        description: d.gateEnabled
          ? "Gli investitori devono inserire il codice di accesso"
          : "Il portale è accessibile senza codice",
      });
    } catch {
      toast({ title: "Errore", variant: "destructive" });
    } finally { setSaving(false); }
  };

  if (enabled === null) return null;

  return (
    <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-violet-50 border border-gray-200">
      <div className="flex-1">
        <p className="text-sm font-semibold text-gray-900">Gate accesso investitori</p>
        <p className="text-xs text-gray-500 mt-0.5">
          {enabled ? "ON — richiede codice di accesso" : "OFF — portale aperto senza codice"}
        </p>
      </div>
      <button
        onClick={toggle}
        disabled={saving}
        className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 transition-colors duration-200 focus:outline-none ${
          enabled ? "bg-violet-600 border-violet-600" : "bg-zinc-600 border-zinc-600"
        } ${saving ? "opacity-50 cursor-not-allowed" : ""}`}
        role="switch"
        aria-checked={enabled}
      >
        <span
          className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transform transition-transform duration-200 ${
            enabled ? "translate-x-5" : "translate-x-0"
          }`}
        />
      </button>
    </div>
  );
}

// Endpoint investitori su /api/v1/investor/admin
const INV_BASE = "/api/v1/investor/admin";

async function invFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(opts?.headers as Record<string, string> | undefined),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${INV_BASE}${path}`, { ...opts, headers });

  if (res.status === 401 || res.status === 403) {
    window.location.href = "/admin/login";
    throw new Error("Non autorizzato");
  }
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try { const b = await res.json(); message = b?.message ?? b?.error?.message ?? message; } catch {}
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

// ─── Tipi ─────────────────────────────────────────────────────────────────

interface AccessRequest {
  _id: string;
  name: string;
  company: string;
  email: string;
  message?: string;
  status: "pending" | "approved" | "rejected";
  requestedAt: string;
  reviewedAt?: string;
  reviewedBy?: string;
}

interface AccessCode {
  _id: string;
  investorName: string;
  investorEmail: string;
  createdAt: string;
  expiresAt?: string;
  lastUsedAt?: string;
  accessCount: number;
  status: "active" | "revoked" | "expired";
}

interface AccessLog {
  _id: string;
  attemptedAt: string;
  ip?: string;
  userAgent?: string;
  country?: string;
  investorEmail?: string;
  documentOpened?: string;
  outcome: "success" | "denied" | "expired" | "revoked";
  reason?: string;
}

const VALIDITY_OPTIONS = [
  { label: "7 giorni",       value: 7   },
  { label: "15 giorni",      value: 15  },
  { label: "30 giorni",      value: 30  },
  { label: "60 giorni",      value: 60  },
  { label: "90 giorni",      value: 90  },
  { label: "180 giorni",     value: 180 },
  { label: "365 giorni",     value: 365 },
  { label: "Nessuna scadenza", value: 0 },
];

const STATUS_LABEL: Record<string, string> = {
  pending:  "IN ATTESA",
  approved: "APPROVATO",
  rejected: "RIFIUTATO",
  active:   "ATTIVO",
  revoked:  "REVOCATO",
  expired:  "SCADUTO",
  success:  "SUCCESSO",
  denied:   "NEGATO",
};

function fmtDate(d?: string) {
  if (!d) return "—";
  return new Date(d).toLocaleString("it-IT", { dateStyle: "medium", timeStyle: "short" });
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    pending:  "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
    approved: "bg-green-500/15 text-green-400 border-green-500/30",
    rejected: "bg-red-500/15 text-red-400 border-red-500/30",
    active:   "bg-green-500/15 text-green-400 border-green-500/30",
    revoked:  "bg-red-500/15 text-red-400 border-red-500/30",
    expired:  "bg-zinc-500/15 text-zinc-400 border-zinc-500/30",
    success:  "bg-green-500/15 text-green-400 border-green-500/30",
    denied:   "bg-red-500/15 text-red-400 border-red-500/30",
  };
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${colors[status] ?? "bg-zinc-700 text-zinc-300"}`}>
      {STATUS_LABEL[status] ?? status.toUpperCase()}
    </span>
  );
}

// ─── Modal Approvazione ──────────────────────────────────────────────────────

function ApproveModal({
  request,
  onClose,
  onDone,
}: {
  request: AccessRequest;
  onClose: () => void;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const [code, setCode] = useState(() => generateFrontendCode());
  const [name, setName] = useState(request.name);
  const [email, setEmail] = useState(request.email);
  const [validity, setValidity] = useState(30);
  const [sendEmail, setSendEmail] = useState(true);
  const [loading, setLoading] = useState(false);

  function generateFrontendCode() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const seg = () => Array.from({length:4}, () => chars[Math.floor(Math.random()*chars.length)]).join('');
    return `${seg()}-${seg()}-${seg()}`;
  }

  const submit = async () => {
    setLoading(true);
    try {
      const res = await invFetch<{ ok: boolean; code: string }>(`/requests/${request._id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customCode: code, investorName: name, email, validityDays: validity, sendEmail }),
      });
      toast({ title: "Codice generato", description: `Codice: ${res.code}` });
      onDone();
      onClose();
    } catch {
      toast({ title: "Errore", description: "Impossibile generare il codice", variant: "destructive" });
    } finally { setLoading(false); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-sidebar border border-gray-200 rounded-2xl w-full max-w-md p-6 space-y-4 shadow-2xl">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-white">Genera codice di accesso</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-white">✕</button>
        </div>
        <p className="text-sm text-gray-600">
          Approvazione richiesta di <strong className="text-white">{request.name}</strong> · {request.company}
        </p>

        <div className="space-y-3">
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
              Codice di accesso (generato automaticamente, modificabile)
            </label>
            <div className="flex gap-2 mt-1">
              <input
                value={code} onChange={e => setCode(e.target.value.toUpperCase())}
                className="flex-1 bg-gray-100 border border-gray-200 rounded-lg px-3 py-2 text-white font-mono text-sm tracking-widest"
              />
              <button onClick={() => setCode(generateFrontendCode())}
                className="px-3 py-2 rounded-lg border border-gray-200 text-xs text-gray-600 hover:text-white hover:border-white/20">
                ↻
              </button>
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Nome investitore</label>
            <input value={name} onChange={e => setName(e.target.value)}
              className="w-full mt-1 bg-gray-100 border border-gray-200 rounded-lg px-3 py-2 text-white text-sm" />
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)}
              className="w-full mt-1 bg-gray-100 border border-gray-200 rounded-lg px-3 py-2 text-white text-sm" />
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Validità</label>
            <select value={validity} onChange={e => setValidity(Number(e.target.value))}
              className="w-full mt-1 bg-gray-100 border border-gray-200 rounded-lg px-3 py-2 text-white text-sm">
              {VALIDITY_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <label className="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" checked={sendEmail} onChange={e => setSendEmail(e.target.checked)}
              className="w-4 h-4 rounded border-gray-200 accent-violet-500" />
            <span className="text-sm text-gray-700">Invia il codice automaticamente via email</span>
          </label>
        </div>

        <div className="flex gap-3 pt-2">
          <button onClick={onClose} className="flex-1 py-2 rounded-lg border border-gray-200 text-sm text-gray-600 hover:text-white">
            Annulla
          </button>
          <button onClick={submit} disabled={loading}
            className="flex-1 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold disabled:opacity-50">
            {loading ? "Generazione…" : "Genera codice di accesso"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── SwipeableCard ───────────────────────────────────────────────────────────

function SwipeableCard({
  children,
  onDelete,
}: {
  children: React.ReactNode;
  onDelete: () => void;
}) {
  const THRESHOLD = 80; // px per confermare il delete
  const containerRef = useRef<HTMLDivElement>(null);
  const startXRef = useRef(0);
  const currentXRef = useRef(0);
  const [offset, setOffset] = useState(0);
  const [confirmed, setConfirmed] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const onTouchStart = (e: React.TouchEvent) => {
    startXRef.current = e.touches[0].clientX;
    currentXRef.current = 0;
    setConfirmed(false);
  };

  const onTouchMove = (e: React.TouchEvent) => {
    const dx = e.touches[0].clientX - startXRef.current;
    if (dx > 0) { setOffset(0); return; } // ignora swipe a destra
    const clamped = Math.max(dx, -120);
    currentXRef.current = clamped;
    setOffset(clamped);
    setConfirmed(clamped <= -THRESHOLD);
  };

  const onTouchEnd = () => {
    if (confirmed) {
      // Anima via + esegui delete
      setDeleting(true);
      setOffset(-400);
      setTimeout(() => onDelete(), 300);
    } else {
      setOffset(0);
    }
  };

  const deleteWidth = Math.min(Math.abs(offset), 120);
  const deleteOpacity = Math.min(Math.abs(offset) / THRESHOLD, 1);

  return (
    <div
      className="relative overflow-hidden rounded-xl"
      style={{ transition: deleting ? "max-height 0.3s, opacity 0.3s" : undefined }}
    >
      {/* Sfondo rosso delete */}
      <div
        className="absolute inset-y-0 right-0 flex items-center justify-end bg-red-600 rounded-xl"
        style={{ width: `${deleteWidth}px`, opacity: deleteOpacity, transition: "width 0.05s, opacity 0.1s" }}
      >
        <div className="flex flex-col items-center justify-center pr-4 gap-1">
          <span className="text-white text-lg">🗑</span>
          {confirmed && <span className="text-white text-[10px] font-semibold uppercase tracking-wide">Elimina</span>}
        </div>
      </div>

      {/* Card principale */}
      <div
        ref={containerRef}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        style={{
          transform: `translateX(${offset}px)`,
          transition: offset === 0 || deleting ? "transform 0.25s cubic-bezier(0.25,1,0.5,1)" : "none",
          willChange: "transform",
        }}
      >
        {children}
      </div>
    </div>
  );
}

// ─── Tab A: Richieste ────────────────────────────────────────────────────────

const FILTER_REQUESTS = [
  { id: "all",      label: "Tutte" },
  { id: "pending",  label: "In attesa" },
  { id: "approved", label: "Approvate" },
  { id: "rejected", label: "Rifiutate" },
];

function RequestsTab() {
  const { toast } = useToast();
  const [requests, setRequests] = useState<AccessRequest[]>([]);
  const [loading, setLoading]   = useState(true);
  const [approving, setApproving] = useState<AccessRequest | null>(null);
  const [filter, setFilter]     = useState("all");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await invFetch<{ requests: AccessRequest[] }>(`/requests${filter !== "all" ? `?status=${filter}` : ""}`);
      setRequests(res.requests);
    } catch {
      toast({ title: "Errore nel caricamento delle richieste", variant: "destructive" });
    } finally { setLoading(false); }
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  const reject = async (id: string) => {
    if (!confirm("Rifiutare questa richiesta?")) return;
    try {
      await invFetch(`/requests/${id}/reject`, { method: "POST" });
      toast({ title: "Richiesta rifiutata" });
      load();
    } catch {
      toast({ title: "Errore", variant: "destructive" });
    }
  };

  const deleteRequest = async (id: string) => {
    try {
      await invFetch(`/requests/${id}`, { method: "DELETE" });
      toast({ title: "Richiesta eliminata" });
      setRequests(prev => prev.filter(r => r._id !== id));
    } catch {
      toast({ title: "Errore durante l'eliminazione", variant: "destructive" });
      load();
    }
  };

  return (
    <div className="space-y-4">
      {approving && (
        <ApproveModal
          request={approving}
          onClose={() => setApproving(null)}
          onDone={load}
        />
      )}

      {/* Filtri */}
      <div className="flex gap-2 flex-wrap">
        {FILTER_REQUESTS.map(s => (
          <button key={s.id} onClick={() => setFilter(s.id)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
              filter === s.id ? "bg-violet-600 text-white" : "bg-gray-100 text-gray-600 hover:text-gray-900 border border-gray-200"
            }`}>
            {s.label}
          </button>
        ))}
        <button onClick={load} className="ml-auto px-3 py-1.5 rounded-lg text-xs border border-gray-300 bg-white text-gray-600 hover:text-gray-900 hover:border-gray-400">
          ↻ Aggiorna
        </button>
      </div>

      {loading ? (
        <p className="text-gray-500 text-sm">Caricamento…</p>
      ) : requests.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <p className="text-4xl mb-2">📋</p>
          <p>Nessuna richiesta trovata</p>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-[11px] text-zinc-500 flex items-center gap-1.5">
            <span>←</span> Scorri a sinistra su una richiesta per eliminarla
          </p>
          {requests.map((r) => (
            <SwipeableCard key={r._id} onDelete={() => deleteRequest(r._id)}>
              <div className="rounded-xl border border-white/10 bg-zinc-800 p-4 space-y-3">
                {/* Riga principale */}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-white truncate">{r.name}</p>
                    <p className="text-xs text-zinc-400 truncate">{r.company}</p>
                    <p className="text-xs text-zinc-500 font-mono truncate mt-0.5">{r.email}</p>
                  </div>
                  <StatusBadge status={r.status} />
                </div>
                {/* Data + messaggio */}
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500">
                  <span>📅 {fmtDate(r.requestedAt)}</span>
                  {r.message && (
                    <span className="italic text-zinc-500 truncate max-w-[200px]" title={r.message}>
                      💬 {r.message}
                    </span>
                  )}
                </div>
                {/* Azioni */}
                {r.status === "pending" && (
                  <div className="flex gap-2 pt-1">
                    <button onClick={() => setApproving(r)}
                      className="flex-1 text-xs py-1.5 rounded-lg bg-green-700/30 text-green-400 border border-green-500/30 hover:bg-green-700/50 font-semibold">
                      ✓ Approva
                    </button>
                    <button onClick={() => reject(r._id)}
                      className="flex-1 text-xs py-1.5 rounded-lg bg-red-700/30 text-red-400 border border-red-500/30 hover:bg-red-700/50 font-semibold">
                      ✕ Rifiuta
                    </button>
                  </div>
                )}
              </div>
            </SwipeableCard>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Tab B: Codici ───────────────────────────────────────────────────────────

const FILTER_CODES = [
  { id: "all",     label: "Tutti" },
  { id: "active",  label: "Attivi" },
  { id: "revoked", label: "Revocati" },
  { id: "expired", label: "Scaduti" },
];

function CodesTab() {
  const { toast } = useToast();
  const [codes, setCodes]   = useState<AccessCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [showNewCode, setShowNewCode] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await invFetch<{ codes: AccessCode[] }>(`/codes${filter !== "all" ? `?status=${filter}` : ""}`);
      setCodes(res.codes);
    } catch {
      toast({ title: "Errore nel caricamento dei codici", variant: "destructive" });
    } finally { setLoading(false); }
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  const regenerate = async (id: string) => {
    if (!confirm("Rigenerare questo codice? Il vecchio codice smetterà di funzionare immediatamente.")) return;
    try {
      const res = await invFetch<{ code: string }>(`/codes/${id}/regenerate`, { method: "POST" });
      setShowNewCode(res.code);
      load();
    } catch {
      toast({ title: "Errore", variant: "destructive" });
    }
  };

  const revoke = async (id: string) => {
    if (!confirm("Revocare questo codice di accesso?")) return;
    try {
      await invFetch(`/codes/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "revoked" }) });
      toast({ title: "Codice revocato" });
      load();
    } catch {
      toast({ title: "Errore", variant: "destructive" });
    }
  };

  const del = async (id: string) => {
    if (!confirm("Eliminare definitivamente questo codice?")) return;
    try {
      await invFetch(`/codes/${id}`, { method: "DELETE" });
      toast({ title: "Codice eliminato" });
      load();
    } catch {
      toast({ title: "Errore", variant: "destructive" });
    }
  };

  const copy = (text: string) => {
    navigator.clipboard.writeText(text).then(() =>
      toast({ title: "Copiato negli appunti" })
    );
  };

  return (
    <div className="space-y-4">
      {showNewCode && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-sidebar border border-gray-200 rounded-2xl p-6 max-w-sm w-full text-center">
            <p className="text-xl mb-2">✅</p>
            <p className="font-semibold text-white mb-1">Nuovo codice di accesso</p>
            <p className="font-mono text-2xl font-bold text-violet-400 tracking-widest my-4 select-all">{showNewCode}</p>
            <p className="text-xs text-gray-500 mb-4">Salva questo codice — non verrà mostrato di nuovo.</p>
            <div className="flex gap-2">
              <button onClick={() => copy(showNewCode)} className="flex-1 py-2 rounded-lg border border-gray-200 text-sm hover:text-white">Copia</button>
              <button onClick={() => setShowNewCode(null)} className="flex-1 py-2 rounded-lg bg-violet-600 text-white text-sm font-semibold">Fatto</button>
            </div>
          </div>
        </div>
      )}

      <div className="flex gap-2 flex-wrap">
        {FILTER_CODES.map(s => (
          <button key={s.id} onClick={() => setFilter(s.id)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
              filter === s.id ? "bg-violet-600 text-white" : "bg-gray-100 text-gray-600 hover:text-gray-900 border border-gray-200"
            }`}>
            {s.label}
          </button>
        ))}
        <button onClick={load} className="ml-auto px-3 py-1.5 rounded-lg text-xs border border-gray-300 bg-white text-gray-600 hover:text-gray-900 hover:border-gray-400">
          ↻ Aggiorna
        </button>
      </div>

      {loading ? (
        <p className="text-gray-500 text-sm">Caricamento…</p>
      ) : codes.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <p className="text-4xl mb-2">🔑</p>
          <p>Nessun codice trovato</p>
        </div>
      ) : (
        <div className="space-y-3">
          {codes.map((c) => (
            <div key={c._id} className="rounded-xl border border-white/10 bg-zinc-800 p-4 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-white truncate">{c.investorName}</p>
                  <p className="text-xs text-zinc-500 font-mono truncate">{c.investorEmail}</p>
                </div>
                <StatusBadge status={c.status} />
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-zinc-500">
                <span>📅 Creato: {fmtDate(c.createdAt)}</span>
                <span>⏳ Scade: {c.expiresAt ? fmtDate(c.expiresAt) : "Mai"}</span>
                <span>🕐 Ultimo uso: {fmtDate(c.lastUsedAt)}</span>
                <span>🔢 Accessi: {c.accessCount}</span>
              </div>
              <div className="flex gap-2 flex-wrap pt-1">
                {c.status === "active" && (
                  <button onClick={() => revoke(c._id)}
                    className="text-xs px-3 py-1.5 rounded-lg bg-red-700/30 text-red-400 border border-red-500/30 hover:bg-red-700/50 font-semibold">
                    Revoca
                  </button>
                )}
                <button onClick={() => regenerate(c._id)}
                  className="text-xs px-3 py-1.5 rounded-lg border border-zinc-600 text-zinc-400 hover:text-white">
                  ↻ Rigenera
                </button>
                <button onClick={() => del(c._id)}
                  className="text-xs px-3 py-1.5 rounded-lg border border-red-500/20 text-red-400/60 hover:text-red-400">
                  Elimina
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Tab C: Log ─────────────────────────────────────────────────────────────

const FILTER_LOG = [
  { id: "all",     label: "Tutti" },
  { id: "success", label: "Successo" },
  { id: "denied",  label: "Negati" },
  { id: "expired", label: "Scaduti" },
  { id: "revoked", label: "Revocati" },
];

function LogTab() {
  const { toast } = useToast();
  const [logs, setLogs]     = useState<AccessLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await invFetch<{ logs: AccessLog[] }>(`/log${filter !== "all" ? `?outcome=${filter}` : ""}`);
      setLogs(res.logs);
    } catch {
      toast({ title: "Errore nel caricamento del log", variant: "destructive" });
    } finally { setLoading(false); }
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex gap-2 flex-wrap">
        {FILTER_LOG.map(s => (
          <button key={s.id} onClick={() => setFilter(s.id)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
              filter === s.id ? "bg-violet-600 text-white" : "bg-gray-100 text-gray-600 hover:text-gray-900 border border-gray-200"
            }`}>
            {s.label}
          </button>
        ))}
        <button onClick={load} className="ml-auto px-3 py-1.5 rounded-lg text-xs border border-gray-300 bg-white text-gray-600 hover:text-gray-900 hover:border-gray-400">
          ↻ Aggiorna
        </button>
      </div>

      {loading ? (
        <p className="text-gray-500 text-sm">Caricamento…</p>
      ) : logs.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <p className="text-4xl mb-2">📊</p>
          <p>Nessun accesso registrato</p>
        </div>
      ) : (
        <div className="space-y-3">
          {logs.map((l) => (
            <div key={l._id} className="rounded-xl border border-white/10 bg-zinc-800 p-4 space-y-2">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-zinc-400 font-mono">{l.ip ?? "—"}</p>
                <StatusBadge status={l.outcome} />
              </div>
              <p className="text-xs text-zinc-400 truncate">
                {l.investorEmail ? `📧 ${l.investorEmail}` : "Utente sconosciuto"}
              </p>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500">
                <span>📅 {fmtDate(l.attemptedAt)}</span>
                {l.reason && <span>💬 {l.reason}</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Pagina principale ──────────────────────────────────────────────────────

type Tab = "requests" | "codes" | "log";

export default function InvestorAccessPage() {
  const [tab, setTab] = useState<Tab>("requests");

  const tabs: { id: Tab; label: string; icon: string }[] = [
    { id: "requests", label: "Richieste",  icon: "📋" },
    { id: "codes",    label: "Codici",     icon: "🔑" },
    { id: "log",      label: "Log",        icon: "📊" },
  ];

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-5">
      {/* Intestazione */}
      <div className="flex items-start gap-4">
        <div className="w-12 h-12 rounded-2xl bg-violet-600/20 border border-violet-500/30 flex items-center justify-center text-2xl shrink-0">
          🔐
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold text-white">Accesso Investitori</h1>
          <p className="text-sm text-gray-500">Virtual Data Room — gestione controllo accessi</p>
        </div>
      </div>

      {/* Toggle gate */}
      <GateToggle />

      {/* Tab */}
      <div className="border-b border-gray-200">
        <div className="flex">
          {tabs.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors flex-1 sm:flex-none justify-center sm:justify-start ${
                tab === t.id
                  ? "border-violet-500 text-white"
                  : "border-transparent text-gray-500 hover:text-white hover:border-gray-400"
              }`}
            >
              <span>{t.icon}</span>
              <span className="hidden sm:inline">{t.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Contenuto */}
      <div>
        {tab === "requests" && <RequestsTab />}
        {tab === "codes"    && <CodesTab />}
        {tab === "log"      && <LogTab />}
      </div>
    </div>
  );
}
