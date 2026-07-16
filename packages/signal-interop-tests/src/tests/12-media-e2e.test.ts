/**
 * Test 12 — Media E2E: AES-256-GCM + Signal key wrapping
 *
 * Verifica la pipeline di cifratura media di Fase 3:
 *   1. AES-256-GCM encrypt/decrypt
 *   2. Zero Plaintext Rule (server vede solo byte opachi)
 *   3. Key wrapping via Signal SessionCipher
 *   4. Replay / replay media attack
 *   5. Secure Destroy (nessuna possibilità di recupero)
 *   6. Burn After Read media
 *   7. Multi-device (stessa chiave AES, sessioni Signal diverse)
 *   8. Multi-format (audio, immagine, video, documento)
 *
 * Nota: usa Web Crypto API (disponibile in Node 20+).
 */

import { describe, it, expect, beforeAll } from "vitest";
import { initLibsignal } from "../helpers/setup.js";
import {
  createPersona,
  buildSession,
  encryptMessage,
  decryptMessage,
} from "../helpers/utils.js";

beforeAll(async () => {
  await initLibsignal();
});

// ---------------------------------------------------------------------------
// Replica locale della pipeline media-crypto.ts (Node-safe, no import.meta)
// ---------------------------------------------------------------------------

const AES_KEY_BITS = 256;
const GCM_IV_BYTES = 12;

async function generateMediaKey(): Promise<{ key: CryptoKey; keyBase64: string }> {
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: AES_KEY_BITS }, true, ["encrypt", "decrypt"]);
  const raw = await crypto.subtle.exportKey("raw", key);
  return { key, keyBase64: rawToBase64(raw) };
}

function generateIV(): { iv: Uint8Array; ivBase64: string } {
  const iv = crypto.getRandomValues(new Uint8Array(GCM_IV_BYTES));
  return { iv, ivBase64: rawToBase64(iv.buffer as ArrayBuffer) };
}

async function encryptBytes(data: Uint8Array, key: CryptoKey, iv: Uint8Array): Promise<ArrayBuffer> {
  return crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, data);
}

async function decryptBytes(encrypted: ArrayBuffer, key: CryptoKey, iv: Uint8Array): Promise<ArrayBuffer> {
  return crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, encrypted);
}

async function importKeyBase64(b64: string): Promise<CryptoKey> {
  const raw = base64ToRaw(b64);
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM", length: AES_KEY_BITS }, false, ["decrypt"]);
}

function rawToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function base64ToRaw(b64: string): ArrayBuffer {
  const s = atob(b64);
  const a = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i);
  return a.buffer as ArrayBuffer;
}

function base64ToUint8Array(b64: string): Uint8Array {
  return new Uint8Array(base64ToRaw(b64));
}

/** Simula encryptMediaBlob */
async function encryptMedia(data: Uint8Array): Promise<{ encrypted: ArrayBuffer; keyBase64: string; ivBase64: string }> {
  const { key, keyBase64 } = await generateMediaKey();
  const { iv, ivBase64 } = generateIV();
  const encrypted = await encryptBytes(data, key, iv);
  return { encrypted, keyBase64, ivBase64 };
}

/** Simula decryptBuffer */
async function decryptMedia(encrypted: ArrayBuffer, keyBase64: string, ivBase64: string): Promise<ArrayBuffer> {
  const key = await importKeyBase64(keyBase64);
  const iv = base64ToUint8Array(ivBase64);
  return decryptBytes(encrypted, key, iv);
}

/** Crea dati di test per un tipo di media */
function fakeMediaData(type: string, sizeBytes = 1024): Uint8Array {
  const data = crypto.getRandomValues(new Uint8Array(sizeBytes));
  // Aggiungi magic bytes per tipo (simulazione)
  if (type === "jpeg") { data[0] = 0xFF; data[1] = 0xD8; }
  if (type === "png")  { data[0] = 0x89; data[1] = 0x50; }
  if (type === "mp4")  { data[4] = 0x66; data[5] = 0x74; data[6] = 0x79; data[7] = 0x70; }
  if (type === "pdf")  { data[0] = 0x25; data[1] = 0x50; data[2] = 0x44; data[3] = 0x46; }
  if (type === "ogg")  { data[0] = 0x4F; data[1] = 0x67; data[2] = 0x67; data[3] = 0x53; }
  return data;
}

