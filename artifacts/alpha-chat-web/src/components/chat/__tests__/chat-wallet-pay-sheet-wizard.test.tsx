/**
 * ChatWalletPaySheet — Wizard state machine tests
 *
 * Verifica:
 * 1.  Render step iniziale (recipient)
 * 2.  Caso A: recipient card visibile + avanzamento a step asset
 * 3.  Caso B: no-wallet card visibile + pulsante invito + passa a manuale
 * 4.  Caso C: manuale senza recipientUserId → step 1 con network selector
 * 5.  Navigazione back da step asset
 * 6.  Avanzamento da asset a amount
 * 7.  "Calcola costi" chiama calculateQuote e avanza a summary
 * 8.  Errore calculateQuote → rimane su amount con messaggio errore
 * 9.  Caso B invite → chiama onSendInvite + chiude
 * 10. Step summary mostra fee breakdown
 * 11. Back da summary → torna ad amount + invalida quote
 * 12. Firma e invia → chiama sendPayment
 * 13. Step auth: PIN submit risolve la promise e avanza
 * 14. Step auth: annulla torna a summary
 * 15. Success step dopo sendPayment riuscito
 * 16. Errore sendPayment → torna a summary con errore
 * 17. Chiusura foglio
 * 18. PIN troppo corto mostra errore
 * 19. Importo non valido blocca calcolo
 * 20. step "sending" non ha pulsanti di navigazione
 */

import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ChatWalletPaySheet } from "../ChatWalletPaySheet";

// ── Mocks ───────────────────────────────────────────────────────────────────

const mockCalculateQuote = vi.fn();
const mockSendPayment    = vi.fn();

vi.mock("../../../wallet/bridge/chat-wallet-bridge-context", () => ({
  useChatWalletBridge: () => ({
    calculateQuote:  mockCalculateQuote,
    sendPayment:     mockSendPayment,
    sendInProgress:  false,
  }),
}));

vi.mock("../../../lib/alpha-wallet-api", () => ({
  apiWalletGetRecipient: vi.fn(),
}));

// Mock LockContext — Face ID disabilitato nei test standard
vi.mock("../../../contexts/LockContext", () => ({
  useLock: () => ({
    hasBiometricSet:        false,
    canUseBiometric:        false,
    tryUnlockWithBiometric: vi.fn().mockResolvedValue(false),
  }),
}));

// Mock wallet-pin-seal — biometria non disponibile nei test standard
vi.mock("../../../wallet/security/wallet-pin-seal", () => ({
  useWalletFaceId:      () => ({ walletFaceIdEnabled: false, setWalletFaceIdEnabled: vi.fn() }),
  unsealWalletPin:      vi.fn().mockResolvedValue(null),
  sealWalletPin:        vi.fn().mockResolvedValue(undefined),
  clearSealedWalletPin: vi.fn(),
  hasSealedPin:         vi.fn().mockReturnValue(false),
}));

import { apiWalletGetRecipient } from "../../../lib/alpha-wallet-api";
const mockGetRecipient = apiWalletGetRecipient as ReturnType<typeof vi.fn>;

// ── Fixtures ─────────────────────────────────────────────────────────────────

const MOCK_QUOTE = {
  recipientAmount:  "1.000",
  platformFee:      "0.001",
  networkFee:       "0.001",
  networkFeeSymbol: "POL",
  totalAsset:       "1.001",
  frozenAt:         Date.now(),
  quoteValiditySec: 60,
};

const DEFAULT_PROPS = {
  onClose: vi.fn(),
  onSent:  vi.fn(),
};

