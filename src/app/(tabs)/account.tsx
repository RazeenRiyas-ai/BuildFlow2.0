import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { Linking, Pressable, StyleSheet, View } from 'react-native';

import { ScreenContainer } from '@/components/screen-container';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors, Spacing } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import { usePushPermission } from '@/hooks/use-push-permission';
import { AppIcon } from '@/types';

const PERSON_ICON: AppIcon = { ios: 'person.crop.circle.fill', android: 'account_circle', web: 'account_circle' };
const SITE_ICON: AppIcon = { ios: 'mappin.circle.fill', android: 'location_on', web: 'location_on' };
const BELL_ICON: AppIcon = { ios: 'bell.fill', android: 'notifications', web: 'notifications' };
const CHEVRON_ICON: AppIcon = { ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' };

function NotificationsRow() {
  const { status, requestPermission } = usePushPermission();

  if (status === null || status === 'unsupported') return null;

  if (status === 'granted') {
    return (
      <ThemedView type="backgroundElement" style={styles.linkRow}>
        <SymbolView name={BELL_ICON} size={20} tintColor={Colors.text} />
        <ThemedText type="default" style={styles.linkLabel}>
          Notifications
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          On
        </ThemedText>
      </ThemedView>
    );
  }

  // 'denied' means the OS prompt has already been shown and declined — requesting again through
  // our own code can never re-show it (that's an OS-level restriction, not something this app can
  // work around), so the only real action here is deep-linking to this app's OS settings page.
  if (status === 'denied') {
    return (
      <Pressable onPress={() => Linking.openSettings()} style={({ pressed }) => pressed && styles.pressed}>
        <ThemedView type="backgroundElement" style={styles.linkRow}>
          <SymbolView name={BELL_ICON} size={20} tintColor={Colors.text} />
          <View style={styles.linkLabel}>
            <ThemedText type="default">Notifications</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Off — enable in Settings
            </ThemedText>
          </View>
          <SymbolView name={CHEVRON_ICON} size={14} tintColor={Colors.textSecondary} />
        </ThemedView>
      </Pressable>
    );
  }

  return (
    <Pressable onPress={() => requestPermission()} style={({ pressed }) => pressed && styles.pressed}>
      <ThemedView type="backgroundElement" style={styles.linkRow}>
        <SymbolView name={BELL_ICON} size={20} tintColor={Colors.text} />
        <ThemedText type="default" style={styles.linkLabel}>
          Enable Notifications
        </ThemedText>
        <SymbolView name={CHEVRON_ICON} size={14} tintColor={Colors.textSecondary} />
      </ThemedView>
    </Pressable>
  );
}

export default function AccountScreen() {
  const { contractor, logout } = useAuth();

  return (
    <ScreenContainer edges={['top', 'bottom']}>
      <ThemedText type="subtitle">Account</ThemedText>

      <ThemedView type="backgroundElement" style={styles.profileCard}>
        <SymbolView name={PERSON_ICON} size={48} tintColor={Colors.textSecondary} />
        <View style={styles.profileDetails}>
          <ThemedText type="smallBold">{contractor?.name}</ThemedText>
          {contractor?.companyName && (
            <ThemedText type="small" themeColor="textSecondary">
              {contractor.companyName}
            </ThemedText>
          )}
          <ThemedText type="small" themeColor="textSecondary">
            {contractor?.phone}
          </ThemedText>
        </View>
      </ThemedView>

      <Pressable
        onPress={() => router.push('/sites')}
        style={({ pressed }) => pressed && styles.pressed}>
        <ThemedView type="backgroundElement" style={styles.linkRow}>
          <SymbolView name={SITE_ICON} size={20} tintColor={Colors.text} />
          <ThemedText type="default" style={styles.linkLabel}>
            Manage Construction Sites
          </ThemedText>
          <SymbolView name={CHEVRON_ICON} size={14} tintColor={Colors.textSecondary} />
        </ThemedView>
      </Pressable>

      <NotificationsRow />

      <Pressable onPress={() => logout()} style={({ pressed }) => pressed && styles.pressed}>
        <ThemedView type="backgroundElement" style={styles.linkRow}>
          <ThemedText type="default" style={styles.linkLabel}>
            Log Out
          </ThemedText>
        </ThemedView>
      </Pressable>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  profileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.four,
    borderRadius: Spacing.three,
    borderCurve: 'continuous',
  },
  profileDetails: {
    gap: Spacing.half,
  },
  pressed: {
    opacity: 0.7,
  },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    padding: Spacing.three,
    borderRadius: Spacing.three,
    borderCurve: 'continuous',
  },
  linkLabel: {
    flex: 1,
  },
});
