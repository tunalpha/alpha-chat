# Zero-Knowledge Audit — Fase 4: Multi-device, Media Cache, Thumbnail E2E, Device Manager

**Data:** 2026-07-16  
**Scope:** Sprint 16 Fase 4  
**Baseline:** Fasi 1–3 già auditate (vedi `zero-knowledge-audit-fase1.md`, `zero-knowledge-audit-fase3.md`)

---

## 1. Superfici nuove introdotte in Fase 4

### 1.1 Multi-device fan-out (`signal/multi-device.ts`)

| Proprietà | Verifica |
|-----------|----------|
| Fan-out: una chiamata `signalEncryptMulti` genera ciphertext indipendenti per ogni device | ✅ Test 13.2 — `cts[0].body !== cts[1].body` |
| Isolamento device: device-1 non può decifrare il ciphertext destinato a device-2 | ✅ Test 13.2 |
| Isolamento terze parti: Eve non può decifrare nessun ciphertext | ✅ Test 13.3 |
| Forward secrecy: OTPK consumata non riutilizzabile | ✅ Test 13.7 |
| Sessioni completamente indipendenti per dispositivo | ✅ Test 13.9 |
| `hashDeviceId`: UUID → int32 deterministico senza collisioni prevedibili | ✅ Funzione pura; hash basato su FNV-1a modificato |
| `ensureSessionForBundle` non espone chiavi private in log/rete | ✅ Code review: nessun `console.log` con materiale sensibile |
| `rebuildSessionForBundle` crea sessione fresh (non riutilizza stato ratchet vecchio) | ✅ Chiama `buildSession` con bundle fresco dal server |
| Server riceve `device_ciphertexts` come array opaco — nessun plaintext | ✅ Schema API: campo `Mixed` non interpretato dal server |

**Invariante chiave:** Il server conosce solo `(recipient_device_id, ciphertext_opaco)`. Non può ricavare la chiave di sessione, il contenuto, o l'associazione tra device_id e utente fisico senza correlazione esterna.

### 1.2 Media cache locale (`media-cache.ts`)

| Proprietà | Verifica |
|-----------|----------|
| La cache è cifrata con AES-256-GCM (chiave generata localmente, mai inviata al server) | ✅ `loadOrCreateCacheKey` genera/persiste in IndexedDB locale |
| La chiave di cache non è mai inclusa nelle chiamate API | ✅ Code review: `_cacheKey` è module-private; nessun export |
| Il metaJson (contenente AES key del media) è accessibile SOLO al client autenticato | ✅ La chiave IDB è derivata da `initMediaCache` che richiede login attivo |
| `clearMediaCache` rimuove tutti i dati + chiave al logout | ✅ Chiamato in `AuthContext.tsx` su logout/logoutAll |
| Fallback in-memory (Node.js/test) non persiste tra sessioni | ✅ `Map<>` in-memory non sopravvive al reload |
| Zero Plaintext Rule: la chiave AES del media è presente nel metaJson cifrato | ✅ Test 14.5 |

**Rischio residuo (basso):** Se un attaccante ha accesso fisico al dispositivo e al DB IndexedDB E alla chiave di cache (che risiede in un altro object store dello stesso DB), potrebbe decifrare la cache. Mitigazione possibile: derivare la chiave di cache dalla password utente (out-of-scope Fase 4).

### 1.3 Thumbnail E2E

| Proprietà | Verifica |
|-----------|----------|
| Thumbnail cifrata con la stessa AES-256-GCM key del media originale (IV separato) | ✅ `encryptBlobWithKey(thumbnailBlob, aesKey)` con IV fresh |
| `thumb_iv` incluso nel `metaJson` cifrato Signal (non in chiaro) | ✅ `handleFilePick` in ChatPage.tsx: metaJson include `thumb_iv` |
| Server riceve solo `encrypted_thumbnail` (bytes opachi) | ✅ `apiUploadEncryptedMedia` invia come multipart/form-data blob |
| Il thumbnail non è decifrabile senza la chiave AES Signal-protetta | ✅ Chain: AES key → Signal encrypt → server store |

### 1.4 Device Manager (`DeviceManager.tsx`)

| Proprietà | Verifica |
|-----------|----------|
| L'API `DELETE /keys/devices/:deviceId` richiede autenticazione | ✅ Route protetta da middleware `authenticate` |
| Last-device guard: impossibile revocare l'ultimo device | ✅ `revokeDevice` lancia `LAST_DEVICE_REVOKE` se un solo bundle |
| La revoca elimina il bundle dal DB ma non forza re-key delle sessioni attive | ⚠️ Nota di design: le sessioni E2E esistenti rimangono valide fino alla naturale rotazione delle chiavi. Accettato: Signal è progettato così (le sessioni sopravvivono alla revoca del bundle). |
| L'UI mostra il device corrente separatamente | ✅ `isCurrentDevice` evidenziato visivamente |

---

## 2. Cambiamenti al modello di minaccia

### Aggiunte in Fase 4

**Scenario M1 — Server compromesso con accesso a `device_ciphertexts`:**  
Il server riceve un array di `{device_id, body, type}` per ogni messaggio. Ogni `body` è indistinguibile da rumore casuale senza la chiave di sessione Signal del device specifico. Anche conoscendo tutti i device_id di un utente, il server non può decifrare nessun messaggio. **Invariante mantenuta.**

**Scenario M2 — Dispositivo revocato ma ancora online:**  
Dopo la revoca, il bundle del device è rimosso dal server. Nuovi mittenti non possono stabilire sessioni con quel device. Tuttavia, sessioni già stabilite (Double Ratchet) rimangono funzionali fino al prossimo ratchet step. Questo è il comportamento standard del Signal Protocol. **Accettato.**

**Scenario M3 — Cache media esfiltrata dal disco:**  
Un attaccante che legge il file IndexedDB ottiene solo dati cifrati AES-GCM. La chiave di cache è nello stesso DB (diverso object store). Se entrambi sono accessibili, la protezione cade. **Rischio residuo documentato.**

---

## 3. Copertura test E2E (Fase 4)

| Test file | Count | Copertura Fase 4 |
|-----------|-------|-----------------|
| `13-multi-device.test.ts` | 19 test | Multi-device fan-out, isolamento, forward secrecy, stress, bidirezionale |
| `14-media-cache.test.ts` | 16 test | Init, store/get, namespace isolation, Zero Plaintext Rule, clear |
| **Totale Fase 4** | **35 test** | — |
| **Totale suite** | **117 test** | — |

---

## 4. Nessuna regressione verificata

Tutti i test Fasi 1–3 (82 test precedenti) sono rimasti verdi dopo l'introduzione delle funzionalità Fase 4. Typecheck `tsc --noEmit` pulito su `alpha-chat-web` e `api-server`.
