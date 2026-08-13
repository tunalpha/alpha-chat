---
name: Lightning Invoice Deep Link
description: Deep link system per condivisione invoice BOLT11 — /pay/lightning/:invoiceId
---

# Lightning Invoice Deep Link

## Architettura
- **Backend**: `POST /api/v1/lightning/invoice-links` (autenticato) crea link con ID opaque 12-char base64url
- **Backend**: `GET /api/v1/lightning/invoice-links/:invoiceId` (pubblico, no auth) restituisce bolt11+metadata
- **Model**: `lightning_invoice_links` — TTL 24h, nessun userId (privacy by design)
- **Frontend**: `SparkPayPage.tsx` — route `/pay/lightning/:id` riconosciuta in App.tsx via `isPayLightningPath()`
- **SPA fallback**: server.mjs serve index.html per qualsiasi path → React gestisce il render di SparkPayPage

## Pattern routing App.tsx
Stesso pattern di `isEmergencyPath()`: funzione fuori da AppContent, guard `if (isPayLightningPath()) return <SparkPayPage />` PRIMA di isLoading e auth check (pagina pubblica).

## AppError signature
`AppError(code: string, httpStatus: number, field?: string, details?: Record<string, unknown>)`
NON AppError(code, message, status) — il messaggio non esiste come parametro separato.

**Why:** Il terzo argomento è `field` (string opzionale), non un messaggio human-readable. Il `message` dell'Error è impostato a `super(code)`.

## Punti invariati
- BOLT11: mai modificata
- QR: contiene solo BOLT11 (mai URL)
- Copia invoice: solo BOLT11 raw
- Core Spark/Breez: non toccato
- createReceiveInvoice, syncWallet, send, receive: invariati
