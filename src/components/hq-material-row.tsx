import { StyleSheet, View } from 'react-native';

import { MaterialImage } from '@/components/material-image';
import { StatusBadge } from '@/components/status-badge';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors, Spacing } from '@/constants/theme';
import { Category, HqMaterial } from '@/types';
import { formatCurrency } from '@/utils/format-currency';
import { pluralizeUnit } from '@/types/unit';

interface HqMaterialRowProps {
  material: HqMaterial;
  category?: Category;
}

export function HqMaterialRow({ material, category }: HqMaterialRowProps) {
  return (
    <ThemedView type="backgroundElement" style={[styles.row, !material.isActive && styles.inactiveRow]}>
      <MaterialImage
        imageUrl={material.imageUrl}
        fallbackIcon={category?.icon ?? { ios: 'shippingbox.fill', android: 'inventory_2', web: 'inventory_2' }}
        style={styles.image}
      />
      <View style={styles.details}>
        <View style={styles.headerRow}>
          <ThemedText type="smallBold" numberOfLines={1} style={styles.name}>
            {material.name}
          </ThemedText>
          {!material.isActive && (
            <View style={styles.inactiveBadge}>
              <ThemedText type="small" themeColor="textSecondary">
                Inactive
              </ThemedText>
            </View>
          )}
        </View>
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
          {category?.name ?? material.categoryId} · {formatCurrency(material.pricePerUnit)} / {pluralizeUnit(material.unit, 1)}
        </ThemedText>
        <View style={styles.badgeRow}>
          <StatusBadge stockStatus={material.stockStatus} />
          {material.isFeatured && (
            <ThemedText type="small" themeColor="textSecondary">
              Featured
            </ThemedText>
          )}
        </View>
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: Spacing.three,
    borderCurve: 'continuous',
  },
  inactiveRow: {
    opacity: 0.6,
  },
  image: {
    width: 56,
    height: 56,
    borderRadius: Spacing.two,
    borderCurve: 'continuous',
  },
  details: {
    flex: 1,
    gap: Spacing.half,
    justifyContent: 'center',
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
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
});
