import { describe, expect, it } from "vitest";
import { getAlchemyIncomingCategories } from "../../controllers/alpha-wallet.controller.js";

describe("Alpha Wallet Alchemy history categories", () => {
  it("does not request unsupported internal transfers on BSC", () => {
    expect(getAlchemyIncomingCategories(56)).toEqual(["external", "erc20"]);
  });

  it("retains contract-originated incoming transfers on Ethereum and Polygon", () => {
    expect(getAlchemyIncomingCategories(1)).toEqual(["external", "erc20", "internal"]);
    expect(getAlchemyIncomingCategories(137)).toEqual(["external", "erc20", "internal"]);
  });
});