/**
 * Script temporaneo: imposta ChangeNOW come PRIMARY provider
 * Equivale al flusso Admin Panel → Swap Providers → Enable → Set Primary
 * Esegui con: pnpm --filter @workspace/api-server tsx src/scripts/set-changenow-primary.ts
 */
import mongoose from "mongoose";
import { SwapProviderConfigModel, seedSwapProviders } from "../models/swap-provider-config.js";

const uri = process.env.MONGODB_URI;
if (!uri) { console.error("MONGODB_URI non configurata"); process.exit(1); }

await mongoose.connect(uri, { serverSelectionTimeoutMS: 8000 });
console.log("MongoDB connesso");

await seedSwapProviders(); // idempotente

// Step 1 — Enable ChangeNOW (equivale a click "Enable" nel pannello)
await SwapProviderConfigModel.updateOne(
  { providerId: "changenow" },
  { $set: { status: "enabled", updatedAt: new Date() } }
);
// Step 2 — Set Primary (equivale a click "Set Primary")
await SwapProviderConfigModel.updateOne(
  { providerId: "changenow" },
  { $set: { isPrimary: true, updatedAt: new Date() } }
);
// Step 3 — Rimuovi primary da Li.Fi (come fa updateProviderConfig nel service)
await SwapProviderConfigModel.updateOne(
  { providerId: "lifi" },
  { $set: { isPrimary: false, updatedAt: new Date() } }
);

const all = await SwapProviderConfigModel.find({}).lean();
console.log("\nDB STATO FINALE:");
all.forEach(p => {
  const tag = p.isPrimary ? "★ PRIMARY" : p.status === "enabled" ? "  enabled" : "  disabled";
  console.log(`  ${tag}  ${p.providerId}  (status: ${p.status})`);
});

await mongoose.disconnect();
console.log("\nFatto. GET /api/v1/swap/config deve restituire activeEvmProvider: \"changenow\"");
