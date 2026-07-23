/**
 * usda-errors.ts — trasforma errori tecnici in messaggi umani e rassicuranti.
 *
 * Linea guida UX fintech AlphaChat:
 * Nessun messaggio freddo o tecnico (Error 400, HTTP 404, Wallet missing…).
 * Ogni errore deve essere orientato alla soluzione, emozionale e rassicurante.
 */

export function humanizeUsdaError(
  raw: string,
  ctx?: { toName?: string },
): string {
  if (!raw) return "Si è verificato un problema. Riprova tra qualche secondo.";

  // Errori già umanizzati dal backend (RECIPIENT_NO_WALLET, etc.) — restituisci as-is
  if (/non ha ancora attivato|non hai ancora attivato|Chiedigli/i.test(raw)) return raw;
  if (/Non puoi inviare.*a te stesso/i.test(raw)) return "💡 Non puoi inviare USDA a te stesso.";

  // Il richiedente non ha un wallet USDA: serve per ricevere l'accredito
  // automatico quando qualcuno paga la richiesta.
  if (/WALLET_NOT_CONFIGURED/i.test(raw))
    return "💳 Per richiedere USDA devi prima attivare il tuo wallet: chi paga la richiesta ti accredita i fondi automaticamente lì. Collega il wallet e riprova.";

  // Wallet / firma
  if (/user rejected|user denied|rejected by user/i.test(raw))
    return "Hai annullato la firma nel wallet. Ripremi «Firma e Invia» quando sei pronto.";
  // Sessione WalletConnect/deep-link interrotta — causa tipica su iOS: il wallet
  // non si apre e la firma non parte mai.
  if (/no.*matching.*(session|key)|session.*(not|expired|topic|deleted|reset)|no active|not connected|pairing|relayer|socket stalled|connection.*(reset|closed|stalled)|request reset|record was recently deleted/i.test(raw))
    return "🔗 La sessione con il wallet si è interrotta e la firma non è partita. Riconnetti il wallet e riprova a firmare.";
  if (/insufficient funds|not enough gas/i.test(raw))
    return "💡 Non hai abbastanza MATIC per le commissioni di rete. Aggiungi MATIC al wallet e riprova.";
  if (/wrong network|wrong chain|unrecognized chain/i.test(raw))
    return "⚠️ Rete non corretta — passa a Polygon Mainnet nel wallet e riprova.";
  if (/locked|access denied/i.test(raw))
    return "🔒 Il wallet è bloccato. Sblocca l'app wallet e ripremi «Firma e Invia».";
  if (/timeout|timed out/i.test(raw))
    return "⏱️ La firma ha impiegato troppo tempo. Il wallet è ancora connesso — riprova pure.";
  if (/no.*recipient.*address|recipient.*address.*not/i.test(raw))
    return ctx?.toName
      ? `${ctx.toName} non ha ancora attivato il wallet USDA. Chiedigli di farlo prima di inviargli denaro.`
      : "Il destinatario non ha ancora un wallet USDA attivo.";

  // Rete / server
  if (/fetch|ECONNREFUSED|network|ERR_NETWORK/i.test(raw))
    return "📡 Nessuna connessione. Controlla la rete e riprova.";
  if (/503|service unavailable|unavailable/i.test(raw))
    return "⚙️ Il servizio USDA è temporaneamente non disponibile. Riprova tra qualche minuto.";
  if (/400|404|500|API error|Internal|server error/i.test(raw))
    return "Si è verificato un problema temporaneo. Riprova tra qualche secondo.";

  // Importo
  if (/amount|importo|insufficient.*usda/i.test(raw))
    return "💡 Saldo USDA insufficiente. Verifica il tuo saldo e riprova.";

  // Membership / autorizzazione
  if (/NOT_CHAT_MEMBER|403/i.test(raw))
    return "Non sei autorizzato a inviare pagamenti in questa chat.";

  // Codice grezzo non tradotto (es. "USDA_API_ERROR") — mostra messaggio generico
  // invece del codice tecnico
  if (/^[A-Z_]{4,}$/.test(raw.trim()))
    return "Si è verificato un problema temporaneo. Riprova tra qualche secondo.";

  // Fallback — restituisci il messaggio originale se non riconosciuto
  return raw;
}

/** True se l'errore indica che il destinatario non ha un wallet USDA */
export function isRecipientNoWallet(raw: string): boolean {
  return /RECIPIENT_NO_WALLET|non ha ancora attivato|recipient.*no.*wallet/i.test(raw);
}
