/**
 * list-users.mts — elenca tutti gli utenti per identificare quelli di test
 * Le variabili d'ambiente sono già iniettate da Replit, no dotenv necessario.
 * Uso: pnpm --filter @workspace/api-server run list-users
 */
import mongoose from "mongoose";

const uri = process.env.MONGODB_URI;
if (!uri) { console.error("❌ MONGODB_URI non configurato"); process.exit(1); }

await mongoose.connect(uri);
const db = mongoose.connection.db!;

const users = await db.collection("users").find({}, {
  projection: { username: 1, email: 1, display_name: 1, status: 1, created_at: 1, admin_role: 1 }
}).sort({ created_at: 1 }).toArray();

console.log(`TOTALE: ${users.length}`);
for (const u of users) {
  console.log(JSON.stringify({
    id:           u._id.toString(),
    username:     u.username,
    email:        u.email ?? null,
    display_name: u.display_name ?? null,
    status:       u.status,
    admin:        u.admin_role ?? null,
    created_at:   u.created_at ?? null,
  }));
}

await mongoose.disconnect();
