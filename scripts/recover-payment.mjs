/**
 * Recovery script — chiama detect-deposit sul transfer bloccato.
 * Legge ENV dal processo, contatta il backend locale via HTTP.
 *
 * Usage:
 *   TRANSFER_ID=xxx AUTH_COOKIE=yyy node scripts/recover-payment.mjs
 *
 * Oppure usa il flag --internal per chiamare direttamente la logica
 * di servizio senza passare per HTTP.
 */

import mongoose from "mongoose";
import { createPublicClient, http, parseAbiItem } from "viem";
import { polygon } from "viem/chains";

// ── Config ────────────────────────────────────────────────────────────────────

const TRANSFER_ID   = process.env.TRANSFER_ID   ?? "010628dc-5b74-4581-933a-36638db1a967";
const MONGODB_URI   = process.env.MONGODB_URI;
const RPC_URL       = process.env.USDA_POLYGON_RPC ?? "https://polygon-bor-rpc.publicnode.com";
const USDA_CONTRACT = process.env.USDA_CONTRACT_ADDRESS ?? "0xe714655fD1B3ba96B887DF1F94336c2A78E24001";

if (!MONGODB_URI) { console.error("❌  MONGODB_URI non impostato"); process.exit(1); }

// ── Schema minimale ───────────────────────────────────────────────────────────

await mongoose.connect(MONGODB_URI);
console.log("✅ MongoDB connesso");

const TransferSchema = new mongoose.Schema({}, { strict: false, collection: "chat_transfers" });
const Transfer = mongoose.model("chat_transfer_recover", TransferSchema, "chat_transfers");

const transfer = await Transfer.findOne({ transfer_id: TRANSFER_ID }).lean();
if (!transfer) { console.error("❌  Transfer non trovato:", TRANSFER_ID); process.exit(1); }

console.log("📋 Transfer trovato:");
console.log("   status       :", transfer.status);
console.log("   escrow_wallet:", transfer.escrow_wallet);
console.log("   amount       :", transfer.amount?.toString());
console.log("   created_at   :", transfer.createdAt);

if (!["awaiting_deposit", "pending"].includes(transfer.status)) {
  console.log("ℹ️  Il transfer è già in stato:", transfer.status, "— nessuna azione necessaria.");
  await mongoose.disconnect();
  process.exit(0);
}

// ── Scan blockchain per la tx ─────────────────────────────────────────────────

const client = createPublicClient({ chain: polygon, transport: http(RPC_URL) });

const currentBlock = await client.getBlockNumber();
const createdAt    = new Date(transfer.createdAt ?? transfer.created_at ?? Date.now());
const ageMs        = Date.now() - createdAt.getTime();
const ageBlocks    = BigInt(Math.ceil(ageMs / 2500) + 20);
const MAX_BLOCKS   = 14400n;
const fromBlock    = currentBlock - (ageBlocks < MAX_BLOCKS ? ageBlocks : MAX_BLOCKS);

console.log(`\n🔍 Scan da blocco ${fromBlock} a ${currentBlock} (${currentBlock - fromBlock} blocchi)`);
console.log("   escrow:", transfer.escrow_wallet);

const ERC20_TRANSFER_EVENT = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)"
);

const logs = await client.getLogs({
  address:   USDA_CONTRACT,
  event:     ERC20_TRANSFER_EVENT,
  args:      { to: transfer.escrow_wallet },
  fromBlock,
  toBlock:   currentBlock,
});

console.log(`   Log trovati: ${logs.length}`);

if (logs.length === 0) {
  console.error("❌  Nessuna TX trovata verso l'escrow wallet in questo range.");
  console.log("   Prova a verificare manualmente su PolygonScan:");
  console.log("   https://polygonscan.com/address/" + transfer.escrow_wallet);
  await mongoose.disconnect();
  process.exit(1);
}

const log     = logs[0];
const txHash  = log.transactionHash;
const blockNr = Number(log.blockNumber);

console.log("\n✅ TX trovata:");
console.log("   txHash :", txHash);
console.log("   block  :", blockNr);
console.log("   amount :", log.args?.value?.toString(), "units");

// ── Aggiorna il transfer in MongoDB ──────────────────────────────────────────

const now    = new Date();
const result = await Transfer.updateOne(
  { transfer_id: TRANSFER_ID, status: "awaiting_deposit" },
  {
    $set: {
      status:               "pending",
      tx_hash_deposit:      txHash,
      deposit_block_number: blockNr,
      updatedAt:            now,
    },
  }
);

if (result.modifiedCount === 0) {
  console.warn("⚠️  Il transfer non è stato aggiornato (forse già in stato diverso).");
} else {
  console.log("✅ Transfer aggiornato → status: pending");
}

// ── Scrivi audit event ────────────────────────────────────────────────────────

const AuditSchema = new mongoose.Schema({}, { strict: false, collection: "payment_audits" });
const Audit = mongoose.model("payment_audit_recover", AuditSchema, "payment_audits");

await Audit.create({
  transfer_id:   TRANSFER_ID,
  from_status:   "awaiting_deposit",
  to_status:     "pending",
  triggered_by:  "system_recovery",
  note:          `detect-deposit recovery script — txHash: ${txHash}`,
  created_at:    now,
});

console.log("✅ Audit event scritto");
console.log("\n🎉 Recovery completato!");
console.log("   PolygonScan:", `https://polygonscan.com/tx/${txHash}`);
console.log("   Ora il destinatario può accettare il pagamento.");

await mongoose.disconnect();
