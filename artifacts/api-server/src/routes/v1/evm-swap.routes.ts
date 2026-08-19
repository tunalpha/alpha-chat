/**
 * EVM Swap routes — /api/v1/swap/evm
 *
 * ISOLAMENTO: completamente separato da BTC/Lightning, payment engine, USDA, MultiChain.
 * La fee collection (25 bps) è gestita interamente dal meccanismo Li.Fi Fee Forwarder.
 * NON implementa fee collection aggiuntiva, NON tocca fee wallet.
 *
 * Routes:
 *   POST  /api/v1/swap/evm/start           — registra swap avviato (auth)
 *   PATCH /api/v1/swap/evm/:routeId        — aggiorna stato (auth)
 *   GET   /api/v1/swap/evm/history         — storico utente (auth)
 *   GET   /api/v1/swap/evm/admin/all       — tutti gli swap (admin read_only)
 *   GET   /api/v1/swap/evm/admin/aggregate — aggregati fee per chain/token (admin read_only)
 *   POST  /api/v1/swap/evm/admin/import    — importa record storici (admin)
 */

import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { authenticate   } from "../../middleware/authenticate.middleware.js";
import { requireAdmin   } from "../../middleware/require-admin.middleware.js";
import { evmSwapService, type HistoricalSwapRecord } from "../../services/swap/evm-swap.service.js";
import { dispatchToOne  } from "../../services/push/PushDispatcher.js";

const router = Router();

// ── Validation schemas ─────────────────────────────────────────────────────────

const StartSchema = z.object({
  routeId:      z.string().min(1),
  fromChainId:  z.number().int().positive(),
  toChainId:    z.number().int().nonnegative(), // 0 = Bitcoin (non-EVM)
  fromToken:    z.string().min(1),
  fromAddress:  z.string().min(1),
  toToken:      z.string().min(1),
  toAddress:    z.string().min(1),
  fromAmount:   z.string().min(1),
  toAmount:     z.string().default("0"),
  alphaFeeUSD:  z.string().optional(),
  tool:         z.string().optional(),
  btcDepositAddress: z.string().min(1).optional(),
  btcMemo:           z.string().min(1).max(512).optional(),
  btcPsbtDigest:     z.string().regex(/^[a-f0-9]{64}$/i).optional(),
});

const CompleteSchema = z.object({
  txHash:   z.string(),           // può essere vuoto in caso di failure
  toAmount: z.string().optional(),
  state:    z.enum(["completed", "failed"]),
  error:    z.string().optional(),
  sourceTxHash: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
});
const BtcDepositSchema = z.object({
  btcDepositTxHash: z.string().regex(/^[a-f0-9]{64}$/i),
});

const HistoricalRecordSchema = z.object({
  txHash:      z.string().min(10),
  fromChainId: z.number().int().nonnegative(),
  toChainId:   z.number().int().nonnegative(),
  fromToken:   z.string().min(1),
  toToken:     z.string().min(1),
  volumeUSD:   z.number().positive(),
  tool:        z.string().min(1),
  timestamp:   z.string().datetime(),
});

const ImportSchema = z.object({
  records: z.array(HistoricalRecordSchema).min(1).max(500),
});

// ── Handlers ───────────────────────────────────────────────────────────────────

router.post("/start", authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as unknown as Record<string, Record<string, string>>).user?.id;
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

    const parsed = StartSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Dati non validi", details: parsed.error.issues });
      return;
    }

    const swap = await evmSwapService.startSwap({ userId, ...parsed.data });
    res.status(201).json({ ok: true, routeId: swap.routeId, state: swap.state });
  } catch (err) {
    next(err);
  }
});

router.patch("/:routeId/btc-deposit", authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as unknown as Record<string, Record<string, string>>).user?.id;
    const routeId = String(req.params.routeId);
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
    const parsed = BtcDepositSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "Dati non validi", details: parsed.error.issues }); return; }
    const doc = await evmSwapService.recordBtcDeposit(routeId, userId, parsed.data.btcDepositTxHash);
    if (!doc) { res.status(404).json({ error: "Swap non trovato" }); return; }
    res.json({ ok: true, routeId: doc.routeId, state: doc.state });
  } catch (err) {
    next(err);
  }
});

router.patch("/:routeId", authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId  = (req as unknown as Record<string, Record<string, string>>).user?.id;
    const routeId = String(req.params.routeId);
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

    const parsed = CompleteSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Dati non validi", details: parsed.error.issues });
      return;
    }

    const doc = await evmSwapService.completeSwap({ userId, routeId, ...parsed.data });
    if (!doc) { res.status(404).json({ error: "Swap non trovato" }); return; }

    // Push notification fire-and-forget per swap completato con successo
    if (parsed.data.state === "completed") {
      dispatchToOne(userId, {
        type:           "swap.completed",
        recipientUserId: userId,
        fromToken:      doc.fromToken,
        toToken:        doc.toToken,
        fromAmount:     doc.fromAmount,
        toAmount:       doc.toAmount ?? "",
      });
    }

    res.json({ ok: true, routeId: doc.routeId, state: doc.state, txHash: doc.txHash });
  } catch (err) {
    next(err);
  }
});

router.get("/history", authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as unknown as Record<string, Record<string, string>>).user?.id;
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

    const history = await evmSwapService.getHistory(userId);
    res.json({ ok: true, swaps: history });
  } catch (err) {
    next(err);
  }
});

router.get("/admin/all", requireAdmin("read_only"), async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const swaps = await evmSwapService.adminGetAll();
    res.json({ ok: true, count: swaps.length, swaps });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /admin/aggregate
 * Aggregati fee per chain e token (solo swap completed).
 * NOTA: rappresenta le fee Alpha maturate internamente (25 bps su volume),
 * NON è prova dell'accredito on-chain Li.Fi.
 */
router.get("/admin/aggregate", requireAdmin("read_only"), async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const agg = await evmSwapService.adminGetAggregate();
    res.json({ ok: true, ...agg });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /admin/import
 * Importa record storici con deduplicazione su txHash.
 * Ogni record deve avere: txHash, fromChainId, toChainId, fromToken, toToken,
 * volumeUSD, tool, timestamp (ISO 8601).
 */
router.post("/admin/import", requireAdmin(), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = ImportSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Dati non validi", details: parsed.error.issues });
      return;
    }

    const records: HistoricalSwapRecord[] = parsed.data.records.map(r => ({
      ...r,
      timestamp: new Date(r.timestamp),
    }));

    const result = await evmSwapService.importHistorical(records);
    res.status(201).json({ ok: true, ...result });
  } catch (err) {
    next(err);
  }
});

export default router;
