import { SymbolView } from 'expo-symbols';
import { Pressable, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors, Spacing } from '@/constants/theme';
import { Category } from '@/types';

interface CategoryTileProps {
  category: Category;
  onPress: () => void;
}

export function CategoryTile({ category, onPress }: CategoryTileProps) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.tile, pressed && styles.pressed]}>
      <ThemedView type="backgroundElement" style={styles.iconCircle}>
        <SymbolView name={category.icon} size={24} tintColor={Colors.text} />
      </ThemedView>
      <ThemedText type="small" style={styles.label} numberOfLines={2}>
        {category.name}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tile: {
    flexBasis: '25%',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.two,
  },
  pressed: {
    opacity: 0.7,
  },
  iconCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    textAlign: 'center',
  },
});
