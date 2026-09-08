import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { StatusColors, Spacing } from '@/constants/theme';
import { OrderStatus, StockStatus } from '@/types';

type Tone = 'positive' | 'caution' | 'negative';

const STOCK_STATUS_MAP: Record<StockStatus, { label: string; tone: Tone }> = {
  in_stock: { label: 'In Stock', tone: 'positive' },
  limited_stock: { label: 'Limited Stock', tone: 'caution' },
  out_of_stock: { label: 'Out of Stock', tone: 'negative' },
};

const ORDER_STATUS_MAP: Record<OrderStatus, { label: string; tone: Tone }> = {
  requested: { label: 'Requested', tone: 'caution' },
  supplier_contacted: { label: 'Contacting Supplier', tone: 'caution' },
  supplier_confirmed: { label: 'Supplier Confirmed', tone: 'positive' },
  supplier_rejected: { label: 'Finding Supplier', tone: 'caution' },
  driver_assigned: { label: 'Driver Assigned', tone: 'positive' },
  out_for_delivery: { label: 'Out for Delivery', tone: 'positive' },
  delivered: { label: 'Delivered', tone: 'positive' },
  cancelled: { label: 'Cancelled', tone: 'negative' },
};

const TONE_COLORS: Record<Tone, { text: string; background: string }> = {
  positive: { text: StatusColors.positive, background: StatusColors.positiveBackground },
  caution: { text: StatusColors.caution, background: StatusColors.cautionBackground },
  negative: { text: StatusColors.negative, background: StatusColors.negativeBackground },
};

interface StatusBadgeProps {
  stockStatus?: StockStatus;
  orderStatus?: OrderStatus;
}

export function StatusBadge({ stockStatus, orderStatus }: StatusBadgeProps) {
  const { label, tone } = stockStatus ? STOCK_STATUS_MAP[stockStatus] : ORDER_STATUS_MAP[orderStatus!];
  const colors = TONE_COLORS[tone];

  return (
    <View style={[styles.badge, { backgroundColor: colors.background }]}>
      <ThemedText type="smallBold" style={{ color: colors.text }}>
        {label}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
    borderRadius: Spacing.two,
    borderCurve: 'continuous',
  },
});
