/**
 * CRITICAL — BTC Address Format Validation
 *
 * Questo test DEVE passare prima di ogni deploy.
 * Copre tutti i formati Bitcoin reali che possono comparire come destinatari
 * in Alpha Wallet sends e in swap EVM→BTC (vault Li.Fi/Thorchain).
 *
 * Bug catturato: 2026-08-17 — bc1p (Taproot) non accettato → swap EVM→BTC
 * bloccato in produzione. Se questo test fosse esistito, sarebbe stato
 * rilevato la prima volta che validateBtcAddress fu scritta.
 */

import { describe, it, expect } from "vitest";
import { validateBtcAddress } from "../../wallet/services/btc-signer";

// ─── Indirizzi reali usati in produzione ──────────────────────────────────────
// Copiati da transazioni reali o documentazione ufficiale dei provider

const VALID_ADDRESSES = {
  // P2WPKH — native SegWit — il formato più comune (42 chars)
  p2wpkh_1: "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq",
  p2wpkh_2: "bc1q34aq5urpqlz8fcrn2pqnhrq3xfxdfyuyrjce4z",
  p2wpkh_3: "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu",

  // P2WSH — pay-to-witness-script-hash — 62 chars — usato da multisig e vault
  // Li.Fi/Thorchain può restituire indirizzi P2WSH come vault di deposit
  p2wsh_1: "bc1qeklep85ntjz4605drds6aww9u0qr46qzrv5xswd35uhjuj8ahfcqgf6hak",
  // Indirizzo P2WSH sintetico (58 chars dopo bc1q = 62 totali, solo chars bech32 validi)
  // L'hash script sottostante è fittizio ma il formato è corretto per il test di validazione
  p2wsh_2: "bc1qaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",

  // P2TR — Taproot — bc1p — il formato che ha causato il bug del 2026-08-17
  // Thorchain, Boltz, e molti provider moderni usano P2TR per i loro vault
  p2tr_1: "bc1p5d7rjq7g6rdk2yhzks9smlaqtedr4dekq08ge8ztwac72sfr9rusxg3297",
  p2tr_2: "bc1pqyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqsf2a4cg",
  p2tr_3: "bc1ppvnv4m3ghqvv79qzj0at3lmdgumtc9m0qkrq6htf3z50eywfzuhqfkst27",

  // Legacy P2PKH — 1... — ancora usato da wallet vecchi
  legacy_p2pkh_1: "1A1zP1eP5QGefi2DMPTfTL5SLmv7Divf Na".replace(" Na", ""), // genesis
  legacy_p2pkh_2: "1BpEi6DfDAUFd153wiGrvkiKW1ECQ8orak",

  // P2SH — 3... — multisig legacy, wrapped SegWit
  p2sh_1: "3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy",
  p2sh_2: "3QJmV3qfvL9SuYo34YihAf3sRCW3qSinyC",
};

const INVALID_ADDRESSES = {
  empty:           "",
  spaces_only:     "   ",
  wrong_prefix:    "ltc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq", // Litecoin
  too_short_bc1q:  "bc1qar0",
  too_short_1:     "1Abc",
  uppercase_bc1:   "BC1QAR0SRRR7XFKVY5L643LYDNW9RE59GTZZWF5MDQ",
  invalid_chars:   "bc1q0OIl", // O, I, l non sono in bech32
  testnet_tb1:     "tb1q0j8dpnkzyvmhjefr5wjjdh4g8j9ysqjq9dqvfh", // testnet
  random_string:   "not_a_bitcoin_address",
  eth_address:     "0x742d35Cc6634C0532925a3b8D4C9b4d2bD5e6Af",
  too_long:        "bc1q" + "a".repeat(200),
};

// ─── Test: formati validi ─────────────────────────────────────────────────────

