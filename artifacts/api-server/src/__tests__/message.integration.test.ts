/**
 * Integration tests — Sprint 6: First Message
 *
 * Copertura:
 *   POST /api/v1/conversations/:id/messages
 *     - 201 invia messaggio con successo
 *     - 200 idempotenza: stesso client_message_id → stesso messaggio
 *     - 201 ciphertext opaco al server (qualsiasi base64 è accettato)
 *     - 400 body non valido (ciphertext mancante, UUID malformato)
 *     - 401 unauthenticated
 *     - 403 non membro della conversazione
 *     - 404 conversazione inesistente
 *     - La conversazione aggiorna last_message_at e last_activity_at
 *     - sequence_number è monotono crescente
 *   GET /api/v1/conversations/:id/messages
 *     - 200 lista messaggi in ordine DESC per sequence_number
 *     - 200 lista vuota se nessun messaggio
 *     - 200 paginazione: before_sequence filtra correttamente
 *     - 200 has_more e cursor presenti quando ci sono più messaggi
 *     - 401 unauthenticated
 *     - 403 non membro della conversazione
 *     - 404 conversazione inesistente
 */

import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import request from "supertest";
import { randomUUID } from "node:crypto";
import app from "../app";
import { UserModel } from "../models/user.model";
import { SessionModel } from "../models/session.model";
import { PresenceModel } from "../models/presence.model";
import { ConversationModel } from "../models/conversation.model";
import { ConversationMemberModel } from "../models/conversation-member.model";
import { MessageModel } from "../models/message.model";
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
    MessageModel.deleteMany({}),
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

