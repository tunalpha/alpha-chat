/**
 * bsc-detect-recovery.mjs — Recovery per BSC USDT transfer bloccati in awaiting_deposit
 *
 * Problema: adapterRegistry non era inizializzato → ADAPTER_NOT_FOUND 501 su ogni detect
 * Questo script legge il saldo USDT BSC dell'escrow on-chain e, se sufficiente,
 * aggiorna lo stato a "pending" così che lo scheduler possa rilasciare.
 *
 * Uso:
 *   node src/scripts/bsc-detect-recovery.mjs [transfer_id1] [transfer_id2] ...
 *   Se nessun ID passato → processa TUTTI i transfer BSC in awaiting_deposit
 *
 * Sicurezza: idempotente (condizione atomica su status), nessuna TX on-chain.
 */

import { createPublicClient, http } from "viem";
import { bsc } from "viem/chains";
import mongoose from "mongoose";

// ─── Connessione MongoDB ───────────────────────────────────────────────────────
const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) { console.error("MONGODB_URI mancante"); process.exit(1); }

await mongoose.connect(MONGODB_URI);
console.log("[Recovery] MongoDB connesso ✓");

// ─── Schema minimo per leggere e scrivere transfer ───────────────────────────
const transferSchema = new mongoose.Schema({}, { strict: false });
const Transfer = mongoose.model("multichain_transfer", transferSchema, "multichain_transfers");

// ─── BSC USDT contract ────────────────────────────────────────────────────────
const BSC_RPC_URL       = process.env.BSC_RPC_URL;
const BSC_USDT_CONTRACT = process.env.BSC_USDT_CONTRACT ?? "0x55d398326f99059fF775485246999027B3197955";

if (!BSC_RPC_URL) { console.error("BSC_RPC_URL mancante"); process.exit(1); }

const publicClient = createPublicClient({
  chain:     bsc,
  transport: http(BSC_RPC_URL, { timeout: 20_000 }),
});

// ERC-20 balanceOf ABI
const ERC20_ABI = [{
  type:    "function",
  name:    "balanceOf",
  inputs:  [{ type: "address" }],
  outputs: [{ type: "uint256" }],
}];

async function getUsdtBalance(address) {
  return publicClient.readContract({
    address: BSC_USDT_CONTRACT,
    abi:     ERC20_ABI,
    functionName: "balanceOf",
    args:    [address],
  });
}

// ─── ID passati da CLI o query su tutti i pending BSC ─────────────────────────
const cliIds = process.argv.slice(2).filter(Boolean);

let docs;
if (cliIds.length > 0) {
  docs = await Transfer.find({ transfer_id: { $in: cliIds } }).lean();
} else {
  docs = await Transfer.find({
    network: "bsc",
    status:  "awaiting_deposit",
  }).lean();
}

if (docs.length === 0) {
  console.log("[Recovery] Nessun transfer BSC in awaiting_deposit trovato.");
  await mongoose.disconnect();
  process.exit(0);
}

console.log(`[Recovery] Transfer da controllare: ${docs.length}`);

let updated = 0;
let insufficient = 0;

for (const doc of docs) {
  const id = doc.transfer_id;
  try {
    const balance = await getUsdtBalance(doc.escrow_wallet);

    const required = doc.min_deposit_amount
      ? BigInt(doc.min_deposit_amount)
      : BigInt(doc.gross_amount);

    console.log(`[${id}] escrow=${doc.escrow_wallet}`);
    console.log(`  balance=${balance} wei`);
    console.log(`  required=${required} wei`);
    console.log(`  sufficiente: ${balance >= required}`);

    if (balance < required) {
      console.log(`  → SKIP (saldo insufficiente — TX on-chain non ancora confermata?)`);
      insufficient++;
      continue;
    }

    // Aggiorna atomicamente (solo se ancora in awaiting_deposit)
    const result = await Transfer.findOneAndUpdate(
      { transfer_id: id, status: "awaiting_deposit" },
      { $set: { status: "pending" } },
      { new: true },
    );

    if (result) {
      console.log(`  → ✓ Stato aggiornato a "pending" — lo scheduler rilascerà.`);
      updated++;
    } else {
      console.log(`  → Già processato o stato cambiato in concorrenza.`);
    }
  } catch (err) {
    console.error(`[${id}] Errore:`, err.message);
  }
}

console.log(`\n[Recovery] Completato: ${updated} aggiornati, ${insufficient} con saldo insufficiente.`);
await mongoose.disconnect();
process.exit(0);
