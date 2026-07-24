import mongoose, { type Document } from "mongoose";

export interface IInvestorSettings extends Document {
  gateEnabled: boolean;
  updatedAt: Date;
}

const schema = new mongoose.Schema<IInvestorSettings>({
  gateEnabled: { type: Boolean, default: true },
  updatedAt:   { type: Date,    default: () => new Date() },
});

export const InvestorSettingsModel = mongoose.model<IInvestorSettings>(
  "InvestorSettings",
  schema,
);

/** Legge (o crea) il documento di settings. */
export async function getInvestorSettings(): Promise<{ gateEnabled: boolean }> {
  let doc = await InvestorSettingsModel.findOne();
  if (!doc) doc = await InvestorSettingsModel.create({ gateEnabled: true });
  return { gateEnabled: doc.gateEnabled };
}

/** Aggiorna le settings e restituisce il valore aggiornato. */
export async function setInvestorSettings(
  patch: Partial<{ gateEnabled: boolean }>,
): Promise<{ gateEnabled: boolean }> {
  const doc = await InvestorSettingsModel.findOneAndUpdate(
    {},
    { $set: { ...patch, updatedAt: new Date() } },
    { upsert: true, new: true },
  );
  return { gateEnabled: doc!.gateEnabled };
}
