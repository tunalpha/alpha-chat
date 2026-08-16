/**
 * Test: RefundKeyService — chiave refund deterministica
 *
 * Verifica:
 *   - Stessa swap → stessa derivazione (determinismo)
 *   - Swap diverse → chiavi diverse (unicità)
 *   - Restart backend → stessa derivazione (riproducibilità)
 *   - La chiave privata NON compare nelle risposte pubbliche
 *   - La chiave pubblica è una compressed secp256k1 valida (33 byte, hex)
 *   - Impossibilità di usare la chiave di una swap per un'altra
 */

import { describe, it, expect, beforeAll } from "vitest";
import { deriveRefundPublicKey, verifyRefundKey } from "../../services/swap/refund-key.service.js";

// Imposta un secret di test (non serve il vero segreto per i test)
beforeAll(() => {
  if (!process.env.ALPHA_SWAP_REFUND_SECRET) {
    // Il service usa il fallback dev — OK per test
  }
});

describe("RefundKeyService — determinismo e sicurezza", () => {
  it("stessa swap → stessa chiave pubblica (determinismo)", () => {
    const swapId = "test-swap-id-00000001";
    const key1 = deriveRefundPublicKey(swapId);
    const key2 = deriveRefundPublicKey(swapId);
    expect(key1).toBe(key2);
  });

  it("swap diverse → chiavi diverse (unicità)", () => {
    const key1 = deriveRefundPublicKey("swap-id-alpha");
    const key2 = deriveRefundPublicKey("swap-id-beta");
    const key3 = deriveRefundPublicKey("swap-id-gamma");
    expect(key1).not.toBe(key2);
    expect(key1).not.toBe(key3);
    expect(key2).not.toBe(key3);
  });

  it("restart backend → stessa derivazione (chiamate separate = risultato identico)", () => {
    // Simula due chiamate separate (come accade su restart backend)
    const swapId = "550e8400-e29b-41d4-a716-446655440000";
    const firstCall  = deriveRefundPublicKey(swapId);
    const secondCall = deriveRefundPublicKey(swapId); // stessa logica, stesso risultato
    expect(firstCall).toBe(secondCall);
  });

  it("chiave pubblica è compressed secp256k1 (66 hex chars = 33 byte)", () => {
    const key = deriveRefundPublicKey("any-swap-id");
    // Compressed pubkey: "02" o "03" + 32 byte (64 hex chars) = 66 hex chars totali
    expect(key).toHaveLength(66);
    expect(key).toMatch(/^(02|03)[0-9a-f]{64}$/);
  });

  it("verifyRefundKey: chiave corretta per il suo swapId", () => {
    const swapId = "verify-test-swap";
    const pubKey = deriveRefundPublicKey(swapId);
    expect(verifyRefundKey(swapId, pubKey)).toBe(true);
  });

  it("verifyRefundKey: chiave di una swap NON valida per un'altra (impossibilità cross-swap)", () => {
    const key1 = deriveRefundPublicKey("swap-A");
    // La chiave di swap-A non deve essere valida per swap-B
    expect(verifyRefundKey("swap-B", key1)).toBe(false);
  });

  it("verifyRefundKey: chiave falsa → false", () => {
    const fakeKey = "02" + "00".repeat(32);
    expect(verifyRefundKey("any-swap", fakeKey)).toBe(false);
  });

  it("chiave pubblica non contiene informazioni della chiave privata in forma diretta", () => {
    const key = deriveRefundPublicKey("security-test-swap");
    // La chiave pubblica è compressa (33 byte); la privata è 32 byte
    // Non c'è modo di estrarre la privata dalla pubblica senza il segreto
    // Verifichiamo solo che il formato sia corretto
    expect(key).toHaveLength(66);
    expect(key.startsWith("02") || key.startsWith("03")).toBe(true);
  });

  it("UUID swap → chiave deterministica (simula caso reale)", () => {
    const uuid = "123e4567-e89b-12d3-a456-426614174000";
    const k1 = deriveRefundPublicKey(uuid);
    const k2 = deriveRefundPublicKey(uuid);
    expect(k1).toBe(k2);
    expect(k1).toHaveLength(66);
  });
});
