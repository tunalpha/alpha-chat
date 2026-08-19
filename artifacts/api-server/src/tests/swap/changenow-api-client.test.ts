/**
 * ChangeNOW API client — regressione endpoint transaction-status.
 *
 * L'API di ChangeNOW accetta la partner key nel path per questo endpoint:
 * GET /v1/transactions/{exchangeId}/{apiKey}
 * Una query string `?api_key=` restituisce HTTP 400.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cnGetTransactionStatus } from "../../services/swap/changenow.service.js";

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

  it("uses the documented path-key URL for a fixed-rate exchange status", async () => {
    process.env.CHANGENOW_API_KEY = "test-partner-key";
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "exchange-123", status: "finished" }), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);

    await cnGetTransactionStatus("exchange-123");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.changenow.io/v1/transactions/exchange-123/test-partner-key",
      expect.objectContaining({
        headers: { "Content-Type": "application/json" },
      })
    );
  });
});