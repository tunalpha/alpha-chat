/**
 * GroupController — strato HTTP per le API Gruppi — Sprint 21.
 */

import type { RequestHandler } from "express";
import * as groupService from "../services/group.service";
import { successResponse } from "../utils/response";
import type {
  CreateGroupInput,
  UpdateGroupInput,
  AddMemberInput,
  ChangeRoleInput,
  GroupIdParam,
  GroupMemberParam,
} from "../validation/group.schemas";

// POST /api/v1/groups
export const createGroup: RequestHandler = async (req, res, next) => {
  try {
    const result = await groupService.createGroup(
      req.user!.userId, req.body as CreateGroupInput, { requestId: req.requestId },
    );
    res.status(201).json(successResponse(result, req.requestId));
  } catch (err) { next(err); }
};

// GET /api/v1/groups/:groupId
export const getGroup: RequestHandler = async (req, res, next) => {
  try {
    const { groupId } = req.params as unknown as GroupIdParam;
    const result = await groupService.getGroupDetail(req.user!.userId, groupId);
    res.status(200).json(successResponse(result, req.requestId));
  } catch (err) { next(err); }
};

// PATCH /api/v1/groups/:groupId
export const updateGroup: RequestHandler = async (req, res, next) => {
  try {
    const { groupId } = req.params as unknown as GroupIdParam;
    const result = await groupService.updateGroup(
      req.user!.userId, groupId, req.body as UpdateGroupInput, { requestId: req.requestId },
    );
    res.status(200).json(successResponse(result, req.requestId));
  } catch (err) { next(err); }
};

// DELETE /api/v1/groups/:groupId
export const deleteGroup: RequestHandler = async (req, res, next) => {
  try {
    const { groupId } = req.params as unknown as GroupIdParam;
    await groupService.deleteGroup(req.user!.userId, groupId, { requestId: req.requestId });
    res.status(200).json(successResponse({ deleted: true }, req.requestId));
  } catch (err) { next(err); }
};

// POST /api/v1/groups/:groupId/members
export const addMember: RequestHandler = async (req, res, next) => {
  try {
    const { groupId } = req.params as unknown as GroupIdParam;
    const result = await groupService.addMember(
      req.user!.userId, groupId, req.body as AddMemberInput, { requestId: req.requestId },
    );
    res.status(201).json(successResponse(result, req.requestId));
  } catch (err) { next(err); }
};

// DELETE /api/v1/groups/:groupId/members/:userId
export const removeMember: RequestHandler = async (req, res, next) => {
  try {
    const { groupId, userId } = req.params as unknown as GroupMemberParam;
    await groupService.removeMember(
      req.user!.userId, groupId, userId, { requestId: req.requestId },
    );
    res.status(200).json(successResponse({ removed: true }, req.requestId));
  } catch (err) { next(err); }
};

// POST /api/v1/groups/:groupId/leave
export const leaveGroup: RequestHandler = async (req, res, next) => {
  try {
    const { groupId } = req.params as unknown as GroupIdParam;
    await groupService.leaveGroup(req.user!.userId, groupId, { requestId: req.requestId });
    res.status(200).json(successResponse({ left: true }, req.requestId));
  } catch (err) { next(err); }
};

// PATCH /api/v1/groups/:groupId/members/:userId/role
export const changeMemberRole: RequestHandler = async (req, res, next) => {
  try {
    const { groupId, userId } = req.params as unknown as GroupMemberParam;
    await groupService.changeRole(
      req.user!.userId, groupId, userId, req.body as ChangeRoleInput,
      { requestId: req.requestId },
    );
    res.status(200).json(successResponse({ updated: true }, req.requestId));
  } catch (err) { next(err); }
};
