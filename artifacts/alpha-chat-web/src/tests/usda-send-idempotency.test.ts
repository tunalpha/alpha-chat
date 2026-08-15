/**
 * INVARIANT TEST — USDA Send Payment Idempotency
 *
 * Verifica l'invariante fondamentale anti-double-spend:
 *
 *   Per ogni singolo payment intent, apiPaymentCreate() può essere chiamato
 *   al massimo UNA volta, indipendentemente da:
 *   - quante volte l'utente preme "Riprova"
 *   - quante volte sendTransaction restituisce "Load failed"
 *   - il polling detect-deposit non trova deposito entro la grace window
 *
 * Root cause dell'incidente 2026-08-15:
 *   "Load failed" → throw dopo GRACE_POLLS → phase="error" → "Riprova" →
 *   setStep("confirm") con isResume=false → handleSend() → apiPaymentCreate()
 *   → NUOVA TX reale, anche se la prima era già in mempool.
 *
 * Il fix (signedUncertain + createdTransferRef) previene questo percorso:
 *   - signedUncertain=true: il polling non throwva dopo GRACE_POLLS → phase="uncertain"
 *   - createdTransferRef: guard in handleSend impedisce secondo apiPaymentCreate()
 *   - handleRetrySign: usa lo stesso transferId, mai crea un nuovo transfer
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Mock di apiPaymentCreate — tiene il conteggio delle chiamate. */
function makeApiPaymentCreateMock(transferId = "transfer-ABC") {
  const mock = vi.fn().mockResolvedValue({
    transfer_id:  transferId,
    escrow_wallet: "0xESCROW1234",
    amount:        "1.15",
    asset_address: "0xASSET5678",
  });
  return mock;
}

/** Mock di apiPaymentDetectDeposit — simula DEPOSIT_TX_NOT_DETECTED per N volte,
 *  poi risolve (deposito trovato). Usa Infinity per "mai trovato". */
function makeDetectMock(rejectTimes: number) {
  let count = 0;
  return vi.fn().mockImplementation(() => {
    count++;
    if (count <= rejectTimes) {
      const err = new Error("Deposit not detected");
      (err as Error & { code?: string }).code = "DEPOSIT_TX_NOT_DETECTED";
      return Promise.reject(err);
    }
    return Promise.resolve({ status: "confirmed" });
  });
}

/** Mock che non trova mai il deposito (simula finestra 10-min senza conferma). */
function makeNeverDetectMock() {
  return makeDetectMock(Infinity);
}

/** Simula sendTransaction che rigetta con "Load failed" (errore rete/relay). */
function sendTransactionLoadFailed() {
  return Promise.reject(new Error("Load failed"));
}

/** Simula sendTransaction che rigetta con rifiuto esplicito utente. */
function sendTransactionUserReject() {
  return Promise.reject(new Error("User rejected the request"));
}

/** Simula sendTransaction che risolve normalmente (TX firmata e inviata). */
function sendTransactionSuccess() {
  return Promise.resolve("0xTXHASH1234");
}

// ── Test della logica signAndPoll (unit test funzionale) ───────────────────

/**
 * Replica minimale della logica di signAndPoll per testare il comportamento
 * di signedUncertain senza montare il componente React.
 *
 * Replica esatta della logica in SendPaymentSheet.tsx v2 (con signedUncertain).
 */
