import { describe, it, expect } from "vitest";
import {
  generateRefreshToken,
  hashRefreshToken,
  refreshTokenExpiresAt,
} from "../refresh-token.service";

// Nota: createSession / rotateRefreshToken / revokeSession richiedono MongoDB.
// Testati nei test di integrazione (Sprint 2+). Qui testiamo solo le funzioni pure.

describe("refresh-token.service — funzioni pure", () => {
  describe("generateRefreshToken", () => {
    it("genera un token con il prefisso rt_", () => {
      const token = generateRefreshToken();
      expect(token).toMatch(/^rt_[0-9a-f]{64}$/);
    });

    it("genera token univoci ad ogni chiamata", () => {
      const tokens = new Set(Array.from({ length: 50 }, () => generateRefreshToken()));
      expect(tokens.size).toBe(50);
    });

    it("lunghezza corretta — rt_ + 64 char hex", () => {
      const token = generateRefreshToken();
      expect(token.length).toBe(3 + 64); // "rt_" + 32 bytes * 2
    });
  });

  describe("hashRefreshToken", () => {
    it("genera un hash SHA-256 in hex (64 caratteri)", () => {
      const hash = hashRefreshToken("rt_sometoken");
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it("hash deterministico — stesso input, stesso output", () => {
      const token = "rt_abc123";
      expect(hashRefreshToken(token)).toBe(hashRefreshToken(token));
    });

    it("hash diversi per token diversi", () => {
      const h1 = hashRefreshToken(generateRefreshToken());
      const h2 = hashRefreshToken(generateRefreshToken());
      expect(h1).not.toBe(h2);
    });

    it("non contiene il token in chiaro", () => {
      const token = "rt_mysecrettoken";
      const hash = hashRefreshToken(token);
      expect(hash).not.toContain(token);
    });
  });

  describe("refreshTokenExpiresAt", () => {
    it("scade nel futuro", () => {
      const exp = refreshTokenExpiresAt();
      expect(exp.getTime()).toBeGreaterThan(Date.now());
    });

    it("scade tra ~30 giorni", () => {
      const exp = refreshTokenExpiresAt();
      const diffDays = (exp.getTime() - Date.now()) / 1000 / 60 / 60 / 24;
      expect(diffDays).toBeGreaterThan(29.9);
      expect(diffDays).toBeLessThanOrEqual(30.1);
    });
  });
});
