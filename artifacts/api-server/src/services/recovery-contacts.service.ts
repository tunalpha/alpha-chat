/**
 * RecoveryContacts Service — Sprint 19
 *
 * Gestisce i contatti fidati (max 5 per utente).
 * I contatti non vedono mai i dati dell'account —
 * ricevono solo notifiche di conferma se configurate.
 */

import { RecoveryContactModel } from "../models/recovery-contact.model";
import { logSecurityEvent } from "./security-timeline.service";
import { AppError } from "../errors/AppError";

const MAX_CONTACTS = 5;

// ---------------------------------------------------------------------------
// Tipi
// ---------------------------------------------------------------------------

export interface RecoveryContactDTO {
  id: string;
  name: string;
  email: string;
  relation: string | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

export async function listRecoveryContacts(userId: string): Promise<RecoveryContactDTO[]> {
  const docs = await RecoveryContactModel.find({ user_id: userId }).sort({ created_at: 1 }).lean();
  return docs.map(d => ({
    id: d._id.toString(),
    name: d.name,
    email: d.email,
    relation: d.relation,
    created_at: d.created_at.toISOString(),
  }));
}

// ---------------------------------------------------------------------------
// Add
// ---------------------------------------------------------------------------

export async function addRecoveryContact(params: {
  userId: string;
  name: string;
  email: string;
  relation?: string;
}): Promise<RecoveryContactDTO> {
  const { userId, name, email, relation } = params;

  const count = await RecoveryContactModel.countDocuments({ user_id: userId });
  if (count >= MAX_CONTACTS) {
    throw new AppError("LIMIT_EXCEEDED", 422);
  }

  // Controlla duplicato email per utente
  const existing = await RecoveryContactModel.findOne({ user_id: userId, email });
  if (existing) throw new AppError("DUPLICATE", 409);

  const doc = await RecoveryContactModel.create({
    user_id: userId,
    name: name.trim(),
    email: email.trim().toLowerCase(),
    relation: relation?.trim() ?? null,
  });

  await logSecurityEvent({
    user_id: userId,
    event_type: "RECOVERY_CONTACT_ADDED",
    metadata: { email_domain: email.split("@")[1] ?? "unknown" },
  });

  return {
    id: doc._id.toString(),
    name: doc.name,
    email: doc.email,
    relation: doc.relation,
    created_at: doc.created_at.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Remove
// ---------------------------------------------------------------------------

export async function removeRecoveryContact(params: {
  userId: string;
  contactId: string;
}): Promise<void> {
  const { userId, contactId } = params;

  const result = await RecoveryContactModel.deleteOne({ _id: contactId, user_id: userId });
  if (result.deletedCount === 0) throw new AppError("NOT_FOUND", 404);

  await logSecurityEvent({
    user_id: userId,
    event_type: "RECOVERY_CONTACT_REMOVED",
    metadata: {},
  });
}