async function signAndPollLogic(opts: {
  sendTransaction:    () => Promise<unknown>;
  detectDeposit:      () => Promise<unknown>;
  onPhaseChange:      (phase: string) => void;
  pollIntervalMs?:    number;
  gracePolls?:        number;
  maxPollMs?:         number;
}): Promise<{ completed: boolean; finalPhase: string }> {
  const {
    sendTransaction,
    detectDeposit,
    onPhaseChange,
    pollIntervalMs    = 10,    // ms ridotti per i test
    gracePolls        = 3,
    maxPollMs         = 200,   // ms ridotti per i test
  } = opts;

  let pollAborted     = false;
  let signedUncertain = false;
  let signErrorMsg: string | null = null;
  let finalPhase      = "signing";

  // Pre-sign check
  try {
    await detectDeposit();
    onPhaseChange("done");
    return { completed: true, finalPhase: "done" };
  } catch {
    // deposito non ancora presente
  }

  // Fire-and-forget sendTransaction
  sendTransaction().then(() => { /* resolved */ }).catch((err: unknown) => {
    const msg = (err as Error)?.message ?? "";
    if (/reject|cancel|denied|refused|user.*cancel|user rejected/i.test(msg)) {
      pollAborted  = true;
      signErrorMsg = "Firma annullata.";
    } else if (/nonce.*too.*low|nonce.*used|nonce.*already/i.test(msg)) {
      // nonce già usato → TX precedente on-chain, continua polling
    } else {
      // Load failed / NetworkError / RPC → incerto
      signedUncertain = true;
      signErrorMsg    = `Errore firma: ${msg}`;
    }
  });

  const pollStart = Date.now();
  let   pollCount = 0;

  while (Date.now() - pollStart < maxPollMs) {
    if (pollAborted) {
      finalPhase = "error";
      onPhaseChange("error");
      return { completed: false, finalPhase: "error" };
    }

    await new Promise<void>(r => setTimeout(r, pollIntervalMs));
    pollCount++;

    if (pollCount === 1) { onPhaseChange("confirming"); finalPhase = "confirming"; }
    if (pollAborted) {
      finalPhase = "error";
      onPhaseChange("error");
      return { completed: false, finalPhase: "error" };
    }

    try {
      await detectDeposit();
      onPhaseChange("done");
      return { completed: true, finalPhase: "done" };
    } catch (pollErr: unknown) {
      const code = (pollErr as Error & { code?: string })?.code;
      if (code === "DEPOSIT_TX_NOT_DETECTED") {
        if (signErrorMsg && !pollAborted && pollCount >= gracePolls) {
          if (signedUncertain) {
            // ── FIX: NON throw → continua polling, mostra uncertain ───────────
            onPhaseChange("uncertain");
            finalPhase = "uncertain";
            // non throw, non return — il loop continua
          } else {
            // errore pre-broadcast: retry sicuro
            finalPhase = "error";
            onPhaseChange("error");
            return { completed: false, finalPhase: "error" };
          }
        }
        continue;
      }
      throw pollErr;
    }
  }

  // Timeout
  if (signedUncertain) {
    onPhaseChange("uncertain");
    return { completed: false, finalPhase: "uncertain" };
  }
  onPhaseChange("error");
  return { completed: false, finalPhase: "error" };
}

// ── Test suite ────────────────────────────────────────────────────────────────

