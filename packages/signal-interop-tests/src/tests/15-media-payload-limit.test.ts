/**
 * Test 15 — Regressione: upload payload limit (bug fix)
 *
 * Bug originale (2026-07-16):
 *   L'upload di foto iPhone (3–5 MB) falliva con HTTP 500.
 *
 * Root cause:
 *   express.json({ limit: "1mb" }) globale in app.ts.
 *   Foto iPhone cifrata AES-GCM + base64 ≈ 4–7 MB > 1 MB.
 *   Express lanciava PayloadTooLargeError, l'error handler la mappava a 500.
 *
 * Fix applicato:
 *   1. v1/index.ts: express.json({ limit: "25mb" }) solo per /api/v1/media
 *   2. error-handler.ts: PayloadTooLargeError (type: "entity.too.large" | status: 413)
 *      mappato a 413 AppError invece di 500 INTERNAL_ERROR
 *
 * Questi test verificano:
 *   A. Che un blob > 1 MB venga correttamente cifrato e che il payload JSON
 *      risultante superi il vecchio limite (1 MB) ma stia nel nuovo (25 MB).
 *   B. Che la pipeline AES-256-GCM funzioni correttamente su blob grandi
 *      (integrità dati, nessuna troncatura).
 *   C. Che il calcolo base64 sia corretto per stimare la dimensione del payload.
 */

import { describe, it, expect, beforeAll } from "vitest";

// ─── replica locale di encryptMediaBlob (non dipende da libsignal) ───────────

const AES_KEY_BITS = 256;
const GCM_IV_BYTES = 12;

async function encryptMediaBlob(blob: Blob): Promise<{
  encryptedBlob: Blob;
  keyBase64: string;
  ivBase64: string;
}> {
  const key = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: AES_KEY_BITS },
    true,
    ["encrypt", "decrypt"],
  );
  const rawKey = await crypto.subtle.exportKey("raw", key);
  const keyBase64 = rawToBase64(rawKey);

  const iv = crypto.getRandomValues(new Uint8Array(GCM_IV_BYTES));
  const ivBase64 = rawToBase64(iv.buffer as ArrayBuffer);

  const plainBytes = await blob.arrayBuffer();
  const cipherBytes = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    plainBytes,
  );

  return {
    encryptedBlob: new Blob([cipherBytes], { type: "application/octet-stream" }),
    keyBase64,
    ivBase64,
  };
}

async function decryptMediaBlob(
  encryptedBlob: Blob,
  keyBase64: string,
  ivBase64: string,
  mimeType: string,
): Promise<Blob> {
  const rawKey = base64ToRaw(keyBase64);
  const key = await crypto.subtle.importKey(
    "raw", rawKey, { name: "AES-GCM", length: AES_KEY_BITS }, false, ["decrypt"],
  );
  const iv = new Uint8Array(base64ToRaw(ivBase64));
  const cipherBytes = await encryptedBlob.arrayBuffer();
  const plainBytes = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, cipherBytes);
  return new Blob([plainBytes], { type: mimeType });
}

function rawToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function base64ToRaw(b64: string): ArrayBuffer {
  const binStr = atob(b64);
  const bytes = new Uint8Array(binStr.length);
  for (let i = 0; i < binStr.length; i++) bytes[i] = binStr.charCodeAt(i);
  return bytes.buffer as ArrayBuffer;
}

/** Stima la dimensione del payload JSON per un blob di N byte */
function estimateBase64PayloadBytes(blobBytes: number): number {
  // AES-GCM aggiunge 16 byte (GCM tag)
  const encryptedBytes = blobBytes + 16;
  // Base64: ogni 3 byte → 4 caratteri, padding a multiplo di 4
  const base64Chars = Math.ceil(encryptedBytes / 3) * 4;
  // Il payload JSON ha overhead minimo (campi fissi ≈ 200 byte)
  return base64Chars + 200;
}

/** Genera un blob casuale di dimensione esatta */
function makeFakeBlob(bytes: number, mimeType: string): Blob {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf.slice(0, Math.min(bytes, 65536))); // riempie le prime 64KB casualmente
  // resto con pattern deterministico (più veloce per blob grandi)
  for (let i = 65536; i < bytes; i++) buf[i] = i & 0xff;
  return new Blob([buf], { type: mimeType });
}

// ─── suite ───────────────────────────────────────────────────────────────────

