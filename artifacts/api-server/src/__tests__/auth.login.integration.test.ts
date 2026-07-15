/**
 * Integration test — POST /api/v1/auth/login
 *
 * Prerequisito: prima crea un utente via register, poi testa login.
 * Obiettivo Sprint 3: login funzionante con password corretta,
 * rate limiting, device trust, audit log — test verdi senza regressioni.
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
// Setup DB in-memory
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
  _resetRedisClient(); // resetta rate limiter in-memory tra i test
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const baseUser = {
  username: "marco_rossi",
  display_name: "Marco Rossi",
  password: "S3cur3P@ss!",
  device_id: "550e8400-e29b-41d4-a716-446655440001",
  device_type: "ios",
  device_name: "iPhone 16 Pro",
};

async function createUser(overrides = {}) {
  return request(app).post("/api/v1/auth/register").send({ ...baseUser, ...overrides });
}

const loginPayload = {
  identifier: "marco_rossi",
  password: "S3cur3P@ss!",
  device_id: "550e8400-e29b-41d4-a716-446655440002",
  device_type: "ios",
  device_name: "iPhone 16 Pro",
};

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("POST /api/v1/auth/login", () => {

  // ── Happy path — username ─────────────────────────────────────────────────

  it("200 — login con username e password corretti", async () => {
    await createUser();
    const res = await request(app).post("/api/v1/auth/login").send(loginPayload).expect(200);

    expect(res.body.data.user.username).toBe("marco_rossi");
    expect(res.body.data.tokens.access_token).toBeTruthy();
    expect(res.body.data.tokens.refresh_token).toMatch(/^rt_/);
    expect(res.body.data.requires_2fa).toBe(false);
  });

  it("200 — login con email e password corretti", async () => {
    await createUser({ email: "marco@example.com" });
    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({ ...loginPayload, identifier: "marco@example.com" })
      .expect(200);

    expect(res.body.data.user.username).toBe("marco_rossi");
    expect(res.body.data.tokens.access_token).toBeTruthy();
  });

  it("200 — l'access token è verificabile", async () => {
    await createUser();
    const res = await request(app).post("/api/v1/auth/login").send(loginPayload).expect(200);
    const payload = await verifyAccessToken(res.body.data.tokens.access_token);
    expect(payload.sub).toBeTruthy();
    expect(payload.device_id).toBe(loginPayload.device_id);
  });

  it("200 — is_new_device true al primo login da un nuovo device", async () => {
    await createUser(); // register crea sessione su device 001
    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({ ...loginPayload, device_id: "550e8400-e29b-41d4-a716-446655440003" }) // device diverso
      .expect(200);

    expect(res.body.data.is_new_device).toBe(true);
  });

  it("200 — is_new_device false al secondo login dallo stesso device", async () => {
    await createUser();
    // Primo login
    await request(app).post("/api/v1/auth/login").send(loginPayload).expect(200);
    // Secondo login stesso device
    const res = await request(app).post("/api/v1/auth/login").send(loginPayload).expect(200);
    expect(res.body.data.is_new_device).toBe(false);
  });

  it("200 — sessione creata nel database", async () => {
    await createUser();
    await request(app).post("/api/v1/auth/login").send(loginPayload).expect(200);

    const session = await SessionModel.findOne({ device_id: loginPayload.device_id });
    expect(session).toBeTruthy();
    expect(session!.deleted_at).toBeNull();
    expect(session!.refresh_token_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("200 — login_count incrementato a ogni login", async () => {
    await createUser();
    await request(app).post("/api/v1/auth/login").send(loginPayload).expect(200);
    await request(app).post("/api/v1/auth/login").send(loginPayload).expect(200);

    const session = await SessionModel.findOne({ device_id: loginPayload.device_id });
    expect(session!.login_count).toBe(2);
  });

  it("200 — device diventa trusted dopo 3 login", async () => {
    await createUser();
    for (let i = 0; i < 3; i++) {
      await request(app).post("/api/v1/auth/login").send(loginPayload).expect(200);
    }
    const session = await SessionModel.findOne({ device_id: loginPayload.device_id });
    expect(session!.is_trusted).toBe(true);
    expect(session!.login_count).toBe(3);
  });

  // ── Errori autenticazione ─────────────────────────────────────────────────

  it("401 INVALID_CREDENTIALS — password errata", async () => {
    await createUser();
    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({ ...loginPayload, password: "WrongPass1" })
      .expect(401);

    expect(res.body.error.code).toBe("INVALID_CREDENTIALS");
  });

  it("401 INVALID_CREDENTIALS — utente non esiste", async () => {
    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({ ...loginPayload, identifier: "utente_inesistente" })
      .expect(401);

    expect(res.body.error.code).toBe("INVALID_CREDENTIALS");
  });

  it("401 — risposta identica per utente non trovato e password errata (anti-enumeration)", async () => {
    await createUser();
    const r1 = await request(app)
      .post("/api/v1/auth/login")
      .send({ ...loginPayload, password: "WrongPass1" });
    const r2 = await request(app)
      .post("/api/v1/auth/login")
      .send({ ...loginPayload, identifier: "inesistente99" });

    expect(r1.status).toBe(401);
    expect(r2.status).toBe(401);
    expect(r1.body.error.code).toBe(r2.body.error.code);
  });

  // ── Validazione ────────────────────────────────────────────────────────────

  it("400 VALIDATION_ERROR — identifier mancante", async () => {
    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({ password: "S3cur3P@ss!", device_id: loginPayload.device_id, device_type: "ios" })
      .expect(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("400 VALIDATION_ERROR — device_id non UUID", async () => {
    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({ ...loginPayload, device_id: "non-uuid" })
      .expect(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("400 VALIDATION_ERROR — body vuoto", async () => {
    const res = await request(app).post("/api/v1/auth/login").send({}).expect(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });
});

// ---------------------------------------------------------------------------
// Reserved username — integrazione con register
// ---------------------------------------------------------------------------

describe("Reserved username (pre-sprint check)", () => {
  it("400 VALIDATION_ERROR — username riservato 'admin'", async () => {
    const res = await request(app)
      .post("/api/v1/auth/register")
      .send({ ...baseUser, username: "admin" })
      .expect(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("400 VALIDATION_ERROR — username riservato 'support'", async () => {
    const res = await request(app)
      .post("/api/v1/auth/register")
      .send({ ...baseUser, username: "support" })
      .expect(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("400 VALIDATION_ERROR — username riservato 'alphachat'", async () => {
    const res = await request(app)
      .post("/api/v1/auth/register")
      .send({ ...baseUser, username: "alphachat" })
      .expect(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });
});
