import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { apiClient } from '@/services/api-client';

/**
 * Requests notification permission, sets up the Android channel, and fetches an Expo push
 * token. Returns null on any failure/denial/unsupported-platform (e.g. web, iOS Simulator) —
 * callers should treat a null return as "no push this session," never as an error to surface.
 */
export async function registerForPushNotificationsAsync(): Promise<string | null> {
  if (Platform.OS === 'web') return null;

  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Default',
        importance: Notifications.AndroidImportance.MAX,
      });
    }

    const existing = await Notifications.getPermissionsAsync();
    let status = existing.status;
    if (status !== 'granted') {
      const requested = await Notifications.requestPermissionsAsync();
      status = requested.status;
    }
    if (status !== 'granted') return null;

    const projectId = Constants.expoConfig?.extra?.eas?.projectId;
    if (!projectId) return null;

    const token = await Notifications.getExpoPushTokenAsync({ projectId });
    return token.data;
  } catch (err) {
    console.warn('registerForPushNotificationsAsync failed:', err);
    return null;
  }
}

export async function registerPushToken(expoPushToken: string): Promise<void> {
  await apiClient.post<void>('/push/register', { expoPushToken, platform: Platform.OS });
}

export async function unregisterPushToken(expoPushToken: string): Promise<void> {
  await apiClient.post<void>('/push/unregister', { expoPushToken });
}
