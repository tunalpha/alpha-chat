/**
 * Integration test — User Discovery (Sprint 5A)
 *
 * GET /api/v1/users/:username
 * GET /api/v1/users/search
 *
 * Verifica:
 * - Profilo pubblico restituito correttamente
 * - Ricerca per prefisso username
 * - Privacy: online_status nascosto se show_online_status != "everyone"
 * - 404 per utenti inesistenti o non attivi
 * - 401 senza token JWT
 * - Validazione query params
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import request from "supertest";
import app from "../app";
import { UserModel } from "../models/user.model";
import { SessionModel } from "../models/session.model";
import { PresenceModel } from "../models/presence.model";
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
  await PresenceModel.deleteMany({});
  _resetRedisClient();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Genera device_id UUID valido da un username (solo hex nel segmento finale). */
function makeDeviceId(username: string): string {
  const hex = username
    .split("")
    .map((c) => c.charCodeAt(0).toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 12)
    .padEnd(12, "0");
  return `550e8400-e29b-41d4-a716-${hex}`;
}

async function registerUser(username: string, extra: Record<string, unknown> = {}) {
  const res = await request(app).post("/api/v1/auth/register").send({
    username,
    display_name: `Display ${username}`,
    password: "S3cur3P@ss!",
    device_id: makeDeviceId(username),
    device_type: "ios",
    ...extra,
  });
  if (res.status !== 201) {
    throw new Error(`registerUser(${username}) failed ${res.status}: ${JSON.stringify(res.body)}`);
  }
  return {
    userId: res.body.data.user.id as string,
    accessToken: res.body.data.tokens.access_token as string,
  };
}

// ---------------------------------------------------------------------------
// GET /api/v1/users/:username
// ---------------------------------------------------------------------------

