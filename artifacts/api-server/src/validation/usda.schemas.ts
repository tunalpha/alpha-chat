import { z } from "zod";

const amountRegex = /^\d+(\.\d{1,18})?$/;

export const PreparePaymentSchema = z.object({
  to_user_id:       z.string().min(1),
  conversation_id:  z.string().min(1),
  amount:           z.string().regex(amountRegex, "Invalid USDA amount"),
  note:             z.string().max(200).optional(),
});

export const SubmitPaymentSchema = z.object({
  to_user_id:        z.string().min(1),
  conversation_id:   z.string().min(1),
  amount:            z.string().regex(amountRegex, "Invalid USDA amount"),
  fee:               z.string().regex(amountRegex, "Invalid fee"),
  note:              z.string().max(200).optional(),
  client_payment_id: z.string().uuid("client_payment_id must be UUID v4"),
  prepared_data:     z.record(z.unknown()),
  signature:         z.string().optional(),
});

export const RequestPaymentSchema = z.object({
  to_user_id:        z.string().min(1),
  conversation_id:   z.string().min(1),
  amount:            z.string().regex(amountRegex, "Invalid USDA amount"),
  note:              z.string().max(200).optional(),
  client_payment_id: z.string().uuid("client_payment_id must be UUID v4"),
});

export const PayRequestSchema = z.object({
  signature: z.string().optional(),
});

// Regex: 0x + 40 hex chars = indirizzo EVM standard (Ethereum / Polygon)
const EVM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

export const SetWalletAddressSchema = z.object({
  address: z
    .string()
    .regex(EVM_ADDRESS_RE, "Indirizzo wallet non valido — deve essere un indirizzo Polygon/Ethereum (0x + 40 caratteri hex)"),
  chain:   z.enum(["usda", "polygon", "ethereum", "bitcoin", "lightning"]).default("usda"),
});

export const HistoryQuerySchema = z.object({
  type:  z.enum(["sent", "received", "pending", "claimed", "refunded"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  skip:  z.coerce.number().int().min(0).default(0),
});

export type PreparePaymentInput  = z.infer<typeof PreparePaymentSchema>;
export type SubmitPaymentInput   = z.infer<typeof SubmitPaymentSchema>;
export type RequestPaymentInput  = z.infer<typeof RequestPaymentSchema>;
export type PayRequestInput      = z.infer<typeof PayRequestSchema>;
export type SetWalletAddressInput = z.infer<typeof SetWalletAddressSchema>;
export type HistoryQueryInput    = z.infer<typeof HistoryQuerySchema>;
