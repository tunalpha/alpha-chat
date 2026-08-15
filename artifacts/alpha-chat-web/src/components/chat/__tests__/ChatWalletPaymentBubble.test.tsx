/**
 * ChatWalletPaymentBubble — Safety Net Tests
 *
 * Verifica il safety net History + Notifications (useEffect su status "confirmed"):
 *
 *  1. confirmed + IDB assente → saveTxRecord chiamato una volta
 *  2. confirmed + IDB già presente → nessun duplicato (saveTxRecord skip)
 *  3. stesso confirmed re-renderizzato → 1 record (ref guard)
 *  4. sender (isMine=true) → direction "out"
 *  5. receiver (isMine=false) → direction "in"
 *  6. notification sender → type "sent"
 *  7. notification receiver → type "received"
 *  8. txHash vuoto → nessun record creato
 *  9. status "sent" → safety net NON scatta
 * 10. BSC USDT → funzionante (chainId 56, asset USDT)
 * 11. USDA Polygon → funzionante (chainId 137, asset USDA)
 * 12. Dimensioni bolla → cp-bubble presente, direction label corretta
 */

import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ChatWalletPaymentBubble } from "../ChatWalletPaymentBubble";
import type { WalletPaymentMeta } from "../ChatWalletPaymentBubble";

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockGetTxRecordByHash    = vi.fn();
const mockSaveTxRecord         = vi.fn();
const mockUpdateTxStatus       = vi.fn();
const mockDispatchNotification = vi.fn();
const mockGetEvmReceipt        = vi.fn();

vi.mock("../../../wallet/services/tx-store", () => ({
  getTxRecordByHash: (...args: unknown[]) => mockGetTxRecordByHash(...args),
  saveTxRecord:      (...args: unknown[]) => mockSaveTxRecord(...args),
  updateTxStatus:    (...args: unknown[]) => mockUpdateTxStatus(...args),
}));

vi.mock("../../../wallet/notifications/wallet-notification-store", () => ({
  dispatchWalletNotification: (...args: unknown[]) => mockDispatchNotification(...args),
}));

