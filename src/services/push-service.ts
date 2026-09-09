import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { apiClient } from '@/services/api-client';
import { secureStorage } from '@/services/secure-storage';

/** Local (per-device) storage keys. Neither is sensitive, but secureStorage is already the app's
 * one small-key-value primitive (see secure-storage.ts) — no reason to add a second one. */
const LAST_REGISTERED_TOKEN_KEY = 'buildflow.pushToken';
const HAS_PROMPTED_KEY = 'buildflow.pushPermissionPrompted';

/** Test-only: the mocked secureStorage backing these keys (see scripts/test-alias-loader.mjs)
 * lives for the whole test-file run, not per-test, so tests need an explicit way to reset this
 * module's own local state between cases — mirrors the existing resetForTests() convention (see
 * process-safety.ts). Never called from production code. */
export async function __resetPushServiceStateForTests(): Promise<void> {
  await secureStorage.deleteItem(LAST_REGISTERED_TOKEN_KEY);
  await secureStorage.deleteItem(HAS_PROMPTED_KEY);
}

async function setNotificationChannelIfAndroid(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('default', {
    name: 'Default',
    importance: Notifications.AndroidImportance.MAX,
  });
}

async function fetchExpoPushTokenForThisDevice(): Promise<string | null> {
  const projectId = Constants.expoConfig?.extra?.eas?.projectId;
  if (!projectId) return null;
  const token = await Notifications.getExpoPushTokenAsync({ projectId });
  return token.data;
}

/**
 * Requests notification permission, sets up the Android channel, and fetches an Expo push
 * token. Returns null on any failure/denial/unsupported-platform (e.g. web, iOS Simulator) —
 * callers should treat a null return as "no push this session," never as an error to surface.
 *
 * Used as-is by the existing HQ flow ((hq)/index.tsx), unchanged. The contractor flow below is
 * built on top of this rather than duplicating its prompt/token-fetch logic — see
 * requestPushPermissionAndRegister.
 */
export async function registerForPushNotificationsAsync(): Promise<string | null> {
  if (Platform.OS === 'web') return null;

  try {
    await setNotificationChannelIfAndroid();

    const existing = await Notifications.getPermissionsAsync();
    let status = existing.status;
    if (status !== 'granted') {
      const requested = await Notifications.requestPermissionsAsync();
      status = requested.status;
    }
    if (status !== 'granted') return null;

    return await fetchExpoPushTokenForThisDevice();
  } catch (err) {
    console.warn('registerForPushNotificationsAsync failed:', err);
    return null;
  }
}

export async function registerPushToken(expoPushToken: string): Promise<void> {
  await apiClient.post<void>('/push/register', { expoPushToken, platform: Platform.OS });
  // Recorded locally so a later logout can unregister exactly this device's token — never another
  // device belonging to the same user (see unregisterCurrentPushToken).
  await secureStorage.setItem(LAST_REGISTERED_TOKEN_KEY, expoPushToken);
}

export async function unregisterPushToken(expoPushToken: string): Promise<void> {
  await apiClient.post<void>('/push/unregister', { expoPushToken });
}

/**
 * Unregisters THIS device's token only, reading it from local storage rather than trusting any
 * externally-supplied value — a contractor with multiple devices logging out on one must never
 * affect the others. No-ops (not an error) if this device never registered a token this
 * install/session. Never throws: called from logout, which must always complete locally regardless
 * of server/network state (see auth-context.tsx).
 */
export async function unregisterCurrentPushToken(): Promise<void> {
  const token = await secureStorage.getItem(LAST_REGISTERED_TOKEN_KEY);
  if (!token) return;
  try {
    await unregisterPushToken(token);
  } catch (err) {
    console.warn('unregisterCurrentPushToken failed:', err);
  } finally {
    await secureStorage.deleteItem(LAST_REGISTERED_TOKEN_KEY);
  }
}

export type PushPermissionStatus = Notifications.PermissionStatus | 'unsupported';

/** Reads the OS-level permission WITHOUT ever prompting — safe to call on every mount/foreground/
 * login. 'unsupported' is web only; native platforms always resolve to a real PermissionStatus
 * even when running somewhere push can't actually be delivered (e.g. an iOS Simulator), since the
 * permission API itself still works there. */
export async function getPushPermissionStatus(): Promise<PushPermissionStatus> {
  if (Platform.OS === 'web') return 'unsupported';
  try {
    return (await Notifications.getPermissionsAsync()).status;
  } catch {
    return 'unsupported';
  }
}

export async function hasPromptedForPushPermission(): Promise<boolean> {
  return (await secureStorage.getItem(HAS_PROMPTED_KEY)) === 'true';
}

/** Dismissing a soft, in-app "enable notifications?" prompt counts as having been asked — the
 * banner must never reappear just because the user closed it instead of tapping Enable, matching
 * "avoid repeatedly prompting a user who has denied permission." Does not touch the OS-level
 * permission itself, which stays whatever it already was (typically 'undetermined'); the contractor
 * can still turn notifications on later from the Account screen. */
export async function dismissPushPermissionPrompt(): Promise<void> {
  await secureStorage.setItem(HAS_PROMPTED_KEY, 'true');
}

/**
 * The one contractor-facing entry point that can ever show the OS permission dialog — call this
 * only from a deliberate, contextual, user-initiated moment (a tapped "Enable notifications"
 * affordance), never automatically on login/mount. Always marks "prompted" afterward regardless of
 * outcome, so a soft pre-permission UI (see NotificationOptInBanner) knows never to show itself
 * again to a user who has already been asked once — including one who denied.
 */
export async function requestPushPermissionAndRegister(): Promise<PushPermissionStatus> {
  if (Platform.OS === 'web') return 'unsupported';

  const token = await registerForPushNotificationsAsync();
  await secureStorage.setItem(HAS_PROMPTED_KEY, 'true');

  if (!token) {
    return getPushPermissionStatus();
  }

  await registerPushToken(token);
  return Notifications.PermissionStatus.GRANTED;
}

/**
 * Never prompts — safe to call unconditionally on login, session restore, app foreground, and app
 * restart. If permission was already granted in a previous session, (re-)registers the current
 * token: this is what covers a token that rotated since last launch (Expo push tokens can change,
 * e.g. on reinstall) and a user who granted permission from OS Settings after previously declining
 * the in-app prompt — the next foreground/launch after that change silently picks it up with no
 * further prompt. No-ops silently in every other case (not granted, unsupported, any failure).
 */
export async function registerPushTokenIfPermissionGranted(): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    const status = await getPushPermissionStatus();
    if (status !== 'granted') return;
    await setNotificationChannelIfAndroid();
    const token = await fetchExpoPushTokenForThisDevice();
    if (token) await registerPushToken(token);
  } catch (err) {
    console.warn('registerPushTokenIfPermissionGranted failed:', err);
  }
}
