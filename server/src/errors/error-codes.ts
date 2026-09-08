/**
 * Single source of truth for every stable, machine-readable application error code the API can
 * return. HTTP status and error code are deliberately separate concepts (see utils/app-error.ts
 * and middleware/errorHandler.ts) — the status says what kind of failure this is in HTTP terms,
 * the code says exactly why, and a client should branch on the code, never on the message string.
 *
 * The authentication codes below are pre-existing and load-bearing: the mobile app's session
 * manager and API client already branch on ACCESS_TOKEN_EXPIRED, ACCESS_TOKEN_INVALID, and the
 * REFRESH_TOKEN_* family (see src/services/api-client.ts, src/services/session-manager.ts). They
 * are collected here unchanged, not renamed — this file centralizes them, it does not redefine
 * them.
 */
export const ErrorCode = {
  // --- Authentication ---
  MISSING_TOKEN: 'MISSING_TOKEN',
  ACCESS_TOKEN_INVALID: 'ACCESS_TOKEN_INVALID',
  ACCESS_TOKEN_EXPIRED: 'ACCESS_TOKEN_EXPIRED',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  ACCOUNT_DISABLED: 'ACCOUNT_DISABLED',
  ACCOUNT_NOT_FOUND: 'ACCOUNT_NOT_FOUND',
  REFRESH_TOKEN_INVALID: 'REFRESH_TOKEN_INVALID',
  REFRESH_TOKEN_REUSED: 'REFRESH_TOKEN_REUSED',
  REFRESH_TOKEN_REVOKED: 'REFRESH_TOKEN_REVOKED',
  SESSION_INVALIDATED: 'SESSION_INVALIDATED',

  // --- Authorization ---
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  INSUFFICIENT_ROLE: 'INSUFFICIENT_ROLE',

  // --- Validation ---
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  INVALID_PARAMETER: 'INVALID_PARAMETER',

  // --- Resource (generic — used when no domain-specific code adds real client value) ---
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',

  // --- Business / domain ---
  ORDER_NOT_FOUND: 'ORDER_NOT_FOUND',
  ORDER_INVALID_STATUS_TRANSITION: 'ORDER_INVALID_STATUS_TRANSITION',
  ORDER_CANNOT_BE_CANCELLED: 'ORDER_CANNOT_BE_CANCELLED',
  /** An HQ operational action (log a supplier contact, assign a supplier/driver, log a delivery
   * update) was attempted while the order's current status doesn't support it — e.g. assigning a
   * driver to an order that was just cancelled by a concurrent request. Distinct from
   * ORDER_INVALID_STATUS_TRANSITION, which is specifically about the `status` field's own state
   * machine (see orders.service.ts's ORDER_TRANSITIONS) — this covers the auxiliary actions that
   * don't change `status` themselves but still only make sense for some statuses. */
  ORDER_ACTION_NOT_ALLOWED: 'ORDER_ACTION_NOT_ALLOWED',
  MATERIAL_NOT_FOUND: 'MATERIAL_NOT_FOUND',
  MATERIAL_OUT_OF_STOCK: 'MATERIAL_OUT_OF_STOCK',
  SITE_NOT_FOUND: 'SITE_NOT_FOUND',
  SUPPLIER_NOT_FOUND: 'SUPPLIER_NOT_FOUND',
  PHONE_ALREADY_REGISTERED: 'PHONE_ALREADY_REGISTERED',

  // --- Rate limiting ---
  RATE_LIMITED: 'RATE_LIMITED',

  // --- Idempotency (Phase 2.6.7) ---
  /** Same Idempotency-Key, different request body — see idempotency/idempotency.ts. */
  IDEMPOTENCY_KEY_REUSED: 'IDEMPOTENCY_KEY_REUSED',
  /** Defensive-only: a claimed key was found still 'in_progress' when it should always be
   * 'completed' by the time a conflict is observable (see idempotency-store.ts's comments on why
   * this shouldn't happen in normal operation). */
  IDEMPOTENCY_REQUEST_IN_PROGRESS: 'IDEMPOTENCY_REQUEST_IN_PROGRESS',

  // --- Infrastructure / unexpected ---
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];
