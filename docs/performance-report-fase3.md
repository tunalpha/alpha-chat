# Performance Report — Signal Protocol Fase 3: Media E2E

**Data:** 2026-07-16
**Contesto:** Cifratura E2E per media (AES-256-GCM) — Sprint 16 Fase 3

---

## 1. Primitiva crittografica

**AES-256-GCM** via Web Crypto API (hardware-accelerated sulle piattaforme moderne).

- Chrome/Edge: AES-GCM accelerato via AES-NI (Intel/AMD)
- Safari/iOS: accelerato via hardware (Secure Enclave su A-series chip)
- Firefox: accelerato via NSS con AES-NI
- Node.js test: accelerato via OpenSSL

---

## 2. Benchmark AES-256-GCM (stime su hardware mid-range)

### Encrypt (throughput)

| Dimensione file | Tempo atteso | Throughput |
|----------------|--------------|------------|
| 100 KB (foto)  | < 2ms        | ~50 MB/s   |
| 1 MB (foto HD) | < 10ms       | ~100 MB/s  |
| 10 MB (video)  | < 50ms       | ~200 MB/s  |
| 50 MB (video)  | < 200ms      | ~250 MB/s  |

I tempi includono: allocazione buffer, AES-GCM encrypt, GCM tag append.

### Decrypt (throughput)

Stesso ordine di grandezza di encrypt (AEAD è simmetrico).
Il decrypt include la verifica del GCM tag (nessun overhead significativo).

---

## 3. Pipeline upload E2E (tempo totale utente)

Per una foto da 3 MB su connessione WiFi (10 Mbps up):

| Fase | Tempo | Note |
|------|-------|------|
| `generateMediaKey()` | < 1ms | Chiave 256-bit |
| `generateIV()` | < 0.1ms | 12 byte casuali |
| `encryptBlob(3MB)` | ~15ms | AES-GCM hardware |
| Conversione base64 | ~5ms | loop byte→char |
| HTTP upload (3MB) | ~2.4s | 10 Mbps upload |
| `encryptForActive(meta)` | ~2ms | Signal encrypt JSON metadata |
| HTTP send message | ~50ms | JSON piccolo |
| **Totale overhead E2E** | **~23ms** | su 2.4s upload |
| **Overhead E2E %** | **~1%** | trascurabile |

**Conclusione:** L'overhead crittografico è irrilevante rispetto al tempo di rete.

---

## 4. Pipeline download + decrypt

Per una foto da 3 MB su connessione WiFi (50 Mbps down):

| Fase | Tempo | Note |
|------|-------|------|
| HTTP download (3MB) | ~480ms | 50 Mbps |
| `importKeyBase64()` | ~1ms | Import CryptoKey |
| `decryptBuffer(3MB)` | ~12ms | AES-GCM hardware |
| `URL.createObjectURL()` | ~1ms | ObjectURL |
| Render `<img>` / `<video>` | variabile | dipende dal browser |
| **Totale overhead decrypt** | **~14ms** | su 480ms download |
| **Overhead decrypt %** | **~3%** | trascurabile |

---

## 5. Messaggi vocali

Per un vocale da 30 secondi (~450 KB in OGG/Opus):

| Fase | Tempo | Note |
|------|-------|------|
| Registrazione | 30s | tempo reale |
| `encryptBlob(450KB)` | ~3ms | AES-GCM |
| HTTP upload (450KB) | ~360ms | WiFi |
| Decrypt + play | ~3ms | AES-GCM |
| **Overhead E2E totale** | **~6ms** | negligibile |

---

## 6. Confronto UX pre/post Fase 3

| Metrica | Pre-Fase 3 (plaintext upload) | Post-Fase 3 (AES-256-GCM) | Delta |
|---------|-------------------------------|---------------------------|-------|
| Upload overhead | 0ms | +15–50ms (encrypt) | Trascurabile |
| Download overhead | 0ms | +10–15ms (decrypt) | Trascurabile |
| Dimensione upload | N bytes | N + 16 bytes (GCM tag) | +16 bytes (costante) |
| Sicurezza | ❌ Plaintext al server | ✅ Zero Knowledge | ∞ |
| Privacy foto | ❌ Server vede tutto | ✅ Blob opaco | ∞ |

---

## 7. Consumo memoria

| Scenario | Memoria aggiuntiva |
|----------|--------------------|
| Foto 3MB | +3MB buffer AES input + 3MB output (GC dopo ObjectURL) |
| Video 30MB | +30MB buffer AES input + 30MB output (GC dopo use) |
| Vocale 450KB | +450KB × 2 (transiente, GC immediato) |
| CryptoKey | < 1KB (managed by SubtleCrypto) |

Per file grandi, considerare streaming AES-GCM (Fase 5):
- Libera il buffer input subito
- Chunk size: 64KB per bilanciare overhead/throughput

---

## 8. Limite client-side attuali

| Tipo | Limite UI | Motivo |
|------|-----------|--------|
| Foto | 10 MB | Backend limit |
| Video | 15 MB | Backend limit |
| Audio | 5 MB | Backend limit |
| Documento | 10 MB | Backend limit |

Il limite di 15 MB per video significa max ~100ms di overhead AES-GCM.
Nessuna ottimizzazione urgente necessaria per Fase 3.

---

## 9. Raccomandazioni

### Fase 4 (priorità media)
- **Web Worker per encrypt**: spostare `encryptMediaBlob` in un Worker per non bloccare il thread UI su file > 5MB
- **Streaming AES-GCM**: per video > 10MB, usare `TransformStream` con chunk di 64KB

### Fase 5
- **Range requests cifrate**: permettere seek su video cifrati senza scaricare tutto
- **Progressive decryption**: decrypt e render progressivo per immagini

---

## 10. Monitoraggio produzione

Metriche da tracciare (opt-in, 1% sampling):
```
media_e2e_encrypt_ms (p50, p95, p99) by file_size_bucket
media_e2e_decrypt_ms (p50, p95, p99) by file_size_bucket
media_e2e_upload_total_ms (p50, p95, p99)
```
