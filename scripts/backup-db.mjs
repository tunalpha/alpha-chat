/**
 * backup-db.mjs — Backup MongoDB per Sprint 28 Phase 4
 *
 * Esporta le collezioni target in file NDJSON nella cartella
 * backups/sprint28-<timestamp>/.
 *
 * Verifica il backup calcolando il conteggio documenti dal file e
 * confrontandolo con il conteggio live nel DB.
 *
 * Uso: node scripts/backup-db.mjs
 */

import { MongoClient } from "/home/runner/workspace/node_modules/.pnpm/mongodb@7.2.0/node_modules/mongodb/lib/index.js";
import { createWriteStream, mkdirSync, statSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error("ERRORE: MONGODB_URI non impostata");
  process.exit(1);
}

// Collezioni Alpha Chat da esportare (database: test)
const DB_NAME = "test";
const COLLECTIONS = [
  "users",
  "signal_key_bundles",
  "sessions",
  "auditevents",
  "messages",
  "conversations",
  "conversationmembers",
  "media",
];

const TS = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const BACKUP_DIR = resolve(`/home/runner/workspace/backups/sprint28-${TS}`);

mkdirSync(BACKUP_DIR, { recursive: true });
console.log(`\n📦 Backup MongoDB Alpha Chat — ${new Date().toISOString()}`);
console.log(`   DB: ${DB_NAME}`);
console.log(`   Destinazione: ${BACKUP_DIR}\n`);

const client = new MongoClient(MONGODB_URI, {
  serverSelectionTimeoutMS: 10000,
  connectTimeoutMS: 10000,
});

const results = [];

try {
  await client.connect();
  console.log("✅ Connessione MongoDB stabilita\n");

  const db = client.db(DB_NAME);
  const available = (await db.listCollections().toArray()).map((c) => c.name);
  console.log(`   Collezioni disponibili: ${available.join(", ")}\n`);

  for (const collName of COLLECTIONS) {
    if (!available.includes(collName)) {
      console.log(`⚪ ${collName} — non presente, skip`);
      results.push({ collection: collName, status: "skip", count: 0, sizeKB: 0 });
      continue;
    }

    const coll = db.collection(collName);
    const liveCount = await coll.countDocuments();
    const outPath = resolve(BACKUP_DIR, `${collName}.ndjson`);
    const ws = createWriteStream(outPath);

    let written = 0;
    const cursor = coll.find({});
    for await (const doc of cursor) {
      ws.write(JSON.stringify(doc) + "\n");
      written++;
    }
    await new Promise((res, rej) => { ws.end(); ws.on("finish", res); ws.on("error", rej); });

    const sizeKB = Math.round(statSync(outPath).size / 1024);
    const ok = written === liveCount;
    console.log(`${ok ? "✅" : "⚠️"} ${collName}: ${written}/${liveCount} doc → ${sizeKB} KB`);
    results.push({ collection: collName, status: ok ? "ok" : "mismatch", count: written, liveCount, sizeKB });
  }

} finally {
  await client.close();
}

// ─── Verifica leggibilità NDJSON ─────────────────────────────────────────────
console.log("\n🔍 Verifica leggibilità backup…");
let verifyOk = true;
for (const r of results) {
  if (r.status === "skip" || r.count === 0) {
    if (r.status !== "skip") console.log(`   ⚪ ${r.collection}: 0 documenti`);
    continue;
  }
  const filePath = resolve(BACKUP_DIR, `${r.collection}.ndjson`);
  try {
    const lines = readFileSync(filePath, "utf8").split("\n").filter(Boolean);
    // Verifica prima, metà e ultima riga
    const toCheck = [...new Set([0, Math.floor(lines.length / 2), lines.length - 1])].filter((i) => i < lines.length);
    for (const i of toCheck) {
      JSON.parse(lines[i]);
    }
    // Spot-check: controlla che users abbiano _id e username
    if (r.collection === "users") {
      const sample = JSON.parse(lines[0]);
      if (!sample._id || !sample.username) throw new Error("struttura user inattesa");
      // Verifica campi IK Sprint 28
      const hasIkField = "encrypted_identity_key" in sample;
      console.log(`   ✅ ${r.collection}: ${lines.length} righe OK (campo IK presente: ${hasIkField})`);
    } else {
      console.log(`   ✅ ${r.collection}: ${lines.length} righe OK`);
    }
  } catch (e) {
    console.error(`   ❌ ${r.collection}: verifica fallita → ${e.message}`);
    verifyOk = false;
  }
}

// ─── Spot check: verifica distribuzione IK nei users ──────────────────────────
const usersPath = resolve(BACKUP_DIR, "users.ndjson");
try {
  const userLines = readFileSync(usersPath, "utf8").split("\n").filter(Boolean);
  const users = userLines.map((l) => JSON.parse(l));
  const withBlob = users.filter((u) => u.encrypted_identity_key).length;
  const withoutBlob = users.filter((u) => !u.encrypted_identity_key).length;
  console.log(`\n📊 Distribuzione IK nei ${users.length} utenti:`);
  console.log(`   Con blob (post-Sprint28):  ${withBlob}`);
  console.log(`   Senza blob (legacy):       ${withoutBlob}`);
  if (withoutBlob > 0) {
    console.log(`   ℹ️  I ${withoutBlob} utenti legacy riceveranno migrazione lazy al prossimo login.`);
  }
} catch {
  // non bloccante
}

// ─── Manifesto ───────────────────────────────────────────────────────────────
const manifest = {
  backup_time: new Date().toISOString(),
  db: DB_NAME,
  purpose: "Sprint 28 Phase 4 pre-activation backup",
  collections: results,
  verify_ok: verifyOk,
  restore_command: `# Per ripristinare una singola collezione:\n# node scripts/restore-collection.mjs <backup_dir> <collection_name>`,
};
const manifestPath = resolve(BACKUP_DIR, "manifest.json");
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

// ─── Riepilogo ───────────────────────────────────────────────────────────────
const totalDocs = results.reduce((s, r) => s + r.count, 0);
const totalKB = results.reduce((s, r) => s + r.sizeKB, 0);
const allOk = results.every((r) => r.status === "ok" || r.status === "skip");

console.log(`\n${"─".repeat(60)}`);
console.log(`   Backup completato: ${totalDocs} documenti, ~${totalKB} KB`);
console.log(`   Conteggi corretti: ${allOk ? "✅ Tutti OK" : "⚠️  Mismatch rilevati"}`);
console.log(`   Verifica NDJSON:   ${verifyOk ? "✅ OK" : "❌ PROBLEMI"}`);
console.log(`   Manifesto:         ${manifestPath}`);
console.log(`   Directory:         ${BACKUP_DIR}`);
console.log("─".repeat(60) + "\n");

if (!verifyOk || !allOk) process.exit(1);
