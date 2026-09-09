import { SymbolView } from 'expo-symbols';
import { Pressable, StyleSheet, View } from 'react-native';

import { PrimaryButton } from '@/components/primary-button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors, Spacing } from '@/constants/theme';
import { usePushPermission } from '@/hooks/use-push-permission';
import { AppIcon } from '@/types';

const BELL_ICON: AppIcon = { ios: 'bell.badge.fill', android: 'notifications', web: 'notifications' };
const CLOSE_ICON: AppIcon = { ios: 'xmark', android: 'close', web: 'close' };

/**
 * Soft, contextual pre-permission ask — shown at most once, only to a contractor who has never
 * been asked before and doesn't already have notifications granted or denied. Never shows the real
 * OS permission dialog itself; that only happens if the contractor taps "Enable" (see
 * usePushPermission's requestPermission, which is what push-service.ts's
 * requestPushPermissionAndRegister ultimately calls). Dismissing it — or tapping Enable and
 * being denied — both mark this device as "asked" so it never reappears; a durable "Enable
 * Notifications" control remains available from the Account screen either way.
 */
export function NotificationOptInBanner() {
  const { status, hasPrompted, requestPermission, dismiss } = usePushPermission();

  if (status === null || hasPrompted === null) return null;
  if (hasPrompted || status !== 'undetermined') return null;

  return (
    <ThemedView type="backgroundElement" style={styles.container}>
      <SymbolView name={BELL_ICON} size={22} tintColor={Colors.text} />
      <View style={styles.textBlock}>
        <ThemedText type="smallBold">Stay updated on your requests</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Get notified when a supplier confirms, a driver is assigned, or your materials are delivered.
        </ThemedText>
        <PrimaryButton label="Enable Notifications" onPress={() => requestPermission()} />
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel="Dismiss" hitSlop={8} onPress={() => dismiss()}>
        <SymbolView name={CLOSE_ICON} size={16} tintColor={Colors.textSecondary} />
      </Pressable>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: Spacing.three,
    borderCurve: 'continuous',
    alignItems: 'flex-start',
  },
  textBlock: {
    flex: 1,
    gap: Spacing.two,
  },
});
