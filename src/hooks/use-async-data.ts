import { useCallback, useEffect, useRef, useState } from 'react';

import { toUserMessage } from '@/utils/format-error';

interface UseAsyncDataOptions {
  /** Fetch once automatically when `fetcher` changes (default true). Set false when the caller
   * wants to be the sole trigger — e.g. driving the fetch entirely from useFocusEffect. */
  auto?: boolean;
}

interface UseAsyncDataResult<T> {
  data: T;
  isLoading: boolean;
  /** Human-readable message, or null if the last request succeeded. Already-loaded `data` is
   * preserved on failure so a background refetch error never wipes a screen that has content. */
  error: string | null;
  refetch: () => Promise<void>;
  setData: React.Dispatch<React.SetStateAction<T>>;
}

/** Shared fetch/loading/error/retry plumbing so every screen doesn't reimplement the same
 * `.then(setX).finally(...)` pattern with no error handling. Stale responses (a slower request
 * that resolves after a newer one was already started) are discarded. */
export function useAsyncData<T>(
  fetcher: () => Promise<T>,
  initialValue: T,
  options: UseAsyncDataOptions = {},
): UseAsyncDataResult<T> {
  const auto = options.auto ?? true;
  const [data, setData] = useState<T>(initialValue);
  const [isLoading, setIsLoading] = useState(auto);
  const [error, setError] = useState<string | null>(null);
  const latestRequestId = useRef(0);

  // Only sets state from within .then/.catch/.finally callbacks — never synchronously at the top
  // of the function — so calling this directly from a useEffect body never triggers the
  // "setState in effect" warning. The initial `isLoading`/`error` values already reflect the
  // pre-fetch state, so nothing needs to be reset before this runs the first time.
  const run = useCallback(() => {
    const requestId = ++latestRequestId.current;
    return fetcher()
      .then((result) => {
        if (latestRequestId.current === requestId) {
          setData(result);
          setError(null);
        }
      })
      .catch((err) => {
        if (latestRequestId.current === requestId) setError(toUserMessage(err));
      })
      .finally(() => {
        if (latestRequestId.current === requestId) setIsLoading(false);
      });
  }, [fetcher]);

  // The externally-facing trigger (retry buttons, useFocusEffect, event handlers) — resetting
  // isLoading/error synchronously here is fine since it's never called from inside an effect body.
  const refetch = useCallback(() => {
    setIsLoading(true);
    setError(null);
    return run();
  }, [run]);

  useEffect(() => {
    if (auto) run();
    // `auto` is a mount-time choice, intentionally excluded so toggling it isn't a supported case.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run]);

  return { data, isLoading, error, refetch, setData };
}