function renderSheet(props: Partial<Parameters<typeof ChatWalletPaySheet>[0]> = {}) {
  return render(<ChatWalletPaySheet {...DEFAULT_PROPS} {...props} />);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("ChatWalletPaySheet — wizard steps", () => {

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetRecipient.mockResolvedValue({ hasAlphaWallet: true, evmAddress: "0xABCDEF1234567890abcdef1234567890abcdef12", btcAddress: null });
    mockCalculateQuote.mockResolvedValue(MOCK_QUOTE);
    mockSendPayment.mockResolvedValue({ status: "sent", txHash: "0xTX123" });
  });

  // 1. Render step iniziale
  it("mostra step 1 (recipient) al mount", () => {
    renderSheet();
    expect(screen.getByText("🔐 Paga con Alpha Wallet")).toBeInTheDocument();
    expect(screen.getByText("Destinatario · Rete")).toBeInTheDocument();
  });

  // 2. Caso A: recipient card + avanzamento
  it("Caso A: mostra recipient card Alpha Wallet dopo discovery", async () => {
    renderSheet({ recipientUserId: "user-1", recipientName: "Mario" });
    await waitFor(() => {
      expect(screen.getByText("ALPHA WALLET ✓")).toBeInTheDocument();
      expect(screen.getByText("Mario")).toBeInTheDocument();
    });
    // Avanza a step asset
    fireEvent.click(screen.getByText("Continua →"));
    expect(screen.getByText("Asset")).toBeInTheDocument();
  });

  // 3. Caso B: no-wallet card + invite + passa a manuale
  it("Caso B: mostra no-wallet card e pulsante invito", async () => {
    mockGetRecipient.mockResolvedValue({ hasAlphaWallet: false, evmAddress: null, btcAddress: null });
    const onSendInvite = vi.fn();
    renderSheet({ recipientUserId: "user-2", recipientName: "Luigi", onSendInvite });
    await waitFor(() => {
      expect(screen.getByText(/non ha ancora configurato Alpha Wallet/)).toBeInTheDocument();
    });
    // Invita
    fireEvent.click(screen.getByText(/Invita Luigi su Alpha Wallet/));
    expect(onSendInvite).toHaveBeenCalledOnce();
    expect(DEFAULT_PROPS.onClose).toHaveBeenCalledOnce();
  });

  // 4. Caso B → passa a manuale → vede network
  it("Caso B: usa indirizzo esterno passa a selezione rete", async () => {
    mockGetRecipient.mockResolvedValue({ hasAlphaWallet: false, evmAddress: null, btcAddress: null });
    renderSheet({ recipientUserId: "user-2", recipientName: "Luigi" });
    await waitFor(() => {
      expect(screen.getByText(/Usa indirizzo esterno/)).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText(/Usa indirizzo esterno/));
    await waitFor(() => {
      expect(screen.getByText("Rete")).toBeInTheDocument();
      expect(screen.getByText("Polygon")).toBeInTheDocument();
    });
  });

  // 5. Navigazione back da step asset
  it("back da step asset torna a step recipient", async () => {
    mockGetRecipient.mockResolvedValue({ hasAlphaWallet: true, evmAddress: "0xABCDEF1234567890abcdef1234567890abcdef12", btcAddress: null });
    renderSheet({ recipientUserId: "user-1" });
    await waitFor(() => fireEvent.click(screen.getByText("Continua →")));
    expect(screen.getByText("Asset")).toBeInTheDocument();
    fireEvent.click(screen.getByText("← Indietro"));
    expect(screen.getByText("Destinatario · Rete")).toBeInTheDocument();
  });

  // 6. Avanzamento da asset a amount
  it("avanza da asset ad amount", async () => {
    renderSheet({ recipientUserId: "user-1" });
    await waitFor(() => fireEvent.click(screen.getByText("Continua →")));
    expect(screen.getByText("Asset")).toBeInTheDocument();
    fireEvent.click(screen.getAllByText("Continua →")[0]);
    expect(screen.getByText("Importo")).toBeInTheDocument();
    expect(screen.getByText(/Quanto vuoi inviare/)).toBeInTheDocument();
  });

  // Helper: avanza fino ad amount step
  async function goToAmount(recipientId = "user-1") {
    renderSheet({ recipientUserId: recipientId, recipientName: "Mario" });
    await waitFor(() => fireEvent.click(screen.getByText("Continua →")));
    fireEvent.click(screen.getByText("Continua →"));
  }

  // 7. Calcola costi → chiama calculateQuote e avanza a summary
  it("Calcola costi chiama bridge.calculateQuote e avanza a summary", async () => {
    await goToAmount();
    const amountInput = screen.getByPlaceholderText("0.00");
    fireEvent.change(amountInput, { target: { value: "5" } });
    fireEvent.click(screen.getByText("Calcola costi →"));
    await waitFor(() => {
      expect(mockCalculateQuote).toHaveBeenCalledOnce();
      expect(screen.getByText("Riepilogo")).toBeInTheDocument();
      expect(screen.getByText("Riepilogo costi")).toBeInTheDocument();
    });
  });

  // 8. Errore calculateQuote → rimane su amount con messaggio
  it("errore calculateQuote mostra messaggio e rimane su amount", async () => {
    mockCalculateQuote.mockRejectedValue(new Error("Rete non disponibile"));
    await goToAmount();
    const amountInput = screen.getByPlaceholderText("0.00");
    fireEvent.change(amountInput, { target: { value: "5" } });
    fireEvent.click(screen.getByText("Calcola costi →"));
    await waitFor(() => {
      expect(screen.getByText("Rete non disponibile")).toBeInTheDocument();
      expect(screen.getByText("Importo")).toBeInTheDocument(); // rimasto su amount
    });
  });

  // 9. Caso B invite già testato (test 3)

  // 10. Step summary mostra fee breakdown
  it("summary mostra importo destinatario, fee e totale", async () => {
    await goToAmount();
    fireEvent.change(screen.getByPlaceholderText("0.00"), { target: { value: "1" } });
    fireEvent.click(screen.getByText("Calcola costi →"));
    await waitFor(() => {
      expect(screen.getByText(/1\.000/)).toBeInTheDocument();      // recipientAmount (hero)
      expect(screen.getByText(/0\.001 USDA/)).toBeInTheDocument(); // platformFee
      expect(screen.getByText(/1\.001/)).toBeInTheDocument();      // totalAsset
    });
  });

  // 11. Back da summary → torna ad amount
  it("back da summary torna ad amount", async () => {
    await goToAmount();
    fireEvent.change(screen.getByPlaceholderText("0.00"), { target: { value: "1" } });
    fireEvent.click(screen.getByText("Calcola costi →"));
    await waitFor(() => screen.getByText("← Modifica"));
    fireEvent.click(screen.getByText("← Modifica"));
    expect(screen.getByText("Importo")).toBeInTheDocument();
  });

  // 12. Firma e invia → chiama sendPayment
  it("Firma e invia chiama bridge.sendPayment", async () => {
    // sendPayment non chiamerà onAuthRequired in questo mock
    mockSendPayment.mockImplementation(async (_req, _auth) => {
      return { status: "sent", txHash: "0xTX" };
    });
    await goToAmount();
    fireEvent.change(screen.getByPlaceholderText("0.00"), { target: { value: "1" } });
    fireEvent.click(screen.getByText("Calcola costi →"));
    await waitFor(() => screen.getByText("🔐 Firma e invia"));
    fireEvent.click(screen.getByText("🔐 Firma e invia"));
    await waitFor(() => {
      expect(mockSendPayment).toHaveBeenCalledOnce();
    });
  });

  // 13. Step auth: PIN submit risolve la promise
  it("step auth: PIN submit avanza a sending", async () => {
    let resolveAuth!: (pin: string | null) => void;
    mockSendPayment.mockImplementation(async (_req, onAuthRequired) => {
      const pin = await onAuthRequired();
      if (!pin) return { status: "cancelled" };
      return { status: "sent", txHash: "0xTX" };
    });
    await goToAmount();
    fireEvent.change(screen.getByPlaceholderText("0.00"), { target: { value: "1" } });
    fireEvent.click(screen.getByText("Calcola costi →"));
    await waitFor(() => screen.getByText("🔐 Firma e invia"));
    fireEvent.click(screen.getByText("🔐 Firma e invia"));
    // Attende lo step auth
    await waitFor(() => {
      expect(screen.getByText("Conferma PIN")).toBeInTheDocument();
    });
    // Inserisce PIN
    fireEvent.change(screen.getByPlaceholderText("• • • •"), { target: { value: "1234" } });
    fireEvent.click(screen.getByText("Firma e invia"));
    // Avanza a sending poi success
    await waitFor(() => {
      expect(screen.getByText("Pagamento inviato")).toBeInTheDocument();
    });
  });

  // 14. Step auth: annulla torna a summary
  it("step auth: annulla torna a summary", async () => {
    mockSendPayment.mockImplementation(async (_req, onAuthRequired) => {
      const pin = await onAuthRequired();
      return { status: "cancelled" };
    });
    await goToAmount();
    fireEvent.change(screen.getByPlaceholderText("0.00"), { target: { value: "1" } });
    fireEvent.click(screen.getByText("Calcola costi →"));
    await waitFor(() => screen.getByText("🔐 Firma e invia"));
    fireEvent.click(screen.getByText("🔐 Firma e invia"));
    await waitFor(() => screen.getByText("Conferma PIN"));
    fireEvent.click(screen.getByText("Annulla"));
    await waitFor(() => {
      expect(screen.getByText("Riepilogo")).toBeInTheDocument();
    });
  });

  // 15. Success step
  it("success step dopo sendPayment riuscito", async () => {
    mockSendPayment.mockImplementation(async (_req, onAuthRequired) => {
      await onAuthRequired();
      return { status: "sent", txHash: "0xDEADBEEF" };
    });
    await goToAmount();
    fireEvent.change(screen.getByPlaceholderText("0.00"), { target: { value: "1" } });
    fireEvent.click(screen.getByText("Calcola costi →"));
    await waitFor(() => screen.getByText("🔐 Firma e invia"));
    fireEvent.click(screen.getByText("🔐 Firma e invia"));
    await waitFor(() => screen.getByText("Conferma PIN"));
    fireEvent.change(screen.getByPlaceholderText("• • • •"), { target: { value: "1234" } });
    fireEvent.click(screen.getByText("Firma e invia"));
    await waitFor(() => {
      expect(screen.getByText("Pagamento inviato")).toBeInTheDocument();
      expect(screen.getByText("✅")).toBeInTheDocument();
    });
  });

  // 16. Errore sendPayment → torna a summary con errore
  it("errore sendPayment mostra errore in summary", async () => {
    mockSendPayment.mockImplementation(async (_req, onAuthRequired) => {
      await onAuthRequired();
      return { status: "error", errorMessage: "Fondi insufficienti" };
    });
    await goToAmount();
    fireEvent.change(screen.getByPlaceholderText("0.00"), { target: { value: "1" } });
    fireEvent.click(screen.getByText("Calcola costi →"));
    await waitFor(() => screen.getByText("🔐 Firma e invia"));
    fireEvent.click(screen.getByText("🔐 Firma e invia"));
    await waitFor(() => screen.getByText("Conferma PIN"));
    fireEvent.change(screen.getByPlaceholderText("• • • •"), { target: { value: "1234" } });
    fireEvent.click(screen.getByText("Firma e invia"));
    await waitFor(() => {
      expect(screen.getByText("Fondi insufficienti")).toBeInTheDocument();
      expect(screen.getByText("Riepilogo")).toBeInTheDocument();
    });
  });

  // 17. Chiusura foglio
  it("il pulsante × chiama onClose", () => {
    renderSheet();
    fireEvent.click(screen.getByLabelText("Chiudi"));
    expect(DEFAULT_PROPS.onClose).toHaveBeenCalledOnce();
  });

  // 18. PIN troppo corto
  it("PIN troppo corto mostra errore senza avanzare", async () => {
    mockSendPayment.mockImplementation(async (_req, onAuthRequired) => {
      await onAuthRequired();
      return { status: "sent" };
    });
    await goToAmount();
    fireEvent.change(screen.getByPlaceholderText("0.00"), { target: { value: "1" } });
    fireEvent.click(screen.getByText("Calcola costi →"));
    await waitFor(() => screen.getByText("🔐 Firma e invia"));
    fireEvent.click(screen.getByText("🔐 Firma e invia"));
    await waitFor(() => screen.getByText("Conferma PIN"));
    fireEvent.change(screen.getByPlaceholderText("• • • •"), { target: { value: "12" } });
    fireEvent.click(screen.getByText("Firma e invia"));
    expect(screen.getByText("PIN troppo corto")).toBeInTheDocument();
    expect(screen.getByText("Conferma PIN")).toBeInTheDocument(); // rimasto su auth
  });

  // 19. Importo non valido blocca calcolo
  it("importo non valido blocca goToSummary", async () => {
    await goToAmount();
    // non inserisce importo
    fireEvent.click(screen.getByText("Calcola costi →"));
    expect(screen.getByText("Inserisci un importo valido")).toBeInTheDocument();
    expect(mockCalculateQuote).not.toHaveBeenCalled();
    expect(screen.getByText("Importo")).toBeInTheDocument();
  });

  // 20. Step sending non ha pulsanti navigazione
  it("step sending non mostra back/continua", async () => {
    let releaseAuth!: () => void;
    mockSendPayment.mockImplementation(async (_req, onAuthRequired) => {
      const pin = await onAuthRequired();
      await new Promise<void>(r => { releaseAuth = r; });
      return { status: "sent" };
    });
    await goToAmount();
    fireEvent.change(screen.getByPlaceholderText("0.00"), { target: { value: "1" } });
    fireEvent.click(screen.getByText("Calcola costi →"));
    await waitFor(() => screen.getByText("🔐 Firma e invia"));
    fireEvent.click(screen.getByText("🔐 Firma e invia"));
    await waitFor(() => screen.getByText("Conferma PIN"));
    fireEvent.change(screen.getByPlaceholderText("• • • •"), { target: { value: "1234" } });
    fireEvent.click(screen.getByText("Firma e invia"));
    await waitFor(() => {
      expect(screen.getByText("Invio in corso…")).toBeInTheDocument();
    });
    expect(screen.queryByText("← Indietro")).not.toBeInTheDocument();
    expect(screen.queryByText("Continua →")).not.toBeInTheDocument();
    // release per cleanup
    act(() => { releaseAuth(); });
  });

  // 21. Caso C — manuale senza recipientUserId
  it("Caso C: mostra network selector su step 1 senza recipient discovery", () => {
    renderSheet({ prefillRecipient: "0x1234567890abcdef1234567890abcdef12345678" });
    expect(screen.getByText("Rete")).toBeInTheDocument();
    expect(screen.getByText("Polygon")).toBeInTheDocument();
    expect(screen.getByText("Continua →")).toBeInTheDocument();
  });

  // 22. Caso A — no address per rete (BTC) disabilita Continua
  it("Caso A senza indirizzo BTC: Continua disabilitato", async () => {
    mockGetRecipient.mockResolvedValue({ hasAlphaWallet: true, evmAddress: "0xABCDEF1234567890abcdef1234567890abcdef12", btcAddress: null });
    renderSheet({ recipientUserId: "user-1" });
    await waitFor(() => screen.getByText("ALPHA WALLET ✓"));
    // Seleziona Bitcoin
    fireEvent.click(screen.getByText("Bitcoin"));
    const continua = screen.getByText("Continua →");
    expect(continua).toBeDisabled();
  });

  // 23. REGRESSIONE Step 4 bianco — calculateQuote risolve null (senza throw)
  it("quote null da amount: mostra errore e rimane su amount (mai summary vuoto)", async () => {
    mockCalculateQuote.mockResolvedValue(null);
    await goToAmount();
    fireEvent.change(screen.getByPlaceholderText("0.00"), { target: { value: "1" } });
    fireEvent.click(screen.getByText("Calcola costi →"));
    await waitFor(() => {
      expect(screen.getByText(/Impossibile calcolare i costi/)).toBeInTheDocument();
      expect(screen.getByText("Importo")).toBeInTheDocument(); // rimasto su amount
    });
    expect(screen.queryByText("Riepilogo costi")).not.toBeInTheDocument();
  });

  // 24. REGRESSIONE — fallback "Ricalcola" su summary: quote di nuovo null → torna ad amount
  it("summary senza quote: Ricalcola con quote null torna ad amount con errore", async () => {
    await goToAmount();
    fireEvent.change(screen.getByPlaceholderText("0.00"), { target: { value: "1" } });
    fireEvent.click(screen.getByText("Calcola costi →"));
    await waitFor(() => screen.getByText("🔐 Firma e invia"));
    // Simula quote scaduta durante auth: sendPayment apre auth, l'utente annulla
    // ma nel frattempo quote è null → handlePinCancel deve tornare ad amount.
    // Qui testiamo direttamente il fallback: forziamo il ricalcolo con null.
    mockCalculateQuote.mockResolvedValue(null);
    // Torna ad amount e riprova (percorso equivalente al fallback "Ricalcola i costi")
    fireEvent.click(screen.getByText("← Modifica"));
    fireEvent.click(screen.getByText("Calcola costi →"));
    await waitFor(() => {
      expect(screen.getByText(/Impossibile calcolare i costi/)).toBeInTheDocument();
      expect(screen.getByText("Importo")).toBeInTheDocument();
    });
  });

  // 25. REGRESSIONE — tap sul backdrop durante auth NON chiude né orfana la promise PIN
  it("backdrop click durante auth non chiude il foglio", async () => {
    mockSendPayment.mockImplementation(async (_req, onAuthRequired) => {
      const pin = await onAuthRequired();
      if (!pin) return { status: "cancelled" };
      return { status: "sent", txHash: "0xTX" };
    });
    await goToAmount();
    fireEvent.change(screen.getByPlaceholderText("0.00"), { target: { value: "1" } });
    fireEvent.click(screen.getByText("Calcola costi →"));
    await waitFor(() => screen.getByText("🔐 Firma e invia"));
    fireEvent.click(screen.getByText("🔐 Firma e invia"));
    await waitFor(() => screen.getByText("Conferma PIN"));
    // Tap sul backdrop: non deve chiamare onClose durante auth
    const backdrop = document.querySelector(".cwp-backdrop")!;
    fireEvent.click(backdrop);
    expect(DEFAULT_PROPS.onClose).not.toHaveBeenCalled();
    expect(screen.getByText("Conferma PIN")).toBeInTheDocument();
    // Cleanup: annulla correttamente via pulsante
    fireEvent.click(screen.getByText("Annulla"));
    await waitFor(() => screen.getByText("🔐 Firma e invia"));
  });
});
