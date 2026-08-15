---
name: Lightning send guard — timeout + riconciliazione
description: sendPayment WASM Breez/Spark senza timeout → spinner infinito; pattern single-owner anti double-pay
---

**Incidente 2026-08-15 (secondo spinner infinito):** dopo il fix walletRequest 30s, l'invio *Lightning* restava bloccato per sempre: `sdk.sendPayment` (WASM, tutto client-side) non ha timeout e non produce log server — la diagnosi chiave è che sui log prod NON arriva nessuna chiamata `/btc/*`.

**Soluzione — `src/lib/spark/spark-send-guard.ts` (`sendLightningGuarded`):**
- timeout 60s sul send primario; durante la riconciliazione il primario resta in gara (single-owner: solo UNO tra sent / reconciled / errore SDK / uncertain);
- riconciliazione per invoice BOLT11 nello storico SDK (finestra 200, match case-insensitive, solo tipi *_sent);
- `onLateResolve` armata SOLO dopo esito incerto definitivo → mai doppia persistenza IDB;
- lock persistente localStorage `aw_ln_uncertain_v1` verificato con `resolveUncertainMarker()` prima di ogni nuovo invio (sopravvive a unmount/riapertura);
- assenza dallo storico ≠ prova di non-pagamento: sblocco solo dopo 15 min (risk policy esplicita; backstop: la rete rifiuta il ri-pagamento della stessa BOLT11 già saldata);
- BOLT11-only imposto al boundary UI (LNURL/Lightning Address/BOLT12 vietati: un retry dinamico risolverebbe una NUOVA invoice → doppio pagamento);
- UI: su esito incerto niente "Riprova", lock mantenuto.

**ROOT CAUSE EFFETTIVO (2026-08-15):** `sendPayment()` WASM richiede `{ prepareResponse: PrepareSendPaymentResponse }` come unico campo — il SDK TypeScript lo dichiara esplicitamente. Il live adapter la chiamava con `{ paymentRequest, amount }` (parametri di `prepareSendPayment`): campi sconosciuti → Promise mai risolta. Fix: `prepareSend()` salva la risposta RAW in `_lastPrepareResponse`; `send()` la consuma e la passa come `prepareResponse`. Senza questo il pagamento non parte MAI, indipendentemente dalla rete.

**Why:** qualsiasi timeout su un pagamento già firmato/inviato deve produrre "esito incerto + blocco retry + riconciliazione", MAI "errore + riprova".
**How to apply:** ogni nuova via di pagamento client-side (WASM/SDK) deve passare da un guard con questo contratto; review architect ha richiesto 4 round (FAIL×3) proprio su finestra storico, durabilità del lock e richieste dinamiche.
