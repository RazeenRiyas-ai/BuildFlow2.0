import { Stack, useLocalSearchParams } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { View, StyleSheet } from 'react-native';

import { OrderSummaryRow } from '@/components/order-summary-row';
import { ScreenContainer } from '@/components/screen-container';
import { StatusBadge } from '@/components/status-badge';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useOrders } from '@/context/orders-context';
import { Colors, Spacing } from '@/constants/theme';
import { AppIcon } from '@/types';
import { formatCurrency } from '@/utils/format-currency';
import { pluralizeUnit } from '@/types/unit';

const CHECK_ICON: AppIcon = { ios: 'checkmark.circle.fill', android: 'check_circle', web: 'check_circle' };

export default function OrderStatusScreen() {
  const { orderId } = useLocalSearchParams<{ orderId: string }>();
  const { getOrderById } = useOrders();
  const order = getOrderById(orderId);

  if (!order) return null;

  const item = order.items[0];
  const subtotal = item.pricePerUnit * item.quantity;

  return (
    <>
      <Stack.Screen options={{ title: 'Order Status' }} />
      <ScreenContainer>
        <View style={styles.confirmation}>
          <SymbolView name={CHECK_ICON} size={40} tintColor={Colors.text} />
          <ThemedText type="subtitle" style={styles.centerText}>
            Request Submitted
          </ThemedText>
          <StatusBadge orderStatus={order.status} />
        </View>

        <ThemedView type="backgroundElement" style={styles.card}>
          <OrderSummaryRow label="Material" value={item.materialName} />
          <OrderSummaryRow label="Quantity" value={`${item.quantity} ${pluralizeUnit(item.unit, item.quantity)}`} />
          <OrderSummaryRow label="Estimated Subtotal" value={formatCurrency(subtotal)} />
          <OrderSummaryRow label="Delivery Site" value={order.siteLabel} subvalue={order.siteAddress} />
          <OrderSummaryRow label="Estimated Delivery" value={order.estimatedDeliveryDays} />
          <OrderSummaryRow
            label="Requested On"
            value={new Date(order.createdAt).toLocaleDateString('en-IN', {
              day: 'numeric',
              month: 'short',
              year: 'numeric',
            })}
          />
        </ThemedView>

        <ThemedText type="small" themeColor="textSecondary" style={styles.centerText}>
          The supplier will confirm availability and delivery for this request. You can track its status here
          anytime from Orders.
        </ThemedText>
      </ScreenContainer>
    </>
  );
}

const styles = StyleSheet.create({
  confirmation: {
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.four,
  },
  centerText: {
    textAlign: 'center',
  },
  card: {
    padding: Spacing.three,
    borderRadius: Spacing.three,
    borderCurve: 'continuous',
  },
});
