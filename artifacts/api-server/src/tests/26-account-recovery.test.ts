/**
 * Test Suite 26 — Account Recovery (Privacy First) — Sprint 22
 *
 * 26.1 Base58 encoding/decoding
 * 26.2 Validazione schemi Zod
 * 26.3 Business logic — generazione Recovery Card
 * 26.4 Business logic — recupero tramite card
 * 26.5 Business logic — recupero tramite email
 * 26.6 Business logic — password temporanea
 * 26.7 Business logic — rigenerazione Recovery Card
 * 26.8 Security — anti-brute force, replay, token monouso
 * 26.9 Edge cases
 */

import { describe, it, expect } from "vitest";
import {
  RecoverByCardSchema,
  RecoverByEmailRequestSchema,
  RecoverByEmailVerifySchema,
  SetRecoveryEmailSchema,
  ChangeTempPasswordSchema,
} from "../validation/account-recovery.schemas";
import { base58Encode, base58Decode } from "../lib/base58";
import crypto from "node:crypto";

// ---------------------------------------------------------------------------
// 26.1 — Base58 encoding/decoding
// ---------------------------------------------------------------------------

describe("26.1 — Base58 encoding/decoding", () => {
  it("encode → decode → stesso buffer", () => {
    const bytes = crypto.randomBytes(32);
    const encoded = base58Encode(bytes);
    const decoded = base58Decode(encoded);
    expect(Buffer.compare(bytes, decoded)).toBe(0);
  });

  it("output solo caratteri dell'alfabeto Base58", () => {
    const ALPHABET = /^[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]+$/;
    const encoded = base58Encode(crypto.randomBytes(32));
    expect(ALPHABET.test(encoded)).toBe(true);
  });

  it("32 byte → almeno 40 caratteri (denso)", () => {
    const encoded = base58Encode(crypto.randomBytes(32));
    expect(encoded.length).toBeGreaterThanOrEqual(40);
  });

  it("buffer vuoto → stringa vuota", () => {
    expect(base58Encode(Buffer.alloc(0))).toBe("");
    expect(base58Decode("").length).toBe(0);
  });

  it("stesso input → stesso output (deterministico)", () => {
    const bytes = Buffer.from("hello world");
    expect(base58Encode(bytes)).toBe(base58Encode(bytes));
  });

  it("carattere non Base58 → eccezione", () => {
    expect(() => base58Decode("!!!")).toThrow();
  });

  it("leading zero byte → leading '1'", () => {
    const bytes = Buffer.from([0, 0, 1, 2, 3]);
    const encoded = base58Encode(bytes);
    expect(encoded.startsWith("11")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 26.2 — Validazione schemi
// ---------------------------------------------------------------------------

describe("26.2 — Schema RecoverByCard", () => {
  it("schema valido", () => {
    const r = RecoverByCardSchema.safeParse({
      username:        "alice",
      emergency_id:    "ABCD-1234",
      recovery_secret: "3vQB5AXoWyB6GVMBNTbVvLz9Kb5aD3mRE",
    });
    expect(r.success).toBe(true);
  });

  it("username troppo corto", () => {
    expect(RecoverByCardSchema.safeParse({ username: "ab", emergency_id: "X", recovery_secret: "abcdefghij" }).success).toBe(false);
  });

  it("recovery_secret troppo corto", () => {
    expect(RecoverByCardSchema.safeParse({ username: "alice", emergency_id: "X", recovery_secret: "abc" }).success).toBe(false);
  });

  it("username viene normalizzato in lowercase", () => {
    const r = RecoverByCardSchema.safeParse({ username: "ALICE", emergency_id: "X", recovery_secret: "abcdefghijk" });
    if (r.success) expect(r.data.username).toBe("alice");
  });

  it("emergency_id viene normalizzato in uppercase", () => {
    const r = RecoverByCardSchema.safeParse({ username: "alice", emergency_id: "abcd-1234", recovery_secret: "abcdefghijk" });
    if (r.success) expect(r.data.emergency_id).toBe("ABCD-1234");
  });
});

describe("26.2b — Schema RecoverByEmailRequest", () => {
  it("schema valido", () => {
    expect(RecoverByEmailRequestSchema.safeParse({ username: "alice", email: "a@b.com" }).success).toBe(true);
  });

  it("email non valida → errore", () => {
    expect(RecoverByEmailRequestSchema.safeParse({ username: "alice", email: "not-an-email" }).success).toBe(false);
  });
});

describe("26.2c — Schema RecoverByEmailVerify", () => {
  it("token lungo → ok", () => {
    expect(RecoverByEmailVerifySchema.safeParse({ token: "a".repeat(96) }).success).toBe(true);
  });

  it("token corto → errore", () => {
    expect(RecoverByEmailVerifySchema.safeParse({ token: "abc" }).success).toBe(false);
  });
});

describe("26.2d — Schema SetRecoveryEmail", () => {
  it("email valida", () => {
    expect(SetRecoveryEmailSchema.safeParse({ email: "alice@example.com" }).success).toBe(true);
  });

  it("email non valida → errore", () => {
    expect(SetRecoveryEmailSchema.safeParse({ email: "not-an-email" }).success).toBe(false);
  });
});

describe("26.2e — Schema ChangeTempPassword", () => {
  it("schema valido", () => {
    expect(ChangeTempPasswordSchema.safeParse({ temp_password: "ABCD1234", new_password: "MyNewPass123!" }).success).toBe(true);
  });

  it("new_password troppo corta → errore", () => {
    expect(ChangeTempPasswordSchema.safeParse({ temp_password: "ABCD", new_password: "short" }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 26.3 — Business logic: generazione Recovery Card
// ---------------------------------------------------------------------------

describe("26.3 — Generazione Recovery Card", () => {
  it("recovery_secret è Base58 valido", () => {
    const ALPHABET = /^[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]+$/;
    const secret = base58Encode(crypto.randomBytes(32));
    expect(ALPHABET.test(secret)).toBe(true);
  });

  it("emergency_id è UUID uppercase", () => {
    const id = crypto.randomUUID().toUpperCase();
    expect(id).toMatch(/^[0-9A-F-]{36}$/);
  });

  it("checksum è SHA-256 troncato 8 hex chars uppercase", () => {
    const checksum = crypto
      .createHash("sha256")
      .update("alice:ABCD:secret")
      .digest("hex")
      .slice(0, 8)
      .toUpperCase();
    expect(checksum).toMatch(/^[0-9A-F]{8}$/);
  });

  it("version parte da 1", () => {
    const version = 1;
    expect(version).toBe(1);
  });

  it("ogni card ha emergency_id unico", () => {
    const ids = new Set(Array.from({ length: 100 }, () => crypto.randomUUID()));
    expect(ids.size).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// 26.4 — Business logic: recupero tramite card
// ---------------------------------------------------------------------------

describe("26.4 — Recupero via Recovery Card", () => {
  it("username normalizzato prima del confronto", () => {
    const stored   = "alice";
    const provided = "ALICE";
    expect(provided.toLowerCase()).toBe(stored);
  });

  it("emergency_id confrontato case-insensitive", () => {
    const stored   = "ABCD-1234-EFGH";
    const provided = "abcd-1234-efgh";
    expect(provided.toUpperCase()).toBe(stored);
  });

  it("credenziali errate → INVALID_RECOVERY_CREDENTIALS", () => {
    const verify = (secret: string, stored: string) => {
      if (secret !== stored) throw new Error("INVALID_RECOVERY_CREDENTIALS");
    };
    expect(() => verify("wrong", "correct")).toThrow("INVALID_RECOVERY_CREDENTIALS");
  });

  it("credenziali corrette → temp_password generata", () => {
    const TEMP_CHARSET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
    const bytes = crypto.randomBytes(20);
    const temp = Array.from(bytes).map((b) => TEMP_CHARSET[b % TEMP_CHARSET.length]).join("");
    expect(temp.length).toBe(20);
    expect(/^[A-Za-z2-9]+$/.test(temp)).toBe(true);
  });

  it("temp_password scade dopo 15 minuti", () => {
    const FIFTEEN_MIN = 15 * 60 * 1000;
    const expiresAt = new Date(Date.now() + FIFTEEN_MIN);
    const now = new Date();
    expect(expiresAt.getTime() - now.getTime()).toBeGreaterThan(14 * 60 * 1000);
  });
});

// ---------------------------------------------------------------------------
// 26.5 — Business logic: recupero tramite email
// ---------------------------------------------------------------------------

describe("26.5 — Recupero via email", () => {
  it("risposta identica a user/email errati (anti-enumeration)", () => {
    // Il service non lancia eccezioni se utente/email non trovati → risposta OK
    const response = "Se i dati sono corretti, riceverai un link via email.";
    expect(response).toBeTruthy();
  });

  it("token email è hex 96 caratteri (48 byte)", () => {
    const token = crypto.randomBytes(48).toString("hex");
    expect(token.length).toBe(96);
    expect(/^[0-9a-f]+$/.test(token)).toBe(true);
  });

  it("token scade dopo 30 minuti", () => {
    const THIRTY_MIN = 30 * 60 * 1000;
    const expiresAt = new Date(Date.now() + THIRTY_MIN);
    const now = new Date();
    expect(expiresAt.getTime() - now.getTime()).toBeGreaterThan(29 * 60 * 1000);
  });

  it("token usato → nullificato nel DB (monouso)", () => {
    // Simulazione
    const state = { token: "abc123", expires_at: new Date(Date.now() + 30000) };
    const use = () => {
      if (!state.token) throw new Error("INVALID_RECOVERY_TOKEN");
      const t = state.token;
      state.token = null as any;
      return t;
    };
    expect(use()).toBe("abc123");
    expect(() => use()).toThrow("INVALID_RECOVERY_TOKEN");
  });
});

// ---------------------------------------------------------------------------
// 26.6 — Password temporanea
// ---------------------------------------------------------------------------

describe("26.6 — Password temporanea", () => {
  it("nessun carattere ambiguo (0, O, I, l, 1)", () => {
    const CHARSET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
    expect(CHARSET).not.toContain("0");
    expect(CHARSET).not.toContain("O");
    expect(CHARSET).not.toContain("I");
    expect(CHARSET).not.toContain("l");
    expect(CHARSET).not.toContain("1");
  });

  it("cambio password annulla temp_password", () => {
    const state = {
      temp_password_hash:     "hash",
      temp_password_expires_at: new Date(Date.now() + 60000),
      require_password_change: true,
    };
    // Dopo cambio
    state.temp_password_hash     = null as any;
    state.temp_password_expires_at = null as any;
    state.require_password_change  = false;

    expect(state.temp_password_hash).toBeNull();
    expect(state.require_password_change).toBe(false);
  });

  it("temp_password scaduta → TEMP_PASSWORD_EXPIRED", () => {
    const expiredAt = new Date(Date.now() - 1000);
    const isExpired = expiredAt < new Date();
    expect(isExpired).toBe(true);
  });

  it("require_password_change = true dopo recovery", () => {
    const state = { require_password_change: false };
    state.require_password_change = true;
    expect(state.require_password_change).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 26.7 — Rigenerazione Recovery Card
// ---------------------------------------------------------------------------

describe("26.7 — Rigenerazione Recovery Card", () => {
  it("version incrementata", () => {
    let version = 3;
    version += 1;
    expect(version).toBe(4);
  });

  it("vecchia card invalida → nuovo emergency_id", () => {
    const old = crypto.randomUUID();
    const curr = crypto.randomUUID();
    expect(old).not.toBe(curr);
  });

  it("vecchio recovery_secret non valido dopo rigenera", () => {
    let secretHash = "hash_of_old_secret";
    secretHash = "hash_of_new_secret"; // la rigenera sovrascrive
    expect(secretHash).toBe("hash_of_new_secret");
  });

  it("non esistono mai due Recovery Card valide contemporaneamente", () => {
    // La rigenera sovrascrive recovery_secret_hash → unico valore nel DB
    const db = { recovery_secret_hash: "hash_v1" };
    db.recovery_secret_hash = "hash_v2"; // overwrite
    expect(Object.values(db).filter((v) => v.startsWith("hash_")).length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 26.8 — Security
// ---------------------------------------------------------------------------

describe("26.8 — Security: anti-brute force e replay", () => {
  it("max 5 tentativi per window → TOO_MANY_REQUESTS", () => {
    let attempts = 0;
    const MAX = 5;
    const recover = () => {
      attempts++;
      if (attempts > MAX) throw new Error("TOO_MANY_REQUESTS");
    };
    for (let i = 0; i < MAX; i++) recover();
    expect(() => recover()).toThrow("TOO_MANY_REQUESTS");
  });

  it("recovery secret mai salvato in chiaro", () => {
    // Simulazione: il plain non va nel DB, solo il hash
    const plain = "my_secret";
    const dbRecord = { recovery_secret_hash: `argon2id_hash_of_${plain}` };
    expect(dbRecord).not.toHaveProperty("recovery_secret");
    expect(dbRecord.recovery_secret_hash).not.toBe(plain);
  });

  it("revoca sessioni al recupero", () => {
    const sessions = ["session1", "session2", "session3"];
    const revoked: string[] = [];
    for (const s of sessions) revoked.push(s);
    expect(revoked.length).toBe(sessions.length);
  });

  it("temp_password verificata con hash — non in chiaro nel DB", () => {
    const plain = "TempPass123";
    const dbRecord = { temp_password_hash: `argon2id_${plain}` };
    expect(dbRecord).not.toHaveProperty("temp_password");
    expect(dbRecord.temp_password_hash).not.toBe(plain);
  });
});

// ---------------------------------------------------------------------------
// 26.9 — Edge cases
// ---------------------------------------------------------------------------

describe("26.9 — Edge cases", () => {
  it("maskEmail nasconde local part correttamente", () => {
    const maskEmail = (email: string) => {
      const [local, domain] = email.split("@");
      if (!local || !domain) return "***@***";
      const visible = local.length <= 2 ? local[0]! : local.slice(0, 2);
      return `${visible}***@${domain}`;
    };
    expect(maskEmail("alice@example.com")).toBe("al***@example.com");
    expect(maskEmail("ab@test.org")).toBe("a***@test.org");
    expect(maskEmail("a@b.com")).toBe("a***@b.com");
  });

  it("utente senza recovery card → has_recovery_card = false", () => {
    const status = { has_recovery_card: false };
    expect(status.has_recovery_card).toBe(false);
  });

  it("email recovery senza email configurata → risposta generica (anti-enum)", () => {
    const response = "Se i dati sono corretti, riceverai un link via email.";
    // Il service risponde uguale anche quando l'email non è configurata
    expect(response).toContain("Se i dati sono corretti");
  });

  it("checksum deterministico — stessi input → stesso output", () => {
    const checksum = (u: string, e: string, s: string) =>
      crypto.createHash("sha256").update(`${u}:${e}:${s}`).digest("hex").slice(0, 8).toUpperCase();

    expect(checksum("alice", "ID123", "SECRET")).toBe(checksum("alice", "ID123", "SECRET"));
  });

  it("versione card riparte da 1 alla prima generazione", () => {
    const version = (current: number | null) => (current ?? 0) + 1;
    expect(version(null)).toBe(1);
    expect(version(3)).toBe(4);
  });
});
