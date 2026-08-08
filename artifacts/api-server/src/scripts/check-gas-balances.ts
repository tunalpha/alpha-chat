/**
 * check-gas-balances.ts — Verifica saldi gas station su Polygon, Ethereum, BSC
 * 
 * Uso: npx tsx src/scripts/check-gas-balances.ts
 */

import "dotenv/config";
import { createPublicClient, http, formatEther } from "viem";
import { polygon, mainnet, bsc } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

const pk = process.env.GAS_STATION_PRIVATE_KEY;
if (!pk) { console.error("❌ GAS_STATION_PRIVATE_KEY non configurato"); process.exit(1); }

const normalizedPk = pk.startsWith("0x") ? pk : `0x${pk}`;
const account = privateKeyToAccount(normalizedPk as `0x${string}`);

console.log(`\n🔑 Gas Station Wallet: ${account.address}\n`);

const POLYGON_RPC  = process.env.POLYGON_RPC_URL  || "https://polygon-rpc.com";
const ETH_RPC      = process.env.ETHEREUM_RPC_URL  || "https://eth.llamarpc.com";
const BSC_RPC      = process.env.BSC_RPC_URL        || "https://bsc-dataseed1.binance.org";

const chains = [
  { name: "Polygon",  symbol: "MATIC/POL", chain: polygon,  rpc: POLYGON_RPC,  minOk: 1.0   },
  { name: "Ethereum", symbol: "ETH",       chain: mainnet,  rpc: ETH_RPC,      minOk: 0.05  },
  { name: "BSC",      symbol: "BNB",       chain: bsc,      rpc: BSC_RPC,      minOk: 0.1   },
];

for (const c of chains) {
  try {
    const client  = createPublicClient({ chain: c.chain, transport: http(c.rpc) });
    const balance = await client.getBalance({ address: account.address });
    const eth     = parseFloat(formatEther(balance));
    const ok      = eth >= c.minOk;
    const icon    = eth === 0 ? "🔴" : ok ? "🟢" : "🟡";
    console.log(`${icon} ${c.name.padEnd(9)} ${eth.toFixed(6).padStart(12)} ${c.symbol.padEnd(8)} ${ok ? "" : `(min consigliato: ${c.minOk})`}`);
  } catch (err) {
    console.log(`⚠️  ${c.name.padEnd(9)} ERRORE RPC: ${(err as Error).message}`);
  }
}
console.log("");
