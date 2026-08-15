// Test per parseBolt11Amount — parsing importo dall'HRP BOLT11.
// Incidente reale: lnbc91781310p1... = 9178,131 sat (sub-satoshi) →
// Spark SDK rifiutava con "Amount must not be less than the invoice amount".
import { describe, it, expect } from "vitest";
import { parseBolt11Amount } from "../pages/AlphaWalletPage";

describe("parseBolt11Amount", () => {
  it("invoice reale incidente: 91781310p → 9178131 msat (sub-satoshi)", () => {
    const r = parseBolt11Amount("lnbc91781310p1p4gprlupp56ldwg80qeuw9nqmw2k36s5qku");
    expect(r).toEqual({ amountless: false, msat: 9_178_131n });
    // ceiling al sat intero usato dal flusso send
    expect((r!.msat! + 999n) / 1000n).toBe(9179n);
    expect(r!.msat! % 1000n).not.toBe(0n); // sub-satoshi → serve amountSat esplicito
  });

  it("amountless: lnbc1... senza cifre", () => {
    expect(parseBolt11Amount("lnbc1p4gprlupp5qqqsyq")).toEqual({ amountless: true });
  });

  it("moltiplicatore m (milli-BTC): 20m = 2_000_000 sat interi", () => {
    const r = parseBolt11Amount("lnbc20m1pvjluez");
    expect(r).toEqual({ amountless: false, msat: 20n * 100_000_000n });
    expect(r!.msat! % 1000n).toBe(0n);
  });

  it("moltiplicatore u (micro-BTC): 2500u = 250_000 sat interi", () => {
    const r = parseBolt11Amount("lnbc2500u1pvjluez");
    expect(r).toEqual({ amountless: false, msat: 2500n * 100_000n });
  });

  it("moltiplicatore n (nano-BTC): 100n = 10 sat", () => {
    const r = parseBolt11Amount("lnbc100n1pvjluez");
    expect(r).toEqual({ amountless: false, msat: 100n * 100n });
  });

  it("senza moltiplicatore: BTC interi (lnbc21... = 2 BTC, '1' finale è il separatore)", () => {
    // Il backtracking del regex assegna l'ultimo '1' come separatore bech32
    const r = parseBolt11Amount("lnbc21pvjluez");
    expect(r).toEqual({ amountless: false, msat: 2n * 100_000_000_000n });
  });

  it("prefisso lightning: e maiuscole gestiti", () => {
    expect(parseBolt11Amount("lightning:LNBC91781310P1P4GPRLU"))
      .toEqual({ amountless: false, msat: 9_178_131n });
  });

  it("testnet lntb e regtest lnbcrt", () => {
    expect(parseBolt11Amount("lntb1pvjluez")).toEqual({ amountless: true });
    expect(parseBolt11Amount("lnbcrt500u1pvjluez")).toEqual({ amountless: false, msat: 500n * 100_000n });
  });

  it("input non parsabile → null (decide l'SDK)", () => {
    expect(parseBolt11Amount("bc1qxyz")).toBeNull();
    expect(parseBolt11Amount("0x1234")).toBeNull();
    expect(parseBolt11Amount("")).toBeNull();
  });
});
