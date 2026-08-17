/**
 * Script one-shot: importa le transazioni EVM swap storiche nel DB.
 *
 * Uso:
 *   pnpm --filter @workspace/api-server tsx src/scripts/import-evm-swaps.ts
 *
 * I record sono deduplici su txHash — rieseguire è sicuro.
 * NON modifica le transazioni on-chain: crea solo l'audit trail interno.
 * Le commissioni (25 bps) sono calcolate sul volume USD dell'export allegato.
 */

import mongoose from "mongoose";
import { EvmSwapModel } from "../models/EvmSwap.js";

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error("❌ MONGODB_URI non impostato");
  process.exit(1);
}

// ── Dati dall'export Excel (Africa/Tunis UTC+1 → convertiti a UTC) ────────────
// timestamp = ora locale − 1h = UTC
// Fonte: allegato 20260817_180122_1786990035859.xlsx
const HISTORICAL_RECORDS = [
  {
    txHash:      "0x72593e68aa5f412a935e7d89c7c3d3344ac6dc86bc15f1b9505caabbcc3579e9",
    fromChainId: 1,    // Ethereum
    toChainId:   0,    // Bitcoin (non-EVM)
    fromToken:   "USDT",
    toToken:     "BTC",
    volumeUSD:   14.97,
    tool:        "Layerswap",
    timestamp:   new Date("2026-08-17T15:57:00.000Z"),
  },
  {
    txHash:      "0xfe5e5b281e8e8b640536a2734e6250e55aa2b8b2002fa142d731267a5552ed15",
    fromChainId: 1,    // Ethereum
    toChainId:   137,  // Polygon
    fromToken:   "USDT",
    toToken:     "POL",
    volumeUSD:   4.99,
    tool:        "Near",
    timestamp:   new Date("2026-08-17T15:54:00.000Z"),
  },
  {
    txHash:      "0xbe37765dc7f9e9f64518d8da4dbb21eafde66b23f3bbacace7e8a1d69108c0e4",
    fromChainId: 56,   // BSC
    toChainId:   56,   // BSC
    fromToken:   "USDC",
    toToken:     "USDT",
    volumeUSD:   1.11,
    tool:        "Fly",
    timestamp:   new Date("2026-08-17T15:38:00.000Z"),
  },
  {
    txHash:      "0x385a49638cd50c7e5480f1e1c94613a461cb5ae53801b2a2a8b6845a6e387834",
    fromChainId: 56,   // BSC
    toChainId:   56,   // BSC
    fromToken:   "BNB",
    toToken:     "USDC",
    volumeUSD:   1.16,
    tool:        "Nordstern",
    timestamp:   new Date("2026-08-17T12:08:00.000Z"),
  },
  {
    txHash:      "0xf61fc3fe54151e60370ea09c2a10bf3531d3bd616ad21bab9d3fffd9c3c90755",
    fromChainId: 137,  // Polygon
    toChainId:   137,  // Polygon
    fromToken:   "POL",
    toToken:     "USDC",
    volumeUSD:   0.89,
    tool:        "Sushiswap",
    timestamp:   new Date("2026-08-17T11:44:00.000Z"),
  },
  {
    txHash:      "0x62779366cb8f050fc21650ecd99983b0b70ba95a9570684685e2e0c2b1aaaf67",
    fromChainId: 56,   // BSC
    toChainId:   137,  // Polygon
    fromToken:   "BNB",
    toToken:     "POL",
    volumeUSD:   1.16,
    tool:        "Gaszipbridge",
    timestamp:   new Date("2026-08-17T08:36:00.000Z"),
  },
  {
    txHash:      "0x170b80f1ef2cb8eb5bcd1238192644ffeff47349de7b7229d747f037e7a831ea",
    fromChainId: 56,   // BSC
    toChainId:   56,   // BSC
    fromToken:   "BNB",
    toToken:     "USDC",
    volumeUSD:   1.16,
    tool:        "Nordstern",
    timestamp:   new Date("2026-08-17T08:23:00.000Z"),
  },
  {
    txHash:      "0x13896d702a96a980b9263e9d430612d9b2c6fde76720d0732acef28ef67c9c31",
    fromChainId: 137,  // Polygon
    toChainId:   137,  // Polygon
    fromToken:   "POL",
    toToken:     "USDC",
    volumeUSD:   0.13,
    tool:        "Sushiswap",
    timestamp:   new Date("2026-08-17T07:49:00.000Z"),
  },
  {
    txHash:      "0xbf69f30636013bf129743e194d3b0b5d6b9a946da78047d3c72bb6dbda20bd08",
    fromChainId: 56,   // BSC
    toChainId:   56,   // BSC
    fromToken:   "BNB",
    toToken:     "USDC",
    volumeUSD:   1.16,
    tool:        "Nordstern",
    timestamp:   new Date("2026-08-17T07:44:00.000Z"),
  },
  {
    txHash:      "0xcda68c55207d06de46ac493ceb24880572ad86780526eb7f92c2b18d45cd9832",
    fromChainId: 56,   // BSC
    toChainId:   56,   // BSC
    fromToken:   "BNB",
    toToken:     "USDC",
    volumeUSD:   1.00,
    tool:        "Nordstern",
    timestamp:   new Date("2026-08-17T07:10:00.000Z"),
  },
  {
    txHash:      "0x762189568ccbefdd9470bdf6298af1411463a2a36970bcf55dbf898864ce0112",
    fromChainId: 137,  // Polygon
    toChainId:   137,  // Polygon
    fromToken:   "POL",
    toToken:     "USDC",
    volumeUSD:   0.04,
    tool:        "Sushiswap",
    timestamp:   new Date("2026-08-16T18:17:00.000Z"),
  },
];

