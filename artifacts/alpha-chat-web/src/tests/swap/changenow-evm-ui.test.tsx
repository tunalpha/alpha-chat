import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useChangeNowEvmSwapState } from "../../swap/changenow/useChangeNowEvmSwapState.js";
import { useEvmTokenBalances } from "../../swap/evm/useEvmTokenBalances.js";
import { NATIVE_ADDRESS, type EvmToken } from "../../swap/evm/types.js";
import { CnTokenMenu, CnTokenSheet } from "../../swap/changenow/ChangeNowEvmSwapView.js";
import { CN_EVM_TOKENS } from "../../swap/changenow/evm-types.js";

const WALLET = "0x1111111111111111111111111111111111111111";
const POLYGON_USDC: EvmToken = {
  chainId: 137,
  address: "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174",
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
    // POL, USDT, USDC nativo nel catalogo + USDC ChangeNOW.
    expect(fetchMock).toHaveBeenCalledTimes(4);
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
});