async function createConversation(
  initiator: AuthResult,
  targetUsername: string,
): Promise<string> {
  const res = await request(app)
    .post("/api/v1/conversations")
    .set("Authorization", `Bearer ${initiator.accessToken}`)
    .send({ username: targetUsername });
  if (res.status !== 201) {
    throw new Error(`createConversation failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.data.conversation_id as string;
}

function makeCiphertext(): string {
  return Buffer.from("AQICAHj9s0Ciao").toString("base64");
}

function makeMessageBody(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    client_message_id: randomUUID(),
    message_type: "text",
    ciphertext: makeCiphertext(),
    ciphertext_type: 1,
    sender_key_id: 42,
    sent_at: new Date().toISOString(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// POST /api/v1/conversations/:conversationId/messages
// ---------------------------------------------------------------------------

describe("POST /api/v1/conversations/:conversationId/messages", () => {
  it("201 — invia messaggio con successo", async () => {
    const alice = await registerUser("alice_msg");
    const bob = await registerUser("bob_msg");
    const convId = await createConversation(alice, bob.username);

    const res = await request(app)
      .post(`/api/v1/conversations/${convId}/messages`)
      .set("Authorization", `Bearer ${alice.accessToken}`)
      .send(makeMessageBody())
      .expect(201);

    expect(res.body.data.id).toBeTruthy();
    expect(res.body.data.sequence_number).toBe(1);
    expect(res.body.data.status).toBe("sent");
    expect(res.body.data.sender_id).toBe(alice.userId);
    expect(res.body.data.conversation_id).toBe(convId);
    expect(res.body.data.server_received_at).toBeTruthy();
    expect(res.body.data.is_new).toBe(true);
  });

  it("200 — idempotenza: stesso client_message_id → stesso messaggio", async () => {
    const alice = await registerUser("alice_idem");
    const bob = await registerUser("bob_idem");
    const convId = await createConversation(alice, bob.username);
    const body = makeMessageBody();

    const r1 = await request(app)
      .post(`/api/v1/conversations/${convId}/messages`)
      .set("Authorization", `Bearer ${alice.accessToken}`)
      .send(body)
      .expect(201);

    const r2 = await request(app)
      .post(`/api/v1/conversations/${convId}/messages`)
      .set("Authorization", `Bearer ${alice.accessToken}`)
      .send(body)
      .expect(200);

    expect(r2.body.data.id).toBe(r1.body.data.id);
    expect(r2.body.data.sequence_number).toBe(r1.body.data.sequence_number);
    expect(r2.body.data.is_new).toBe(false);

    // Il sequence_number non deve incrementarsi per messaggi duplicati
    const count = await MessageModel.countDocuments({});
    expect(count).toBe(1);
  });

  it("sequence_number è monotono crescente", async () => {
    const alice = await registerUser("alice_seq");
    const bob = await registerUser("bob_seq");
    const convId = await createConversation(alice, bob.username);

    const r1 = await request(app)
      .post(`/api/v1/conversations/${convId}/messages`)
      .set("Authorization", `Bearer ${alice.accessToken}`)
      .send(makeMessageBody())
      .expect(201);

    const r2 = await request(app)
      .post(`/api/v1/conversations/${convId}/messages`)
      .set("Authorization", `Bearer ${bob.accessToken}`)
      .send(makeMessageBody())
      .expect(201);

    const r3 = await request(app)
      .post(`/api/v1/conversations/${convId}/messages`)
      .set("Authorization", `Bearer ${alice.accessToken}`)
      .send(makeMessageBody())
      .expect(201);

    expect(r1.body.data.sequence_number).toBe(1);
    expect(r2.body.data.sequence_number).toBe(2);
    expect(r3.body.data.sequence_number).toBe(3);
  });

  it("la conversazione aggiorna last_message_at e last_activity_at", async () => {
    const alice = await registerUser("alice_lastmsg");
    const bob = await registerUser("bob_lastmsg");
    const convId = await createConversation(alice, bob.username);

    const convBefore = await ConversationModel.findById(convId);
    expect(convBefore!.last_message_at).toBeNull();

    await request(app)
      .post(`/api/v1/conversations/${convId}/messages`)
      .set("Authorization", `Bearer ${alice.accessToken}`)
      .send(makeMessageBody())
      .expect(201);

    const convAfter = await ConversationModel.findById(convId);
    expect(convAfter!.last_message_at).toBeTruthy();
    expect(convAfter!.last_message_id).toBeTruthy();
    expect(convAfter!.last_activity_at).toBeTruthy();
  });

  it("ciphertext è opaco al server (accetta qualsiasi base64)", async () => {
    const alice = await registerUser("alice_cipher");
    const bob = await registerUser("bob_cipher");
    const convId = await createConversation(alice, bob.username);

    // Ciphertext opaco — il server non ne conosce il contenuto
    const opaqueCiphertext = Buffer.from("Ciao Luca 👋 questo è cifrato con Signal").toString("base64");

    const res = await request(app)
      .post(`/api/v1/conversations/${convId}/messages`)
      .set("Authorization", `Bearer ${alice.accessToken}`)
      .send(makeMessageBody({ ciphertext: opaqueCiphertext }))
      .expect(201);

    // Il server conserva il ciphertext invariato, senza decodificarlo
    expect(res.body.data.ciphertext).toBe(opaqueCiphertext);
  });

  it("anche bob (membro) può inviare messaggi", async () => {
    const alice = await registerUser("alice_bob_send");
    const bob = await registerUser("bob_bob_send");
    const convId = await createConversation(alice, bob.username);

    const res = await request(app)
      .post(`/api/v1/conversations/${convId}/messages`)
      .set("Authorization", `Bearer ${bob.accessToken}`)
      .send(makeMessageBody())
      .expect(201);

    expect(res.body.data.sender_id).toBe(bob.userId);
    expect(res.body.data.sequence_number).toBe(1);
  });

  it("400 — ciphertext mancante", async () => {
    const alice = await registerUser("alice_bad_body");
    const bob = await registerUser("bob_bad_body");
    const convId = await createConversation(alice, bob.username);

    const res = await request(app)
      .post(`/api/v1/conversations/${convId}/messages`)
      .set("Authorization", `Bearer ${alice.accessToken}`)
      .send(makeMessageBody({ ciphertext: undefined }))
      .expect(400);

    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("400 — client_message_id non è UUID v4", async () => {
    const alice = await registerUser("alice_bad_uuid");
    const bob = await registerUser("bob_bad_uuid");
    const convId = await createConversation(alice, bob.username);

    const res = await request(app)
      .post(`/api/v1/conversations/${convId}/messages`)
      .set("Authorization", `Bearer ${alice.accessToken}`)
      .send(makeMessageBody({ client_message_id: "not-a-uuid" }))
      .expect(400);

    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("401 — richiede autenticazione", async () => {
    const fakeId = new mongoose.Types.ObjectId().toString();
    await request(app)
      .post(`/api/v1/conversations/${fakeId}/messages`)
      .send(makeMessageBody())
      .expect(401);
  });

  it("403 — non membro della conversazione", async () => {
    const alice = await registerUser("alice_403");
    const bob = await registerUser("bob_403");
    const carol = await registerUser("carol_403");
    const convId = await createConversation(alice, bob.username);

    const res = await request(app)
      .post(`/api/v1/conversations/${convId}/messages`)
      .set("Authorization", `Bearer ${carol.accessToken}`)
      .send(makeMessageBody())
      .expect(403);

    expect(res.body.error.code).toBe("NOT_CHAT_MEMBER");
  });

  it("404 — conversazione inesistente", async () => {
    const alice = await registerUser("alice_conv404");
    const fakeId = new mongoose.Types.ObjectId().toString();

    const res = await request(app)
      .post(`/api/v1/conversations/${fakeId}/messages`)
      .set("Authorization", `Bearer ${alice.accessToken}`)
      .send(makeMessageBody())
      .expect(404);

    expect(res.body.error.code).toBe("CHAT_NOT_FOUND");
  });
});

// ---------------------------------------------------------------------------
// GET /api/v1/conversations/:conversationId/messages
// ---------------------------------------------------------------------------

describe("GET /api/v1/conversations/:conversationId/messages", () => {
  it("200 — lista vuota se nessun messaggio", async () => {
    const alice = await registerUser("alice_list_empty");
    const bob = await registerUser("bob_list_empty");
    const convId = await createConversation(alice, bob.username);

    const res = await request(app)
      .get(`/api/v1/conversations/${convId}/messages`)
      .set("Authorization", `Bearer ${alice.accessToken}`)
      .expect(200);

    expect(res.body.data).toEqual([]);
    expect(res.body.pagination.has_more).toBe(false);
  });

  it("200 — messaggi in ordine DESC per sequence_number", async () => {
    const alice = await registerUser("alice_list_order");
    const bob = await registerUser("bob_list_order");
    const convId = await createConversation(alice, bob.username);

    // Invia 3 messaggi
    await request(app)
      .post(`/api/v1/conversations/${convId}/messages`)
      .set("Authorization", `Bearer ${alice.accessToken}`)
      .send(makeMessageBody());
    await request(app)
      .post(`/api/v1/conversations/${convId}/messages`)
      .set("Authorization", `Bearer ${bob.accessToken}`)
      .send(makeMessageBody());
    await request(app)
      .post(`/api/v1/conversations/${convId}/messages`)
      .set("Authorization", `Bearer ${alice.accessToken}`)
      .send(makeMessageBody());

    const res = await request(app)
      .get(`/api/v1/conversations/${convId}/messages`)
      .set("Authorization", `Bearer ${alice.accessToken}`)
      .expect(200);

    expect(res.body.data).toHaveLength(3);
    // DESC: sequenza 3, 2, 1
    expect(res.body.data[0].sequence_number).toBe(3);
    expect(res.body.data[1].sequence_number).toBe(2);
    expect(res.body.data[2].sequence_number).toBe(1);
  });

  it("200 — paginazione: before_sequence filtra correttamente", async () => {
    const alice = await registerUser("alice_page");
    const bob = await registerUser("bob_page");
    const convId = await createConversation(alice, bob.username);

    // Invia 5 messaggi (seq 1-5)
    for (let i = 0; i < 5; i++) {
      await request(app)
        .post(`/api/v1/conversations/${convId}/messages`)
        .set("Authorization", `Bearer ${alice.accessToken}`)
        .send(makeMessageBody());
    }

    // Prendi messaggi prima di seq 4 → 3, 2, 1
    const res = await request(app)
      .get(`/api/v1/conversations/${convId}/messages?before_sequence=4`)
      .set("Authorization", `Bearer ${alice.accessToken}`)
      .expect(200);

    expect(res.body.data).toHaveLength(3);
    expect(res.body.data[0].sequence_number).toBe(3);
    expect(res.body.data[2].sequence_number).toBe(1);
  });

  it("200 — has_more e cursor presenti quando ci sono più messaggi del limit", async () => {
    const alice = await registerUser("alice_cursor");
    const bob = await registerUser("bob_cursor");
    const convId = await createConversation(alice, bob.username);

    // Invia 5 messaggi, poi chiedi limit=3
    for (let i = 0; i < 5; i++) {
      await request(app)
        .post(`/api/v1/conversations/${convId}/messages`)
        .set("Authorization", `Bearer ${alice.accessToken}`)
        .send(makeMessageBody());
    }

    const res = await request(app)
      .get(`/api/v1/conversations/${convId}/messages?limit=3`)
      .set("Authorization", `Bearer ${alice.accessToken}`)
      .expect(200);

    expect(res.body.data).toHaveLength(3);
    expect(res.body.pagination.has_more).toBe(true);
    expect(res.body.pagination.cursor).toBeTruthy();

    // Il cursor è base64 decodificabile e contiene il sequence_number
    const cursorJson = JSON.parse(
      Buffer.from(res.body.pagination.cursor, "base64").toString("utf8"),
    );
    expect(cursorJson.seq).toBeGreaterThan(0);
  });

  it("200 — bob (membro) vede gli stessi messaggi di alice", async () => {
    const alice = await registerUser("alice_bothsee");
    const bob = await registerUser("bob_bothsee");
    const convId = await createConversation(alice, bob.username);

    await request(app)
      .post(`/api/v1/conversations/${convId}/messages`)
      .set("Authorization", `Bearer ${alice.accessToken}`)
      .send(makeMessageBody());

    const aliceRes = await request(app)
      .get(`/api/v1/conversations/${convId}/messages`)
      .set("Authorization", `Bearer ${alice.accessToken}`)
      .expect(200);

    const bobRes = await request(app)
      .get(`/api/v1/conversations/${convId}/messages`)
      .set("Authorization", `Bearer ${bob.accessToken}`)
      .expect(200);

    expect(aliceRes.body.data[0].id).toBe(bobRes.body.data[0].id);
    // Il ciphertext è lo stesso per entrambi (decifrato lato client con chiavi diverse)
    expect(aliceRes.body.data[0].ciphertext).toBe(bobRes.body.data[0].ciphertext);
  });

  it("401 — richiede autenticazione", async () => {
    const fakeId = new mongoose.Types.ObjectId().toString();
    await request(app)
      .get(`/api/v1/conversations/${fakeId}/messages`)
      .expect(401);
  });

  it("403 — non membro della conversazione", async () => {
    const alice = await registerUser("alice_forbid");
    const bob = await registerUser("bob_forbid");
    const carol = await registerUser("carol_forbid");
    const convId = await createConversation(alice, bob.username);

    const res = await request(app)
      .get(`/api/v1/conversations/${convId}/messages`)
      .set("Authorization", `Bearer ${carol.accessToken}`)
      .expect(403);

    expect(res.body.error.code).toBe("NOT_CHAT_MEMBER");
  });

  it("404 — conversazione inesistente", async () => {
    const alice = await registerUser("alice_404msgs");
    const fakeId = new mongoose.Types.ObjectId().toString();

    const res = await request(app)
      .get(`/api/v1/conversations/${fakeId}/messages`)
      .set("Authorization", `Bearer ${alice.accessToken}`)
      .expect(404);

    expect(res.body.error.code).toBe("CHAT_NOT_FOUND");
  });
});
