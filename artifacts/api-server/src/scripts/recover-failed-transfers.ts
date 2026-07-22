/**
 * One-off recovery: rimborsa i transfer "failed" con fondi ancora in escrow.
 *
 * Per ciascun transfer target:
 *   1. verifica status=failed, tx_hash_release=null, balanceOf(escrow) >= amount_units
 *   2. ensureEscrowGas(escrow) — top-up gas dinamico (nuova logica)
 *   3. transferFromCustodial: escrow → sender_wallet (rimborso)
 *   4. attende receipt success (dentro transferFromCustodial)
 *   5. aggiorna il documento: status="refunded" (stato terminale riservato ad
 *      admin refund nella state machine), tx_hash_release, release_block_number,
 *      completed_at; scrive un evento in chat_transfer_audit.
 *
 * I transfer sono già in stato terminale "failed": la state machine non prevede
 * transizioni da "failed", quindi l'aggiornamento è fatto direttamente sul
 * documento in modo consistente (status + audit), come da istruzione.
 *
 * DRY-RUN di default: esegue solo se invocato con --execute.
 */
import mongoose from "mongoose";
import { createPublicClient, http } from "viem";
import { polygon } from "viem/chains";
import { ChatTransferModel } from "../models/chat-transfer.model";
import { ChatTransferAuditModel } from "../models/chat-transfer-audit.model";
import {
  ensureEscrowGas,
  transferFromCustodial,
  getCustodialBalance,
  getRpcUrl,
} from "../payment/usda-custodial.service";

const TARGET_IDS = [
  "a769655d-bb63-4abf-934d-2ab1225eb011",
  "3f04b580-1733-48f7-b0dc-5f0e1d654ee8",
];

const EXECUTE = process.argv.includes("--execute");

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI mancante");
  await mongoose.connect(uri);
  console.log(`[recovery] connesso a Mongo. Modalità: ${EXECUTE ? "EXECUTE" : "DRY-RUN"}`);

  const publicClient = createPublicClient({ chain: polygon, transport: http(getRpcUrl()) });

  for (const transferId of TARGET_IDS) {
    console.log(`\n========== ${transferId} ==========`);
    const t = await ChatTransferModel.findOne({ transfer_id: transferId });
    if (!t) { console.log("  ❌ non trovato — skip"); continue; }

    console.log(`  status=${t.status} tx_hash_release=${t.tx_hash_release ?? "null"} escrow=${t.escrow_wallet}`);
    console.log(`  sender_wallet=${t.sender_wallet} amount_units=${t.amount_units}`);

    // Guardie di sicurezza
    if (t.status !== "failed") { console.log(`  ⚠️  status != failed (${t.status}) — skip`); continue; }
    if (t.tx_hash_release) { console.log("  ⚠️  tx_hash_release già presente — skip"); continue; }

    const balance = await getCustodialBalance({ address: t.escrow_wallet, assetAddress: t.asset_address });
    console.log(`  balanceOf(escrow) = ${balance} (serve >= ${t.amount_units})`);
    if (BigInt(balance) < BigInt(t.amount_units)) {
      console.log("  ⚠️  saldo escrow insufficiente — skip");
      continue;
    }

    if (!EXECUTE) {
      console.log("  [DRY-RUN] eseguirei: ensureEscrowGas → transferFromCustodial(escrow→sender) → update status=refunded");
      continue;
    }

    // 1. Gas top-up dinamico
    console.log("  → ensureEscrowGas...");
    await ensureEscrowGas(t.escrow_wallet);

    // 2. Rimborso escrow → sender_wallet
    console.log("  → transferFromCustodial (rimborso escrow → sender)...");
    const { txHash } = await transferFromCustodial({
      encryptedPk:  t.escrow_encrypted_pk,
      toAddress:    t.sender_wallet,
      amountUnits:  t.amount_units,
      assetAddress: t.asset_address,
    });
    console.log(`  ✓ rimborso tx: ${txHash}`);

    // 3. Block number del rimborso
    const receipt = await publicClient.getTransactionReceipt({ hash: txHash as `0x${string}` });
    const releaseBlock = Number(receipt.blockNumber);
    console.log(`  ✓ receipt status=${receipt.status} block=${releaseBlock}`);

    // 4. Aggiorna documento (transizione diretta da failed → refunded, terminale)
    const now = new Date();
    const updated = await ChatTransferModel.findOneAndUpdate(
      { transfer_id: transferId, status: "failed", tx_hash_release: null },
      {
        $set: {
          status:               "refunded",
          tx_hash_release:      txHash,
          release_block_number: releaseBlock,
          completed_at:         now,
          responded_at:         now,
        },
      },
      { returnDocument: "after" },
    );
    if (!updated) { console.log("  ⚠️  update fallito (documento cambiato) — verificare manualmente"); continue; }

    // 5. Audit
    await ChatTransferAuditModel.create({
      transfer_id:  transferId,
      from_status:  "failed",
      to_status:    "refunded",
      triggered_by: "admin",
      tx_hash:      txHash,
      note:         "Recovery one-off: rimborso escrow→mittente dopo fallimento gas (top-up dinamico). Fondi restituiti al sender_wallet.",
    });
    console.log(`  ✅ ${transferId} → refunded, audit scritto.`);
  }

  await mongoose.disconnect();
  console.log("\n[recovery] fine.");
}

main().catch((err) => { console.error("[recovery] ERRORE:", err); process.exit(1); });
