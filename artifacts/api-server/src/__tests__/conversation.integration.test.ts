/**
 * Integration tests — Sprint 5B: Chat Creation
 *
 * Copertura:
 *   POST /api/v1/conversations
 *     - 201 crea chat diretta tra due utenti
 *     - 200 restituisce conversazione esistente (idempotenza)
 *     - 400 non puoi aprire una chat con te stesso
 *     - 401 unauthenticated
 *     - 404 utente target non trovato
 *     - 422 username mancante
 *   GET /api/v1/conversations
 *     - 200 lista vuota all'inizio
 *     - 200 lista con una conversazione dopo creazione
 *     - 200 pinned, archived, muted presenti nella risposta
 *     - 401 unauthenticated
 */

import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import request from "supertest";
import app from "../app";
import { UserModel } from "../models/user.model";
import { SessionModel } from "../models/session.model";
import { PresenceModel } from "../models/presence.model";
import { ConversationModel } from "../models/conversation.model";
import { ConversationMemberModel } from "../models/conversation-member.model";
import { _resetRedisClient } from "../lib/redis";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

afterEach(async () => {
  await Promise.all([
    UserModel.deleteMany({}),
    SessionModel.deleteMany({}),
    PresenceModel.deleteMany({}),
    ConversationModel.deleteMany({}),
    ConversationMemberModel.deleteMany({}),
  ]);
  _resetRedisClient();
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface AuthResult {
  accessToken: string;
  userId: string;
  username: string;
}

let deviceCounter = 0;
async function registerUser(username: string): Promise<AuthResult> {
  deviceCounter += 1;
  const deviceId = `550e8400-e29b-41d4-a716-${String(deviceCounter).padStart(12, "0")}`;
  const res = await request(app)
    .post("/api/v1/auth/register")
    .send({
      username,
      display_name: username,
      password: "S3cur3P@ss!",
      device_id: deviceId,
      device_type: "ios",
    });

  if (res.status !== 201) {
    throw new Error(`registerUser(${username}) failed: ${res.status} ${JSON.stringify(res.body)}`);
  }

  return {
    accessToken: res.body.data.tokens.access_token,
    userId: res.body.data.user.id,
    username: res.body.data.user.username,
  };
}

// ---------------------------------------------------------------------------
// POST /api/v1/conversations
// ---------------------------------------------------------------------------

describe("POST /api/v1/conversations", () => {
  it("201 — crea chat diretta tra due utenti", async () => {
    const alice = await registerUser("alice_conv");
    const bob = await registerUser("bob_conv");

    const res = await request(app)
      .post("/api/v1/conversations")
      .set("Authorization", `Bearer ${alice.accessToken}`)
      .send({ username: bob.username })
      .expect(201);

    expect(res.body.data.conversation_id).toBeTruthy();
    expect(res.body.data.type).toBe("direct");
    expect(res.body.data.is_new).toBe(true);
    expect(res.body.data.member_count).toBe(2);
    expect(res.body.data.members).toHaveLength(2);

    const memberIds = res.body.data.members.map((m: { user_id: string }) => m.user_id);
    expect(memberIds).toContain(alice.userId);
    expect(memberIds).toContain(bob.userId);
  });

  it("200 — idempotenza: seconda chiamata restituisce la stessa conversazione", async () => {
    const alice = await registerUser("alice_idem");
    const bob = await registerUser("bob_idem");

    const r1 = await request(app)
      .post("/api/v1/conversations")
      .set("Authorization", `Bearer ${alice.accessToken}`)
      .send({ username: bob.username })
      .expect(201);

    const r2 = await request(app)
      .post("/api/v1/conversations")
      .set("Authorization", `Bearer ${alice.accessToken}`)
      .send({ username: bob.username })
      .expect(200);

    expect(r2.body.data.conversation_id).toBe(r1.body.data.conversation_id);
    expect(r2.body.data.is_new).toBe(false);
  });

  it("200 — idempotenza: anche se inizia bob (non alice)", async () => {
    const alice = await registerUser("alice_rev");
    const bob = await registerUser("bob_rev");

    // Alice apre per prima
    const r1 = await request(app)
      .post("/api/v1/conversations")
      .set("Authorization", `Bearer ${alice.accessToken}`)
      .send({ username: bob.username })
      .expect(201);

    // Bob "apre" la stessa chat — deve trovare quella esistente
    const r2 = await request(app)
      .post("/api/v1/conversations")
      .set("Authorization", `Bearer ${bob.accessToken}`)
      .send({ username: alice.username })
      .expect(200);

    expect(r2.body.data.conversation_id).toBe(r1.body.data.conversation_id);
    expect(r2.body.data.is_new).toBe(false);
  });

  it("400 — non puoi aprire una chat con te stesso", async () => {
    const alice = await registerUser("alice_self");

    const res = await request(app)
      .post("/api/v1/conversations")
      .set("Authorization", `Bearer ${alice.accessToken}`)
      .send({ username: alice.username })
      .expect(400);

    expect(res.body.error.code).toBe("CANNOT_CHAT_WITH_SELF");
  });

  it("401 — richiede autenticazione", async () => {
    await request(app)
      .post("/api/v1/conversations")
      .send({ username: "someone" })
      .expect(401);
  });

  it("404 — utente target non trovato", async () => {
    const alice = await registerUser("alice_404");

    const res = await request(app)
      .post("/api/v1/conversations")
      .set("Authorization", `Bearer ${alice.accessToken}`)
      .send({ username: "nonexistent_user_xyz" })
      .expect(404);

    expect(res.body.error.code).toBe("USER_NOT_FOUND");
  });

  it("400 — username mancante nel body", async () => {
    const alice = await registerUser("alice_400");

    const res = await request(app)
      .post("/api/v1/conversations")
      .set("Authorization", `Bearer ${alice.accessToken}`)
      .send({})
      .expect(400);

    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("400 — username troppo corto", async () => {
    const alice = await registerUser("alice_short");

    const res = await request(app)
      .post("/api/v1/conversations")
      .set("Authorization", `Bearer ${alice.accessToken}`)
      .send({ username: "ab" })
      .expect(400);

    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("la conversazione è nel DB con i dati corretti", async () => {
    const alice = await registerUser("alice_db");
    const bob = await registerUser("bob_db");

    const res = await request(app)
      .post("/api/v1/conversations")
      .set("Authorization", `Bearer ${alice.accessToken}`)
      .send({ username: bob.username })
      .expect(201);

    const convId = res.body.data.conversation_id;

    const conv = await ConversationModel.findById(convId);
    expect(conv).toBeTruthy();
    expect(conv!.type).toBe("direct");
    expect(conv!.member_count).toBe(2);
    expect(conv!.deleted_at).toBeNull();

    const members = await ConversationMemberModel.find({
      conversation_id: new mongoose.Types.ObjectId(convId),
    });
    expect(members).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// GET /api/v1/conversations
// ---------------------------------------------------------------------------

describe("GET /api/v1/conversations", () => {
  it("200 — lista vuota se nessuna conversazione", async () => {
    const alice = await registerUser("alice_empty");

    const res = await request(app)
      .get("/api/v1/conversations")
      .set("Authorization", `Bearer ${alice.accessToken}`)
      .expect(200);

    expect(res.body.data).toEqual([]);
    expect(res.body.pagination.has_more).toBe(false);
  });

  it("200 — lista con una conversazione dopo creazione", async () => {
    const alice = await registerUser("alice_list");
    const bob = await registerUser("bob_list");

    await request(app)
      .post("/api/v1/conversations")
      .set("Authorization", `Bearer ${alice.accessToken}`)
      .send({ username: bob.username })
      .expect(201);

    const res = await request(app)
      .get("/api/v1/conversations")
      .set("Authorization", `Bearer ${alice.accessToken}`)
      .expect(200);

    expect(res.body.data).toHaveLength(1);
    const conv = res.body.data[0];
    expect(conv.type).toBe("direct");
    expect(conv.other_user).toBeTruthy();
    expect(conv.other_user.username).toBe(bob.username);
    expect(conv.is_pinned).toBe(false);
    expect(conv.is_archived).toBe(false);
    expect(conv.is_muted).toBe(false);
    expect(conv.unread_count).toBe(0);
  });

  it("200 — entrambi i partecipanti vedono la stessa conversazione", async () => {
    const alice = await registerUser("alice_both");
    const bob = await registerUser("bob_both");

    const createRes = await request(app)
      .post("/api/v1/conversations")
      .set("Authorization", `Bearer ${alice.accessToken}`)
      .send({ username: bob.username })
      .expect(201);

    const convId = createRes.body.data.conversation_id;

    const aliceList = await request(app)
      .get("/api/v1/conversations")
      .set("Authorization", `Bearer ${alice.accessToken}`)
      .expect(200);

    const bobList = await request(app)
      .get("/api/v1/conversations")
      .set("Authorization", `Bearer ${bob.accessToken}`)
      .expect(200);

    expect(aliceList.body.data[0].conversation_id).toBe(convId);
    expect(bobList.body.data[0].conversation_id).toBe(convId);

    // other_user corretto per entrambi
    expect(aliceList.body.data[0].other_user.username).toBe(bob.username);
    expect(bobList.body.data[0].other_user.username).toBe(alice.username);
  });

  it("200 — multiple conversazioni ordinate per last_activity_at desc", async () => {
    const alice = await registerUser("alice_order");
    const bob = await registerUser("bob_order");
    const carol = await registerUser("carol_order");

    // Alice apre chat con Bob, poi con Carol
    await request(app)
      .post("/api/v1/conversations")
      .set("Authorization", `Bearer ${alice.accessToken}`)
      .send({ username: bob.username });

    // Pausa minima per garantire ordering temporale
    await new Promise((r) => setTimeout(r, 5));

    await request(app)
      .post("/api/v1/conversations")
      .set("Authorization", `Bearer ${alice.accessToken}`)
      .send({ username: carol.username });

    const res = await request(app)
      .get("/api/v1/conversations")
      .set("Authorization", `Bearer ${alice.accessToken}`)
      .expect(200);

    expect(res.body.data).toHaveLength(2);
    // Carol (più recente) deve venire prima
    expect(res.body.data[0].other_user.username).toBe("carol_order");
    expect(res.body.data[1].other_user.username).toBe("bob_order");
  });

  it("401 — richiede autenticazione", async () => {
    await request(app).get("/api/v1/conversations").expect(401);
  });
});
