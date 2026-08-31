import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { Pressable, StyleSheet, View } from 'react-native';

import { ScreenContainer } from '@/components/screen-container';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors, Spacing } from '@/constants/theme';
import { MOCK_CONTRACTOR } from '@/data/contractor';
import { AppIcon } from '@/types';

const PERSON_ICON: AppIcon = { ios: 'person.crop.circle.fill', android: 'account_circle', web: 'account_circle' };
const SITE_ICON: AppIcon = { ios: 'mappin.circle.fill', android: 'location_on', web: 'location_on' };
const CHEVRON_ICON: AppIcon = { ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' };

export default function AccountScreen() {
  return (
    <ScreenContainer>
      <ThemedText type="subtitle">Account</ThemedText>

      <ThemedView type="backgroundElement" style={styles.profileCard}>
        <SymbolView name={PERSON_ICON} size={48} tintColor={Colors.textSecondary} />
        <View style={styles.profileDetails}>
          <ThemedText type="smallBold">{MOCK_CONTRACTOR.name}</ThemedText>
          {MOCK_CONTRACTOR.companyName && (
            <ThemedText type="small" themeColor="textSecondary">
              {MOCK_CONTRACTOR.companyName}
            </ThemedText>
          )}
          <ThemedText type="small" themeColor="textSecondary">
            {MOCK_CONTRACTOR.phone}
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
