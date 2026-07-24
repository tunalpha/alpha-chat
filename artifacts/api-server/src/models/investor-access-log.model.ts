import mongoose, { Schema, Document } from "mongoose";

export interface IInvestorAccessLog extends Document {
  attemptedAt: Date;
  ip?: string;
  userAgent?: string;
  country?: string;
  codeId?: mongoose.Types.ObjectId;
  investorEmail?: string;
  documentOpened?: string;
  outcome: "success" | "denied" | "expired" | "revoked";
  reason?: string;
}

const schema = new Schema<IInvestorAccessLog>(
  {
    attemptedAt:    { type: Date, default: () => new Date() },
    ip:             { type: String },
    userAgent:      { type: String },
    country:        { type: String },
    codeId:         { type: Schema.Types.ObjectId, ref: "InvestorAccessCode" },
    investorEmail:  { type: String },
    documentOpened: { type: String },
    outcome:        { type: String, enum: ["success","denied","expired","revoked"], required: true },
    reason:         { type: String },
  },
  { collection: "investor_access_log" }
);

schema.index({ attemptedAt: -1 });
schema.index({ outcome: 1 });

export const InvestorAccessLogModel = mongoose.model<IInvestorAccessLog>(
  "InvestorAccessLog",
  schema
);
