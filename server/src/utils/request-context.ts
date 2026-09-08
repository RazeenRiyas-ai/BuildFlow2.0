import { AsyncLocalStorage } from 'node:async_hooks';

interface RequestContextStore {
  requestId: string;
}

/**
 * Backs request/correlation-ID propagation for both HTTP requests (request-id.ts) and Socket.io
 * event handling (order-room-handlers.ts) without passing requestId through every controller and
 * service function by hand. AsyncLocalStorage automatically carries the store across the whole
 * async call graph started inside runWithRequestId (awaited DB queries, promise chains, the
 * asyncHandler .catch(next) error path) — no manual threading needed.
 */
const asyncLocalStorage = new AsyncLocalStorage<RequestContextStore>();

export function runWithRequestId<T>(requestId: string, fn: () => T): T {
  return asyncLocalStorage.run({ requestId }, fn);
}

export function getRequestId(): string | undefined {
  return asyncLocalStorage.getStore()?.requestId;
}
