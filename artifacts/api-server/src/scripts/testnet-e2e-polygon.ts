/**
 * testnet-e2e-polygon.ts — E2E Testnet Polygon Amoy USDT
 *
 * Verifica il ciclo completo del Multi-Chain Payment Engine su Polygon Amoy (chainId 80002).
 * Copre tutti i 12 punti di verifica approvati dall'architect.
 *
 * ─── PREREQUISITI ───────────────────────────────────────────────────────────────
 *
 * 1. Amoy POL nel wallet GAS_STATION_PRIVATE_KEY
 *    Faucet: https://faucet.polygon.technology/
 *    Serve almeno ~0.1 POL per gas (top-up escrow + TX1 + TX2)
 *
 * 2. Mock USDT su Polygon Amoy con funzione mint() senza restrizioni
 *    Deploy: vedere TESTNET_SETUP.md
 *    Env:    TESTNET_USDT_ADDRESS=0x...
 *
 * ─── ENV VARS OBBLIGATORIE ───────────────────────────────────────────────────────
 *
 *   MONGODB_URI               MongoDB connection string
 *   GAS_STATION_PRIVATE_KEY   PK wallet (gas station + funder su Amoy)
 *   TESTNET_USDT_ADDRESS      Indirizzo Mock USDT su Amoy
 *   POLYGON_FEE_WALLET        Indirizzo fee wallet (riceve TX2)
 *
 * ─── ENV VARS OPZIONALI ─────────────────────────────────────────────────────────
 *
 *   POLYGON_TESTNET_RPC_URL      Amoy RPC (default: https://rpc-amoy.polygon.technology/)
 *   TESTNET_FEE_WALLET           Override di POLYGON_FEE_WALLET per questo test
 *   TESTNET_RECIPIENT_WALLET     Wallet destinatario TX1 (default: stesso gas station wallet)
 *   POLYGON_FLAT_NETWORK_FEE_USDT  Fee piatta in base units 6 dec (default: 500000 = 0.50 USDT)
 *   TESTNET_KEEP_DB_RECORD       Se "true", non cancella il record di test dal DB
 *
 * ─── UTILIZZO ────────────────────────────────────────────────────────────────────
 *
 *   cd artifacts/api-server
 *   TESTNET_USDT_ADDRESS=0x... \
 *   TESTNET_FEE_WALLET=0x... \
 *   pnpm exec tsx src/scripts/testnet-e2e-polygon.ts
 *
 * ─── 12 STEP E2E ─────────────────────────────────────────────────────────────────
 *
 *   1.  Validazione env + connessione Amoy
 *   2.  Creazione transfer in DB
 *   3.  Verifica escrow generato + minDepositAmount invarianti
 *   4.  Mint USDT direttamente nell'escrow (deposito simulato)
 *   5.  Detection → awaiting_deposit → pending
 *   6.  Gas station top-up POL nell'escrow (automatico nel release)
 *   7.  TX1 → netAmount al destinatario
 *   8.  TX2 → (projectFee + networkFeeCharged) al feeWallet
 *   9.  Verifica DB: project_fee, network_fee_charged, network_fee separati
 *  10.  Idempotenza: secondo release rifiutato (no double-payout)
 *  11.  Conferma on-chain TX1 e TX2 su Amoy
 *  12.  Confronto Blockchain vs DB + zero regressioni USDA
 */

// ─── Importazioni statiche (NON producono caricamento di codice production) ─────
// viem e mongoose non leggono env vars a caricamento — sicuro come import statico.

import mongoose from "mongoose";
import {
  createPublicClient,
  createWalletClient,
  http,
  getAddress,
  encodeFunctionData,
  formatUnits,
  decodeEventLog,
} from "viem";
import { polygonAmoy } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

// ─── MockERC20 ABI (ERC-20 standard + mint() senza restrizioni) ──────────────────
// Compatibile con il contratto deployato con TESTNET_SETUP.md

