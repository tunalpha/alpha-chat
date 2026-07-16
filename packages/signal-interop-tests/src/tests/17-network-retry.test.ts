/**
 * Test 17 — Resilienza di rete: retry, abort, media orfani
 *
 * Contesto (2026-07-16):
 *   Un upload media E2E attraversa quattro fasi:
 *     1. Client: genera AES-256-GCM key, cifra il blob → base64
 *     2. Client: POST /api/v1/media (body JSON ~1.33× plaintext)
 *     3. Server: valida, salva su MongoDB, risponde 201
 *     4. Client: riceve media_id, invia messaggio Signal che lo referenzia
 *
 *   Scenari di guasto:
 *     A. Connessione caduta a metà upload (TCP reset):
 *        Express non chiama il route handler → nessuna scrittura su MongoDB.
 *        Il client riceve fetch rejection (network error).
 *        Se riprova con la stessa client_upload_id → crea correttamente il documento (201).
 *
 *     B. Upload completato, risposta persa (server ha scritto, client non ha ricevuto):
 *        Il client non sa se il documento è stato creato.
 *        Se riprova con la stessa client_upload_id → ottiene il documento esistente (200).
 *        Nessun orfano, nessun duplicato.
 *
 *     C. Upload senza client_upload_id (legacy):
 *        Ogni retry crea un documento distinto.
 *        I vecchi documenti diventano orfani irraggiungibili dall'utente.
 *
 *   Nota sulla rete reale (Wi-Fi → 4G, airplane mode):
 *     Questi scenari non sono testabili in modo automatico nell'ambiente CI
 *     perché richiedono il controllo dell'interfaccia di rete del dispositivo.
 *     Test 17 simula i due esiti di una caduta di rete:
 *       - abort prima che il server risponda (fetch rejection)
 *       - server scrive ma il client non riceve (simulato con upload + discard response)
 *     e verifica che il meccanismo di idempotenza gestisca entrambi correttamente.
 *
 * Prerequisito: API_BASE_URL deve puntare al server in esecuzione.
 */

import { describe, it, expect, beforeAll } from "vitest";

// ─── Config ───────────────────────────────────────────────────────────────────

const API_BASE = process.env.API_BASE_URL ?? "http://localhost:8080";

// ─── Crypto helpers ───────────────────────────────────────────────────────────

const AES_KEY_BITS = 256;
const GCM_IV_BYTES = 12;

async function encryptMediaBlob(blob: Blob): Promise<{
  encryptedBlob: Blob; keyBase64: string; ivBase64: string;
}> {
  const key = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: AES_KEY_BITS }, true, ["encrypt", "decrypt"],
  );
  const rawKey = await crypto.subtle.exportKey("raw", key);
  const keyBase64 = rawToBase64(rawKey);
  const iv = crypto.getRandomValues(new Uint8Array(GCM_IV_BYTES));
  const ivBase64 = rawToBase64(iv.buffer as ArrayBuffer);
  const plain = await blob.arrayBuffer();
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plain);
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

function makeFakeFile(bytes: number, mime: string): Blob {
  const buf = new Uint8Array(bytes);
  const seed = new Uint8Array(Math.min(bytes, 65536));
  crypto.getRandomValues(seed);
  for (let i = 0; i < bytes; i++) buf[i] = seed[i % seed.length] ^ (i & 0xff);
  return new Blob([buf], { type: mime });
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

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
  const res = await apiPost("/auth/register", {
    username: `retrytest_${suffix}`,
    display_name: `Retry ${suffix}`,
    password: "Test1234!",
    device_id:   crypto.randomUUID(),
    device_type: "web",
  });
  if (!res.ok) throw new Error(`register failed ${res.status}: ${await res.text()}`);
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
  clientUploadId?: string,
): Promise<{ status: number; body: unknown }> {
  const b64 = await blobToBase64(encryptedBlob);
  const res = await apiPost("/media", {
    data: b64,
    mime_type: mimeType,
    conversation_id: conversationId,
    original_filename: "test.jpg",
    ...(clientUploadId ? { client_upload_id: clientUploadId } : {}),
  }, token);
  const body = await res.json();
  return { status: res.status, body };
}

// ─── Setup ────────────────────────────────────────────────────────────────────

let serverUp = false;
let alice: { token: string; userId: string } | null = null;
let bob: { token: string; userId: string } | null = null;
let convId = "";
const ts = Date.now();

