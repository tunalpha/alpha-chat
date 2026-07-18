---
name: Sprint 28 — Shared Identity Key
description: IK condivisa via blob AES-GCM sul server; fix formato serializzazione, risultati E2E checklist completa
---

## Bug critico risolto: serializzazione IK in ik-crypto.ts

**Il problema:** la versione iniziale di `wrapIdentityKeyPair` serializzava il key pair come
`new Uint8Array(64)` con offset fissi 0+32. Ma la pubKey di Signal (libsignal-ts) è **33 byte**
(prefisso 0x05 + 32 byte raw Curve25519), non 32. Questo causava:
- Il byte 32 di pubKey sovrascriveva il byte 0 di privKey nel plaintext cifrato
- `unwrapIdentityKeyPair` restituiva pubKey troncata a 32 byte
- `KeyHelper.generateSignedPreKey` lanciava `TypeError: Invalid argument for identityKeyPair`
  perché la sua validation richiede `pubKey.byteLength === 33`

**Il fix:** `ik-crypto.ts` usa ora `JSON.stringify({ pub: base64(pubKey), priv: base64(privKey) })`
come plaintext — gestisce qualsiasi lunghezza di chiave senza assunzioni hard-coded.

**Validazione libsignal (@privacyresearch/libsignal-protocol-typescript v0.0.16):**
```javascript
// da key-helper.js:
if (!(identityKeyPair.privKey instanceof ArrayBuffer) ||
    identityKeyPair.privKey.byteLength !== 32 ||
    !(identityKeyPair.pubKey instanceof ArrayBuffer) ||
    identityKeyPair.pubKey.byteLength !== 33) {
  throw new TypeError('Invalid argument for identityKeyPair');
}
```

**Why:** il formato fisso 32+32 sembrava corretto basandosi sull'ispezione IDB (che mostrava 32B),
ma l'IDB è soggetto a compressione/troncamento dell'ispezione. La vera dimensione è 33B.

**How to apply:** serializzare sempre le IK con JSON+base64 in qualsiasi future crypto wrapper.
Non fare mai assunzioni sulle dimensioni delle chiavi primitive Signal.

---

## Risultati E2E Checklist Sprint 28 (11 blocchi)

| Blocco | Descrizione | Stato |
|--------|-------------|-------|
| 1 | Registrazione con blob IK (pubKey 33B, JSON+base64) | **PASS** |
| 2 | Login con IK decifrata dal blob, signal_keys_ready | **PASS** |
| 3 | Multi-device: stessa IK su due browser context distinti | **PASS** |
| 4 | Messaggistica 1:1 leggibile con IK condivisa | **PASS** |
| 5 | Messaggistica di gruppo leggibile | **PASS** |
| 6 | Logout/login: IK recuperata dal blob, messaggi persistenti | **PASS** |
| 7 | Migrazione legacy (blob null → PATCH /auth/identity-key) | **PASS** |
| 8 | Recovery Card reset IK | **UNABLE** (flusso troppo complesso per automazione) |
| 9 | Offline/online (assessment logico) | **PASS** (crypto locale, no rete) |
| 10 | Login simultanei concorrenti | **PASS** (no errori di conflitto bundle) |
| 11 | Regressione chiamate | **PASS** (CallContext.tsx senza Signal; errore = microfono assente in Playwright) |

**IK di test verificata:** `BTiOT9wg53yW2CU9CBqPoq2ntynLktrxA0nA7aMmSdd8` (33B, identica su tutti i device)

---

## Architettura finale Sprint 28

- `ik-crypto.ts`: wrap/unwrap con JSON+base64, PBKDF2-SHA512 600k + AES-256-GCM
- `generateAndWrapSharedIdentityKey()`: genera IK Curve25519 + la cifra (registrazione + migrazione)
- `AuthContext.login()`: decifra blob (se presente) → passa IK a initSignalKeys; se blob null → lazy migration (genera + PATCH /auth/identity-key in background)
- `AuthContext.register()`: genera IK + blob PRIMA della chiamata server; invia entrambi insieme
- Feature flag `SIGNAL_IK_CONSISTENCY_CHECK=false` (ancora off; Phase 4 da avviare)

## Phase 4 ancora da fare

Attivare `SIGNAL_IK_CONSISTENCY_CHECK=true` e cleanup bundle legacy — NON ancora avviata.
Solo dopo conferma esplicita dell'utente.
