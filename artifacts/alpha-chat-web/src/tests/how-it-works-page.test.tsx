import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import HowItWorksPage from "../pages/HowItWorksPage";

describe("HowItWorksPage", () => {
  it("spiega i due percorsi di pagamento senza menzionare acquisti con carta", () => {
    render(<HowItWorksPage onBack={vi.fn()} onOpenWallet={vi.fn()} />);

    expect(screen.getByRole("heading", { name: "L'ecosistema Alpha" })).toBeInTheDocument();
    expect(screen.getByText(/P2P diretto \(Alpha Wallet\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Sistema Escrow \(Wallet Esterni\)/i)).toBeInTheDocument();
    expect(screen.getByText("RACCOMANDATO")).toBeInTheDocument();
    expect(screen.getByText("Come funziona lo swap")).toBeInTheDocument();
    expect(screen.queryByText(/acquista con carta/i)).not.toBeInTheDocument();
  });

  it("permette di tornare indietro o aprire Alpha Wallet", () => {
    const onBack = vi.fn();
    const onOpenWallet = vi.fn();
    render(<HowItWorksPage onBack={onBack} onOpenWallet={onOpenWallet} />);

    fireEvent.click(screen.getByRole("button", { name: "Indietro" }));
    fireEvent.click(screen.getByRole("button", { name: "Apri Alpha Wallet" }));

    expect(onBack).toHaveBeenCalledOnce();
    expect(onOpenWallet).toHaveBeenCalledOnce();
  });

  it("apre la guida dello swap dalla card e permette di chiuderla", () => {
    render(<HowItWorksPage onBack={vi.fn()} onOpenWallet={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /Come funziona lo swap/i }));

    expect(screen.getByRole("dialog", { name: "Scambia con chiarezza" })).toBeInTheDocument();
    expect(screen.getByText("Rivedi prima di firmare")).toBeInTheDocument();
    expect(screen.getByText("Seleziona la coppia")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Chiudi guida swap" }));

    expect(screen.queryByRole("dialog", { name: "Scambia con chiarezza" })).not.toBeInTheDocument();
  });
});