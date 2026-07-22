---
name: USDA Fintech Premium UX
description: Linee guida UX fintech premium per tutti i componenti USDA — errori umani, emoji eleganti, wallet chips, card no-wallet, success banners.
---

## Regola

Tutte le schermate, notifiche e messaggi USDA devono seguire lo stile fintech premium
(Revolut / PayPal / Cash App / Wise): nessun errore tecnico mai esposto all'utente.

**Why:** richiesta esplicita dell'utente. Il tono deve trasmettere fiducia, semplicità ed entusiasmo.

## Utility centralizzata

`src/lib/usda-errors.ts`:
- `humanizeUsdaError(raw, ctx?)` — mappa errori tecnici → testo umano con emoji
- `isRecipientNoWallet(raw)` — true se il destinatario non ha wallet USDA

**How to apply:** importare in TUTTI i catch block USDA del frontend.
Non scrivere mai `setError(err.message)` direttamente — passare sempre per `humanizeUsdaError`.

## Pattern: card "no wallet" per il destinatario

Quando `isRecipientNoWallet(raw) === true`, non mostrare il `.usda-error` rosso.
Mostrare invece `.usda-no-wallet-card` con:
- titolo emozionale ("💸 Hai provato a inviare X USDA a Mario")
- spiegazione soft
- lista bullets ✨ "una volta attivato potrete…"
- pulsante "OK, capito"

## Wallet chips

`.usda-wallet-chips` — row di chip visivi SOPRA il ConnectButton (non interattivi, solo indicativi).
Wallet: 🦊 MetaMask, 🐦 Trust, 🔐 WalletConnect, 🪙 Coinbase, 🌈 Rainbow.

## Signing step

`.usda-signing` con spinner ring, label dinamica (`signingStatus`), hint sicurezza,
timeout automatico 90 s con messaggio rassicurante.

## Status copy premium

- `preparing` → "✨ Preparazione in corso…"
- `signing`   → "🔐 Firma in corso…"
- `submitting` → "📡 Invio sulla blockchain…"
- `pending`   → "⛓️ Conferma blockchain in corso…"
- `confirmed` → "🎉 Pagamento completato!" / "🎉 Pagamento ricevuto!"
- `claimed`   → "🎉 Riscosso con successo"
- `refunded`  → "↩️ Importo rimborsato automaticamente"
- `failed`    → "❌ Pagamento non riuscito"

## Detail: status banners

Classi CSS differenziate per tipo esito:
- `.usda-detail-success-banner` (verde, 🎉)
- `.usda-detail-refund-banner`  (giallo, ↩️)
- `.usda-detail-failed-banner`  (rosso, ❌)
