/** Without this, a request to an unreachable or silently-hanging host (a dead LAN IP, a dropped
 * connection with no RST) never resolves *or* rejects — fetch just hangs forever. Depending on the
 * caller, that means a screen stuck loading forever with no ErrorBanner, or — for the session
 * bootstrap/logout calls in session-manager.ts — the entire app stuck on the splash screen forever
 * with no way for the user to recover short of force-quitting. Aborting after this long turns that
 * into an ordinary caught error instead.
 *
 * Lives outside api-client.ts (rather than being imported from it) because session-manager.ts's
 * two raw fetch() calls deliberately avoid importing api-client.ts at all — see the comments on
 * performRefresh() and revokeOnServer() for why. */
export const DEFAULT_FETCH_TIMEOUT_MS = 15000;

export function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number = DEFAULT_FETCH_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(timeoutId));
}
