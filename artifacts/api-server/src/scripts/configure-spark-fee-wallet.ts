/**
 * configure-spark-fee-wallet.ts — Setup one-time Spark Fee Wallet
 *
 * Questo script configura il fee wallet Spark e genera il wallet treasury.
 *
 * Operazioni:
 *   1. Deriva il Spark address del fee wallet dall'ALPHA_SPARK_FEE_MNEMONIC
 *   2. Salva fee_address in MongoDB
 *   3. Genera un nuovo mnemonic BIP39 24 parole per il treasury (se non già configurato)
 *   4. Deriva il treasury Spark address (sp1...) da quel mnemonic
 *   5. Salva sweep_treasury_spark_address in MongoDB
 *   6. Stampa il treasury mnemonic UNA SOLA VOLTA per il salvataggio come Replit Secret
 *
 * SICUREZZA:
 *   - ALPHA_SPARK_FEE_MNEMONIC letto SOLO da process.env (mai loggato)
 *   - Treasury mnemonic: stampato UNA VOLTA su stdout (cerimonia di key setup)
 *     → L'admin deve salvarlo come Replit Secret ALPHA_SPARK_TREASURY_MNEMONIC
 *     → NON viene salvato in MongoDB, logs applicativi, codice o file
 *   - Gli Spark address (sp1...) sono chiavi PUBBLICHE — sicuri in MongoDB
 *
 * Uso:
 *   pnpm --filter @workspace/api-server tsx src/scripts/configure-spark-fee-wallet.ts
 *   pnpm --filter @workspace/api-server tsx src/scripts/configure-spark-fee-wallet.ts --dry-run
 */

