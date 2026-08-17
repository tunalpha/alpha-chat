import { MongoClient } from '/home/runner/workspace/node_modules/.pnpm/mongodb@7.2.0/node_modules/mongodb/lib/index.js';
const uri = process.env.MONGODB_URI;
const client = new MongoClient(uri);
await client.connect();
const db = client.db();
const count = await db.collection('evm_swaps').countDocuments({});
const today = new Date(); today.setHours(0,0,0,0);
const todayCount = await db.collection('evm_swaps').countDocuments({ startedAt: { $gte: today } });
const recent = await db.collection('evm_swaps').find({}).sort({ startedAt: -1 }).limit(10).toArray();
console.log('TOTALE evm_swaps:', count, '| Oggi:', todayCount);
for (const r of recent) {
  console.log(new Date(r.startedAt).toISOString().slice(0,16), '|', String(r.fromToken).slice(0,8), '->', String(r.toToken).slice(0,8), '|', r.fromAmount, '|', r.state);
}
await client.close();