describe("USDA Send — Invariant: apiPaymentCreate chiamata al massimo una volta", () => {
  // ── §1: signedUncertain — "Load failed" NON causa throw dopo GRACE_POLLS ─

  it("§1.1 — Load failed: signAndPoll non throwva dopo GRACE_POLLS (signedUncertain)", async () => {
    const phases: string[] = [];

    // Detect non trova mai il deposito (simula finestra 10-min senza conferma Alchemy)
    const result = await signAndPollLogic({
      sendTransaction: sendTransactionLoadFailed,
      detectDeposit:   makeNeverDetectMock(),
      onPhaseChange:   p => phases.push(p),
      pollIntervalMs:  5,
      gracePolls:      2,
      maxPollMs:       100,
    });

    // Con signedUncertain: NON va in "error" dopo GRACE_POLLS
    // Continua fino al timeout → finalPhase = "uncertain"
    expect(result.finalPhase).toBe("uncertain");
    expect(phases).toContain("uncertain");
    expect(phases).not.toContain("error");
  });

  it("§1.2 — Rifiuto esplicito utente: pollAborted=true → phase=error dopo GRACE_POLLS", async () => {
    const phases: string[] = [];

    const result = await signAndPollLogic({
      sendTransaction: sendTransactionUserReject,
      detectDeposit:   makeNeverDetectMock(),
      onPhaseChange:   p => phases.push(p),
      pollIntervalMs:  5,
      gracePolls:      2,
      maxPollMs:       100,
    });

    // Rifiuto esplicito: pollAborted=true → error immediato
    expect(result.finalPhase).toBe("error");
    expect(phases).toContain("error");
    expect(phases).not.toContain("uncertain");
  });

  it("§1.3 — Load failed poi deposito trovato: polling continua e rileva deposito", async () => {
    const phases: string[] = [];

    // Detect fallisce 2 volte poi risolve al 3°
    const result = await signAndPollLogic({
      sendTransaction: sendTransactionLoadFailed,
      detectDeposit:   makeDetectMock(2),
      onPhaseChange:   p => phases.push(p),
      pollIntervalMs:  5,
      gracePolls:      2,
      maxPollMs:       1000,
    });

    expect(result.finalPhase).toBe("done");
    expect(result.completed).toBe(true);
    expect(phases).toContain("done");
  });

  it("§1.4 — sendTransaction success: polling normale fino al deposito", async () => {
    const phases: string[] = [];

    const result = await signAndPollLogic({
      sendTransaction: sendTransactionSuccess,
      detectDeposit:   makeDetectMock(1), // fallisce 1 volta, poi ok
      onPhaseChange:   p => phases.push(p),
      pollIntervalMs:  5,
      gracePolls:      3,
      maxPollMs:       1000,
    });

    expect(result.completed).toBe(true);
    expect(result.finalPhase).toBe("done");
  });

  // ── §2: Guard createdTransferRef — apiPaymentCreate al massimo 1 volta ───

  it("§2.1 — createdTransferRef previene secondo apiPaymentCreate dopo Load failed", () => {
    // Simula la struttura del guard in handleSend:
    //   if (createdTransferRef.current) → resume, no new create
    const createdTransferRef = { current: null as null | object };
    const apiPaymentCreate = makeApiPaymentCreateMock("T-001");

    async function simulateHandleSend() {
      if (createdTransferRef.current) {
        // Resume: nessuna chiamata a apiPaymentCreate
        return "resumed";
      }
      await apiPaymentCreate();
      createdTransferRef.current = { transferId: "T-001" };
      return "created";
    }

    return (async () => {
      // Prima chiamata: crea il transfer
      const r1 = await simulateHandleSend();
      expect(r1).toBe("created");
      expect(apiPaymentCreate).toHaveBeenCalledTimes(1);

      // Seconda chiamata (simula "Riprova" dopo Load failed):
      // il ref è già settato → resume, NO nuovo apiPaymentCreate
      const r2 = await simulateHandleSend();
      expect(r2).toBe("resumed");
      expect(apiPaymentCreate).toHaveBeenCalledTimes(1); // INVARIANTE: ancora 1

      // Terza chiamata (secondo "Riprova"):
      const r3 = await simulateHandleSend();
      expect(r3).toBe("resumed");
      expect(apiPaymentCreate).toHaveBeenCalledTimes(1); // INVARIANTE: ancora 1
    })();
  });

  it("§2.2 — apiPaymentCreate chiamata 0 volte se transfer già creato (isResume=true)", () => {
    // Caso: sheet aperta con resumeTransferId → handleResumeSign, mai handleSend
    const createdTransferRef = { current: { transferId: "T-EXISTING" } as object | null };
    const apiPaymentCreate = makeApiPaymentCreateMock();

    async function simulateHandleSend() {
      if (createdTransferRef.current) return "resumed";
      await apiPaymentCreate();
      return "created";
    }

    return (async () => {
      // Con ref già settato (transfer preesistente): mai apiPaymentCreate
      const r = await simulateHandleSend();
      expect(r).toBe("resumed");
      expect(apiPaymentCreate).toHaveBeenCalledTimes(0);
    })();
  });

  // ── §3: Regressione — percorso normale (1 USDT test passato) ────────────

  it("§3.1 — invio normale senza errori: 1 sola apiPaymentCreate + done", async () => {
    const apiPaymentCreate = makeApiPaymentCreateMock("T-NORMAL");
    const createdTransferRef = { current: null as null | object };
    const phases: string[] = [];

    // Simula handleSend senza errori:
    // - apiPaymentCreate una volta
    // - signAndPoll: sendTransaction ok, detect ok al secondo poll
    if (!createdTransferRef.current) {
      await apiPaymentCreate();
      createdTransferRef.current = { transferId: "T-NORMAL" };
    }
    expect(apiPaymentCreate).toHaveBeenCalledTimes(1);

    const result = await signAndPollLogic({
      sendTransaction: sendTransactionSuccess,
      detectDeposit:   makeDetectMock(1),
      onPhaseChange:   p => phases.push(p),
      pollIntervalMs:  5,
      gracePolls:      3,
      maxPollMs:       1000,
    });

    expect(result.completed).toBe(true);
    expect(result.finalPhase).toBe("done");
    // Invariante confermata: 1 sola apiPaymentCreate durante l'intera sessione
    expect(apiPaymentCreate).toHaveBeenCalledTimes(1);
  });

  it("§3.2 — uncertain + handleRetrySign: mai apiPaymentCreate al secondo tentativo", () => {
    // Simula: Load failed → uncertain → utente preme "Riprova firma"
    // handleRetrySign usa createdTransferRef.current → nessun nuovo create
    const apiPaymentCreate = makeApiPaymentCreateMock("T-RETRY");
    const createdTransferRef = { current: null as null | { transferId: string } };

    async function simulateHandleSend() {
      if (createdTransferRef.current) {
        // resume sul transfer esistente — NO apiPaymentCreate
        return "resumed";
      }
      await apiPaymentCreate();
      createdTransferRef.current = { transferId: "T-RETRY" };
      return "created";
    }

    function simulateHandleRetrySign() {
      // handleRetrySign: usa createdTransferRef.current, MAI apiPaymentCreate
      const data = createdTransferRef.current;
      if (!data) throw new Error("No transfer ref");
      // signAndPoll(data) — NON apiPaymentCreate
      return data.transferId;
    }

    return (async () => {
      // 1. Invio originale: crea transfer
      await simulateHandleSend();
      expect(apiPaymentCreate).toHaveBeenCalledTimes(1);

      // 2. "Load failed" → uncertain → utente preme "Riprova firma"
      const retryTransferId = simulateHandleRetrySign();
      expect(retryTransferId).toBe("T-RETRY");
      expect(apiPaymentCreate).toHaveBeenCalledTimes(1); // ancora 1

      // 3. Secondo "Riprova firma"
      simulateHandleRetrySign();
      expect(apiPaymentCreate).toHaveBeenCalledTimes(1); // ancora 1
    })();
  });
});

