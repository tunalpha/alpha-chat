/**
 * CRITICAL — BTC→EVM Swap Direction Guard
 *
 * Verifica che Alpha NON marchi mai uno swap BTC→EVM come "completed"
 * basandosi su un risultato Li.Fi DONE che appartiene in realtà a un vecchio
 * swap nella direzione opposta (EVM→BTC).
 *
 * Caso diagnosticato (2026-08-18):
 *   TX BTC 96b55dc7... ricevuta dall'utente come output di USDT→BTC.
 *   Alpha interroga Li.Fi con quella TX per un nuovo BTC→USDT.
 *   Li.Fi restituisce DONE (perché la TX è registrata come receiving del vecchio swap).
 *   Alpha marcava erroneamente il nuovo swap come COMPLETED.
 *
 * QUESTI TEST DEVONO PASSARE PRIMA DI OGNI DEPLOY.
 */

import { describe, it, expect } from "vitest";

// Importa la funzione pura di validazione (esportata con _ per uso test)
import { _validateBtcToEvmDone } from "../../swap/evm/useEvmSwapState.js";

// Importa getLiFiStatus e LiFiStatusResult per verificare l'estrazione di receivingChainId
import { getLiFiStatus, type LiFiStatusResult } from "../../swap/evm/lifi-client.js";

// BTC chain ID usato da Li.Fi
const BTC_CHAIN_ID = 20000000000001;

// ─────────────────────────────────────────────────────────────────────────────
// _validateBtcToEvmDone — pura, nessuna dipendenza esterna
// ─────────────────────────────────────────────────────────────────────────────

describe("_validateBtcToEvmDone — CASO A: vecchio USDT→BTC, Li.Fi restituisce receiving=BTC", () => {
  /**
   * Scenario: Li.Fi trova la TX BTC come receiving di un vecchio USDT→BTC swap.
   * receiving.chainId = BTC_CHAIN_ID ≠ capturedToChainId (1=ETH)
   * RISULTATO ATTESO: NON COMPLETED (valid=false)
   */
  it("DONE + receiving.chainId=BTC_CHAIN_ID != ETH(1) → MISMATCH, non completed", () => {
    const result: Pick<LiFiStatusResult, "status" | "receivingChainId"> = {
      status:           "DONE",
      receivingChainId: BTC_CHAIN_ID,  // ← BTC, non ETH
    };
    const capturedToChainId = 1; // ETH

    const { valid, reason } = _validateBtcToEvmDone(result, capturedToChainId);

    expect(valid).toBe(false);
    expect(reason).toContain("MISMATCH");
    expect(reason).toContain(String(BTC_CHAIN_ID));
    expect(reason).toContain("1");
  });

  it("la TX 96b55dc7 (incident BTC) non può mai produrre phase:completed su BTC→ETH", () => {
    // Simula esattamente il risultato Li.Fi dell'incidente diagnosticato
    const lifiIncidentResult: Pick<LiFiStatusResult, "status" | "receivingChainId"> = {
      status:           "DONE",
      receivingChainId: BTC_CHAIN_ID,   // Li.Fi ha trovato la TX come receiving di USDT→BTC
    };

    const { valid } = _validateBtcToEvmDone(lifiIncidentResult, 1 /* ETH */);
    expect(valid).toBe(false); // MUST NOT produce completed
  });

  it("receiving.chainId=BTC, swap destinazione Polygon(137) → MISMATCH", () => {
    const result = { status: "DONE" as const, receivingChainId: BTC_CHAIN_ID };
    const { valid } = _validateBtcToEvmDone(result, 137);
    expect(valid).toBe(false);
  });

  it("receiving.chainId=BTC, swap destinazione BSC(56) → MISMATCH", () => {
    const result = { status: "DONE" as const, receivingChainId: BTC_CHAIN_ID };
    const { valid } = _validateBtcToEvmDone(result, 56);
    expect(valid).toBe(false);
  });
});

