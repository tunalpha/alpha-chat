/**
 * Stub in-memory di media-cache.ts per i test Node.js (test 14).
 *
 * Implementa la stessa interfaccia di src/lib/media-cache.ts
 * senza IndexedDB né Web Crypto API (non disponibili in Node.js).
 */

const _metaByClientId = new Map<string, string>();
const _metaByMsgId    = new Map<string, string>();
let _ready            = false;

export async function initMediaCache(_userId: string, _deviceId: string): Promise<void> {
  _ready = true;
}

export async function clearMediaCache(_userId: string, _deviceId: string): Promise<void> {
  _metaByClientId.clear();
  _metaByMsgId.clear();
  _ready = false;
}

export async function cacheOwnMessageMeta(clientMessageId: string, metaJson: string): Promise<void> {
  if (!_ready) return;
  _metaByClientId.set(clientMessageId, metaJson);
}

export async function getMetaByClientId(clientMessageId: string): Promise<string | null> {
  if (!_ready) return null;
  return _metaByClientId.get(clientMessageId) ?? null;
}

export async function cacheDecryptedMeta(messageId: string, metaJson: string): Promise<void> {
  if (!_ready) return;
  _metaByMsgId.set(messageId, metaJson);
}

export async function getMetaByMessageId(messageId: string): Promise<string | null> {
  if (!_ready) return null;
  return _metaByMsgId.get(messageId) ?? null;
}