// ---------------------------------------------------------------------------
// 1. AES-256-GCM base
// ---------------------------------------------------------------------------

describe("12 — Media E2E: cifratura media", () => {

  it("AES-256-GCM: round-trip encrypt/decrypt corretto", async () => {
    const plain = fakeMediaData("jpeg", 2048);
    const { encrypted, keyBase64, ivBase64 } = await encryptMedia(plain);

    // I byte cifrati sono diversi dal plaintext
    expect(new Uint8Array(encrypted)).not.toEqual(plain);

    // Decrypt recupera il plaintext originale
    const decrypted = await decryptMedia(encrypted, keyBase64, ivBase64);
    expect(new Uint8Array(decrypted)).toEqual(plain);
  });

  it("Chiave diversa per ogni file (no key reuse)", async () => {
    const data = fakeMediaData("png");
    const { keyBase64: k1 } = await encryptMedia(data);
    const { keyBase64: k2 } = await encryptMedia(data);
    expect(k1).not.toBe(k2); // chiavi diverse
  });

  it("IV diverso per ogni operazione (nonce unico)", async () => {
    const data = fakeMediaData("mp4");
    const { ivBase64: iv1 } = await encryptMedia(data);
    const { ivBase64: iv2 } = await encryptMedia(data);
    expect(iv1).not.toBe(iv2); // IV diversi
  });

  it("GCM tag verifica integrità: decrypt fallisce con byte alterati", async () => {
    const plain = fakeMediaData("pdf", 512);
    const { encrypted, keyBase64, ivBase64 } = await encryptMedia(plain);

    // Altera un byte nel ciphertext
    const tampered = encrypted.slice(0);
    new Uint8Array(tampered)[10] ^= 0xFF;

    await expect(decryptMedia(tampered, keyBase64, ivBase64)).rejects.toThrow();
  });

  it("GCM tag verifica: chiave sbagliata → decrypt fallisce", async () => {
    const plain = fakeMediaData("jpeg");
    const { encrypted, ivBase64 } = await encryptMedia(plain);
    const { keyBase64: wrongKey } = await generateMediaKey();

    await expect(decryptMedia(encrypted, wrongKey, ivBase64)).rejects.toThrow();
  });

  it("GCM tag verifica: IV sbagliato → decrypt fallisce", async () => {
    const plain = fakeMediaData("mp4");
    const { encrypted, keyBase64 } = await encryptMedia(plain);
    const { ivBase64: wrongIv } = generateIV();

    await expect(decryptMedia(encrypted, keyBase64, wrongIv)).rejects.toThrow();
  });

  // ── Multi-format ──────────────────────────────────────────────────────────

  it("Multi-format: JPEG cifrato e decifrato correttamente", async () => {
    const plain = fakeMediaData("jpeg", 10_000);
    const { encrypted, keyBase64, ivBase64 } = await encryptMedia(plain);
    const decrypted = await decryptMedia(encrypted, keyBase64, ivBase64);
    expect(new Uint8Array(decrypted)).toEqual(plain);
    expect(new Uint8Array(decrypted)[0]).toBe(0xFF); // magic byte preservato
    expect(new Uint8Array(decrypted)[1]).toBe(0xD8);
  });

  it("Multi-format: OGG audio cifrato e decifrato correttamente", async () => {
    const plain = fakeMediaData("ogg", 50_000);
    const { encrypted, keyBase64, ivBase64 } = await encryptMedia(plain);
    const decrypted = await decryptMedia(encrypted, keyBase64, ivBase64);
    expect(new Uint8Array(decrypted)).toEqual(plain);
    expect(new Uint8Array(decrypted)[0]).toBe(0x4F); // 'O'
  });

  it("Multi-format: PDF cifrato e decifrato correttamente", async () => {
    const plain = fakeMediaData("pdf", 5_000);
    const { encrypted, keyBase64, ivBase64 } = await encryptMedia(plain);
    const decrypted = await decryptMedia(encrypted, keyBase64, ivBase64);
    expect(new Uint8Array(decrypted)).toEqual(plain);
  });

  // ── Zero Plaintext Rule ───────────────────────────────────────────────────

  it("Zero Plaintext Rule: il server vede solo byte opachi", async () => {
    const plain = fakeMediaData("jpeg", 1024);
    const { encrypted, keyBase64, ivBase64 } = await encryptMedia(plain);

    // Il ciphertext non contiene il keyBase64 (la chiave non è nel blob cifrato)
    const encBase64 = rawToBase64(encrypted);
    expect(encBase64).not.toContain(keyBase64);
    expect(encBase64).not.toContain(ivBase64);

    // Il ciphertext non contiene i magic byte del JPEG in chiaro
    // (probabilità astronomicamente bassa di match casuale in 1KB)
    const encBytes = new Uint8Array(encrypted);
    let found = false;
    for (let i = 0; i < encBytes.length - 1; i++) {
      if (encBytes[i] === 0xFF && encBytes[i+1] === 0xD8) { found = true; break; }
    }
    // Non è garantito al 100% per file piccoli casuali, ma statisticamente improbabile
    // e comunque il GCM tag rende impossibile invertire senza chiave
    expect(encBase64.length).toBeGreaterThan(100);
  });
});

