import { describe, expect, it, vi, beforeEach } from "vitest";

const sendMail = vi.fn();

vi.mock("nodemailer", () => ({
  default: {
    createTransport: vi.fn(() => ({ sendMail })),
  },
}));

vi.mock("../lib/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

describe("sendUserFeedbackEmail", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.NODE_ENV = "development";
    process.env.SMTP_HOST = "smtp.test";
    process.env.SMTP_USER = "admin@example.com";
    process.env.ADMIN_EMAIL = "owner@example.com";
  });

  it("uses the optional contact only as Reply-To and escapes HTML", async () => {
    const { sendUserFeedbackEmail } = await import("../services/email.service");

    await sendUserFeedbackEmail({
      userId: "user-123",
      category: "transaction",
      transactionReference: "<script>bad()</script>",
      message: "Descrizione <b>non fidata</b>",
      replyTo: "contact@example.com",
    });

    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({
      from: expect.any(String),
      to: "owner@example.com",
      replyTo: "contact@example.com",
      subject: expect.stringContaining("Problema transazione"),
      html: expect.stringContaining("&lt;script&gt;bad()&lt;/script&gt;"),
    }));
    expect(sendMail.mock.calls[0][0].html).not.toContain("<script>bad()</script>");
  });
});