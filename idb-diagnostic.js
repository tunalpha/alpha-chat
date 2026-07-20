/**
 * ALPHA CHAT — Signal IDB Diagnostic
 * Incolla nella console del browser (F12 → Console) su alphachat.sbs
 * Funziona sia su Alpha che su Cricco — produce output comparabile.
 *
 * NON modifica nulla. Solo lettura.
 */
(async () => {
  // ── 1. Identità dal localStorage ────────────────────────────────────────
  const userId   = localStorage.getItem("ac_user_id")   ?? "(null)";
  const deviceId = localStorage.getItem("ac_device_id") ?? "(null)";
  const username = localStorage.getItem("ac_username")  ?? "(null)";

  console.log(`\n${"=".repeat(60)}`);
  console.log(`  SIGNAL IDB DIAGNOSTIC`);
  console.log(`  user     : ${username} (${userId.slice(0,8)}…)`);
  console.log(`  deviceId : ${deviceId}`);
  console.log(`${"=".repeat(60)}`);

  if (userId === "(null)") {
    console.warn("⚠️  ac_user_id non trovato — fai login prima di eseguire.");
    return;
  }

  // ── Helpers ──────────────────────────────────────────────────────────────
  const hex = (buf) => buf
    ? Array.from(new Uint8Array(buf instanceof ArrayBuffer ? buf : buf.buffer ?? buf))
        .map(b => b.toString(16).padStart(2,"0")).join("")
    : "(null)";

  function openRaw(name, version, storeNames) {
    return new Promise((res, rej) => {
      const req = indexedDB.open(name, version);
      req.onupgradeneeded = (e) => {
        // se non esiste ancora, crealo vuoto con gli store dichiarati
        for (const s of storeNames) {
          if (!e.target.result.objectStoreNames.contains(s))
            e.target.result.createObjectStore(s);
        }
      };
      req.onsuccess  = () => res(req.result);
      req.onerror    = () => rej(req.error);
    });
  }

  function getAllFromStore(db, storeName) {
    return new Promise((res, rej) => {
      if (!db.objectStoreNames.contains(storeName)) return res([]);
      const tx   = db.transaction(storeName, "readonly");
      const store = tx.objectStore(storeName);
      const keys  = store.getAllKeys();
      const vals  = store.getAll();
      tx.oncomplete = () => {
        const result = [];
        for (let i = 0; i < keys.result.length; i++)
          result.push({ key: keys.result[i], val: vals.result[i] });
        res(result);
      };
      tx.onerror = () => rej(tx.error);
    });
  }

  // ── 2. Signal IDB ────────────────────────────────────────────────────────
  const SIGNAL_DB   = `alpha-chat-signal-v2:${userId}:${deviceId}`;
  const SIGNAL_STORES = ["identity-self","identity-remote","sessions",
                         "pre-keys","signed-pre-keys","metadata"];

  console.log(`\n📦 Signal DB: "${SIGNAL_DB}"`);
  let sigDb;
  try {
    sigDb = await openRaw(SIGNAL_DB, 1, SIGNAL_STORES);
  } catch (e) {
    console.error("❌ Impossibile aprire Signal DB:", e);
  }

  if (sigDb) {
    // 2a. identity-self
    const selfEntries = await getAllFromStore(sigDb, "identity-self");
    console.log(`\n── identity-self (${selfEntries.length} entries) ──`);
    for (const { key, val } of selfEntries) {
      const pub  = val?.pubKey  ? hex(val.pubKey).slice(0,16)+"…"  : "(missing)";
      const priv = val?.privKey ? "✓ present" : "(missing)";
      console.log(`  [${key}]  pubKey: ${pub}  privKey: ${priv}  regId: ${val?.registrationId ?? "?"}`);
    }
    if (selfEntries.length === 0) console.warn("  ⚠️  VUOTO — IK non presente!");

    // 2b. identity-remote
    const remoteEntries = await getAllFromStore(sigDb, "identity-remote");
    console.log(`\n── identity-remote (${remoteEntries.length} entries) ──`);
    for (const { key, val } of remoteEntries) {
      const pub = val ? hex(val).slice(0,16)+"…" : "(null)";
      console.log(`  [${key}]  IK: ${pub}`);
    }
    if (remoteEntries.length === 0) console.warn("  ⚠️  VUOTO — nessuna IK remota memorizzata");

    // 2c. sessions ← sezione più importante
    const sessionEntries = await getAllFromStore(sigDb, "sessions");
    console.log(`\n── sessions (${sessionEntries.length} entries) ──`);
    for (const { key, val } of sessionEntries) {
      if (!val) { console.log(`  [${key}]  (null)`); continue; }
      // val è una stringa JSON serializzata da libsignal
      let parsed = null;
      try { parsed = JSON.parse(val); } catch { /* non JSON */ }

      if (parsed) {
        // Struttura libsignal: { sessions: { [baseKey]: { ... } }, version }
        const sessKeys = parsed.sessions ? Object.keys(parsed.sessions) : [];
        console.log(`  [${key}]  sessions-in-record: ${sessKeys.length}`);
        for (const sk of sessKeys) {
          const s = parsed.sessions[sk];
          // Campi utili: _remoteRegistrationId, _currentRatchet, _indexInfo
          const regId       = s._remoteRegistrationId ?? "?";
          const msgCounter  = s._currentRatchet?.counter ?? s._indexInfo?.closed ?? "?";
          const sendCtr     = s._currentRatchet?.sendingChain?.index ?? "?";
          const receiveCtr  = s._currentRatchet?.receivingChain?.index ?? "?";
          const closed      = s._indexInfo?.closed;
          const baseKey     = sk.slice(0,16)+"…";
          console.log(`    baseKey: ${baseKey}  remoteRegId: ${regId}  sendIdx: ${sendCtr}  recvIdx: ${receiveCtr}  closed: ${closed}`);
        }
      } else {
        // Formato binario/non-JSON — mostra lunghezza
        console.log(`  [${key}]  (non-JSON, bytes: ${typeof val === "string" ? val.length : "?"})`);
      }
    }
    if (sessionEntries.length === 0) console.warn("  ⚠️  VUOTO — nessuna sessione Signal presente!");

    // 2d. pre-keys
    const pkEntries = await getAllFromStore(sigDb, "pre-keys");
    console.log(`\n── pre-keys (${pkEntries.length} entries) ──`);
    if (pkEntries.length > 0) {
      const ids = pkEntries.map(e => e.key).join(", ");
      console.log(`  keyIds: [${ids}]`);
    } else {
      console.warn("  ⚠️  VUOTO — nessun OTPK locale");
    }

    // 2e. signed-pre-keys
    const spkEntries = await getAllFromStore(sigDb, "signed-pre-keys");
    console.log(`\n── signed-pre-keys (${spkEntries.length} entries) ──`);
    for (const { key, val } of spkEntries) {
      const pub = val?.pubKey ? hex(val.pubKey).slice(0,16)+"…" : "(missing)";
      console.log(`  [keyId=${key}]  pubKey: ${pub}`);
    }
    if (spkEntries.length === 0) console.warn("  ⚠️  VUOTO — nessuna SPK locale");

    // 2f. metadata
    const metaEntries = await getAllFromStore(sigDb, "metadata");
    console.log(`\n── metadata (${metaEntries.length} entries) ──`);
    for (const { key, val } of metaEntries) {
      console.log(`  [${key}]`, val);
    }

    sigDb.close();
  }

  // ── 3. Trust IDB ─────────────────────────────────────────────────────────
  const TRUST_DB = `alpha-chat-trust-v1:${userId}`;
  console.log(`\n📦 Trust DB: "${TRUST_DB}"`);
  let trustDb;
  try {
    trustDb = await openRaw(TRUST_DB, 1, ["trusted-identities"]);
  } catch (e) {
    console.error("❌ Impossibile aprire Trust DB:", e);
  }

  if (trustDb) {
    const trustEntries = await getAllFromStore(trustDb, "trusted-identities");
    console.log(`── trusted-identities (${trustEntries.length} entries) ──`);
    for (const { key, val } of trustEntries) {
      const ik     = val?.identityKey ? hex(val.identityKey).slice(0,16)+"…" : "(missing)";
      const status = val?.trustStatus ?? "?";
      console.log(`  [${key}]  IK: ${ik}  status: ${status}`);
    }
    if (trustEntries.length === 0) console.warn("  ⚠️  VUOTO — nessuna identità trusted");
    trustDb.close();
  }

  // ── 4. Media-cache IDB (solo conteggio) ──────────────────────────────────
  const MEDIA_DB = `alpha-chat-media-cache-v1:${userId}:${deviceId}`;
  console.log(`\n📦 Media Cache DB: "${MEDIA_DB}"`);
  try {
    const mDb = await openRaw(MEDIA_DB, 1, []);
    const mStores = Array.from(mDb.objectStoreNames);
    console.log(`  stores: [${mStores.join(", ")}]`);
    for (const s of mStores) {
      const entries = await getAllFromStore(mDb, s);
      console.log(`  ${s}: ${entries.length} entries`);
    }
    mDb.close();
  } catch (e) {
    console.warn("  (media cache non disponibile o vuota)");
  }

  // ── 5. Elenco tutti i DB IndexedDB nell'origine ───────────────────────────
  console.log(`\n── Tutti i DB IDB in questa origine ──`);
  try {
    const allDbs = await indexedDB.databases();
    for (const d of allDbs) {
      console.log(`  "${d.name}"  v${d.version}`);
    }
  } catch {
    console.log("  (indexedDB.databases() non supportato su questo browser)");
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log(`  FINE DIAGNOSTIC — copia l'output e confronta tra Alpha e Cricco`);
  console.log(`${"=".repeat(60)}\n`);
})();