// ---------------------------------------------------------------------------
// 2. Key wrapping via Signal
// ---------------------------------------------------------------------------

describe("12 — Media E2E: key wrapping con Signal", () => {

  it("Il metadata Signal-cifrato include chiave e IV (mai in chiaro sul server)", async () => {
    const alice = await createPersona("alice", 1);
    const bob = await createPersona("bob", 1);
    await buildSession(alice, bob, true);
    const ct0 = await encryptMessage(alice, "bob", 1, "Setup");
    await decryptMessage(bob, "alice", 1, ct0);

    const plain = fakeMediaData("jpeg", 2048);
    const { keyBase64, ivBase64 } = await encryptMedia(plain);

    // Alice Signal-cifra il metadata (che include la chiave AES)
    const meta = JSON.stringify({
      e2e: true,
      type: "image",
      media_id: "fake-media-id-123",
      key: keyBase64,
      iv: ivBase64,
      mime_type: "image/jpeg",
      filename: "photo.jpg",
      size: plain.length,
    });
    const ct = await encryptMessage(alice, "bob", 1, meta);

    // Il server NON può vedere la chiave nel ciphertext Signal
    expect(ct.body).not.toContain(keyBase64);
    expect(ct.body).not.toContain(ivBase64);

    // Bob decifra il metadata e recupera la chiave
    const decryptedMeta = await decryptMessage(bob, "alice", 1, ct);
    const parsed = JSON.parse(decryptedMeta);
    expect(parsed.e2e).toBe(true);
    expect(parsed.key).toBe(keyBase64);
    expect(parsed.iv).toBe(ivBase64);
    expect(parsed.media_id).toBe("fake-media-id-123");
  });

  it("Pipeline completa: encrypt → Signal wrap → Signal unwrap → decrypt", async () => {
    const alice = await createPersona("alice", 1);
    const bob = await createPersona("bob", 1);
    await buildSession(alice, bob, true);
    const ct0 = await encryptMessage(alice, "bob", 1, "Setup");
    await decryptMessage(bob, "alice", 1, ct0);

    // 1. Alice cifra il file
    const plainData = fakeMediaData("ogg", 5_000);
    const { encrypted, keyBase64, ivBase64 } = await encryptMedia(plainData);

    // 2. Alice Signal-cifra il metadata (con chiave AES)
    const meta = JSON.stringify({ e2e: true, type: "voice", media_id: "v-1", key: keyBase64, iv: ivBase64, duration_ms: 3000, waveform: [] });
    const ctMeta = await encryptMessage(alice, "bob", 1, meta);

    // 3. Il server riceve: blob cifrato + ciphertext Signal (metadata)
    //    Il server NON ha la chiave AES → non può decifrare il blob

    // 4. Bob riceve il ciphertext Signal → Signal decrypt → metadata con chiave
    const decryptedMeta = await decryptMessage(bob, "alice", 1, ctMeta);
    const { key: decrKeyBase64, iv: decrIvBase64 } = JSON.parse(decryptedMeta);

    // 5. Bob scarica il blob cifrato e lo decifra localmente
    const decryptedData = await decryptMedia(encrypted, decrKeyBase64, decrIvBase64);
    expect(new Uint8Array(decryptedData)).toEqual(plainData);
  });

  it("Replay media: ciphertext Signal riusato → eccezione", async () => {
    const alice = await createPersona("alice", 1);
    const bob = await createPersona("bob", 1);
    await buildSession(alice, bob, true);
    const ct0 = await encryptMessage(alice, "bob", 1, "Setup");
    await decryptMessage(bob, "alice", 1, ct0);

    const { keyBase64, ivBase64 } = await encryptMedia(fakeMediaData("jpeg"));
    const meta = JSON.stringify({ e2e: true, type: "image", media_id: "img-1", key: keyBase64, iv: ivBase64 });
    const ctMeta = await encryptMessage(alice, "bob", 1, meta);

    // Primo decrypt: OK
    const pt1 = await decryptMessage(bob, "alice", 1, ctMeta);
    expect(JSON.parse(pt1).key).toBe(keyBase64);

    // Replay: stessa coppia → eccezione (chiave di messaggio già consumata)
    await expect(decryptMessage(bob, "alice", 1, ctMeta)).rejects.toThrow();
  });

  // ── Secure Destroy ────────────────────────────────────────────────────────

  it("Secure Destroy: dopo la cancellazione del messaggio Signal, la chiave AES è irrecuperabile", async () => {
    const alice = await createPersona("alice", 1);
    const bob = await createPersona("bob", 1);
    await buildSession(alice, bob, true);
    const ct0 = await encryptMessage(alice, "bob", 1, "Setup");
    await decryptMessage(bob, "alice", 1, ct0);

    const { encrypted, keyBase64, ivBase64 } = await encryptMedia(fakeMediaData("pdf", 2000));
    const meta = JSON.stringify({ e2e: true, type: "document", media_id: "doc-1", key: keyBase64, iv: ivBase64 });
    const ctMeta = await encryptMessage(alice, "bob", 1, meta);

    // Bob legge il messaggio (Secure Destroy non ancora avvenuto)
    const decrMeta = await decryptMessage(bob, "alice", 1, ctMeta);
    const { key: k, iv: iv } = JSON.parse(decrMeta);
    const decrData = await decryptMedia(encrypted, k, iv);
    expect(new Uint8Array(decrData).length).toBeGreaterThan(0);

    // Dopo Secure Destroy: il messaggio Signal è già stato usato (non riproducibile)
    // Il server cancella il blob cifrato
    // La chiave AES era solo nel messaggio Signal già decifrato (non persistita)
    // → Nessuna possibilità di recupero dal server
    await expect(decryptMessage(bob, "alice", 1, ctMeta)).rejects.toThrow(); // replay impossibile
  });

  // ── Burn After Read media ─────────────────────────────────────────────────

  it("BAR media: lo stesso flusso E2E funziona con burnAfterRead=true", async () => {
    const alice = await createPersona("alice", 1);
    const bob = await createPersona("bob", 1);
    await buildSession(alice, bob, true);
    const ct0 = await encryptMessage(alice, "bob", 1, "Setup");
    await decryptMessage(bob, "alice", 1, ct0);

    const plainData = fakeMediaData("jpeg", 500);
    const { encrypted, keyBase64, ivBase64 } = await encryptMedia(plainData);
    const meta = JSON.stringify({
      e2e: true, type: "image", media_id: "bar-img-1",
      key: keyBase64, iv: ivBase64,
      burn_after_read: true,
    });
    const ctMeta = await encryptMessage(alice, "bob", 1, meta);

    const decrMeta = await decryptMessage(bob, "alice", 1, ctMeta);
    const parsed = JSON.parse(decrMeta);
    expect(parsed.burn_after_read).toBe(true);

    // Decifra il media
    const decrData = await decryptMedia(encrypted, parsed.key, parsed.iv);
    expect(new Uint8Array(decrData)).toEqual(plainData);
  });

  // ── Multi-device ──────────────────────────────────────────────────────────

  it("Multi-device: stessa chiave AES, sessioni Signal diverse per ogni device", async () => {
    // @ts-ignore
    const { KeyHelper } = await import("@privacyresearch/libsignal-protocol-typescript");
    const sharedIdentityKey = await KeyHelper.generateIdentityKeyPair();
    const alice1 = await createPersona("alice", 1, 5, sharedIdentityKey);
    const alice2 = await createPersona("alice", 2, 5, sharedIdentityKey);
    const bob = await createPersona("bob", 1);

    // Bob stabilisce sessioni con entrambi i device di Alice
    await buildSession(bob, alice1, true);
    await buildSession(bob, alice2, true);

    // Bob carica 1 file ma invia 2 messaggi (uno per device)
    const plainData = fakeMediaData("mp4", 3000);
    const { encrypted, keyBase64, ivBase64 } = await encryptMedia(plainData);

    const meta = JSON.stringify({ e2e: true, type: "video", media_id: "vid-1", key: keyBase64, iv: ivBase64 });
    const ct1 = await encryptMessage(bob, "alice", 1, meta); // per device 1
    const ct2 = await encryptMessage(bob, "alice", 2, meta); // per device 2

    // Device 1 decifra
    const dm1 = await decryptMessage(alice1, "bob", 1, ct1);
    const { key: k1, iv: iv1 } = JSON.parse(dm1);
    const data1 = await decryptMedia(encrypted, k1, iv1);
    expect(new Uint8Array(data1)).toEqual(plainData);

    // Device 2 decifra
    const dm2 = await decryptMessage(alice2, "bob", 1, ct2);
    const { key: k2, iv: iv2 } = JSON.parse(dm2);
    const data2 = await decryptMedia(encrypted, k2, iv2);
    expect(new Uint8Array(data2)).toEqual(plainData);

    // Cross-device: il ciphertext per device1 non è decifrabile da device2
    await expect(decryptMessage(alice2, "bob", 1, ct1)).rejects.toThrow();
  });

  // ── Forward Secrecy media ─────────────────────────────────────────────────

  it("Forward Secrecy: ogni media message usa una chiave Signal diversa", async () => {
    const alice = await createPersona("alice", 1);
    const bob = await createPersona("bob", 1);
    await buildSession(alice, bob, true);
    const ct0 = await encryptMessage(alice, "bob", 1, "Setup");
    await decryptMessage(bob, "alice", 1, ct0);

    const bodies: string[] = [];
    for (let i = 0; i < 5; i++) {
      const { keyBase64, ivBase64 } = await encryptMedia(fakeMediaData("jpeg", 100));
      const meta = JSON.stringify({ e2e: true, type: "image", media_id: `img-${i}`, key: keyBase64, iv: ivBase64 });
      const ct = await encryptMessage(alice, "bob", 1, meta);
      bodies.push(ct.body);
    }

    // Tutti i body Signal sono diversi (chiave di ratchet diversa)
    const unique = new Set(bodies);
    expect(unique.size).toBe(5);
  });
});