describe("validateBtcAddress — formati validi (devono restituire null)", () => {
  describe("P2WPKH (bc1q, 42 chars) — native SegWit standard", () => {
    it("accetta indirizzo P2WPKH reale #1", () => {
      expect(validateBtcAddress(VALID_ADDRESSES.p2wpkh_1)).toBeNull();
    });
    it("accetta indirizzo P2WPKH reale #2", () => {
      expect(validateBtcAddress(VALID_ADDRESSES.p2wpkh_2)).toBeNull();
    });
    it("accetta indirizzo P2WPKH reale #3", () => {
      expect(validateBtcAddress(VALID_ADDRESSES.p2wpkh_3)).toBeNull();
    });
  });

  describe("P2WSH (bc1q, 62 chars) — vault multisig e provider", () => {
    it("accetta indirizzo P2WSH #1 (vault tipo Li.Fi)", () => {
      expect(validateBtcAddress(VALID_ADDRESSES.p2wsh_1)).toBeNull();
    });
    it("accetta indirizzo P2WSH #2", () => {
      expect(validateBtcAddress(VALID_ADDRESSES.p2wsh_2)).toBeNull();
    });
  });

  describe("P2TR (bc1p) — Taproot — BUG CATTURATO 2026-08-17", () => {
    // Questo describe è il test più importante. Prima del fix del 2026-08-17
    // tutti e tre questi test fallivano, bloccando swap EVM→BTC in produzione.
    it("accetta indirizzo P2TR #1 (formato Thorchain vault)", () => {
      expect(validateBtcAddress(VALID_ADDRESSES.p2tr_1)).toBeNull();
    });
    it("accetta indirizzo P2TR #2", () => {
      expect(validateBtcAddress(VALID_ADDRESSES.p2tr_2)).toBeNull();
    });
    it("accetta indirizzo P2TR #3", () => {
      expect(validateBtcAddress(VALID_ADDRESSES.p2tr_3)).toBeNull();
    });
  });

  describe("Legacy (1… P2PKH e 3… P2SH) — wallet storici", () => {
    it("accetta indirizzo legacy P2PKH #1", () => {
      expect(validateBtcAddress(VALID_ADDRESSES.legacy_p2pkh_1)).toBeNull();
    });
    it("accetta indirizzo legacy P2PKH #2", () => {
      expect(validateBtcAddress(VALID_ADDRESSES.legacy_p2pkh_2)).toBeNull();
    });
    it("accetta indirizzo P2SH #1", () => {
      expect(validateBtcAddress(VALID_ADDRESSES.p2sh_1)).toBeNull();
    });
    it("accetta indirizzo P2SH #2", () => {
      expect(validateBtcAddress(VALID_ADDRESSES.p2sh_2)).toBeNull();
    });
  });
});

// ─── Test: formati non validi ─────────────────────────────────────────────────

describe("validateBtcAddress — formati non validi (devono restituire stringa errore)", () => {
  it("rifiuta stringa vuota", () => {
    expect(validateBtcAddress(INVALID_ADDRESSES.empty)).not.toBeNull();
  });
  it("rifiuta stringa di soli spazi", () => {
    expect(validateBtcAddress(INVALID_ADDRESSES.spaces_only)).not.toBeNull();
  });
  it("rifiuta prefisso Litecoin (ltc1q)", () => {
    expect(validateBtcAddress(INVALID_ADDRESSES.wrong_prefix)).not.toBeNull();
  });
  it("rifiuta bc1q troppo corto", () => {
    expect(validateBtcAddress(INVALID_ADDRESSES.too_short_bc1q)).not.toBeNull();
  });
  it("rifiuta legacy troppo corto", () => {
    expect(validateBtcAddress(INVALID_ADDRESSES.too_short_1)).not.toBeNull();
  });
  it("rifiuta caratteri non-bech32 (O, I, l)", () => {
    expect(validateBtcAddress(INVALID_ADDRESSES.invalid_chars)).not.toBeNull();
  });
  it("rifiuta indirizzo testnet (tb1)", () => {
    expect(validateBtcAddress(INVALID_ADDRESSES.testnet_tb1)).not.toBeNull();
  });
  it("rifiuta stringa random", () => {
    expect(validateBtcAddress(INVALID_ADDRESSES.random_string)).not.toBeNull();
  });
  it("rifiuta indirizzo Ethereum", () => {
    expect(validateBtcAddress(INVALID_ADDRESSES.eth_address)).not.toBeNull();
  });
  it("rifiuta indirizzo troppo lungo", () => {
    expect(validateBtcAddress(INVALID_ADDRESSES.too_long)).not.toBeNull();
  });
});

// ─── Invariante: il messaggio di errore è una stringa leggibile ───────────────

describe("validateBtcAddress — contratto del valore di ritorno", () => {
  it("null per indirizzi validi (bc1q, bc1p, 1…, 3…)", () => {
    const valid = [
      VALID_ADDRESSES.p2wpkh_1,
      VALID_ADDRESSES.p2wsh_1,
      VALID_ADDRESSES.p2tr_1,
      VALID_ADDRESSES.legacy_p2pkh_1,
      VALID_ADDRESSES.p2sh_1,
    ];
    for (const addr of valid) {
      expect(validateBtcAddress(addr), `"${addr}" dovrebbe essere valido`).toBeNull();
    }
  });

  it("stringa non vuota per indirizzi non validi", () => {
    const invalid = [
      INVALID_ADDRESSES.empty,
      INVALID_ADDRESSES.wrong_prefix,
      INVALID_ADDRESSES.eth_address,
    ];
    for (const addr of invalid) {
      const result = validateBtcAddress(addr);
      expect(typeof result, `"${addr}" dovrebbe dare stringa errore`).toBe("string");
      expect(result!.length).toBeGreaterThan(0);
    }
  });

  it("il messaggio di errore per indirizzo invalido è leggibile in italiano", () => {
    const err = validateBtcAddress("not-valid");
    expect(err).not.toBeNull();
    // Non deve contenere stack trace o codici interni
    expect(err).not.toMatch(/Error:|TypeError:|undefined|null/);
  });
});