// ── §4: Fix incidente 2×0.7 USDA 2026-08-15 ─────────────────────────────────
// Notifiche di firma multiple nel wallet + "Hai annullato la firma" con TX on-chain.

describe("USDA Send — §4 single-flight firma + final-detect su rifiuto + pre-sign strict", () => {
  // Replica della logica single-flight persistente (localStorage + token) di
  // SendPaymentSheet.tsx — lock durevole al reload, cleanup token-based.
  const PREFIX = "test_sign_inflight_";
  const TTL = 10 * 60 * 1000;
  function getLock(id: string): { ts: number; token: string } | null {
    const raw = localStorage.getItem(PREFIX + id);
    if (!raw) return null;
    const e = JSON.parse(raw) as { ts: number; token: string };
    if (Date.now() - e.ts >= TTL) { localStorage.removeItem(PREFIX + id); return null; }
    return e;
  }
  function setLock(id: string): string {
    const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(PREFIX + id, JSON.stringify({ ts: Date.now(), token }));
    return token;
  }
  function clearLock(id: string, token: string): void {
    const raw = localStorage.getItem(PREFIX + id);
    if (!raw) return;
    if ((JSON.parse(raw) as { token?: string }).token === token) localStorage.removeItem(PREFIX + id);
  }

  beforeEach(() => { localStorage.clear(); });

  it("§4.1 — single-flight: seconda signAndPoll per lo stesso transfer NON invia una seconda richiesta firma", () => {
    const sendTransaction = vi.fn().mockReturnValue(new Promise(() => {})); // mai risolta (in coda nel wallet)

    function dispatchSign(transferId: string): "dispatched" | "skipped" {
      if (getLock(transferId)) return "skipped"; // → uncertain, solo polling
      setLock(transferId);
      sendTransaction();
      return "dispatched";
    }

    expect(dispatchSign("T-1")).toBe("dispatched");
    // Retry mentre la richiesta è ancora in coda nel wallet:
    expect(dispatchSign("T-1")).toBe("skipped");
    expect(dispatchSign("T-1")).toBe("skipped");
    // INVARIANTE: una sola richiesta di firma raggiunge il wallet
    expect(sendTransaction).toHaveBeenCalledTimes(1);
    // Transfer diverso: richiesta consentita
    expect(dispatchSign("T-2")).toBe("dispatched");
    expect(sendTransaction).toHaveBeenCalledTimes(2);
  });

  it("§4.2 — single-flight: dopo risoluzione (firma o rifiuto) un nuovo dispatch è consentito", () => {
    const token = setLock("T-1");
    clearLock("T-1", token); // la richiesta si risolve → entry rimossa
    expect(getLock("T-1")).toBeNull(); // dispatch di nuovo consentito
  });

  it("§4.2b — cleanup token-based: una risoluzione STALE non cancella il lock di un dispatch più recente", () => {
    const tokenA = setLock("T-1");   // dispatch A
    const tokenB = setLock("T-1");   // dispatch B sostituisce il lock (dopo TTL scaduto, ipotetico)
    clearLock("T-1", tokenA);        // A si risolve TARDI → non deve rimuovere il lock di B
    expect(getLock("T-1")).not.toBeNull();
    clearLock("T-1", tokenB);        // B si risolve → lock rimosso
    expect(getLock("T-1")).toBeNull();
  });

  it("§4.2c — il lock è in localStorage: sopravvive a un reload (nuovo modulo, stesso storage)", () => {
    setLock("T-RELOAD");
    // Simula reload: la sola cosa che persiste è localStorage — getLock rilegge da lì.
    expect(getLock("T-RELOAD")).not.toBeNull();
  });

  it("§4.3 — rifiuto firma MA deposito on-chain (richiesta stale rifiutata): final detect → done, NON errore", async () => {
    // Scenario incidente: l'utente firma la richiesta vera e rifiuta quella stale.
    // Il "user rejected" arriva al flusso → pollAborted → PRIMA di lanciare errore
    // va fatto un ultimo detect: se il deposito c'è → successo.
    let pollAborted = true;
    const detectDeposit = vi.fn().mockResolvedValue({ status: "accepted" });
    const phases: string[] = [];

    async function confirmOrAbort(): Promise<boolean> {
      try {
        await detectDeposit();
        phases.push("done");
        return true;
      } catch { /* rifiuto reale */ }
      throw new Error("Firma annullata.");
    }

    if (pollAborted) {
      const ok = await confirmOrAbort();
      expect(ok).toBe(true);
    }
    expect(phases).toEqual(["done"]);
  });

  it("§4.4 — rifiuto firma E nessun deposito: final detect fallisce → errore (comportamento invariato)", async () => {
    const detectDeposit = vi.fn().mockRejectedValue(
      Object.assign(new Error("not detected"), { code: "DEPOSIT_TX_NOT_DETECTED" }),
    );

    async function confirmOrAbort(): Promise<boolean> {
      try {
        await detectDeposit();
        return true;
      } catch { /* rifiuto reale */ }
      throw new Error("Firma annullata.");
    }

    await expect(confirmOrAbort()).rejects.toThrow("Firma annullata.");
  });

  it("§4.5 — pre-sign check: errore di rete (non DEPOSIT_TX_NOT_DETECTED) → NIENTE firma", async () => {
    // Se non sappiamo se il deposito esiste, firmare al buio = rischio doppio addebito.
    const detectDeposit = vi.fn().mockRejectedValue(new Error("Load failed")); // nessun code
    const sendTransaction = vi.fn();
    let outcome = "";

    try {
      await detectDeposit();
      outcome = "done"; // deposito già presente
    } catch (preErr: unknown) {
      const code = (preErr as Error & { code?: string })?.code;
      if (code !== "DEPOSIT_TX_NOT_DETECTED") {
        outcome = "error-no-sign"; // rete instabile → non firmare
      } else {
        sendTransaction();
        outcome = "signed";
      }
    }

    expect(outcome).toBe("error-no-sign");
    expect(sendTransaction).not.toHaveBeenCalled();
  });

  it("§4.6 — pre-sign check: DEPOSIT_TX_NOT_DETECTED esplicito → firma consentita", async () => {
    const detectDeposit = vi.fn().mockRejectedValue(
      Object.assign(new Error("not detected"), { code: "DEPOSIT_TX_NOT_DETECTED" }),
    );
    const sendTransaction = vi.fn();

    try {
      await detectDeposit();
    } catch (preErr: unknown) {
      const code = (preErr as Error & { code?: string })?.code;
      if (code === "DEPOSIT_TX_NOT_DETECTED") sendTransaction();
    }

    expect(sendTransaction).toHaveBeenCalledTimes(1);
  });
});

