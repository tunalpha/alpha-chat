/**
 * Alpha Wallet — Routes
 *
 * ISOLAMENTO: nessuna dipendenza dal Payment Engine esistente.
 * Richiede autenticazione (requireAuth) per tutti gli endpoint.
 * Gli address vengono passati come query param dal client autenticato.
 */

import { Router } from "express";
import { authenticate } from "../../middleware/authenticate.middleware";
import {
  getEvmTokenInfo,
  getEvmTransactions,
  getBtcTransactions,
} from "../../controllers/alpha-wallet.controller";

const router = Router();

// Tutti gli endpoint richiedono autenticazione Alpha Chat
router.use(authenticate);

/**
 * GET /api/v1/alpha-wallet/evm/token-info?chainId=137&address=0x...
 * Recupera metadata ERC-20 (name, symbol, decimals) da contratto.
 */
router.get("/evm/token-info", getEvmTokenInfo);

/**
 * GET /api/v1/alpha-wallet/evm/transactions?chainId=137&address=0x...&fromBlock=0x...
 * Storico transazioni EVM per un address (Alchemy proxy).
 */
router.get("/evm/transactions", getEvmTransactions);

/**
 * GET /api/v1/alpha-wallet/btc/transactions?address=bc1q...
 * Storico transazioni Bitcoin (Blockstream proxy).
 */
router.get("/btc/transactions", getBtcTransactions);

export default router;
