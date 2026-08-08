/**
 * multichain.schemas.ts — Schemi Zod per il Multi-Chain Payment Engine
 *
 * H-4: input validation prima di raggiungere il service.
 * ISOLAMENTO: nessuna dipendenza da USDA o altri payment flow.
 *
 * STEP 3: aggiunto amountMode + targetNetAmountUnits per modalità recipient_exact.
 * Backward compat: richieste senza amountMode → send_amount.
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

/** Max importo consentito (overflow guard: 10^27) */
const MAX_AMOUNT = 10n ** 27n;

/** Valida un campo importo BigInt come stringa (overflow guard) */
function validateBigIntAmount(
  value: string | undefined,
  fieldName: string,
  ctx: z.RefinementCtx,
): void {
  if (!value) return;
  try {
    const amount = BigInt(value);
    if (amount > MAX_AMOUNT) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${fieldName} troppo grande (max 10^27)`,
        path: [fieldName],
      });
    }
  } catch {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `${fieldName} non è un intero valido`,
      path: [fieldName],
    });
  }
}

// ─── Helper: validazione combo network/asset + wallet ─────────────────────────

function validateNetworkAssetWallet(
  data: {
    network: string;
    asset: string;
    senderWallet?: string;
    recipientWallet?: string;
  },
  ctx: z.RefinementCtx,
): void {
  const combo = `${data.network}:${data.asset}`;
  if (!VALID_COMBOS.has(combo)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Combinazione non supportata: ${combo}. Valide: ${[...VALID_COMBOS].join(", ")}`,
      path: ["asset"],
    });
  }

  // Wallet format validation — solo se forniti. Al momento della creazione
  // possono essere assenti: vengono risolti al momento del deposito/release.
  if (data.senderWallet || data.recipientWallet) {
    const isBtc    = data.network === "bitcoin";
    const walletRe = isBtc ? BTC_ADDRESS_RE : EVM_ADDRESS_RE;
    const netLabel = isBtc ? "Bitcoin (bech32/legacy)" : "EVM (0x... 40 hex)";

    if (data.senderWallet && !walletRe.test(data.senderWallet)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `senderWallet non valido per ${data.network} — atteso: ${netLabel}`,
        path: ["senderWallet"],
      });
    }
    if (data.recipientWallet && !walletRe.test(data.recipientWallet)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `recipientWallet non valido per ${data.network} — atteso: ${netLabel}`,
        path: ["recipientWallet"],
      });
    }
  }
}

// ─── Schema: Crea Trasferimento ────────────────────────────────────────────────

/**
 * Validazione request body per POST /multichain/transfers
 *
 * STEP 3 — PAYMENT MODE:
 *   amountMode = "send_amount" (default, backward compat):
 *     grossAmountUnits obbligatorio → comportamento invariato
 *   amountMode = "recipient_exact":
 *     targetNetAmountUnits obbligatorio → gross calcolato inversamente dal service
 *
 * Backward compat: richieste senza amountMode → send_amount
 */
export const CreateMultiChainTransferSchema = z
  .object({
    network:          z.enum(VALID_NETWORKS),
    asset:            z.enum(VALID_ASSETS),
    /**
     * Modalità importo (default: "send_amount").
     * "send_amount":     grossAmountUnits è il valore che il mittente invia lordo.
     * "recipient_exact": targetNetAmountUnits è il netto che il destinatario deve ricevere.
     */
    amountMode:           z.enum(["send_amount", "recipient_exact"]).optional(),
    /**
     * Importo lordo in base units (stringa intera positiva).
     * Obbligatorio per amountMode=send_amount (o quando amountMode è omesso).
     */
    grossAmountUnits:     z.string().regex(POSITIVE_BIGINT_STR, "Deve essere un intero positivo non zero").optional(),
    /**
     * Importo netto target in base units (stringa intera positiva).
     * Obbligatorio per amountMode=recipient_exact.
     * Il service calcola il gross amount minimo tale che netAmount ≥ targetNetAmount.
     */
    targetNetAmountUnits: z.string().regex(POSITIVE_BIGINT_STR, "Deve essere un intero positivo non zero").optional(),
    // Wallet opzionali: non disponibili al momento della creazione.
    // Vengono risolti nel momento corretto (deposito/release).
    // Se forniti, il formato viene validato.
    senderWallet:     z.string().min(1).optional(),
    recipientWallet:  z.string().min(1).optional(),
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
    // ── Modalità importo e campi obbligatori ──────────────────────────────────
    const effectiveMode = data.amountMode ?? "send_amount";

    if (effectiveMode === "send_amount") {
      if (!data.grossAmountUnits) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "grossAmountUnits obbligatorio quando amountMode=send_amount",
          path: ["grossAmountUnits"],
        });
      } else {
        validateBigIntAmount(data.grossAmountUnits, "grossAmountUnits", ctx);
      }
    } else {
      // recipient_exact
      if (!data.targetNetAmountUnits) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "targetNetAmountUnits obbligatorio quando amountMode=recipient_exact",
          path: ["targetNetAmountUnits"],
        });
      } else {
        validateBigIntAmount(data.targetNetAmountUnits, "targetNetAmountUnits", ctx);
      }
    }

    // ── Verifica combinazione network/asset + formato wallet ──────────────────
    validateNetworkAssetWallet(data, ctx);
  });

