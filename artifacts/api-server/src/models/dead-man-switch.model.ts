/**
 * DeadManSwitch — Sprint 19
 *
 * Configurazione per utente. L'utente sceglie:
 *   - period_days: quanti giorni di inattività prima dell'alert
 *   - grace_days: periodo di grazia dopo l'avviso prima dell'azione
 *   - action: cosa fare se scade il grace period
 *
 * Il campo last_check_in_at viene aggiornato ad ogni login autenticato.
 */

import mongoose, { Document, Model, Schema } from "mongoose";

export type DmsAction = "none" | "lock" | "notify_only";

export interface IDeadManSwitch {
  user_id: mongoose.Types.ObjectId;
  enabled: boolean;
  period_days: number;          // 30 | 60 | 90 | 180 | custom
  grace_days: number;           // default 7
  action: DmsAction;
  last_check_in_at: Date;
  warning_sent_at: Date | null; // null = avviso non ancora inviato
  grace_started_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export type IDeadManSwitchDocument = IDeadManSwitch & Document;

const schema = new Schema<IDeadManSwitchDocument>(
  {
    user_id:          { type: Schema.Types.ObjectId, required: true, ref: "User", unique: true },
    enabled:          { type: Boolean, required: true, default: false },
    period_days:      { type: Number, required: true, default: 90, min: 7, max: 365 },
    grace_days:       { type: Number, required: true, default: 7, min: 1, max: 30 },
    action:           { type: String, enum: ["none", "lock", "notify_only"], required: true, default: "notify_only" },
    last_check_in_at: { type: Date, required: true, default: () => new Date() },
    warning_sent_at:  { type: Date, default: null },
    grace_started_at: { type: Date, default: null },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } },
);

schema.index({ enabled: 1, last_check_in_at: 1 }); // per il job scheduler

export const DeadManSwitchModel: Model<IDeadManSwitchDocument> =
  mongoose.models["DeadManSwitch"] ??
  mongoose.model<IDeadManSwitchDocument>("DeadManSwitch", schema);
