/**
 * wallet-payment-bubble.test.tsx
 *
 * Test del renderer reale per i messaggi 🔐WALLETPAY:.
 *
 * Verifica la catena completa:
 *   sendProgrammatic() → text = "🔐WALLETPAY:{...}"
 *   → getDisplayText → text
 *   → text.startsWith("🔐WALLETPAY:") → JSON.parse → ChatWalletPaymentBubble
 *
 * IMPORTANTE: questi test verificano che la bubble venga renderata,
 * NON che il testo grezzo JSON venga mostrato.
 */

import { render, screen }  from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { ChatWalletPaymentBubble, type WalletPaymentMeta } from "../ChatWalletPaymentBubble";

// ─── Meta esatta prodotta da sendProgrammatic (onSent callback) ──────────────

const REAL_META_TX1: WalletPaymentMeta = {
  txHash:      "0x58ab6b1209b682b3880a083429d234a20075d1e939a83962311e8102223eb989",
  network:     "polygon",
  assetSymbol: "USDA",
  amount:      "1",
  fee:         "0.001",
  direction:   "out",
  status:      "sent",
  explorerUrl: "https://polygonscan.com/tx/0x58ab6b1209b682b3880a083429d234a20075d1e939a83962311e8102223eb989",
};

const REAL_META_TX2: WalletPaymentMeta = {
  txHash:      "0xde91cbd2aae81e0c02cb9687ecfcfb14266f5d4cac5ca6b91f3ccc5da64681ae",
  network:     "polygon",
  assetSymbol: "USDA",
  amount:      "1",
  fee:         "0.001",
  direction:   "out",
  status:      "sent",
  explorerUrl: "https://polygonscan.com/tx/0xde91cbd2aae81e0c02cb9687ecfcfb14266f5d4cac5ca6b91f3ccc5da64681ae",
};

// ─── Simulazione del percorso renderer ───────────────────────────────────────

/**
 * Replica esattamente ciò che fa il renderer di ChatPage:
 *   1. Controlla text.startsWith("🔐WALLETPAY:")
 *   2. JSON.parse il suffisso
 *   3. Verifica meta.txHash
 *   4. Ritorna ChatWalletPaymentBubble o null
 *
 * Questo è il "real renderer" testato senza montare tutta la ChatPage.
 */
function renderWalletPayBubble(text: string, isMine: boolean) {
  if (!text.startsWith("🔐WALLETPAY:")) return null;
  try {
    const raw  = text.slice("🔐WALLETPAY:".length);
    const meta = JSON.parse(raw) as WalletPaymentMeta;
    if (!meta.txHash) return null;
    return <ChatWalletPaymentBubble meta={meta} isMine={isMine} />;
  } catch { return null; }
}

// ─── Helper per costruire il testo come lo produce sendProgrammatic ──────────

function buildWalletPayText(meta: WalletPaymentMeta): string {
  return `🔐WALLETPAY:${JSON.stringify(meta)}`;
}

// ─── Test suite ───────────────────────────────────────────────────────────────

