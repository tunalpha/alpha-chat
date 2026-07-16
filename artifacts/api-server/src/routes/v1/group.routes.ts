/**
 * Group routes — Sprint 21 — montate su /api/v1/groups
 */

import { Router } from "express";
import { authenticate } from "../../middleware/authenticate.middleware";
import { validate } from "../../middleware/validate.middleware";
import {
  CreateGroupSchema,
  UpdateGroupSchema,
  AddMemberSchema,
  ChangeRoleSchema,
  GroupIdParamSchema,
  GroupMemberParamSchema,
} from "../../validation/group.schemas";
import {
  createGroup,
  getGroup,
  updateGroup,
  deleteGroup,
  addMember,
  removeMember,
  leaveGroup,
  changeMemberRole,
} from "../../controllers/group.controller";

const router = Router();
router.use(authenticate);

/** POST   /api/v1/groups                                   — Crea gruppo */
router.post("/",                                     validate("body",   CreateGroupSchema),   createGroup);

/** GET    /api/v1/groups/:groupId                          — Dettaglio gruppo */
router.get("/:groupId",                              validate("params", GroupIdParamSchema),  getGroup);

/** PATCH  /api/v1/groups/:groupId                          — Modifica nome/descrizione (admin) */
router.patch("/:groupId",                            validate("params", GroupIdParamSchema),
                                                     validate("body",   UpdateGroupSchema),   updateGroup);

/** DELETE /api/v1/groups/:groupId                          — Elimina gruppo (admin) */
router.delete("/:groupId",                           validate("params", GroupIdParamSchema),  deleteGroup);

/** POST   /api/v1/groups/:groupId/members                  — Aggiungi membro (admin) */
router.post("/:groupId/members",                     validate("params", GroupIdParamSchema),
                                                     validate("body",   AddMemberSchema),     addMember);

/** POST   /api/v1/groups/:groupId/leave                    — Lascia gruppo */
router.post("/:groupId/leave",                       validate("params", GroupIdParamSchema),  leaveGroup);

/** DELETE /api/v1/groups/:groupId/members/:userId          — Rimuovi membro (admin) */
router.delete("/:groupId/members/:userId",           validate("params", GroupMemberParamSchema), removeMember);

/** PATCH  /api/v1/groups/:groupId/members/:userId/role     — Cambia ruolo (admin) */
router.patch("/:groupId/members/:userId/role",       validate("params", GroupMemberParamSchema),
                                                     validate("body",   ChangeRoleSchema),    changeMemberRole);

export default router;
