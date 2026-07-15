import type { AppError } from "../errors/AppError";
import { ERROR_MESSAGES } from "../errors/error-codes";

// ---------------------------------------------------------------------------
// Success responses
// ---------------------------------------------------------------------------

export function successResponse<T>(
  data: T,
  requestId?: string,
): { data: T; meta: { request_id: string | null; timestamp: string } } {
  return {
    data,
    meta: {
      request_id: requestId ?? null,
      timestamp: new Date().toISOString(),
    },
  };
}

export function paginatedResponse<T>(
  data: T[],
  pagination: { cursor: string | null; has_more: boolean; total?: number },
  requestId?: string,
): {
  data: T[];
  pagination: { cursor: string | null; has_more: boolean; total?: number };
  meta: { request_id: string | null; timestamp: string };
} {
  return {
    data,
    pagination,
    meta: {
      request_id: requestId ?? null,
      timestamp: new Date().toISOString(),
    },
  };
}

// ---------------------------------------------------------------------------
// Error responses
// ---------------------------------------------------------------------------

export function errorResponse(
  err: AppError,
  requestId?: string,
): {
  error: {
    code: string;
    message: string;
    field: string | null;
    details: Record<string, unknown> | null;
    docs: string;
  };
  meta: { request_id: string | null; timestamp: string };
} {
  return {
    error: {
      code: err.code,
      message: ERROR_MESSAGES[err.code] ?? err.message,
      field: err.field,
      details: err.details,
      docs: `https://docs.alphachat.app/errors/${err.code}`,
    },
    meta: {
      request_id: requestId ?? null,
      timestamp: new Date().toISOString(),
    },
  };
}
