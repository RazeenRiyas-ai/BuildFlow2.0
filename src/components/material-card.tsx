import { SymbolView } from 'expo-symbols';
import { Pressable, StyleSheet, View } from 'react-native';

import { StatusBadge } from '@/components/status-badge';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors, Spacing } from '@/constants/theme';
import { Category, Material } from '@/types';
import { formatCurrency } from '@/utils/format-currency';
import { pluralizeUnit } from '@/types/unit';

interface MaterialCardProps {
  material: Material;
  category: Category;
  variant?: 'grid' | 'rail';
  onPress: () => void;
}

export function MaterialCard({ material, category, variant = 'grid', onPress }: MaterialCardProps) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [variant === 'rail' ? styles.railCard : styles.gridCard, pressed && styles.pressed]}>
      <ThemedView type="backgroundElement" style={styles.imagePlaceholder}>
        <SymbolView name={category.icon} size={32} tintColor={Colors.textSecondary} />
      </ThemedView>

      <View style={styles.details}>
        <ThemedText type="small" numberOfLines={2}>
          {material.name}
        </ThemedText>
        <ThemedText type="smallBold">
          {formatCurrency(material.pricePerUnit)}
          <ThemedText type="small" themeColor="textSecondary">
            {' '}
            / {pluralizeUnit(material.unit, 1)}
          </ThemedText>
        </ThemedText>
        <StatusBadge stockStatus={material.stockStatus} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  gridCard: {
    flexBasis: '47%',
    flexGrow: 1,
    gap: Spacing.two,
  },
  railCard: {
    width: 160,
    gap: Spacing.two,
  },
  pressed: {
    opacity: 0.75,
  },
  imagePlaceholder: {
    aspectRatio: 1,
    borderRadius: Spacing.three,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
  },
  details: {
    gap: Spacing.half,
    alignItems: 'flex-start',
  },
});
