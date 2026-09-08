import { ErrorCode } from '../errors/error-codes';

export class AppError extends Error {
  statusCode: number;
  /** Machine-readable discriminator (e.g. 'REFRESH_TOKEN_REUSED') for clients that need to branch
   * on the specific failure reason rather than pattern-match the human-readable message. Optional
   * and additive — existing throws with no code keep working exactly as before. See
   * errors/error-codes.ts for the full taxonomy. */
  code?: string;
  /** Safe, client-facing structured context (e.g. { field: 'quantity' }) — never put a stack
   * trace, raw database error, or anything sensitive here; it is serialized straight into the API
   * response. */
  details?: unknown;

  constructor(statusCode: number, message: string, code?: string, details?: unknown) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

/**
 * Every subclass below now defaults to a stable generic code instead of `undefined` when a call
 * site doesn't pass one — Phase 2.6.5's taxonomy goal is that every EXPECTED error has a code, not
 * just the ones a call site happened to tag. Passing an explicit code (as most call sites already
 * do, e.g. 'ORDER_NOT_FOUND') still always wins; this only changes what happens when none is given.
 */
export class NotFoundError extends AppError {
  constructor(message = 'Not found', code: string = ErrorCode.NOT_FOUND, details?: unknown) {
    super(404, message, code, details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized', code: string = ErrorCode.UNAUTHORIZED, details?: unknown) {
    super(401, message, code, details);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden', code: string = ErrorCode.FORBIDDEN, details?: unknown) {
    super(403, message, code, details);
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Conflict', code: string = ErrorCode.CONFLICT, details?: unknown) {
    super(409, message, code, details);
  }
}
