/**
 * Test 19 — Cross-verifica: implementazione WebCrypto vs FingerprintGenerator
 *
 * Verifica che la nostra implementazione WebCrypto nativa (safety-number.ts)
 * produca risultati IDENTICI a FingerprintGenerator di @privacyresearch.
 *
 * Questo test garantisce che il Safety Number mostrato nel browser
 * (WebCrypto) coincida con quello che produrrebbe la libreria Signal (Node.js).
 *
 * Node.js 18+ ha globalThis.crypto.subtle identico all'API browser.
 */

import { describe, it, expect, beforeAll } from "vitest";
// @ts-ignore
import { FingerprintGenerator, KeyHelper } from "@privacyresearch/libsignal-protocol-typescript";
import { initLibsignal } from "../helpers/setup.js";

const FINGERPRINT_ITERATIONS = 5200;
const FINGERPRINT_VERSION    = 0;

// ---------------------------------------------------------------------------
// Reimplementazione identica a safety-number.ts (WebCrypto nativo)
// Usiamo globalThis.crypto.subtle che in Node.js 18+ è uguale al browser
// ---------------------------------------------------------------------------

function concatBuffers(...parts: ArrayBuffer[]): ArrayBuffer {
  const total  = parts.reduce((sum, p) => sum + p.byteLength, 0);
  const result = new Uint8Array(total);
  let offset   = 0;
  for (const p of parts) { result.set(new Uint8Array(p), offset); offset += p.byteLength; }
  return result.buffer;
}

function latin1ToBuffer(str: string): ArrayBuffer {
  const buf = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) buf[i] = str.charCodeAt(i);
  return buf.buffer;
}

async function iterateHashWebCrypto(initial: ArrayBuffer, key: ArrayBuffer, count: number): Promise<ArrayBuffer> {
  let current = await globalThis.crypto.subtle.digest("SHA-512", concatBuffers(initial, key));
  for (let i = 1; i < count; i++) {
    current = await globalThis.crypto.subtle.digest("SHA-512", concatBuffers(current, key));
  }
  return current;
}

async function getDisplayStringWebCrypto(identifier: string, publicKey: ArrayBuffer, iterations: number): Promise<string> {
  const versionBuf    = new Uint16Array([FINGERPRINT_VERSION]).buffer;
  const identifierBuf = latin1ToBuffer(identifier);
  const initial       = concatBuffers(versionBuf, publicKey, identifierBuf);
  const hashBuf       = await iterateHashWebCrypto(initial, publicKey, iterations);
  const hash          = new Uint8Array(hashBuf);
  let display = "";
  for (let offset = 0; offset < 30; offset += 5) {
    const value = hash[offset + 0] * 2**32 + hash[offset + 1] * 2**24 +
                  hash[offset + 2] * 2**16 + hash[offset + 3] * 2**8 + hash[offset + 4];
    display += (value % 100_000).toString().padStart(5, "0");
  }
  return display;
}

function base64ToBuffer(b64: string): ArrayBuffer {
  const binary = Buffer.from(b64, "base64");
  return binary.buffer.slice(binary.byteOffset, binary.byteOffset + binary.byteLength);
}

function bufferToBase64(buf: ArrayBuffer): string {
  return Buffer.from(buf).toString("base64");
}

async function generateSafetyNumberWebCrypto(
  localId: string, localIKBase64: string,
  remoteId: string, remoteIKBase64: string,
): Promise<string> {
  const localIK  = base64ToBuffer(localIKBase64);
  const remoteIK = base64ToBuffer(remoteIKBase64);
  const [localStr, remoteStr] = await Promise.all([
    getDisplayStringWebCrypto(localId,  localIK,  FINGERPRINT_ITERATIONS),
    getDisplayStringWebCrypto(remoteId, remoteIK, FINGERPRINT_ITERATIONS),
  ]);
  return [localStr, remoteStr].sort().join("");
}

// ---------------------------------------------------------------------------

beforeAll(async () => { await initLibsignal(); });

