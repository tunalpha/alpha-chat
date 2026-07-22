/**
 * Recovery one-shot: porta un transfer da awaiting_deposit → pending
 * e aggiorna anche la system_metadata del messaggio-bolla in chat.
 */
import mongoose from "mongoose";

const TRANSFER_ID  = process.env.TRANSFER_ID ?? "010628dc-5b74-4581-933a-36638db1a967";
const TX_HASH      = process.env.TX_HASH     ?? "0x565e3c99c6b4d227831e105885fe8b649d7769b0810b1021ee14d4e014e4dc87";
const BLOCK_NUMBER = process.env.BLOCK_NUMBER ? parseInt(process.env.BLOCK_NUMBER, 10) : null;
const MONGODB_URI  = process.env.MONGODB_URI;

if (!MONGODB_URI) { console.error("❌ MONGODB_URI mancante"); process.exit(1); }

await mongoose.connect(MONGODB_URI);
console.log("✅ MongoDB connesso");

const S        = new mongoose.Schema({}, { strict: false });
const Transfer = mongoose.model("TR", S, "chat_transfers");
const Audit    = mongoose.model("AU", S, "payment_audits");
const Message  = mongoose.model("MS", S, "messages");

// ── 1. Leggi transfer ────────────────────────────────────────────────────────
const tr = await Transfer.findOne({ transfer_id: TRANSFER_ID }).lean();
if (!tr) { console.error("❌ Transfer non trovato:", TRANSFER_ID); await mongoose.disconnect(); process.exit(1); }

console.log("📋 Transfer:", TRANSFER_ID);
console.log("   status       :", tr.status);
console.log("   escrow_wallet:", tr.escrow_wallet);
console.log("   message_id   :", tr.message_id?.toString?.());
console.log("   sender       :", tr.sender_id?.toString?.());
console.log("   recipient    :", tr.recipient_id?.toString?.());

if (tr.status !== "awaiting_deposit") {
  console.log("ℹ️  Stato:", tr.status, "— nessuna azione.");
  await mongoose.disconnect(); process.exit(0);
}

const now = new Date();
const polygonscanUrl = `https://polygonscan.com/tx/${TX_HASH}`;

// ── 2. Aggiorna chat_transfers ────────────────────────────────────────────────
const upd = await Transfer.updateOne(
  { transfer_id: TRANSFER_ID, status: "awaiting_deposit" },
  {
    $set: {
      status:               "pending",
      tx_hash_deposit:      TX_HASH,
      ...(BLOCK_NUMBER != null ? { deposit_block_number: BLOCK_NUMBER } : {}),
      updatedAt:            now,
    },
  }
);

console.log(upd.modifiedCount > 0
  ? "✅ chat_transfers → pending"
  : "⚠️  chat_transfers non aggiornato (già modificato?)");

// ── 3. Aggiorna system_metadata del messaggio-bolla ──────────────────────────
if (tr.message_id) {
  const msgUpd = await Message.updateOne(
    { _id: tr.message_id },
    {
      $set: {
        "system_metadata.status":                  "pending",
        "system_metadata.tx_hash_deposit":         TX_HASH,
        "system_metadata.deposit_polygonscan_url": polygonscanUrl,
        ...(BLOCK_NUMBER != null
          ? { "system_metadata.deposit_block_number": BLOCK_NUMBER }
          : {}),
      },
    }
  );
  console.log(msgUpd.modifiedCount > 0
    ? "✅ Message system_metadata aggiornata"
    : "⚠️  Message non aggiornato");
} else {
  console.log("ℹ️  Nessun message_id — salto aggiornamento messaggio");
}

// ── 4. Audit ─────────────────────────────────────────────────────────────────
await Audit.create({
  transfer_id:  TRANSFER_ID,
  from_status:  "awaiting_deposit",
  to_status:    "pending",
  triggered_by: "system_recovery",
  note:         `recover-payment.mjs — tx: ${TX_HASH}`,
  created_at:   now,
});
console.log("✅ Audit scritto");

// ── 5. Conferma finale ───────────────────────────────────────────────────────
const final = await Transfer.findOne({ transfer_id: TRANSFER_ID }).lean();
console.log("\n📋 Stato finale:");
console.log("   status         :", final.status);
console.log("   tx_hash_deposit:", final.tx_hash_deposit);

console.log("\n🎉 Recovery completato!");
console.log("   PolygonScan:", polygonscanUrl);
console.log("   Riapri la chat — la bubble dovrebbe mostrare «In attesa di accettazione».");

await mongoose.disconnect();
