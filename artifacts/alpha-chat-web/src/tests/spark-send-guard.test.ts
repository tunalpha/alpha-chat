/**
 * spark-send-guard — test timeout + riconciliazione Lightning.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  sendLightningGuarded,
  SparkSendUncertainError,
  isBolt11Invoice,
  setUncertainMarker,
  getUncertainMarker,
  clearUncertainMarker,
  resolveUncertainMarker,
} from "../lib/spark/spark-send-guard";
import type { SparkPayment, SparkSendResult } from "../lib/spark/spark-types";

const INVOICE = "lnbc10n1pTestInvoice";

const okResult: SparkSendResult = {
  paymentId: "pay-1",
  amountSat: 1000n,
  feeSat:    1n,
  status:    "completed",
};

function mkPayment(over: Partial<SparkPayment> = {}): SparkPayment {
  return {
    id:          "pay-hist-1",
    paymentType: "btc_lightning_sent",
    status:      "completed",
    amountSat:   1000n,
    feeSat:      1n,
    timestamp:   1_700_000_000,
    bolt11:      INVOICE,
    ...over,
  };
}

const never = () => new Promise<never>(() => {});

beforeEach(() => { vi.useFakeTimers(); clearUncertainMarker(); });
afterEach(() => { vi.useRealTimers(); clearUncertainMarker(); });

describe("sendLightningGuarded", () => {
  it("esito normale: send risponde entro il timeout", async () => {
    const p = sendLightningGuarded({
      send: async () => okResult,
      listPayments: vi.fn(),
      invoice: INVOICE,
    });
    await vi.runAllTimersAsync();
    await expect(p).resolves.toEqual({ outcome: "sent", result: okResult });
  });

  it("errore SDK entro il timeout viene propagato (non mascherato)", async () => {
    const p = sendLightningGuarded({
      send: async () => { throw new Error("insufficient balance"); },
      listPayments: vi.fn(),
      invoice: INVOICE,
    });
    p.catch(() => {}); // evita unhandled rejection durante i timer
    await vi.runAllTimersAsync();
    await expect(p).rejects.toThrow("insufficient balance");
  });

  it("timeout + storico con invoice completata → successo riconciliato", async () => {
    const listPayments = vi.fn(async () => [mkPayment()]);
    const p = sendLightningGuarded({
      send: never,
      listPayments,
      invoice: INVOICE,
      sendTimeoutMs: 1000,
      reconcileIntervalMs: 100,
    });
    await vi.runAllTimersAsync();
    const out = await p;
    expect(out.outcome).toBe("reconciled");
    if (out.outcome === "reconciled") expect(out.payment.id).toBe("pay-hist-1");
  });

  it("timeout + invoice assente dallo storico → SparkSendUncertainError, mai retry dell'invio", async () => {
    const send = vi.fn(never);
    const listPayments = vi.fn(async () => [mkPayment({ bolt11: "lnbc-other" })]);
    const p = sendLightningGuarded({
      send,
      listPayments,
      invoice: INVOICE,
      sendTimeoutMs: 1000,
      reconcileAttempts: 3,
      reconcileIntervalMs: 100,
    });
    p.catch(() => {});
    await vi.runAllTimersAsync();
    await expect(p).rejects.toBeInstanceOf(SparkSendUncertainError);
    expect(send).toHaveBeenCalledTimes(1);
    expect(listPayments).toHaveBeenCalledTimes(3);
  });

  it("timeout + pagamento ancora pending → esito incerto (non successo)", async () => {
    const listPayments = vi.fn(async () => [mkPayment({ status: "pending" })]);
    const p = sendLightningGuarded({
      send: never,
      listPayments,
      invoice: INVOICE,
      sendTimeoutMs: 1000,
      reconcileAttempts: 2,
      reconcileIntervalMs: 100,
    });
    p.catch(() => {});
    await vi.runAllTimersAsync();
    await expect(p).rejects.toBeInstanceOf(SparkSendUncertainError);
  });

  it("listPayments congelato (timeout interno) non blocca la riconciliazione", async () => {
    let call = 0;
    const listPayments = vi.fn((): Promise<SparkPayment[]> => {
      call++;
      return call === 1 ? never() : Promise.resolve([mkPayment()]);
    });
    const p = sendLightningGuarded({
      send: never,
      listPayments,
      invoice: INVOICE,
      sendTimeoutMs: 1000,
      reconcileAttempts: 3,
      reconcileIntervalMs: 100,
      listTimeoutMs: 500,
    });
    await vi.runAllTimersAsync();
    const out = await p;
    expect(out.outcome).toBe("reconciled");
  });

  it("non-BOLT11 (LNURL/address): timeout → esito incerto immediato, nessuna riconciliazione", async () => {
    const listPayments = vi.fn(async () => [mkPayment()]);
    const p = sendLightningGuarded({
      send: never,
      listPayments,
      invoice: "utente@dominio.com",
      sendTimeoutMs: 1000,
    });
    p.catch(() => {});
    await vi.runAllTimersAsync();
    await expect(p).rejects.toBeInstanceOf(SparkSendUncertainError);
    expect(listPayments).not.toHaveBeenCalled();
  });

  it("riconciliazione usa finestra 200 di default", async () => {
    const listPayments = vi.fn(async (req: { limit?: number }) => {
      expect(req.limit).toBe(200);
      return [mkPayment()];
    });
    const p = sendLightningGuarded({
      send: never,
      listPayments,
      invoice: INVOICE,
      sendTimeoutMs: 1000,
      reconcileIntervalMs: 100,
    });
    await vi.runAllTimersAsync();
    await expect(p).resolves.toMatchObject({ outcome: "reconciled" });
  });

  it("onLateResolve: send completa DOPO il timeout → continuation chiamata una volta", async () => {
    let resolveSend!: (r: SparkSendResult) => void;
    const sendPromise = new Promise<SparkSendResult>((r) => { resolveSend = r; });
    const onLateResolve = vi.fn();
    const p = sendLightningGuarded({
      send: () => sendPromise,
      listPayments: vi.fn(async () => []),
      invoice: INVOICE,
      onLateResolve,
      sendTimeoutMs: 1000,
      reconcileAttempts: 2,
      reconcileIntervalMs: 100,
    });
    p.catch(() => {});
    await vi.runAllTimersAsync();
    await expect(p).rejects.toBeInstanceOf(SparkSendUncertainError);
    resolveSend(okResult);
    await vi.runAllTimersAsync();
    expect(onLateResolve).toHaveBeenCalledTimes(1);
    expect(onLateResolve).toHaveBeenCalledWith(okResult);
  });

  it("onLateResolve NON chiamata se la riconciliazione ha già confermato", async () => {
    let resolveSend!: (r: SparkSendResult) => void;
    const sendPromise = new Promise<SparkSendResult>((r) => { resolveSend = r; });
    const onLateResolve = vi.fn();
    const p = sendLightningGuarded({
      send: () => sendPromise,
      listPayments: vi.fn(async () => [mkPayment()]),
      invoice: INVOICE,
      onLateResolve,
      sendTimeoutMs: 1000,
      reconcileIntervalMs: 100,
    });
    await vi.runAllTimersAsync();
    await expect(p).resolves.toMatchObject({ outcome: "reconciled" });
    resolveSend(okResult);
    await vi.runAllTimersAsync();
    expect(onLateResolve).not.toHaveBeenCalled();
  });

  it("single-owner: send risponde DURANTE il polling → esito 'sent', nessuna riconciliazione doppia", async () => {
    let resolveSend!: (r: SparkSendResult) => void;
    const sendPromise = new Promise<SparkSendResult>((r) => { resolveSend = r; });
    // Lo storico contiene GIÀ il pagamento completato: se il guard non fosse
    // single-owner potrebbe produrre sia 'sent' che 'reconciled'.
    const listPayments = vi.fn(async () => {
      resolveSend(okResult); // il primario risponde mentre leggiamo lo storico
      return [mkPayment()];
    });
    const onLateResolve = vi.fn();
    const p = sendLightningGuarded({
      send: () => sendPromise,
      listPayments,
      invoice: INVOICE,
      onLateResolve,
      sendTimeoutMs: 1000,
      reconcileIntervalMs: 100,
    });
    await vi.runAllTimersAsync();
    const out = await p;
    expect(out.outcome).toBe("sent");
    expect(onLateResolve).not.toHaveBeenCalled();
    expect(getUncertainMarker()).toBeNull();
  });

  it("errore SDK tardivo durante il polling → propagato (pagamento NON partito, retry sicuro)", async () => {
    let rejectSend!: (e: Error) => void;
    const sendPromise = new Promise<SparkSendResult>((_, rj) => { rejectSend = rj; });
    const listPayments = vi.fn(async () => {
      rejectSend(new Error("route not found"));
      return [];
    });
    const p = sendLightningGuarded({
      send: () => sendPromise,
      listPayments,
      invoice: INVOICE,
      sendTimeoutMs: 1000,
      reconcileAttempts: 3,
      reconcileIntervalMs: 100,
    });
    p.catch(() => {});
    await vi.runAllTimersAsync();
    await expect(p).rejects.toThrow("route not found");
    expect(getUncertainMarker()).toBeNull();
  });

  it("esito incerto → marker persistente settato; late resolve lo pulisce e chiama la continuation", async () => {
    let resolveSend!: (r: SparkSendResult) => void;
    const sendPromise = new Promise<SparkSendResult>((r) => { resolveSend = r; });
    const onLateResolve = vi.fn();
    const p = sendLightningGuarded({
      send: () => sendPromise,
      listPayments: vi.fn(async () => []),
      invoice: INVOICE,
      onLateResolve,
      sendTimeoutMs: 1000,
      reconcileAttempts: 2,
      reconcileIntervalMs: 100,
    });
    p.catch(() => {});
    await vi.runAllTimersAsync();
    await expect(p).rejects.toBeInstanceOf(SparkSendUncertainError);
    expect(getUncertainMarker()?.invoice).toBe(INVOICE);
    resolveSend(okResult);
    await vi.runAllTimersAsync();
    expect(onLateResolve).toHaveBeenCalledTimes(1);
    expect(getUncertainMarker()).toBeNull();
  });

  it("errore tardivo dopo esito incerto → marker pulito (retry di nuovo consentito)", async () => {
    let rejectSend!: (e: Error) => void;
    const sendPromise = new Promise<SparkSendResult>((_, rj) => { rejectSend = rj; });
    const p = sendLightningGuarded({
      send: () => sendPromise,
      listPayments: vi.fn(async () => []),
      invoice: INVOICE,
      onLateResolve: vi.fn(),
      sendTimeoutMs: 1000,
      reconcileAttempts: 1,
      reconcileIntervalMs: 100,
    });
    p.catch(() => {});
    await vi.runAllTimersAsync();
    await expect(p).rejects.toBeInstanceOf(SparkSendUncertainError);
    expect(getUncertainMarker()).not.toBeNull();
    rejectSend(new Error("late failure"));
    await vi.runAllTimersAsync();
    expect(getUncertainMarker()).toBeNull();
  });

  it("isBolt11Invoice riconosce bolt11 e rifiuta LNURL/address", () => {
    expect(isBolt11Invoice("lnbc10n1p...")).toBe(true);
    expect(isBolt11Invoice("LNBC10N1P...")).toBe(true);
    expect(isBolt11Invoice("lntb500n1p...")).toBe(true);
    expect(isBolt11Invoice("utente@dominio.com")).toBe(false);
    expect(isBolt11Invoice("lnurl1dp68gurn...")).toBe(false);
    expect(isBolt11Invoice("lno1pg...")).toBe(false);
  });

  it("match case-insensitive sull'invoice e solo su tipi 'sent'", async () => {
    const listPayments = vi.fn(async () => [
      mkPayment({ paymentType: "btc_lightning_received", id: "wrong" }),
      mkPayment({ bolt11: INVOICE.toUpperCase(), id: "right" }),
    ]);
    const p = sendLightningGuarded({
      send: never,
      listPayments,
      invoice: INVOICE,
      sendTimeoutMs: 1000,
      reconcileIntervalMs: 100,
    });
    await vi.runAllTimersAsync();
    const out = await p;
    if (out.outcome === "reconciled") expect(out.payment.id).toBe("right");
    else throw new Error("atteso reconciled");
  });
});

describe("resolveUncertainMarker", () => {
  it("nessun marker → clear", async () => {
    await expect(resolveUncertainMarker(vi.fn())).resolves.toEqual({ status: "clear" });
  });

  it("marker BOLT11 + invoice completata nello storico → confirmed_paid, marker rimosso", async () => {
    setUncertainMarker(INVOICE);
    const res = resolveUncertainMarker(async () => [mkPayment()]);
    await vi.runAllTimersAsync();
    const out = await res;
    expect(out.status).toBe("confirmed_paid");
    expect(getUncertainMarker()).toBeNull();
  });

  it("REGRESSIONE anti double-pay: marker FRESCO + invoice assente dallo storico → still_uncertain (assenza ≠ prova)", async () => {
    setUncertainMarker(INVOICE);
    const res = resolveUncertainMarker(async () => [mkPayment({ bolt11: "lnbc-other" })]);
    await vi.runAllTimersAsync();
    await expect(res).resolves.toEqual({ status: "still_uncertain" });
    expect(getUncertainMarker()).not.toBeNull();
  });

  it("marker BOLT11 SCADUTO (>15 min) + invoice assente con lettura riuscita → clear (risk policy)", async () => {
    setUncertainMarker(INVOICE);
    const m = getUncertainMarker()!;
    localStorage.setItem("aw_ln_uncertain_v1", JSON.stringify({ ...m, ts: m.ts - 16 * 60_000 }));
    const res = resolveUncertainMarker(async () => [mkPayment({ bolt11: "lnbc-other" })]);
    await vi.runAllTimersAsync();
    await expect(res).resolves.toEqual({ status: "clear" });
    expect(getUncertainMarker()).toBeNull();
  });

  it("marker BOLT11 SCADUTO ma invoice PENDING nello storico → resta still_uncertain", async () => {
    setUncertainMarker(INVOICE);
    const m = getUncertainMarker()!;
    localStorage.setItem("aw_ln_uncertain_v1", JSON.stringify({ ...m, ts: m.ts - 16 * 60_000 }));
    const res = resolveUncertainMarker(async () => [mkPayment({ status: "pending" })]);
    await vi.runAllTimersAsync();
    await expect(res).resolves.toEqual({ status: "still_uncertain" });
    expect(getUncertainMarker()).not.toBeNull();
  });

  it("marker BOLT11 + invoice pending → still_uncertain, marker mantenuto", async () => {
    setUncertainMarker(INVOICE);
    const res = resolveUncertainMarker(async () => [mkPayment({ status: "pending" })]);
    await vi.runAllTimersAsync();
    await expect(res).resolves.toEqual({ status: "still_uncertain" });
    expect(getUncertainMarker()).not.toBeNull();
  });

  it("marker BOLT11 + storico congelato (timeout) → still_uncertain", async () => {
    setUncertainMarker(INVOICE);
    const res = resolveUncertainMarker(() => new Promise(() => {}), { listTimeoutMs: 500 });
    await vi.runAllTimersAsync();
    await expect(res).resolves.toEqual({ status: "still_uncertain" });
  });

  it("marker non-BOLT11 (richiesta dinamica) → still_uncertain PER SEMPRE, mai sblocco a tempo", async () => {
    setUncertainMarker("utente@dominio.com");
    await expect(resolveUncertainMarker(vi.fn())).resolves.toEqual({ status: "still_uncertain" });
    // Anche oltre la finestra dei 15 min il lock NON si sblocca da solo:
    // un retry LNURL/address può risolvere una NUOVA invoice → doppio pagamento.
    const m = getUncertainMarker()!;
    localStorage.setItem("aw_ln_uncertain_v1", JSON.stringify({ ...m, ts: m.ts - 24 * 60 * 60_000 }));
    await expect(resolveUncertainMarker(vi.fn())).resolves.toEqual({ status: "still_uncertain" });
    expect(getUncertainMarker()).not.toBeNull();
  });
});
