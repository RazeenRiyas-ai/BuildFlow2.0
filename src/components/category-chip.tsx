import { SymbolView } from 'expo-symbols';
import { Pressable, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors, Spacing } from '@/constants/theme';
import { Category } from '@/types';

interface CategoryChipProps {
  category: Category;
  onPress: () => void;
}

export function CategoryChip({ category, onPress }: CategoryChipProps) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => pressed && styles.pressed}>
      <ThemedView type="backgroundElement" style={styles.chip}>
        <SymbolView name={category.icon} size={16} tintColor={Colors.text} />
        <ThemedText type="small">{category.name}</ThemedText>
      </ThemedView>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.five,
    borderCurve: 'continuous',
  },
  pressed: {
    opacity: 0.7,
  },
});