describe("_validateBtcToEvmDone — CASO B: vero BTC→ETH completato", () => {
  /**
   * Scenario: Li.Fi restituisce DONE con receiving.chainId = 1 (ETH).
   * RISULTATO ATTESO: COMPLETED (valid=true)
   */
  it("DONE + receiving.chainId=1 (ETH) + capturedToChainId=1 → VALID, completed", () => {
    const result: Pick<LiFiStatusResult, "status" | "receivingChainId"> = {
      status:           "DONE",
      receivingChainId: 1, // ETH — receiving è la chain EVM di destinazione ✓
    };
    const capturedToChainId = 1;

    const { valid, reason } = _validateBtcToEvmDone(result, capturedToChainId);

    expect(valid).toBe(true);
    expect(reason).toContain("VALID");
  });

  it("DONE + receiving.chainId=137 (Polygon) + capturedToChainId=137 → VALID", () => {
    const result = { status: "DONE" as const, receivingChainId: 137 };
    const { valid } = _validateBtcToEvmDone(result, 137);
    expect(valid).toBe(true);
  });

  it("DONE + receiving.chainId=56 (BSC) + capturedToChainId=56 → VALID", () => {
    const result = { status: "DONE" as const, receivingChainId: 56 };
    const { valid } = _validateBtcToEvmDone(result, 56);
    expect(valid).toBe(true);
  });

  it("DONE + receiving.chainId=42161 (Arbitrum) + capturedToChainId=42161 → VALID", () => {
    const result = { status: "DONE" as const, receivingChainId: 42161 };
    const { valid } = _validateBtcToEvmDone(result, 42161);
    expect(valid).toBe(true);
  });
});

describe("_validateBtcToEvmDone — CASO C: DONE ma destination chain errata (non BTC)", () => {
  /**
   * Scenario: capturedToChainId=1 (ETH), ma Li.Fi risponde con receiving.chainId=137 (Polygon).
   * RISULTATO ATTESO: NON COMPLETED
   */
  it("DONE + receiving.chainId=137 != capturedToChainId=1 → MISMATCH", () => {
    const result = { status: "DONE" as const, receivingChainId: 137 };
    const { valid } = _validateBtcToEvmDone(result, 1);
    expect(valid).toBe(false);
  });

  it("DONE + receiving.chainId=1 != capturedToChainId=56 → MISMATCH", () => {
    const result = { status: "DONE" as const, receivingChainId: 1 };
    const { valid } = _validateBtcToEvmDone(result, 56);
    expect(valid).toBe(false);
  });

  it("la ragione indica chiaramente quale chain è sbagliata", () => {
    const result = { status: "DONE" as const, receivingChainId: 137 };
    const { reason } = _validateBtcToEvmDone(result, 1);
    expect(reason).toContain("137");
    expect(reason).toContain("1");
    expect(reason).toContain("MISMATCH");
  });
});

describe("_validateBtcToEvmDone — CASO D: DONE ma receiving.chainId assente", () => {
  /**
   * Scenario: Li.Fi restituisce DONE ma non include receiving.chainId.
   * Direzione non verificabile → trattare come PENDING (non completed).
   * RISULTATO ATTESO: NON COMPLETED
   */
  it("DONE + receivingChainId=undefined → NON completed (direction unverifiable)", () => {
    const result: Pick<LiFiStatusResult, "status" | "receivingChainId"> = {
      status:           "DONE",
      receivingChainId: undefined,
    };
    const { valid, reason } = _validateBtcToEvmDone(result, 1);
    expect(valid).toBe(false);
    expect(reason).toContain("missing");
  });
});

