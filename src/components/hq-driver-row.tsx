import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors, Spacing } from '@/constants/theme';
import { Driver } from '@/types';

interface HqDriverRowProps {
  driver: Driver;
}

export function HqDriverRow({ driver }: HqDriverRowProps) {
  return (
    <ThemedView type="backgroundElement" style={[styles.row, !driver.isActive && styles.inactiveRow]}>
      <View style={styles.headerRow}>
        <ThemedText type="smallBold" numberOfLines={1} style={styles.name}>
          {driver.name}
        </ThemedText>
        {!driver.isActive && (
          <View style={styles.inactiveBadge}>
            <ThemedText type="small" themeColor="textSecondary">
              Inactive
            </ThemedText>
          </View>
        )}
      </View>
      {driver.phone && (
        <ThemedText type="small" themeColor="textSecondary">
          {driver.phone}
        </ThemedText>
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  row: {
    gap: Spacing.half,
    padding: Spacing.three,
    borderRadius: Spacing.three,
    borderCurve: 'continuous',
  },
  inactiveRow: {
    opacity: 0.6,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  name: {
    flex: 1,
  },
  inactiveBadge: {
    paddingHorizontal: Spacing.two,
    paddingVertical: 2,
    borderRadius: Spacing.two,
    borderCurve: 'continuous',
    backgroundColor: Colors.backgroundSelected,
  },
});
