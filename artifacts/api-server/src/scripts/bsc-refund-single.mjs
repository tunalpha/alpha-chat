/**
 * bsc-refund-single.mjs — Rimborso manuale BSC USDT da wallet escrow
 */

import { createDecipheriv } from "crypto";
import { MongoClient } from "/home/runner/workspace/node_modules/.pnpm/mongodb@7.2.0/node_modules/mongodb/lib/index.js";
import { privateKeyToAccount } from "/home/runner/workspace/artifacts/api-server/node_modules/viem/_cjs/accounts/index.js";
import { createWalletClient, createPublicClient, http } from "/home/runner/workspace/artifacts/api-server/node_modules/viem/_cjs/index.js";
import { bsc } from "/home/runner/workspace/artifacts/api-server/node_modules/viem/_cjs/chains/index.js";

// ─── Costanti ─────────────────────────────────────────────────────────────────

const ESCROW_WALLET  = (process.env.ESCROW_WALLET ?? "0xf553b29e0a5f95158e133b5154af5bea9225e596").toLowerCase();
const SENDER_WALLET  = process.env.SENDER_WALLET  ?? "0x2b393f9cda795056a5dcc3c63bd2bdb379965805";
const USDT_BSC       = "0x55d398326f99059fF775485246999027B3197955";
const BSC_RPC        = process.env.BSC_RPC_URL    ?? "https://bsc-dataseed.binance.org/";
const MONGODB_URI    = process.env.MONGODB_URI;
const MASTER_KEY_HEX = process.env.ESCROW_MASTER_KEY;
const GS_PK_HEX      = process.env.GAS_STATION_PRIVATE_KEY;

// Soglia: se l'escrow ha già questa quantità di BNB → skip top-up
// Formula produzione: 80_000 gas × 2 TX × gasPrice × 2 safety = 320_000 × gasPrice
// A 0.05 Gwei (BSC tipico) = 0.000016 BNB. Usiamo la stessa formula al momento dell'esecuzione.
// Calcolato dinamicamente in main() dopo aver letto il gas price on-chain.
let BNB_GAS_THRESHOLD = 0n; // popolato in main()
let BNB_TOP_UP        = 0n; // popolato in main()

// ─── JSON-RPC helpers ─────────────────────────────────────────────────────────

let _id = 1;
async function rpc(method, params = []) {
  const res  = await fetch(BSC_RPC, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ jsonrpc: "2.0", id: _id++, method, params }),
  });
  const json = await res.json();
  if (json.error) throw new Error(`RPC ${method}: ${JSON.stringify(json.error)}`);
  return json.result;
}

function hexToBigInt(h) {
  return !h || h === "0x" || h === "0x0" ? 0n : BigInt(h);
}

// ─── Decrypt escrow PK ────────────────────────────────────────────────────────

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

// ─── ERC-20 balanceOf ─────────────────────────────────────────────────────────

async function tokenBalance(token, address) {
  const data   = "0x70a08231" + address.slice(2).padStart(64, "0");
  const result = await rpc("eth_call", [{ to: token, data }, "latest"]);
  return hexToBigInt(result);
}

// ─── ERC-20 transfer calldata ─────────────────────────────────────────────────

