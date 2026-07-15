/**
 * Integration test — POST /api/v1/auth/register
 *
 * Usa mongodb-memory-server per un DB in-memory isolato.
 * Obiettivo (Sprint 2): un utente si registra, ottiene una sessione valida
 * e compare nel database con tutti i dati previsti.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import request from "supertest";
import app from "../app";
import { UserModel } from "../models/user.model";
import { SessionModel } from "../models/session.model";
import { verifyAccessToken } from "../services/jwt.service";

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
  // Pulisce le collection tra i test per isolamento
  await UserModel.deleteMany({});
  await SessionModel.deleteMany({});
});

// ---------------------------------------------------------------------------
// Payload valido base
// ---------------------------------------------------------------------------

const validPayload = {
  username: "marco_rossi",
  display_name: "Marco Rossi",
  password: "S3cur3P@ss!",
  device_id: "550e8400-e29b-41d4-a716-446655440001",
  device_type: "ios",
  device_name: "iPhone 16 Pro di Marco",
};

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("POST /api/v1/auth/register", () => {

  // ── Happy path ─────────────────────────────────────────────────────────────

  it("201 — registra l'utente e restituisce tokens", async () => {
    const res = await request(app)
      .post("/api/v1/auth/register")
      .send(validPayload)
      .expect(201);

    expect(res.body.data).toBeDefined();
    expect(res.body.data.user.username).toBe("marco_rossi");
    expect(res.body.data.user.display_name).toBe("Marco Rossi");
    expect(res.body.data.tokens.access_token).toBeTruthy();
    expect(res.body.data.tokens.refresh_token).toMatch(/^rt_/);
    expect(res.body.meta.timestamp).toBeTruthy();
  });

  it("201 — l'utente compare nel database con i dati corretti", async () => {
    await request(app).post("/api/v1/auth/register").send(validPayload).expect(201);

    const user = await UserModel.findOne({ username: "marco_rossi" });
    expect(user).toBeTruthy();
    expect(user!.username).toBe("marco_rossi");
    expect(user!.display_name).toBe("Marco Rossi");
    expect(user!.status).toBe("active");
    // La password NON deve essere conservata in chiaro
    expect(user!.password_hash).not.toBe("S3cur3P@ss!");
    expect(user!.password_hash).toMatch(/^\$argon2id\$/);
  });

  it("201 — la sessione compare nel database", async () => {
    await request(app).post("/api/v1/auth/register").send(validPayload).expect(201);

    const session = await SessionModel.findOne({
      device_id: validPayload.device_id,
    });
    expect(session).toBeTruthy();
    expect(session!.deleted_at).toBeNull();
    expect(session!.expires_at.getTime()).toBeGreaterThan(Date.now());
    // Il refresh token NON deve essere in chiaro nel DB
    expect(session!.refresh_token_hash).not.toMatch(/^rt_/);
    expect(session!.refresh_token_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("201 — l'access token è verificabile e contiene i dati corretti", async () => {
    const res = await request(app)
      .post("/api/v1/auth/register")
      .send(validPayload)
      .expect(201);

    const { access_token } = res.body.data.tokens;
    const payload = await verifyAccessToken(access_token);

    expect(payload.sub).toBeTruthy(); // user_id
    expect(payload.device_id).toBe(validPayload.device_id);
    expect(payload.jti).toBeTruthy();
    expect(payload.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it("201 — username normalizzato in lowercase", async () => {
    const res = await request(app)
      .post("/api/v1/auth/register")
      .send({ ...validPayload, username: "Marco_Rossi" })
      .expect(201);

    expect(res.body.data.user.username).toBe("marco_rossi");
    const user = await UserModel.findOne({ username: "marco_rossi" });
    expect(user).toBeTruthy();
  });

  it("201 — registrazione con email opzionale", async () => {
    const res = await request(app)
      .post("/api/v1/auth/register")
      .send({ ...validPayload, email: "marco@example.com" })
      .expect(201);

    expect(res.body.data.user.email).toBe("marco@example.com");
    const user = await UserModel.findOne({ username: "marco_rossi" });
    expect(user!.email).toBe("marco@example.com");
  });

  // ── Conflitti ──────────────────────────────────────────────────────────────

  it("409 USERNAME_TAKEN — username già in uso", async () => {
    await request(app).post("/api/v1/auth/register").send(validPayload).expect(201);

    const res = await request(app)
      .post("/api/v1/auth/register")
      .send({ ...validPayload, device_id: "550e8400-e29b-41d4-a716-446655440002" })
      .expect(409);

    expect(res.body.error.code).toBe("USERNAME_TAKEN");
    expect(res.body.error.field).toBe("username");
  });

  it("409 EMAIL_TAKEN — email già in uso", async () => {
    await request(app)
      .post("/api/v1/auth/register")
      .send({ ...validPayload, email: "same@example.com" })
      .expect(201);

    const res = await request(app)
      .post("/api/v1/auth/register")
      .send({
        ...validPayload,
        username: "altro_utente",
        email: "same@example.com",
        device_id: "550e8400-e29b-41d4-a716-446655440002",
      })
      .expect(409);

    expect(res.body.error.code).toBe("EMAIL_TAKEN");
    expect(res.body.error.field).toBe("email");
  });

  // ── Validazione ────────────────────────────────────────────────────────────

  it("400 VALIDATION_ERROR — password troppo corta", async () => {
    const res = await request(app)
      .post("/api/v1/auth/register")
      .send({ ...validPayload, password: "short" })
      .expect(400);

    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("400 VALIDATION_ERROR — password senza maiuscola", async () => {
    const res = await request(app)
      .post("/api/v1/auth/register")
      .send({ ...validPayload, password: "nouppercase1" })
      .expect(400);

    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("400 VALIDATION_ERROR — password senza numero", async () => {
    const res = await request(app)
      .post("/api/v1/auth/register")
      .send({ ...validPayload, password: "NoNumbers!" })
      .expect(400);

    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("400 VALIDATION_ERROR — username troppo corto", async () => {
    const res = await request(app)
      .post("/api/v1/auth/register")
      .send({ ...validPayload, username: "ab" })
      .expect(400);

    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("400 VALIDATION_ERROR — username con caratteri non permessi", async () => {
    const res = await request(app)
      .post("/api/v1/auth/register")
      .send({ ...validPayload, username: "marco rossi!" })
      .expect(400);

    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("400 VALIDATION_ERROR — device_id non è UUID", async () => {
    const res = await request(app)
      .post("/api/v1/auth/register")
      .send({ ...validPayload, device_id: "non-un-uuid" })
      .expect(400);

    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("400 VALIDATION_ERROR — device_type non valido", async () => {
    const res = await request(app)
      .post("/api/v1/auth/register")
      .send({ ...validPayload, device_type: "smartwatch" })
      .expect(400);

    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("400 VALIDATION_ERROR — body vuoto", async () => {
    const res = await request(app)
      .post("/api/v1/auth/register")
      .send({})
      .expect(400);

    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("400 VALIDATION_ERROR — email malformata", async () => {
    const res = await request(app)
      .post("/api/v1/auth/register")
      .send({ ...validPayload, email: "not-an-email" })
      .expect(400);

    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });
});
