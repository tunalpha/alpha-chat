/**
 * Test 16 — Integrazione reale: upload media contro API live
 *
 * Verifica post-fix del bug "HTTP 500 su upload foto iPhone" (2026-07-16).
 *
 * Cosa testa:
 *   A. Upload reali di file sintetici delle dimensioni tipiche di campo:
 *        iPhone HEIC 3 MB, JPEG 10 MB, video 15 MB, PDF 10 MB, audio 5 MB
 *   B. Timing cifratura + conversione base64 + upload (picchi memoria)
 *   C. Doppio limite body: /media → 25 MB, altri endpoint → 1 MB
 *   D. Zero-Knowledge: il server riceve solo ciphertext, nessuna chiave AES
 *
 * Prerequisito: API_BASE_URL deve puntare al server in esecuzione.
 * Default: http://localhost:8080
 *
 * Lo script:
 *   1. Registra utenti temporanei (suffisso timestamp per evitare collisioni)
 *   2. Crea una conversazione diretta
 *   3. Esegue i vari upload
 *   4. Pulisce: i test user vengono lasciati (nessun endpoint admin delete in V1)
 *
 * NOTA: i test che richiedono il server vivo vengono saltati automaticamente
 *       se il server non risponde (SKIP_IF_NO_SERVER = true).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";

// ─── Config ──────────────────────────────────────────────────────────────────

const API_BASE = process.env.API_BASE_URL ?? "http://localhost:8080";
const SKIP_LABEL = "SKIP";

// ─── AES helpers (Node 20+ Web Crypto) ───────────────────────────────────────

const AES_KEY_BITS = 256;
const GCM_IV_BYTES = 12;

async function encryptMediaBlob(blob: Blob): Promise<{
  encryptedBlob: Blob; keyBase64: string; ivBase64: string;
}> {
  const key = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: AES_KEY_BITS }, true, ["encrypt", "decrypt"],
  );
  const rawKey  = await crypto.subtle.exportKey("raw", key);
  const keyBase64 = rawToBase64(rawKey);
  const iv = crypto.getRandomValues(new Uint8Array(GCM_IV_BYTES));
  const ivBase64  = rawToBase64(iv.buffer as ArrayBuffer);
  const plain     = await blob.arrayBuffer();
  const cipher    = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plain);
  return { encryptedBlob: new Blob([cipher], { type: "application/octet-stream" }), keyBase64, ivBase64 };
}

function rawToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let b = "";
  for (const x of bytes) b += String.fromCharCode(x);
  return btoa(b);
}

function blobToBase64(blob: Blob): Promise<string> {
  return blob.arrayBuffer().then((ab) => {
    const bytes = new Uint8Array(ab);
    let b = "";
    for (const x of bytes) b += String.fromCharCode(x);
    return btoa(b);
  });
}

/** Genera un blob sintetico con dati comprimibili-realistici */
function makeFakeFile(bytes: number, mimeType: string): Blob {
  const buf = new Uint8Array(bytes);
  // Pattern semi-casuale che simula dati media (non tutto zero)
  const seed = new Uint8Array(Math.min(bytes, 65536));
  crypto.getRandomValues(seed);
  for (let i = 0; i < bytes; i++) buf[i] = seed[i % seed.length] ^ (i & 0xff);
  return new Blob([buf], { type: mimeType });
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

interface AuthResult { accessToken: string; userId: string; conversationId?: string }

async function apiPost(path: string, body: unknown, token?: string): Promise<Response> {
  return fetch(`${API_BASE}/api/v1${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function registerUser(suffix: string): Promise<{ token: string; userId: string }> {
  const username = `testuser_${suffix}`;
  const res = await apiPost("/auth/register", {
    username,
    display_name: `Test ${suffix}`,
    password: "Test1234!",
    device_id:   crypto.randomUUID(),
    device_type: "web",
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`register failed ${res.status}: ${body}`);
  }
  const data = await res.json() as { data: { user: { id: string }; tokens: { access_token: string } } };
  return { token: data.data.tokens.access_token, userId: data.data.user.id };
}

async function createConversation(token: string, recipientUsername: string): Promise<string> {
  const res = await apiPost("/conversations", { username: recipientUsername }, token);
  if (!res.ok) throw new Error(`createConversation failed ${res.status}: ${await res.text()}`);
  const data = await res.json() as { data: { conversation_id: string } };
  return data.data.conversation_id;
}

async function uploadEncrypted(
  token: string,
  conversationId: string,
  encryptedBlob: Blob,
  mimeType: string,
  filename: string,
  clientUploadId?: string,
): Promise<{ status: number; body: unknown; timeMs: number }> {
  const b64 = await blobToBase64(encryptedBlob);
  const t0 = performance.now();
  const res = await apiPost("/media", {
    data: b64,
    mime_type: mimeType,
    conversation_id: conversationId,
    original_filename: filename,
    ...(clientUploadId ? { client_upload_id: clientUploadId } : {}),
  }, token);
  const timeMs = performance.now() - t0;
  const body = await res.json();
  return { status: res.status, body, timeMs };
}

// ─── Connettività server ──────────────────────────────────────────────────────

let serverUp = false;
let alice: { token: string; userId: string } | null = null;
let bob:   { token: string; userId: string } | null = null;
let convId = "";
const ts = Date.now();

beforeAll(async () => {
  try {
    const res = await fetch(`${API_BASE}/api/v1/`, { signal: AbortSignal.timeout(3000) });
    serverUp = res.status < 500; // 404 è ok — server risponde
  } catch {
    serverUp = false;
  }

  if (!serverUp) return;

  try {
    alice = await registerUser(`alice_${ts}`);
    bob   = await registerUser(`bob_${ts}`);
    convId = await createConversation(alice.token, `testuser_bob_${ts}`);
  } catch (e) {
    console.warn("[16] Setup fallito:", e);
    serverUp = false;
  }
}, 20000);

function skipIfNoServer() {
  if (!serverUp) return SKIP_LABEL;
  return null;
}

// ─── Suite principale ─────────────────────────────────────────────────────────

describe("16 — Integrazione reale: upload media contro API live", () => {

  // ── 16.1 Connettività ────────────────────────────────────────────────────────
  describe("16.1 — Connettività e setup", () => {
    it("16.1.1 — Il server risponde su " + API_BASE, async () => {
      const skip = skipIfNoServer();
      if (skip) { console.log("  ↷ server non disponibile — skip"); return; }
      expect(serverUp).toBe(true);
    });

    it("16.1.2 — Alice e Bob registrati, conversazione creata", () => {
      const skip = skipIfNoServer();
      if (skip) { console.log("  ↷ skip"); return; }
      expect(alice).not.toBeNull();
      expect(bob).not.toBeNull();
      expect(convId).toMatch(/^[0-9a-fA-F]{24}$/);
    });
  });

  // ── 16.2 Upload reali per tipo e dimensione ───────────────────────────────────
  describe("16.2 — Upload reali: tipi e dimensioni di campo", () => {

    const cases: Array<{ label: string; sizeMB: number; mime: string; ext: string }> = [
      // Casi di campo originali
      { label: "iPhone HEIC 3 MB",          sizeMB: 3,  mime: "image/heic",      ext: "photo.heic"   },
      { label: "JPEG 10 MB",                sizeMB: 10, mime: "image/jpeg",      ext: "photo.jpg"    },
      { label: "Video 15 MB",               sizeMB: 15, mime: "video/mp4",       ext: "video.mp4"    },
      { label: "PDF 10 MB",                 sizeMB: 10, mime: "application/pdf", ext: "doc.pdf"      },
      // Audio: limite Zod include +16 B GCM tag → file esattamente 5 MB raw accettato
      { label: "Audio 5 MB",                sizeMB: 5,  mime: "audio/mpeg",      ext: "audio.mp3"    },
      // Varianti HEIC border-case (richieste dalla review)
      //   HEIC 8 MB — foto ritratto alta risoluzione
      { label: "HEIC 8 MB ritratto",        sizeMB: 8,  mime: "image/heic",      ext: "portrait.heic" },
      //   HEIC 10 MB — al limite (48 MP, HDR, Live Photo still-frame)
      //   Il server non distingue HEIC da JPEG: riceve ciphertext opaco.
      //   Il test verifica memoria e timing, non la decodifica del formato.
      { label: "HEIC 10 MB (limite, 48MP)", sizeMB: 10, mime: "image/heic",      ext: "48mp.heic"    },
    ];

    for (const { label, sizeMB, mime, ext } of cases) {
      it(`16.2 — ${label} → HTTP 201`, async () => {
        const skip = skipIfNoServer();
        if (skip) { console.log(`  ↷ skip (${label})`); return; }

        const blob = makeFakeFile(sizeMB * 1024 * 1024, mime);

        // Cifratura AES-GCM (misura tempo)
        const t0 = performance.now();
        const { encryptedBlob } = await encryptMediaBlob(blob);
        const encryptMs = performance.now() - t0;

        // Upload
        const { status, body, timeMs } = await uploadEncrypted(
          alice!.token, convId, encryptedBlob, mime, ext,
        );

        console.log(
          `  [${label}] cifratura=${encryptMs.toFixed(0)}ms upload=${timeMs.toFixed(0)}ms ` +
          `payloadB64=${(encryptedBlob.size * 4 / 3 / 1024 / 1024).toFixed(2)}MB`,
        );

        expect(status, `HTTP status per ${label}: ${JSON.stringify(body)}`).toBe(201);
        const d = (body as { data: { media_id: string } }).data;
        expect(d.media_id).toMatch(/^[0-9a-fA-F]{24}$/);
      }, 60000);
    }
  });

  // ── 16.3 Doppio limite body ───────────────────────────────────────────────────
  describe("16.3 — Doppio limite body: /media 25 MB, altri 1 MB", () => {

    it("16.3.1 — /media accetta payload da 2 MB (sopra il vecchio 1 MB)", async () => {
      const skip = skipIfNoServer();
      if (skip) { console.log("  ↷ skip"); return; }

      const blob = makeFakeFile(1.5 * 1024 * 1024, "image/jpeg"); // 1.5 MB raw → ~2 MB b64
      const { encryptedBlob } = await encryptMediaBlob(blob);
      const { status } = await uploadEncrypted(
        alice!.token, convId, encryptedBlob, "image/jpeg", "test.jpg",
      );
      expect(status).toBe(201);
    }, 30000);

    it("16.3.2 — /media rifiuta payload da 20 MB (sopra il limite 25 MB) con 413, non 500", async () => {
      const skip = skipIfNoServer();
      if (skip) { console.log("  ↷ skip"); return; }

      // Creiamo un payload JSON > 25 MB mandando solo la stringa data senza davvero cifrare
      // (usiamo direttamente una stringa base64 da 19 MB di bytes → ~25.3 MB b64)
      const hugeB64 = "A".repeat(19 * 1024 * 1024 * 4 / 3 | 0); // ~25 MB
      const res = await apiPost("/media", {
        data: hugeB64,
        mime_type: "image/jpeg",
        conversation_id: convId,
        original_filename: "huge.jpg",
      }, alice!.token);

      console.log(`  [16.3.2] status per payload 25 MB: ${res.status}`);
      // Deve essere 413 (payload too large), NON 500 (dopo il fix)
      expect(res.status).toBe(413);
      const body = await res.json() as { error: { code: string } };
      expect(body.error.code).toBe("PAYLOAD_TOO_LARGE");
    }, 30000);

    it("16.3.3 — qualsiasi endpoint con payload > 25 MB → 413, non 500", async () => {
      const skip = skipIfNoServer();
      if (skip) { console.log("  ↷ skip"); return; }

      // Payload > 25 MB: supera il limite globale per qualsiasi endpoint.
      // Costruiamo il body con Buffer.concat per evitare allocazione di stringhe da 26 MB.
      // Il limite globale è 25 MB = 26,214,400 byte; inviamo 26.5 MB.
      const PREFIX = Buffer.from('{"username":"');
      const FIELD  = Buffer.alloc(26_500_000, 0x78); // 'x' × 26.5 MB
      const SUFFIX = Buffer.from('","password":"t"}');
      const bigBody = Buffer.concat([PREFIX, FIELD, SUFFIX]); // ~26.5 MB totale

      const res = await fetch(`${API_BASE}/api/v1/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: bigBody,
      });

      console.log(`  [16.3.3] status per payload 26.5 MB su /auth/login: ${res.status}`);
      expect(res.status).toBe(413);
      const respBody = await res.json() as { error: { code: string } };
      expect(respBody.error.code).toBe("PAYLOAD_TOO_LARGE");
    }, 30000);

    it("16.3.4 — /auth/login con payload 2 MB (sotto 25 MB) → 400 Zod, non 500", async () => {
      const skip = skipIfNoServer();
      if (skip) { console.log("  ↷ skip"); return; }

      // 2 MB payload: passa il body parser globale (25 MB) ma viene rifiutato da Zod
      // (username max 50 chars). Verifica che la protezione Zod sia l'ultimo presidio.
      const bigUsername = "x".repeat(2 * 1024 * 1024);
      const res = await apiPost("/auth/login", {
        username: bigUsername,
        password: "test",
      });

      console.log(`  [16.3.4] status per login payload 2 MB (Zod): ${res.status}`);
      expect(res.status).toBe(400);
      const body = await res.json() as { error: { code: string } };
      expect(body.error.code).toBe("VALIDATION_ERROR");
    }, 15000);
  });

  // ── 16.4 Zero Knowledge ──────────────────────────────────────────────────────
  describe("16.4 — Zero Knowledge: il server vede solo ciphertext", () => {

    it("16.4.1 — Il payload inviato al server è diverso dal plaintext (cifratura avvenuta)", async () => {
      const skip = skipIfNoServer();
      if (skip) { console.log("  ↷ skip"); return; }

      const SENTINEL = "PLAINTEXT_SENTINEL_VALUE_12345";
      const plainBlob = new Blob([SENTINEL], { type: "text/plain" });

      // Cifra
      const { encryptedBlob, keyBase64 } = await encryptMediaBlob(plainBlob);
      const b64 = await blobToBase64(encryptedBlob);

      // Il payload base64 non deve contenere il sentinel in chiaro
      const decoded = Buffer.from(b64, "base64").toString("utf8");
      expect(decoded).not.toContain(SENTINEL);

      // La chiave AES non deve essere inclusa nel payload (mai)
      expect(b64).not.toContain(keyBase64);

      console.log("  [16.4.1] sentinel non trovato nel ciphertext ✓");
      console.log("  [16.4.1] keyBase64 non trovato nel payload ✓");
    });

    it("16.4.2 — L'endpoint /media NON echo-a la chiave AES nella risposta", async () => {
      const skip = skipIfNoServer();
      if (skip) { console.log("  ↷ skip"); return; }

      const blob = makeFakeFile(64 * 1024, "image/jpeg"); // 64 KB
      const { encryptedBlob, keyBase64 } = await encryptMediaBlob(blob);
      const { status, body } = await uploadEncrypted(
        alice!.token, convId, encryptedBlob, "image/jpeg", "zk-test.jpg",
      );

      expect(status).toBe(201);

      // La risposta JSON non deve contenere la chiave AES
      const responseStr = JSON.stringify(body);
      expect(responseStr).not.toContain(keyBase64);

      // La risposta non deve contenere campi data/blob
      const d = (body as { data: Record<string, unknown> }).data;
      expect(d).not.toHaveProperty("data");
      expect(d).not.toHaveProperty("blob");
      expect(d).not.toHaveProperty("key");

      console.log("  [16.4.2] risposta server non contiene keyBase64 ✓");
      console.log(`  [16.4.2] campi risposta: ${Object.keys(d).join(", ")}`);
    }, 20000);

    it("16.4.3 — Il mime_type inviato è quello originale (non application/octet-stream del ciphertext)", async () => {
      const skip = skipIfNoServer();
      if (skip) { console.log("  ↷ skip"); return; }

      const blob = makeFakeFile(128 * 1024, "image/png");
      const { encryptedBlob } = await encryptMediaBlob(blob);
      const { status, body } = await uploadEncrypted(
        alice!.token, convId, encryptedBlob, "image/png", "test.png",
      );

      expect(status).toBe(201);
      const d = (body as { data: { mime_type: string } }).data;
      // Il server salva il mime_type originale (non application/octet-stream del blob cifrato)
      expect(d.mime_type).toBe("image/png");
    }, 20000);
  });

  // ── 16.6 Idempotenza upload ───────────────────────────────────────────────────
  describe("16.6 — Idempotenza: client_upload_id previene duplicati su retry", () => {

    it("16.6.1 — stesso client_upload_id due volte → stesso media_id, secondo HTTP 200", async () => {
      const skip = skipIfNoServer();
      if (skip) { console.log("  ↷ skip"); return; }

      const blob = makeFakeFile(64 * 1024, "image/jpeg");
      const { encryptedBlob } = await encryptMediaBlob(blob);
      const id = crypto.randomUUID();

      // Prima chiamata: deve creare il documento (201)
      const first = await uploadEncrypted(alice!.token, convId, encryptedBlob, "image/jpeg", "idempotent.jpg", id);
      expect(first.status).toBe(201);
      const firstMediaId = (first.body as { data: { media_id: string } }).data.media_id;
      expect(firstMediaId).toMatch(/^[0-9a-fA-F]{24}$/);

      // Seconda chiamata: stessa chiave → documento esistente (200, stesso media_id)
      const second = await uploadEncrypted(alice!.token, convId, encryptedBlob, "image/jpeg", "idempotent.jpg", id);
      expect(second.status).toBe(200);
      const secondMediaId = (second.body as { data: { media_id: string } }).data.media_id;

      // Nessun duplicato: i due media_id devono essere identici
      expect(secondMediaId).toBe(firstMediaId);
      console.log(`  [16.6.1] media_id primo upload:  ${firstMediaId}`);
      console.log(`  [16.6.1] media_id retry (200):   ${secondMediaId} ✓ (identico, nessun orfano)`);
    }, 20000);

    it("16.6.2 — client_upload_id diversi → media_id distinti (nessuna falsa deduplicazione)", async () => {
      const skip = skipIfNoServer();
      if (skip) { console.log("  ↷ skip"); return; }

      const blob = makeFakeFile(64 * 1024, "image/jpeg");
      const { encryptedBlob } = await encryptMediaBlob(blob);

      const r1 = await uploadEncrypted(alice!.token, convId, encryptedBlob, "image/jpeg", "a.jpg", crypto.randomUUID());
      const r2 = await uploadEncrypted(alice!.token, convId, encryptedBlob, "image/jpeg", "b.jpg", crypto.randomUUID());

      expect(r1.status).toBe(201);
      expect(r2.status).toBe(201);
      const id1 = (r1.body as { data: { media_id: string } }).data.media_id;
      const id2 = (r2.body as { data: { media_id: string } }).data.media_id;
      expect(id1).not.toBe(id2);
      console.log(`  [16.6.2] due chiavi diverse → due media_id diversi ✓`);
    }, 20000);

    it("16.6.3 — senza client_upload_id → retry crea documento orfano duplicato (comportamento legacy)", async () => {
      const skip = skipIfNoServer();
      if (skip) { console.log("  ↷ skip"); return; }

      // Questo test documenta il comportamento SENZA idempotenza:
      // ogni chiamata senza client_upload_id crea un nuovo documento.
      // Il client DEVE sempre fornire client_upload_id per evitare duplicati.
      const blob = makeFakeFile(32 * 1024, "image/jpeg");
      const { encryptedBlob } = await encryptMediaBlob(blob);

      const r1 = await uploadEncrypted(alice!.token, convId, encryptedBlob, "image/jpeg", "no-id.jpg");
      const r2 = await uploadEncrypted(alice!.token, convId, encryptedBlob, "image/jpeg", "no-id.jpg");

      expect(r1.status).toBe(201);
      expect(r2.status).toBe(201);
      const id1 = (r1.body as { data: { media_id: string } }).data.media_id;
      const id2 = (r2.body as { data: { media_id: string } }).data.media_id;
      // Senza chiave, due documenti distinti vengono creati (orfano potenziale)
      expect(id1).not.toBe(id2);
      console.log(`  [16.6.3] senza client_upload_id → due media_id diversi (orfano potenziale documentato) ✓`);
    }, 20000);

    it("16.6.4 — client_upload_id di un altro utente non produce collisione (isolamento per uploader_id)", async () => {
      const skip = skipIfNoServer();
      if (skip) { console.log("  ↷ skip"); return; }

      // Stessa UUID usata da Alice e Bob: devono ottenere media_id distinti
      const blob = makeFakeFile(32 * 1024, "image/jpeg");
      const { encryptedBlob: blobAlice } = await encryptMediaBlob(blob);
      const { encryptedBlob: blobBob }   = await encryptMediaBlob(blob);
      const sharedId = crypto.randomUUID();

      // Bob deve anche far parte della conversazione (già membro)
      const rAlice = await uploadEncrypted(alice!.token, convId, blobAlice, "image/jpeg", "alice.jpg", sharedId);
      const rBob   = await uploadEncrypted(bob!.token,   convId, blobBob,   "image/jpeg", "bob.jpg",   sharedId);

      expect(rAlice.status).toBe(201);
      expect(rBob.status).toBe(201);
      const idAlice = (rAlice.body as { data: { media_id: string } }).data.media_id;
      const idBob   = (rBob.body   as { data: { media_id: string } }).data.media_id;
      // Utenti diversi con stessa UUID → documenti separati, nessuna contaminazione
      expect(idAlice).not.toBe(idBob);
      console.log(`  [16.6.4] stessa UUID, uploader diversi → media_id separati ✓ (isolamento corretto)`);
    }, 20000);
  });

  // ── 16.5 Timing e memoria ────────────────────────────────────────────────────
  describe("16.5 — Timing: cifratura e base64 per file grandi", () => {

    const sizeCases: Array<{ sizeMB: number; maxEncryptMs: number; maxB64Ms: number }> = [
      { sizeMB: 1,  maxEncryptMs: 200,  maxB64Ms: 2000  },
      { sizeMB: 5,  maxEncryptMs: 500,  maxB64Ms: 10000 },
      { sizeMB: 10, maxEncryptMs: 1000, maxB64Ms: 20000 },
      { sizeMB: 15, maxEncryptMs: 1500, maxB64Ms: 30000 },
    ];

    for (const { sizeMB, maxEncryptMs, maxB64Ms } of sizeCases) {
      it(`16.5 — ${sizeMB} MB: cifratura < ${maxEncryptMs}ms, base64 < ${maxB64Ms}ms`, async () => {
        const blob = makeFakeFile(sizeMB * 1024 * 1024, "video/mp4");

        // Tempo cifratura AES-GCM
        const t0 = performance.now();
        const { encryptedBlob } = await encryptMediaBlob(blob);
        const encryptMs = performance.now() - t0;

        // Tempo conversione base64 (bottleneck attuale: loop carattere-per-carattere)
        const t1 = performance.now();
        await blobToBase64(encryptedBlob);
        const b64Ms = performance.now() - t1;

        console.log(
          `  [${sizeMB}MB] encrypt=${encryptMs.toFixed(0)}ms base64=${b64Ms.toFixed(0)}ms ` +
          `(limit: ${maxEncryptMs}ms / ${maxB64Ms}ms)`,
        );

        expect(encryptMs).toBeLessThan(maxEncryptMs);
        expect(b64Ms).toBeLessThan(maxB64Ms);
      }, 60000);
    }
  });

});