function encodeTransfer(to, amount) {
  return ("0xa9059cbb"
    + to.slice(2).padStart(64, "0")
    + amount.toString(16).padStart(64, "0"));
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=== BSC USDT REFUND ===");
  console.log("Escrow :", ESCROW_WALLET);
  console.log("Rimborso a:", SENDER_WALLET);
  console.log("");

  // 1. MongoDB
  console.log("1. MongoDB — cerco il transfer...");
  const mc = new MongoClient(MONGODB_URI, {
    serverSelectionTimeoutMS: 10_000,
    connectTimeoutMS:         10_000,
  });
  await mc.connect();
  const col = mc.db().collection("multichain_transfers");
  const doc = await col.findOne(
    { escrow_wallet: { $regex: new RegExp(`^${ESCROW_WALLET}$`, "i") } },
    { projection: { transfer_id: 1, escrow_wallet: 1, escrow_encrypted_pk: 1, status: 1 } },
  );
  await mc.close();

  if (!doc || !doc.escrow_encrypted_pk) {
    throw new Error(`Transfer non trovato per escrow: ${ESCROW_WALLET}`);
  }
  console.log(`   ✅ ${doc.transfer_id} (${doc.status})`);

  // 2. Decrypt PK
  console.log("\n2. Decrypt private key escrow...");
  const escrowPk  = decryptEscrowKeyHex(doc.escrow_encrypted_pk);
  const escrowAcc = privateKeyToAccount(escrowPk);
  if (escrowAcc.address.toLowerCase() !== ESCROW_WALLET) {
    throw new Error(`Indirizzo derivato (${escrowAcc.address}) != escrow atteso (${ESCROW_WALLET})`);
  }
  console.log("   ✅ Indirizzo verificato:", escrowAcc.address);

  // 3. Saldi
  console.log("\n3. Saldi escrow on-chain...");
  const [usdtBal, bnbBalHex] = await Promise.all([
    tokenBalance(USDT_BSC, ESCROW_WALLET),
    rpc("eth_getBalance", [ESCROW_WALLET, "latest"]),
  ]);
  const bnbBal = hexToBigInt(bnbBalHex);
  console.log(`   USDT: ${usdtBal} raw = ${Number(usdtBal) / 1e18} USDT`);
  console.log(`   BNB : ${bnbBal} wei = ${Number(bnbBal) / 1e18} BNB`);

  if (usdtBal === 0n) {
    throw new Error("USDT balance = 0 — già rimborsato o fondi assenti");
  }

  const publicClient = createPublicClient({ chain: bsc, transport: http(BSC_RPC) });

  // 4. Top-up BNB se necessario
  if (bnbBal < BNB_GAS_THRESHOLD) {
    console.log("\n4. BNB insufficiente — top-up dal gas station...");
    const gsPk     = GS_PK_HEX.startsWith("0x") ? GS_PK_HEX : `0x${GS_PK_HEX}`;
    const gsAcc    = privateKeyToAccount(gsPk);
    const gsClient = createWalletClient({ account: gsAcc, chain: bsc, transport: http(BSC_RPC) });
    console.log("   Gas station:", gsAcc.address);

    const topUpHash = await gsClient.sendTransaction({
      to:    ESCROW_WALLET,
      value: BNB_TOP_UP,
    });
    console.log("   Top-up TX:", topUpHash);
    await publicClient.waitForTransactionReceipt({
      hash:            topUpHash,
      confirmations:   2,
      timeout:         90_000,
      pollingInterval: 3_000,
    });
    console.log("   ✅ BNB confermato");
  } else {
    console.log("\n4. BNB sufficiente — skip top-up");
  }

  // 5. Gas price — letto on-chain (formula produzione: 320_000 × gasPrice)
  const gasPriceHex = await rpc("eth_gasPrice");
  const gasPrice    = hexToBigInt(gasPriceHex);
  // Imposta threshold e top-up dinamici (identici alla formula ensureMultiChainEscrowGas)
  BNB_GAS_THRESHOLD = 80_000n * 2n * gasPrice * 2n;   // = 320_000 × gasPrice
  BNB_TOP_UP        = BNB_GAS_THRESHOLD;               // top-up esattamente il necessario
  console.log(`\n5. Gas price: ${gasPrice} wei (${Number(gasPrice) / 1e9} Gwei)`);
  console.log(`   Gas top-up dinamico: ${BNB_TOP_UP} wei = ${Number(BNB_TOP_UP) / 1e18} BNB`);

  // 6. Invia USDT al mittente
  console.log(`\n6. Invio ${Number(usdtBal) / 1e18} USDT → ${SENDER_WALLET}...`);
  const escrowClient = createWalletClient({
    account:   escrowAcc,
    chain:     bsc,
    transport: http(BSC_RPC),
  });

  const txHash = await escrowClient.sendTransaction({
    to:       USDT_BSC,
    data:     encodeTransfer(SENDER_WALLET, usdtBal),
    value:    0n,
    gas:      100_000n,
    gasPrice,
  });

  console.log("   TX hash:", txHash);
  console.log("   In attesa di conferma (3 blocchi)...");

  const receipt = await publicClient.waitForTransactionReceipt({
    hash:            txHash,
    confirmations:   3,
    timeout:         120_000,
    pollingInterval: 4_000,
  });

  if (receipt.status === "reverted") throw new Error("TX revertita on-chain!");

  console.log(`\n=== RIMBORSO COMPLETATO ===`);
  console.log(`TX: https://bscscan.com/tx/${txHash}`);
  console.log(`${Number(usdtBal) / 1e18} USDT rimborsati a ${SENDER_WALLET}`);
  console.log(`Blocco: ${receipt.blockNumber}`);
}

main().catch(err => {
  console.error("\n❌ ERRORE:", err.message);
  process.exit(1);
});
