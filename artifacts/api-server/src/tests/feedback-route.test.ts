import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { sendUserFeedbackEmail } from "../services/email.service";

vi.mock("../middleware/authenticate.middleware", () => ({
  authenticate: (req: { user?: unknown }, _res: unknown, next: () => void) => {
    req.user = { userId: "authenticated-user" };
    next();
  },
}));

vi.mock("../services/email.service", () => ({
  sendUserFeedbackEmail: vi.fn(),
}));

async function buildApp() {
  const { default: feedbackRouter } = await import("../routes/v1/feedback.routes");
  const app = express();
  app.use(express.json());
  app.use("/feedback", feedbackRouter);
  app.use((err: { name?: string; message?: string }, _req: unknown, res: express.Response, _next: unknown) => {
    res.status(err.name === "ZodError" ? 400 : 500).json({ error: err.message });
  });
  return app;
}

describe("Feedback route contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("richiede il riferimento per i problemi di transazione", async () => {
    const app = await buildApp();
    const response = await request(app)
      .post("/feedback")
      .send({ category: "transaction", message: "Una descrizione sufficientemente completa." });

    expect(response.status).toBe(400);
    expect(sendUserFeedbackEmail).not.toHaveBeenCalled();
  });

  it("rifiuta un riferimento transazione per categorie diverse", async () => {
    const app = await buildApp();
    const response = await request(app)
      .post("/feedback")
      .send({
        category: "suggestion",
        message: "Vorrei suggerire una piccola miglioria dell'interfaccia.",
        transaction_reference: "0xnot-allowed-here",
      });

    expect(response.status).toBe(400);
    expect(sendUserFeedbackEmail).not.toHaveBeenCalled();
  });

  it("inoltra solo i campi consentiti al servizio e-mail", async () => {
    vi.mocked(sendUserFeedbackEmail).mockResolvedValue();
    const app = await buildApp();
    const response = await request(app)
      .post("/feedback")
      .send({
        category: "general",
        message: "Vorrei ricevere maggiori informazioni sul servizio.",
        reply_to: "contact@example.com",
        to: "attacker@example.com",
        from: "attacker@example.com",
      });

    expect(response.status).toBe(202);
    expect(sendUserFeedbackEmail).toHaveBeenCalledWith({
      userId: "authenticated-user",
      category: "general",
      message: "Vorrei ricevere maggiori informazioni sul servizio.",
      transactionReference: undefined,
      replyTo: "contact@example.com",
    });
  });
});