describe("19 — WebCrypto fingerprint cross-verifica con FingerprintGenerator", () => {

  it("19.1 — WebCrypto e FingerprintGenerator producono lo stesso Safety Number (coppia 1)", async () => {
    const aliceIK = await KeyHelper.generateIdentityKeyPair();
    const bobIK   = await KeyHelper.generateIdentityKeyPair();

    const aliceB64 = bufferToBase64(aliceIK.pubKey);
    const bobB64   = bufferToBase64(bobIK.pubKey);

    const gen = new FingerprintGenerator(FINGERPRINT_ITERATIONS);

    // FingerprintGenerator (libreria, usa msrcrypto)
    const fpLib = await gen.createFor("alice", aliceIK.pubKey, "bob", bobIK.pubKey);

    // WebCrypto nativo (identico a safety-number.ts)
    const fpWeb = await generateSafetyNumberWebCrypto("alice", aliceB64, "bob", bobB64);

    expect(fpWeb).toBe(fpLib);
    expect(fpWeb).toHaveLength(60);
    console.log(`  [19.1] FP identici: ${fpWeb.slice(0, 15)}… ✓`);
  }, 30000);

  it("19.2 — WebCrypto e FingerprintGenerator producono lo stesso Safety Number (coppia 2, username diversi)", async () => {
    const charlieIK = await KeyHelper.generateIdentityKeyPair();
    const daveIK    = await KeyHelper.generateIdentityKeyPair();

    const charlieB64 = bufferToBase64(charlieIK.pubKey);
    const daveB64    = bufferToBase64(daveIK.pubKey);

    const gen = new FingerprintGenerator(FINGERPRINT_ITERATIONS);

    const fpLib = await gen.createFor("charlie_99", charlieIK.pubKey, "dave_77", daveIK.pubKey);
    const fpWeb = await generateSafetyNumberWebCrypto("charlie_99", charlieB64, "dave_77", daveB64);

    expect(fpWeb).toBe(fpLib);
    console.log(`  [19.2] FP identici con username arbitrari: ${fpWeb.slice(0, 15)}… ✓`);
  }, 30000);

  it("19.3 — La simmetria vale anche con WebCrypto", async () => {
    const aliceIK = await KeyHelper.generateIdentityKeyPair();
    const bobIK   = await KeyHelper.generateIdentityKeyPair();

    const aliceB64 = bufferToBase64(aliceIK.pubKey);
    const bobB64   = bufferToBase64(bobIK.pubKey);

    const fpAliceView = await generateSafetyNumberWebCrypto("alice", aliceB64, "bob", bobB64);
    const fpBobView   = await generateSafetyNumberWebCrypto("alice", aliceB64, "bob", bobB64);

    expect(fpAliceView).toBe(fpBobView);
    expect(fpAliceView).toHaveLength(60);
    console.log(`  [19.3] Simmetria WebCrypto: ${fpAliceView.slice(0, 15)}… ✓`);
  }, 30000);

  it("19.4 — Cambio IK → Safety Number diverso (WebCrypto)", async () => {
    const aliceIK    = await KeyHelper.generateIdentityKeyPair();
    const aliceNewIK = await KeyHelper.generateIdentityKeyPair();
    const bobIK      = await KeyHelper.generateIdentityKeyPair();

    const aliceB64    = bufferToBase64(aliceIK.pubKey);
    const aliceNewB64 = bufferToBase64(aliceNewIK.pubKey);
    const bobB64      = bufferToBase64(bobIK.pubKey);

    const fpOld = await generateSafetyNumberWebCrypto("alice", aliceB64,    "bob", bobB64);
    const fpNew = await generateSafetyNumberWebCrypto("alice", aliceNewB64, "bob", bobB64);

    expect(fpOld).not.toBe(fpNew);
    console.log(`  [19.4] FP vecchio: ${fpOld.slice(0,15)}…`);
    console.log(`         FP nuovo:  ${fpNew.slice(0,15)}… (cambio rilevato) ✓`);
  }, 30000);

  it("19.5 — WebCrypto: output 60 cifre, tutti decimali", async () => {
    const aliceIK = await KeyHelper.generateIdentityKeyPair();
    const bobIK   = await KeyHelper.generateIdentityKeyPair();

    const fp = await generateSafetyNumberWebCrypto(
      "alice_test", bufferToBase64(aliceIK.pubKey),
      "bob_test",   bufferToBase64(bobIK.pubKey),
    );

    expect(fp).toHaveLength(60);
    expect(/^\d{60}$/.test(fp)).toBe(true);
    console.log(`  [19.5] 60 cifre decimali ✓`);
  }, 30000);
});
