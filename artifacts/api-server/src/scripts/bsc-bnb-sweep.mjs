/**
 * bsc-bnb-sweep.mjs — Recupera BNB residui dagli escrow BSC terminali
 *
 * Algoritmo (idempotente):
 *   1. Per ogni escrow in lista, legge il saldo BNB on-chain
 *   2. Calcola: recoverable = balance - gasPrice × 21_000 × SAFETY_MULTIPLIER
 *   3. Se recoverable > 0 → invia al GAS_STATION
 *   4. Logga ogni operazione con transfer_id e TX hash
 *
 * Non modifica mai lo stato MongoDB — solo operazioni on-chain.
 * Sicurezza: mai recupera il 100% (riserva gas per la TX di recovery).
 */

import { createDecipheriv } from "crypto";
import { MongoClient } from "/home/runner/workspace/node_modules/.pnpm/mongodb@7.2.0/node_modules/mongodb/lib/index.js";
import { privateKeyToAccount } from "/home/runner/workspace/artifacts/api-server/node_modules/viem/_cjs/accounts/index.js";
import { createWalletClient, createPublicClient, http } from "/home/runner/workspace/artifacts/api-server/node_modules/viem/_cjs/index.js";
import { bsc } from "/home/runner/workspace/artifacts/api-server/node_modules/viem/_cjs/chains/index.js";

// ─── Config ───────────────────────────────────────────────────────────────────

const BSC_RPC        = process.env.BSC_RPC_URL;
const MONGODB_URI    = process.env.MONGODB_URI;
const MASTER_KEY_HEX = process.env.ESCROW_MASTER_KEY;
const GS_PK_HEX      = process.env.GAS_STATION_PRIVATE_KEY;

// Gas per una semplice TX nativa (BNB transfer)
const NATIVE_TRANSFER_GAS = 21_000n;
// Safety multiplier: riserva 2× il gas necessario
const SAFETY_MULTIPLIER   = 2n;
// Soglia minima recuperabile (evita sweep da pochi wei)
const MIN_RECOVERABLE     = 100_000_000_000_000n; // 0.0001 BNB

// Statuses terminali — gli awaiting_deposit ancora aperti non vengono sweepati
const TERMINAL_STATUSES = new Set(["released", "refunded", "expired", "failed", "cancelled"]);

// ─── Helpers ─────────────────────────────────────────────────────────────────

let _rpcId = 1;
async function rpc(method, params = []) {
  const res  = await fetch(BSC_RPC, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ jsonrpc: "2.0", id: _rpcId++, method, params }),
  });
  const j = await res.json();
  if (j.error) throw new Error(`RPC ${method}: ${JSON.stringify(j.error)}`);
  return j.result;
}

function hexToBigInt(h) {
  return !h || h === "0x" || h === "0x0" ? 0n : BigInt(h);
}

