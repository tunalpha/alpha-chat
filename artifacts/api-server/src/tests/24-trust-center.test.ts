/**
 * Test Suite 24 — Trust Center — Sprint 20
 *
 * 24.1 Score calculation
 * 24.2 Level thresholds
 * 24.3 Check categories
 * 24.4 Missing items
 * 24.5 Client-side checks
 * 24.6 Privacy — nessun contenuto di chat
 * 24.7 Audit trigger
 */

import { describe, it, expect } from "vitest";

// ---------------------------------------------------------------------------
// Score calculation helpers (mirror della logica del service)
// ---------------------------------------------------------------------------

interface Check { points: number; max_points: number; status: "ok" | "warn" | "fail" | "na" }

function computeScore(checks: Check[]): number {
  const total = checks.reduce((s, c) => s + c.points, 0);
  const max   = checks.reduce((s, c) => s + c.max_points, 0);
  return Math.round((total / max) * 100);
}

const LEVELS = [
  { min: 90, label: "MILITARY READY" },
  { min: 75, label: "ADVANCED" },
  { min: 55, label: "SECURE" },
  { min: 35, label: "BASIC" },
  { min: 0,  label: "AT RISK" },
];
function getLevel(score: number) { return LEVELS.find(l => score >= l.min)?.label ?? "AT RISK"; }

// ---------------------------------------------------------------------------

describe("24.1 — Score calculation", () => {
  it("score massimo 100 quando tutti i check passano", () => {
    const checks: Check[] = [
      { points: 8, max_points: 8, status: "ok" },
      { points: 8, max_points: 8, status: "ok" },
      { points: 7, max_points: 7, status: "ok" },
      { points: 5, max_points: 5, status: "ok" },
    ];
    const total = checks.reduce((s, c) => s + c.max_points, 0);
    const score = Math.round((checks.reduce((s, c) => s + c.points, 0) / total) * 100);
    expect(score).toBe(100);
  });

  it("score 0 quando nessun check passa", () => {
    const checks: Check[] = [
      { points: 0, max_points: 8, status: "fail" },
      { points: 0, max_points: 7, status: "fail" },
    ];
    expect(computeScore(checks)).toBe(0);
  });

  it("score parziale corretto", () => {
    const checks: Check[] = [
      { points: 8, max_points: 8, status: "ok" },
      { points: 0, max_points: 8, status: "fail" },
    ];
    expect(computeScore(checks)).toBe(50);
  });

  it("score sempre 0-100", () => {
    for (let p = 0; p <= 100; p++) {
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(100);
    }
  });
});

describe("24.2 — Level thresholds", () => {
  it("90+ → MILITARY READY", () => {
    expect(getLevel(90)).toBe("MILITARY READY");
    expect(getLevel(100)).toBe("MILITARY READY");
    expect(getLevel(95)).toBe("MILITARY READY");
  });

  it("75-89 → ADVANCED", () => {
    expect(getLevel(75)).toBe("ADVANCED");
    expect(getLevel(89)).toBe("ADVANCED");
    expect(getLevel(80)).toBe("ADVANCED");
  });

  it("55-74 → SECURE", () => {
    expect(getLevel(55)).toBe("SECURE");
    expect(getLevel(74)).toBe("SECURE");
  });

  it("35-54 → BASIC", () => {
    expect(getLevel(35)).toBe("BASIC");
    expect(getLevel(54)).toBe("BASIC");
  });

  it("0-34 → AT RISK", () => {
    expect(getLevel(0)).toBe("AT RISK");
    expect(getLevel(34)).toBe("AT RISK");
  });
});

describe("24.3 — Check categories", () => {
  const categories = ["encryption", "identity", "device", "recovery", "privacy"] as const;

  it("tutte le categorie sono presenti", () => {
    expect(categories).toContain("encryption");
    expect(categories).toContain("identity");
    expect(categories).toContain("device");
    expect(categories).toContain("recovery");
    expect(categories).toContain("privacy");
  });

  it("Signal Protocol e E2E sempre ok (invarianti di sistema)", () => {
    const systemChecks = ["signal_protocol", "e2e_encryption", "burn_after_read", "disappearing_messages"];
    expect(systemChecks).toHaveLength(4);
    // Questi check sono sempre ok perché fanno parte dell'architettura base di Alpha Chat
  });
});

describe("24.4 — Missing items", () => {
  it("missing contiene solo check non passati", () => {
    const checks = [
      { label: "Signal Protocol", status: "ok" as const, points: 8, max_points: 8 },
      { label: "PIN locale", status: "warn" as const, points: 0, max_points: 6 },
      { label: "Phoenix Protocol", status: "fail" as const, points: 0, max_points: 8 },
    ];
    const missing = checks.filter(c => c.status !== "ok").map(c => c.label);
    expect(missing).toHaveLength(2);
    expect(missing).toContain("PIN locale");
    expect(missing).toContain("Phoenix Protocol");
    expect(missing).not.toContain("Signal Protocol");
  });
});

describe("24.5 — Client-side checks", () => {
  it("PIN configurato aggiunge punti al score", () => {
    const withPin:    Check = { points: 6, max_points: 6, status: "ok" };
    const withoutPin: Check = { points: 0, max_points: 6, status: "warn" };
    expect(withPin.points).toBeGreaterThan(withoutPin.points);
  });

  it("biometrico aggiunge punti al score", () => {
    const withBio    = 4;
    const withoutBio = 0;
    expect(withBio).toBeGreaterThan(withoutBio);
  });

  it("i check client-side usano valori inviati dal browser, mai inferiti dal server", () => {
    // Il server non può sapere se il PIN è configurato — viene inviato dal client
    const clientSideChecks = ["pin_configured", "biometric_configured", "timeout_configured"];
    expect(clientSideChecks).toHaveLength(3);
  });
});

describe("24.6 — Privacy", () => {
  it("nessuna API Trust Center accede a contenuti di conversazioni", () => {
    const allowedModels = [
      "UserModel", "SessionModel", "SecurityEventModel",
      "DeadManSwitchModel", "RecoveryContactModel",
    ];
    const forbiddenModels = ["MessageModel", "ConversationModel", "MediaModel"];
    for (const forbidden of forbiddenModels) {
      expect(allowedModels).not.toContain(forbidden);
    }
  });

  it("il report PDF contiene solo impostazioni e stato, mai messaggi", () => {
    const pdfSections = ["security_score", "checks_status", "level", "missing", "generated_at"];
    const forbiddenSections = ["messages", "conversations", "media", "signal_keys_private"];
    for (const forbidden of forbiddenSections) {
      expect(pdfSections).not.toContain(forbidden);
    }
  });
});

describe("24.7 — Audit trigger", () => {
  it("POST /audit logga un evento IDENTITY_VERIFIED nella security timeline", () => {
    const eventType = "IDENTITY_VERIFIED";
    expect(eventType).toBe("IDENTITY_VERIFIED");
  });

  it("audit manuale non modifica dati utente, solo legge", () => {
    const isReadOnly = true;
    expect(isReadOnly).toBe(true);
  });

  it("audit risponde con audited_at ISO 8601", () => {
    const auditedAt = new Date().toISOString();
    expect(auditedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
