/**
 * alpha-wallet-monitor.controller.ts — Admin Alpha Wallet Monitoring
 *
 * SCOPE: solo monitoring e observability. NON modifica:
 *   - logiche wallet, fee, payment engine, chat, Signal, USDA, BTC
 *   - nessun write su DB (solo read)
 *
 * Routes (registrate in admin.alpha-wallet-monitor.routes.ts):
 *   GET /api/v1/admin/alpha-wallet-monitor/overview          — KPI aggregate
 *   GET /api/v1/admin/alpha-wallet-monitor/users             — lista utenti wallet
 *   GET /api/v1/admin/alpha-wallet-monitor/fee-records       — fee records paginati
 *   GET /api/v1/admin/alpha-wallet-monitor/payment-requests  — richieste pagamento
 *   GET /api/v1/admin/alpha-wallet-monitor/errors            — fee record con errori
 *
 * PRIVACY: nessun seed/mnemonic/private key restituito. Solo indirizzi pubblici.
 */

import { type Request, type Response, type NextFunction } from "express";
import { UserModel }                          from "../models/user.model.js";
import { AlphaWalletFeeRecordModel }          from "../models/alpha-wallet-fee-record.model.js";
import { AlphaWalletPaymentRequestModel }     from "../models/alpha-wallet-payment-request.model.js";

// ─── Helper ───────────────────────────────────────────────────────────────────

function sumFees(records: Array<{ feeAmount: string }>): number {
  return records.reduce((s, r) => s + parseFloat(r.feeAmount || "0"), 0);
}

function cutoff(range: string): Date | null {
  const map: Record<string, number> = {
    "24h": 86_400_000,
    "7d" : 7  * 86_400_000,
    "30d": 30 * 86_400_000,
  };
  const ms = map[range];
  return ms ? new Date(Date.now() - ms) : null;
}

// ─── GET /overview ────────────────────────────────────────────────────────────

export async function getOverviewHandler(
  _req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const [
      totalWalletEnabled,
      selfCustodialEvm,
      selfCustodialBtc,
      thirdPartyPolygon,
      thirdPartyEthereum,
      thirdPartyUsda,
      feeRecords,
      payReqStats,
    ] = await Promise.all([
      UserModel.countDocuments({ wallet_enabled: true }),
      UserModel.countDocuments({ alpha_wallet_evm_address: { $ne: null } }),
      UserModel.countDocuments({ alpha_wallet_btc_address: { $ne: null } }),
      UserModel.countDocuments({ "wallets.polygon.verifiedAt":  { $ne: null } }),
      UserModel.countDocuments({ "wallets.ethereum.verifiedAt": { $ne: null } }),
      UserModel.countDocuments({ "wallets.usda.verifiedAt":     { $ne: null } }),
      AlphaWalletFeeRecordModel.find()
        .select("status feeAmount network assetSymbol source createdAt")
        .lean(),
      AlphaWalletPaymentRequestModel.aggregate([
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),
    ]);

    // third party deduplicato (utenti con almeno uno)
    const thirdPartyAny = await UserModel.countDocuments({
      $or: [
        { "wallets.polygon.verifiedAt":  { $ne: null } },
        { "wallets.ethereum.verifiedAt": { $ne: null } },
        { "wallets.usda.verifiedAt":     { $ne: null } },
        { "wallets.bitcoin.verifiedAt":  { $ne: null } },
        { "wallets.lightning.verifiedAt":{ $ne: null } },
      ],
    });

    const feeSuccess   = feeRecords.filter(r => r.status === "success");
    const feeFailed    = feeRecords.filter(r => r.status === "failed_permanent");
    const feeTransient = feeRecords.filter(r => r.status === "failed_transient");

    // raggruppamento per network
    const byNetwork: Record<string, { success: number; failed: number; volume: number }> = {};
    for (const r of feeRecords) {
      const net = r.network || "unknown";
      if (!byNetwork[net]) byNetwork[net] = { success: 0, failed: 0, volume: 0 };
      if (r.status === "success") {
        byNetwork[net].success++;
        byNetwork[net].volume += parseFloat(r.feeAmount || "0");
      } else {
        byNetwork[net].failed++;
      }
    }

    const payReqMap: Record<string, number> = {};
    for (const g of payReqStats as Array<{ _id: string; count: number }>) {
      payReqMap[g._id] = g.count;
    }

    res.json({
      data: {
        users: {
          wallet_enabled:     totalWalletEnabled,
          self_custodial_evm: selfCustodialEvm,
          self_custodial_btc: selfCustodialBtc,
          third_party_any:    thirdPartyAny,
          third_party_polygon:  thirdPartyPolygon,
          third_party_ethereum: thirdPartyEthereum,
          third_party_usda:     thirdPartyUsda,
        },
        fee_records: {
          total:              feeRecords.length,
          success:            feeSuccess.length,
          failed_permanent:   feeFailed.length,
          failed_transient:   feeTransient.length,
          volume_collected:   parseFloat(sumFees(feeSuccess).toFixed(6)),
          by_network:         byNetwork,
        },
        payment_requests: {
          total:    Object.values(payReqMap).reduce((a, b) => a + b, 0),
          pending:  payReqMap["pending"]   ?? 0,
          paid:     payReqMap["paid"]      ?? 0,
          cancelled:payReqMap["cancelled"] ?? 0,
          expired:  payReqMap["expired"]   ?? 0,
        },
      },
    });
  } catch (err) { next(err); }
}

// ─── GET /users ───────────────────────────────────────────────────────────────