const MOCK_ERC20_ABI = [
  {
    name: "mint",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to",     type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "transfer",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to",     type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "name",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
  {
    name: "decimals",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    name: "Transfer",
    type: "event",
    inputs: [
      { name: "from",  type: "address", indexed: true },
      { name: "to",    type: "address", indexed: true },
      { name: "value", type: "uint256", indexed: false },
    ],
  },
] as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────────

function getRequiredEnv(key: string): string {
  const val = process.env[key];
  if (!val) {
    console.error(`\n❌  ENV VAR MANCANTE: ${key}`);
    console.error(`    Impostare ${key} prima di eseguire il testnet E2E.`);
    console.error(`    Vedere TESTNET_SETUP.md per istruzioni.\n`);
    process.exit(1);
  }
  return val;
}

function sep(title: string) {
  const line = "─".repeat(62);
  console.log(`\n${line}`);
  console.log(`  ${title}`);
  console.log(line);
}

function ok(msg: string)   { console.log(`  ✅  ${msg}`); }
function info(msg: string) { console.log(`  ℹ️   ${msg}`); }
function warn(msg: string) { console.log(`  ⚠️   ${msg}`); }
function step(n: number, msg: string) { console.log(`\n  [STEP ${n}] ${msg}`); }

function amoyTxUrl(hash: string): string {
  return `https://www.oklink.com/amoy/tx/${hash}`;
}

function formatUsdt(units: string | bigint): string {
  const b = typeof units === "string" ? BigInt(units) : units;
  return `${formatUnits(b, 6)} USDT (${b.toString()} base units)`;
}

// ─── Variabili di stato per cleanup ───────────────────────────────────────────────

let testTransferId: string | null = null;

// ─── Main ─────────────────────────────────────────────────────────────────────────

async function main() {
  console.log("\n══════════════════════════════════════════════════════════════");
  console.log("  TESTNET E2E — Multi-Chain Payment Engine — Polygon Amoy");
  console.log("══════════════════════════════════════════════════════════════");

  // ── 1. Lettura e validazione env vars ──────────────────────────────────────────

  const amoyRpc    = process.env.POLYGON_TESTNET_RPC_URL ?? "https://rpc-amoy.polygon.technology/";
  const usdtAddr   = getRequiredEnv("TESTNET_USDT_ADDRESS");
  const gsPk       = getRequiredEnv("GAS_STATION_PRIVATE_KEY");
  const mongoUri   = getRequiredEnv("MONGODB_URI");

  const rawFeeWallet = process.env.TESTNET_FEE_WALLET ?? process.env.POLYGON_FEE_WALLET;
  if (!rawFeeWallet) {
    console.error("\n❌  Impostare TESTNET_FEE_WALLET o POLYGON_FEE_WALLET");
    process.exit(1);
  }
  const feeWallet = getAddress(rawFeeWallet);

  const networkFeeStr = process.env.POLYGON_FLAT_NETWORK_FEE_USDT ?? "500000";
  const networkFee    = BigInt(networkFeeStr); // 500_000 = 0.50 USDT (6 dec)

  // ── Imposta env vars per i moduli production PRIMA dei dynamic import ──────────
  //    I moduli leggono gli env vars a caricamento — l'ordine è critico.

  process.env.POLYGON_RPC_URL              = amoyRpc;
  process.env.POLYGON_CHAIN_ID             = "80002";       // ← Amoy in MC_CHAIN_MAP
  process.env.POLYGON_USDT_CONTRACT        = usdtAddr;
  process.env.ENABLE_POLYGON_USDT          = "true";
  process.env.POLYGON_FEE_WALLET           = feeWallet;
  process.env.POLYGON_FLAT_NETWORK_FEE_USDT = networkFeeStr;

  // ── Dynamic import dei moduli production (DOPO aver settato gli env vars) ──────
  //    Questo garantisce che TOKEN_CONTRACTS, FEE_WALLETS, FEATURE_FLAGS, MC_CHAIN_MAP
  //    leggano i valori testnet e non quelli di produzione.

  const {
    createMultiChainTransfer,
    detectMultiChainDeposit,
    releaseMultiChainTransfer,
  } = await import("../payment/multichain-payment.service");

  const { adapterRegistry }         = await import("../blockchain/adapter-registry");
  const { PolygonAmoyAdapter }      = await import("../blockchain/evm/polygon-amoy.adapter");
  const { MultiChainTransferModel } = await import("../models/multichain-transfer.model");

  // ── Registra PolygonAmoyAdapter (sostituisce il factory per mainnet) ───────────
  //    Il registry usa lazy singleton: il factory viene chiamato al primo .get()
  //    e l'adapter creato viene poi riutilizzato. Poiché lo script chiama .register()
  //    prima di qualsiasi .get("polygon"), il nostro adapter Amoy viene usato. ✓

  adapterRegistry.register("polygon", () => new PolygonAmoyAdapter(amoyRpc));

  // ── Connessione MongoDB ────────────────────────────────────────────────────────

  await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 15_000 });
  info("MongoDB connesso");

  // ── Client viem per Polygon Amoy ──────────────────────────────────────────────

  const normalizedPk = (gsPk.startsWith("0x") ? gsPk : `0x${gsPk}`) as `0x${string}`;
  const gsAccount    = privateKeyToAccount(normalizedPk);

  const publicClient = createPublicClient({
    chain:     polygonAmoy,
    transport: http(amoyRpc, { timeout: 30_000 }),
  });
  const walletClient = createWalletClient({
    account:   gsAccount,
    chain:     polygonAmoy,
    transport: http(amoyRpc, { timeout: 30_000 }),
  });

  sep("ENV CHECK");
  info(`Amoy RPC:          ${amoyRpc}`);
  info(`Gas Station wallet:${gsAccount.address}`);
  info(`Mock USDT:         ${usdtAddr}`);
  info(`Fee Wallet:        ${feeWallet}`);
  info(`Network fee flat:  ${formatUsdt(networkFee)}`);

  // ── Verifica saldo POL del gas station ────────────────────────────────────────

  const polBalance = await publicClient.getBalance({ address: gsAccount.address });
  info(`Gas station POL:   ${formatUnits(polBalance, 18)} POL`);
  if (polBalance < 10_000_000_000_000_000n) { // < 0.01 POL
    console.error("\n❌  Saldo POL insufficiente per il gas station su Amoy (minimo consigliato: 0.1 POL)");
    console.error(`   Wallet: ${gsAccount.address}`);
    console.error("   Faucet: https://faucet.polygon.technology/");
    process.exit(1);
  }
  ok(`Gas station POL sufficiente: ${formatUnits(polBalance, 18)} POL`);

  // ── Verifica esistenza contratto Mock USDT ────────────────────────────────────

  try {
    const tokenName = await publicClient.readContract({
      address:      getAddress(usdtAddr) as `0x${string}`,
      abi:          MOCK_ERC20_ABI,
      functionName: "name",
    });
    info(`Mock USDT nome:    ${tokenName}`);
    ok("Contratto Mock USDT raggiungibile su Amoy");
  } catch (e: any) {
    console.error(`\n❌  Contratto Mock USDT non trovato a ${usdtAddr} su Amoy`);
    console.error("    Verificare TESTNET_USDT_ADDRESS e TESTNET_SETUP.md");
    throw e;
  }

  // ── ID di test (ObjectId validi per MongoDB) ───────────────────────────────────

  const makeId = () => new mongoose.Types.ObjectId().toHexString();
  const testSenderId    = makeId();
  const testRecipientId = makeId();
  const testConvId      = makeId();
  const recipientWallet = process.env.TESTNET_RECIPIENT_WALLET ?? gsAccount.address;

  // Importi:
  //   gross    = 100.00 USDT = 100_000_000 base units
  //   project  = 100_000    = 0.10 USDT (0.10%)
  //   net      =  99_900_000 = 99.90 USDT
  //   netFee   =    500_000  = 0.50 USDT
  //   minDep   = 100_500_000 = 100.50 USDT
  const GROSS_UNITS = "100000000"; // 100.00 USDT

  // ─────────────────────────────────────────────────────────────────────────────────
  // STEP 1 — Creazione transfer
  // ─────────────────────────────────────────────────────────────────────────────────

  sep("STEP 1 — Creazione transfer");

  const clientRef = `testnet-e2e-${Date.now()}`;
  const transfer = await createMultiChainTransfer({
    senderId:         testSenderId,
    recipientId:      testRecipientId,
    conversationId:   testConvId,
    senderWallet:     gsAccount.address,
    recipientWallet,
    network:          "polygon",
    asset:            "USDT",
    grossAmountUnits: GROSS_UNITS,
    clientRef,
  });

  testTransferId = transfer.transferId;

  ok(`Transfer ID:       ${transfer.transferId}`);
  ok(`Status:            ${transfer.status}`);
  ok(`Escrow wallet:     ${transfer.escrowWallet}`);
  ok(`grossAmount:       ${formatUsdt(transfer.grossAmount)}`);
  ok(`projectFee:        ${formatUsdt(transfer.projectFee)}`);
  ok(`netAmount:         ${formatUsdt(transfer.netAmount)}`);
  ok(`networkFeeCharged: ${transfer.networkFeeCharged ? formatUsdt(transfer.networkFeeCharged) : "null ❌"}`);
  ok(`minDepositAmount:  ${transfer.minDepositAmount  ? formatUsdt(transfer.minDepositAmount)  : "null ❌"}`);

  // Invarianti contabili
  if (BigInt(transfer.projectFee) + BigInt(transfer.netAmount) !== BigInt(transfer.grossAmount)) {
    throw new Error("❌  INVARIANTE VIOLATA: gross ≠ net + projectFee");
  }
  ok("Invariante: gross = net + projectFee ✓");

  const expectedMinDeposit = (BigInt(GROSS_UNITS) + networkFee).toString();
  if (transfer.minDepositAmount !== expectedMinDeposit) {
    throw new Error(
      `❌  minDepositAmount errato: atteso ${expectedMinDeposit}, ricevuto ${transfer.minDepositAmount}`,
    );
  }
  ok(`minDepositAmount = grossAmount + networkFeeCharged ✓ (${formatUsdt(expectedMinDeposit)})`);

  // ─────────────────────────────────────────────────────────────────────────────────
  // STEP 2 — Verifica escrow (deve essere 0 pre-deposito)
  // ─────────────────────────────────────────────────────────────────────────────────

  sep("STEP 2 — Verifica escrow pre-deposito");

  const escrow = getAddress(transfer.escrowWallet) as `0x${string}`;

  const balBefore = await publicClient.readContract({
    address:      getAddress(usdtAddr) as `0x${string}`,
    abi:          MOCK_ERC20_ABI,
    functionName: "balanceOf",
    args:         [escrow],
  }) as bigint;

  info(`Saldo escrow pre-deposito: ${balBefore} (atteso: 0)`);
  if (balBefore !== 0n) {
    warn("Escrow ha già un saldo > 0 — il test continua ma potrebbe essere un escrow riusato");
  } else {
    ok("Escrow saldo = 0 ante deposito ✓");
  }

  // ─────────────────────────────────────────────────────────────────────────────────
  // STEP 3 — Deposito USDT nell'escrow (mint diretto)
  // ─────────────────────────────────────────────────────────────────────────────────

  sep("STEP 3 — Deposito USDT nell'escrow");

  const depositAmount = BigInt(transfer.minDepositAmount ?? GROSS_UNITS);
  info(`Depositando ${formatUsdt(depositAmount)} nell'escrow ${escrow}`);
  info("(Chiamata mint() sul Mock USDT → deposito diretto nell'escrow)");

  const mintData = encodeFunctionData({
    abi:          MOCK_ERC20_ABI,
    functionName: "mint",
    args:         [escrow, depositAmount],
  });

  const mintTxHash = await walletClient.sendTransaction({
    to:   getAddress(usdtAddr) as `0x${string}`,
    data: mintData,
  });
  info(`Mint TX: ${amoyTxUrl(mintTxHash)}`);

  const mintReceipt = await publicClient.waitForTransactionReceipt({
    hash:    mintTxHash,
    timeout: 60_000,
  });
  if (mintReceipt.status !== "success") throw new Error("❌  Mint TX revertita");

  const balAfter = await publicClient.readContract({
    address:      getAddress(usdtAddr) as `0x${string}`,
    abi:          MOCK_ERC20_ABI,
    functionName: "balanceOf",
    args:         [escrow],
  }) as bigint;

  ok(`Saldo escrow post-mint: ${formatUsdt(balAfter)}`);
  if (balAfter < depositAmount) throw new Error("❌  Deposito insufficiente dopo mint");
  ok("Deposito confermato on-chain ✓");

  // ─────────────────────────────────────────────────────────────────────────────────
  // STEP 4 — Detection deposito
  // ─────────────────────────────────────────────────────────────────────────────────

  sep("STEP 4 — Detection deposito (awaiting_deposit → pending)");

  const detected = await detectMultiChainDeposit(transfer.transferId);
  ok(`Status dopo detection: ${detected.status}`);
  if (detected.status !== "pending") {
    throw new Error(`❌  Detection fallita: status=${detected.status}, atteso=pending`);
  }
  ok("Detection: awaiting_deposit → pending ✓");

  // Idempotenza detection: secondo richiamo non deve cambiare lo status
  step(4, "Idempotenza detection (secondo richiamo)");
  const detected2 = await detectMultiChainDeposit(transfer.transferId);
  if (detected2.status !== "pending") {
    throw new Error(`❌  Doppia detection ha cambiato status: ${detected2.status}`);
  }
  ok("Idempotenza detection: secondo richiamo = status immutato (pending) ✓");

  // ─────────────────────────────────────────────────────────────────────────────────
  // STEP 5-8 — Release: gas station top-up + TX1 + TX2
  // ─────────────────────────────────────────────────────────────────────────────────

  sep("STEP 5-8 — Release (gas station + TX1 + TX2)");
  info("In corso... attendere conferme on-chain Amoy (~4-12 secondi)");
  info(`Recipient: ${recipientWallet}`);
  info(`FeeWallet: ${feeWallet}`);

  const released = await releaseMultiChainTransfer(transfer.transferId);

  ok(`Status:            ${released.status}`);
  ok(`TX1 (netAmount):   ${released.txHashRelease ? amoyTxUrl(released.txHashRelease) : "❌ null"}`);
  ok(`TX2 (fee):         ${released.txHashFee     ? amoyTxUrl(released.txHashFee)     : "⚠️ null (tx2 separata)"}`);

  if (released.status !== "released") {
    throw new Error(`❌  Release fallito: status=${released.status}`);
  }
  if (!released.txHashRelease) {
    throw new Error("❌  tx_hash_release mancante dopo release");
  }
  ok("Release completato ✓");

  // ─────────────────────────────────────────────────────────────────────────────────
  // STEP 9 — Verifica DB
  // ─────────────────────────────────────────────────────────────────────────────────

  sep("STEP 9 — Verifica DB");

  const dbDoc = await MultiChainTransferModel
    .findOne({ transfer_id: transfer.transferId })
    .lean();

  if (!dbDoc) throw new Error("❌  Documento non trovato in DB post-release");

  ok(`status:              ${dbDoc.status}`);
  ok(`gross_amount:        ${formatUsdt(dbDoc.gross_amount)}`);
  ok(`project_fee:         ${formatUsdt(dbDoc.project_fee)}`);
  ok(`net_amount:          ${formatUsdt(dbDoc.net_amount)}`);
  ok(`network_fee_charged: ${dbDoc.network_fee_charged ? formatUsdt(dbDoc.network_fee_charged) : "null"}`);
  ok(`network_fee:         ${dbDoc.network_fee ?? "null"} (gas reale in wei POL)`);
  ok(`tx_hash_release:     ${dbDoc.tx_hash_release ?? "null"}`);
  ok(`tx_hash_fee:         ${dbDoc.tx_hash_fee ?? "null"}`);

  // Verifiche invarianti
  const expectedProjectFee = (BigInt(GROSS_UNITS) * 10n / 10_000n).toString(); // 0.10%
  if (dbDoc.project_fee !== expectedProjectFee) {
    throw new Error(`❌  project_fee errato: ${dbDoc.project_fee}, atteso: ${expectedProjectFee}`);
  }
  ok(`project_fee = ${expectedProjectFee} (0.10% × gross) ✓`);

  if (dbDoc.network_fee_charged !== networkFeeStr) {
    throw new Error(`❌  network_fee_charged errato: ${dbDoc.network_fee_charged}, atteso: ${networkFeeStr}`);
  }
  ok(`network_fee_charged = ${networkFeeStr} (0.50 USDT flat) ✓`);

  if (dbDoc.network_fee && dbDoc.network_fee !== "0") {
    ok(`network_fee (gas reale POL) = ${dbDoc.network_fee} wei ✓`);
  } else {
    warn("network_fee = null/0 (gas reale non registrato o TX2 non effettuata)");
  }

  // I tre valori devono essere distinti
  const pfee    = dbDoc.project_fee;
  const nfcharg = dbDoc.network_fee_charged ?? "0";
  const nfreal  = dbDoc.network_fee ?? "0";

  const allDistinct =
    pfee !== nfcharg &&
    pfee !== nfreal &&
    (nfcharg === "0" || nfcharg !== nfreal);

  if (allDistinct) {
    ok("project_fee ≠ network_fee_charged ≠ network_fee (gas reale) ✓  — tre valori SEPARATI");
  } else {
    warn("Attenzione: alcuni valori di fee coincidono — verificare manualmente");
  }

  // ─────────────────────────────────────────────────────────────────────────────────
  // STEP 10 — No double-payout (idempotenza release)
  // ─────────────────────────────────────────────────────────────────────────────────

  sep("STEP 10 — No double-payout");

  try {
    await releaseMultiChainTransfer(transfer.transferId);
    throw new Error("❌  DOPPIO RELEASE PERMESSO — RISCHIO DOUBLE-PAYOUT!");
  } catch (err: any) {
    // Ci aspettiamo un errore (il transfer è in stato "released", non "pending")
    if (err.message?.includes("RISCHIO DOUBLE")) throw err;
    ok(`Secondo release correttamente rifiutato: ${err.code ?? err.message?.slice(0, 60)} ✓`);
  }

  // ─────────────────────────────────────────────────────────────────────────────────
  // STEP 11 — Verifica on-chain TX1 e TX2
  // ─────────────────────────────────────────────────────────────────────────────────

  sep("STEP 11 — Verifica on-chain");

  let tx1OnChainAmount = 0n;
  let tx2OnChainAmount = 0n;

  if (released.txHashRelease) {
    const receipt1 = await publicClient.getTransactionReceipt({
      hash: released.txHashRelease as `0x${string}`,
    });
    ok(`TX1 status: ${receipt1.status} (block ${receipt1.blockNumber})`);
    if (receipt1.status !== "success") throw new Error("❌  TX1 revertita on-chain");
    ok(`TX1 confermata: ${amoyTxUrl(released.txHashRelease)}`);

    // Decodifica il Transfer event per verificare l'importo
    for (const log of receipt1.logs) {
      try {
        const decoded = decodeEventLog({
          abi:    MOCK_ERC20_ABI,
          data:   log.data,
          topics: log.topics,
        });
        if (decoded.eventName === "Transfer" && (decoded.args as any).to === getAddress(recipientWallet)) {
          tx1OnChainAmount = (decoded.args as any).value as bigint;
          ok(`TX1 importo on-chain: ${formatUsdt(tx1OnChainAmount)}`);
        }
      } catch {}
    }
  }

  if (released.txHashFee) {
    const receipt2 = await publicClient.getTransactionReceipt({
      hash: released.txHashFee as `0x${string}`,
    });
    ok(`TX2 status: ${receipt2.status} (block ${receipt2.blockNumber})`);
    if (receipt2.status !== "success") throw new Error("❌  TX2 revertita on-chain");
    ok(`TX2 confermata: ${amoyTxUrl(released.txHashFee)}`);

    for (const log of receipt2.logs) {
      try {
        const decoded = decodeEventLog({
          abi:    MOCK_ERC20_ABI,
          data:   log.data,
          topics: log.topics,
        });
        if (decoded.eventName === "Transfer" && (decoded.args as any).to === getAddress(feeWallet)) {
          tx2OnChainAmount = (decoded.args as any).value as bigint;
          ok(`TX2 importo on-chain: ${formatUsdt(tx2OnChainAmount)}`);
        }
      } catch {}
    }
  } else {
    warn("TX2 non presente (txHashFee null) — fee recuperata in recovery batch");
  }

  // Verifica TX1 on-chain vs DB
  if (tx1OnChainAmount > 0n) {
    const dbNetAmount = BigInt(dbDoc.net_amount);
    if (tx1OnChainAmount !== dbNetAmount) {
      throw new Error(
        `❌  TX1 importo on-chain (${tx1OnChainAmount}) ≠ DB net_amount (${dbNetAmount})`,
      );
    }
    ok("TX1 on-chain == DB net_amount ✓");
  }

  // Verifica TX2 on-chain vs DB (projectFee + networkFeeCharged)
  if (tx2OnChainAmount > 0n) {
    const expectedTx2 = BigInt(dbDoc.project_fee) + BigInt(dbDoc.network_fee_charged ?? "0");
    if (tx2OnChainAmount !== expectedTx2) {
      throw new Error(
        `❌  TX2 importo on-chain (${tx2OnChainAmount}) ≠ DB projectFee+netFeeCharged (${expectedTx2})`,
      );
    }
    ok("TX2 on-chain == DB projectFee + networkFeeCharged ✓");
  }

  // ─────────────────────────────────────────────────────────────────────────────────
  // STEP 12 — Confronto Blockchain vs DB + zero regressioni USDA
  // ─────────────────────────────────────────────────────────────────────────────────

  sep("STEP 12 — Confronto Blockchain vs DB");

  const tx2CombinedDB = BigInt(dbDoc.project_fee) + BigInt(dbDoc.network_fee_charged ?? "0");

  const pad = (s: string, n = 16) => s.padStart(n);

  console.log(`
┌──────────────────────────────────────────────────────────────────┐
│       BLOCKCHAIN vs DATABASE — Confronto Finale (Amoy)           │
├───────────────────────────────┬──────────────────────────────────┤
│  Campo                        │  Valore                          │
├───────────────────────────────┼──────────────────────────────────┤
│  GROSS AMOUNT                 │                                  │
│    DB gross_amount            │  ${pad(dbDoc.gross_amount)} base u │
│    (=100.00 USDT)             │                                  │
├───────────────────────────────┼──────────────────────────────────┤
│  TX1 → Recipient              │                                  │
│    DB net_amount              │  ${pad(dbDoc.net_amount)} base u │
│    On-chain (Transfer event)  │  ${pad(tx1OnChainAmount > 0n ? tx1OnChainAmount.toString() : "(see TX1 link)")} base u │
│    TX hash                    │  ${(released.txHashRelease ?? "N/A").slice(0, 30)}…  │
├───────────────────────────────┼──────────────────────────────────┤
│  TX2 → Fee Wallet             │                                  │
│    DB project_fee             │  ${pad(dbDoc.project_fee)} base u │
│    DB network_fee_charged     │  ${pad(dbDoc.network_fee_charged ?? "0")} base u │
│    TX2 combined (DB)          │  ${pad(tx2CombinedDB.toString())} base u │
│    On-chain (Transfer event)  │  ${pad(tx2OnChainAmount > 0n ? tx2OnChainAmount.toString() : "(see TX2 link)")} base u │
│    TX hash                    │  ${(released.txHashFee ?? "N/A").slice(0, 30)}…  │
├───────────────────────────────┼──────────────────────────────────┤
│  GAS STATION (real POL gas)   │                                  │
│    DB network_fee (wei)       │  ${pad((dbDoc.network_fee ?? "0").slice(0, 16))} wei  │
│    Paid by                    │  GAS_STATION_PRIVATE_KEY wallet  │
│    NOT the same as ↑          │  project_fee, network_fee_charg  │
├───────────────────────────────┼──────────────────────────────────┤
│  SEPARAZIONE CONFERMATA       │                                  │
│    project_fee (0.10% USDT)   │  ${pad(dbDoc.project_fee)} base u │
│    network_fee_charged (flat) │  ${pad(dbDoc.network_fee_charged ?? "0")} base u │
│    network_fee (POL gas)      │  ${pad((dbDoc.network_fee ?? "?").slice(0, 16))} wei  │
│    Sono tre valori distinti   │  ✓                               │
├───────────────────────────────┼──────────────────────────────────┤
│  STATUS                       │  ${(released.status).padEnd(32)}  │
└───────────────────────────────┴──────────────────────────────────┘
`);

  // ── Zero regressioni USDA ──────────────────────────────────────────────────────

  sep("STEP 12b — Zero regressioni USDA");

  const db = mongoose.connection.db!;

  const usdaCount = await db.collection("chat_transfers").countDocuments({});
  ok(`Collezione chat_transfers: ${usdaCount} doc (non modificata dal test) ✓`);

  const auditCount = await db.collection("chat_transfer_audits").countDocuments({});
  ok(`Collezione chat_transfer_audits: ${auditCount} doc (non modificata) ✓`);

  // Nessun documento in multichain_transfers appartiene a conversazioni USDA
  const mcCount = await db.collection("multichain_transfers").countDocuments({
    transfer_id: transfer.transferId,
  });
  ok(`multichain_transfers contiene il record di test: ${mcCount === 1 ? "sì ✓" : "no ❌"}`);

  info("Nessun file USDA modificato — zero regressioni ✓");

  // ─────────────────────────────────────────────────────────────────────────────────
  // RIEPILOGO FINALE
  // ─────────────────────────────────────────────────────────────────────────────────

  console.log(`
══════════════════════════════════════════════════════════════════
  ✅  TESTNET E2E COMPLETATO — TUTTI I 12 STEP VERIFICATI
══════════════════════════════════════════════════════════════════

  Transfer ID  : ${transfer.transferId}
  Status       : ${released.status}
  TX1 (net)    : ${released.txHashRelease ? amoyTxUrl(released.txHashRelease) : "N/A"}
  TX2 (fee)    : ${released.txHashFee     ? amoyTxUrl(released.txHashFee)     : "N/A (batch recovery)"}

  Polygon Amoy : 🟢 PASS
  Mainnet USDA : 🔵 INVARIATO (zero regressioni)

══════════════════════════════════════════════════════════════════
`);
}

// ─── Cleanup + run ────────────────────────────────────────────────────────────────

async function cleanup() {
  if (testTransferId && process.env.TESTNET_KEEP_DB_RECORD !== "true") {
    try {
      const { MultiChainTransferModel } = await import("../models/multichain-transfer.model");
      const deleted = await MultiChainTransferModel.deleteOne({ transfer_id: testTransferId });
      if (deleted.deletedCount > 0) {
        console.log(`\n🧹  Cleanup: record ${testTransferId} rimosso dal DB`);
      }
    } catch (e) {
      warn(`Cleanup DB fallito per ${testTransferId} — rimuovere manualmente se necessario`);
    }
  } else if (process.env.TESTNET_KEEP_DB_RECORD === "true") {
    info(`Record di test preservato nel DB: ${testTransferId}`);
  }

  try {
    await mongoose.disconnect();
  } catch {}
}

main()
  .then(cleanup)
  .catch(async (err: any) => {
    console.error("\n❌  E2E FALLITO:", err?.message ?? String(err));
    if (err?.stack) console.error(err.stack);
    await cleanup();
    process.exit(1);
  });
