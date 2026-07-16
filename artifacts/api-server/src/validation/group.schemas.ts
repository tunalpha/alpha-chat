/**
 * Schemi Zod per le API Gruppi — Sprint 21.
 */
import { z } from "zod";

export const CreateGroupSchema = z.object({
  name: z
    .string()
    .min(1, "Il nome è obbligatorio")
    .max(100, "Nome troppo lungo (max 100 caratteri)"),
  description: z.string().max(500).optional().default(""),
  member_usernames: z
    .array(z.string().min(1).max(64))
    .min(1, "Aggiungi almeno un membro")
    .max(254, "Troppi membri (max 255 incluso il creatore)"),
});

export const UpdateGroupSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
});

export const AddMemberSchema = z.object({
  username: z.string().min(1).max(64),
});

export const ChangeRoleSchema = z.object({
  role: z.enum(["admin", "member"]),
});

export const GroupIdParamSchema = z.object({
  groupId: z
    .string()
    .regex(/^[0-9a-fA-F]{24}$/, "groupId deve essere ObjectId"),
});

export const GroupMemberParamSchema = z.object({
  groupId: z
    .string()
    .regex(/^[0-9a-fA-F]{24}$/, "groupId deve essere ObjectId"),
  userId: z
    .string()
    .regex(/^[0-9a-fA-F]{24}$/, "userId deve essere ObjectId"),
});

export type CreateGroupInput    = z.infer<typeof CreateGroupSchema>;
export type UpdateGroupInput    = z.infer<typeof UpdateGroupSchema>;
export type AddMemberInput      = z.infer<typeof AddMemberSchema>;
export type ChangeRoleInput     = z.infer<typeof ChangeRoleSchema>;
export type GroupIdParam        = z.infer<typeof GroupIdParamSchema>;
export type GroupMemberParam    = z.infer<typeof GroupMemberParamSchema>;
