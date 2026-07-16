/**
 * Test Suite 27 — Temp Password Login & Forced Change
 * Sprint 22 completion
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import mongoose from "mongoose";
import app from "../app";
import { UserModel } from "../models/user.model";
import { hashPassword } from "../services/password.service";

let userId: string;
let tempPassword: string;
let accessToken: string;
let deviceId: string;

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeAll(async () => {
  await mongoose.connect(process.env["MONGODB_URI"]!);

  // Crea un utente diretto in DB con temp_password impostata
  tempPassword = "TempPass!abc123";
  deviceId = crypto.randomUUID();

  const tempHash = await hashPassword(tempPassword);
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

  const user = await UserModel.create({
    username:                  `temptest_${Date.now()}`,
    display_name:              "Temp Test User",
    password_hash:             await hashPassword("OriginalPass!456"),
    temp_password_hash:        tempHash,
    temp_password_expires_at:  expiresAt,
    require_password_change:   true,
    status:                    "active",
  });
  userId = user._id.toString();
});

afterAll(async () => {
  if (userId) await UserModel.findByIdAndDelete(userId);
  await mongoose.disconnect();
});

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

async function getUsername() {
  const user = await UserModel.findById(userId).select("username").lean();
  return user!.username;
}

// ---------------------------------------------------------------------------
// Suite 27.1 — Login con password temporanea
// ---------------------------------------------------------------------------

describe("27.1 — Login con password temporanea", () => {
  it("login con password temporanea restituisce require_password_change=true", async () => {
    const username = await getUsername();
    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({ identifier: username, password: tempPassword, device_id: deviceId, device_name: "test", device_type: "web" });

    expect(res.status).toBe(200);
    expect(res.body.data.require_password_change).toBe(true);
    expect(res.body.data.tokens.access_token).toBeTruthy();
    accessToken = res.body.data.tokens.access_token;
  });

  it("login con password principale restituisce require_password_change=true (flag DB)", async () => {
    const username = await getUsername();
    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({ identifier: username, password: "OriginalPass!456", device_id: deviceId, device_name: "test", device_type: "web" });

    expect(res.status).toBe(200);
    // require_password_change è true perché il flag è nel DB
    expect(res.body.data.require_password_change).toBe(true);
  });

  it("login con password sbagliata restituisce 401", async () => {
    const username = await getUsername();
    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({ identifier: username, password: "wrongpassword", device_id: deviceId, device_name: "test", device_type: "web" });
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Suite 27.2 — Cambio password obbligatorio
// ---------------------------------------------------------------------------

describe("27.2 — Cambio password obbligatorio", () => {
  it("cambia password con current_password errata → 400", async () => {
    const res = await request(app)
      .post("/api/v1/auth/change-temporary-password")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ current_password: "wrong", new_password: "NuovaPassword!789", confirm_password: "NuovaPassword!789" });
    expect(res.status).toBe(400);
  });

  it("cambia password con confirm_password non coincidente → 400", async () => {
    const res = await request(app)
      .post("/api/v1/auth/change-temporary-password")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ current_password: tempPassword, new_password: "NuovaPassword!789", confirm_password: "Diversa!789" });
    expect(res.status).toBe(400);
  });

  it("cambia password con new_password troppo corta → 400", async () => {
    const res = await request(app)
      .post("/api/v1/auth/change-temporary-password")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ current_password: tempPassword, new_password: "short", confirm_password: "short" });
    expect(res.status).toBe(400);
  });

  it("cambia password correttamente → 200", async () => {
    const res = await request(app)
      .post("/api/v1/auth/change-temporary-password")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ current_password: tempPassword, new_password: "NuovaPassword!789xyz", confirm_password: "NuovaPassword!789xyz" });
    expect(res.status).toBe(200);
  });

  it("dopo il cambio require_password_change è false nel DB", async () => {
    const user = await UserModel.findById(userId).lean();
    expect(user!.require_password_change).toBe(false);
    expect(user!.temp_password_hash).toBeNull();
    expect(user!.temp_password_expires_at).toBeNull();
  });

  it("login con nuova password restituisce require_password_change=false", async () => {
    const username = await getUsername();
    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({ identifier: username, password: "NuovaPassword!789xyz", device_id: deviceId, device_name: "test", device_type: "web" });
    expect(res.status).toBe(200);
    expect(res.body.data.require_password_change).toBe(false);
  });

  it("login con vecchia password temporanea fallisce dopo il cambio", async () => {
    const username = await getUsername();
    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({ identifier: username, password: tempPassword, device_id: deviceId, device_name: "test", device_type: "web" });
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Suite 27.3 — Password temporanea scaduta
// ---------------------------------------------------------------------------

describe("27.3 — Password temporanea scaduta", () => {
  let expiredUserId: string;
  let expiredToken: string;

  beforeAll(async () => {
    const expiredHash = await hashPassword("ExpiredTemp!123");
    const user = await UserModel.create({
      username:                 `expiredtest_${Date.now()}`,
      display_name:             "Expired Test User",
      password_hash:            await hashPassword("MainPass!789"),
      temp_password_hash:       expiredHash,
      temp_password_expires_at: new Date(Date.now() - 1000), // già scaduta
      require_password_change:  true,
      status:                   "active",
    });
    expiredUserId = user._id.toString();

    // Ottieni token con la password principale
    const loginRes = await request(app)
      .post("/api/v1/auth/login")
      .send({ identifier: user.username, password: "MainPass!789", device_id: crypto.randomUUID(), device_name: "test", device_type: "web" });
    expiredToken = loginRes.body.data.tokens.access_token;
  });

  afterAll(async () => {
    if (expiredUserId) await UserModel.findByIdAndDelete(expiredUserId);
  });

  it("login con temp password scaduta → 401", async () => {
    const user = await UserModel.findById(expiredUserId).lean();
    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({ identifier: user!.username, password: "ExpiredTemp!123", device_id: crypto.randomUUID(), device_name: "test", device_type: "web" });
    expect(res.status).toBe(401);
  });

  it("changeTempPassword con temp password scaduta → 400 TEMP_PASSWORD_EXPIRED", async () => {
    const res = await request(app)
      .post("/api/v1/auth/change-temporary-password")
      .set("Authorization", `Bearer ${expiredToken}`)
      .send({ current_password: "ExpiredTemp!123", new_password: "NuovaPass!987654", confirm_password: "NuovaPass!987654" });
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Suite 27.4 — Senza autenticazione
// ---------------------------------------------------------------------------

describe("27.4 — Endpoint protetto senza JWT", () => {
  it("change-temporary-password senza token → 401", async () => {
    const res = await request(app)
      .post("/api/v1/auth/change-temporary-password")
      .send({ current_password: "anything", new_password: "NuovaPassword!789xyz", confirm_password: "NuovaPassword!789xyz" });
    expect(res.status).toBe(401);
  });
});
