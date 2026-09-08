import { Pressable, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';

interface StatusFilterChipProps {
  label: string;
  active: boolean;
  onPress: () => void;
}

export function StatusFilterChip({ label, active, onPress }: StatusFilterChipProps) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => pressed && styles.pressed}>
      <ThemedView type={active ? 'backgroundSelected' : 'backgroundElement'} style={styles.chip}>
        <ThemedText type="small" themeColor={active ? 'text' : 'textSecondary'}>
          {label}
        </ThemedText>
      </ThemedView>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.five,
    borderCurve: 'continuous',
  },
  pressed: {
    opacity: 0.7,
  },
});
