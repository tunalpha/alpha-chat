---
name: Sprint 16 Fase 2 — Signal E2E Integration
description: Decisioni architetturali per la prima chat E2E reale con Signal Protocol nel frontend
---

## Architettura Fase 2

### Layer applicativo Signal

- `signal-session.ts` — `ensureSession` (X3DH, idempotente) + `rebuildSession` (recovery)
- `signal-messenger.ts` — `signalEncrypt` / `signalDecrypt` con fallback legacy
- `signal/index.ts` — riesporta tutto il modulo signal/

### Formato body sul filo

- `SessionCipher.encrypt()` → binary string (ogni char = un byte, charCode 0-255)
- Per trasmissione JSON-safe: `btoa(binaryString)` → base64
- Per decifratura: `atob(base64)` → binary string → `decrypt(binaryStr, "binary")`
- NON passare mai il base64 direttamente a decrypt; serve l'atob prima

**Why:** `stringToArrayBuffer(str)` usa `charCodeAt(i)` → si aspetta binary string, non base64

### api.ts changes

- `encodeMessage` è diventata funzione interna (non esportata)
- `apiSendMessage` accetta `options.signal?: { body, type }` e `options.clientMessageId?`
- `apiEditMessage` accetta 4° param opzionale `signal?: { body, type }`
- `decodeMessage` resta esportata per compatibilità legacy

### ChatPage.tsx — Signal integration pattern

- `decryptedTexts: Map<string, string>` state — testi decifrati per messageId
- `sentCacheRef: Map<string, string>` ref — clientMessageId → plaintext per propri messaggi
- `getDisplayText(msg)` — legge da decryptedTexts, fallback a decodeMessage legacy
- `decryptBatch(msgs)` — chiamata dopo load messaggi (parallelizzata con Promise.allSettled)
- `decryptSingleMsg(msg)` — chiamata su WebSocket message.new e message.edited
- `encryptForActive(text)` — helper che trova recipientUserId dalla conversazione attiva

### Limitazioni note Fase 2

- Propri messaggi Signal → non decifrabili dopo page reload (sentCacheRef in-memory)
- Preview conversazione → usa `safeDecodeForPreview` (tenta legacy, mostra "🔒" se Signal)
- deviceId fisso a 1 per destinatario (multi-device rimandato a Fase 4)
- Trust TOFU, non PKI

### Test suite

- 11 file di test, 68 test, tutti ✅
- Test 11 (`11-app-integration.test.ts`) verifica pattern app E2E in Node.js
- Il test "Sessione persistente" usa createPersona + buildSession (semplificato da scenario IndexedDB originale che causava errore protobuf)

### Docs prodotti

- `docs/zero-knowledge-audit-fase2.md`
- `docs/performance-report-fase2.md`
