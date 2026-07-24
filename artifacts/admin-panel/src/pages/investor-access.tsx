/**
 * Investor Access — Admin Page
 *
 * Tab A: Access Requests
 * Tab B: Access Codes
 * Tab C: Access Log
 */

import { useState, useEffect, useCallback } from "react";
import { useToast } from "@/hooks/use-toast";
import { getToken } from "@/lib/api";

// Investor endpoints live at /api/v1/investor/admin (NOT under /api/v1/admin)
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
    throw new Error("Unauthorized");
  }
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try { const b = await res.json(); message = b?.message ?? b?.error?.message ?? message; } catch {}
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

// ─── Types ─────────────────────────────────────────────────────────────────

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
  { label: "7 days",        value: 7   },
  { label: "15 days",       value: 15  },
  { label: "30 days",       value: 30  },
  { label: "60 days",       value: 60  },
  { label: "90 days",       value: 90  },
  { label: "180 days",      value: 180 },
  { label: "365 days",      value: 365 },
  { label: "No expiry",     value: 0   },
];

function fmtDate(d?: string) {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
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
      {status.toUpperCase()}
    </span>
  );
}

// ─── Approve Modal ──────────────────────────────────────────────────────────

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
      toast({ title: "Code generated", description: `Code: ${res.code}` });
      onDone();
      onClose();
    } catch {
      toast({ title: "Error", description: "Failed to generate code", variant: "destructive" });
    } finally { setLoading(false); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-sidebar border border-sidebar-border rounded-2xl w-full max-w-md p-6 space-y-4 shadow-2xl">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-white">Generate Investor Access Code</h3>
          <button onClick={onClose} className="text-sidebar-foreground/40 hover:text-white">✕</button>
        </div>
        <p className="text-sm text-sidebar-foreground/60">Approving request from <strong className="text-white">{request.name}</strong> · {request.company}</p>

        <div className="space-y-3">
          <div>
            <label className="text-xs font-semibold text-sidebar-foreground/50 uppercase tracking-wider">Access Code (auto-generated, editable)</label>
            <div className="flex gap-2 mt-1">
              <input
                value={code} onChange={e => setCode(e.target.value.toUpperCase())}
                className="flex-1 bg-sidebar-accent border border-sidebar-border rounded-lg px-3 py-2 text-white font-mono text-sm tracking-widest"
              />
              <button onClick={() => setCode(generateFrontendCode())}
                className="px-3 py-2 rounded-lg border border-sidebar-border text-xs text-sidebar-foreground/60 hover:text-white hover:border-white/20">
                ↻
              </button>
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold text-sidebar-foreground/50 uppercase tracking-wider">Investor Name</label>
            <input value={name} onChange={e => setName(e.target.value)}
              className="w-full mt-1 bg-sidebar-accent border border-sidebar-border rounded-lg px-3 py-2 text-white text-sm" />
          </div>
          <div>
            <label className="text-xs font-semibold text-sidebar-foreground/50 uppercase tracking-wider">Email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)}
              className="w-full mt-1 bg-sidebar-accent border border-sidebar-border rounded-lg px-3 py-2 text-white text-sm" />
          </div>
          <div>
            <label className="text-xs font-semibold text-sidebar-foreground/50 uppercase tracking-wider">Validity</label>
            <select value={validity} onChange={e => setValidity(Number(e.target.value))}
              className="w-full mt-1 bg-sidebar-accent border border-sidebar-border rounded-lg px-3 py-2 text-white text-sm">
              {VALIDITY_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <label className="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" checked={sendEmail} onChange={e => setSendEmail(e.target.checked)}
              className="w-4 h-4 rounded border-sidebar-border accent-violet-500" />
            <span className="text-sm text-sidebar-foreground/80">Send code automatically via email</span>
          </label>
        </div>

        <div className="flex gap-3 pt-2">
          <button onClick={onClose} className="flex-1 py-2 rounded-lg border border-sidebar-border text-sm text-sidebar-foreground/60 hover:text-white">
            Cancel
          </button>
          <button onClick={submit} disabled={loading}
            className="flex-1 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold disabled:opacity-50">
            {loading ? "Generating…" : "Generate Access Code"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Tab A: Requests ────────────────────────────────────────────────────────

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
      toast({ title: "Error loading requests", variant: "destructive" });
    } finally { setLoading(false); }
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  const reject = async (id: string) => {
    if (!confirm("Reject this request?")) return;
    try {
      await invFetch(`/requests/${id}/reject`, { method: "POST" });
      toast({ title: "Request rejected" });
      load();
    } catch {
      toast({ title: "Error", variant: "destructive" });
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

      {/* Filter */}
      <div className="flex gap-2">
        {["all","pending","approved","rejected"].map(s => (
          <button key={s} onClick={() => setFilter(s)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold capitalize transition-colors ${
              filter === s ? "bg-violet-600 text-white" : "bg-sidebar-accent text-sidebar-foreground/60 hover:text-white border border-sidebar-border"
            }`}>
            {s}
          </button>
        ))}
        <button onClick={load} className="ml-auto px-3 py-1.5 rounded-lg text-xs border border-sidebar-border text-sidebar-foreground/60 hover:text-white">
          ↻ Refresh
        </button>
      </div>

      {loading ? (
        <p className="text-sidebar-foreground/50 text-sm">Loading…</p>
      ) : requests.length === 0 ? (
        <div className="text-center py-12 text-sidebar-foreground/40">
          <p className="text-4xl mb-2">📋</p>
          <p>No requests found</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-sidebar-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-sidebar-border bg-sidebar-accent/50">
                {["Name","Company","Email","Date","Status","Actions"].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-sidebar-foreground/50 uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {requests.map((r, i) => (
                <tr key={r._id} className={`border-b border-sidebar-border/50 transition-colors hover:bg-sidebar-accent/30 ${i % 2 === 0 ? "" : "bg-sidebar-accent/10"}`}>
                  <td className="px-4 py-3 font-medium text-white">{r.name}</td>
                  <td className="px-4 py-3 text-sidebar-foreground/70">{r.company}</td>
                  <td className="px-4 py-3 text-sidebar-foreground/70 font-mono text-xs">{r.email}</td>
                  <td className="px-4 py-3 text-sidebar-foreground/50 text-xs">{fmtDate(r.requestedAt)}</td>
                  <td className="px-4 py-3"><StatusBadge status={r.status} /></td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {r.message && (
                        <button title={r.message} className="text-xs text-sidebar-foreground/40 hover:text-white px-2 py-1 rounded border border-sidebar-border">
                          View
                        </button>
                      )}
                      {r.status === "pending" && (
                        <>
                          <button onClick={() => setApproving(r)}
                            className="text-xs px-2 py-1 rounded bg-green-700/30 text-green-400 border border-green-500/30 hover:bg-green-700/50">
                            Approve
                          </button>
                          <button onClick={() => reject(r._id)}
                            className="text-xs px-2 py-1 rounded bg-red-700/30 text-red-400 border border-red-500/30 hover:bg-red-700/50">
                            Reject
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Tab B: Codes ───────────────────────────────────────────────────────────

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
      toast({ title: "Error loading codes", variant: "destructive" });
    } finally { setLoading(false); }
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  const regenerate = async (id: string) => {
    if (!confirm("Regenerate this code? The old code will stop working immediately.")) return;
    try {
      const res = await invFetch<{ code: string }>(`/codes/${id}/regenerate`, { method: "POST" });
      setShowNewCode(res.code);
      load();
    } catch {
      toast({ title: "Error", variant: "destructive" });
    }
  };

  const revoke = async (id: string) => {
    if (!confirm("Revoke this access code?")) return;
    try {
      await invFetch(`/codes/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "revoked" }) });
      toast({ title: "Code revoked" });
      load();
    } catch {
      toast({ title: "Error", variant: "destructive" });
    }
  };

  const del = async (id: string) => {
    if (!confirm("Permanently delete this code?")) return;
    try {
      await invFetch(`/codes/${id}`, { method: "DELETE" });
      toast({ title: "Code deleted" });
      load();
    } catch {
      toast({ title: "Error", variant: "destructive" });
    }
  };

  const copy = (text: string) => {
    navigator.clipboard.writeText(text).then(() =>
      toast({ title: "Copied to clipboard" })
    );
  };

  return (
    <div className="space-y-4">
      {showNewCode && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center">
          <div className="bg-sidebar border border-sidebar-border rounded-2xl p-6 max-w-sm w-full text-center">
            <p className="text-xl mb-2">✅</p>
            <p className="font-semibold text-white mb-1">New Access Code</p>
            <p className="font-mono text-2xl font-bold text-violet-400 tracking-widest my-4 select-all">{showNewCode}</p>
            <p className="text-xs text-sidebar-foreground/50 mb-4">Save this code — it won't be shown again.</p>
            <div className="flex gap-2">
              <button onClick={() => copy(showNewCode)} className="flex-1 py-2 rounded-lg border border-sidebar-border text-sm hover:text-white">Copy</button>
              <button onClick={() => setShowNewCode(null)} className="flex-1 py-2 rounded-lg bg-violet-600 text-white text-sm font-semibold">Done</button>
            </div>
          </div>
        </div>
      )}

      <div className="flex gap-2">
        {["all","active","revoked","expired"].map(s => (
          <button key={s} onClick={() => setFilter(s)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold capitalize transition-colors ${
              filter === s ? "bg-violet-600 text-white" : "bg-sidebar-accent text-sidebar-foreground/60 hover:text-white border border-sidebar-border"
            }`}>
            {s}
          </button>
        ))}
        <button onClick={load} className="ml-auto px-3 py-1.5 rounded-lg text-xs border border-sidebar-border text-sidebar-foreground/60 hover:text-white">
          ↻ Refresh
        </button>
      </div>

      {loading ? (
        <p className="text-sidebar-foreground/50 text-sm">Loading…</p>
      ) : codes.length === 0 ? (
        <div className="text-center py-12 text-sidebar-foreground/40">
          <p className="text-4xl mb-2">🔑</p>
          <p>No codes found</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-sidebar-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-sidebar-border bg-sidebar-accent/50">
                {["Investor","Email","Created","Expires","Last Used","Uses","Status","Actions"].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-sidebar-foreground/50 uppercase tracking-wider whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {codes.map((c, i) => (
                <tr key={c._id} className={`border-b border-sidebar-border/50 hover:bg-sidebar-accent/30 ${i % 2 === 0 ? "" : "bg-sidebar-accent/10"}`}>
                  <td className="px-4 py-3 font-medium text-white whitespace-nowrap">{c.investorName}</td>
                  <td className="px-4 py-3 text-sidebar-foreground/70 font-mono text-xs">{c.investorEmail}</td>
                  <td className="px-4 py-3 text-sidebar-foreground/50 text-xs whitespace-nowrap">{fmtDate(c.createdAt)}</td>
                  <td className="px-4 py-3 text-sidebar-foreground/50 text-xs whitespace-nowrap">{c.expiresAt ? fmtDate(c.expiresAt) : "∞ Never"}</td>
                  <td className="px-4 py-3 text-sidebar-foreground/50 text-xs whitespace-nowrap">{fmtDate(c.lastUsedAt)}</td>
                  <td className="px-4 py-3 text-center">{c.accessCount}</td>
                  <td className="px-4 py-3"><StatusBadge status={c.status} /></td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {c.status === "active" && (
                        <>
                          <button onClick={() => revoke(c._id)}
                            className="text-xs px-2 py-1 rounded bg-red-700/30 text-red-400 border border-red-500/30 hover:bg-red-700/50 whitespace-nowrap">
                            Revoke
                          </button>
                        </>
                      )}
                      <button onClick={() => regenerate(c._id)}
                        className="text-xs px-2 py-1 rounded border border-sidebar-border text-sidebar-foreground/60 hover:text-white whitespace-nowrap">
                        Regen
                      </button>
                      <button onClick={() => del(c._id)}
                        className="text-xs px-2 py-1 rounded border border-red-500/20 text-red-400/60 hover:text-red-400 whitespace-nowrap">
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Tab C: Log ─────────────────────────────────────────────────────────────

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
      toast({ title: "Error loading log", variant: "destructive" });
    } finally { setLoading(false); }
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex gap-2 flex-wrap">
        {["all","success","denied","expired","revoked"].map(s => (
          <button key={s} onClick={() => setFilter(s)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold capitalize transition-colors ${
              filter === s ? "bg-violet-600 text-white" : "bg-sidebar-accent text-sidebar-foreground/60 hover:text-white border border-sidebar-border"
            }`}>
            {s}
          </button>
        ))}
        <button onClick={load} className="ml-auto px-3 py-1.5 rounded-lg text-xs border border-sidebar-border text-sidebar-foreground/60 hover:text-white">
          ↻ Refresh
        </button>
      </div>

      {loading ? (
        <p className="text-sidebar-foreground/50 text-sm">Loading…</p>
      ) : logs.length === 0 ? (
        <div className="text-center py-12 text-sidebar-foreground/40">
          <p className="text-4xl mb-2">📊</p>
          <p>No access log entries</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-sidebar-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-sidebar-border bg-sidebar-accent/50">
                {["Date","IP","Email","Outcome","Reason"].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-sidebar-foreground/50 uppercase tracking-wider whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {logs.map((l, i) => (
                <tr key={l._id} className={`border-b border-sidebar-border/50 hover:bg-sidebar-accent/30 ${i % 2 === 0 ? "" : "bg-sidebar-accent/10"}`}>
                  <td className="px-4 py-3 text-sidebar-foreground/50 text-xs whitespace-nowrap">{fmtDate(l.attemptedAt)}</td>
                  <td className="px-4 py-3 text-sidebar-foreground/70 font-mono text-xs whitespace-nowrap">{l.ip ?? "—"}</td>
                  <td className="px-4 py-3 text-sidebar-foreground/70 font-mono text-xs">{l.investorEmail ?? "—"}</td>
                  <td className="px-4 py-3"><StatusBadge status={l.outcome} /></td>
                  <td className="px-4 py-3 text-sidebar-foreground/50 text-xs">{l.reason ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Main Page ──────────────────────────────────────────────────────────────

type Tab = "requests" | "codes" | "log";

export default function InvestorAccessPage() {
  const [tab, setTab] = useState<Tab>("requests");

  const tabs: { id: Tab; label: string; icon: string }[] = [
    { id: "requests", label: "Access Requests", icon: "📋" },
    { id: "codes",    label: "Access Codes",    icon: "🔑" },
    { id: "log",      label: "Access Log",       icon: "📊" },
  ];

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <div className="w-12 h-12 rounded-2xl bg-violet-600/20 border border-violet-500/30 flex items-center justify-center text-2xl">
          🔐
        </div>
        <div>
          <h1 className="text-2xl font-bold text-white">Investor Access</h1>
          <p className="text-sm text-sidebar-foreground/50">Virtual Data Room — access control management</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-sidebar-border">
        <div className="flex gap-1">
          {tabs.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                tab === t.id
                  ? "border-violet-500 text-white"
                  : "border-transparent text-sidebar-foreground/50 hover:text-white hover:border-sidebar-border"
              }`}
            >
              <span>{t.icon}</span>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div>
        {tab === "requests" && <RequestsTab />}
        {tab === "codes"    && <CodesTab />}
        {tab === "log"      && <LogTab />}
      </div>
    </div>
  );
}