vi.mock("../../../lib/alpha-wallet-api", () => ({
  apiWalletGetEvmReceipt: (...args: unknown[]) => mockGetEvmReceipt(...args),
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

const TX_USDA = "0xdeadbeef111122223333444455556666777788889999aaaabbbbcccc0000dead";
const TX_BSC  = "0x1234cafe111122223333444455556666777788889999aaaabbbbcccc0000cafe";

function makeMeta(overrides: Partial<WalletPaymentMeta> = {}): WalletPaymentMeta {
  return {
    txHash:      TX_USDA,
    network:     "polygon",
    assetSymbol: "USDA",
    amount:      "1",
    fee:         "0.001",
    direction:   "out",          // sempre "out" nel meta — la direction reale viene da isMine
    status:      "confirmed",    // confirmed → useLiveTxStatus restituisce subito "confirmed"
    explorerUrl: `https://polygonscan.com/tx/${TX_USDA}`,
    ...overrides,
  };
}

// ── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  // Default: nessun record IDB, nessun receipt (non dovrebbe servire se initial="confirmed")
  mockGetTxRecordByHash.mockResolvedValue(undefined);
  mockSaveTxRecord.mockResolvedValue(undefined);
  mockDispatchNotification.mockResolvedValue(true);
  mockUpdateTxStatus.mockResolvedValue(undefined);
  mockGetEvmReceipt.mockResolvedValue({ status: "pending" });
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("ChatWalletPaymentBubble — safety net History + Notifications", () => {

  // ── CASE 1: confirmed + IDB assente → saveTxRecord chiamato una volta ────

  it("CASE 1 — confirmed + IDB assente: saveTxRecord chiamato 1 volta", async () => {
    mockGetTxRecordByHash.mockResolvedValue(undefined); // no existing record

    render(<ChatWalletPaymentBubble meta={makeMeta()} isMine={true} />);

    await waitFor(() => {
      expect(mockSaveTxRecord).toHaveBeenCalledTimes(1);
    });
  });

  // ── CASE 2: confirmed + IDB già presente → skip saveTxRecord, MA dispatch notifica ──

  it("CASE 2 — confirmed + IDB presente: nessun saveTxRecord, MA notifica dispatched", async () => {
    // Il bridge/tx-monitor ha già salvato un record pending→confirmed.
    // Il safety net NON crea un secondo record (dedup per id),
    // MA dispatcha comunque la notifica (il bridge non lo fa mai, solo _processEvmTx).
    mockGetTxRecordByHash.mockResolvedValue({
      id: `137:${TX_USDA}:out:chat`,   // record del bridge (id con suffisso :chat)
      chainId: 137,
      network: "Polygon",
      txHash: TX_USDA,
      direction: "out",
      asset: "USDA",
      amount: "1",
      timestamp: Date.now(),
      status: "confirmed",
      updatedAt: Date.now(),
    });

    render(<ChatWalletPaymentBubble meta={makeMeta()} isMine={true} />);

    await waitFor(() => {
      // Record NON creato (esiste già)
      expect(mockSaveTxRecord).not.toHaveBeenCalled();
      // Notifica dispatched comunque (bridge e _reconcilePendingEvm non la dispatcano)
      expect(mockDispatchNotification).toHaveBeenCalledTimes(1);
    });
  });

  // ── CASE 3: stesso confirmed, re-render multipli → 1 record, 1 notifica ──

  it("CASE 3 — re-render multipli: 1 solo saveTxRecord + 1 sola notifica (ref guard)", async () => {
    mockGetTxRecordByHash.mockResolvedValue(undefined);
    const meta = makeMeta();
    const onConfirmed = vi.fn();

    const { rerender } = render(<ChatWalletPaymentBubble meta={meta} isMine={true} onConfirmed={onConfirmed} />);
    // Forza re-render con stesse props
    rerender(<ChatWalletPaymentBubble meta={meta} isMine={true} onConfirmed={onConfirmed} />);
    rerender(<ChatWalletPaymentBubble meta={meta} isMine={true} onConfirmed={onConfirmed} />);

    await waitFor(() => {
      expect(mockSaveTxRecord).toHaveBeenCalledTimes(1);
      expect(mockDispatchNotification).toHaveBeenCalledTimes(1);
      expect(onConfirmed).toHaveBeenCalledTimes(1);
    });
  });

  // ── CASE 4: sender → direction "out" ─────────────────────────────────────

  it("CASE 4 — sender (isMine=true): direction out", async () => {
    mockGetTxRecordByHash.mockResolvedValue(undefined);

    render(<ChatWalletPaymentBubble meta={makeMeta()} isMine={true} />);

    await waitFor(() => {
      expect(mockSaveTxRecord).toHaveBeenCalledWith(
        expect.objectContaining({ direction: "out" })
      );
    });
  });

  // ── CASE 5: receiver → direction "in" ────────────────────────────────────

  it("CASE 5 — receiver (isMine=false): direction in", async () => {
    mockGetTxRecordByHash.mockResolvedValue(undefined);

    render(<ChatWalletPaymentBubble meta={makeMeta()} isMine={false} />);

    await waitFor(() => {
      expect(mockSaveTxRecord).toHaveBeenCalledWith(
        expect.objectContaining({ direction: "in" })
      );
    });
  });

  // ── CASE 6: notification sender → type "sent" ─────────────────────────────

  it("CASE 6 — sender: dispatchWalletNotification type='sent'", async () => {
    mockGetTxRecordByHash.mockResolvedValue(undefined);

    render(<ChatWalletPaymentBubble meta={makeMeta()} isMine={true} />);

    await waitFor(() => {
      expect(mockDispatchNotification).toHaveBeenCalledWith(
        expect.objectContaining({ type: "sent" })
      );
    });
  });

  // ── CASE 7: notification receiver → type "received" ──────────────────────

  it("CASE 7 — receiver: dispatchWalletNotification type='received'", async () => {
    mockGetTxRecordByHash.mockResolvedValue(undefined);

    render(<ChatWalletPaymentBubble meta={makeMeta()} isMine={false} />);

    await waitFor(() => {
      expect(mockDispatchNotification).toHaveBeenCalledWith(
        expect.objectContaining({ type: "received" })
      );
    });
  });

  // ── CASE 8: txHash vuoto → nessun record ─────────────────────────────────

  it("CASE 8 — txHash vuoto: nessun saveTxRecord", async () => {
    render(<ChatWalletPaymentBubble meta={makeMeta({ txHash: "" })} isMine={true} />);

    await new Promise(r => setTimeout(r, 80));

    expect(mockSaveTxRecord).not.toHaveBeenCalled();
    expect(mockDispatchNotification).not.toHaveBeenCalled();
  });

  // ── CASE 9: status "sent" → safety net non scatta ────────────────────────

  it("CASE 9 — status 'sent': safety net NON scatta", async () => {
    // status=sent → useLiveTxStatus non è confirmed → useEffect esce subito
    // mockGetEvmReceipt ritorna pending → status resta "sent"
    mockGetEvmReceipt.mockResolvedValue({ status: "pending" });

    render(<ChatWalletPaymentBubble meta={makeMeta({ status: "sent" })} isMine={true} />);

    await new Promise(r => setTimeout(r, 100));

    expect(mockSaveTxRecord).not.toHaveBeenCalled();
    expect(mockDispatchNotification).not.toHaveBeenCalled();
  });

  // ── CASE 10: BSC/USDT → funzionante ─────────────────────────────────────

  it("CASE 10 — BSC USDT: safety net funzionante (chainId 56)", async () => {
    mockGetTxRecordByHash.mockResolvedValue(undefined);

    render(
      <ChatWalletPaymentBubble
        meta={makeMeta({ txHash: TX_BSC, network: "bsc", assetSymbol: "USDT", amount: "1.00" })}
        isMine={true}
      />
    );

    await waitFor(() => {
      expect(mockSaveTxRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          chainId: 56,
          network: "BSC",
          asset:   "USDT",
          amount:  "1.00",
          direction: "out",
        })
      );
    });
  });

  // ── CASE 11: USDA Polygon → funzionante ──────────────────────────────────

  it("CASE 11 — USDA Polygon: safety net funzionante (chainId 137)", async () => {
    mockGetTxRecordByHash.mockResolvedValue(undefined);

    render(<ChatWalletPaymentBubble meta={makeMeta()} isMine={false} />);

    await waitFor(() => {
      expect(mockSaveTxRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          chainId:   137,
          network:   "Polygon",
          asset:     "USDA",
          amount:    "1",
          direction: "in",
          txHash:    TX_USDA,
          status:    "confirmed",
        })
      );
    });
  });

  // ── CASE 12: dimensioni bolla — direction label corretta ─────────────────

  it("CASE 12 — bubble: sender vede CRIPTO INVIATA, receiver vede CRIPTO RICEVUTA", () => {
    const { rerender } = render(
      <ChatWalletPaymentBubble meta={makeMeta()} isMine={true} />
    );
    expect(screen.getByText("CRIPTO INVIATA")).toBeInTheDocument();

    rerender(<ChatWalletPaymentBubble meta={makeMeta()} isMine={false} />);
    expect(screen.getByText("CRIPTO RICEVUTA")).toBeInTheDocument();
  });

});

