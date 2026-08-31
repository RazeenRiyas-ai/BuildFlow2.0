import { SymbolView } from 'expo-symbols';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors, Spacing } from '@/constants/theme';
import { AppIcon, ConstructionSite } from '@/types';

const PIN_ICON: AppIcon = { ios: 'mappin.circle.fill', android: 'location_on', web: 'location_on' };
const CHECK_ICON: AppIcon = { ios: 'checkmark.circle.fill', android: 'check_circle', web: 'check_circle' };

interface SiteCardProps {
  site: ConstructionSite;
  selected?: boolean;
  onPress?: () => void;
}

export function SiteCard({ site, selected, onPress }: SiteCardProps) {
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      onPress={onPress}
      style={({ pressed }) => pressed && onPress && styles.pressed}>
      <ThemedView
        type={selected ? 'backgroundSelected' : 'backgroundElement'}
        style={styles.card}>
        <SymbolView name={PIN_ICON} size={20} tintColor={Colors.textSecondary} />
        <View style={styles.textWrapper}>
          <ThemedText type="smallBold">{site.label}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>
            {site.address}
          </ThemedText>
        </View>
        {selected && <SymbolView name={CHECK_ICON} size={20} tintColor={Colors.text} />}
      </ThemedView>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    padding: Spacing.three,
    borderRadius: Spacing.three,
    borderCurve: 'continuous',
  },
  pressed: {
    opacity: 0.7,
  },
  textWrapper: {
    flex: 1,
    gap: Spacing.half,
  },
});
