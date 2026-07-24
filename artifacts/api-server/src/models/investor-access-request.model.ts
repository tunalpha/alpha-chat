import mongoose, { Schema, Document } from "mongoose";

export interface IInvestorAccessRequest extends Document {
  name: string;
  company: string;
  email: string;
  message?: string;
  status: "pending" | "approved" | "rejected";
  requestedAt: Date;
  reviewedAt?: Date;
  reviewedBy?: string;
  approvedCodeId?: mongoose.Types.ObjectId;
}

const schema = new Schema<IInvestorAccessRequest>(
  {
    name:          { type: String, required: true, trim: true },
    company:       { type: String, required: true, trim: true },
    email:         { type: String, required: true, trim: true, lowercase: true },
    message:       { type: String, trim: true },
    status:        { type: String, enum: ["pending", "approved", "rejected"], default: "pending" },
    requestedAt:   { type: Date, default: () => new Date() },
    reviewedAt:    { type: Date },
    reviewedBy:    { type: String },
    approvedCodeId:{ type: Schema.Types.ObjectId, ref: "InvestorAccessCode" },
  },
  { collection: "investor_access_requests" }
);

schema.index({ status: 1, requestedAt: -1 });
schema.index({ email: 1 });

export const InvestorAccessRequestModel = mongoose.model<IInvestorAccessRequest>(
  "InvestorAccessRequest",
  schema
);
