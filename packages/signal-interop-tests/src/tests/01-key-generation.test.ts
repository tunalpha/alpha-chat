/**
 * Test 01 — Generazione chiavi Signal Protocol
 *
 * Verifica che le chiavi generate siano conformi alla Signal spec:
 * - Identity Key (Curve25519): pubKey 33 byte (prefisso 0x05), privKey 32 byte
 * - Signed PreKey (Curve25519 DH): keyPair 33/32 byte, signature XEdDSA 64 byte
 * - One-Time PreKey (Curve25519 DH): stessa struttura Signed PreKey ma senza firma
 */

import { describe, it, expect, beforeAll } from "vitest";
// @ts-ignore
import { KeyHelper } from "@privacyresearch/libsignal-protocol-typescript";
import { initLibsignal } from "../helpers/setup.js";

beforeAll(async () => {
  await initLibsignal();
});

describe("01 — Generazione chiavi", () => {
  it("Identity Key Pair: pubKey 33 byte, privKey 32 byte", async () => {
    const identity = await KeyHelper.generateIdentityKeyPair();

    expect(identity.pubKey).toBeInstanceOf(ArrayBuffer);
    expect(identity.privKey).toBeInstanceOf(ArrayBuffer);
    // Identity key pubKey ha prefisso 0x05 (formato Curve25519 Signal)
    expect(identity.pubKey.byteLength).toBe(33);
    expect(identity.privKey.byteLength).toBe(32);
    // Verifica prefisso 0x05
    const firstByte = new Uint8Array(identity.pubKey)[0];
    expect(firstByte).toBe(0x05);
  });

  it("Identity Key Pair: due generazioni producono chiavi diverse", async () => {
    const a = await KeyHelper.generateIdentityKeyPair();
    const b = await KeyHelper.generateIdentityKeyPair();
    // Con probabilità astronomicamente alta, due chiavi casuali differiscono
    const aBytes = new Uint8Array(a.pubKey);
    const bBytes = new Uint8Array(b.pubKey);
    let allSame = true;
    for (let i = 0; i < aBytes.length; i++) {
      if (aBytes[i] !== bBytes[i]) { allSame = false; break; }
    }
    expect(allSame).toBe(false);
  });

  it("Registration ID: in range 1–16383", () => {
    const ids = Array.from({ length: 100 }, () => KeyHelper.generateRegistrationId());
    for (const id of ids) {
      expect(id).toBeGreaterThanOrEqual(1);
      expect(id).toBeLessThanOrEqual(16383);
      expect(Number.isInteger(id)).toBe(true);
    }
  });

  it("Signed PreKey: keyPair corretto + firma XEdDSA 64 byte", async () => {
    const identity = await KeyHelper.generateIdentityKeyPair();
    const signed = await KeyHelper.generateSignedPreKey(identity, 42);

    expect(signed.keyId).toBe(42);
    expect(signed.keyPair.pubKey).toBeInstanceOf(ArrayBuffer);
    expect(signed.keyPair.privKey).toBeInstanceOf(ArrayBuffer);
    expect(signed.signature).toBeInstanceOf(ArrayBuffer);

    // DH key: 33 byte (con prefisso), privKey 32 byte
    expect(signed.keyPair.pubKey.byteLength).toBe(33);
    expect(signed.keyPair.privKey.byteLength).toBe(32);
    // Firma XEdDSA: 64 byte
    expect(signed.signature.byteLength).toBe(64);
  });

  it("Signed PreKey: keyId 1 e keyId 100 producono firme diverse", async () => {
    const identity = await KeyHelper.generateIdentityKeyPair();
    const s1 = await KeyHelper.generateSignedPreKey(identity, 1);
    const s2 = await KeyHelper.generateSignedPreKey(identity, 100);

    const sig1 = new Uint8Array(s1.signature);
    const sig2 = new Uint8Array(s2.signature);
    let allSame = true;
    for (let i = 0; i < sig1.length; i++) {
      if (sig1[i] !== sig2[i]) { allSame = false; break; }
    }
    expect(allSame).toBe(false);
  });

  it("One-Time PreKey: pubKey 33 byte, privKey 32 byte", async () => {
    const otpk = await KeyHelper.generatePreKey(1);

    expect(otpk.keyId).toBe(1);
    expect(otpk.keyPair.pubKey).toBeInstanceOf(ArrayBuffer);
    expect(otpk.keyPair.privKey).toBeInstanceOf(ArrayBuffer);
    expect(otpk.keyPair.pubKey.byteLength).toBe(33);
    expect(otpk.keyPair.privKey.byteLength).toBe(32);
  });

  it("100 One-Time PreKeys con keyId unici e chiavi distinte", async () => {
    const keys = await Promise.all(
      Array.from({ length: 100 }, (_, i) => KeyHelper.generatePreKey(i + 1))
    );

    // keyId unici
    const ids = new Set(keys.map((k: { keyId: number }) => k.keyId));
    expect(ids.size).toBe(100);

    // Chiavi pubbliche distinte (campione: prime 10)
    const pubKeys = keys.slice(0, 10).map((k: { keyPair: { pubKey: ArrayBuffer } }) =>
      Array.from(new Uint8Array(k.keyPair.pubKey)).join(",")
    );
    const uniquePubKeys = new Set(pubKeys);
    expect(uniquePubKeys.size).toBe(10);
  });
});
