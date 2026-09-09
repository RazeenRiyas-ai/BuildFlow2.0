import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

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

  // useFocusEffect (not a plain mount-only useEffect) so status is re-read every time a consuming
  // screen regains focus, not just on first mount — expo-router's tab screens stay mounted across
  // tab switches, so a plain useEffect here would never notice a permission change made from OS
  // Settings (Linking.openSettings()) after the user taps back into the app. Same pattern already
  // used by (tabs)/orders/index.tsx, order/[orderId].tsx, and (hq)/index.tsx for the equivalent
  // "refresh when this screen comes back into view" need.
  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  // Covers the gap useFocusEffect can't: returning from the OS notification-settings screen while
  // the SAME route stays focused the whole time (no navigation focus change ever fires) — e.g.
  // Account row -> Linking.openSettings() -> toggle permission -> back, without switching tabs.
  // Same background->foreground transition-detection shape as auth-context.tsx's own AppState
  // listener (a distinct concern — session refresh + push-token re-registration — so this is a
  // second, independent subscription rather than a shared one; AppState.addEventListener supports
  // any number of independent listeners, same as multiple screens each having their own
  // useFocusEffect). Every consuming component gets its own listener tied to its own hook instance,
  // matching how useFocusEffect above is already per-instance.
  useEffect(() => {
    let previousAppState = AppState.currentState;

    const subscription = AppState.addEventListener('change', (nextAppState: AppStateStatus) => {
      const cameToForeground = /inactive|background/.test(previousAppState) && nextAppState === 'active';
      previousAppState = nextAppState;
      if (cameToForeground) refresh();
    });

    return () => subscription.remove();
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
