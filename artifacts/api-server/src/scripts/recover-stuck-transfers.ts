/**
 * recover-stuck-transfers.ts — Recovery manuale dei transfer bloccati in "pending".
 *
 * Incidente 2026-08-14: doppio addebito di 1733 USDA a Sirtre.
 *
 * Transfer da recuperare:
 *   - 18a04c19-b762-4ce8-bf41-f9a987802e57  (Sirtre→Alpha, pending da 10:26)
 *   - 586ca479-b7fb-48d3-93dc-245c2ed352ed  (Alpha→Sirtre "Doppio accredito", pending da 11:26)
 *
 * Esecuzione:
 *   cd artifacts/api-server
 *   npx tsx src/scripts/recover-stuck-transfers.ts
 */

import mongoose from "mongoose";
import { logger } from "../lib/logger";

const TRANSFER_IDS = [
  "18a04c19-b762-4ce8-bf41-f9a987802e57",  // Sirtre→Alpha stuck
  "586ca479-b7fb-48d3-93dc-245c2ed352ed",  // Alpha→Sirtre doppio accredito stuck
];

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI non configurata");

  await mongoose.connect(uri);
  logger.info("[Recovery] Connesso a MongoDB ✓");

  // Import lazy per evitare side-effect all'avvio (scheduler, ecc.)
  const { autoReleaseForSend } = await import("../payment/chat-payment.service");

  for (const transferId of TRANSFER_IDS) {
    logger.info({ transferId }, "[Recovery] Avvio auto-release...");
    try {
      await autoReleaseForSend(transferId);
      logger.info({ transferId }, "[Recovery] ✅ Completato");
    } catch (err) {
      logger.error({ err, transferId }, "[Recovery] ❌ Errore");
    }
  }

  await mongoose.disconnect();
  logger.info("[Recovery] Disconnesso. Verifica i log sopra per l'esito.");
}

main().catch((err) => {
  console.error("[Recovery] FATAL:", err);
  process.exit(1);
});
