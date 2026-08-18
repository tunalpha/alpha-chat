/**
 * Switch provider: Li.Fi → DISABLED, ChangeNOW → ENABLED+PRIMARY
 * Eseguire PRIMA del deploy per attivare ChangeNOW al go-live.
 * Usa la stessa MONGODB_URI dell'app.
 */
import mongoose from "mongoose";

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) { console.error("MONGODB_URI non impostata"); process.exit(1); }

await mongoose.connect(MONGODB_URI);
console.log("✅ Connesso a MongoDB");

const col = mongoose.connection.collection("swap_provider_configs");

// 1. Upsert Li.Fi → DISABLED
const lifi = await col.findOneAndUpdate(
  { providerId: "lifi" },
  { $set: { status: "disabled", isPrimary: false, isFallback: false, updatedBy: "deploy-script" }, $setOnInsert: { providerId: "lifi", displayName: "Li.Fi" } },
  { upsert: true, returnDocument: "after" }
);
console.log("Li.Fi →", lifi?.status, "| isPrimary:", lifi?.isPrimary);

// 2. Upsert ChangeNOW → ENABLED+PRIMARY
const cn = await col.findOneAndUpdate(
  { providerId: "changenow" },
  { $set: { status: "enabled", isPrimary: true, isFallback: false, updatedBy: "deploy-script" }, $setOnInsert: { providerId: "changenow", displayName: "ChangeNOW" } },
  { upsert: true, returnDocument: "after" }
);
console.log("ChangeNOW →", cn?.status, "| isPrimary:", cn?.isPrimary);

// 3. Verifica finale
const all = await col.find({}).toArray();
console.log("\n=== Configurazione finale ===");
all.forEach(p => console.log(`${p.providerId}: status=${p.status} | isPrimary=${p.isPrimary} | isFallback=${p.isFallback}`));

await mongoose.disconnect();
console.log("\n✅ Switch completato.");