import mongoose from "mongoose";
import { generateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import {
  getFeeWalletSparkAddress,
  getSparkAddressFromMnemonic,
} from "../services/spark-fee-wallet-executor";
import { SparkFeeConfigModel } from "../models/spark-fee-config.model";

const DRY_RUN = process.argv.includes("--dry-run");

function separator() {
  console.log("─".repeat(60));
}

async function main() {
  console.log("");
  separator();
  console.log("  ⚡ Spark Fee Wallet — Configurazione");
  if (DRY_RUN) console.log("  🔍 DRY-RUN: nessuna scrittura su MongoDB");
  separator();
  console.log("");

  // ── Connessione MongoDB ───────────────────────────────────────────────────
  const uri = process.env["MONGODB_URI"];
  if (!uri) throw new Error("MONGODB_URI non configurato");
  await mongoose.connect(uri);
  console.log("✓ MongoDB connesso\n");

  // ── STEP 1: Fee wallet address ────────────────────────────────────────────
  console.log("→ [STEP 1] Derivazione fee wallet Spark address...");
  console.log("  (Connessione al Spark SDK — può richiedere 30-60s)\n");

  const feeAddress = await getFeeWalletSparkAddress();
  console.log(`  ✓ Fee wallet Spark address: ${feeAddress.slice(0, 20)}...${feeAddress.slice(-8)}`);
  console.log(`  ✓ Formato mainnet: ${feeAddress.startsWith("sp1") ? "✅ sp1..." : "⚠️ NON sp1"}\n`);

  // ── STEP 2: Treasury mnemonic + address ──────────────────────────────────
  // Controlla se un indirizzo treasury è già configurato
  const existing = await SparkFeeConfigModel.findById("spark-fee").lean();
  const existingTreasury = existing?.sweep_treasury_spark_address;

  let treasuryAddress: string;
  let treasuryMnemonicForUser: string | null = null;

  if (existingTreasury && existingTreasury.startsWith("sp1")) {
    console.log("→ [STEP 2] Treasury Spark address già configurato:");
    console.log(`  ${existingTreasury.slice(0, 20)}...${existingTreasury.slice(-8)}`);
    console.log("  (Non verrà rigenerato)\n");
    treasuryAddress = existingTreasury;
  } else {
    console.log("→ [STEP 2] Generazione treasury mnemonic BIP39 (24 parole)...");
    const newMnemonic = generateMnemonic(wordlist, 256); // 256 bit = 24 parole

    console.log("  (Connessione al Spark SDK per derivare treasury address — può richiedere 30-60s)\n");
    treasuryAddress = await getSparkAddressFromMnemonic(newMnemonic);

    console.log(`  ✓ Treasury Spark address: ${treasuryAddress.slice(0, 20)}...${treasuryAddress.slice(-8)}`);
    console.log(`  ✓ Formato mainnet: ${treasuryAddress.startsWith("sp1") ? "✅ sp1..." : "⚠️ NON sp1"}\n`);

    // Salva per stampa finale (FUORI dai log applicativi)
    treasuryMnemonicForUser = newMnemonic;
  }

  // ── STEP 3: Persistenza MongoDB ───────────────────────────────────────────
  if (!DRY_RUN) {
    console.log("→ [STEP 3] Aggiornamento MongoDB...");
    await SparkFeeConfigModel.findOneAndUpdate(
      { _id: "spark-fee" },
      {
        $set: {
          fee_address:                  feeAddress,
          sweep_treasury_spark_address: treasuryAddress,
          updated_at:                   new Date(),
          updated_by:                   "setup-script",
          updated_by_email:             "setup-script",
        },
        $setOnInsert: {
          _id:                "spark-fee",
          fee_bps:            10,
          min_fee_sat:        1,
          quote_validity_sec: 30,
          sweep_threshold_eur: 100,
          auto_sweep_enabled: false,
        },
      },
      { upsert: true, returnDocument: "after" },
    );
    console.log("  ✓ fee_address salvato");
    console.log("  ✓ sweep_treasury_spark_address salvato");
    console.log("  ✓ auto_sweep_enabled=false (invariato)\n");
  } else {
    console.log("→ [STEP 3] DRY-RUN — skip MongoDB write\n");
  }

  // ── STEP 4: Verifica finale ───────────────────────────────────────────────
  if (!DRY_RUN) {
    const cfg = await SparkFeeConfigModel.findById("spark-fee").lean();
    console.log("→ [STEP 4] Verifica configurazione MongoDB:");
    console.log(`  fee_address:                  ${cfg?.fee_address?.slice(0, 20) ?? "NULL"}...`);
    console.log(`  sweep_treasury_spark_address: ${cfg?.sweep_treasury_spark_address?.slice(0, 20) ?? "NULL"}...`);
    console.log(`  auto_sweep_enabled:           ${cfg?.auto_sweep_enabled}`);
    console.log(`  sweep_threshold_eur:          €${cfg?.sweep_threshold_eur}\n`);
  }

  // ── OUTPUT TREASURY MNEMONIC (una sola volta, solo se appena generato) ────
  if (treasuryMnemonicForUser) {
    separator();
    console.log("");
    console.log("  ⚠️  AZIONE RICHIESTA — SALVA QUESTO MNEMONIC");
    console.log("");
    console.log("  Il seguente mnemonic controlla il wallet TREASURY Spark.");
    console.log("  Chi possiede queste parole può spendere i fondi ricevuti nel treasury.");
    console.log("");
    console.log("  ┌─ TREASURY MNEMONIC (24 parole) ──────────────────────────┐");
    // Stampa le parole in blocchi da 4 per leggibilità
    const words = treasuryMnemonicForUser.split(" ");
    for (let i = 0; i < words.length; i += 4) {
      const line = words
        .slice(i, i + 4)
        .map((w, j) => `${String(i + j + 1).padStart(2, " ")}. ${w.padEnd(12, " ")}`)
        .join("  ");
      console.log(`  │  ${line}│`);
    }
    console.log("  └────────────────────────────────────────────────────────────┘");
    console.log("");
    console.log("  📋 ISTRUZIONI:");
    console.log("  1. Scrivi queste 24 parole su carta fisica");
    console.log("  2. Conservala in luogo sicuro (non digitale)");
    console.log("  3. Salva il mnemonic come Replit Secret:");
    console.log("     Chiave: ALPHA_SPARK_TREASURY_MNEMONIC");
    console.log("     Valore: [le 24 parole separete da spazio]");
    console.log("");
    console.log("  ⚠️  Questo mnemonic NON viene salvato in MongoDB, nei log,");
    console.log("      nel codice o nelle API. Non sarà mostrato di nuovo.");
    console.log("");
    separator();
  }

  console.log("");
  console.log("✅ Configurazione Spark Fee Wallet completata.");
  separator();
  console.log("");
}

main()
  .then(() => {
    void mongoose.disconnect();
    process.exit(0);
  })
  .catch((err: Error) => {
    // SICUREZZA: mai loggare il mnemonic negli errori
    const msg = err.message?.replace(/(?:\b\w+\b\s+){11,23}\b\w+\b/g, "[REDACTED]");
    console.error("\n❌ Errore:", msg);
    void mongoose.disconnect();
    process.exit(1);
  });
