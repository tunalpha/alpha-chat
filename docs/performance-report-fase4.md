# Performance Report — Fase 4: Multi-device, Media Cache, Thumbnail E2E

**Data:** 2026-07-16  
**Scope:** Sprint 16 Fase 4  
**Baseline:** Fasi 1–3

---

## 1. Impatto latenza — Send path

### 1.1 Single-device vs Multi-device fan-out

| Scenario | Operazioni aggiuntive | Latenza stimata (aggiuntiva) |
|----------|-----------------------|------------------------------|
| Messaggio singolo device (baseline Fase 2) | 1× `signalEncrypt` | — |
| Fan-out 2 device (caso tipico) | 2× `signalEncrypt` + `apiGetAllKeyBundles` | +30–80 ms (rete: bundle fetch) |
| Fan-out N device (primo messaggio, sessione non cached) | N× `signalEncrypt` + 1 API call | +50–120 ms per N=2–5 |
| Fan-out N device (sessione già in store) | N× `signalEncrypt` (no API call) | +5–15 ms per N=2–5 |

**Bottleneck:** `apiGetAllKeyBundles(userId)` — chiamata REST che scarica tutti i bundle del destinatario. Questa chiamata avviene SOLO se `signalEncryptMulti` non trova sessioni cached per tutti i device. In pratica, dopo il primo messaggio, le sessioni sono cached in `SignalProtocolStore` (in-memory) per tutta la sessione browser.

**Ottimizzazione Fase 5 (suggerita):** Cachare i bundle scaricati per 5–10 minuti; invalidare solo su `device_revoked` WebSocket event.

### 1.2 Thumbnail generation

| Operazione | Costo tipico |
|------------|-------------|
| `encryptBlobWithKey` su thumbnail 80KB | ~2–5 ms (AES-GCM Web Crypto) |
| `encryptBlobWithKey` su thumbnail 200KB | ~5–10 ms |
| Upload thumbnail (multipart) | dipende da rete (non bloccante: parallelo al media principale) |

Il thumbnail viene generato solo per immagini e video (`image/*`, `video/*`). Per file arbitrari viene omesso.

---

## 2. Impatto memoria — Media Cache

### 2.1 IndexedDB footprint

Ogni entry in cache ha la struttura:
```
<store_meta_by_client>: clientId → base64(iv.ciphertext(metaJson))
<store_meta_by_msg>:   messageId → base64(iv.ciphertext(metaJson))
<store_cache_key>:     "key" → base64(rawAesKey)
```

Il `metaJson` è tipicamente 200–500 bytes (JSON con `url`, `key`, `iv`, `mimeType`, `size`, opzionalmente `thumb_url`, `thumb_iv`). Cifrato e base64-encoded: ~1.1× la dimensione originale.

| Messaggi media in cache | Footprint stimato |
|-------------------------|------------------|
| 100 messaggi | ~100 KB |
| 1000 messaggi | ~1 MB |
| 10000 messaggi | ~10 MB |

**Limite pratico:** IndexedDB non ha un limite fisso per domain, ma i browser iniziano a chiedere conferma oltre i 50 MB. Con messaggi media tipici, si è ben al di sotto per anni di utilizzo.

**Nota:** La cache NON contiene i blob media (solo i metadati cifrati). I blob rimangono sul CDN/server. La cache elimina solo il costo di re-decifratura del metaJson Signal per messaggi già visti.

### 2.2 Fallback in-memory

Quando IndexedDB non è disponibile (Node.js, test, browser con IDB disabilitato), la cache usa un `Map<string, string>` in-memory. Non c'è limite esplicito: in browser SSR o ambienti di test questo è accettabile. In produzione, IDB è sempre disponibile.

---

## 3. Impatto rete — Device Manager

| Operazione | Chiamate API | Frequenza attesa |
|------------|-------------|-----------------|
| Apertura Device Manager | `GET /keys/devices` | On-demand (utente apre pannello) |
| Revoca device | `DELETE /keys/devices/:deviceId` | Rara (manutenzione account) |
| Fan-out: fetch bundle per device | `GET /bundle/:userId/all` | Solo primo messaggio per destinatario |

Il `DeviceManager` fa refresh esplicito solo su apertura e su click del pulsante refresh. Non c'è polling.

---

## 4. Costo computazionale Signal (test benchmark)

Dalla suite di test (Node.js, single core):

| Test | Durata | Note |
|------|--------|------|
| 13.8 — Stress 5 messaggi × 2 device (10 encrypt + 10 decrypt) | ~190 ms | ~9.5 ms per operazione |
| 13.9 — Bidirezionale (4 sessioni + 8 operazioni) | ~290 ms | |
| 14.x — Media cache (16 test, tutto in-memory) | < 50 ms totali | Cache non è bottleneck |

**Stima produzione (browser + WebCrypto nativo):** Le operazioni Signal sono 2–5× più veloci in browser rispetto a Node.js test (WebCrypto nativo vs emulato). Il Double Ratchet per 10 messaggi dovrebbe completare in < 50 ms.

---

## 5. Raccomandazioni Fase 5

1. **Bundle cache client-side:** Evitare `apiGetAllKeyBundles` su ogni conversazione nuova; cachare con TTL 10 minuti.
2. **Lazy session init:** Costruire sessioni Signal per device secondari in background, non nel critical path del primo messaggio.
3. **Media cache eviction:** Aggiungere LRU eviction alla media cache per evitare crescita illimitata su dispositivi con molto storico.
4. **IDB transaction batching:** Raggrupare `cacheDecryptedMeta` e `cacheOwnMessageMeta` in una singola transazione IDB per ridurre overhead write.