describe("GET /api/v1/users/:username", () => {

  it("200 — restituisce il profilo pubblico di un utente esistente", async () => {
    const viewer = await registerUser("viewer_user");
    await registerUser("target_user");

    const res = await request(app)
      .get("/api/v1/users/target_user")
      .set("Authorization", `Bearer ${viewer.accessToken}`)
      .expect(200);

    expect(res.body.data.username).toBe("target_user");
    expect(res.body.data.display_name).toBe("Display target_user");
    expect(res.body.data.id).toBeTruthy();
    expect(res.body.data.joined_at).toBeTruthy();
    expect(res.body.data.is_verified).toBe(false);
  });

  it("200 — bio, avatar_url, is_verified presenti nel payload", async () => {
    const viewer = await registerUser("viewer2");
    await registerUser("target2");

    const res = await request(app)
      .get("/api/v1/users/target2")
      .set("Authorization", `Bearer ${viewer.accessToken}`)
      .expect(200);

    expect(res.body.data).toHaveProperty("bio");
    expect(res.body.data).toHaveProperty("avatar_url");
    expect(res.body.data).toHaveProperty("is_verified");
    expect(res.body.data).toHaveProperty("online_status");
    expect(res.body.data).toHaveProperty("last_seen_at");
  });

  it("200 — NON espone email, password_hash, privacy settings o campi sensibili", async () => {
    const viewer = await registerUser("viewer3");
    await registerUser("target3");

    const res = await request(app)
      .get("/api/v1/users/target3")
      .set("Authorization", `Bearer ${viewer.accessToken}`)
      .expect(200);

    expect(res.body.data).not.toHaveProperty("email");
    expect(res.body.data).not.toHaveProperty("password_hash");
    expect(res.body.data).not.toHaveProperty("phone_hash");
    expect(res.body.data).not.toHaveProperty("privacy");
    expect(res.body.data).not.toHaveProperty("failed_login_attempts");
    expect(res.body.data).not.toHaveProperty("totp_secret");
  });

  it("200 — online_status visibile se show_online_status = everyone e presenza nel DB", async () => {
    const viewer = await registerUser("viewer4");
    const target = await registerUser("target4");

    // Imposta privacy everyone
    await UserModel.updateOne(
      { _id: new mongoose.Types.ObjectId(target.userId) },
      { "privacy.show_online_status": "everyone" },
    );
    // Crea documento presenza
    await PresenceModel.create({
      user_id: new mongoose.Types.ObjectId(target.userId),
      status: "online",
      last_seen_at: new Date(),
    });

    const res = await request(app)
      .get("/api/v1/users/target4")
      .set("Authorization", `Bearer ${viewer.accessToken}`)
      .expect(200);

    expect(res.body.data.online_status).toBe("online");
  });

  it("200 — online_status null se show_online_status = contacts (viewer non è contatto)", async () => {
    const viewer = await registerUser("viewer5");
    const target = await registerUser("target5");

    await UserModel.updateOne(
      { _id: new mongoose.Types.ObjectId(target.userId) },
      { "privacy.show_online_status": "contacts" },
    );
    await PresenceModel.create({
      user_id: new mongoose.Types.ObjectId(target.userId),
      status: "online",
      last_seen_at: new Date(),
    });

    const res = await request(app)
      .get("/api/v1/users/target5")
      .set("Authorization", `Bearer ${viewer.accessToken}`)
      .expect(200);

    expect(res.body.data.online_status).toBeNull();
  });

  it("200 — il proprio profilo è visibile a sé stessi", async () => {
    const user = await registerUser("self_viewer");

    const res = await request(app)
      .get("/api/v1/users/self_viewer")
      .set("Authorization", `Bearer ${user.accessToken}`)
      .expect(200);

    expect(res.body.data.username).toBe("self_viewer");
  });

  it("404 USER_NOT_FOUND — username non esiste", async () => {
    const viewer = await registerUser("viewer6");

    const res = await request(app)
      .get("/api/v1/users/utente_inesistente")
      .set("Authorization", `Bearer ${viewer.accessToken}`)
      .expect(404);

    expect(res.body.error.code).toBe("USER_NOT_FOUND");
  });

  it("404 — utente sospeso non trovato (non rivela lo stato)", async () => {
    const viewer = await registerUser("viewer7");
    const target = await registerUser("target7");

    await UserModel.updateOne(
      { _id: new mongoose.Types.ObjectId(target.userId) },
      { status: "suspended" },
    );

    const res = await request(app)
      .get("/api/v1/users/target7")
      .set("Authorization", `Bearer ${viewer.accessToken}`)
      .expect(404);

    expect(res.body.error.code).toBe("USER_NOT_FOUND");
  });

  it("401 — senza token Bearer", async () => {
    await registerUser("target8");
    const res = await request(app).get("/api/v1/users/target8").expect(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });
});

// ---------------------------------------------------------------------------
// GET /api/v1/users/search
// ---------------------------------------------------------------------------

/**
 * GET /api/v1/users/search — DISABILITATO (Sprint 9)
 *
 * La ricerca pubblica degli utenti è stata rimossa a favore del sistema
 * di invito basato su codici monouso crittograficamente sicuri.
 * L'endpoint ora restituisce 410 Gone per qualsiasi richiesta autenticata.
 */
describe("GET /api/v1/users/search (disabled — Sprint 9)", () => {

  it("410 Gone — endpoint disabilitato per privacy (con token)", async () => {
    const viewer = await registerUser("searchviewer1");

    const res = await request(app)
      .get("/api/v1/users/search?q=marco")
      .set("Authorization", `Bearer ${viewer.accessToken}`)
      .expect(410);

    expect(res.body.error.code).toBe("ENDPOINT_DEPRECATED");
  });

  it("410 Gone — anche senza parametri query (con token)", async () => {
    const viewer = await registerUser("searchviewer2");

    const res = await request(app)
      .get("/api/v1/users/search")
      .set("Authorization", `Bearer ${viewer.accessToken}`)
      .expect(410);

    expect(res.body.error.code).toBe("ENDPOINT_DEPRECATED");
  });

  it("410 Gone — anche con parametri non validi (con token)", async () => {
    const viewer = await registerUser("searchviewer3");

    const res = await request(app)
      .get("/api/v1/users/search?q=a")
      .set("Authorization", `Bearer ${viewer.accessToken}`)
      .expect(410);

    expect(res.body.error.code).toBe("ENDPOINT_DEPRECATED");
  });

  it("401 — senza token rimane non autorizzato", async () => {
    const res = await request(app).get("/api/v1/users/search?q=marco").expect(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });
});
