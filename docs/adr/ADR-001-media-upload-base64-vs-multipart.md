# ADR-001: Media Upload — Base64/JSON vs Multipart Streaming

**Status:** Accepted (Base64/JSON per V1) — Multipart/Stream proposto per V2  
**Data:** 2026-07-16  
**Autori:** Engineering Team  
**Contesto:** Fix bug #media-500 (upload foto iPhone → HTTP 500 per body limit 1 MB)

---

## 1. Contesto

Alpha Chat usa un approccio Zero-Knowledge per i media: ogni file viene cifrato lato client con AES-256-GCM prima di essere trasmesso al server. Il server riceve solo ciphertext opachi.

La pipeline attuale (V1) è:

```
File originale
    ↓
AES-256-GCM (Web Crypto API)
    ↓
Blob cifrato (ArrayBuffer)
    ↓
Base64 (loop carattere-per-carattere)
    ↓
JSON body { "data": "<base64>", "mime_type": "...", ... }
    ↓
POST /api/v1/media  (express.json)
    ↓
Buffer.from(data, "base64")
    ↓
MongoDB (campo Buffer)
```

### Il bug

Il body parser Express aveva un limite globale di `1 MB`. Una foto iPhone (3–5 MB raw) → base64 (×1.33) = **4–7 MB** JSON → `PayloadTooLargeError` → error handler non la riconosceva → **HTTP 500**.

### Il fix applicato

- `/api/v1/media`: body limit sovrapposto a **25 MB** (copre tutti i tipi di file fino ai loro massimi × 1.33 + margine)
- Tutti gli altri endpoint: limite globale **1 MB** invariato
- Error handler: `PayloadTooLargeError` → HTTP **413** + `PAYLOAD_TOO_LARGE` code

---

## 2. Decisione V1: Base64/JSON

### Perché è stato adottato

1. **Semplicità di implementazione**: un singolo `POST` JSON con autenticazione Bearer è triviale in qualsiasi client (browser, React Native, Node.js test).
2. **Compatibilità universale**: `express.json()` gestisce automaticamente parsing, validazione Zod, error handling. Non richiede `multer` o stream management.
3. **Test semplici**: un payload JSON è ispezionabile, loggabile (solo schema, non bytes) e testabile con `fetch()` standard.
4. **Volume attuale**: con limite 15 MB (video max) e base64 overhead ×1.33 → 20 MB payload. Accettabile per una V1 con utenti limitati.

### Limitazioni accettate per V1

| Limitazione | Impatto |
|-------------|---------|
| **Overhead base64** | File 15 MB → payload 20 MB → +33% banda consumata |
| **Picco memoria browser** | Il loop `String.fromCharCode` + `btoa` richiede ~3–4× la dimensione del file in RAM durante la conversione |
| **Picco memoria backend** | `Buffer.from(data, "base64")` alloca un buffer completo prima di scrivere su MongoDB |
| **Non streaming** | Il file intero viene bufferizzato in memoria sia lato client sia lato server prima di essere trasmesso/salvato |
| **Nessuna ripresa** | In caso di interruzione di rete, il file deve essere ricaricato dall'inizio |

### Soglie dove base64/JSON diventa problematico

- **> 20 MB file**: picchi di RAM browser > 80 MB durante la conversione
- **> 50 utenti simultanei che uploadano video**: backpressure MongoDB
- **Connessioni lente (< 1 Mbps)**: timeout dell'upload per file grandi

---

## 3. Alternativa V2: Multipart/Form-Data con Streaming

### Pipeline proposta

```
File originale
    ↓
AES-256-GCM (Web Crypto API, streaming con TransformStream)
    ↓
ReadableStream di chunk cifrati
    ↓
multipart/form-data (FormData API)
    ↓
POST /api/v1/media  (multer con limits)
    ↓
GridFS streaming write (mongoose-gridfs / GridFSBucket)
    ↓
MongoDB GridFS (chunks da 255 KB)
```

### Vantaggi

