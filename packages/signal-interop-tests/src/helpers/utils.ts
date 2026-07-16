/**
 * Utility per i test Signal Protocol.
 *
 * Note sul formato del body:
 * - `SessionCipher.encrypt()` restituisce { type, body: string, registrationId }
 *   dove body è una stringa base64 (non ArrayBuffer), nonostante il TypeScript
 *   declaration dica body?: string. Il runtime corrisponde alla dichiarazione.
 * - `decryptPreKeyWhisperMessage(body, 'binary')` accetta sia string che ArrayBuffer.
 * - Il confronto per forward secrecy si fa su stringhe, non su ArrayBuffer.
 */

// @ts-ignore — CJS package
import {
  KeyHelper,
  SignalProtocolAddress,
  SessionBuilder,
  SessionCipher,
  type KeyPairType,
  type DeviceType,
} from "@privacyresearch/libsignal-protocol-typescript";
import { TestSignalStore } from "./test-store.js";

// ---------------------------------------------------------------------------
// Persona — rappresenta un utente con un dispositivo
// ---------------------------------------------------------------------------

export interface Persona {
  name: string;
  deviceId: number;
  store: TestSignalStore;
  identityKey: KeyPairType;
  registrationId: number;
  signedPreKeyId: number;
  signedPreKey: KeyPairType;
  signedPreKeySignature: ArrayBuffer;
  oneTimePreKeys: Array<{ keyId: number; keyPair: KeyPairType }>;
}

/**
 * Crea una persona con tutte le chiavi generate.
 *
 * @param name        Nome utente (usato come base per l'address Signal)
 * @param deviceId    Identificatore dispositivo (numero, default 1)
 * @param otpkCount   Numero di One-Time PreKeys da generare
 * @param sharedIdentityKey  Identity key condivisa (per multi-device: tutti i
 *                           dispositivi dello stesso utente devono avere la STESSA
 *                           identity key — Signal Protocol specifica che il trust
 *                           è per-name, non per-address-completo)
 */
export async function createPersona(
  name: string,
  deviceId = 1,
  otpkCount = 5,
  sharedIdentityKey?: KeyPairType,
): Promise<Persona> {
  const store = new TestSignalStore();
  const identityKey = sharedIdentityKey ?? await KeyHelper.generateIdentityKeyPair();
  const registrationId = KeyHelper.generateRegistrationId();
  const signedPreKeyId = 1;
  const signedPreKeyPair = await KeyHelper.generateSignedPreKey(identityKey, signedPreKeyId);

  // Carica chiavi nel store
  store.storeOwnIdentity(identityKey, registrationId);
  await store.storeSignedPreKey(signedPreKeyId, signedPreKeyPair.keyPair);

  const oneTimePreKeys: Persona["oneTimePreKeys"] = [];
  for (let i = 1; i <= otpkCount; i++) {
    const otpk = await KeyHelper.generatePreKey(i);
    await store.storePreKey(otpk.keyId, otpk.keyPair);
    oneTimePreKeys.push({ keyId: otpk.keyId, keyPair: otpk.keyPair });
  }

  return {
    name,
    deviceId,
    store,
    identityKey,
    registrationId,
    signedPreKeyId,
    signedPreKey: signedPreKeyPair.keyPair,
    signedPreKeySignature: signedPreKeyPair.signature,
    oneTimePreKeys,
  };
}

/** Costruisce il DeviceType (bundle pubblico) da presentare al SessionBuilder */
export function buildDeviceBundle(persona: Persona, useOtpk = true): DeviceType {
  const otpk = useOtpk ? persona.oneTimePreKeys[0] : undefined;
  const bundle: DeviceType = {
    registrationId: persona.registrationId,
    identityKey: persona.identityKey.pubKey,
    signedPreKey: {
      keyId: persona.signedPreKeyId,
      publicKey: persona.signedPreKey.pubKey,
      signature: persona.signedPreKeySignature,
    },
  };
  if (otpk) {
    bundle.preKey = { keyId: otpk.keyId, publicKey: otpk.keyPair.pubKey };
  }
  return bundle;
}

// ---------------------------------------------------------------------------
// Tipi di ciphertext — body è una stringa base64
// ---------------------------------------------------------------------------

/** Risultato dell'encrypt (runtime): body è base64, non ArrayBuffer */
export interface CiphertextMessage {
  type: number;   // 1 = WhisperMessage, 3 = PreKeyWhisperMessage
  body: string;   // base64-encoded ciphertext
  registrationId?: number;
}

/** Invia un messaggio cifrato da SENDER a RECEIVER */
export async function encryptMessage(
  sender: Persona,
  recipientName: string,
  recipientDeviceId: number,
  plaintext: string,
): Promise<CiphertextMessage> {
  const addr = new SignalProtocolAddress(recipientName, recipientDeviceId);
  const cipher = new SessionCipher(sender.store, addr);
  const result = await cipher.encrypt(stringToArrayBuffer(plaintext));
  // Il runtime restituisce { type: number, body: string (base64), registrationId? }
  return result as unknown as CiphertextMessage;
}

/** Decifra un messaggio ricevuto */
export async function decryptMessage(
  receiver: Persona,
  senderName: string,
  senderDeviceId: number,
  ciphertext: CiphertextMessage,
): Promise<string> {
  const addr = new SignalProtocolAddress(senderName, senderDeviceId);
  const cipher = new SessionCipher(receiver.store, addr);

  let plaintextBuf: ArrayBuffer;
  if (ciphertext.type === 3) {
    // PreKeyWhisperMessage — primo messaggio, stabilisce la sessione
    // body è una stringa base64; decryptPreKeyWhisperMessage accetta string
    plaintextBuf = await cipher.decryptPreKeyWhisperMessage(ciphertext.body, "binary");
  } else {
    // WhisperMessage — Double Ratchet (messaggi successivi)
    plaintextBuf = await cipher.decryptWhisperMessage(ciphertext.body, "binary");
  }
  return arrayBufferToString(plaintextBuf);
}

/** Stabilisce la sessione tra initiator e recipient (X3DH) */
export async function buildSession(
  initiator: Persona,
  recipient: Persona,
  useOtpk = true,
): Promise<void> {
  const recipientAddr = new SignalProtocolAddress(recipient.name, recipient.deviceId);
  const bundle = buildDeviceBundle(recipient, useOtpk);
  const builder = new SessionBuilder(initiator.store, recipientAddr);
  await builder.processPreKey(bundle);
}

// ---------------------------------------------------------------------------
// Conversione stringhe / ArrayBuffer
// ---------------------------------------------------------------------------

export function stringToArrayBuffer(str: string): ArrayBuffer {
  const enc = new TextEncoder();
  return enc.encode(str).buffer as ArrayBuffer;
}

export function arrayBufferToString(buf: ArrayBuffer): string {
  const dec = new TextDecoder();
  return dec.decode(buf);
}

export function arrayBufferToHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Confronta due ArrayBuffer byte per byte */
export function arrayBuffersEqual(a: ArrayBuffer, b: ArrayBuffer): boolean {
  if (a.byteLength !== b.byteLength) return false;
  const va = new Uint8Array(a);
  const vb = new Uint8Array(b);
  for (let i = 0; i < va.length; i++) {
    if (va[i] !== vb[i]) return false;
  }
  return true;
}
