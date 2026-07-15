import { describe, it, expect } from "vitest";
import { signAccessToken, verifyAccessToken } from "../jwt.service";

// Nota: in test, JWT_PRIVATE_KEY e JWT_PUBLIC_KEY non sono settati.
// Il service genera chiavi effimere in development/test — questo è corretto.

describe("jwt.service", () => {
  describe("signAccessToken", () => {
    it("genera un token JWT valido", async () => {
      const { token, jti, expiresAt } = await signAccessToken({
        userId: "507f1f77bcf86cd799439011",
        deviceId: "550e8400-e29b-41d4-a716-446655440000",
        roles: [],
      });

      expect(token).toBeTruthy();
      expect(token.split(".")).toHaveLength(3); // header.payload.signature
      expect(jti).toBeTruthy();
      expect(expiresAt).toBeInstanceOf(Date);
      expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
    });

    it("il token scade tra ~15 minuti", async () => {
      const { expiresAt } = await signAccessToken({
        userId: "507f1f77bcf86cd799439011",
        deviceId: "device-1",
      });

      const diffMinutes = (expiresAt.getTime() - Date.now()) / 1000 / 60;
      expect(diffMinutes).toBeGreaterThan(14);
      expect(diffMinutes).toBeLessThanOrEqual(15.1);
    });

    it("jti univoci per token diversi", async () => {
      const params = { userId: "id1", deviceId: "dev1" };
      const a = await signAccessToken(params);
      const b = await signAccessToken(params);
      expect(a.jti).not.toBe(b.jti);
      expect(a.token).not.toBe(b.token);
    });
  });

  describe("verifyAccessToken", () => {
    it("verifica un token valido e restituisce il payload", async () => {
      const userId = "507f1f77bcf86cd799439011";
      const deviceId = "550e8400-e29b-41d4-a716-446655440000";
      const roles = ["user"];

      const { token, jti } = await signAccessToken({ userId, deviceId, roles });
      const payload = await verifyAccessToken(token);

      expect(payload.sub).toBe(userId);
      expect(payload.jti).toBe(jti);
      expect(payload.device_id).toBe(deviceId);
      expect(payload.roles).toEqual(roles);
    });

    it("lancia eccezione per token malformato", async () => {
      await expect(verifyAccessToken("non.un.token")).rejects.toThrow();
    });

    it("lancia eccezione per token firmato con chiave diversa", async () => {
      // Il primo call genera chiavi effimere; simuliamo un token manipolato
      const { token } = await signAccessToken({ userId: "x", deviceId: "y" });
      const parts = token.split(".");
      // Modifica la signature
      const tampered = parts[0] + "." + parts[1] + ".invalidsignature";
      await expect(verifyAccessToken(tampered)).rejects.toThrow();
    });
  });
});
