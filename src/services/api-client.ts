import { getAccessToken, refreshSession } from '@/services/session-manager';
import { fetchWithTimeout } from '@/utils/fetch-with-timeout';

export const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000';

/** Turns a server-relative path (e.g. a material photo's `url` field) into an absolute URL an
 * <Image>/expo-image source can fetch directly, outside of apiClient's own JSON request cycle. */
export function toAbsoluteApiUrl(relativePath: string): string {
  return API_BASE_URL + relativePath;
}

/** The one 401 reason worth retrying after a refresh — see server/src/middleware/auth.ts and
 * server/src/utils/access-token-error.ts. Every other 401 (a malformed/tampered access token,
 * wrong login credentials, a dead refresh token, a disabled account, ...) is a definitive answer
 * about that specific request/credential, not a "your access token expired" signal, and must
 * never trigger a refresh-and-retry cycle. */
const ACCESS_TOKEN_EXPIRED_CODE = 'ACCESS_TOKEN_EXPIRED';

export class ApiError extends Error {
  status: number;
  code?: string;
  details?: unknown;

  constructor(status: number, message: string, code?: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function request<T>(path: string, options: RequestInit = {}, isRetry = false): Promise<T> {
  const token = await getAccessToken();
  // A FormData body (photo uploads — see apiClient.upload) must never get an explicit
  // Content-Type here: fetch/React Native's own multipart encoder sets `multipart/form-data` with
  // the correct boundary itself, and overriding it breaks the upload.
  const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
  const headers: Record<string, string> = {
    ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
    ...(options.headers as Record<string, string> | undefined),
  };
  if (token) {
    headers.Authorization = 'Bearer ' + token;
  }

  const response = await fetchWithTimeout(API_BASE_URL + path, { ...options, headers });

  if (response.status === 204) {
    return undefined as T;
  }

  const body = await response.json().catch(() => null);

  if (!response.ok) {
    // Retry exactly once, and only for the one 401 reason a refresh could actually fix. `isRetry`
    // guards against ever retrying a retry — even if the freshly-refreshed token somehow still
    // gets rejected, this request fails plainly rather than looping.
    if (!isRetry && response.status === 401 && body?.code === ACCESS_TOKEN_EXPIRED_CODE) {
      try {
        await refreshSession();
      } catch {
        // Refresh itself failed — either transiently (network/timeout: the session is preserved,
        // nothing to do but report that THIS request failed) or definitively (session-manager has
        // already cleared storage and fired onSessionEnded, which will transition the app to
        // logged-out state on its own). Either way, this request cannot succeed right now, so
        // surface its original 401 rather than the refresh failure — that's what the caller
        // actually asked for.
        throw new ApiError(response.status, body?.error ?? 'Request failed', body?.code, body?.details);
      }
      return request<T>(path, options, true);
    }

    throw new ApiError(response.status, body?.error ?? 'Request failed', body?.code, body?.details);
  }

  return body as T;
}

export const apiClient = {
  get: <T,>(path: string) => request<T>(path, { method: 'GET' }),
  // `headers` is deliberately opt-in per call, not auto-populated for every POST — only an
  // operation with real idempotency semantics (currently just submitOrder, see
  // orders-service.ts) should ever pass an Idempotency-Key here.
  post: <T,>(path: string, body?: unknown, options?: { headers?: Record<string, string> }) =>
    request<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined, headers: options?.headers }),
  patch: <T,>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PATCH', body: body ? JSON.stringify(body) : undefined }),
  delete: <T,>(path: string) => request<T>(path, { method: 'DELETE' }),
  // Multipart upload (material photo create/replace) — `formData` is sent as-is, never
  // JSON-stringified; see the isFormData branch above for why no Content-Type is set here either.
  upload: <T,>(path: string, formData: FormData, options?: { method?: 'POST' | 'PUT' }) =>
    request<T>(path, { method: options?.method ?? 'POST', body: formData }),
};
