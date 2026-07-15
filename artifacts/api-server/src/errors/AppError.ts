export class AppError extends Error {
  public readonly code: string;
  public readonly httpStatus: number;
  public readonly field: string | null;
  public readonly details: Record<string, unknown> | null;

  constructor(
    code: string,
    httpStatus: number,
    field?: string,
    details?: Record<string, unknown>,
  ) {
    super(code);
    this.name = "AppError";
    this.code = code;
    this.httpStatus = httpStatus;
    this.field = field ?? null;
    this.details = details ?? null;

    // Preserve stack trace in V8
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, AppError);
    }
  }
}
