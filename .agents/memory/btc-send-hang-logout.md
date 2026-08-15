---
name: BTC send spinner infinito + logout REFRESH_TOKEN_REUSED
description: iOS congela fetch senza timeout in walletRequest; refresh abortito post-rotazione causava logout; finestra di grazia 30s
---

**Incidente (2026-08-15, produzione):** invio BTC bloccato per sempre su "Firma e broadcast in corso" + logout forzato. Nessun fondo mosso (broadcast mai arrivato al server — verificato nei log deployment: solo balance/transactions, zero `/btc/broadcast`).

**Root cause 1 — spinner:** `walletRequest` (alpha-wallet-api.ts) usava fetch nudo senza timeout; iOS Safari congela/aborta le richieste quando l'app va in background; `Promise.all(utxos, feeRate)` in btc-signer → una richiesta appesa = spinner eterno, nessun safety-net su step "processing".
**Fix:** AbortController 30s in walletRequest; abort/errore rete → `WalletNetworkError` (code `WALLET_NETWORK_ERROR`, messaggio "controlla saldo e storico prima di riprovare").

**Root cause 2 — logout:** client invia refresh → server ruota → iOS aborta la risposta → client riprova col token precedente → theft detection S-03 → famiglia revocata → logout.
**Fix:** finestra di grazia 30s in `rotateRefreshToken`: se il token presentato matcha `previous_refresh_token_hash`, sessione attiva e rotazione originale < 30s fa → nuova rotazione idempotente (token orfano invalidato).
**SECURITY (trappola review):** nel retry di grazia NON aggiornare `last_used_at` — altrimenti il replay continuo del vecchio token estende la finestra all'infinito (vulnerabilità trovata dall'architect al primo giro). La finestra resta ancorata alla rotazione originale.

**Nota test:** `registerLimiter` (5/ora) faceva fallire i test integration che registrano un utente per caso → `max: 100000` se NODE_ENV=test. Rossi pre-esistenti da env: TTL token (15min/30gg attesi vs env), temp-password 401, payment-quote import check.

**How to apply:** ogni nuova chiamata di rete in flussi di firma/pagamento DEVE avere timeout + errore umano; mai lasciare uno spinner dipendente da un fetch senza AbortController.