| Aspetto | Base64/JSON (V1) | Multipart/Stream (V2) |
|---------|------------------|-----------------------|
| **Overhead rete** | +33% (base64) | 0% (bytes diretti) |
| **Picco RAM browser** | 3–4× file size | ~1–2 chunk size (~512 KB) |
| **Picco RAM backend** | 1× file size buffer | ~1 chunk GridFS |
| **Ripresa upload** | ❌ No | ✅ Sì (chunk restart) |
| **Streaming** | ❌ No | ✅ Sì |
| **Complessità implementazione** | Bassa | Media–Alta |
| **Test** | Semplice | Richiede mock stream |

### Cambiamenti necessari per V2

1. **Frontend** (`ChatPage.tsx`, `api.ts`):
   - Sostituire `blobToBase64` + `fetch(JSON)` con `FormData` + stream
   - Usare `TransformStream` per cifrare on-the-fly durante l'upload
   - Gestire progress con `ReadableStream` (no `onProgress` callback semplice)

2. **Backend** (`media.routes.ts`, `media.service.ts`):
   - Aggiungere `multer` (o `busboy` per streaming puro)
   - Sostituire `Buffer` field su MongoDB con GridFS (`GridFSBucket`)
   - Aggiornare `media.repository.ts` per lo stream read/write

3. **Schema MongoDB**:
   - Rimuovere campo `data: Buffer` da `MediaModel`
   - Aggiungere `gridfs_id: ObjectId` che punta al file GridFS
   - **Migrazione richiesta** per i file esistenti

4. **Zero Knowledge** (invariante):
   - Il stream cifrato lato client deve iniziare **prima** che il primo byte venga inviato al server
   - La chiave AES non deve mai comparire nel multipart (solo nel messaggio Signal separato)
   - Verificare che `multer`/`busboy` non loggino i byte ricevuti

### Rischi V2

- `TransformStream` con Web Crypto è disponibile solo in browser moderni (Chrome 67+, Safari 15+, Firefox 102+) — `@alpha-chat-web` già richiede questi target
- GridFS aggiunge latenza sulle read (chunking da 255 KB) — accettabile per file > 1 MB
- La migrazione dei dati esistenti richiede uno script one-shot

---

## 4. Decisione

### V1 (ora): Base64/JSON con limite 25 MB

✅ **Approvato e in produzione.**

Il fix è minimo, sicuro e corretto. Per i volumi attuali di Alpha Chat V1 (< 100 utenti attivi) l'overhead base64 è accettabile.

### V2 (futuro): Multipart/Stream + GridFS

📋 **Pianificato per Sprint ≥ 20.**

**Trigger per prioritizzare V2:**
- Volume utenti > 500 attivi
- File video > 20 MB richiesti
- RAM server > 2 GB durante upload peak
- Richiesta di upload resumable da mobile (poor connectivity)

### Ottimizzazione intermedia (V1.5, opzionale)

Prima di V2 completo, si può ridurre l'overhead base64 lato browser sostituendo il loop manuale con la Web API nativa:

```ts
// Attuale (O(n) lento, alto GC pressure):
let b = "";
for (const x of bytes) b += String.fromCharCode(x);
return btoa(b);

// Ottimizzato (nativo, 3-5× più veloce in browser):
return btoa(String.fromCharCode(...new Uint8Array(ab)));
// ATTENZIONE: spread lancia RangeError per array > ~500K elementi
// Usare invece:
const CHUNK = 8192;
let b = "";
for (let i = 0; i < bytes.length; i += CHUNK) {
  b += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
}
return btoa(b);
```

Questa ottimizzazione riduce il tempo di conversione base64 da ~20 s a ~2 s per file da 15 MB in browser (senza cambiare l'architettura).

---

## 5. Log della decisione

| Data | Evento |
|------|--------|
| 2026-07-16 | Bug rilevato: HTTP 500 su upload foto iPhone |
| 2026-07-16 | Root cause: body limit 1 MB + PayloadTooLargeError → 500 |
| 2026-07-16 | Fix: body limit 25 MB per /media, 413 handler, PAYLOAD_TOO_LARGE code |
| 2026-07-16 | ADR creata: documenta V1 e percorso verso V2 multipart/stream |