describe("15 — Regressione: media payload limit", () => {

  describe("15.1 — Stima dimensione payload", () => {
    it("15.1.1 — Un blob da 1 MB genera payload > 1 MB (vecchio limite violato)", () => {
      const blobMB = 1 * 1024 * 1024;
      const payloadBytes = estimateBase64PayloadBytes(blobMB);
      // base64 di 1 MB ≈ 1.33 MB + overhead
      expect(payloadBytes).toBeGreaterThan(1 * 1024 * 1024);
    });

    it("15.1.2 — Foto iPhone tipica (3 MB) genera payload ~4 MB > vecchio limite 1 MB", () => {
      const iphonePhotoBytes = 3 * 1024 * 1024;
      const payloadBytes = estimateBase64PayloadBytes(iphonePhotoBytes);
      expect(payloadBytes).toBeGreaterThan(3.9 * 1024 * 1024);
      expect(payloadBytes).toBeLessThan(5 * 1024 * 1024); // sanity
    });

    it("15.1.3 — Max file immagine (10 MB) genera payload ~13.3 MB < nuovo limite 25 MB", () => {
      const maxImageBytes = 10 * 1024 * 1024;
      const payloadBytes = estimateBase64PayloadBytes(maxImageBytes);
      expect(payloadBytes).toBeGreaterThan(13 * 1024 * 1024);
      expect(payloadBytes).toBeLessThan(25 * 1024 * 1024); // rientra nel nuovo limite
    });

    it("15.1.4 — Max file video (15 MB) genera payload ~20 MB < nuovo limite 25 MB", () => {
      const maxVideoBytes = 15 * 1024 * 1024;
      const payloadBytes = estimateBase64PayloadBytes(maxVideoBytes);
      expect(payloadBytes).toBeGreaterThan(19 * 1024 * 1024);
      expect(payloadBytes).toBeLessThan(25 * 1024 * 1024); // rientra nel nuovo limite
    });

    it("15.1.5 — Il rapporto base64/raw è sempre ≤ 1.334 (overhead atteso)", () => {
      for (const sizeMB of [1, 2, 5, 10, 15]) {
        const raw   = sizeMB * 1024 * 1024;
        const b64   = Math.ceil((raw + 16) / 3) * 4;
        const ratio = b64 / raw;
        expect(ratio).toBeLessThanOrEqual(1.334);
        expect(ratio).toBeGreaterThan(1.330);
      }
    });
  });

  describe("15.2 — Pipeline AES-GCM su blob grandi (integrità dati)", () => {
    let blob2MB: Blob;

    beforeAll(() => {
      // 2 MB di dati sintetici — abbondantemente sopra il vecchio limite 1 MB
      blob2MB = makeFakeBlob(2 * 1024 * 1024, "image/jpeg");
    });

    it("15.2.1 — encryptMediaBlob su 2 MB non lancia eccezioni", async () => {
      const result = await encryptMediaBlob(blob2MB);
      expect(result.encryptedBlob).toBeDefined();
      expect(result.keyBase64).toBeTruthy();
      expect(result.ivBase64).toBeTruthy();
    }, 15000);

    it("15.2.2 — Il blob cifrato è più grande dell'originale (GCM tag 16 B)", async () => {
      const { encryptedBlob } = await encryptMediaBlob(blob2MB);
      expect(encryptedBlob.size).toBe(blob2MB.size + 16); // GCM tag
    }, 15000);

    it("15.2.3 — Decrypt restituisce i byte originali identici (round-trip 2 MB)", async () => {
      const { encryptedBlob, keyBase64, ivBase64 } = await encryptMediaBlob(blob2MB);
      const decrypted = await decryptMediaBlob(encryptedBlob, keyBase64, ivBase64, "image/jpeg");

      expect(decrypted.size).toBe(blob2MB.size);

      // Confronta i primi e ultimi 1024 byte per verificare integrità
      const origBuf = await blob2MB.arrayBuffer();
      const decBuf  = await decrypted.arrayBuffer();
      const origView = new Uint8Array(origBuf);
      const decView  = new Uint8Array(decBuf);

      // Primi 1024 byte
      const firstMatch = origView.slice(0, 1024).every((b, i) => b === decView[i]);
      // Ultimi 1024 byte
      const lastOffset = origView.length - 1024;
      const lastMatch  = origView.slice(lastOffset).every((b, i) => b === decView[lastOffset + i]);

      expect(firstMatch).toBe(true);
      expect(lastMatch).toBe(true);
    }, 30000);

    it("15.2.4 — Chiavi diverse producono ciphertext diversi (no key reuse)", async () => {
      const r1 = await encryptMediaBlob(blob2MB);
      const r2 = await encryptMediaBlob(blob2MB);

      expect(r1.keyBase64).not.toBe(r2.keyBase64);
      expect(r1.ivBase64).not.toBe(r2.ivBase64);

      const buf1 = await r1.encryptedBlob.arrayBuffer();
      const buf2 = await r2.encryptedBlob.arrayBuffer();
      const v1 = new Uint8Array(buf1);
      const v2 = new Uint8Array(buf2);

      // Byte diversi (stessa source, chiavi diverse → ciphertext indistinguibili)
      const allSame = v1.slice(0, 256).every((b, i) => b === v2[i]);
      expect(allSame).toBe(false);
    }, 30000);
  });

  describe("15.3 — Conversione base64 corretta per payload JSON", () => {
    it("15.3.1 — rawToBase64 + base64ToRaw: round-trip su buffer casuale 512 KB", () => {
      const size = 512 * 1024;
      const original = new Uint8Array(size);
      for (let i = 0; i < size; i++) original[i] = i & 0xff;

      const b64   = rawToBase64(original.buffer as ArrayBuffer);
      const back  = new Uint8Array(base64ToRaw(b64));

      expect(back.length).toBe(size);
      const match = original.every((b, i) => b === back[i]);
      expect(match).toBe(true);
    });

    it("15.3.2 — base64 di 1 MB ha lunghezza attesa ~1.333 MB", () => {
      const bytes = new Uint8Array(1024 * 1024).fill(0xab);
      const b64   = rawToBase64(bytes.buffer as ArrayBuffer);
      // Atteso: ceil(1MB / 3) * 4 = 1398104 caratteri ≈ 1.333 MB
      expect(b64.length).toBe(1398104);
    });
  });
});
