import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';

interface OrderSummaryRowProps {
  label: string;
  value: string;
  subvalue?: string;
}

export function OrderSummaryRow({ label, value, subvalue }: OrderSummaryRowProps) {
  return (
    <View style={styles.row}>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
      <View style={styles.valueWrapper}>
        <ThemedText type="smallBold" style={styles.value}>
          {value}
        </ThemedText>
        {subvalue && (
          <ThemedText type="small" themeColor="textSecondary" style={styles.value}>
            {subvalue}
          </ThemedText>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: Spacing.three,
    paddingVertical: Spacing.two,
  },
  valueWrapper: {
    flex: 1,
    alignItems: 'flex-end',
  },
  value: {
    textAlign: 'right',
  },
});
