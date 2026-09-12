import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors, Spacing } from '@/constants/theme';
import { Supplier } from '@/types';

interface HqSupplierRowProps {
  supplier: Supplier;
}

export function HqSupplierRow({ supplier }: HqSupplierRowProps) {
  return (
    <ThemedView type="backgroundElement" style={[styles.row, supplier.isActive === false && styles.inactiveRow]}>
      <View style={styles.headerRow}>
        <ThemedText type="smallBold" numberOfLines={1} style={styles.name}>
          {supplier.name}
        </ThemedText>
        {supplier.isActive === false && (
          <View style={styles.inactiveBadge}>
            <ThemedText type="small" themeColor="textSecondary">
              Inactive
            </ThemedText>
          </View>
        )}
      </View>
      <ThemedText type="small" themeColor="textSecondary">
        {supplier.locality}
      </ThemedText>
      {supplier.phone && (
        <ThemedText type="small" themeColor="textSecondary">
          {supplier.phone}
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