export async function getUsersHandler(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const limit  = Math.min(parseInt(String(req.query.limit  ?? "50"), 10), 200);
    const skip   = parseInt(String(req.query.skip ?? "0"), 10);
    const filter = String(req.query.filter ?? "all");

    const query: Record<string, unknown> = {};
    if (filter === "self_custodial")  query["alpha_wallet_evm_address"] = { $ne: null };
    if (filter === "third_party") {
      query["$or"] = [
        { "wallets.polygon.verifiedAt":   { $ne: null } },
        { "wallets.ethereum.verifiedAt":  { $ne: null } },
        { "wallets.usda.verifiedAt":      { $ne: null } },
        { "wallets.bitcoin.verifiedAt":   { $ne: null } },
        { "wallets.lightning.verifiedAt": { $ne: null } },
      ];
    }
    if (filter === "enabled") query["wallet_enabled"] = true;

    const [users, total] = await Promise.all([
      UserModel.find(query)
        .select("username email wallet_enabled alpha_wallet_evm_address alpha_wallet_btc_address wallets createdAt updatedAt")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      UserModel.countDocuments(query),
    ]);

    res.json({
      data: {
        users: users.map(u => ({
          user_id:                u._id,
          username:               u.username,
          email:                  u.email,
          wallet_enabled:         u.wallet_enabled ?? false,
          self_custodial_evm:     u.alpha_wallet_evm_address ?? null,
          self_custodial_btc:     u.alpha_wallet_btc_address ?? null,
          third_party_wallets: {
            polygon:   u.wallets?.polygon  ? { address: u.wallets.polygon.address,   verified_at: u.wallets.polygon.verifiedAt   } : null,
            ethereum:  u.wallets?.ethereum ? { address: u.wallets.ethereum.address,  verified_at: u.wallets.ethereum.verifiedAt  } : null,
            usda:      u.wallets?.usda     ? { address: u.wallets.usda.address,      verified_at: u.wallets.usda.verifiedAt      } : null,
            bitcoin:   u.wallets?.bitcoin  ? { address: u.wallets.bitcoin.address,   verified_at: u.wallets.bitcoin.verifiedAt   } : null,
            lightning: u.wallets?.lightning? { address: u.wallets.lightning.address, verified_at: u.wallets.lightning.verifiedAt } : null,
          },
          registered_at: u.createdAt,
        })),
        total,
        skip,
        limit,
      },
    });
  } catch (err) { next(err); }
}

// ─── GET /fee-records ─────────────────────────────────────────────────────────

export async function getFeeRecordsHandler(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const limit   = Math.min(parseInt(String(req.query.limit ?? "50"), 10), 200);
    const skip    = parseInt(String(req.query.skip    ?? "0"), 10);
    const network = req.query.network as string | undefined;
    const status  = req.query.status  as string | undefined;
    const range   = req.query.range   as string | undefined;
    const source  = req.query.source  as string | undefined;

    const filter: Record<string, unknown> = {};
    if (network) filter["network"]    = network;
    if (status)  filter["status"]     = status;
    if (source)  filter["source"]     = source;
    const cut = cutoff(range ?? "");
    if (cut)     filter["createdAt"]  = { $gte: cut };

    const [records, total] = await Promise.all([
      AlphaWalletFeeRecordModel.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      AlphaWalletFeeRecordModel.countDocuments(filter),
    ]);

    res.json({ data: { records, total, skip, limit } });
  } catch (err) { next(err); }
}

// ─── GET /payment-requests ────────────────────────────────────────────────────

export async function getPaymentRequestsHandler(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const limit  = Math.min(parseInt(String(req.query.limit ?? "50"), 10), 200);
    const skip   = parseInt(String(req.query.skip   ?? "0"), 10);
    const status = req.query.status as string | undefined;
    const range  = req.query.range  as string | undefined;

    const filter: Record<string, unknown> = {};
    if (status) filter["status"] = status;
    const cut = cutoff(range ?? "");
    if (cut)    filter["created_at"] = { $gte: cut };

    const [raw, total] = await Promise.all([
      AlphaWalletPaymentRequestModel.find(filter)
        .sort({ created_at: -1 })
        .skip(skip)
        .limit(limit)
        .populate("requester_id", "username email")
        .populate("payer_id",     "username email")
        .lean(),
      AlphaWalletPaymentRequestModel.countDocuments(filter),
    ]);

    const requests = raw.map((r: any) => ({
      id:                r._id,
      requester:         r.requester_id ? { id: r.requester_id._id, username: r.requester_id.username, email: r.requester_id.email } : null,
      payer:             r.payer_id     ? { id: r.payer_id._id,     username: r.payer_id.username,     email: r.payer_id.email     } : null,
      network:           r.network,
      asset_symbol:      r.asset_symbol,
      amount:            r.amount,
      requester_address: r.requester_address,
      status:            r.status,
      tx_hash:           r.tx_hash ?? null,
      created_at:        r.created_at,
      expires_at:        r.expires_at,
    }));

    res.json({ data: { requests, total, skip, limit } });
  } catch (err) { next(err); }
}

// ─── GET /errors ──────────────────────────────────────────────────────────────

export async function getErrorsHandler(
  _req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const errors = await AlphaWalletFeeRecordModel.find({
      $or: [
        { status: "failed_permanent" },
        { status: "failed_transient" },
        { lastError: { $exists: true, $ne: null } },
      ],
    })
      .sort({ updatedAt: -1 })
      .limit(100)
      .lean();

    res.json({ data: { errors, total: errors.length } });
  } catch (err) { next(err); }
}
