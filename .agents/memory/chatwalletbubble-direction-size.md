---
name: ChatWalletPaymentBubble — direction + size bugs
description: Direction inversion e size ridotta per wallet_payment (Alpha Wallet USDA) in chat bubble
---

## Direction Bug (FIXED)

**Regola:** NON usare `meta.direction` per decidere l'icona/testo di direzione in `ChatWalletPaymentBubble`.

**Why:** `WalletPaymentMeta.direction` è sempre "out" (prospettiva del mittente al momento della creazione del messaggio). Il destinatario riceve lo stesso messaggio con `direction: "out"` nel system_metadata → vede "🚀 CRIPTO INVIATA" invece di "📩 CRIPTO RICEVUTA".

**How to apply:** Usare sempre `isMine` per derivare la direzione effettiva nel componente:
```typescript
const effectiveDirection: "out" | "in" = isMine ? "out" : "in";
```
Applicare `effectiveDirection` a: dirIcon, dirText, statusIcon, statusSub.

## Size Bug (FIXED)

**Regola:** I messaggi `wallet_payment` DEVONO avere la classe CSS `payment-bubble` nel wrapper `msg-bubble` di ChatPage.tsx.

**Why:** Senza `payment-bubble`, il wrapper segue `max-width: 70%` invece di `width: 340px; max-width: 88%`. Con contenuto breve ("1 USDA" vs "BNB Smart Chain · USDT"), la bolla si restringe e appare più piccola delle altre payment bubbles.

**How to apply:** In ChatPage.tsx nella classe del `msg-bubble`, aggiungere `wallet_payment` alla condizione:
```typescript
${(msg.message_type === "payment" || msg.message_type === "usda_request" || msg.message_type === "usda_send" || msg.message_type === "wallet_payment") ? "payment-bubble" : ""}
```

## Context

- La bolla USDA in chat è `ChatWalletPaymentBubble` (message_type: "wallet_payment"), NON `UsdaPaymentBubble` né `MultiChainPaymentBubble`
- File `ChatWalletPaymentBubble.css` è vuoto (nessun override CSS specifico necessario)
- 1074 test PASS dopo i fix
