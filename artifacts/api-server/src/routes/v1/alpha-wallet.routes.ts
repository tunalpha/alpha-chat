/**
 * Alpha Wallet — Routes (Phase B + C)
 *
 * ISOLAMENTO: nessuna dipendenza dal Payment Engine esistente.
 * SICUREZZA: tutti gli endpoint richiedono autenticazione.
 *   Il backend riceve solo address pubblici e transazioni già firmate.
 *   Non riceve mai: seed, private key, PIN.
 */

import { Router } from "express";
import rateLimit from "express-rate-limit";
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

// SECURITY: Rate limit broadcast endpoints — 10 requests/minute per authenticated user.
// Prevents RPC abuse, transaction spam, and nonce exhaustion attacks.
const broadcastLimiter = rateLimit({
  windowMs:          60 * 1000,
  max:               10,
  keyGenerator:      (req) => (req as any).user?.userId ?? req.ip ?? "unknown",
  standardHeaders:   true,
  legacyHeaders:     false,
  message:           { error: "BROADCAST_RATE_LIMIT", message: "Troppi broadcast. Riprova tra un minuto." },
});

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
router.post("/evm/broadcast", broadcastLimiter, broadcastEvmTx);

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
router.post("/btc/broadcast", broadcastLimiter, broadcastBtcTx);

/** GET /btc/transactions?address=bc1q... */
router.get("/btc/transactions", getBtcTransactions);

// ── Prices (Phase C) ──────────────────────────────────────────────────────
/** GET /prices — returns ETH, POL, BNB, BTC, stablecoins in USD+EUR */
router.get("/prices", getWalletPrices);

export default router;
