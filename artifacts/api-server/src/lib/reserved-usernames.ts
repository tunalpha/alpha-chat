/**
 * Lista username riservati — non assegnabili agli utenti.
 *
 * Estendibile senza modificare il codice tramite env var:
 *   RESERVED_USERNAMES_EXTRA=newterm1,newterm2
 *
 * I termini sono case-insensitive (confronto in lowercase).
 */

const BUILTIN_RESERVED: ReadonlyArray<string> = [
  // Brand / sistema
  "alphachat", "alpha", "official", "staff", "team", "admin", "administrator",
  // Ruoli sistema
  "root", "system", "owner", "operator", "moderator", "mod",
  // Supporto
  "support", "help", "helpdesk", "info", "contact", "legal", "privacy",
  "abuse", "security", "safety", "trust",
  // API / tecnico
  "api", "app", "bot", "webhook", "oauth", "auth", "login", "logout",
  "register", "signup", "signin", "verify", "callback",
  // Parole riservate
  "null", "undefined", "true", "false", "none", "test", "demo",
  "example", "sample", "placeholder", "anonymous", "guest", "user",
  // Numeri / simboli
  "000", "0000",
];

let _cachedSet: Set<string> | null = null;

/**
 * Restituisce il set completo di username riservati (builtin + extra da env).
 * Risultato cached dopo la prima chiamata.
 */
export function getReservedUsernames(): Set<string> {
  if (_cachedSet) return _cachedSet;

  const all = new Set(BUILTIN_RESERVED.map((u) => u.toLowerCase()));

  const extra = process.env["RESERVED_USERNAMES_EXTRA"];
  if (extra) {
    for (const term of extra.split(",")) {
      const trimmed = term.trim().toLowerCase();
      if (trimmed.length > 0) all.add(trimmed);
    }
  }

  _cachedSet = all;
  return _cachedSet;
}

/**
 * Verifica se uno username è riservato.
 * Case-insensitive.
 */
export function isReservedUsername(username: string): boolean {
  return getReservedUsernames().has(username.toLowerCase().trim());
}

/** Resetta la cache — usato nei test. */
export function _resetReservedCache(): void {
  _cachedSet = null;
}
