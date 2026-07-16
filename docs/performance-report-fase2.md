# Performance Report — Signal Protocol Fase 2

**Data:** 2026-07-16  
**Contesto:** Integrazione Signal Protocol (Double Ratchet) nel frontend Alpha Chat  
**Ambiente:** Browser (Chromium/Safari) + Node.js test suite

---

## 1. Benchmark metodologia

Le misurazioni di performance vengono raccolte automaticamente in development con `performance.now()` in `signal-messenger.ts`:

```javascript
// Ogni encrypt/decrypt logga automaticamente in DEV
[Signal] encrypt 2.3ms type=3 len=248
[Signal] decrypt 1.8ms type=1
```

Un benchmark manuale è disponibile via console browser:
```javascript
window.__signalBenchmark("alice", "device1", "bob", 100)
```

---

## 2. Overhead cifratura (valori attesi)

### 2.1 Prima operazione (X3DH + PreKeyWhisperMessage, type=3)

| Fase | Tempo stimato | Note |
|------|---------------|-------|
| `ensureSession` (X3DH) | 5–20ms | Include fetch bundle HTTP |
| `SessionCipher.encrypt` | 1–3ms | WASM Curve25519 |
| `btoa(binaryBody)` | <0.1ms | Encoding puro |
| **Totale primo invio** | **6–23ms** | Dominato dalla rete |

### 2.2 Messaggi successivi (WhisperMessage, type=1)

| Fase | Tempo stimato | Note |
|------|---------------|-------|
| `ensureSession` (no-op) | <0.1ms | Sessione già in IndexedDB |
| `SessionCipher.encrypt` | 1–3ms | WASM Curve25519 |
| **Totale invio normale** | **1–3ms** | Overhead trascurabile |

### 2.3 Decifratura

| Tipo | Tempo stimato | Note |
|------|---------------|------|
| PreKeyWhisperMessage (type=3) | 2–5ms | X3DH + primo decrypt |
| WhisperMessage (type=1) | 1–3ms | Double Ratchet normale |
| Legacy decode (null type) | <0.1ms | Semplice atob() |

---

## 3. Overhead dimensione ciphertext

Per un messaggio di 100 caratteri UTF-8:

| Formato | Dimensione | Overhead |
|---------|------------|----------|
| Plaintext (100 chars) | 100 bytes | 1× |
| Legacy base64 | 136 bytes | 1.36× |
| WhisperMessage base64 (type=1) | ~200 bytes | ~2× |
| PreKeyWhisperMessage base64 (type=3) | ~400 bytes | ~4× |

Il ciphertext Signal include:
- Header del messaggio (ratchet key pubblica, counter, ecc.)
- Payload cifrato AES-CBC
- MAC HMAC-SHA256

---

## 4. Impact sulla UX

### 4.1 Primo messaggio a un nuovo contatto

**Scenario:** Alice manda il primo messaggio a Bob (nessuna sessione esistente).

- `ensureSession()` scarica il bundle di Bob: +1 HTTP request (≈20–100ms su connessione normale)
- L'UI rimane responsiva: `signalEncrypt` è chiamato in `handleSend` prima di `apiSendMessage`
- Il bottone "Invia" è disabilitato durante l'operazione (stato `sending`)
- Nessun timeout visibile per l'utente su connessione normale

**Mitigazione possibile (Fase 3):** Pre-fetch del bundle al momento dell'apertura della conversazione.

### 4.2 Messaggi normali (sessione già attiva)

- Overhead Signal: 1–3ms per encrypt
- Overhead Signal: 1–3ms per decrypt (per tutti i messaggi all'apertura)
- Per una conversazione con 50 messaggi: `decryptBatch` decifra in parallelo → ≈10–20ms totali
- L'UI mostra "…" brevemente durante la decifratura batch (trascurabile)

### 4.3 Decryption batch all'apertura conversazione

```typescript
// decryptBatch usa Promise.allSettled per parallelismo
await Promise.allSettled(msgs.map((msg) => decryptSingleMsg(msg)));
```

- 50 messaggi in parallelo (hardware concurrency permette ~8 task WASM simultanei)
- Tempo atteso: ≈30–80ms per 50 messaggi (dipende dalla macchina)
- Confronto vs. rendering HTML: ≈5ms — l'overhead Signal è >5× il rendering

**Trade-off accettabile** per sicurezza E2E garantita.

---

## 5. IndexedDB performance

| Operazione | Tempo tipico |
|------------|-------------|
| `loadSession()` | 1–5ms |
| `storeSession()` | 1–5ms |
| `loadPreKey()` | 1–3ms |
| `removePreKey()` | 1–3ms |
| `openDB()` (primo accesso) | 5–20ms |

Il DB è aperto una volta per conversazione e riutilizzato (pattern lazy singleton in `key-store.ts`).

---

## 6. Confronto UX pre/post Fase 2

| Metrica | Pre-Fase 2 (base64) | Post-Fase 2 (Signal) | Delta |
|---------|--------------------|-----------------------|-------|
| Invio primo messaggio | ~0ms overhead | +20–100ms (X3DH) | +latenza HTTP |
| Invio successivi | ~0ms overhead | +1–3ms | Trascurabile |
| Ricezione messaggio | ~0ms overhead | +1–3ms per decrypt | Trascurabile |
| Apertura chat 50 msg | ~0ms overhead | +30–80ms batch decrypt | Percettibile |
| Sicurezza | ❌ Nessuna | ✅ E2E Signal | ∞ miglioramento |

---

## 7. Raccomandazioni

### Fase 3 (priorità alta)
1. **Pre-fetch bundle**: Scaricare il bundle del destinatario all'apertura della conversazione, non al primo invio.
2. **Local plaintext cache**: Persistere i plaintext in IndexedDB (cifrato con chiave derivata dalla password) per eliminare il batch decrypt all'apertura.

### Fase 3 (priorità media)
3. **Background decryption**: Web Worker per decrypt batch → UI mai bloccante.
4. **Bundle prefetching**: Pre-scaricare i bundle di tutti i contatti al login.

### Fase 4
5. **Lazy session establishment**: `ensureSession` potrebbe iniziare in background al caricamento della pagina.
6. **Streaming decrypt**: Decifrare i messaggi progressivamente invece di `decryptBatch` monolitico.

---

## 8. Monitoraggio produzione

In produzione, abilitare telemetria Signal performance (opt-in utente):
```typescript
// Aggiungere in signal-messenger.ts per produzione:
if (Math.random() < 0.01) { // 1% sampling
  analytics.track("signal_encrypt_latency", { ms: dt, type: result.type });
}
```

Metriche da monitorare:
- `signal_encrypt_p50`, `signal_encrypt_p99`
- `signal_decrypt_p50`, `signal_decrypt_p99`
- `signal_x3dh_latency` (solo tipo=3)
- `signal_recovery_count` (rebuild session events)
