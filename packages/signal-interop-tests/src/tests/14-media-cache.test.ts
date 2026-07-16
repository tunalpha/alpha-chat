/**
 * Test 14 — Media Cache (Fase 4)
 *
 * Verifica la logica di routing store/get tra i due namespace
 * (clientId vs messageId) tramite lo stub in-memory.
 *
 * Il comportamento reale (cifratura AES-GCM in IndexedDB) è coperto
 * dall'integrazione browser; qui testiamo la logica di routing
 * e il contratto dell'API pubblica.
 */

import { describe, it, expect, beforeAll, afterEach } from "vitest";
import {
  initMediaCache,
  clearMediaCache,
  cacheOwnMessageMeta,
  getMetaByClientId,
  cacheDecryptedMeta,
  getMetaByMessageId,
} from "../stubs/media-cache-stub.js";

const TEST_USER   = "user-test-14";
const TEST_DEVICE = "device-test-14";

beforeAll(async () => {
  await initMediaCache(TEST_USER, TEST_DEVICE);
});

function makeMetaJson(
  mediaId: string,
  key = "fakeAESkey256bit==",
  iv  = "fakeGCMiv12byte=",
): string {
  return JSON.stringify({
    e2e:        true,
    type:       "voice",
    media_id:   mediaId,
    key,
    iv,
    duration_ms: 3000,
    waveform:   [],
  });
}

describe("14 — Media Cache (stub in-memory)", () => {

  // ── 14.1 Init ─────────────────────────────────────────────────────────────
  describe("14.1 — Inizializzazione", () => {
    it("initMediaCache è idempotente", async () => {
      await expect(initMediaCache(TEST_USER, TEST_DEVICE)).resolves.toBeUndefined();
    });
  });

  // ── 14.2 cacheOwnMessageMeta / getMetaByClientId ─────────────────────────
  describe("14.2 — cacheOwnMessageMeta / getMetaByClientId", () => {
    it("Salva e recupera metaJson per clientMessageId", async () => {
      const meta = makeMetaJson("media-001");
      await cacheOwnMessageMeta("client-1", meta);
      expect(await getMetaByClientId("client-1")).toBe(meta);
    });

    it("Chiave mancante → null", async () => {
      expect(await getMetaByClientId("non-esiste")).toBeNull();
    });

    it("Overwrite: stesso clientId → valore aggiornato", async () => {
      await cacheOwnMessageMeta("client-ow", makeMetaJson("old"));
      await cacheOwnMessageMeta("client-ow", makeMetaJson("new"));
      const r = await getMetaByClientId("client-ow");
      expect(r).toContain("new");
    });

    it("metaJson contiene chiave AES e IV", async () => {
      const meta = makeMetaJson("media-002", "myAESkey=", "myIV=");
      await cacheOwnMessageMeta("client-aes", meta);
      const parsed = JSON.parse((await getMetaByClientId("client-aes"))!);
      expect(parsed.key).toBe("myAESkey=");
      expect(parsed.iv).toBe("myIV=");
      expect(parsed.e2e).toBe(true);
    });
  });

  // ── 14.3 cacheDecryptedMeta / getMetaByMessageId ─────────────────────────
  describe("14.3 — cacheDecryptedMeta / getMetaByMessageId", () => {
    it("Salva e recupera metaJson per messageId", async () => {
      const meta = makeMetaJson("media-recv-001");
      await cacheDecryptedMeta("msg-id-1", meta);
      expect(await getMetaByMessageId("msg-id-1")).toBe(meta);
    });

    it("Chiave mancante → null", async () => {
      expect(await getMetaByMessageId("non-esiste")).toBeNull();
    });

    it("Overwrite: stesso messageId → valore aggiornato", async () => {
      await cacheDecryptedMeta("msg-ow", makeMetaJson("old"));
      await cacheDecryptedMeta("msg-ow", makeMetaJson("updated"));
      const r = await getMetaByMessageId("msg-ow");
      expect(r).toContain("updated");
    });
  });

  // ── 14.4 Isolamento namespace ─────────────────────────────────────────────
  describe("14.4 — Isolamento namespace", () => {
    it("clientId e messageId con stessa stringa non interferiscono", async () => {
      const KEY = "same-key-both-namespaces";
      await cacheOwnMessageMeta(KEY, makeMetaJson("client-ns"));
      await cacheDecryptedMeta(KEY, makeMetaJson("msg-ns"));

      const byClient = await getMetaByClientId(KEY);
      const byMsg    = await getMetaByMessageId(KEY);

      expect(byClient).toContain("client-ns");
      expect(byMsg).toContain("msg-ns");
      expect(byClient).not.toBe(byMsg);
    });

    it("Due metaJson diversi non si mescolano", async () => {
      await cacheOwnMessageMeta("kA", makeMetaJson("mA", "keyA", "ivA"));
      await cacheOwnMessageMeta("kB", makeMetaJson("mB", "keyB", "ivB"));

      const A = JSON.parse((await getMetaByClientId("kA"))!);
      const B = JSON.parse((await getMetaByClientId("kB"))!);

      expect(A.key).toBe("keyA");
      expect(B.key).toBe("keyB");
    });
  });

  // ── 14.5 Zero Plaintext Rule (in chiaro nello stub, cifrata in prod) ──────
  describe("14.5 — Zero Plaintext Rule", () => {
    it("La chiave AES è presente nel metaJson recuperato", async () => {
      const AES_KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
      const meta    = makeMetaJson("zk-media", AES_KEY);
      await cacheOwnMessageMeta("zk-client", meta);
      const parsed = JSON.parse((await getMetaByClientId("zk-client"))!);
      expect(parsed.key).toBe(AES_KEY);
    });

    it("Il metaJson recuperato per messageId include la chiave AES", async () => {
      const meta = makeMetaJson("zk-recv", "BBBBBBBBB=", "CCCCCC=");
      await cacheDecryptedMeta("zk-msg-id", meta);
      const parsed = JSON.parse((await getMetaByMessageId("zk-msg-id"))!);
      expect(parsed.key).toBe("BBBBBBBBB=");
      expect(parsed.iv).toBe("CCCCCC=");
    });
  });

  // ── 14.6 clearMediaCache ─────────────────────────────────────────────────
  describe("14.6 — clearMediaCache", () => {
    it("Dopo clear + re-init, tutte le voci sono sparite", async () => {
      // Setup voci
      await cacheOwnMessageMeta("to-clear-c", makeMetaJson("x1"));
      await cacheDecryptedMeta("to-clear-m", makeMetaJson("x2"));

      // Clear
      await clearMediaCache(TEST_USER, TEST_DEVICE);

      // Re-init obbligatorio
      await initMediaCache(TEST_USER + "-after", TEST_DEVICE + "-after");

      // Le voci pre-clear sono sparite
      expect(await getMetaByClientId("to-clear-c")).toBeNull();
      expect(await getMetaByMessageId("to-clear-m")).toBeNull();
    });
  });

});