function decryptEscrowKeyHex(encrypted) {
  const masterKey  = Buffer.from(MASTER_KEY_HEX, "hex");
  const data       = Buffer.from(encrypted, "base64");
  const iv         = data.subarray(0, 12);
  const authTag    = data.subarray(12, 28);
  const ciphertext = data.subarray(28);
  const dec        = createDecipheriv("aes-256-gcm", masterKey, iv);
  dec.setAuthTag(authTag);
  return `0x${Buffer.concat([dec.update(ciphertext), dec.final()]).toString("hex")}`;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=== BSC BNB SWEEP — RECUPERO RESIDUI ESCROW ===\n");

  // 1. Gas station address (destinazione dei BNB recuperati)
  const gsPk  = GS_PK_HEX.startsWith("0x") ? GS_PK_HEX : `0x${GS_PK_HEX}`;
  const gsAcc = privateKeyToAccount(gsPk);
  console.log("Gas station (destinazione):", gsAcc.address);

  // 2. Gas price corrente
  const gasPriceHex = await rpc("eth_gasPrice");
  const gasPrice    = hexToBigInt(gasPriceHex);
  const gasCost     = NATIVE_TRANSFER_GAS * gasPrice * SAFETY_MULTIPLIER;
  console.log(`Gas price: ${Number(gasPrice) / 1e9} Gwei`);
  console.log(`Riserva gas per TX recovery: ${gasCost} wei = ${Number(gasCost) / 1e18} BNB (2× safety)\n`);

  // 3. MongoDB — leggi tutti gli escrow BSC con PK gestita
  const mc  = new MongoClient(MONGODB_URI, { serverSelectionTimeoutMS: 10_000 });
  await mc.connect();
  const col = mc.db().collection("multichain_transfers");
  const docs = await col.find(
    { network: "bsc", escrow_encrypted_pk: { $exists: true } },
    { projection: { transfer_id: 1, escrow_wallet: 1, escrow_encrypted_pk: 1, status: 1 } },
  ).toArray();
  await mc.close();

  console.log(`Transfer BSC totali in DB: ${docs.length}`);

  // 4. Controlla saldi BNB on-chain per tutti gli escrow
  const balances = await Promise.all(
    docs.map(async (doc) => {
      const bnbHex = await rpc("eth_getBalance", [doc.escrow_wallet, "latest"]);
      return { doc, bnb: hexToBigInt(bnbHex) };
    }),
  );

  const results = [];
  const publicClient = createPublicClient({ chain: bsc, transport: http(BSC_RPC) });

  console.log("\n── Analisi escrow ──────────────────────────────────────────");
  for (const { doc, bnb } of balances) {
    const isTerminal    = TERMINAL_STATUSES.has(doc.status);
    const recoverable   = bnb > gasCost ? bnb - gasCost : 0n;
    const canSweep      = isTerminal && recoverable >= MIN_RECOVERABLE;

    console.log(`\n${doc.transfer_id.slice(0, 8)}… | ${doc.status.padEnd(17)} | ${doc.escrow_wallet.slice(0, 10)}…`);
    console.log(`   BNB on-chain: ${Number(bnb) / 1e18} BNB`);
    console.log(`   Terminale: ${isTerminal} | Recuperabile: ${Number(recoverable) / 1e18} BNB`);

    if (!canSweep) {
      const reason = !isTerminal ? "status non terminale" :
                     bnb === 0n  ? "saldo zero" :
                     "sotto soglia minima (< 0.0001 BNB)";
      console.log(`   → SKIP (${reason})`);
      results.push({
        transfer_id:    doc.transfer_id.slice(0, 8),
        escrow:         doc.escrow_wallet,
        status:         doc.status,
        bnb_funded:     "n/a",
        bnb_balance:    Number(bnb) / 1e18,
        bnb_recoverable: Number(recoverable) / 1e18,
        bnb_recovered:  0,
        tx:             "—",
        note:           reason,
      });
      continue;
    }

    // 5. Sweep
    console.log(`   → SWEEP ${Number(recoverable) / 1e18} BNB → gas station...`);
    try {
      const escrowPk     = decryptEscrowKeyHex(doc.escrow_encrypted_pk);
      const escrowAcc    = privateKeyToAccount(escrowPk);

      // Verifica indirizzo
      if (escrowAcc.address.toLowerCase() !== doc.escrow_wallet.toLowerCase()) {
        throw new Error(`Indirizzo derivato (${escrowAcc.address}) != escrow (${doc.escrow_wallet})`);
      }

      const escrowClient = createWalletClient({
        account:   escrowAcc,
        chain:     bsc,
        transport: http(BSC_RPC),
      });

      const txHash = await escrowClient.sendTransaction({
        to:       gsAcc.address,
        value:    recoverable,
        gas:      NATIVE_TRANSFER_GAS,
        gasPrice,
      });

      console.log(`   TX: ${txHash}`);
      const receipt = await publicClient.waitForTransactionReceipt({
        hash:            txHash,
        confirmations:   2,
        timeout:         90_000,
        pollingInterval: 3_000,
      });

      const gasUsedWei  = BigInt(receipt.gasUsed) * gasPrice;
      const gasUsedBNB  = Number(gasUsedWei) / 1e18;
      console.log(`   ✅ Confermata blocco ${receipt.blockNumber} | Gas usato: ${gasUsedBNB.toFixed(8)} BNB`);
      console.log(`   https://bscscan.com/tx/${txHash}`);

      results.push({
        transfer_id:     doc.transfer_id.slice(0, 8),
        escrow:          doc.escrow_wallet,
        status:          doc.status,
        bnb_balance:     Number(bnb) / 1e18,
        bnb_recoverable: Number(recoverable) / 1e18,
        bnb_recovered:   Number(recoverable) / 1e18,
        gas_cost:        gasUsedBNB,
        tx:              txHash,
        note:            "✅ SWEPT",
      });
    } catch (err) {
      console.error(`   ❌ ERRORE: ${err.message}`);
      results.push({
        transfer_id:     doc.transfer_id.slice(0, 8),
        escrow:          doc.escrow_wallet,
        status:          doc.status,
        bnb_balance:     Number(bnb) / 1e18,
        bnb_recoverable: Number(recoverable) / 1e18,
        bnb_recovered:   0,
        gas_cost:        0,
        tx:              "FAILED",
        note:            err.message,
      });
    }
  }

  // ─── Riepilogo finale ──────────────────────────────────────────────────────

  const totalRecoverable = results.reduce((s, r) => s + (r.bnb_recoverable ?? 0), 0);
  const totalRecovered   = results.reduce((s, r) => s + (r.bnb_recovered  ?? 0), 0);
  const totalGasCost     = results.reduce((s, r) => s + (r.gas_cost       ?? 0), 0);

  console.log("\n\n═══════════════════════════════════════════════════════════");
  console.log("TABELLA RIEPILOGATIVA");
  console.log("═══════════════════════════════════════════════════════════\n");
  console.table(results);

  console.log(`\nTotale BNB recuperabili  : ${totalRecoverable.toFixed(8)} BNB`);
  console.log(`Totale BNB recuperati    : ${totalRecovered.toFixed(8)} BNB`);
  console.log(`Totale costo gas recovery: ${totalGasCost.toFixed(8)} BNB`);
}

main().catch(err => {
  console.error("❌ FATALE:", err.message);
  process.exit(1);
});