// ── Regression: idempotenza cross-sessione ────────────────────────────────────

describe("ChatWalletPaymentBubble — idempotenza cross-sessione", () => {

  it("RELOAD — se record già in IDB, skip saveTxRecord MA dispatch notifica (idempotente)", async () => {
    // Scenario: reload dopo che tx-monitor aveva già salvato il record.
    // Il safety net non crea un secondo record (dedup IDB per id).
    // MA dispatcha la notifica: dispatchWalletNotification ha dedup interno
    // → saveNotification ritorna false se dedupKey già presente → no duplicato reale.
    mockGetTxRecordByHash.mockResolvedValue({
      id: `137:${TX_USDA}:in:`,      // record del tx-monitor
      chainId: 137,
      network: "Polygon",
      txHash: TX_USDA,
      direction: "in",
      asset: "USDA",
      amount: "1",
      timestamp: Date.now(),
      status: "confirmed",
      updatedAt: Date.now(),
    });

    // Simula secondo mount (dopo reload) con stessa TX
    render(<ChatWalletPaymentBubble meta={makeMeta()} isMine={false} />);

    await waitFor(() => {
      // Record NON creato di nuovo
      expect(mockSaveTxRecord).not.toHaveBeenCalled();
      // Notifica dispatched (dedup reale è in saveNotification, non nel mock)
      expect(mockDispatchNotification).toHaveBeenCalledTimes(1);
    });
  });

  it("DUPLICATE WS — stessa TX montata due volte: saveTxRecord max 1 per istanza (IDB dedup reale)", async () => {
    // Scenario: WS consegna lo stesso messaggio due volte → due istanze del bubble
    // con lo stesso txHash. Il safety net di ogni istanza chiama getTxRecordByHash.
    // Prima istanza: nessun record → salva
    // Seconda istanza: stesso check → il saveTxRecord reale userebbe dedup per id,
    //                  qui verifichiamo che getTxRecordByHash sia chiamato per entrambe.
    mockGetTxRecordByHash.mockResolvedValue(undefined); // entrambe le istanze trovano nessun record

    const meta = makeMeta();
    render(
      <div>
        <ChatWalletPaymentBubble key="a" meta={meta} isMine={true} />
        <ChatWalletPaymentBubble key="b" meta={meta} isMine={true} />
      </div>
    );

    await waitFor(() => {
      // Entrambe le istanze chiamano getTxRecordByHash (ogni istanza ha ref propria)
      expect(mockGetTxRecordByHash).toHaveBeenCalledWith(TX_USDA);
    });

    // In produzione saveTxRecord è idempotente per id → 1 record nell'IDB.
    // In questo mock test, saveTxRecord è chiamato da entrambe le istanze
    // (ogni istanza ha il proprio bootstrappedRef), ma i dati scritti sarebbero
    // identici (stessa id = "137:TX_USDA:out:") → IDB reale ne salva solo uno.
    // Verifichiamo che asset e direction siano corretti per entrambe le call.
    await waitFor(() => {
      expect(mockSaveTxRecord).toHaveBeenCalledWith(
        expect.objectContaining({ asset: "USDA", direction: "out", chainId: 137 })
      );
    });
  });

});
