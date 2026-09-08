import { StyleSheet, View } from 'react-native';

import { StatusBadge } from '@/components/status-badge';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { StatusColors, Spacing } from '@/constants/theme';
import { HqOrderQueueItem } from '@/types';
import { pluralizeUnit } from '@/types/unit';

const ATTENTION_STATUSES = new Set(['requested', 'supplier_rejected']);

interface HqOrderRowProps {
  order: HqOrderQueueItem;
}

export function HqOrderRow({ order }: HqOrderRowProps) {
  const item = order.items[0];
  const needsAttention = ATTENTION_STATUSES.has(order.status);

  return (
    <ThemedView
      type="backgroundElement"
      style={[styles.row, needsAttention && styles.attentionRow]}>
      <View style={styles.header}>
        <ThemedText type="smallBold" numberOfLines={1} style={styles.contractorName}>
          {order.contractorName}
        </ThemedText>
        <StatusBadge orderStatus={order.status} />
      </View>
      <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
        {item.quantity} {pluralizeUnit(item.unit, item.quantity)} · {item.materialName}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
        {order.siteLabel}
      </ThemedText>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  row: {
    gap: Spacing.one,
    padding: Spacing.three,
    borderRadius: Spacing.three,
    borderCurve: 'continuous',
    borderLeftWidth: 4,
    borderLeftColor: 'transparent',
  },
  attentionRow: {
    borderLeftColor: StatusColors.negative,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  contractorName: {
    flex: 1,
  },
});
