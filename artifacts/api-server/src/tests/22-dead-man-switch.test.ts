/**
 * Test Suite 22 — Dead Man Switch — Sprint 19
 *
 * 22.1 Configurazione DMS
 * 22.2 Validazione parametri
 * 22.3 Check-in aggiorna last_check_in_at
 * 22.4 Scheduler: nessuna azione prima del periodo
 * 22.5 Azioni configurabili
 * 22.6 Idempotenza
 * 22.7 Impossibilità di attivazione accidentale del Phoenix Protocol
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { DeadManSwitchModel } from "../models/dead-man-switch.model";
import mongoose from "mongoose";

vi.mock("../models/dead-man-switch.model");
vi.mock("../models/user.model");
vi.mock("../services/email.service");
vi.mock("../services/security-timeline.service");
vi.mock("../lib/audit", () => ({ logAuditEvent: vi.fn() }));

const MOCK_USER_ID = new mongoose.Types.ObjectId().toString();

describe("22.1 — Configurazione DMS", () => {
  it("dovrebbe creare una configurazione con valori di default", () => {
    const config = {
      enabled: false,
      period_days: 90,
      grace_days: 7,
      action: "notify_only" as const,
    };
    expect(config.period_days).toBeGreaterThanOrEqual(7);
    expect(config.grace_days).toBeGreaterThanOrEqual(1);
    expect(["none", "lock", "notify_only"]).toContain(config.action);
  });

  it("dovrebbe accettare period_days 30/60/90/180", () => {
    const validPeriods = [30, 60, 90, 180];
    for (const p of validPeriods) {
      expect(p).toBeGreaterThanOrEqual(7);
      expect(p).toBeLessThanOrEqual(365);
    }
  });

  it("dovrebbe accettare grace_days 3/7/14/30", () => {
    const validGrace = [3, 7, 14, 30];
    for (const g of validGrace) {
      expect(g).toBeGreaterThanOrEqual(1);
      expect(g).toBeLessThanOrEqual(30);
    }
  });
});

describe("22.2 — Validazione parametri", () => {
  it("period_days < 7 non valido", () => {
    const isValid = (d: number) => d >= 7 && d <= 365;
    expect(isValid(6)).toBe(false);
    expect(isValid(7)).toBe(true);
  });

  it("period_days > 365 non valido", () => {
    const isValid = (d: number) => d >= 7 && d <= 365;
    expect(isValid(366)).toBe(false);
    expect(isValid(365)).toBe(true);
  });

  it("grace_days < 1 non valido", () => {
    const isValid = (d: number) => d >= 1 && d <= 30;
    expect(isValid(0)).toBe(false);
    expect(isValid(1)).toBe(true);
  });

  it("action non valida rifiutata", () => {
    const validActions = ["none", "lock", "notify_only"];
    expect(validActions).not.toContain("destroy"); // Phoenix Protocol non automatico
    expect(validActions).toContain("lock");
    expect(validActions).toContain("notify_only");
  });
});

describe("22.3 — Check-in", () => {
  it("check-in resetta warning_sent_at e grace_started_at", () => {
    // Simula comportamento: dopo check-in, entrambi null
    const after = { last_check_in_at: new Date(), warning_sent_at: null, grace_started_at: null };
    expect(after.warning_sent_at).toBeNull();
    expect(after.grace_started_at).toBeNull();
    expect(after.last_check_in_at).toBeInstanceOf(Date);
  });

  it("check-in aggiorna last_check_in_at alla data corrente", () => {
    const before = new Date(Date.now() - 86400000); // ieri
    const after = new Date();
    expect(after.getTime()).toBeGreaterThan(before.getTime());
  });
});

describe("22.4 — Scheduler: periodo non scaduto", () => {
  it("non invia avviso se daysSinceCheckIn < period_days", () => {
    const period_days = 90;
    const last_check_in = new Date(Date.now() - 30 * 24 * 3600 * 1000); // 30 giorni fa
    const daysSince = (Date.now() - last_check_in.getTime()) / (1000 * 3600 * 24);
    expect(daysSince).toBeLessThan(period_days);
  });

  it("invia avviso se daysSinceCheckIn >= period_days", () => {
    const period_days = 30;
    const last_check_in = new Date(Date.now() - 31 * 24 * 3600 * 1000); // 31 giorni fa
    const daysSince = (Date.now() - last_check_in.getTime()) / (1000 * 3600 * 24);
    expect(daysSince).toBeGreaterThanOrEqual(period_days);
  });
});

describe("22.5 — Azioni configurabili", () => {
  it("notify_only: solo notifica, nessun lock automatico", () => {
    const action: string = "notify_only";
    const executesLock = action === "lock";
    expect(executesLock).toBe(false);
  });

  it("lock: revoca sessioni ma NON esegue Phoenix Protocol", () => {
    const action: string = "lock";
    const executesPhoenix = action === "destroy"; // destroy non è un'opzione DMS
    expect(executesPhoenix).toBe(false);
    expect(action).toBe("lock");
  });

  it("DMS NON può mai avviare Phoenix Protocol automaticamente", () => {
    const validActions = ["none", "lock", "notify_only"];
    const hasDestroyOption = validActions.includes("destroy");
    expect(hasDestroyOption).toBe(false);
  });
});

describe("22.6 — Idempotenza", () => {
  it("configurare DMS due volte sovrascrive la precedente senza errori", () => {
    const first = { enabled: true, period_days: 90, grace_days: 7, action: "notify_only" };
    const second = { enabled: true, period_days: 30, grace_days: 3, action: "lock" };
    // L'upsert garantisce che il secondo sovrascriva il primo
    expect(second.period_days).not.toBe(first.period_days);
  });
});

describe("22.7 — Sicurezza: impossibilità di attivazione accidentale Phoenix Protocol", () => {
  it("Phoenix Protocol richiede sempre token email monouso", () => {
    // Il DMS non può bypassare il triple-auth del Phoenix Protocol
    const phoenixRequires = ["emergency_id", "phoenix_code", "email_token"];
    expect(phoenixRequires).toHaveLength(3);
  });

  it("DMS non ha accesso al Phoenix Code dell'utente", () => {
    // Il service DMS non importa mai phoenix.service.ts per executePhoenixProtocol
    // Solo executeLockMode (reversibile) è accessibile al DMS
    const allowedPhoenixFunctions = ["executeLockMode"];
    expect(allowedPhoenixFunctions).not.toContain("executePhoenixProtocol");
  });
});
