/**
 * Portal session helpers — usati da InvestorGate e PortalLayout.
 */

const SESSION_KEY = 'ib_secure_session';

export interface PortalSession {
  investorName: string;
  sessionExpiry: string;
  grantedAt: number;
}

export function loadPortalSession(): PortalSession | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as PortalSession;
    if (new Date(s.sessionExpiry) < new Date()) {
      sessionStorage.removeItem(SESSION_KEY);
      return null;
    }
    return s;
  } catch { return null; }
}

export function savePortalSession(s: PortalSession): void {
  try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(s)); } catch {}
}

export function clearPortalSession(): void {
  try { sessionStorage.removeItem(SESSION_KEY); } catch {}
}