async function run(): Promise<void> {
  await mongoose.connect(MONGODB_URI!);
  console.log("✅ Connesso a MongoDB");

  let inserted = 0;
  let skipped  = 0;

  for (const rec of HISTORICAL_RECORDS) {
    const existing = await EvmSwapModel.findOne({ routeId: rec.txHash });
    if (existing) {
      console.log(`⏩ SKIP  ${rec.txHash.slice(0, 14)}… (già presente)`);
      skipped++;
      continue;
    }

    const feeUSD = (rec.volumeUSD * 0.0025).toFixed(6);

    await EvmSwapModel.create({
      userId:       "historical_import",
      routeId:      rec.txHash,
      fromChainId:  rec.fromChainId,
      toChainId:    rec.toChainId,
      fromToken:    rec.fromToken,
      fromAddress:  "unknown",
      toToken:      rec.toToken,
      toAddress:    "unknown",
      fromAmount:   String(rec.volumeUSD),
      alphaFeeUSD:  feeUSD,
      volumeUSD:    String(rec.volumeUSD),
      tool:         rec.tool,
      source:       "historical_import",
      state:        "completed",
      txHash:       rec.txHash,
      startedAt:    rec.timestamp,
      completedAt:  rec.timestamp,
    });

    console.log(`✅ INSERT ${rec.txHash.slice(0, 14)}… ${rec.fromToken}→${rec.toToken} vol=$${rec.volumeUSD} fee=$${feeUSD}`);
    inserted++;
  }

  console.log("\n──────────────────────────────────────────");
  console.log(`Importazione completata: ${inserted} inseriti, ${skipped} saltati`);
  console.log(`Record totali: ${HISTORICAL_RECORDS.length}`);

  // Verifica finale: riepilogo tabella
  console.log("\n── Riepilogo record importati ──");
  const all = await EvmSwapModel
    .find({ source: "historical_import" })
    .sort({ startedAt: 1 })
    .lean();

  let totalFee = 0;
  for (const r of all) {
    const fee = parseFloat(r.alphaFeeUSD ?? "0");
    totalFee += fee;
    const dt = r.startedAt.toISOString().slice(0, 16).replace("T", " ");
    console.log(`  ${dt} | ${r.fromToken}→${r.toToken} | $${r.volumeUSD ?? r.fromAmount} | fee=$${r.alphaFeeUSD} | ${r.tool ?? "—"} | ${r.txHash?.slice(0, 14)}…`);
  }
  console.log(`\n  TOTALE fee Alpha maturate: $${totalFee.toFixed(6)}`);
  console.log("──────────────────────────────────────────\n");

  await mongoose.disconnect();
}

run().catch(err => {
  console.error("❌ Errore:", err);
  process.exit(1);
});
