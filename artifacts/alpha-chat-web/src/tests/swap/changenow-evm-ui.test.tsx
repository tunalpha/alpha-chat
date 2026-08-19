import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useChangeNowEvmSwapState } from "../../swap/changenow/useChangeNowEvmSwapState.js";
import { useEvmTokenBalances } from "../../swap/evm/useEvmTokenBalances.js";
import { NATIVE_ADDRESS, type EvmToken } from "../../swap/evm/types.js";
import {
  CnAwaitingConfirmation,
  CnTokenCard,
  CnTokenMenu,
  CnTokenSheet,
  CnQuoteDetails,
  ChangeNowEvmSwapView,
} from "../../swap/changenow/ChangeNowEvmSwapView.js";
import { CN_EVM_TOKENS } from "../../swap/changenow/evm-types.js";

const WALLET = "0x1111111111111111111111111111111111111111";
const POLYGON_USDC: EvmToken = {
  chainId: 137,
  address: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
  symbol: "USDC",
  name: "USD Coin (Polygon)",
  decimals: 6,
  isNative: false,
};

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("ChangeNOW EVM swap — saldi e inversione UI", () => {
  it("espone USDC Ethereum, Polygon e BSC nel selettore multi-rete", () => {
    expect(CN_EVM_TOKENS.filter((item) => item.symbol === "USDC")).toEqual(expect.arrayContaining([
      expect.objectContaining({ ticker: "usdc", chainId: 1, network: "Ethereum", decimals: 6 }),
      expect.objectContaining({ ticker: "usdcmatic", chainId: 137, network: "Polygon", decimals: 6 }),
      expect.objectContaining({ ticker: "usdcbsc", chainId: 56, network: "BSC", decimals: 18 }),
    ]));
  });

  it("legge il saldo nativo dalla Map e interroga anche il contratto ChangeNOW aggiuntivo", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({ result: "0x10" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() =>
      useEvmTokenBalances(137, WALLET, [POLYGON_USDC])
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.map.get(NATIVE_ADDRESS)).toBe(16n);
    expect(result.current.map.get(POLYGON_USDC.address)).toBe(16n);
    // POL, USDT e USDC nativo. USDC ChangeNOW coincide con il registry wallet,
    // quindi non deve causare una seconda lettura dello stesso contratto.
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("inverte la coppia prima dell'exchange e invalida importo/quote", () => {
    const { result } = renderHook(() => useChangeNowEvmSwapState(WALLET, null));
    const initialFrom = result.current[0].fromToken;
    const initialTo = result.current[0].toToken;

    act(() => {
      result.current[1].setFromAmount("20");
      result.current[1].invertDirection();
    });

    expect(result.current[0].fromToken).toEqual(initialTo);
    expect(result.current[0].toToken).toEqual(initialFrom);
    expect(result.current[0].fromAmount).toBe("");
    expect(result.current[0].quote).toBeNull();
    expect(result.current[0].minAmount).toBeNull();
  });

  it("mostra il saldo on-chain accanto a ogni token nella tendina", () => {
    const token = CN_EVM_TOKENS.find((item) => item.ticker === "pol")!;

    render(
      <CnTokenMenu
        tokens={[token]}
        onChoose={() => {}}
        getBalance={() => 4_390_000_000_000_000_000n}
        isBalanceLoading={() => false}
      />,
    );

    expect(screen.getByText("4.39 POL")).toBeTruthy();
    expect(screen.getByText("Saldo")).toBeTruthy();
  });

  it("apre un bottom sheet selezionabile, come il selettore Li.Fi", () => {
    const token = CN_EVM_TOKENS.find((item) => item.ticker === "pol")!;
    const onChoose = vi.fn();
    const onClose = vi.fn();

    render(
      <CnTokenSheet
        side="from"
        tokens={[token]}
        onChoose={onChoose}
        onClose={onClose}
        getBalance={() => 4_390_000_000_000_000_000n}
        isBalanceLoading={() => false}
      />,
    );

    expect(screen.getByRole("dialog", { name: "Seleziona token da inviare" })).toBeTruthy();
    expect(screen.getByText("4.39 POL")).toBeTruthy();

    fireEvent.click(screen.getByText("POL"));
    expect(onChoose).toHaveBeenCalledWith(token);

    fireEvent.click(screen.getByRole("button", { name: "Chiudi selettore token" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("apre le tendine e inverte la direzione dalla schermata ChangeNOW completa", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/swap/changenow/evm/pairs/")) {
        return {
          ok: true,
          json: async () => ({ ok: true, available: true, minAmount: 1 }),
        };
      }
      return {
        ok: true,
        json: async () => ({ result: "0x0" }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <ChangeNowEvmSwapView
        onBack={() => {}}
        alphaWalletAddress={WALLET}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Seleziona token Da" }));
    expect(screen.getByRole("dialog", { name: "Seleziona token da inviare" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Chiudi selettore token" }));

    fireEvent.click(screen.getByRole("button", { name: "Inverti token di partenza e arrivo" }));
    expect(screen.getByRole("textbox", { name: "Importo Da USDC" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Seleziona token A" }));
    expect(screen.getByRole("dialog", { name: "Seleziona token da ricevere" })).toBeTruthy();

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/swap/changenow/evm/pairs/usdcmatic/pol"),
        expect.anything(),
      );
    });
  });

  it("mantiene attiva la freccia con una quote pronta e inverte la coppia", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/swap/changenow/evm/pairs/")) {
        return {
          ok: true,
          json: async () => ({ ok: true, available: true, minAmount: 1 }),
        };
      }
      if (url.includes("/swap/changenow/evm/quote")) {
        return {
          ok: true,
          json: async () => ({
            ok: true,
            quote: {
              fromTicker: "pol",
              toTicker: "usdcmatic",
              fromAmount: 2,
              estimatedToAmount: 1.25,
              minAmount: 1,
            },
          }),
        };
      }
      return { ok: false, json: async () => ({}) };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <ChangeNowEvmSwapView
        onBack={() => {}}
        alphaWalletAddress={WALLET}
      />,
    );

    const amount = await screen.findByRole("textbox", { name: "Importo Da POL" });
    fireEvent.change(amount, { target: { value: "2" } });

    await waitFor(() => expect(screen.getByRole("button", { name: /Crea Swap/i })).toBeTruthy());

    const invert = screen.getByRole("button", {
      name: "Inverti token di partenza e arrivo",
    });
    expect(invert).not.toBeDisabled();

    fireEvent.click(invert);

    expect(screen.getByRole("textbox", { name: "Importo Da USDC" })).toBeTruthy();
    expect(screen.queryByText("Dettagli quotazione")).toBeNull();
  });

  it("mantiene importo e MAX interattivi dopo una inversione", () => {
    const token = CN_EVM_TOKENS.find((item) => item.ticker === "pol")!;
    const onAmountChange = vi.fn();
    const onPct = vi.fn();

    render(
      <CnTokenCard
        label="Da"
        token={token}
        amount=""
        onAmountChange={onAmountChange}
        onTokenClick={() => {}}
        balance={4_390_000_000_000_000_000n}
        balLoading={false}
        onPct={onPct}
      />,
    );

    fireEvent.change(screen.getByRole("textbox", { name: "Importo Da POL" }), {
      target: { value: "1,25" },
    });
    expect(onAmountChange).toHaveBeenCalledWith("1.25");

    fireEvent.click(screen.getByRole("button", { name: "MAX" }));
    expect(onPct).toHaveBeenCalledWith(100);
  });

  it("spiega che il minimo fixed-rate è l'importo del token da inviare", () => {
    const token = CN_EVM_TOKENS.find((item) => item.ticker === "pol")!;

    render(
      <CnTokenCard
        label="Da"
        token={token}
        amount="100"
        onAmountChange={() => {}}
        onTokenClick={() => {}}
        minAmount={84.036123}
      />,
    );

    expect(screen.getByText("Minimo da inviare per tasso fisso")).toBeTruthy();
    expect(screen.getByText("84.036123 POL")).toBeTruthy();
    expect(screen.queryByText("Minimo tasso garantito")).toBeNull();
  });

  it("dopo l'inversione collega ancora la card al nuovo token e all'importo", () => {
    function InversionHarness() {
      const [state, actions] = useChangeNowEvmSwapState(WALLET, null);
      return (
        <>
          <button type="button" onClick={actions.invertDirection}>Inverti</button>
          <CnTokenCard
            label="Da"
            token={state.fromToken}
            amount={state.fromAmount}
            onAmountChange={actions.setFromAmount}
            onTokenClick={() => {}}
            balance={10_000_000n}
            onPct={() => actions.setFromAmount("10")}
          />
        </>
      );
    }

    render(<InversionHarness />);
    fireEvent.click(screen.getByRole("button", { name: "Inverti" }));

    const amount = screen.getByRole("textbox", { name: "Importo Da USDC" });
    fireEvent.change(amount, { target: { value: "2" } });
    expect(amount).toHaveValue("2");

    fireEvent.click(screen.getByRole("button", { name: "MAX" }));
    expect(amount).toHaveValue("10");
  });

  it("mostra il saldo disponibile anche nella card del token da ricevere", () => {
    const token = CN_EVM_TOKENS.find((item) => item.ticker === "pol")!;

    render(
      <CnTokenCard
        label="A"
        token={token}
        onTokenClick={() => {}}
        balance={4_390_000_000_000_000_000n}
        balLoading={false}
      />,
    );

    expect(screen.getByText("4.39 POL")).toBeTruthy();
    expect(screen.queryByText("Saldo non disponibile")).toBeNull();
  });

  it("identifica POL ChangeNOW come asset nativo Polygon", () => {
    const token = CN_EVM_TOKENS.find((item) => item.ticker === "pol")!;

    expect(token).toMatchObject({
      network: "Polygon",
      chainId: 137,
      isNative: true,
      contractAddress: null,
    });
  });

  it("mostra e richiude i valori della quotazione come il riepilogo Li.Fi", () => {
    const fromToken = CN_EVM_TOKENS.find((item) => item.ticker === "usdtbsc")!;
    const toToken = CN_EVM_TOKENS.find((item) => item.ticker === "pol")!;

    render(
      <CnQuoteDetails
        quote={{
          fromTicker: "usdtbsc",
          toTicker: "pol",
          fromAmount: 13.5,
          estimatedToAmount: 160.871944,
          minAmount: 7,
        }}
        fromToken={fromToken}
        toToken={toToken}
      />,
    );

    expect(screen.getByText("Dettagli quotazione")).toBeTruthy();
    expect(screen.getByText("13.5 USDT")).toBeTruthy();
    expect(screen.getByText("160.871944 POL")).toBeTruthy();
    expect(screen.getByText("1 USDT ≈ 11.91644 POL")).toBeTruthy();
    expect(screen.getByText("Minimo da inviare (tasso fisso)")).toBeTruthy();
    expect(screen.getByText("7 USDT")).toBeTruthy();
    expect(screen.queryByText("Minimo tasso garantito")).toBeNull();
    expect(screen.getByText("Nessuna")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Dettagli quotazione" }));
    expect(screen.queryByText("160.871944 POL")).toBeNull();
  });

  it("mostra una conferma senza provider o indirizzo tecnico", () => {
    render(
      <CnAwaitingConfirmation
        fromAmount={13.5}
        fromSymbol="USDT"
        fromDecimals={6}
        toAmount={160.97}
        toSymbol="POL"
        toDecimals={18}
      />,
    );

    expect(screen.getByText("Conferma l’invio nel tuo wallet")).toBeTruthy();
    expect(screen.getByText("13.5 USDT")).toBeTruthy();
    expect(screen.getByText("160.97 POL")).toBeTruthy();
    expect(screen.queryByText(/ChangeNOW/i)).toBeNull();
    expect(screen.queryByText(/0x[a-f0-9]{8}/i)).toBeNull();
  });
});