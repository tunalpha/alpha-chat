import { Router } from "express";
import mongoose from "mongoose";
import { logger } from "../lib/logger";

const router = Router();

// Cache active connections to avoid re-connecting on every request
const connectionCache = new Map<string, mongoose.Connection>();

async function getConnection(uri: string): Promise<mongoose.Connection> {
  if (connectionCache.has(uri)) {
    const conn = connectionCache.get(uri)!;
    if (conn.readyState === 1) return conn;
    connectionCache.delete(uri);
  }

  const conn = await mongoose.createConnection(uri, {
    serverSelectionTimeoutMS: 5000,
    connectTimeoutMS: 5000,
  }).asPromise();

  connectionCache.set(uri, conn);
  return conn;
}

// POST /api/mongo/test — verifica connessione
router.post("/mongo/test", async (req, res) => {
  const { uri } = req.body as { uri?: string };

  if (!uri || typeof uri !== "string" || uri.trim() === "") {
    res.status(400).json({ error: "URI mancante." });
    return;
  }

  const trimmed = uri.trim();
  if (!trimmed.startsWith("mongodb://") && !trimmed.startsWith("mongodb+srv://")) {
    res.status(400).json({ error: "URI non valido. Deve iniziare con mongodb:// o mongodb+srv://" });
    return;
  }

  try {
    const conn = await getConnection(trimmed);
    const admin = conn.db.admin();
    const info = await admin.serverInfo();
    const dbName = conn.db.databaseName;

    // extract host from URI
    let host = "sconosciuto";
    try {
      const url = new URL(trimmed.replace("mongodb+srv://", "https://").replace("mongodb://", "https://"));
      host = url.hostname;
    } catch {}

    logger.info({ dbName, host }, "MongoDB connection successful");
    res.json({ ok: true, dbName, host });
  } catch (err: any) {
    logger.error({ err: err?.message }, "MongoDB connection failed");
    res.status(400).json({ error: err?.message ?? "Connessione fallita." });
  }
});

// GET /api/mongo/collections?uri=... — lista collection
router.get("/mongo/collections", async (req, res) => {
  const uri = (req.query.uri as string | undefined)?.trim();

  if (!uri) {
    res.status(400).json({ error: "Parametro uri mancante." });
    return;
  }

  try {
    const conn = await getConnection(uri);
    const rawCollections = await conn.db.listCollections().toArray();

    const collections = await Promise.all(
      rawCollections.map(async (col) => {
        let count: number | null = null;
        try {
          count = await conn.db.collection(col.name).estimatedDocumentCount();
        } catch {}
        return { name: col.name, type: col.type ?? "collection", count };
      })
    );

    res.json({ collections });
  } catch (err: any) {
    logger.error({ err: err?.message }, "Failed to list collections");
    res.status(400).json({ error: err?.message ?? "Impossibile leggere le collection." });
  }
});

// POST /api/mongo/collections — crea collection
router.post("/mongo/collections", async (req, res) => {
  const { uri, name } = req.body as { uri?: string; name?: string };

  if (!uri || typeof uri !== "string" || uri.trim() === "") {
    res.status(400).json({ error: "URI mancante." });
    return;
  }
  if (!name || typeof name !== "string" || name.trim() === "") {
    res.status(400).json({ error: "Nome della collection mancante." });
    return;
  }

  const collectionName = name.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_");

  if (collectionName.length < 1) {
    res.status(400).json({ error: "Nome non valido." });
    return;
  }

  try {
    const conn = await getConnection(uri.trim());

    // check if already exists
    const existing = await conn.db.listCollections({ name: collectionName }).toArray();
    if (existing.length > 0) {
      res.status(400).json({ error: `La collection "${collectionName}" esiste già.` });
      return;
    }

    await conn.db.createCollection(collectionName);
    logger.info({ collectionName }, "Collection created");

    res.status(201).json({
      ok: true,
      name: collectionName,
      message: `Collection "${collectionName}" creata con successo.`,
    });
  } catch (err: any) {
    logger.error({ err: err?.message }, "Failed to create collection");
    res.status(400).json({ error: err?.message ?? "Impossibile creare la collection." });
  }
});

export default router;
