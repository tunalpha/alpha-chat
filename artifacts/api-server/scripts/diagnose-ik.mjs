import mongoose from 'mongoose';

const senderId = '6a5936cf3c7256fa13cb4f49';
const receiverId = '6a58010c2716e5a66fb03e0a';

await mongoose.connect(process.env.MONGODB_URI);
const db = mongoose.connection.db;

const toB64 = (v) => {
  if (!v) return 'N/A';
  if (typeof v === 'string') return v.substring(0, 32);
  if (Buffer.isBuffer(v)) return v.toString('base64').substring(0, 32);
  if (v.buffer) return Buffer.from(v.buffer).toString('base64').substring(0, 32);
  return JSON.stringify(v).substring(0, 32);
};

console.log('=== SENDER BUNDLES (' + senderId + ') ===');
const sb = await db.collection('signalkeybundles').find({ userId: senderId }).toArray();
for (const b of sb) {
  console.log(JSON.stringify({
    deviceId: b.deviceId,
    ikPrefix: toB64(b.identityKey),
    spkId: b.signedPreKeyId,
    otpkCount: b.oneTimePreKeys?.length ?? 0,
    updatedAt: b.updatedAt,
  }));
}
if (!sb.length) console.log('  (nessun bundle)');

console.log('\n=== RECEIVER BUNDLES (' + receiverId + ') ===');
const rb = await db.collection('signalkeybundles').find({ userId: receiverId }).toArray();
for (const b of rb) {
  console.log(JSON.stringify({
    deviceId: b.deviceId,
    ikPrefix: toB64(b.identityKey),
    spkId: b.signedPreKeyId,
  }));
}
if (!rb.length) console.log('  (nessun bundle)');

console.log('\n=== USERS ===');
const { ObjectId } = mongoose.Types;
const users = await db.collection('users').find(
  { _id: { $in: [new ObjectId(senderId), new ObjectId(receiverId)] } },
  { projection: { username: 1, email: 1, encrypted_identity_key: 1, ik_salt: 1 } }
).toArray();
for (const u of users) {
  console.log(JSON.stringify({
    id: u._id.toString(),
    username: u.username,
    email: u.email,
    hasBlob: !!u.encrypted_identity_key,
    hasSalt: !!u.ik_salt,
  }));
}

await mongoose.disconnect();
