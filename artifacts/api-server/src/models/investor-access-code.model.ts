import mongoose, { Schema, Document } from "mongoose";

export interface IInvestorAccessCode extends Document {
  codeHash: string;         // argon2id hash of the plain code
  codePlain?: string;       // ONLY set transiently, never persisted
  investorName: string;
  investorEmail: string;
  createdAt: Date;
  expiresAt?: Date;         // undefined = no expiry
  lastUsedAt?: Date;
  accessCount: number;
  status: "active" | "revoked" | "expired";
  linkedRequestId?: mongoose.Types.ObjectId;
}

const schema = new Schema<IInvestorAccessCode>(
  {
    codeHash:        { type: String, required: true },
    investorName:    { type: String, required: true, trim: true },
    investorEmail:   { type: String, required: true, trim: true, lowercase: true },
    createdAt:       { type: Date, default: () => new Date() },
    expiresAt:       { type: Date },
    lastUsedAt:      { type: Date },
    accessCount:     { type: Number, default: 0 },
    status:          { type: String, enum: ["active", "revoked", "expired"], default: "active" },
    linkedRequestId: { type: Schema.Types.ObjectId, ref: "InvestorAccessRequest" },
  },
  { collection: "investor_access_codes" }
);

schema.index({ status: 1 });
schema.index({ investorEmail: 1 });

export const InvestorAccessCodeModel = mongoose.model<IInvestorAccessCode>(
  "InvestorAccessCode",
  schema
);
