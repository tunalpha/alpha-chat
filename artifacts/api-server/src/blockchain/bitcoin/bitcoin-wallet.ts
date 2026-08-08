/**
 * bitcoin-wallet.ts — Generazione wallet Bitcoin custodiale (P2WPKH)
 *
 * Genera wallet Bitcoin P2WPKH (native SegWit, bech32) usa-e-getta
 * per l'escrow, seguendo lo stesso pattern di usda-custodial.service.ts:
 *   1. Genera 32 byte random
 *   2. Deriva indirizzo bech32
 *   3. Cifra la PK con AES-256-GCM (ESCROW_MASTER_KEY)
 *   4. La PK in chiaro non viene mai persistita né loggata
 *
 * ISOLAMENTO: non dipende da usda-custodial.service.ts.
 * SICUREZZA: usa le stesse funzioni di escrow-crypto.ts.
 */

import * as bitcoin from "bitcoinjs-lib";
import * as tinysecp from "tiny-secp256k1";
import { ECPairFactory } from "ecpair";
import { encryptEscrowKey, decryptEscrowKey } from "../escrow-crypto";
import { logger } from "../../lib/logger";
import { multichainError } from "../errors";

// Inizializza bitcoinjs-lib con tiny-secp256k1 (richiesto da v7)
bitcoin.initEccLib(tinysecp);
const ECPair = ECPairFactory(tinysecp);

// ─── Network selection ─────────────────────────────────────────────────────────

function getBtcNetwork(): bitcoin.networks.Network {
  return process.env.BTC_NETWORK === "testnet"
    ? bitcoin.networks.testnet
    : bitcoin.networks.bitcoin;
}

// ─── Address derivation ────────────────────────────────────────────────────────

/**
 * Deriva indirizzo P2WPKH (bech32) da una chiave privata.
 * Restituisce l'indirizzo pubblico Bitcoin (bc1... per mainnet).
 */
export function privateKeyToP2WPKHAddress(pkBytes: Buffer): string {
  const network = getBtcNetwork();
  const keyPair = ECPair.fromPrivateKey(pkBytes, { network });
  const payment = bitcoin.payments.p2wpkh({
    pubkey:  Buffer.from(keyPair.publicKey),
    network,
  });
  if (!payment.address) {
    throw multichainError("INVALID_ADDRESS", { detail: "Impossibile derivare indirizzo P2WPKH" });
  }
  return payment.address;
}

// ─── Wallet generation ─────────────────────────────────────────────────────────

export interface BtcEscrowWallet {
  /** Indirizzo bech32 (bc1... mainnet, tb1... testnet) */
  address:     string;
  /** PK cifrata AES-256-GCM — mai esposta via API */
  encryptedPk: string;
}

/**
 * Genera un wallet Bitcoin P2WPKH usa-e-getta per l'escrow.
 * La PK viene cifrata con ESCROW_MASTER_KEY immediatamente.
 */
export function generateBtcEscrowWallet(): BtcEscrowWallet {
  const { randomBytes } = require("crypto");
  const pkBytes    = randomBytes(32) as Buffer;
  const address    = privateKeyToP2WPKHAddress(pkBytes);
  const encryptedPk = encryptEscrowKey(pkBytes);

  logger.debug({ address }, "[BtcWallet] Wallet escrow generato");
  return { address, encryptedPk };
}

/** Decifra la PK e restituisce i byte raw — in memoria solo, mai loggare */
export function decryptBtcEscrowKey(encryptedPk: string): Buffer {
  return decryptEscrowKey(encryptedPk);
}

// ─── Transaction signing ──────────────────────────────────────────────────────

import type { TxOutput, Utxo, UtxoSelection } from "./bitcoin-types";

export interface BuildSignedTxParams {
  /** PK escrow in chiaro (Buffer 32 byte) — mai loggare */
  signerPkBytes:   Buffer;
  /** UTXOs selezionati (output di selectUtxos) */
  selection:       UtxoSelection;
  /** Output pianificati (recipient + feeWallet) */
  outputs:         TxOutput[];
  /** Indirizzo change (stessa escrow wallet) */
  changeAddress:   string;
}

export interface SignedTx {
  txid:   string;
  rawHex: string;
}

/**
 * Costruisce e firma una transazione Bitcoin P2WPKH con PSBT.
 *
 * Output order: recipient, feeWallet, change (se > dust)
 * Ogni input viene firmato con la PK dell'escrow wallet.
 */
export function buildAndSignTx(params: BuildSignedTxParams): SignedTx {
  const { signerPkBytes, selection, outputs, changeAddress } = params;

  const network = getBtcNetwork();
  const keyPair = ECPair.fromPrivateKey(signerPkBytes, { network });
  const psbt = new bitcoin.Psbt({ network });

  // Costruisci scriptPubKey P2WPKH per gli input (witnessUtxo richiesto per SegWit)
  const payment = bitcoin.payments.p2wpkh({
    pubkey:  Buffer.from(keyPair.publicKey),
    network,
  });
  const witnessScript = payment.output!;

  // Aggiungi input
  for (const utxo of selection.selected) {
    psbt.addInput({
      hash:        utxo.txid,
      index:       utxo.vout,
      witnessUtxo: {
        script: witnessScript,
        value:  utxo.value,   // bigint (bitcoinjs-lib v7)
      },
    });
  }

  // Aggiungi output pianificati
  for (const output of outputs) {
    psbt.addOutput({
      address: output.address,
      value:   output.value,  // bigint
    });
  }

  // Aggiungi change se presente
  if (selection.change > 0n) {
    psbt.addOutput({
      address: changeAddress,
      value:   selection.change,  // bigint
    });
  }

  // Firma tutti gli input
  for (let i = 0; i < selection.selected.length; i++) {
    psbt.signInput(i, keyPair);
  }

  psbt.finalizeAllInputs();
  const tx = psbt.extractTransaction();

  return {
    txid:   tx.getId(),
    rawHex: tx.toHex(),
  };
}
