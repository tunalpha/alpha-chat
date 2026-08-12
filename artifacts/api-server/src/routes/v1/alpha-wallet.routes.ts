/**
 * Alpha Wallet — Routes (Phase B + C + G)
 *
 * ISOLAMENTO: nessuna dipendenza dal Payment Engine esistente.
 * SICUREZZA: tutti gli endpoint richiedono autenticazione.
 *   Il backend riceve solo address pubblici e transazioni già firmate.
 *   Non riceve mai: seed, private key, PIN.
 */

import { Router } from "express";
import rateLimit from "express-rate-limit";
import { authenticate } from "../../middleware/authenticate.middleware";
import { requireAdmin } from "../../middleware/require-admin.middleware";
import {
  getEvmTokenInfo,
  getEvmBalance,
  getEvmGasEstimate,
  broadcastEvmTx,
  getEvmTransactions,
  getEvmReceipt,
  getBtcBalance,
  getBtcUTXOs,
  getBtcFeeRate,
  broadcastBtcTx,
  getBtcTransactions,
  getWalletPrices,
  // Phase G: Platform Fee Config
  getFeeConfig,
  updateFeeConfig,
  // Phase G #90: Fee Records
  recordFeeOutcome,
  getFeeRecords,
  // Task #93: Recipient Wallet Discovery
  registerAlphaWalletAddress,
  getAlphaWalletRecipient,
  // Phase G — Richiedi con Alpha Wallet
  createAlphaWalletPaymentRequest,
  getAlphaWalletPaymentRequest,
  markAlphaWalletRequestPaid,
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

/** GET /evm/receipt?chainId=137&txHash=0x... — controlla stato on-chain di una TX specifica */
router.get("/evm/receipt", getEvmReceipt);

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

// ── Platform Fee Config (Phase G) ─────────────────────────────────────────
/** GET /fee-config — platform fee config (authenticated user) */
router.get("/fee-config", getFeeConfig);

/** PATCH /fee-config — update platform fee (super_admin only) */
router.patch("/fee-config", requireAdmin("super_admin"), updateFeeConfig);

// ── Platform Fee Records (Phase G #90) ───────────────────────────────────
/**
 * POST /fee-record — utente autenticato registra l'esito della propria fee TX.
 * Idempotency key: mainTxHash. Non richiede admin perché l'utente riporta il proprio pagamento.
 */
router.post("/fee-record", recordFeeOutcome);

/** GET /fee-records — lista record fee + summary. Super admin only. */
router.get("/fee-records", requireAdmin("super_admin"), getFeeRecords);

// ── Task #93: Recipient Wallet Discovery ──────────────────────────────────

/**
 * POST /register-address
 * Salva gli indirizzi Alpha Wallet pubblici dell'utente autenticato.
 * Body: { evmAddress: "0x...", btcAddress?: "bc1q..." }
 * NON riceve mai seed, private key, PIN o keystore.
 */
router.post("/register-address", registerAlphaWalletAddress);

/**
 * GET /recipient/:userId
 * Recupera gli indirizzi Alpha Wallet pubblici di un destinatario.
 * Richiede che requester e userId condividano una conversazione attiva.
 * 403 se non esiste conversazione comune.
 */
router.get("/recipient/:userId", getAlphaWalletRecipient);

// ── Phase G — Richiedi con Alpha Wallet ───────────────────────────────────

/**
 * POST /payment-requests
 * Crea una richiesta di pagamento self-custodial.
 * Body: { payerUserId, conversationId, network, assetSymbol, amount, requesterAddress }
 */
router.post("/payment-requests", createAlphaWalletPaymentRequest);

/**
 * GET /payment-requests/:id
 * Stato corrente di una richiesta. Solo requester o payer.
 */
router.get("/payment-requests/:id", getAlphaWalletPaymentRequest);

/**
 * PATCH /payment-requests/:id/paid
 * Il payer segna la richiesta come pagata (dopo TX broadcast).
 * Body: { txHash }
 */
router.patch("/payment-requests/:id/paid", markAlphaWalletRequestPaid);

export default router;
