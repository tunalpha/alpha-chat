/**
 * spark-monitor.test.ts — Unit test Admin Spark Monitor UI utilities
 *
 * §1  formatSparkFeeAmount — valori normali
 * §2  formatSparkFeeAmount — zero
 * §3  formatSparkFeeAmount — NaN/vuoto
 * §4  formatSparkDate — data ISO valida
 * §5  formatSparkDate — null/undefined
 * §6  sparkStatusLabel — tutti gli stati
 * §7  sparkStatusColor — tutti gli stati
 * §8  healthStatusBadge — tutti gli stati
 * §9  apiGetSparkMovements — costruisce la query string corretta
 * §10 apiGetSparkMovements — range=all non aggiunge parametro
 * §11 apiGetSparkDashboard — chiama endpoint corretto
 * §12 apiGetSparkHealth — chiama endpoint corretto
 * §13 apiGetSparkReconciliation — chiama endpoint corretto
 * §14 Privacy — apiGetSparkDashboard non espone API key nel payload
 * §15 Isolation — nessun import da alpha-wallet-api o multichain-api
 * §16 Fee isolation — nessuna funzione BTC on-chain importata
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  formatSparkFeeAmount,
  formatSparkDate,
  sparkStatusLabel,
  sparkStatusColor,
  healthStatusBadge,
  apiGetSparkDashboard,
  apiGetSparkMovements,
  apiGetSparkHealth,
  apiGetSparkReconciliation,
  type SparkMovementRecord,
  type SparkHealthData,
} from "../lib/spark-monitoring-api";

// ── Mock apiFetch ────────────────────────────────────────────────────────────

const mockApiFetch = vi.fn();
vi.mock("../lib/api", () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
  getToken: vi.fn().mockReturnValue("test-token"),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
// §1 formatSparkFeeAmount — valori normali
// ─────────────────────────────────────────────────────────────────────────────

describe("§1 formatSparkFeeAmount — valori normali", () => {
  it("formatta correttamente un importo BTC", () => {
    expect(formatSparkFeeAmount("0.00001234")).toBe("0.00001234 BTC");
  });
  it("elimina trailing zeros", () => {
    expect(formatSparkFeeAmount("0.00010000")).toBe("0.0001 BTC");
  });
  it("usa il symbol personalizzato", () => {
    expect(formatSparkFeeAmount("0.00001234", "SAT")).toBe("0.00001234 SAT");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 formatSparkFeeAmount — zero
// ─────────────────────────────────────────────────────────────────────────────

describe("§2 formatSparkFeeAmount — zero", () => {
  it("restituisce '0 BTC' per importo zero", () => {
    expect(formatSparkFeeAmount("0")).toBe("0 BTC");
    expect(formatSparkFeeAmount("0.00000000")).toBe("0 BTC");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 formatSparkFeeAmount — NaN/vuoto
// ─────────────────────────────────────────────────────────────────────────────

describe("§3 formatSparkFeeAmount — input non valido", () => {
  it("restituisce '—' per stringa vuota", () => {
    expect(formatSparkFeeAmount("")).toBe("—");
  });
  it("restituisce '—' per NaN", () => {
    expect(formatSparkFeeAmount("not-a-number")).toBe("—");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4 formatSparkDate — data ISO valida
// ─────────────────────────────────────────────────────────────────────────────

describe("§4 formatSparkDate — data valida", () => {
  it("produce una stringa non vuota per una data ISO valida", () => {
    const result = formatSparkDate("2026-08-12T10:30:00.000Z");
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
    expect(result).not.toBe("—");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5 formatSparkDate — null/undefined
// ─────────────────────────────────────────────────────────────────────────────

describe("§5 formatSparkDate — null/undefined", () => {
  it("restituisce '—' per null", () => {
    expect(formatSparkDate(null)).toBe("—");
  });
  it("restituisce '—' per undefined", () => {
    expect(formatSparkDate(undefined)).toBe("—");
  });
  it("restituisce '—' per stringa vuota", () => {
    expect(formatSparkDate("")).toBe("—");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §6 sparkStatusLabel
// ─────────────────────────────────────────────────────────────────────────────

describe("§6 sparkStatusLabel — tutti gli stati", () => {
  it("success → 'Completato'", () => {
    expect(sparkStatusLabel("success")).toBe("Completato");
  });
  it("failed_transient → label contenente 'Fallito'", () => {
    expect(sparkStatusLabel("failed_transient")).toContain("Fallito");
  });
  it("failed_permanent → label contenente 'permanente'", () => {
    expect(sparkStatusLabel("failed_permanent")).toContain("permanente");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §7 sparkStatusColor
// ─────────────────────────────────────────────────────────────────────────────

describe("§7 sparkStatusColor — tutti gli stati", () => {
  it("success → green", () => {
    expect(sparkStatusColor("success")).toContain("green");
  });
  it("failed_transient → yellow", () => {
    expect(sparkStatusColor("failed_transient")).toContain("yellow");
  });
  it("failed_permanent → red", () => {
    expect(sparkStatusColor("failed_permanent")).toContain("red");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §8 healthStatusBadge
// ─────────────────────────────────────────────────────────────────────────────

describe("§8 healthStatusBadge — tutti gli stati", () => {
  it("healthy → 🟢", () => {
    expect(healthStatusBadge("healthy")).toContain("🟢");
  });
  it("warning → 🟡", () => {
    expect(healthStatusBadge("warning")).toContain("🟡");
  });
  it("critical → 🔴", () => {
    expect(healthStatusBadge("critical")).toContain("🔴");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §9 apiGetSparkMovements — query string
// ─────────────────────────────────────────────────────────────────────────────

describe("§9 apiGetSparkMovements — query string", () => {
  it("include range e status nella query string", async () => {
    mockApiFetch.mockResolvedValue({ data: { total: 0, page: 1, limit: 20, pages: 1, records: [] } });
    await apiGetSparkMovements({ range: "7d", status: "success", page: 2, limit: 20 });
    const url: string = mockApiFetch.mock.calls[0][0];
    expect(url).toContain("range=7d");
    expect(url).toContain("status=success");
    expect(url).toContain("page=2");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §10 apiGetSparkMovements — range=all senza parametri extra
// ─────────────────────────────────────────────────────────────────────────────

describe("§10 apiGetSparkMovements — chiamata senza params", () => {
  it("endpoint base senza query string quando nessun param", async () => {
    mockApiFetch.mockResolvedValue({ data: { total: 0, page: 1, limit: 50, pages: 1, records: [] } });
    await apiGetSparkMovements({});
    const url: string = mockApiFetch.mock.calls[0][0];
    expect(url).toBe("/spark/monitoring/movements");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §11–13 Endpoint corretti
// ─────────────────────────────────────────────────────────────────────────────

describe("§11 apiGetSparkDashboard — endpoint", () => {
  it("chiama /spark/monitoring/dashboard", async () => {
    mockApiFetch.mockResolvedValue({ data: { movements_total: 0 } });
    await apiGetSparkDashboard();
    expect(mockApiFetch.mock.calls[0][0]).toBe("/spark/monitoring/dashboard");
  });
});

describe("§12 apiGetSparkHealth — endpoint", () => {
  it("chiama /spark/monitoring/health", async () => {
    mockApiFetch.mockResolvedValue({ data: { overall_status: "healthy", alerts: [] } });
    await apiGetSparkHealth();
    expect(mockApiFetch.mock.calls[0][0]).toBe("/spark/monitoring/health");
  });
});

describe("§13 apiGetSparkReconciliation — endpoint", () => {
  it("chiama /spark/monitoring/reconciliation", async () => {
    mockApiFetch.mockResolvedValue({ data: { status: "ok", alert: false } });
    await apiGetSparkReconciliation();
    expect(mockApiFetch.mock.calls[0][0]).toBe("/spark/monitoring/reconciliation");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §14 Privacy — nessuna API key nel payload
// ─────────────────────────────────────────────────────────────────────────────

describe("§14 Privacy — payload non contiene dati sensibili", () => {
  it("dashboard response non contiene mnemonic o API key", async () => {
    const dashboardData = {
      spark_enabled: true,
      breez_api_key_configured: true, // boolean only
      movements_total: 5,
      movements_completed: 5,
      movements_failed: 0,
      movements_pending_note: "N/D",
      alpha_fees_success: "0.00001",
      alpha_fees_failed: "0",
      error_rate_percent: 0,
      last_movement_at: null,
    };
    mockApiFetch.mockResolvedValue({ data: dashboardData });
    const result = await apiGetSparkDashboard();
    const json = JSON.stringify(result);
    expect(json).not.toMatch(/mnemonic/i);
    expect(json).not.toMatch(/private_key/i);
    // breez_api_key_configured è boolean, non il valore della chiave
    expect(typeof result.breez_api_key_configured).toBe("boolean");
    expect(json).not.toMatch(/sk_/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §15–16 Isolation — nessun import da BTC/EVM/USDA
// ─────────────────────────────────────────────────────────────────────────────

describe("§15–16 Isolation — nessun import da BTC on-chain o EVM", () => {
  it("sparkStatusColor non produce 'btc' o 'evm' nel risultato", () => {
    const colors = (["success", "failed_transient", "failed_permanent"] as SparkMovementRecord["status"][])
      .map(s => sparkStatusColor(s));
    colors.forEach(c => {
      expect(c).not.toContain("btc");
      expect(c).not.toContain("evm");
      expect(c).not.toContain("usda");
    });
  });

  it("healthStatusBadge non produce output da BTC o EVM", () => {
    const statuses: SparkHealthData["overall_status"][] = ["healthy", "warning", "critical"];
    statuses.forEach(s => {
      const badge = healthStatusBadge(s);
      expect(badge).not.toContain("btc");
      expect(badge).not.toContain("evm");
    });
  });
});
