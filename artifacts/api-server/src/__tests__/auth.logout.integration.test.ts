/**
 * Integration test — POST /api/v1/auth/logout e /logout-all
 *
 * Verifica:
 * - Logout singolo: sessione revocata, AT nella blocklist
 * - Logout-all: tutte le sessioni revocate
 * - AT revocato non può essere riutilizzato
 * - Endpoint protetti richiedono AT valido
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import request from "supertest";
import app from "../app";
import { UserModel } from "../models/user.model";
import { SessionModel } from "../models/session.model";
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

async function registerUser(overrides: Record<string, unknown> = {}) {
  const res = await request(app).post("/api/v1/auth/register").send({
    username: "test_logout", display_name: "Test Logout",
    password: "S3cur3P@ss!", device_id: "550e8400-e29b-41d4-a716-446655440001",
    device_type: "ios", ...overrides,
  });
  return res.body.data.tokens as {
    access_token: string; refresh_token: string;
    access_token_expires_at: string; refresh_token_expires_at: string;
  };
}

async function loginUser(deviceId: string) {
  const res = await request(app).post("/api/v1/auth/login").send({
    identifier: "test_logout", password: "S3cur3P@ss!",
    device_id: deviceId, device_type: "android",
  });
  return res.body.data.tokens as {
    access_token: string; refresh_token: string;
    access_token_expires_at: string; refresh_token_expires_at: string;
  };
}

// ---------------------------------------------------------------------------
// POST /api/v1/auth/logout
// ---------------------------------------------------------------------------

describe("POST /api/v1/auth/logout", () => {

  it("200 — logout revoca la sessione corrente", async () => {
    const tokens = await registerUser();
    await request(app)
      .post("/api/v1/auth/logout")
      .set("Authorization", `Bearer ${tokens.access_token}`)
      .expect(200);

    const session = await SessionModel.findOne({ deleted_at: { $ne: null } });
    expect(session).toBeTruthy();
  });

  it("200 — dopo logout il refresh token non funziona più", async () => {
    const tokens = await registerUser();
    await request(app)
      .post("/api/v1/auth/logout")
      .set("Authorization", `Bearer ${tokens.access_token}`)
      .expect(200);

    const res = await request(app)
      .post("/api/v1/auth/refresh")
      .send({ refresh_token: tokens.refresh_token });
    // La sessione è revocata → REFRESH_TOKEN_REUSED (tentativo su token revocato)
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("401 — logout senza token Bearer", async () => {
    const res = await request(app).post("/api/v1/auth/logout").expect(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  it("401 — logout con token malformato", async () => {
    const res = await request(app)
      .post("/api/v1/auth/logout")
      .set("Authorization", "Bearer not-a-valid-jwt")
      .expect(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  it("401 TOKEN_REVOKED — logout con AT già revocato", async () => {
    const tokens = await registerUser();

    // Primo logout — OK
    await request(app)
      .post("/api/v1/auth/logout")
      .set("Authorization", `Bearer ${tokens.access_token}`)
      .expect(200);

    // Secondo tentativo con lo stesso AT → blocklisted
    const res = await request(app)
      .post("/api/v1/auth/logout")
      .set("Authorization", `Bearer ${tokens.access_token}`)
      .expect(401);
    expect(res.body.error.code).toBe("TOKEN_REVOKED");
  });
});

// ---------------------------------------------------------------------------
// POST /api/v1/auth/logout-all
// ---------------------------------------------------------------------------

describe("POST /api/v1/auth/logout-all", () => {

  it("200 — logout-all revoca tutte le sessioni", async () => {
    const tokens = await registerUser();

    // Login da secondo device
    await loginUser("550e8400-e29b-41d4-a716-446655440002");

    const beforeCount = await SessionModel.countDocuments({ deleted_at: null });
    expect(beforeCount).toBe(2);

    await request(app)
      .post("/api/v1/auth/logout-all")
      .set("Authorization", `Bearer ${tokens.access_token}`)
      .expect(200);

    const afterCount = await SessionModel.countDocuments({ deleted_at: null });
    expect(afterCount).toBe(0);
  });

  it("200 — risposta include revoked_sessions count", async () => {
    const tokens = await registerUser();
    await loginUser("550e8400-e29b-41d4-a716-446655440002");

    const res = await request(app)
      .post("/api/v1/auth/logout-all")
      .set("Authorization", `Bearer ${tokens.access_token}`)
      .expect(200);

    expect(res.body.data.revoked_sessions).toBe(2);
  });

  it("200 — dopo logout-all nessun refresh token funziona", async () => {
    const tokens = await registerUser();
    const tokens2 = await loginUser("550e8400-e29b-41d4-a716-446655440002");

    await request(app)
      .post("/api/v1/auth/logout-all")
      .set("Authorization", `Bearer ${tokens.access_token}`)
      .expect(200);

    // Nessuno dei due RT deve funzionare
    const r1 = await request(app)
      .post("/api/v1/auth/refresh")
      .send({ refresh_token: tokens.refresh_token });
    const r2 = await request(app)
      .post("/api/v1/auth/refresh")
      .send({ refresh_token: tokens2.refresh_token });

    expect(r1.status).toBeGreaterThanOrEqual(400);
    expect(r2.status).toBeGreaterThanOrEqual(400);
  });

  it("401 — logout-all senza token Bearer", async () => {
    const res = await request(app).post("/api/v1/auth/logout-all").expect(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });
});
