/**
 * Alpha Wallet — Routes (Phase B + C)
 *
 * ISOLAMENTO: nessuna dipendenza dal Payment Engine esistente.
 * SICUREZZA: tutti gli endpoint richiedono autenticazione.
 *   Il backend riceve solo address pubblici e transazioni già firmate.
 *   Non riceve mai: seed, private key, PIN.
 */

import { Router } from "express";
import { authenticate } from "../../middleware/authenticate.middleware";
import {
  getEvmTokenInfo,
  getEvmBalance,
  getEvmGasEstimate,
  broadcastEvmTx,
  getEvmTransactions,
  getBtcBalance,
  getBtcUTXOs,
  getBtcFeeRate,
  broadcastBtcTx,
  getBtcTransactions,
  getWalletPrices,
} from "../../controllers/alpha-wallet.controller";

const router = Router();
router.use(authenticate);

// ── Token info (Phase B) ──────────────────────────────────────────────────
/** GET /evm/token-info?chainId=137&address=0x... */
router.get("/evm/token-info", getEvmTokenInfo);

// ── Balance (Phase C) ─────────────────────────────────────────────────────
/** GET /evm/balance?chainId=137&address=0x... */
router.get("/evm/balance", getEvmBalance);

// ── Gas estimation (Phase C) ──────────────────────────────────────────────
/** GET /evm/gas?chainId=137&from=0x...&to=0x...&data=0x...&value=0 */
router.get("/evm/gas", getEvmGasEstimate);

// ── Broadcast (Phase C) — receives only pre-signed tx hex ─────────────────
/** POST /evm/broadcast — body: { chainId, signedTx } */
router.post("/evm/broadcast", broadcastEvmTx);

// ── Transaction history (Phase B) ─────────────────────────────────────────
/** GET /evm/transactions?chainId=137&address=0x...&fromBlock=0x... */
router.get("/evm/transactions", getEvmTransactions);

// ── Bitcoin balance (Phase C) ─────────────────────────────────────────────
/** GET /btc/balance?address=bc1q... */
router.get("/btc/balance", getBtcBalance);

/** GET /btc/utxos?address=bc1q... */
router.get("/btc/utxos", getBtcUTXOs);

/** GET /btc/fee-rate */
router.get("/btc/fee-rate", getBtcFeeRate);

/** POST /btc/broadcast — body: { txHex } */
router.post("/btc/broadcast", broadcastBtcTx);

/** GET /btc/transactions?address=bc1q... */
router.get("/btc/transactions", getBtcTransactions);

// ── Prices (Phase C) ──────────────────────────────────────────────────────
/** GET /prices — returns ETH, POL, BNB, BTC, stablecoins in USD+EUR */
router.get("/prices", getWalletPrices);

export default router;
