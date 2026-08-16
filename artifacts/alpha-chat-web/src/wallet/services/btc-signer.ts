/**
 * Alpha Wallet — BTC Signer (Phase C)
 *
 * Firma le transazioni Bitcoin ESCLUSIVAMENTE lato client (BIP-84 Native SegWit).
 * La private key NON lascia mai il dispositivo.
 *
 * Flusso:
 *   1. Riceve mnemonic (decifrata dal keystore con PIN dell'utente)
 *   2. Deriva la private key BIP-84 (m/84'/0'/0'/0/0)
 *   3. Recupera UTXO via backend proxy (Blockstream)
 *   4. Seleziona UTXO con strategia greedy
 *   5. Costruisce e firma la transazione OFFLINE
 *   6. Invia solo il tx raw hex al backend per il broadcast
 *   7. Azzera la private key dalla memoria
 *
 * SICUREZZA:
 *   - Il mnemonic e la private key non sono mai inviati al backend
 *   - Il backend riceve SOLO il tx hex già firmato
 *   - Dust limit: 546 sat (P2WPKH)
 */

import { Transaction, p2wpkh, NETWORK } from "@scure/btc-signer";
import { HDKey } from "@scure/bip32";
import { mnemonicToSeedBytes } from "../core/mnemonic";
import { BTC_BASE_PATH } from "../core/hd-wallet";
import {
  apiWalletGetBtcUTXOs,
  apiWalletGetBtcFeeRate,
  apiWalletBroadcastBtcTx,
  WalletNetworkError,
  type BtcUTXO,
} from "../../lib/alpha-wallet-api";

/**
 * Lanciato quando il broadcast BTC ha ricevuto la richiesta dal backend
 * ma la risposta HTTP è stata persa (rete iOS interrotta, timeout).
 * La TX POTREBBE essere già in mempool — non permettere retry cieco.
 */
export class BtcSendUncertainError extends Error {
  constructor() {
    super(
      "Connessione interrotta dopo la firma. La TX potrebbe essere già in mempool: " +
      "verifica il saldo e lo storico prima di riprovare.",
    );
    this.name = "BtcSendUncertainError";
  }
}

// ─── Costanti ──────────────────────────────────────────────────────────────

const DUST_LIMIT_SAT = 546n;
const SAT_PER_BTC    = 100_000_000n;

// ─── Tipi ──────────────────────────────────────────────────────────────────

export interface BtcSendParams {
  /** Decrypted mnemonic — used then discarded immediately */
  mnemonic:         string;
  recipientAddress: string;
  /** Send amount in satoshi */
  amountSat:        bigint;
  /** "fastest" | "normal" | "economy" — fee urgency */
  feeTarget?:       "fastest" | "normal" | "economy";
  /**
   * Phase G #91 — Atomic platform fee output.
   * If provided, adds a second output to this address in the SAME PSBT.
   * This guarantees fee collection is atomic: either the whole TX is mined
   * (recipient + fee wallet both paid) or it fails (neither paid).
   * Must be a valid BTC address; must be > DUST_LIMIT_SAT (546 sat).
   */
  platformFeeAddress?: string;
  platformFeeSat?:     bigint;
}

export interface BtcSendPreview {
  amountSat:     bigint;
  feeSat:        bigint;
  changeSat:     bigint;
  totalNeededSat: bigint;
  feeRateSvb:    number;
  /** Estimated tx vbytes */
  txVBytes:      number;
}

export interface BtcBroadcastResult {
  txid: string;
}

// ─── Address validation ────────────────────────────────────────────────────

export function validateBtcAddress(addr: string): string | null {
  if (!addr.trim()) return "Inserisci un indirizzo Bitcoin destinatario";
  // bc1q (P2WPKH) mainnet
  if (/^bc1q[ac-hj-np-z02-9]{38,87}$/.test(addr)) return null;
  // Legacy (P2PKH) — 1...
  if (/^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(addr)) return null;
  return "Indirizzo Bitcoin non valido";
}

export function validateBtcAmount(amountSat: bigint, balanceSat: bigint): string | null {
  if (amountSat <= 0n) return "Importo non valido";
  if (amountSat < DUST_LIMIT_SAT) return `Importo inferiore al limite dust (${DUST_LIMIT_SAT} sat)`;
  if (amountSat >= balanceSat) return "Saldo insufficiente (considera la miner fee)";
  return null;
}

// ─── Fee estimation ────────────────────────────────────────────────────────

/**
 * Estimates transaction vbytes for P2WPKH inputs/outputs.
 * Formula: 10.5 + nIn*68 + nOut*31 (segwit discount applied)
 */
export function estimateTxVBytes(nInputs: number, nOutputs: number): number {
  return Math.ceil(10.5 + nInputs * 68 + nOutputs * 31);
}

