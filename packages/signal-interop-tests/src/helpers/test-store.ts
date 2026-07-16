/**
 * In-memory implementation of StorageType per i test.
 *
 * Sostituisce IndexedDB (non disponibile in Node.js) con Map<>.
 * Implementa fedelmente l'interfaccia richiesta da SessionBuilder e SessionCipher.
 */

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import type { StorageType, KeyPairType, SessionRecordType, Direction } from "@privacyresearch/libsignal-protocol-typescript";

export class TestSignalStore implements StorageType {
  private identityKeyPair: KeyPairType | undefined;
  private registrationId: number | undefined;
  // address string → public key ArrayBuffer
  private trustedIdentities = new Map<string, ArrayBuffer>();
  // address string → session record (serialized string)
  private sessions = new Map<string, string>();
  // keyId (number) → KeyPairType
  private preKeys = new Map<number, KeyPairType>();
  // keyId (number) → KeyPairType
  private signedPreKeys = new Map<number, KeyPairType>();

  // ---------------------------------------------------------------------------
  // Setup helpers (non parte di StorageType — per i test)
  // ---------------------------------------------------------------------------

  storeOwnIdentity(keyPair: KeyPairType, registrationId: number): void {
    this.identityKeyPair = keyPair;
    this.registrationId = registrationId;
  }

  // ---------------------------------------------------------------------------
  // StorageType — identità locale
  // ---------------------------------------------------------------------------

  async getIdentityKeyPair(): Promise<KeyPairType | undefined> {
    return this.identityKeyPair;
  }

  async getLocalRegistrationId(): Promise<number | undefined> {
    return this.registrationId;
  }

  // ---------------------------------------------------------------------------
  // StorageType — identità remote (TOFU)
  // ---------------------------------------------------------------------------

  async isTrustedIdentity(
    identifier: string,
    identityKey: ArrayBuffer,
    _direction: Direction,
  ): Promise<boolean> {
    const existing = this.trustedIdentities.get(identifier);
    if (existing === undefined) {
      // TOFU: prima volta → salva e fidati
      this.trustedIdentities.set(identifier, identityKey);
      return true;
    }
    return arrayBufferEqual(existing, identityKey);
  }

  async saveIdentity(
    encodedAddress: string,
    publicKey: ArrayBuffer,
    _nonblockingApproval?: boolean,
  ): Promise<boolean> {
    const existing = this.trustedIdentities.has(encodedAddress);
    this.trustedIdentities.set(encodedAddress, publicKey);
    return existing;
  }

  /** Sovrascrive l'identità di fiducia senza controllo TOFU (helper per test identity-change) */
  forceSetTrustedIdentity(address: string, pubKey: ArrayBuffer): void {
    this.trustedIdentities.set(address, pubKey);
  }

  /** Rimuove l'identità di fiducia (helper per test identity-change) */
  clearTrustedIdentity(address: string): void {
    this.trustedIdentities.delete(address);
  }

  // ---------------------------------------------------------------------------
  // StorageType — One-Time PreKeys
  // ---------------------------------------------------------------------------

  async loadPreKey(keyId: string | number): Promise<KeyPairType | undefined> {
    const id = typeof keyId === "string" ? parseInt(keyId, 10) : keyId;
    return this.preKeys.get(id);
  }

  async storePreKey(keyId: number | string, keyPair: KeyPairType): Promise<void> {
    const id = typeof keyId === "string" ? parseInt(keyId, 10) : keyId;
    this.preKeys.set(id, keyPair);
  }

  async removePreKey(keyId: number | string): Promise<void> {
    const id = typeof keyId === "string" ? parseInt(keyId, 10) : keyId;
    this.preKeys.delete(id);
  }

  get preKeyCount(): number {
    return this.preKeys.size;
  }

  // ---------------------------------------------------------------------------
  // StorageType — Signed PreKeys
  // ---------------------------------------------------------------------------

  async loadSignedPreKey(keyId: number | string): Promise<KeyPairType | undefined> {
    const id = typeof keyId === "string" ? parseInt(keyId, 10) : keyId;
    return this.signedPreKeys.get(id);
  }

  async storeSignedPreKey(keyId: number | string, keyPair: KeyPairType): Promise<void> {
    const id = typeof keyId === "string" ? parseInt(keyId, 10) : keyId;
    this.signedPreKeys.set(id, keyPair);
  }

  async removeSignedPreKey(keyId: number | string): Promise<void> {
    const id = typeof keyId === "string" ? parseInt(keyId, 10) : keyId;
    this.signedPreKeys.delete(id);
  }

  // ---------------------------------------------------------------------------
  // StorageType — Sessioni Double Ratchet
  // ---------------------------------------------------------------------------

  async storeSession(encodedAddress: string, record: SessionRecordType): Promise<void> {
    this.sessions.set(encodedAddress, record);
  }

  async loadSession(encodedAddress: string): Promise<SessionRecordType | undefined> {
    return this.sessions.get(encodedAddress);
  }

  /** Svuota la sessione per indirizzo (helper per test) */
  clearSession(encodedAddress: string): void {
    this.sessions.delete(encodedAddress);
  }

  get sessionCount(): number {
    return this.sessions.size;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function arrayBufferEqual(a: ArrayBuffer, b: ArrayBuffer): boolean {
  if (a.byteLength !== b.byteLength) return false;
  const va = new Uint8Array(a);
  const vb = new Uint8Array(b);
  for (let i = 0; i < va.length; i++) {
    if (va[i] !== vb[i]) return false;
  }
  return true;
}
