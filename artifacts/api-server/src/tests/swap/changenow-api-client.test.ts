/**
 * ChangeNOW API client — regressioni API V2 con rete esplicita.
 *
 * L'API V2 richiede la partner key nell'header e distingue valuta/rete.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cnGetFixedRateRange,
  cnGetTransactionStatus,
} from "../../services/swap/changenow.service.js";

describe("cnGetTransactionStatus", () => {
  const originalApiKey = process.env.CHANGENOW_API_KEY;

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalApiKey === undefined) {
      delete process.env.CHANGENOW_API_KEY;
    } else {
      process.env.CHANGENOW_API_KEY = originalApiKey;
    }
  });

  it("uses the V2 status endpoint and never exposes the partner key in the URL", async () => {
    process.env.CHANGENOW_API_KEY = "test-partner-key";
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "exchange-123", status: "finished" }), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);

    await cnGetTransactionStatus("exchange-123");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.changenow.io/v2/exchange/by-id?id=exchange-123",
      expect.objectContaining({
        headers: {
          "Content-Type": "application/json",
          "x-changenow-api-key": "test-partner-key",
        },
      })
    );
  });

  it("resolves POL as native Polygon through currency=matic and network=matic", async () => {
    process.env.CHANGENOW_API_KEY = "test-partner-key";
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ minAmount: 6.8, maxAmount: 100 }), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);

    await cnGetFixedRateRange("usdtbsc", "pol");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.changenow.io/v2/exchange/range?fromCurrency=usdt&toCurrency=matic&fromNetwork=bsc&toNetwork=matic&flow=fixed-rate",
      expect.objectContaining({
        headers: expect.objectContaining({
          "x-changenow-api-key": "test-partner-key",
        }),
      })
    );
  });
});