// ─── UTXO selection ────────────────────────────────────────────────────────

interface SelectionResult {
  selected:      BtcUTXO[];
  totalInputSat: bigint;
  feeSat:        bigint;
  changeSat:     bigint;
  hasChange:     boolean;
  txVBytes:      number;
}

/**
 * Greedy UTXO selection (largest-first).
 * Handles dust change by folding into fee.
 * Returns null if insufficient balance.
 *
 * @param amountSat    Total amount to send to non-change outputs (recipient + platform fee)
 * @param extraOutputs Extra non-change outputs beyond recipient (default 0).
 *                     Pass 1 when a platform fee output is included.
 */
export function selectBtcUTXOs(
  utxos:        BtcUTXO[],
  amountSat:    bigint,
  feeRateSvb:   number,
  extraOutputs  = 0,
): SelectionResult | null {
  const sorted = [...utxos].sort((a, b) => b.value - a.value);
  const selected: BtcUTXO[] = [];
  let totalInput = 0n;

  for (const utxo of sorted) {
    selected.push(utxo);
    totalInput += BigInt(utxo.value);

    // Outputs: 1 recipient + extraOutputs (platform fee, etc.) + 1 change (optional)
    const nOutputsWithChange = 2 + extraOutputs;
    const nOutputsNoChange   = 1 + extraOutputs;
    const vbytesWithChange   = estimateTxVBytes(selected.length, nOutputsWithChange);
    const vbytesNoChange     = estimateTxVBytes(selected.length, nOutputsNoChange);
    const feeWithChange      = BigInt(Math.ceil(vbytesWithChange * feeRateSvb));
    const feeNoChange        = BigInt(Math.ceil(vbytesNoChange * feeRateSvb));

    const needed = amountSat + feeWithChange;

    if (totalInput >= needed) {
      const change = totalInput - amountSat - feeWithChange;

      if (change < DUST_LIMIT_SAT) {
        // Fold change into fee (no change output)
        const neededNoChange = amountSat + feeNoChange;
        if (totalInput >= neededNoChange) {
          return {
            selected,
            totalInputSat: totalInput,
            feeSat:        totalInput - amountSat, // all remainder = miner fee
            changeSat:     0n,
            hasChange:     false,
            txVBytes:      vbytesNoChange,
          };
        }
        // Still not enough without change → continue adding UTXOs
      } else {
        return {
          selected,
          totalInputSat: totalInput,
          feeSat:        feeWithChange,
          changeSat:     change,
          hasChange:     true,
          txVBytes:      vbytesWithChange,
        };
      }
    }
  }

  return null; // insufficient balance
}

// ─── Key derivation helpers ────────────────────────────────────────────────

interface BtcKeyPair {
  privateKey: Uint8Array;
  publicKey:  Uint8Array;
}

async function deriveBtcKeyPair(mnemonic: string, index = 0): Promise<BtcKeyPair> {
  const seed = await mnemonicToSeedBytes(mnemonic);
  try {
    const root  = HDKey.fromMasterSeed(seed);
    const path  = `${BTC_BASE_PATH}/${index}`;
    const child = root.derive(path);

    if (!child.privateKey || !child.publicKey) {
      throw new Error(`[AlphaWallet] BTC key derivation failed at ${path}`);
    }

    // Copy key bytes out before seed is zeroed; HDKey internals may hold refs
    return {
      privateKey: new Uint8Array(child.privateKey),
      publicKey:  new Uint8Array(child.publicKey),
    };
  } finally {
    // SECURITY: zero the 64-byte BIP-39 seed as soon as the derived key is out
    seed.fill(0);
  }
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
}

// NOTE: @scure/btc-signer v2.3.0 stores txid internally in DISPLAY format (big-endian)
// and reverses bytes automatically when serializing the raw TX via P.bytes(32, true).
// Do NOT reverse the txid bytes before passing to addInput — the library handles it.
// Pass utxo.txid as a plain hex string (display format) and let normalizeInput do
// hex.decode() without reversing. Double-reversing caused bad-txns-inputs-missingorspent.

// ─── Preview (without signing) ─────────────────────────────────────────────

/**
 * Calculates send preview (fee, change) without signing.
 * Used to show the confirmation screen to the user.
 */
export async function getBtcSendPreview(
  senderAddress: string,
  amountSat:     bigint,
  feeTarget:     "fastest" | "normal" | "economy" = "normal",
): Promise<BtcSendPreview & { utxos: BtcUTXO[]; feeRate: number }> {
  const [utxosResp, feeRates] = await Promise.all([
    apiWalletGetBtcUTXOs(senderAddress),
    apiWalletGetBtcFeeRate(),
  ]);

  const feeRate = feeRates[feeTarget];
  const selection = selectBtcUTXOs(utxosResp.utxos, amountSat, feeRate);

  if (!selection) {
    const totalSat = utxosResp.utxos.reduce((s, u) => s + BigInt(u.value), 0n);
    throw new Error(`Saldo insufficiente. Disponibile: ${totalSat} sat`);
  }

  return {
    amountSat,
    feeSat:        selection.feeSat,
    changeSat:     selection.changeSat,
    totalNeededSat: amountSat + selection.feeSat,
    feeRateSvb:    feeRate,
    txVBytes:      selection.txVBytes,
    utxos:         selection.selected,
    feeRate,
  };
}

