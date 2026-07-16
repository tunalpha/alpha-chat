/**
 * Biometric Auth — Sprint 17
 *
 * Usa WebAuthn Platform Authenticator (Face ID / Touch ID / Windows Hello).
 * Se il dispositivo non supporta il biometrico, le funzioni ritornano false.
 */

const CRED_KEY = (userId: string) => `alpha-chat-webauthn-cred:${userId}`;

export function isBiometricSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    !!window.PublicKeyCredential &&
    typeof window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable ===
      "function"
  );
}

export async function isPlatformAuthenticatorAvailable(): Promise<boolean> {
  if (!isBiometricSupported()) return false;
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

export function hasBiometricRegistered(userId: string): boolean {
  return !!localStorage.getItem(CRED_KEY(userId));
}

/**
 * Registra una credenziale biometrica per l'utente.
 * Ritorna true se il setup è riuscito.
 */
export async function setupBiometric(userId: string): Promise<boolean> {
  if (!(await isPlatformAuthenticatorAvailable())) return false;

  try {
    // Challenge random per il setup
    const challenge = new Uint8Array(32);
    crypto.getRandomValues(challenge);

    const cred = await navigator.credentials.create({
      publicKey: {
        challenge,
        rp: { name: "Alpha Chat", id: window.location.hostname },
        user: {
          id: new TextEncoder().encode(userId),
          name: userId,
          displayName: "Alpha Chat",
        },
        pubKeyCredParams: [
          { type: "public-key", alg: -7 },   // ES256
          { type: "public-key", alg: -257 },  // RS256
        ],
        authenticatorSelection: {
          authenticatorAttachment: "platform",
          userVerification: "required",
          requireResidentKey: false,
        },
        timeout: 60000,
        attestation: "none",
      },
    });

    if (!cred || cred.type !== "public-key") return false;
    const pk = cred as PublicKeyCredential;
    // Salva l'ID della credenziale (base64) per l'autenticazione futura
    const credId = btoa(
      String.fromCharCode(...new Uint8Array(pk.rawId))
    );
    localStorage.setItem(CRED_KEY(userId), credId);
    return true;
  } catch {
    return false;
  }
}

/**
 * Verifica la credenziale biometrica esistente.
 * Ritorna true se l'utente si è autenticato con successo.
 */
export async function verifyBiometric(userId: string): Promise<boolean> {
  if (!(await isPlatformAuthenticatorAvailable())) return false;
  const credIdB64 = localStorage.getItem(CRED_KEY(userId));
  if (!credIdB64) return false;

  try {
    const challenge = new Uint8Array(32);
    crypto.getRandomValues(challenge);

    // Decodifica il credential ID
    const credIdBin = atob(credIdB64);
    const credId = new Uint8Array(credIdBin.length);
    for (let i = 0; i < credIdBin.length; i++) credId[i] = credIdBin.charCodeAt(i);

    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge,
        allowCredentials: [{ type: "public-key", id: credId.buffer }],
        userVerification: "required",
        timeout: 60000,
      },
    });

    return !!assertion;
  } catch {
    return false;
  }
}

export function removeBiometric(userId: string): void {
  localStorage.removeItem(CRED_KEY(userId));
}
