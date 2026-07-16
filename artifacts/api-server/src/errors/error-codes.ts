/**
 * Centralised error code → human-readable message map.
 * All codes must match 06_API.md — never add a code here without
 * adding it to the API spec first.
 */
export const ERROR_MESSAGES: Record<string, string> = {
  // Validation
  VALIDATION_ERROR: "Uno o più campi non sono validi.",

  // Auth
  AUTH_TOKEN_MISSING: "Token di autenticazione mancante.",
  AUTH_TOKEN_INVALID: "Token di autenticazione non valido.",
  AUTH_TOKEN_EXPIRED: "Il token di accesso è scaduto.",
  AUTH_TOKEN_REVOKED: "Il token di accesso è stato revocato.",
  REFRESH_TOKEN_INVALID: "Refresh token non valido.",
  REFRESH_TOKEN_EXPIRED: "Refresh token scaduto.",
  REFRESH_TOKEN_REUSED:
    "Refresh token già utilizzato. Per sicurezza tutte le sessioni sono state revocate.",
  INVALID_CREDENTIALS: "Username o password non corretti.",
  ACCOUNT_LOCKED: "Account temporaneamente bloccato per troppi tentativi falliti.",
  ACCOUNT_SUSPENDED: "Account sospeso.",
  TOTP_CODE_INVALID: "Codice di verifica non valido.",
  TOTP_CHALLENGE_EXPIRED: "La sessione di verifica è scaduta. Effettua nuovamente il login.",
  TOTP_TOO_MANY_ATTEMPTS: "Troppi tentativi falliti. Riprova tra qualche minuto.",

  // Permissions
  INSUFFICIENT_PERMISSIONS: "Permessi insufficienti per questa operazione.",
  NOT_CHAT_MEMBER: "Non sei membro di questa conversazione.",
  NOT_GROUP_ADMIN: "Solo gli amministratori possono eseguire questa operazione.",
  BLOCKED: "Non puoi interagire con questo utente.",
  CANNOT_DELETE_FOR_EVERYONE:
    "Non puoi eliminare questo messaggio per tutti. Devi essere il mittente e il messaggio deve avere meno di 48 ore.",
  CANNOT_CHAT_WITH_SELF: "Non puoi aprire una chat con te stesso.",
  CANNOT_ADD_SELF: "Non puoi aggiungere te stesso.",

  // Not found
  USER_NOT_FOUND: "Utente non trovato.",
  CHAT_NOT_FOUND: "Conversazione non trovata.",
  MESSAGE_NOT_FOUND: "Messaggio non trovato.",
  MEDIA_NOT_FOUND: "File non trovato.",
  INVITE_LINK_INVALID: "Link di invito non valido.",

  // Gone
  MESSAGE_ALREADY_DELETED: "Questo messaggio è già stato eliminato.",
  INVITE_LINK_EXPIRED: "Il link di invito è scaduto.",

  // Conflict
  USERNAME_TAKEN: "Questo username è già in uso.",
  EMAIL_TAKEN: "Questa email è già registrata.",
  PHONE_TAKEN: "Questo numero di telefono è già registrato.",
  CONTACT_ALREADY_EXISTS: "Questo utente è già nei tuoi contatti.",
  ALREADY_MEMBER: "Sei già membro di questo gruppo.",
  REACTION_ALREADY_EXISTS: "Hai già messo questa reazione.",

  // Business rules
  GROUP_FULL: "Il gruppo ha raggiunto il numero massimo di membri.",
  MEDIA_NOT_READY: "Il file è ancora in elaborazione. Riprova tra qualche secondo.",
  INVALID_EMOJI: "Questa emoji non è supportata.",
  USERNAME_CHANGE_TOO_SOON: "Hai cambiato username di recente. Puoi cambiarlo di nuovo tra qualche giorno.",
  USER_BLOCKED: "Hai bloccato questo utente o sei stato bloccato.",

  // Rate limit
  RATE_LIMIT_EXCEEDED: "Troppe richieste. Riprova tra qualche momento.",

  // Inviti
  INVITE_INVALID: "Codice non valido, già usato o scaduto.",
  INVITE_SELF_REDEEM: "Non puoi usare il tuo stesso codice invito.",

  // Payload
  PAYLOAD_TOO_LARGE: "File troppo grande. Riduci la dimensione e riprova.",

  // System
  INTERNAL_ERROR: "Errore interno del server. Il team è stato notificato.",
  SERVICE_UNAVAILABLE: "Servizio temporaneamente non disponibile. Riprova tra qualche minuto.",
};
