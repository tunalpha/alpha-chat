import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword, needsRehash } from "../password.service";

describe("password.service", () => {
  describe("hashPassword", () => {
    it("genera un hash non vuoto", async () => {
      const hash = await hashPassword("S3cur3P@ss!");
      expect(hash).toBeTruthy();
      expect(hash.length).toBeGreaterThan(20);
    });

    it("hash diversi per la stessa password (salt randomico)", async () => {
      const hash1 = await hashPassword("stessa_password");
      const hash2 = await hashPassword("stessa_password");
      expect(hash1).not.toBe(hash2);
    });

    it("non restituisce la password in chiaro", async () => {
      const plain = "S3cur3P@ss!";
      const hash = await hashPassword(plain);
      expect(hash).not.toContain(plain);
    });

    it("include il marker argon2id nell'hash", async () => {
      const hash = await hashPassword("test");
      expect(hash).toMatch(/^\$argon2id\$/);
    });
  });

  describe("verifyPassword", () => {
    it("restituisce true per la password corretta", async () => {
      const plain = "S3cur3P@ss!";
      const hash = await hashPassword(plain);
      const result = await verifyPassword(hash, plain);
      expect(result).toBe(true);
    });

    it("restituisce false per la password errata", async () => {
      const hash = await hashPassword("password_originale");
      const result = await verifyPassword(hash, "password_sbagliata");
      expect(result).toBe(false);
    });

    it("restituisce false per stringa vuota", async () => {
      const hash = await hashPassword("qualcosa");
      const result = await verifyPassword(hash, "");
      expect(result).toBe(false);
    });

    it("restituisce false per hash malformato (no eccezione)", async () => {
      const result = await verifyPassword("hash_non_valido", "qualsiasi");
      expect(result).toBe(false);
    });

    it("case-sensitive — maiuscole contano", async () => {
      const hash = await hashPassword("Password");
      expect(await verifyPassword(hash, "password")).toBe(false);
      expect(await verifyPassword(hash, "Password")).toBe(true);
    });
  });

  describe("needsRehash", () => {
    it("restituisce false per un hash appena generato", async () => {
      const hash = await hashPassword("test");
      expect(needsRehash(hash)).toBe(false);
    });
  });
});