export type CreateMultiChainTransferInput = z.infer<typeof CreateMultiChainTransferSchema>;

// ─── Schema: Quote / Preview ───────────────────────────────────────────────────

/**
 * Validazione request body per POST /multichain/transfers/quote
 *
 * Calcolo preventivo senza creare un transfer nel DB.
 * Stessi calcoli usati poi nella creazione definitiva — zero divergenze.
 */
export const PaymentQuoteSchema = z
  .object({
    network:              z.enum(VALID_NETWORKS),
    asset:                z.enum(VALID_ASSETS),
    amountMode:           z.enum(["send_amount", "recipient_exact"]),
    grossAmountUnits:     z.string().regex(POSITIVE_BIGINT_STR, "Deve essere un intero positivo non zero").optional(),
    targetNetAmountUnits: z.string().regex(POSITIVE_BIGINT_STR, "Deve essere un intero positivo non zero").optional(),
  })
  .superRefine((data, ctx) => {
    if (data.amountMode === "send_amount") {
      if (!data.grossAmountUnits) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "grossAmountUnits obbligatorio per amountMode=send_amount",
          path: ["grossAmountUnits"],
        });
      } else {
        validateBigIntAmount(data.grossAmountUnits, "grossAmountUnits", ctx);
      }
    } else {
      if (!data.targetNetAmountUnits) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "targetNetAmountUnits obbligatorio per amountMode=recipient_exact",
          path: ["targetNetAmountUnits"],
        });
      } else {
        validateBigIntAmount(data.targetNetAmountUnits, "targetNetAmountUnits", ctx);
      }
    }

    // Combo network/asset (solo le combinazioni supportate)
    const combo = `${data.network}:${data.asset}`;
    if (!VALID_COMBOS.has(combo)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Combinazione non supportata: ${combo}. Valide: ${[...VALID_COMBOS].join(", ")}`,
        path: ["asset"],
      });
    }
  });

export type PaymentQuoteInput = z.infer<typeof PaymentQuoteSchema>;

// ─── Schema: Richiedi Pagamento (richiedente = recipient) ─────────────────────

/**
 * Validazione request body per POST /multichain/transfers/request
 *
 * Il chiamante è il recipient (richiedente).
 * payerId = chi deve depositare nell'escrow.
 * Nessun wallet richiesto — l'escrow è generato dal backend.
 */
export const RequestMultiChainTransferSchema = z
  .object({
    payerId:              z.string().regex(OBJECT_ID_RE, "payerId deve essere un ObjectId valido"),
    conversationId:       z.string().regex(OBJECT_ID_RE, "conversationId deve essere un ObjectId valido"),
    network:              z.enum(VALID_NETWORKS),
    asset:                z.enum(VALID_ASSETS),
    amountMode:           z.enum(["send_amount", "recipient_exact"]).default("send_amount"),
    grossAmountUnits:     z.string().regex(POSITIVE_BIGINT_STR, "Deve essere un intero positivo non zero").optional(),
    targetNetAmountUnits: z.string().regex(POSITIVE_BIGINT_STR, "Deve essere un intero positivo non zero").optional(),
    clientRef:            z.string().min(1).max(128),
    expiresInHours:       z.number().int().min(1).max(168).optional(),
  })
  .superRefine((data, ctx) => {
    const combo = `${data.network}:${data.asset}`;
    if (!VALID_COMBOS.has(combo)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Combinazione non supportata: ${combo}. Valide: ${[...VALID_COMBOS].join(", ")}`,
        path: ["asset"],
      });
    }
    if (data.amountMode === "send_amount") {
      if (!data.grossAmountUnits) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "grossAmountUnits obbligatorio per amountMode=send_amount",
          path: ["grossAmountUnits"],
        });
      } else {
        validateBigIntAmount(data.grossAmountUnits, "grossAmountUnits", ctx);
      }
    } else {
      if (!data.targetNetAmountUnits) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "targetNetAmountUnits obbligatorio per amountMode=recipient_exact",
          path: ["targetNetAmountUnits"],
        });
      } else {
        validateBigIntAmount(data.targetNetAmountUnits, "targetNetAmountUnits", ctx);
      }
    }
  });

export type RequestMultiChainTransferInput = z.infer<typeof RequestMultiChainTransferSchema>;
