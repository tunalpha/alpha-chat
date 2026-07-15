/**
 * GeoIP — lookup country code da indirizzo IP.
 *
 * Politica (CTO review Sprint 4):
 * - Salviamo SOLO country_code (es. "IT", "TN", "FR")
 * - NO città, NO coordinate (privacy by design)
 *
 * Implementazione attuale: stub che restituisce null.
 * TODO Sprint 5: integrare geoip-lite (DB locale, no API esterna)
 *   o MaxMind GeoLite2 (aggiornamento settimanale del DB).
 *
 * La lookup avviene PRIMA dell'hashing dell'IP:
 *   rawIp → countryCode → hash(rawIp) → store (ip_hash, country_code)
 */

/**
 * Restituisce il country code ISO 3166-1 alpha-2 per un IP.
 * Esempi: "IT", "US", "TN". Null se non determinabile.
 */
export function lookupCountryCode(rawIp: string | null | undefined): string | null {
  if (!rawIp) return null;

  // Localhost / IP privati → non loggare
  if (
    rawIp === "127.0.0.1" ||
    rawIp === "::1" ||
    rawIp.startsWith("192.168.") ||
    rawIp.startsWith("10.") ||
    rawIp.startsWith("172.16.")
  ) {
    return null;
  }

  // TODO Sprint 5: implementare lookup reale
  // Esempio con geoip-lite:
  //   const geo = geoip.lookup(rawIp);
  //   return geo?.country ?? null;

  return null;
}
