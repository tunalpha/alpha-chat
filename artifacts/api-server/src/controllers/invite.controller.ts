import type { Request, Response, NextFunction } from "express";
import { InviteService } from "../services/invite.service";
import { createHash } from "crypto";
import type { GenerateInviteInput, RedeemInviteInput } from "../validation/invite.schemas";

const inviteService = new InviteService();

function ipHash(req: Request): string {
  const ip = req.ip ?? req.socket.remoteAddress ?? "unknown";
  return createHash("sha256").update(ip).digest("hex").slice(0, 16);
}

/**
 * POST /api/v1/invites/generate
 * Genera un nuovo codice invito monouso.
 * Body già validato dal middleware validate() nel router.
 */
export async function generateInvite(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { expires_in_seconds } = req.body as GenerateInviteInput;
    const userId = req.user!.userId;

    const result = await inviteService.generateInvite({
      userId,
      expiresInSeconds: expires_in_seconds,
      requestId: req.requestId,
    });

    res.status(201).json({
      data: {
        code: result.rawCode,
        expires_at: result.expiresAt.toISOString(),
        invite_id: result.inviteId,
        /** Payload per QR: alphachat://invite/{code} */
        qr_payload: `alphachat://invite/${result.rawCode}`,
      },
      meta: { request_id: req.requestId },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/v1/invites/redeem
 * Riscatta un codice invito ricevuto.
 */
export async function redeemInvite(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { code } = req.body as RedeemInviteInput;
    const userId = req.user!.userId;

    const result = await inviteService.redeemInvite({
      rawCode: code,
      redeemerId: userId,
      ipHash: ipHash(req),
      requestId: req.requestId,
    });

    res.status(200).json({
      data: {
        conversation_id: result.conversation_id,
        is_new: result.is_new,
      },
      meta: { request_id: req.requestId },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * DELETE /api/v1/invites/mine
 * Revoca tutti i propri codici attivi.
 */
export async function revokeMyInvites(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = req.user!.userId;
    const count = await inviteService.revokeMyInvites(userId, req.requestId);
    res.status(200).json({
      data: { revoked: count },
      meta: { request_id: req.requestId },
    });
  } catch (err) {
    next(err);
  }
}
