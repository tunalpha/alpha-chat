import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import FeedbackPage from "../pages/FeedbackPage";
import { apiSubmitUserFeedback } from "../lib/api";

vi.mock("../lib/api", () => ({
  apiSubmitUserFeedback: vi.fn(),
}));

describe("FeedbackPage", () => {
  beforeEach(() => {
    vi.mocked(apiSubmitUserFeedback).mockReset();
  });

  it("mostra il riferimento Exchange ID solo per un problema transazione", () => {
    render(<FeedbackPage onBack={vi.fn()} />);

    expect(screen.queryByLabelText(/Exchange ID o hash/i)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Motivo della segnalazione/i), { target: { value: "transaction" } });
    expect(screen.getByLabelText(/Exchange ID o hash/i)).toBeInTheDocument();
  });

  it("invia il modulo con email opzionale come contatto", async () => {
    vi.mocked(apiSubmitUserFeedback).mockResolvedValue();
    render(<FeedbackPage onBack={vi.fn()} />);

    fireEvent.change(screen.getByLabelText(/Motivo della segnalazione/i), { target: { value: "transaction" } });
    fireEvent.change(screen.getByLabelText(/Exchange ID o hash/i), { target: { value: "0xabc123" } });
    fireEvent.change(screen.getByLabelText(/Descrivi la segnalazione/i), { target: { value: "La transazione risulta ancora in attesa." } });
    fireEvent.change(screen.getByLabelText(/E-mail per essere ricontattato/i), { target: { value: "utente@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: /Invia segnalazione/i }));

    await waitFor(() => {
      expect(apiSubmitUserFeedback).toHaveBeenCalledWith({
        category: "transaction",
        transactionReference: "0xabc123",
        message: "La transazione risulta ancora in attesa.",
        replyTo: "utente@example.com",
      });
    });
    expect(screen.getByRole("status")).toHaveTextContent(/Segnalazione inviata/i);
  });
});