---
name: USDA /api/pay/request contract
description: Contratto reale dell'endpoint POST /api/pay/request su getusda.xyz e come AlphaChat lo chiama
---

## Contratto reale (da source tunalpha/Stablecoin-usda)

```
POST https://getusda.xyz/api/pay/request
Content-Type: application/json

{
  "requesterWallet": "0x...",  // wallet Polygon del richiedente — OBBLIGATORIO
  "amount": 1.0,               // numero float (parseFloat compatibile)
  "note": "...",               // opzionale
  "lang": "it"                 // opzionale, default "en"
}
```

Risposta successo:
```json
{ "code": "...", "shareLink": "https://getusda.xyz/pay?code=...", "claim_expires_at": "..." }
```

Errore se manca requesterWallet o amount:
```json
{ "error": "Wallet e importo richiesti" }
```

## Causa del bug originale

AlphaChat inviava `from_user_id`/`to_user_id` (MongoDB ObjectId) — campi sconosciuti all'API.
Il messaggio di errore "Wallet e importo richiesti" era costante anche per `{}` perché
la validazione controlla `requesterWallet` (non present → sempre 400).

## Semantica dell'endpoint

- Link-based, NON user-to-user
- `requesterWallet` = chi chiede il pagamento
- Il `shareLink` restituito è un URL pubblico che chiunque può aprire per pagare
- Non esiste `to_user_id` — il pagante non è noto al server USDA

## Fix applicato

1. `http-usda.adapter.ts` → payload usa `requesterWallet` + `parseFloat(amount)`
2. `usda.service.ts` → fetch wallet da MongoDB prima di chiamare l'adapter (wallets.usda.address ?? wallet_address)
3. `usda-payment.model.ts` + repo → campo `share_link` persistito su MongoDB
4. `_formatPayment` → propaga `share_link` al client
5. `system_metadata` del messaggio → include `share_link`
6. `UsdaRequestBubble.tsx` → pulsante "🔗 Paga ora" apre shareLink; fallback `onPay` se assente
7. CSS → `.usda-pay-btn--ghost` per sender

**Why:** L'API getusda.xyz non espone un endpoint user-to-user. Il modello è invoice/link.

**How to apply:** Se in futuro si vuole un sistema nativo user-to-user, occorre un endpoint
dedicato sul backend USDA — non è ottenibile riutilizzando /api/pay/request.
