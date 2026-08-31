import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';

interface SectionHeaderProps {
  title: string;
  onViewAll?: () => void;
}

export function SectionHeader({ title, onViewAll }: SectionHeaderProps) {
  return (
    <View style={styles.row}>
      <ThemedText type="subtitle" style={styles.title}>
        {title}
      </ThemedText>
      {onViewAll && (
        <Pressable onPress={onViewAll} hitSlop={Spacing.two}>
          {({ pressed }) => (
            <ThemedText type="link" themeColor="textSecondary" style={pressed && styles.pressed}>
              View All
            </ThemedText>
          )}
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
  },
  title: {
    fontSize: 20,
    lineHeight: 26,
  },
  pressed: {
    opacity: 0.6,
  },
});
