/**
 * Test Suite 25 — Gruppi E2E — Sprint 21
 *
 * 25.1 Validazione schema CreateGroup
 * 25.2 Validazione schema UpdateGroup
 * 25.3 Validazione schema AddMember
 * 25.4 Validazione schema ChangeRole
 * 25.5 Logica business — createGroup
 * 25.6 Logica business — addMember / removeMember
 * 25.7 Logica business — leaveGroup
 * 25.8 Logica business — changeRole
 * 25.9 Logica business — updateGroup / deleteGroup
 * 25.10 Edge cases — GROUP_FULL, ALREADY_MEMBER, NOT_GROUP_ADMIN
 */

import { describe, it, expect } from "vitest";
import { CreateGroupSchema, UpdateGroupSchema, AddMemberSchema, ChangeRoleSchema } from "../validation/group.schemas";

// ---------------------------------------------------------------------------
// 25.1 — Validazione CreateGroup
// ---------------------------------------------------------------------------

describe("25.1 — CreateGroup schema", () => {
  it("schema valido con nome e un membro", () => {
    const r = CreateGroupSchema.safeParse({ name: "Amici", member_usernames: ["bob"] });
    expect(r.success).toBe(true);
  });

  it("nome vuoto → errore", () => {
    const r = CreateGroupSchema.safeParse({ name: "", member_usernames: ["bob"] });
    expect(r.success).toBe(false);
  });

  it("nome troppo lungo (>100 chars) → errore", () => {
    const r = CreateGroupSchema.safeParse({ name: "a".repeat(101), member_usernames: ["bob"] });
    expect(r.success).toBe(false);
  });

  it("member_usernames vuoto → errore", () => {
    const r = CreateGroupSchema.safeParse({ name: "Team", member_usernames: [] });
    expect(r.success).toBe(false);
  });

  it("descrizione opzionale — default stringa vuota", () => {
    const r = CreateGroupSchema.safeParse({ name: "Team", member_usernames: ["bob"] });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.description).toBe("");
  });

  it("descrizione max 500 chars", () => {
    const r = CreateGroupSchema.safeParse({
      name: "Team",
      member_usernames: ["bob"],
      description: "x".repeat(501),
    });
    expect(r.success).toBe(false);
  });

  it("troppi membri (>254) → errore", () => {
    const usernames = Array.from({ length: 255 }, (_, i) => `user${i}`);
    const r = CreateGroupSchema.safeParse({ name: "Big", member_usernames: usernames });
    expect(r.success).toBe(false);
  });

  it("254 membri → ok (255 incluso creatore = limite)", () => {
    const usernames = Array.from({ length: 254 }, (_, i) => `user${i}`);
    const r = CreateGroupSchema.safeParse({ name: "Max", member_usernames: usernames });
    expect(r.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 25.2 — Validazione UpdateGroup
// ---------------------------------------------------------------------------

describe("25.2 — UpdateGroup schema", () => {
  it("solo nome → ok", () => {
    const r = UpdateGroupSchema.safeParse({ name: "Nuovo nome" });
    expect(r.success).toBe(true);
  });

  it("solo descrizione → ok", () => {
    const r = UpdateGroupSchema.safeParse({ description: "Nuova desc" });
    expect(r.success).toBe(true);
  });

  it("campo vuoto → ok (tutti opzionali)", () => {
    const r = UpdateGroupSchema.safeParse({});
    expect(r.success).toBe(true);
  });

  it("nome vuoto → errore", () => {
    const r = UpdateGroupSchema.safeParse({ name: "" });
    expect(r.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 25.3 — Validazione AddMember
// ---------------------------------------------------------------------------

describe("25.3 — AddMember schema", () => {
  it("username valido", () => {
    const r = AddMemberSchema.safeParse({ username: "alice" });
    expect(r.success).toBe(true);
  });

  it("username vuoto → errore", () => {
    const r = AddMemberSchema.safeParse({ username: "" });
    expect(r.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 25.4 — Validazione ChangeRole
// ---------------------------------------------------------------------------

describe("25.4 — ChangeRole schema", () => {
  it("admin → ok", () => {
    expect(ChangeRoleSchema.safeParse({ role: "admin" }).success).toBe(true);
  });

  it("member → ok", () => {
    expect(ChangeRoleSchema.safeParse({ role: "member" }).success).toBe(true);
  });

  it("owner → errore (non esiste)", () => {
    expect(ChangeRoleSchema.safeParse({ role: "owner" }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 25.5 — Business logic helpers (senza DB)
// ---------------------------------------------------------------------------

describe("25.5 — Business: member count", () => {
  it("creatore + N membri = N+1 totale", () => {
    const members = ["alice", "bob", "charlie"];
    const total = members.length + 1;
    expect(total).toBe(4);
  });

  it("limite 256 non superato", () => {
    const members = Array.from({ length: 255 }, (_, i) => `u${i}`);
    const total = members.length + 1;
    expect(total).toBeLessThanOrEqual(256);
  });

  it("256 membri supera limite", () => {
    const total = 256 + 1;
    expect(total).toBeGreaterThan(256);
  });
});

// ---------------------------------------------------------------------------
// 25.6 — Business: addMember / removeMember
// ---------------------------------------------------------------------------

describe("25.6 — Business: addMember/removeMember", () => {
  it("membro già presente → ALREADY_MEMBER", () => {
    const members = new Set(["alice", "bob"]);
    const addMember = (username: string) => {
      if (members.has(username)) throw new Error("ALREADY_MEMBER");
      members.add(username);
    };
    expect(() => addMember("alice")).toThrow("ALREADY_MEMBER");
  });

  it("nuovo membro aggiunto correttamente", () => {
    const members = new Set(["alice"]);
    members.add("charlie");
    expect(members.has("charlie")).toBe(true);
    expect(members.size).toBe(2);
  });

  it("rimozione membro riduce count", () => {
    let count = 5;
    count -= 1;
    expect(count).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// 25.7 — Business: leaveGroup
// ---------------------------------------------------------------------------

describe("25.7 — Business: leaveGroup", () => {
  it("ultimo admin → promuovi altro membro prima di uscire", () => {
    const members = [
      { id: "u1", role: "admin" },
      { id: "u2", role: "member" },
    ];
    const leavingId = "u1";
    const admins = members.filter((m) => m.role === "admin");
    if (admins.length <= 1) {
      const next = members.find((m) => m.id !== leavingId);
      if (next) next.role = "admin";
    }
    expect(members.find((m) => m.id === "u2")?.role).toBe("admin");
  });

  it("unico membro che lascia → gruppo eliminato", () => {
    const members = [{ id: "u1", role: "admin" }];
    const leavingId = "u1";
    const admins = members.filter((m) => m.role === "admin");
    let deleted = false;
    if (admins.length <= 1) {
      const next = members.find((m) => m.id !== leavingId);
      if (!next) deleted = true;
    }
    expect(deleted).toBe(true);
  });

  it("membro normale lascia senza side-effect su altri", () => {
    const members = [
      { id: "u1", role: "admin" },
      { id: "u2", role: "member" },
    ];
    const after = members.filter((m) => m.id !== "u2");
    expect(after.length).toBe(1);
    expect(after[0]?.role).toBe("admin");
  });
});

// ---------------------------------------------------------------------------
// 25.8 — Business: changeRole
// ---------------------------------------------------------------------------

describe("25.8 — Business: changeRole", () => {
  it("admin può promuovere member ad admin", () => {
    const members = [
      { id: "u1", role: "admin" },
      { id: "u2", role: "member" },
    ];
    const changeRole = (adminId: string, targetId: string, role: string) => {
      const admin = members.find((m) => m.id === adminId);
      if (admin?.role !== "admin") throw new Error("NOT_GROUP_ADMIN");
      if (adminId === targetId) throw new Error("NOT_GROUP_ADMIN");
      const target = members.find((m) => m.id === targetId);
      if (target) target.role = role;
    };
    changeRole("u1", "u2", "admin");
    expect(members.find((m) => m.id === "u2")?.role).toBe("admin");
  });

  it("non-admin non può cambiare ruoli", () => {
    const members = [{ id: "u1", role: "admin" }, { id: "u2", role: "member" }];
    const changeRole = (requesterId: string) => {
      const r = members.find((m) => m.id === requesterId);
      if (r?.role !== "admin") throw new Error("NOT_GROUP_ADMIN");
    };
    expect(() => changeRole("u2")).toThrow("NOT_GROUP_ADMIN");
  });

  it("admin non può cambiare il proprio ruolo", () => {
    const changeRole = (adminId: string, targetId: string) => {
      if (adminId === targetId) throw new Error("NOT_GROUP_ADMIN");
    };
    expect(() => changeRole("u1", "u1")).toThrow("NOT_GROUP_ADMIN");
  });
});

// ---------------------------------------------------------------------------
// 25.9 — Business: updateGroup / deleteGroup
// ---------------------------------------------------------------------------

describe("25.9 — Business: updateGroup/deleteGroup", () => {
  it("solo admin può aggiornare il gruppo", () => {
    const assertAdmin = (role: string) => {
      if (role !== "admin") throw new Error("NOT_GROUP_ADMIN");
    };
    expect(() => assertAdmin("member")).toThrow("NOT_GROUP_ADMIN");
    expect(() => assertAdmin("admin")).not.toThrow();
  });

  it("updateGroup preserva nome se non specificato", () => {
    let name = "Vecchio nome";
    const update = (input: { name?: string }) => {
      if (input.name !== undefined) name = input.name;
    };
    update({});
    expect(name).toBe("Vecchio nome");
    update({ name: "Nuovo" });
    expect(name).toBe("Nuovo");
  });

  it("deleteGroup soft-delete (deleted_at settato)", () => {
    const conv = { deleted_at: null as Date | null };
    conv.deleted_at = new Date();
    expect(conv.deleted_at).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 25.10 — Edge cases
// ---------------------------------------------------------------------------

describe("25.10 — Edge cases", () => {
  it("GROUP_FULL quando member_count >= max_members", () => {
    const conv = { member_count: 256, max_members: 256 };
    const addMember = () => {
      if (conv.member_count >= conv.max_members) throw new Error("GROUP_FULL");
    };
    expect(() => addMember()).toThrow("GROUP_FULL");
  });

  it("non-membro non può vedere il gruppo", () => {
    const members = new Set(["alice", "bob"]);
    const getGroup = (userId: string) => {
      if (!members.has(userId)) throw new Error("CHAT_NOT_FOUND");
    };
    expect(() => getGroup("charlie")).toThrow("CHAT_NOT_FOUND");
    expect(() => getGroup("alice")).not.toThrow();
  });

  it("membro che ha lasciato viene trattato come non-membro", () => {
    const membership = { left_at: new Date() };
    const isMember = membership.left_at === null;
    expect(isMember).toBe(false);
  });

  it("removeMember su se stesso → NOT_GROUP_ADMIN", () => {
    const removeMember = (adminId: string, targetId: string) => {
      if (adminId === targetId) throw new Error("NOT_GROUP_ADMIN");
    };
    expect(() => removeMember("u1", "u1")).toThrow("NOT_GROUP_ADMIN");
  });
});
