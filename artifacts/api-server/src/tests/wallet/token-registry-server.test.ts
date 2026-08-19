import { describe, expect, it } from "vitest";
import {
  getVerifiedTokensForChain,
  isVerifiedAddress,
} from "../../wallet/token-registry-server.js";

describe("server token registry — ChangeNOW POL Ethereum", () => {
  const polAddress = "0x455e53cbb86018ac2b8092fdcd39d8444affc3f6";

  it("includes the verified POL ERC-20 in Ethereum balance queries", () => {
    expect(getVerifiedTokensForChain(1)).toContainEqual({
      chainId: 1,
      symbol: "POL",
      name: "Polygon Ecosystem Token",
      decimals: 18,
      contractAddress: polAddress,
    });
  });

  it("matches the POL contract case-insensitively", () => {
    expect(isVerifiedAddress(1, "0x455E53CbB86018aC2B8092fDCd39D8444affC3F6")).toBe(true);
  });
});