/**
 * Integration test — Alpha Wallet Recipient Discovery (Task #93)
 *
 * Testa i due nuovi endpoint:
 *   POST /api/v1/alpha-wallet/register-address
 *   GET  /api/v1/alpha-wallet/recipient/:userId
 *
 * Copertura (spec §13):
 *   Backend:
 *     1. destinatario con Alpha Wallet
 *     2. destinatario senza Alpha Wallet
 *     3. 403 se gli utenti non condividono una conversazione
 *     4. autenticazione obbligatoria (401)
 *     5. EVM address valido
 *     6. BTC address valido
 *     7. nessun dato privato nella response
 *     8. userId arbitrario non accessibile
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import request from "supertest";
import app from "../app";
import { UserModel } from "../models/user.model";
import { ConversationModel } from "../models/conversation.model";
import { ConversationMemberModel } from "../models/conversation-member.model";
import { signAccessToken } from "../services/jwt.service";

// ─── DB in-memory ─────────────────────────────────────────────────────────

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
  await Promise.all([
    UserModel.deleteMany({}),
    ConversationModel.deleteMany({}),
    ConversationMemberModel.deleteMany({}),
  ]);
});

// ─── Helpers ──────────────────────────────────────────────────────────────

async function createUser(username: string) {
  const user = await UserModel.create({
    username,
    display_name: username,
    password_hash: "hash",
    status: "active",
  });
  const { token } = await signAccessToken({
    userId: user._id.toString(),
    deviceId: "test-device",
  });
  return { user, token };
}

async function createConversation(userA: mongoose.Types.ObjectId, userB: mongoose.Types.ObjectId) {
  const conv = await ConversationModel.create({ type: "direct" });
  await ConversationMemberModel.create([
    { conversation_id: conv._id, user_id: userA },
    { conversation_id: conv._id, user_id: userB },
  ]);
  return conv;
}

const VALID_EVM  = "0x1234567890abcdef1234567890abcdef12345678";
const VALID_BTC  = "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq";

// ─── POST /register-address ────────────────────────────────────────────────

describe("POST /api/v1/alpha-wallet/register-address", () => {

  // Test 4: autenticazione obbligatoria
  it("401 senza token", async () => {
    const res = await request(app)
      .post("/api/v1/alpha-wallet/register-address")
      .send({ evmAddress: VALID_EVM });
    expect(res.status).toBe(401);
  });

  // Test 5: EVM address valido
  it("200 — salva EVM address valido", async () => {
    const { user, token } = await createUser("alice");

    const res = await request(app)
      .post("/api/v1/alpha-wallet/register-address")
      .set("Authorization", `Bearer ${token}`)
      .send({ evmAddress: VALID_EVM });

    expect(res.status).toBe(200);
    expect(res.body.data.ok).toBe(true);

    const updated = await UserModel.findById(user._id).lean();
    expect(updated?.alpha_wallet_evm_address).toBe(VALID_EVM);
  });

  // Test 6: BTC address valido
  it("200 — salva EVM + BTC address validi", async () => {
    const { user, token } = await createUser("alice2");

    const res = await request(app)
      .post("/api/v1/alpha-wallet/register-address")
      .set("Authorization", `Bearer ${token}`)
      .send({ evmAddress: VALID_EVM, btcAddress: VALID_BTC });

    expect(res.status).toBe(200);

    const updated = await UserModel.findById(user._id).lean();
    expect(updated?.alpha_wallet_evm_address).toBe(VALID_EVM);
    expect(updated?.alpha_wallet_btc_address).toBe(VALID_BTC);
  });

  it("400 — EVM address non valido (manca 0x)", async () => {
    const { token } = await createUser("alice3");
    const res = await request(app)
      .post("/api/v1/alpha-wallet/register-address")
      .set("Authorization", `Bearer ${token}`)
      .send({ evmAddress: "1234567890abcdef1234567890abcdef12345678" });
    expect(res.status).toBe(400);
  });

  it("400 — BTC address non valido", async () => {
    const { token } = await createUser("alice4");
    const res = await request(app)
      .post("/api/v1/alpha-wallet/register-address")
      .set("Authorization", `Bearer ${token}`)
      .send({ evmAddress: VALID_EVM, btcAddress: "not-a-btc-address" });
    expect(res.status).toBe(400);
  });

  it("400 — evmAddress mancante", async () => {
    const { token } = await createUser("alice5");
    const res = await request(app)
      .post("/api/v1/alpha-wallet/register-address")
      .set("Authorization", `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(400);
  });
});

// ─── GET /recipient/:userId ────────────────────────────────────────────────

describe("GET /api/v1/alpha-wallet/recipient/:userId", () => {

  // Test 4: autenticazione obbligatoria
  it("401 senza token", async () => {
    const { user: bob } = await createUser("bob");
    const res = await request(app)
      .get(`/api/v1/alpha-wallet/recipient/${bob._id}`);
    expect(res.status).toBe(401);
  });

  // Test 1: destinatario con Alpha Wallet
  it("200 — restituisce hasAlphaWallet=true e address quando configurato", async () => {
    const { user: alice, token: aliceToken } = await createUser("alice");
    const { user: bob, token: _bobToken }    = await createUser("bob");

    // Bob ha Alpha Wallet
    await UserModel.updateOne(
      { _id: bob._id },
      { $set: { alpha_wallet_evm_address: VALID_EVM, alpha_wallet_btc_address: VALID_BTC } },
    );

    // Conversazione condivisa Alice ↔ Bob
    await createConversation(alice._id, bob._id);

    const res = await request(app)
      .get(`/api/v1/alpha-wallet/recipient/${bob._id}`)
      .set("Authorization", `Bearer ${aliceToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.hasAlphaWallet).toBe(true);
    expect(res.body.data.evmAddress).toBe(VALID_EVM);
    expect(res.body.data.btcAddress).toBe(VALID_BTC);
  });

  // Test 2: destinatario senza Alpha Wallet
  it("200 — restituisce hasAlphaWallet=false quando non configurato", async () => {
    const { user: alice, token: aliceToken } = await createUser("alice2");
    const { user: bob }                       = await createUser("bob2");

    // Bob NON ha Alpha Wallet
    await createConversation(alice._id, bob._id);

    const res = await request(app)
      .get(`/api/v1/alpha-wallet/recipient/${bob._id}`)
      .set("Authorization", `Bearer ${aliceToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.hasAlphaWallet).toBe(false);
    // address non presenti nella risposta
    expect(res.body.data.evmAddress).toBeUndefined();
    expect(res.body.data.btcAddress).toBeUndefined();
  });

  // Test 3: 403 se non condividono conversazione
  it("403 — nessuna conversazione condivisa", async () => {
    const { user: alice, token: aliceToken } = await createUser("alice3");
    const { user: charlie }                  = await createUser("charlie");

    // Nessuna conversazione tra Alice e Charlie

    const res = await request(app)
      .get(`/api/v1/alpha-wallet/recipient/${charlie._id}`)
      .set("Authorization", `Bearer ${aliceToken}`);

    expect(res.status).toBe(403);
  });

  // Test 8: userId arbitrario non accessibile
  it("403 — non accessibile anche se l'utente esiste ma non c'è conversazione", async () => {
    const { token: aliceToken } = await createUser("alice4");
    const { user: stranger }    = await createUser("stranger");

    const res = await request(app)
      .get(`/api/v1/alpha-wallet/recipient/${stranger._id}`)
      .set("Authorization", `Bearer ${aliceToken}`);

    expect(res.status).toBe(403);
  });

  // Test 7: nessun dato privato nella response
  it("200 — response non contiene dati privati (seed, PIN, keystore, password_hash)", async () => {
    const { user: alice, token: aliceToken } = await createUser("alice5");
    const { user: bob }                       = await createUser("bob5");

    await UserModel.updateOne(
      { _id: bob._id },
      { $set: { alpha_wallet_evm_address: VALID_EVM } },
    );
    await createConversation(alice._id, bob._id);

    const res = await request(app)
      .get(`/api/v1/alpha-wallet/recipient/${bob._id}`)
      .set("Authorization", `Bearer ${aliceToken}`);

    expect(res.status).toBe(200);
    const body = JSON.stringify(res.body);
    // Nessun campo sensibile
    expect(body).not.toContain("password_hash");
    expect(body).not.toContain("seed");
    expect(body).not.toContain("mnemonic");
    expect(body).not.toContain("private");
    expect(body).not.toContain("keystore");
    expect(body).not.toContain("pin");
    expect(body).not.toContain("email");
    expect(body).not.toContain("totp_secret");
  });

  it("400 — userId non valido (non è ObjectId)", async () => {
    const { token } = await createUser("alice6");
    const res = await request(app)
      .get("/api/v1/alpha-wallet/recipient/not-an-objectid")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(400);
  });

  it("400 — non può interrogare se stesso", async () => {
    const { user: alice, token: aliceToken } = await createUser("alice7");
    const res = await request(app)
      .get(`/api/v1/alpha-wallet/recipient/${alice._id}`)
      .set("Authorization", `Bearer ${aliceToken}`);
    expect(res.status).toBe(400);
  });

  it("403 — utente con conversazione da cui è uscito non può accedere", async () => {
    const { user: alice, token: aliceToken } = await createUser("alice8");
    const { user: bob }                       = await createUser("bob8");

    // Alice ha lasciato la conversazione (left_at impostato)
    const conv = await ConversationModel.create({ type: "direct" });
    await ConversationMemberModel.create([
      { conversation_id: conv._id, user_id: alice._id, left_at: new Date() }, // Alice ha lasciato
      { conversation_id: conv._id, user_id: bob._id },
    ]);

    const res = await request(app)
      .get(`/api/v1/alpha-wallet/recipient/${bob._id}`)
      .set("Authorization", `Bearer ${aliceToken}`);

    expect(res.status).toBe(403);
  });
});
