/**
 * spark-admin-register.ts — Registrazione stato Spark nell'admin monitor
 *
 * Fire-and-forget: chiama POST /api/v1/spark/user-status quando l'utente
 * si connette a Spark Lightning. L'errore è ignorato silenziosamente —
 * non impatta il flusso Spark (connect/send/receive).
 *
 * NON modifica: Breez SDK, connect(), syncWallet(), send, receive, balance,
 * fee model, Payment Engine, BTC on-chain, Signal/Chat.
 *
 * Usato solo da AlphaWalletPage.tsx (monitoring side-effect).
 */

/** Chiave localStorage del token di accesso Alpha Chat. */
const AC_TOKEN_KEY = "ac_access_token";

/**
 * Registra/aggiorna lo stato Spark dell'utente autenticato nel monitor admin.
 *
 * Viene chiamato quando `spark.state` diventa "connected" (status="enabled").
 * Fire-and-forget: non aspettare il risultato, ignorare errori.
 *
 * @param status "enabled" quando connesso a Spark, "disabled" se esplicitamente disconnesso
 */
export async function apiRegisterSparkStatus(
  status: "enabled" | "disabled",
): Promise<void> {
  const token = localStorage.getItem(AC_TOKEN_KEY);
  if (!token) return; // Utente non autenticato — niente da registrare

  // URL relativa: stessa base del frontend (proxied a api-server in dev/prod)
  await fetch("/api/v1/spark/user-status", {
    method:  "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type":  "application/json",
    },
    body: JSON.stringify({ status }),
  });
  // Errori HTTP ignorati — questo è puro monitoring, non blocca il wallet
}
