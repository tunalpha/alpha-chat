import express, { type Express } from "express";
import helmet from "helmet";
import cors from "cors";
import pinoHttp from "pino-http";
import { logger } from "./lib/logger";
import { config } from "./config";
import { requestIdMiddleware } from "./middleware/request-id.middleware";
import { clientVersionMiddleware } from "./middleware/client-version.middleware";
import { errorHandler } from "./errors/error-handler";
import router from "./routes";

const app: Express = express();

// ── Security headers ──────────────────────────────────────────────────────────
app.use(
  helmet({
    crossOriginEmbedderPolicy: false, // Required for Replit preview iframe
    contentSecurityPolicy: config.app.env === "production",
  }),
);

// ── CORS ─────────────────────────────────────────────────────────────────────
const allowedOrigins = config.app.allowedOrigins;
app.use(
  cors({
    origin: allowedOrigins.includes("*") ? "*" : allowedOrigins,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    allowedHeaders: [
      "Authorization",
      "Content-Type",
      "X-Device-ID",
      "X-Request-ID",
      "X-Client-Version",
    ],
    credentials: !allowedOrigins.includes("*"),
    maxAge: 86400,
  }),
);

// ── Request ID (before logger so it appears in logs) ─────────────────────────
app.use(requestIdMiddleware);

// ── HTTP request logger ───────────────────────────────────────────────────────
app.use(
  pinoHttp({
    logger,
    customProps: (req) => ({
      requestId: req.requestId,
    }),
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
  }),
);

// ── Body parsing ──────────────────────────────────────────────────────────────
// Global limit: 25 MB to accommodate media uploads (max video 15 MB × 1.33 base64 ≈ 20 MB).
// Non-media endpoints are protected at the Zod validation layer (field-level length limits).
// Route-level body parsers cannot override the global one because the global runs first
// and rejects before routing; setting a single global limit is the correct Express pattern.
app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: true, limit: "25mb" }));

// ── Client version check ──────────────────────────────────────────────────────
app.use(clientVersionMiddleware);

// ── Application routes ────────────────────────────────────────────────────────
app.use("/api", router);

// ── 404 handler ───────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({
    error: {
      code: "NOT_FOUND",
      message: "Endpoint non trovato.",
      field: null,
      details: null,
      docs: "https://docs.alphachat.app/api",
    },
  });
});

// ── Global error handler (must be last) ──────────────────────────────────────
app.use(errorHandler);

export default app;