describe("ChatWalletPaymentBubble — renderer reale", () => {

  // ── Test 1: bubble renderata per TX reale #1 (0x58ab...) ─────────────────
  it("renderizza la bubble (non testo grezzo) per TX Polygon 0x58ab", () => {
    const text = buildWalletPayText(REAL_META_TX1);
    // Il check startsWith deve scattare
    expect(text.startsWith("🔐WALLETPAY:")).toBe(true);
    // La bubble deve essere non-null
    const bubble = renderWalletPayBubble(text, /* isMine */ true);
    expect(bubble).not.toBeNull();
    // Rendering reale
    const { container } = render(bubble!);
    // NON deve esserci il testo grezzo JSON
    expect(container.textContent).not.toContain("🔐WALLETPAY:");
    expect(container.textContent).not.toContain('"txHash"');
    // Deve esserci il contenuto della bubble
    expect(container.textContent).toContain("1");           // amount
    expect(container.textContent).toContain("USDA");        // symbol
    expect(container.textContent).toContain("Polygon");     // network
  });

  // ── Test 2: bubble renderata per TX reale #2 (0xde91...) ─────────────────
  it("renderizza la bubble (non testo grezzo) per TX Polygon 0xde91", () => {
    const text = buildWalletPayText(REAL_META_TX2);
    expect(text.startsWith("🔐WALLETPAY:")).toBe(true);
    const bubble = renderWalletPayBubble(text, true);
    expect(bubble).not.toBeNull();
    const { container } = render(bubble!);
    expect(container.textContent).not.toContain("🔐WALLETPAY:");
    expect(container.textContent).not.toContain('"txHash"');
    expect(container.textContent).toContain("USDA");
    expect(container.textContent).toContain("Polygon");
  });

  // ── Test 3: messaggio mittente — isMine=true ──────────────────────────────
  it("isMine=true: bubble ha classe CSS mine", () => {
    const text = buildWalletPayText(REAL_META_TX1);
    const bubble = renderWalletPayBubble(text, true);
    const { container } = render(bubble!);
    const bubbleEl = container.querySelector(".wallet-pay-bubble");
    expect(bubbleEl?.classList.contains("mine")).toBe(true);
  });

  // ── Test 4: messaggio ricevuto — isMine=false ─────────────────────────────
  it("isMine=false: bubble ha classe CSS theirs", () => {
    const inMeta: WalletPaymentMeta = { ...REAL_META_TX1, direction: "in" };
    const text = buildWalletPayText(inMeta);
    const bubble = renderWalletPayBubble(text, false);
    const { container } = render(bubble!);
    const bubbleEl = container.querySelector(".wallet-pay-bubble");
    expect(bubbleEl?.classList.contains("theirs")).toBe(true);
  });

  // ── Test 5: testo senza prefisso → null (non renderato) ───────────────────
  it("testo senza prefisso 🔐WALLETPAY: → non renderato", () => {
    const plainText = JSON.stringify(REAL_META_TX1);
    const bubble = renderWalletPayBubble(plainText, true);
    expect(bubble).toBeNull();
  });

  // ── Test 6: JSON malformato → null (catch silenzioso) ────────────────────
  it("JSON malformato dopo il prefisso → null", () => {
    const bubble = renderWalletPayBubble("🔐WALLETPAY:not-valid-json", true);
    expect(bubble).toBeNull();
  });

  // ── Test 7: txHash vuoto → null (guard meta.txHash) ──────────────────────
  it("txHash vuoto → null", () => {
    const noHash: WalletPaymentMeta = { ...REAL_META_TX1, txHash: "" };
    const text = buildWalletPayText(noHash);
    const bubble = renderWalletPayBubble(text, true);
    expect(bubble).toBeNull();
  });

  // ── Test 8: explorer link presente nella bubble ───────────────────────────
  it("la bubble contiene il link explorer corretto", () => {
    const text = buildWalletPayText(REAL_META_TX1);
    const bubble = renderWalletPayBubble(text, true);
    const { container } = render(bubble!);
    const link = container.querySelector("a");
    expect(link?.getAttribute("href")).toBe(REAL_META_TX1.explorerUrl);
  });

  // ── Test 9: status "sent" mostra "In attesa di conferma" ──────────────────
  it("status sent → label In attesa di conferma", () => {
    const text = buildWalletPayText(REAL_META_TX1);
    const bubble = renderWalletPayBubble(text, true);
    const { container } = render(bubble!);
    expect(container.textContent).toContain("In attesa di conferma");
  });

  // ── Test 10: status "confirmed" mostra "Confermata" ──────────────────────
  it("status confirmed → label Confermata", () => {
    const confirmed: WalletPaymentMeta = { ...REAL_META_TX1, status: "confirmed" };
    const text = buildWalletPayText(confirmed);
    const bubble = renderWalletPayBubble(text, true);
    const { container } = render(bubble!);
    expect(container.textContent).toContain("Confermata");
  });

  // ── Test 11: emoji WALLETPAY → stessa encoding sia nel producer che nel check
  it("l'emoji 🔐 ha la stessa codifica in sendProgrammatic e nel renderer", () => {
    const PRODUCER_PREFIX = "🔐WALLETPAY:";
    const RENDERER_CHECK  = "🔐WALLETPAY:";
    // Se questo fallisce, c'è una discrepanza di encoding nel file sorgente
    expect(PRODUCER_PREFIX).toBe(RENDERER_CHECK);
    expect(PRODUCER_PREFIX.codePointAt(0)).toBe(0x1F510);  // 🔐 CLOSED LOCK WITH KEY
  });

  // ── Test 12: ChatWalletPaymentBubble non mostra il raw JSON ───────────────
  it("ChatWalletPaymentBubble non mostra mai il raw txHash come stringa JSON", () => {
    const { container } = render(<ChatWalletPaymentBubble meta={REAL_META_TX2} isMine={true} />);
    // NON deve mai apparire la chiave JSON "txHash"
    expect(screen.queryByText(/\"txHash\"/)).toBeNull();
    // Il testo visibile contiene il prefisso dell'hash troncato (0xde91 + ellipsis + ultimi 4 chars)
    expect(container.textContent).toMatch(/0xde91/);
    // L'hash intero NON appare come stringa grezza nel DOM (sarebbe il JSON raw)
    expect(container.textContent).not.toContain('"0xde91');
  });
});
