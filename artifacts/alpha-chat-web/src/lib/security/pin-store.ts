/**
 * PIN Store — Sprint 17
 *
 * Il PIN viene hashato con SHA-256(userId + ":" + pin) prima di essere
 * salvato in localStorage. Il PIN in chiaro non viene mai persistito.
 */

const KEY = (userId: string) => `alpha-chat-pin-hash:${userId}`;

async function hashPIN(userId: string, pin: string): Promise<string> {
  const data = new TextEncoder().encode(`${userId}:${pin}`);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function hasPIN(userId: string): boolean {
  return !!localStorage.getItem(KEY(userId));
}

export async function savePIN(userId: string, pin: string): Promise<void> {
  const hash = await hashPIN(userId, pin);
  localStorage.setItem(KEY(userId), hash);
}

export async function verifyPIN(userId: string, pin: string): Promise<boolean> {
  const stored = localStorage.getItem(KEY(userId));
  if (!stored) return false;
  const hash = await hashPIN(userId, pin);
  return hash === stored;
}

export function removePIN(userId: string): void {
  localStorage.removeItem(KEY(userId));
}
