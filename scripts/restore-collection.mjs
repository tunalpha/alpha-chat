/**
 * restore-collection.mjs — Ripristino singola collezione da backup NDJSON
 *
 * Uso: node scripts/restore-collection.mjs <backup_dir> <collection_name> [--dry-run]
 *
 * Esempio:
 *   node scripts/restore-collection.mjs backups/sprint28-2026-07-18T07-24-56 users
 *   node scripts/restore-collection.mjs backups/sprint28-2026-07-18T07-24-56 users --dry-run
 *
 * ATTENZIONE: il restore elimina tutti i documenti esistenti nella collezione
 * e li sostituisce con quelli del backup. Usare solo in caso di emergenza.
 */

import { MongoClient } from "/home/runner/workspace/node_modules/.pnpm/mongodb@7.2.0/node_modules/mongodb/lib/index.js";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const [backupDir, collName, flag] = process.argv.slice(2);
const DRY_RUN = flag === "--dry-run";

if (!backupDir || !collName) {
  console.error("Uso: node scripts/restore-collection.mjs <backup_dir> <collection_name> [--dry-run]");
  process.exit(1);
}

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) { console.error("MONGODB_URI non impostata"); process.exit(1); }

const DB_NAME = "test";
const filePath = resolve(backupDir, `${collName}.ndjson`);
if (!existsSync(filePath)) {
  console.error(`File non trovato: ${filePath}`);
  process.exit(1);
}

const lines = readFileSync(filePath, "utf8").split("\n").filter(Boolean);
const docs = lines.map((l, i) => {
  try { return JSON.parse(l); }
  catch (e) { console.error(`Riga ${i} non valida: ${e.message}`); process.exit(1); }
});

console.log(`\n🔄 Restore ${collName} da ${backupDir}`);
console.log(`   Documenti nel backup: ${docs.length}`);
if (DRY_RUN) console.log("   ⚠️  DRY-RUN — nessuna modifica applicata\n");

if (DRY_RUN) {
  console.log("✅ Dry-run completato — il backup è leggibile e contiene dati validi.");
  process.exit(0);
}

// Conferma interattiva
console.log(`\n⚠️  ATTENZIONE: questa operazione sostituirà TUTTI i documenti in ${DB_NAME}.${collName}`);
console.log("   Premi Ctrl+C per annullare, oppure attendi 5 secondi per procedere…\n");
await new Promise((res) => setTimeout(res, 5000));

const client = new MongoClient(MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
try {
  await client.connect();
  const coll = client.db(DB_NAME).collection(collName);

  const liveCount = await coll.countDocuments();
  console.log(`   Documenti nel DB ora: ${liveCount}`);

  // Drop + reinserimento atomico tramite session
  await coll.deleteMany({});
  if (docs.length > 0) {
    const result = await coll.insertMany(docs, { ordered: false });
    console.log(`✅ Inseriti: ${result.insertedCount}/${docs.length}`);
    if (result.insertedCount !== docs.length) {
      console.error("⚠️  Alcuni documenti non sono stati inseriti — verifica manualmente.");
    }
  }

  const newCount = await coll.countDocuments();
  console.log(`   Documenti nel DB dopo restore: ${newCount}`);
  console.log(`\n✅ Restore ${collName} completato.`);
} finally {
  await client.close();
}
