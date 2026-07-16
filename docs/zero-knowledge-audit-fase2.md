# Audit Zero-Knowledge — Fase 2: Prima chat E2E reale

**Data:** 2026-07-16  
**Autore:** Analisi architetturale Sprint 16 Fase 2  
**Versione:** 1.0

---

## Sommario

Questo documento certifica le proprietà zero-knowledge dell'implementazione Signal Protocol integrata nel frontend di Alpha Chat (Fase 2). L'audit verifica che il server non abbia mai accesso al plaintext dei messaggi.

---

## 1. Architettura del flusso dati

### 1.1 Invio messaggio

```
[Utente digita testo]
        │
        ▼
[ChatPage.handleSend]
        │
        ├─► sentCacheRef.current.set(clientMessageId, plaintext)  ← locale, mai trasmesso
        │
        ├─► signalEncrypt(userId, deviceId, recipientId, plaintext)
        │       │
        │       ├─► ensureSession() — X3DH se necessario (chiavi pubbliche solo)
        │       ├─► SessionCipher.encrypt(plaintext) → { body: binaryString, type }
        │       └─► btoa(binaryString) → ciphertext base64
        │
        └─► apiSendMessage(convId, text, { signal: { body, type } })
                │
                └─► HTTP POST /messages { ciphertext: base64, ciphertext_type: 1|3 }
                        │
                        └─► Server vede SOLO ciphertext opaco
```

**Il server riceve:**
- `ciphertext`: stringa base64 del WhisperMessage/PreKeyWhisperMessage (opaco)
- `ciphertext_type`: 1 o 3 (tipo protobuf, non rivela contenuto)
- `client_message_id`: UUID casuale (non correlato al contenuto)

**Il server NON riceve:**
- Plaintext del messaggio
- Base64 del plaintext (vecchia pseudo-cifratura rimossa)
- Chiavi private Signal
- Ratchet state

### 1.2 Ricezione messaggio

```
[Server WebSocket → message.new]
        │
        ▼
[ChatPage.decryptSingleMsg]
        │
        ├─► [msg.sender_id === auth.userId]?
        │       └─► sentCacheRef.current.get(clientMessageId)  ← locale
        │
        └─► signalDecrypt(userId, deviceId, senderId, ciphertext, type)
                │
                ├─► atob(base64) → binaryString
                ├─► SessionCipher.decryptWhisperMessage() / decryptPreKeyWhisperMessage()
                │       └─► Double Ratchet → nuova chiave per ogni messaggio
                └─► plaintext
```

---

## 2. Proprietà verificate

### 2.1 Zero Plaintext al server ✅

**Claim:** Il server non vede mai il contenuto in chiaro dei messaggi.

**Evidenza:**
- `encodeMessage()` (pseudo-cifratura base64) è stata rimossa dall'export pubblico
- `apiSendMessage()` usa il body Signal (`signal.body`) se fornito; non trasmette mai `text` direttamente
- Il body Signal è output di `SessionCipher.encrypt()` → crittografia Curve25519 + Double Ratchet
- Verificato in test: `expect(ctBase64.body).not.toContain(sensitive)` ✅

### 2.2 Chiavi private locali ✅

**Claim:** Le chiavi private non lasciano mai il dispositivo.

**Evidenza:**
- `SignalProtocolStore` (IndexedDB) conserva: Identity Key privata, SPK privata, OTPK private, sessioni
- `apiUploadKeyBundle()` trasmette solo chiavi pubbliche
- `signal-session.ts` usa `base64ToArrayBuffer()` solo su chiavi pubbliche ricevute dal server
- Nessun campo privato appare in alcuna richiesta HTTP (verificato by inspection)

### 2.3 Perfect Forward Secrecy ✅

**Claim:** Ogni messaggio usa una chiave di sessione diversa; la compromissione di chiavi future non rivela messaggi passati.

**Evidenza:**
- Double Ratchet in `SessionCipher`: ogni messaggio avanza il ratchet
- Test 03: 10 messaggi consecutivi → 10 body distinti (`expect(body1).not.toBe(body2)`)
- Test 07: replay dello stesso ciphertext → eccezione (chiave già consumata)

### 2.4 Compatibilità legacy ✅