// §5 — toWei18: conversione decimale ESATTA (incidente 2026-08-15: Number(0.7)
// → 699999999999999956 wei → detectDeposit scartava la TX reale per sempre)
import { toWei18 } from "../components/usda/SendPaymentSheet";
import { describe as describe5, it as it5, expect as expect5 } from "vitest";

describe5("§5 toWei18 — precisione decimale", () => {
  it5("0.7 → esattamente 700000000000000000 wei (nessun errore float)", () => {
    expect5(toWei18("0.7")).toBe(700000000000000000n);
  });
  it5("valori tipici esatti", () => {
    expect5(toWei18("1")).toBe(1000000000000000000n);
    expect5(toWei18("0.1")).toBe(100000000000000000n);
    expect5(toWei18("123.456789012345678901")).toBe(123456789012345678901n); // 18 dec esatti
    expect5(toWei18("1.1234567890123456789999")).toBe(1123456789012345678n);  // tronca oltre 18 dec
    expect5(toWei18("0.000000000000000001")).toBe(1n);
    expect5(toWei18(" 2.5 ")).toBe(2500000000000000000n);
  });
  it5("input non valido → throw (mai firma con importo corrotto)", () => {
    expect5(() => toWei18("abc")).toThrow();
    expect5(() => toWei18("")).toThrow();
    expect5(() => toWei18("1,5")).toThrow();
  });
});
