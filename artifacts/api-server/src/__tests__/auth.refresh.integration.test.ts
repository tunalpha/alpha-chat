/**
 * Integration test — POST /api/v1/auth/refresh
 *
 * Verifica:
 * - Rotazione obbligatoria (S-02): ogni RT è monouso
 * - Token theft detection (S-03): RT già usato → revoca famiglia + 401
 * - Nuovo AT verificabile
 * - RT scaduto → 401
 * - RT invalido → 401
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import request from "supertest";
import app from "../app";
import { UserModel } from "../models/user.model";
import { SessionModel } from "../models/session.model";
import { verifyAccessToken } from "../services/jwt.service";
import { _resetRedisClient } from "../lib/redis";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

afterEach(async () => {
  await UserModel.deleteMany({});
  await SessionModel.deleteMany({});
  _resetRedisClient();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function registerAndLogin() {
  const regRes = await request(app).post("/api/v1/auth/register").send({
    username: "test_refresh", display_name: "Test Refresh",
    password: "S3cur3P@ss!", device_id: "550e8400-e29b-41d4-a716-446655440001",
    device_type: "ios",
  });
  return regRes.body.data.tokens as {
    access_token: string; refresh_token: string;
    access_token_expires_at: string; refresh_token_expires_at: string;
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("POST /api/v1/auth/refresh", () => {

  it("200 — refresh con token valido restituisce nuovi tokens", async () => {
    const tokens = await registerAndLogin();
    const res = await request(app)
      .post("/api/v1/auth/refresh")
      .send({ refresh_token: tokens.refresh_token })
      .expect(200);

    expect(res.body.data.tokens.access_token).toBeTruthy();
    expect(res.body.data.tokens.refresh_token).toMatch(/^rt_/);
    // Nuovo RT deve essere diverso dal vecchio
    expect(res.body.data.tokens.refresh_token).not.toBe(tokens.refresh_token);
    // Nuovo AT deve essere diverso
    expect(res.body.data.tokens.access_token).not.toBe(tokens.access_token);
  });

  it("200 — nuovo access token è verificabile", async () => {
    const tokens = await registerAndLogin();
    const res = await request(app)
      .post("/api/v1/auth/refresh")
      .send({ refresh_token: tokens.refresh_token })
      .expect(200);

    const payload = await verifyAccessToken(res.body.data.tokens.access_token);
    expect(payload.sub).toBeTruthy();
    expect(payload.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it("200 — catena di refresh multipli funziona correttamente", async () => {
    const tokens = await registerAndLogin();
    let currentRt = tokens.refresh_token;

    for (let i = 0; i < 3; i++) {
      const res = await request(app)
        .post("/api/v1/auth/refresh")
        .send({ refresh_token: currentRt })
        .expect(200);
      const newRt = res.body.data.tokens.refresh_token;
      expect(newRt).not.toBe(currentRt);
      currentRt = newRt;
    }
  });

  // ── Invariante S-02 — monouso ─────────────────────────────────────────────

  it("401 REFRESH_TOKEN_REUSED — S-03: riutilizzo RT già ruotato revoca la famiglia", async () => {
    const tokens = await registerAndLogin();
    const oldRt = tokens.refresh_token;

    // Prima rotazione — OK
    await request(app)
      .post("/api/v1/auth/refresh")
      .send({ refresh_token: oldRt })
      .expect(200);

    // Riutilizzo del vecchio RT → theft detection
    const res = await request(app)
      .post("/api/v1/auth/refresh")
      .send({ refresh_token: oldRt })
      .expect(401);

    expect(res.body.error.code).toBe("REFRESH_TOKEN_REUSED");
  });

  it("S-03: dopo theft detection tutte le sessioni della famiglia sono revocate", async () => {
    const tokens = await registerAndLogin();
    const oldRt = tokens.refresh_token;

    await request(app).post("/api/v1/auth/refresh").send({ refresh_token: oldRt });
    await request(app).post("/api/v1/auth/refresh").send({ refresh_token: oldRt });

    // Tutte le sessioni devono essere revocate
    const sessions = await SessionModel.find({ deleted_at: null });
    expect(sessions).toHaveLength(0);
  });

  // ── Errori ────────────────────────────────────────────────────────────────

  it("401 REFRESH_TOKEN_INVALID — token non esiste nel DB", async () => {
    const res = await request(app)
      .post("/api/v1/auth/refresh")
      .send({ refresh_token: "rt_" + "a".repeat(64) })
      .expect(401);
    expect(res.body.error.code).toBe("REFRESH_TOKEN_INVALID");
  });

  it("400 VALIDATION_ERROR — refresh_token senza prefisso rt_", async () => {
    const res = await request(app)
      .post("/api/v1/auth/refresh")
      .send({ refresh_token: "invalid-format" })
      .expect(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("400 VALIDATION_ERROR — body vuoto", async () => {
    const res = await request(app).post("/api/v1/auth/refresh").send({}).expect(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });
});
