import { ApiError } from '@/services/api-client';

/**
 * Turns a caught error into a short, human-readable message safe to show in the UI.
 * AppError-derived messages from the backend (e.g. "Order not found", "Quantity is below the
 * minimum order quantity") are already human-authored and are passed through as-is. Generic
 * technical labels (raw 500s, validation-error labels) and network-layer failures are replaced
 * with a plain-language message instead. The original error should still be logged by the caller
 * for diagnostics — this function is only for what the user sees.
 */
export function toUserMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status >= 500) {
      return 'The server had a problem handling that. Please try again in a moment.';
    }
    if (err.message === 'ValidationError') {
      return 'Some of the information provided is invalid. Please check and try again.';
    }
    return err.message || 'Something went wrong. Please try again.';
  }
  return "Couldn't connect. Check your internet connection and try again.";
}