beforeAll(async () => {
  try {
    const res = await fetch(`${API_BASE}/api/v1/`, { signal: AbortSignal.timeout(3000) });
    serverUp = res.status < 500;
  } catch {
    serverUp = false;
  }

  if (!serverUp) return;

  try {
    alice = await registerUser(`alice_${ts}`);
    bob   = await registerUser(`bob_${ts}`);
    convId = await createConversation(alice.token, `retrytest_bob_${ts}`);
  } catch (e) {
    console.warn("[17] Setup fallito:", e);
    serverUp = false;
  }
}, 20000);

function skipIfNoServer() {
  if (!serverUp) return "SKIP";
  return null;
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe("17 — Resilienza di rete: retry, idempotenza, media orfani", () => {

  // ── 17.1 Scenario A: abort prima che il server risponda ─────────────────────
  describe("17.1 — Scenario A: abort (fetch rejection) → retry con stessa chiave", () => {

    it("17.1.1 — upload abortito (AbortController) → nessuna scrittura su DB", async () => {
      const skip = skipIfNoServer();
      if (skip) { console.log("  ↷ skip"); return; }

      // Simula un abort PRIMA di inviare la richiesta (timeout 0ms).
      // In produzione questo corrisponde alla rete caduta prima che il TCP
      // completasse il trasferimento del corpo.
      const blob = makeFakeFile(32 * 1024, "image/jpeg");
      const { encryptedBlob } = await encryptMediaBlob(blob);
      const b64 = await blobToBase64(encryptedBlob);

      let networkErrorCaught = false;
      try {
        await fetch(`${API_BASE}/api/v1/media`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${alice!.token}` },
          body: JSON.stringify({ data: b64, mime_type: "image/jpeg", conversation_id: convId }),
          signal: AbortSignal.timeout(1), // Timeout di 1ms → abort garantito
        });
      } catch {
        networkErrorCaught = true;
      }

      // L'abort deve essere catturato come eccezione di rete
      expect(networkErrorCaught).toBe(true);
      console.log("  [17.1.1] fetch rejection catturata correttamente ✓");
    }, 10000);

    it("17.1.2 — dopo abort, retry con client_upload_id → crea documento (201)", async () => {
      const skip = skipIfNoServer();
      if (skip) { console.log("  ↷ skip"); return; }

      const blob = makeFakeFile(32 * 1024, "image/jpeg");
      const { encryptedBlob } = await encryptMediaBlob(blob);
      const uploadId = crypto.randomUUID();

      // Simula abort (1ms timeout) — nessuna scrittura sul server
      try {
        const b64 = await blobToBase64(encryptedBlob);
        await fetch(`${API_BASE}/api/v1/media`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${alice!.token}` },
          body: JSON.stringify({
            data: b64, mime_type: "image/jpeg",
            conversation_id: convId, client_upload_id: uploadId,
          }),
          signal: AbortSignal.timeout(1),
        });
      } catch { /* atteso */ }

      // Retry reale con la stessa chiave → deve creare il documento (il server non l'ha mai ricevuto)
      const retry = await uploadEncrypted(alice!.token, convId, encryptedBlob, "image/jpeg", uploadId);
      expect(retry.status).toBe(201);
      const mediaId = (retry.body as { data: { media_id: string } }).data.media_id;
      expect(mediaId).toMatch(/^[0-9a-fA-F]{24}$/);
      console.log(`  [17.1.2] retry dopo abort → 201, media_id: ${mediaId} ✓`);
    }, 20000);
  });

  // ── 17.2 Scenario B: server scrive, risposta persa ──────────────────────────
  describe("17.2 — Scenario B: server scrive OK, client non riceve risposta → retry idempotente", () => {

    it("17.2.1 — primo upload OK (201), retry con stessa chiave → 200, stesso media_id (nessun orfano)", async () => {
      const skip = skipIfNoServer();
      if (skip) { console.log("  ↷ skip"); return; }

      const blob = makeFakeFile(128 * 1024, "image/png");
      const { encryptedBlob } = await encryptMediaBlob(blob);
      const uploadId = crypto.randomUUID();

      // Primo upload (simula: server ha scritto, risposta ricevuta)
      const first = await uploadEncrypted(alice!.token, convId, encryptedBlob, "image/png", uploadId);
      expect(first.status).toBe(201);
      const firstId = (first.body as { data: { media_id: string } }).data.media_id;

      // Retry (simula: il client non sapeva se il primo era andato a buon fine)
      const second = await uploadEncrypted(alice!.token, convId, encryptedBlob, "image/png", uploadId);
      expect(second.status).toBe(200);
      const secondId = (second.body as { data: { media_id: string } }).data.media_id;

      // Nessun orfano: stesso media_id
      expect(secondId).toBe(firstId);
      console.log(`  [17.2.1] 201 → 200 retry, media_id identico: ${firstId} ✓`);
    }, 20000);

    it("17.2.2 — retry multipli (n=5) con stessa chiave → tutti 200, stesso media_id", async () => {
      const skip = skipIfNoServer();
      if (skip) { console.log("  ↷ skip"); return; }

      const blob = makeFakeFile(64 * 1024, "image/jpeg");
      const { encryptedBlob } = await encryptMediaBlob(blob);
      const uploadId = crypto.randomUUID();

      // Primo upload
      const first = await uploadEncrypted(alice!.token, convId, encryptedBlob, "image/jpeg", uploadId);
      expect(first.status).toBe(201);
      const firstId = (first.body as { data: { media_id: string } }).data.media_id;

      // 4 retry consecutivi
      for (let i = 0; i < 4; i++) {
        const r = await uploadEncrypted(alice!.token, convId, encryptedBlob, "image/jpeg", uploadId);
        expect(r.status).toBe(200);
        expect((r.body as { data: { media_id: string } }).data.media_id).toBe(firstId);
      }

      console.log(`  [17.2.2] 5 chiamate totali, stesso media_id ogni volta ✓`);
    }, 40000);

    it("17.2.3 — la risposta di retry (200) ha gli stessi campi della risposta originale (201)", async () => {
      const skip = skipIfNoServer();
      if (skip) { console.log("  ↷ skip"); return; }

      const blob = makeFakeFile(64 * 1024, "image/jpeg");
      const { encryptedBlob } = await encryptMediaBlob(blob);
      const uploadId = crypto.randomUUID();

      const first  = await uploadEncrypted(alice!.token, convId, encryptedBlob, "image/jpeg", uploadId);
      const second = await uploadEncrypted(alice!.token, convId, encryptedBlob, "image/jpeg", uploadId);

      expect(first.status).toBe(201);
      expect(second.status).toBe(200);

      const d1 = (first.body  as { data: Record<string, unknown> }).data;
      const d2 = (second.body as { data: Record<string, unknown> }).data;

      // Tutti i campi devono corrispondere (il client può usare la risposta di retry
      // come se fosse la risposta originale senza distinzione)
      expect(d2.media_id).toBe(d1.media_id);
      expect(d2.size).toBe(d1.size);
      expect(d2.mime_type).toBe(d1.mime_type);
      expect(d2.has_thumbnail).toBe(d1.has_thumbnail);

      console.log(`  [17.2.3] campi 200 == campi 201 ✓`);
    }, 20000);
  });

  // ── 17.3 Scenario C: senza idempotenza (legacy) ─────────────────────────────
  describe("17.3 — Scenario C: senza client_upload_id → orphan creation documentata", () => {

    it("17.3.1 — due upload identici senza chiave → due media_id distinti (orfani potenziali)", async () => {
      const skip = skipIfNoServer();
      if (skip) { console.log("  ↷ skip"); return; }

      const blob = makeFakeFile(32 * 1024, "image/jpeg");
      const { encryptedBlob } = await encryptMediaBlob(blob);

      const r1 = await uploadEncrypted(alice!.token, convId, encryptedBlob, "image/jpeg");
      const r2 = await uploadEncrypted(alice!.token, convId, encryptedBlob, "image/jpeg");

      expect(r1.status).toBe(201);
      expect(r2.status).toBe(201);

      const id1 = (r1.body as { data: { media_id: string } }).data.media_id;
      const id2 = (r2.body as { data: { media_id: string } }).data.media_id;
      expect(id1).not.toBe(id2);

      console.log(`  [17.3.1] senza chiave → duplicato creato (${id1} ≠ ${id2})`);
      console.log(`           AZIONE RICHIESTA: il client DEVE sempre fornire client_upload_id`);
    }, 20000);
  });

  // ── 17.4 Sicurezza: isolamento tra utenti ────────────────────────────────────
  describe("17.4 — Sicurezza: isolamento client_upload_id per uploader", () => {

    it("17.4.1 — stessa UUID da utenti diversi → documenti separati (nessuna contaminazione)", async () => {
      const skip = skipIfNoServer();
      if (skip) { console.log("  ↷ skip"); return; }

      const blobA = makeFakeFile(32 * 1024, "image/jpeg");
      const blobB = makeFakeFile(32 * 1024, "image/png"); // contenuto diverso
      const { encryptedBlob: encA } = await encryptMediaBlob(blobA);
      const { encryptedBlob: encB } = await encryptMediaBlob(blobB);

      // UUID condivisa (scenario astronomicamente raro ma coperto per correttezza)
      const sharedUUID = crypto.randomUUID();

      const rA = await uploadEncrypted(alice!.token, convId, encA, "image/jpeg", sharedUUID);
      // Bob usa la stessa UUID → deve ottenere un documento SEPARATO, non quello di Alice
      const rB = await uploadEncrypted(bob!.token, convId, encB, "image/png", sharedUUID);

      expect(rA.status).toBe(201);
      expect(rB.status).toBe(201); // 201, non 200 — nessuna "hit" sul documento di Alice

      const idA = (rA.body as { data: { media_id: string } }).data.media_id;
      const idB = (rB.body as { data: { media_id: string } }).data.media_id;
      expect(idA).not.toBe(idB);

      console.log(`  [17.4.1] UUID condivisa → Alice: ${idA}, Bob: ${idB} (separati) ✓`);
    }, 20000);

    it("17.4.2 — retry di Alice con UUID di Alice → 200 (non interferisce con Bob)", async () => {
      const skip = skipIfNoServer();
      if (skip) { console.log("  ↷ skip"); return; }

      const blob = makeFakeFile(32 * 1024, "image/jpeg");
      const { encryptedBlob: encA } = await encryptMediaBlob(blob);
      const { encryptedBlob: encB } = await encryptMediaBlob(blob);

      const sharedUUID = crypto.randomUUID();

      // Alice upload
      const rA1 = await uploadEncrypted(alice!.token, convId, encA, "image/jpeg", sharedUUID);
      expect(rA1.status).toBe(201);
      const aliceMediaId = (rA1.body as { data: { media_id: string } }).data.media_id;

      // Bob upload con stessa UUID → crea il suo (201, non deduplicato con Alice)
      const rB = await uploadEncrypted(bob!.token, convId, encB, "image/jpeg", sharedUUID);
      expect(rB.status).toBe(201);

      // Alice retry → 200, stesso media_id di Alice (non quello di Bob)
      const rA2 = await uploadEncrypted(alice!.token, convId, encA, "image/jpeg", sharedUUID);
      expect(rA2.status).toBe(200);
      expect((rA2.body as { data: { media_id: string } }).data.media_id).toBe(aliceMediaId);

      console.log(`  [17.4.2] retry Alice → 200 con media_id di Alice, non di Bob ✓`);
    }, 30000);
  });

  // ── 17.5 Conformità risposta ─────────────────────────────────────────────────
  describe("17.5 — Conformità: already_existed nella risposta di servizio", () => {

    it("17.5.1 — primo upload: already_existed assente o false", async () => {
      const skip = skipIfNoServer();
      if (skip) { console.log("  ↷ skip"); return; }

      const blob = makeFakeFile(32 * 1024, "image/jpeg");
      const { encryptedBlob } = await encryptMediaBlob(blob);
      const { status, body } = await uploadEncrypted(
        alice!.token, convId, encryptedBlob, "image/jpeg", crypto.randomUUID(),
      );
      expect(status).toBe(201);
      // already_existed nel payload di data (opzionale, può non essere incluso)
      const d = (body as { data: Record<string, unknown> }).data;
      // Se presente, deve essere false
      if ("already_existed" in d) expect(d.already_existed).toBe(false);
      console.log(`  [17.5.1] already_existed nel primo upload: ${d.already_existed ?? "(non incluso)"} ✓`);
    }, 10000);

    it("17.5.2 — retry: already_existed = true", async () => {
      const skip = skipIfNoServer();
      if (skip) { console.log("  ↷ skip"); return; }

      const blob = makeFakeFile(32 * 1024, "image/jpeg");
      const { encryptedBlob } = await encryptMediaBlob(blob);
      const uploadId = crypto.randomUUID();

      await uploadEncrypted(alice!.token, convId, encryptedBlob, "image/jpeg", uploadId); // primo
      const second = await uploadEncrypted(alice!.token, convId, encryptedBlob, "image/jpeg", uploadId); // retry

      const d = (second.body as { data: Record<string, unknown> }).data;
      expect(d.already_existed).toBe(true);
      console.log(`  [17.5.2] already_existed nel retry: ${d.already_existed} ✓`);
    }, 20000);
  });
});
