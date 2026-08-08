// check-gas-balances.mjs — run with: node --input-type=module
// Uso: node artifacts/api-server/src/scripts/check-gas-balances.mjs
import { createPublicClient, http, formatEther } from "viem";
import { polygon, mainnet, bsc } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

const pk = process.env.GAS_STATION_PRIVATE_KEY;
if (!pk) { console.error("❌ GAS_STATION_PRIVATE_KEY mancante"); process.exit(1); }

const account = privateKeyToAccount(pk.startsWith("0x") ? pk : `0x${pk}`);
console.log(`\n🔑 Wallet: ${account.address}\n`);

const chains = [
  { name: "Polygon",  symbol: "MATIC", chain: polygon, rpc: process.env.POLYGON_RPC_URL  || "https://polygon-rpc.com",          minOk: 1.0  },
  { name: "Ethereum", symbol: "ETH",   chain: mainnet, rpc: process.env.ETHEREUM_RPC_URL  || "https://eth.llamarpc.com",          minOk: 0.05 },
  { name: "BSC",      symbol: "BNB",   chain: bsc,     rpc: process.env.BSC_RPC_URL       || "https://bsc-dataseed1.binance.org", minOk: 0.1  },
];

for (const c of chains) {
  try {
    const client = createPublicClient({ chain: c.chain, transport: http(c.rpc, { timeout: 12000 }) });
    const bal    = await client.getBalance({ address: account.address });
    const val    = parseFloat(formatEther(bal));
    const icon   = val === 0 ? "🔴" : val >= c.minOk ? "🟢" : "🟡";
    const warn   = val < c.minOk ? `  ← min consigliato ${c.minOk}` : "";
    console.log(`${icon}  ${c.name.padEnd(9)} ${val.toFixed(6).padStart(14)} ${c.symbol}${warn}`);
  } catch (e) {
    console.log(`⚠️   ${c.name.padEnd(9)} ERRORE: ${e.message?.slice(0,80)}`);
  }
}
console.log("");