describe("_validateBtcToEvmDone — CASO E: stati non-DONE (no regression EVM→BTC)", () => {
  /**
   * Verifica che status!=DONE ritorni sempre valid=false (come atteso —
   * solo DONE viene accettato come completamento).
   * Questo garantisce che il fix non rompa la logica per stati intermedi.
   */
  it("PENDING → valid=false (non è DONE)", () => {
    const result = { status: "PENDING" as const, receivingChainId: 1 };
    const { valid } = _validateBtcToEvmDone(result, 1);
    expect(valid).toBe(false);
  });

  it("FAILED → valid=false", () => {
    const result = { status: "FAILED" as const, receivingChainId: 1 };
    const { valid } = _validateBtcToEvmDone(result, 1);
    expect(valid).toBe(false);
  });

  it("INVALID → valid=false", () => {
    const result = { status: "INVALID" as const, receivingChainId: 1 };
    const { valid } = _validateBtcToEvmDone(result, 1);
    expect(valid).toBe(false);
  });

  it("NOT_FOUND → valid=false", () => {
    const result = { status: "NOT_FOUND" as const, receivingChainId: 1 };
    const { valid } = _validateBtcToEvmDone(result, 1);
    expect(valid).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// LiFiStatusResult — verifica che getLiFiStatus estragga receivingChainId
// ─────────────────────────────────────────────────────────────────────────────

describe("getLiFiStatus — estrazione receivingChainId e sendingChainId", () => {
  /**
   * Verifica che getLiFiStatus estragga correttamente i chainId da response.receiving
   * e response.sending — i campi necessari al direction guard.
   */

  it("response con receiving.chainId=1 → receivingChainId=1", async () => {
    const mockFetch = async () => ({
      ok:   true,
      json: async () => ({
        status:    "DONE",
        receiving: { chainId: 1, txHash: "0xabc123", amount: "1000000" },
        sending:   { chainId: BTC_CHAIN_ID },
      }),
    });

    const origFetch = globalThis.fetch;
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    try {
      const result = await getLiFiStatus("96b55dc7fake", BTC_CHAIN_ID, 1);
      expect(result.status).toBe("DONE");
      expect(result.receivingChainId).toBe(1);
      expect(result.sendingChainId).toBe(BTC_CHAIN_ID);
      expect(result.txHash).toBe("0xabc123");
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("response con receiving.chainId=BTC_CHAIN_ID → receivingChainId=BTC_CHAIN_ID (l'incident case)", async () => {
    // Simula esattamente la risposta Li.Fi dell'incidente diagnosticato
    const mockFetch = async () => ({
      ok:   true,
      json: async () => ({
        status:    "DONE",
        substatus: "COMPLETED",
        tool:      "layerswap",
        // receiving = BTC TX (la TX dell'utente era la destinazione del vecchio USDT→BTC)
        receiving: { chainId: BTC_CHAIN_ID, txHash: "96b55dc7ea0d7b34fd56a9383...", amount: "22745" },
        // sending = Ethereum (la sorgente era USDT su ETH del vecchio swap)
        sending:   { chainId: 1, value: 0 },
      }),
    });

    const origFetch = globalThis.fetch;
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    try {
      const result = await getLiFiStatus("96b55dc7ea0d7b34...", BTC_CHAIN_ID, 1);

      // La risposta è estratta correttamente
      expect(result.status).toBe("DONE");
      expect(result.receivingChainId).toBe(BTC_CHAIN_ID);
      expect(result.sendingChainId).toBe(1);

      // E il direction guard deve bloccarla
      const validation = _validateBtcToEvmDone(result, 1 /* ETH */);
      expect(validation.valid).toBe(false);  // ← QUESTO è il fix: non più completed
      expect(validation.reason).toContain("MISMATCH");
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("response HTTP !ok → status INVALID", async () => {
    const mockFetch = async () => ({
      ok:   false,
      json: async () => ({ message: "not found" }),
    });
    const origFetch = globalThis.fetch;
    globalThis.fetch = mockFetch as unknown as typeof fetch;
    try {
      const result = await getLiFiStatus("anyhash", BTC_CHAIN_ID, 1);
      expect(result.status).toBe("INVALID");
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("fetch che lancia eccezione → status PENDING (non crash)", async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error("network error"); };
    try {
      const result = await getLiFiStatus("anyhash", BTC_CHAIN_ID, 1);
      expect(result.status).toBe("PENDING");
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Anti-regression: il criterio precedente (solo status=DONE) era insufficiente
// ─────────────────────────────────────────────────────────────────────────────

describe("Anti-regression — il vecchio criterio 'status===DONE' era insufficiente", () => {
  it("dimostra che status=DONE + receiving=BTC sarebbe stato accettato prima del fix", () => {
    // Prima del fix, la logica era:
    const oldLogic = (status: string) => status === "DONE";

    const incidentResult = { status: "DONE", receivingChainId: BTC_CHAIN_ID };

    // Il vecchio codice avrebbe accettato questo come "completed" — BUG
    expect(oldLogic(incidentResult.status)).toBe(true); // ← era il bug

    // Il nuovo codice invece rifiuta correttamente
    const { valid } = _validateBtcToEvmDone(incidentResult, 1);
    expect(valid).toBe(false); // ← il fix
  });

  it("il flusso incidentale completo: BTC_TX_received → Li.Fi.DONE → NON completed", () => {
    // 1. L'utente riceve la TX BTC come output di un vecchio USDT→BTC swap
    const btcTxFromOldSwap = "96b55dc7ea0d7b34fd56a93835f890c1eca875eda4e63d740411731b6639281e";

    // 2. Li.Fi restituisce per quella TX (come prima):
    const liFiResponse: Pick<LiFiStatusResult, "status" | "receivingChainId"> = {
      status:           "DONE",
      receivingChainId: BTC_CHAIN_ID,  // ← BTC, non ETH
    };

    // 3. Il nuovo swap è BTC→USDT su Ethereum
    const newSwapToChain = 1; // ETH

    // 4. Con il fix: non viene mai marcato come completed
    const { valid } = _validateBtcToEvmDone(liFiResponse, newSwapToChain);
    expect(valid).toBe(false);

    // 5. La TX BTC non viene mai mostrata come "destination EVM TX"
    //    (il codice usa st.txHash solo se valid=true, e st.txHash sarebbe comunque
    //    la BTC TX, non una EVM TX — ma questo è gestito dal controllo valid)
    const _ = btcTxFromOldSwap; // confirma che la TX era nel sistema
    expect(valid).toBe(false);  // non può mai produrre completed
  });
});
