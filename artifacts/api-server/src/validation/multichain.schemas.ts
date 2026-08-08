/**
 * multichain.schemas.ts — Schemi Zod per il Multi-Chain Payment Engine
 *
 * H-4: input validation prima di raggiungere il service.
 * ISOLAMENTO: nessuna dipendenza da USDA o altri payment flow.
 */

import { z } from "zod";

// ─── Costanti ──────────────────────────────────────────────────────────────────

const VALID_NETWORKS = ["polygon", "ethereum", "bsc", "bitcoin"] as const;
const VALID_ASSETS   = ["USDT", "USDA", "BTC"]                   as const;

/** Combinazioni network/asset valide */
const VALID_COMBOS = new Set([
  "polygon:USDT",
  "polygon:USDA",
  "ethereum:USDT",
  "bsc:USDT",
  "bitcoin:BTC",
]);

/** Regex EVM address (0x + 40 hex chars, case-insensitive) */
const EVM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/**
 * Regex indirizzi Bitcoin (mainnet + testnet):
 *   bc1...  — P2WPKH/P2WSH native SegWit mainnet
 *   tb1...  — P2WPKH/P2WSH native SegWit testnet
 *   1...    — P2PKH legacy mainnet
 *   3...    — P2SH mainnet
 *   m/n...  — P2PKH/P2SH testnet legacy
 */
const BTC_ADDRESS_RE = /^(bc1[a-z0-9]{6,87}|tb1[a-z0-9]{6,87}|[13][a-km-zA-HJ-NP-Z1-9]{25,34}|[mn][a-km-zA-HJ-NP-Z1-9]{25,34})$/;

/** ObjectId MongoDB (24 hex chars) */
const OBJECT_ID_RE = /^[0-9a-f]{24}$/i;

/** Intero BigInt positivo come stringa (senza segno, senza decimali) */
const POSITIVE_BIGINT_STR = /^[1-9][0-9]*$/;

// ─── Schema: Crea Trasferimento ────────────────────────────────────────────────

export const CreateMultiChainTransferSchema = z
  .object({
    network:          z.enum(VALID_NETWORKS),
    asset:            z.enum(VALID_ASSETS),
    grossAmountUnits: z.string().regex(POSITIVE_BIGINT_STR, "Deve essere un intero positivo non zero"),
    senderWallet:     z.string().min(1, "senderWallet obbligatorio"),
    recipientWallet:  z.string().min(1, "recipientWallet obbligatorio"),
    recipientId:      z.string().regex(OBJECT_ID_RE, "recipientId non valido"),
    conversationId:   z.string().regex(OBJECT_ID_RE, "conversationId non valido"),
    clientRef:        z.string().min(1).max(128),
    expiresInHours:   z
      .number()
      .int("Deve essere un intero")
      .min(1, "Minimo 1 ora")
      .max(720, "Massimo 720 ore (30 giorni)")
      .optional(),
  })
  .superRefine((data, ctx) => {
    // ── Verifica combinazione network/asset ──
    const combo = `${data.network}:${data.asset}`;
    if (!VALID_COMBOS.has(combo)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Combinazione non supportata: ${combo}. Valide: ${[...VALID_COMBOS].join(", ")}`,
        path: ["asset"],
      });
    }

    // ── Verifica formato wallet in base alla rete ──
    const isBtc    = data.network === "bitcoin";
    const walletRe = isBtc ? BTC_ADDRESS_RE : EVM_ADDRESS_RE;
    const netLabel = isBtc ? "Bitcoin (bech32/legacy)" : `EVM (0x... 40 hex)`;

    if (!walletRe.test(data.senderWallet)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `senderWallet non valido per ${data.network} — atteso: ${netLabel}`,
        path: ["senderWallet"],
      });
    }
    if (!walletRe.test(data.recipientWallet)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `recipientWallet non valido per ${data.network} — atteso: ${netLabel}`,
        path: ["recipientWallet"],
      });
    }

    // ── Sanity check importo (overflow guard — max 10^27) ──
    try {
      const amount = BigInt(data.grossAmountUnits);
      if (amount > 10n ** 27n) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "grossAmountUnits troppo grande",
          path: ["grossAmountUnits"],
        });
      }
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "grossAmountUnits non è un intero valido",
        path: ["grossAmountUnits"],
      });
    }
  });

export type CreateMultiChainTransferInput = z.infer<typeof CreateMultiChainTransferSchema>;
