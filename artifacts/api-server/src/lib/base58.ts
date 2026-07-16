/**
 * Base58 encoding/decoding — Sprint 22 (Account Recovery)
 * Implementazione senza dipendenze esterne.
 * Usato per codificare il Recovery Secret (32 byte → ~44 caratteri Base58).
 */

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/**
 * Codifica un Buffer in Base58.
 */
export function base58Encode(bytes: Buffer | Uint8Array): string {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  if (buf.length === 0) return "";

  // Conta i leading zero bytes → leading '1' in Base58
  let leadingZeros = 0;
  for (const b of buf) {
    if (b === 0) leadingZeros++;
    else break;
  }

  let num = BigInt("0x" + buf.toString("hex"));
  let result = "";
  while (num > 0n) {
    const rem = Number(num % 58n);
    num = num / 58n;
    result = ALPHABET[rem]! + result;
  }

  return "1".repeat(leadingZeros) + result;
}

/**
 * Decodifica una stringa Base58 in Buffer.
 */
export function base58Decode(str: string): Buffer {
  if (str.length === 0) return Buffer.alloc(0);

  let leadingZeros = 0;
  for (const c of str) {
    if (c === "1") leadingZeros++;
    else break;
  }

  let num = 0n;
  for (const c of str) {
    const idx = ALPHABET.indexOf(c);
    if (idx === -1) throw new Error(`Carattere non valido in Base58: ${c}`);
    num = num * 58n + BigInt(idx);
  }

  const hex = num.toString(16).padStart(2, "0");
  const padded = hex.length % 2 === 1 ? "0" + hex : hex;
  return Buffer.concat([
    Buffer.alloc(leadingZeros),
    Buffer.from(padded, "hex"),
  ]);
}
