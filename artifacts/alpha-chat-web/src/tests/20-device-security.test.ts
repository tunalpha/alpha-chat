/**
 * Sprint 17 — Device Security
 * Test suite: PIN store, biometric helpers, lock settings
 *
 * Eseguiti con Vitest nel browser (jsdom + WebCrypto polyfill via @peculiar/webcrypto).
 * Per lanciare: pnpm --filter @workspace/alpha-chat-web test
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// ─── PIN Store ────────────────────────────────────────────────────────────────
// Importa dopo aver configurato il mock di localStorage
import { hasPIN, savePIN, verifyPIN, removePIN } from "../lib/security/pin-store";

// ─── Lock Settings ────────────────────────────────────────────────────────────
import {
  loadLockSettings,
  saveLockSettings,
  DEFAULT_LOCK_SETTINGS,
  TIMEOUT_OPTIONS,
  type LockSettings,
} from "../lib/security/lock-settings";

// ─── Biometric (interface only — nessun hardware reale nei test) ──────────────
import {
  isBiometricSupported,
  hasBiometricRegistered,
  removeBiometric,
} from "../lib/security/biometric";

// ─────────────────────────────────────────────────────────────────────────────

const USER_A = "user-test-alice";
const USER_B = "user-test-bob";

// localStorage mock — reale jsdom localStorage è disponibile ma resettiamo fra i test
beforeEach(() => {
  localStorage.clear();
});

// ── 20.1  hasPIN returns false when no PIN is set ────────────────────────────
describe("20.1 PIN store — hasPIN", () => {
  it("returns false for a fresh user", () => {
    expect(hasPIN(USER_A)).toBe(false);
  });

  it("returns true after savePIN", async () => {
    await savePIN(USER_A, "123456");
    expect(hasPIN(USER_A)).toBe(true);
  });

  it("is per-user: userB not affected by userA PIN", async () => {
    await savePIN(USER_A, "123456");
    expect(hasPIN(USER_B)).toBe(false);
  });
});

// ── 20.2  savePIN + verifyPIN ────────────────────────────────────────────────
describe("20.2 PIN store — verifyPIN", () => {
  it("verifies correct PIN", async () => {
    await savePIN(USER_A, "654321");
    expect(await verifyPIN(USER_A, "654321")).toBe(true);
  });

  it("rejects wrong PIN", async () => {
    await savePIN(USER_A, "654321");
    expect(await verifyPIN(USER_A, "111111")).toBe(false);
  });

  it("is case-irrelevant (numeric only)", async () => {
    await savePIN(USER_A, "000000");
    expect(await verifyPIN(USER_A, "000000")).toBe(true);
  });

  it("different users with same PIN have different hashes", async () => {
    await savePIN(USER_A, "123456");
    await savePIN(USER_B, "123456");
    const hashA = localStorage.getItem(`alpha-chat-pin-hash:${USER_A}`);
    const hashB = localStorage.getItem(`alpha-chat-pin-hash:${USER_B}`);
    expect(hashA).not.toBeNull();
    expect(hashB).not.toBeNull();
    expect(hashA).not.toBe(hashB);
  });

  it("returns false when no PIN is set", async () => {
    expect(await verifyPIN(USER_A, "123456")).toBe(false);
  });
});

// ── 20.3  removePIN ──────────────────────────────────────────────────────────
describe("20.3 PIN store — removePIN", () => {
  it("removes PIN and hasPIN returns false", async () => {
    await savePIN(USER_A, "123456");
    removePIN(USER_A);
    expect(hasPIN(USER_A)).toBe(false);
  });

  it("verifyPIN returns false after removal", async () => {
    await savePIN(USER_A, "123456");
    removePIN(USER_A);
    expect(await verifyPIN(USER_A, "123456")).toBe(false);
  });

  it("only removes the target user PIN", async () => {
    await savePIN(USER_A, "123456");
    await savePIN(USER_B, "654321");
    removePIN(USER_A);
    expect(hasPIN(USER_A)).toBe(false);
    expect(hasPIN(USER_B)).toBe(true);
  });
});

// ── 20.4  Hash determinism ───────────────────────────────────────────────────
describe("20.4 PIN store — hash determinism", () => {
  it("same PIN produces identical hash on repeated calls", async () => {
    await savePIN(USER_A, "999999");
    const hash1 = localStorage.getItem(`alpha-chat-pin-hash:${USER_A}`);
    // Salva di nuovo lo stesso PIN
    await savePIN(USER_A, "999999");
    const hash2 = localStorage.getItem(`alpha-chat-pin-hash:${USER_A}`);
    expect(hash1).toBe(hash2);
  });

  it("hash is 64 hex chars (SHA-256)", async () => {
    await savePIN(USER_A, "123456");
    const hash = localStorage.getItem(`alpha-chat-pin-hash:${USER_A}`);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

// ── 20.5  Lock Settings — defaults ──────────────────────────────────────────
describe("20.5 Lock Settings — defaults", () => {
  it("returns DEFAULT_LOCK_SETTINGS for a new user", () => {
    const s = loadLockSettings(USER_A);
    expect(s).toEqual(DEFAULT_LOCK_SETTINGS);
  });

  it("default autoLockMs is 5 minutes", () => {
    expect(DEFAULT_LOCK_SETTINGS.autoLockMs).toBe(5 * 60 * 1000);
  });

  it("privacyScreen is enabled by default", () => {
    expect(DEFAULT_LOCK_SETTINGS.privacyScreen).toBe(true);
  });

  it("biometricEnabled is false by default", () => {
    expect(DEFAULT_LOCK_SETTINGS.biometricEnabled).toBe(false);
  });

  it("panicEnabled is false by default", () => {
    expect(DEFAULT_LOCK_SETTINGS.panicEnabled).toBe(false);
  });
});

// ── 20.6  Lock Settings — persist and load ──────────────────────────────────
describe("20.6 Lock Settings — persist/load", () => {
  it("saves and reloads settings correctly", () => {
    const custom: LockSettings = {
      autoLockMs: 60_000,
      privacyScreen: false,
      biometricEnabled: true,
      panicEnabled: true,
    };
    saveLockSettings(USER_A, custom);
    expect(loadLockSettings(USER_A)).toEqual(custom);
  });

  it("is per-user", () => {
    saveLockSettings(USER_A, { ...DEFAULT_LOCK_SETTINGS, autoLockMs: 60_000 });
    expect(loadLockSettings(USER_B).autoLockMs).toBe(DEFAULT_LOCK_SETTINGS.autoLockMs);
  });

  it("partial corrupt localStorage falls back to defaults", () => {
    localStorage.setItem(`alpha-chat-security:${USER_A}`, "INVALID_JSON{{{");
    const s = loadLockSettings(USER_A);
    expect(s).toEqual(DEFAULT_LOCK_SETTINGS);
  });

  it("partial object is merged with defaults", () => {
    localStorage.setItem(
      `alpha-chat-security:${USER_A}`,
      JSON.stringify({ autoLockMs: 30_000 })
    );
    const s = loadLockSettings(USER_A);
    expect(s.autoLockMs).toBe(30_000);
    expect(s.privacyScreen).toBe(DEFAULT_LOCK_SETTINGS.privacyScreen);
  });
});

// ── 20.7  TIMEOUT_OPTIONS structure ─────────────────────────────────────────
describe("20.7 TIMEOUT_OPTIONS", () => {
  it("includes at least 5 options", () => {
    expect(TIMEOUT_OPTIONS.length).toBeGreaterThanOrEqual(5);
  });

  it("has a 'Mai' option with ms -1", () => {
    const never = TIMEOUT_OPTIONS.find((o) => o.ms === -1);
    expect(never).toBeDefined();
    expect(never?.label).toBe("Mai");
  });

  it("has a '5 minuti' option", () => {
    const five = TIMEOUT_OPTIONS.find((o) => o.ms === 5 * 60_000);
    expect(five).toBeDefined();
    expect(five?.label).toBe("5 minuti");
  });

  it("each option has label and ms", () => {
    for (const opt of TIMEOUT_OPTIONS) {
      expect(typeof opt.label).toBe("string");
      expect(typeof opt.ms).toBe("number");
    }
  });
});

// ── 20.8  Biometric helpers (no hardware) ───────────────────────────────────
describe("20.8 Biometric helpers", () => {
  it("isBiometricSupported returns boolean", () => {
    expect(typeof isBiometricSupported()).toBe("boolean");
  });

  it("hasBiometricRegistered returns false for fresh user", () => {
    expect(hasBiometricRegistered(USER_A)).toBe(false);
  });

  it("removeBiometric is a no-op when nothing registered", () => {
    expect(() => removeBiometric(USER_A)).not.toThrow();
  });

  it("hasBiometricRegistered is per-user", () => {
    // Simula manualmente la registrazione di un credential ID
    localStorage.setItem(`alpha-chat-webauthn-cred:${USER_A}`, "dGVzdA==");
    expect(hasBiometricRegistered(USER_A)).toBe(true);
    expect(hasBiometricRegistered(USER_B)).toBe(false);
  });

  it("removeBiometric clears registered credential", () => {
    localStorage.setItem(`alpha-chat-webauthn-cred:${USER_A}`, "dGVzdA==");
    removeBiometric(USER_A);
    expect(hasBiometricRegistered(USER_A)).toBe(false);
  });
});
