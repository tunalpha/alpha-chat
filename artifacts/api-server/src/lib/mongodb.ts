import mongoose from "mongoose";
import { logger } from "./logger";
import { config } from "../config";

let isConnected = false;
let connectionLatencyMs: number | null = null;

export async function connectMongoDB(): Promise<void> {
  if (!config.db.mongoUri) {
    logger.warn("MONGODB_URI not set — skipping MongoDB connection");
    return;
  }

  try {
    const start = Date.now();
    await mongoose.connect(config.db.mongoUri, {
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 10000,
      maxPoolSize: 10,
      minPoolSize: 2,
    });
    connectionLatencyMs = Date.now() - start;
    isConnected = true;
    logger.info({ latencyMs: connectionLatencyMs }, "MongoDB connected");

    // Sincronizza gli indici di tutti i modelli Mongoose con il database.
    // Senza questo passaggio gli indici definiti negli schema non vengono creati
    // su collection già esistenti (Mongoose non li applica automaticamente a runtime).
    // createIndexes() aggiunge gli indici mancanti senza rimuovere quelli extra.
    try {
      await mongoose.connection.syncIndexes();
      logger.info("MongoDB indexes synced");
    } catch (idxErr) {
      // Errore non fatale: l'app funziona, ma alcune garanzie di unicità
      // (es. client_upload_id per idempotenza upload) potrebbero mancare.
      logger.warn({ idxErr }, "MongoDB index sync failed — some unique constraints may be missing");
    }
  } catch (err) {
    logger.fatal({ err }, "MongoDB connection failed — cannot start");
    process.exit(1);
  }

  mongoose.connection.on("error", (err) => {
    logger.error({ err }, "MongoDB connection error");
    isConnected = false;
  });

  mongoose.connection.on("disconnected", () => {
    logger.warn("MongoDB disconnected");
    isConnected = false;
  });

  mongoose.connection.on("reconnected", () => {
    logger.info("MongoDB reconnected");
    isConnected = true;
  });
}

export async function disconnectMongoDB(): Promise<void> {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
    logger.info("MongoDB disconnected (graceful shutdown)");
  }
}

export function getMongoStatus(): {
  status: "ok" | "disconnected" | "not_configured";
  latency_ms: number | null;
  connections: number;
} {
  if (!config.db.mongoUri) {
    return { status: "not_configured", latency_ms: null, connections: 0 };
  }
  return {
    status: isConnected ? "ok" : "disconnected",
    latency_ms: connectionLatencyMs,
    connections: 0,
  };
}

/**
 * Pings the DB and returns the latency in ms.
 * Used by the /status endpoint.
 */
export async function pingMongoDB(): Promise<{ ok: boolean; latency_ms: number }> {
  const start = Date.now();
  try {
    if (!config.db.mongoUri || !isConnected) {
      return { ok: false, latency_ms: 0 };
    }
    await mongoose.connection.db?.admin().ping();
    const latency_ms = Date.now() - start;
    connectionLatencyMs = latency_ms;
    return { ok: true, latency_ms };
  } catch {
    return { ok: false, latency_ms: Date.now() - start };
  }
}