**Claim:** I messaggi pre-Fase 2 rimangono leggibili senza rompere la sessione Signal.

**Evidenza:**
- `signalDecrypt()` con `ciphertextType === null` → `legacyDecode()` (base64 del plaintext)
- `signalDecrypt()` con type 1 che fallisce Signal → tenta `legacyDecode()` come fallback
- `safeDecodeForPreview()`: detecta dati binari via U+FFFD replacement chars
- Test 11: `legacyDecode(legacyEncode(text)) === text` ✅

### 2.5 Autenticità end-to-end ✅

**Claim:** Il destinatario può verificare che il messaggio provenga dal mittente dichiarato.

**Evidenza:**
- TOFU (Trust On First Use) in `SignalProtocolStore.isTrustedIdentity()`
- Identity Key verificata durante X3DH (`processPreKey`)
- La firma XEdDSA sulla Signed PreKey è verificata da `SessionBuilder`

### 2.6 Recovery sicuro ✅

**Claim:** Il recovery automatico non espone dati sensibili.

**Evidenza:**
- `rebuildSession()` scarica un bundle fresco dal server (chiavi pubbliche)
- Il reset TOFU in `saveIdentity()` sovrascrive l'identità con quella nuova (non con zero)
- Il recovery avviene solo per PreKeyWhisperMessage (type 3), non per WhisperMessage (type 1)
- Se il recovery fallisce → `signalDecrypt()` lancia eccezione (mai testo parziale/corrotto)

---

## 3. Vettori di attacco analizzati

| Scenario | Mitigazione | Status |
|----------|-------------|--------|
| Server compromesso legge DB | Ciphertext Signal opaco | ✅ Mitigato |
| Server MITM sostituisce bundle | Identity Key binding XEdDSA | ✅ Parziale (TOFU, non PKI) |
| Replay di vecchi ciphertext | One-time message keys | ✅ Mitigato |
| Furto IndexedDB | Chiavi private locali (solo locale) | ⚠️ Mitigato se OS sicuro |
| Metadata analysis | Fuori scope Fase 2 | ❌ Non mitigato |
| Forward secrecy violation | Double Ratchet | ✅ Mitigato |

---

## 4. Limitazioni note (Fase 2)

1. **Messaggi propri dopo reload**: I messaggi inviati da noi mostrano `[Messaggio inviato]` dopo un page reload (sentCache in-memory). Il plaintext locale non è persistito su IndexedDB → Fase 3 (local message store cifrato).

2. **Preview conversazioni**: La preview nell'elenco conversazioni usa `safeDecodeForPreview()` (tenta legacy decode). Per messaggi Signal mostra `🔒 Messaggio cifrato`. La preview E2E richiederebbe un local plaintext store → Fase 3.

3. **Trust model TOFU**: La prima connessione con un utente non è autenticata fuori banda. Safety Numbers (fingerprint) disponibili ma non esposti nell'UI → Fase 4 (Key Verification UI).

4. **Singolo dispositivo**: L'indirizzo destinatario usa `deviceId = 1` fisso. Multi-device è supportato dalla lib ma richiede un layer di distribuzione → Fase 4.

---

## 5. Conformità Signal Protocol

| Requisito | Implementazione | Conforme |
|-----------|-----------------|----------|
| X3DH key agreement | `SessionBuilder.processPreKey()` | ✅ |
| Double Ratchet | `SessionCipher` | ✅ |
| Curve25519 DH | WASM interno @privacyresearch | ✅ |
| XEdDSA signatures | `KeyHelper.generateSignedPreKey()` | ✅ |
| One-Time PreKeys | Pool OTPK in IndexedDB | ✅ |
| SPK rotation | `maybeReplenishOtpks()` | ✅ |
| Perfect Forward Secrecy | Double Ratchet | ✅ |
| Break-in recovery | Lato mittente (SPK change) | ✅ |

---

## 6. Conclusione

L'implementazione Fase 2 garantisce che **il server Alpha Chat non possa leggere il contenuto dei messaggi**. La cifratura è end-to-end con Signal Protocol standard, usando primitive crittografiche Curve25519 e Double Ratchet. Le limitazioni identificate (local plaintext store, TOFU, multi-device) sono accettabili per Fase 2 e pianificate nelle fasi successive.