// ─── Sign & Broadcast ──────────────────────────────────────────────────────

export async function signAndBroadcastBtcTx(
  params: BtcSendParams,
): Promise<BtcBroadcastResult> {
  const errAddr = validateBtcAddress(params.recipientAddress);
  if (errAddr) throw new Error(errAddr);

  // 1. Derive key pair (local only, never sent to backend)
  const keyPair = await deriveBtcKeyPair(params.mnemonic, 0);

  try {
    const payment = p2wpkh(keyPair.publicKey);
    if (!payment.address) throw new Error("[AlphaWallet] Impossibile calcolare address P2WPKH");

    // 2. Fetch UTXOs and fee rate
    const feeTarget = params.feeTarget ?? "normal";
    const [utxosResp, feeRates] = await Promise.all([
      apiWalletGetBtcUTXOs(payment.address),
      apiWalletGetBtcFeeRate(),
    ]);

    const feeRate = feeRates[feeTarget];

    // Phase G #91: total target = recipient + platform fee (if present)
    const hasPlatformFee =
      !!params.platformFeeAddress &&
      !!params.platformFeeSat &&
      params.platformFeeSat >= DUST_LIMIT_SAT;
    const totalTargetSat = params.amountSat + (hasPlatformFee ? (params.platformFeeSat ?? 0n) : 0n);
    const extraOutputs   = hasPlatformFee ? 1 : 0;

    const selection = selectBtcUTXOs(utxosResp.utxos, totalTargetSat, feeRate, extraOutputs);

    if (!selection) {
      const totalSat = utxosResp.utxos.reduce((s, u) => s + BigInt(u.value), 0n);
      throw new Error(`Saldo insufficiente. Disponibile: ${totalSat} sat, richiesto: ~${totalTargetSat + BigInt(Math.ceil(estimateTxVBytes(2, 2 + extraOutputs) * feeRate))} sat`);
    }

    // 3. Build transaction
    const tx = new Transaction();

    for (const utxo of selection.selected) {
      tx.addInput({
        txid:        utxo.txid, // display-format hex string; library reverses internally via P.bytes(32,true)
        index:       utxo.vout,
        witnessUtxo: {
          script: payment.script,
          amount: BigInt(utxo.value),
        },
        sequence: 0xfffffffd, // RBF enabled
      });
    }

    // Recipient output
    tx.addOutputAddress(params.recipientAddress, params.amountSat, NETWORK);

    // Phase G #91: Atomic platform fee output — same TX, same success/failure guarantee
    if (
      params.platformFeeAddress &&
      params.platformFeeSat &&
      params.platformFeeSat >= DUST_LIMIT_SAT
    ) {
      tx.addOutputAddress(params.platformFeeAddress, params.platformFeeSat, NETWORK);
    }

    // Change output (only if above dust)
    if (selection.hasChange && selection.changeSat >= DUST_LIMIT_SAT) {
      tx.addOutputAddress(payment.address, selection.changeSat, NETWORK);
    }

    // 4. Sign all inputs with our private key
    tx.sign(keyPair.privateKey);
    tx.finalize();

    // 5. Extract raw tx hex
    const rawTx  = tx.extract();
    const txHex  = bytesToHex(rawTx);

    // 6. Broadcast via backend proxy (backend never sees private key)
    // ANTI DOUBLE-SPEND: se la rete cade DOPO che il backend ha chiamato
    // Blockstream (WalletNetworkError), la TX potrebbe già essere in mempool.
    // Rilanciamo BtcSendUncertainError invece di WalletNetworkError per
    // impedire al chiamante di mostrare il bottone "Riprova".
    try {
      return await apiWalletBroadcastBtcTx(txHex);
    } catch (e) {
      if (e instanceof WalletNetworkError) throw new BtcSendUncertainError();
      throw e;
    }
  } finally {
    // 7. Zero out private key bytes
    keyPair.privateKey.fill(0);
  }
}

// ─── Human-readable helpers ────────────────────────────────────────────────

export function satToBtc(sat: bigint): string {
  const whole = sat / SAT_PER_BTC;
  const frac  = sat % SAT_PER_BTC;
  return `${whole}.${frac.toString().padStart(8, "0")} BTC`;
}

export function satToNumber(sat: bigint): number {
  return Number(sat) / 1e8;
}
