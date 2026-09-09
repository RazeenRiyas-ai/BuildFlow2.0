import { useCallback, useEffect, useState } from 'react';

import {
  dismissPushPermissionPrompt,
  getPushPermissionStatus,
  hasPromptedForPushPermission,
  requestPushPermissionAndRegister,
  type PushPermissionStatus,
} from '@/services/push-service';

interface UsePushPermissionResult {
  /** null while the initial check is still in flight. */
  status: PushPermissionStatus | null;
  /** Whether this device has ever been asked (in-app soft prompt shown-and-dismissed, or the real
   * OS prompt shown) — null while still loading. */
  hasPrompted: boolean | null;
  /** Re-reads both values — call after returning to a screen (e.g. from OS Settings). */
  refresh: () => Promise<void>;
  /** Shows the real OS permission dialog if needed, registers on success, and always marks
   * "prompted" afterward. Use only from a deliberate, user-initiated tap. */
  requestPermission: () => Promise<PushPermissionStatus>;
  /** Marks "prompted" without touching OS permission — for a dismissed soft in-app prompt. */
  dismiss: () => Promise<void>;
}

/** Shared contractor-facing push-permission state — backs both the Orders-tab soft opt-in banner
 * and the Account-tab notifications row, so the two can never disagree about current status. */
export function usePushPermission(): UsePushPermissionResult {
  const [status, setStatus] = useState<PushPermissionStatus | null>(null);
  const [hasPrompted, setHasPrompted] = useState<boolean | null>(null);

  // setState calls live inside the .then() callback, never synchronously in `refresh`'s own body —
  // same shape as use-async-data.ts's `run`, which is what keeps calling this directly from a
  // useEffect body lint-clean (see that hook's own comment for the full rationale).
  const refresh = useCallback(() => {
    return Promise.all([getPushPermissionStatus(), hasPromptedForPushPermission()]).then(([nextStatus, prompted]) => {
      setStatus(nextStatus);
      setHasPrompted(prompted);
    });
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const requestPermission = useCallback(async () => {
    const result = await requestPushPermissionAndRegister();
    setStatus(result);
    setHasPrompted(true);
    return result;
  }, []);

  const dismiss = useCallback(async () => {
    await dismissPushPermissionPrompt();
    setHasPrompted(true);
  }, []);

  return { status, hasPrompted, refresh, requestPermission, dismiss };
}
