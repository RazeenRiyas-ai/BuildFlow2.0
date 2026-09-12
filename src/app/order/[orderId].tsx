import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useCallback, useRef, useState } from 'react';
import { View, StyleSheet } from 'react-native';

import { EmptyState } from '@/components/empty-state';
import { ErrorBanner } from '@/components/error-banner';
import { OrderSummaryRow } from '@/components/order-summary-row';
import { PrimaryButton } from '@/components/primary-button';
import { ScreenContainer } from '@/components/screen-container';
import { StatusBadge } from '@/components/status-badge';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useOrders } from '@/context/orders-context';
import { Colors, Spacing } from '@/constants/theme';
import { useAsyncData } from '@/hooks/use-async-data';
import { useOrderRoom } from '@/hooks/use-order-room';
import { getOrderById } from '@/services/orders-service';
import { AppIcon, OrderDetail, OrderStatus } from '@/types';
import { toUserMessage } from '@/utils/format-error';
import { formatCurrency } from '@/utils/format-currency';
import { pluralizeUnit } from '@/types/unit';

const CHECK_ICON: AppIcon = { ios: 'checkmark.circle.fill', android: 'check_circle', web: 'check_circle' };
const BOX_ICON: AppIcon = { ios: 'shippingbox.fill', android: 'local_shipping', web: 'local_shipping' };

const STATUS_COPY: Record<OrderStatus, { headline: string; subtext: string }> = {
  requested: {
    headline: 'Request Submitted',
    subtext: 'HQ will contact a supplier to confirm availability and delivery for this request.',
  },
  supplier_contacted: {
    headline: 'Contacting Supplier',
    subtext: 'HQ has reached out to a supplier and is waiting on confirmation.',
  },
  supplier_confirmed: {
    headline: 'Supplier Confirmed',
    subtext: 'The supplier confirmed this order. A driver will be assigned next.',
  },
  supplier_rejected: {
    headline: 'Finding Another Supplier',
    subtext: 'The first supplier could not fulfill this order. HQ is contacting another one.',
  },
  driver_assigned: {
    headline: 'Driver Assigned',
    subtext: 'A driver has been assigned and will be out for delivery shortly.',
  },
  out_for_delivery: {
    headline: 'Out for Delivery',
    subtext: 'Your order is on its way to the delivery site.',
  },
  delivered: {
    headline: 'Delivered',
    subtext: 'This order has been delivered.',
  },
  cancelled: {
    headline: 'Request Cancelled',
    subtext: 'This request was cancelled and will not be fulfilled.',
  },
};

const HISTORY_LABELS: Record<string, string> = {
  status_change: 'Status Updated',
  supplier_contact: 'Supplier Contacted',
  supplier_assigned: 'Supplier Assigned',
  driver_assigned: 'Driver Assigned',
  delivery_update: 'Delivery Update',
};

export default function OrderStatusScreen() {
  const { orderId } = useLocalSearchParams<{ orderId: string }>();
  const { cancelOrder } = useOrders();
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const cancellingRef = useRef(false);

  const fetchOrder = useCallback(() => getOrderById(orderId).then((result) => result ?? null), [orderId]);
  const { data: order, isLoading, error, refetch } = useAsyncData<OrderDetail | null>(fetchOrder, null, { auto: false });

  useFocusEffect(
    useCallback(() => {
      refetch();
    }, [refetch]),
  );

  useOrderRoom(orderId, refetch);

  async function handleCancel() {
    if (cancellingRef.current) return;
    cancellingRef.current = true;
    setCancelling(true);
    setCancelError(null);
    try {
      await cancelOrder(orderId);
      await refetch();
    } catch (err) {
      setCancelError(toUserMessage(err));
    } finally {
      setCancelling(false);
      cancellingRef.current = false;
    }
  }

  if (isLoading && !order) return null;

  if (error && !order) {
    return (
      <ScreenContainer>
        <Stack.Screen options={{ title: 'Order Status' }} />
        <ErrorBanner message={error} onRetry={refetch} />
      </ScreenContainer>
    );
  }

  if (!order) {
    return (
      <ScreenContainer>
        <Stack.Screen options={{ title: 'Order Status' }} />
        <EmptyState
          icon={BOX_ICON}
          title="Order not found"
          message="This request may have been removed."
          actionLabel="Back to Orders"
          onAction={() => router.replace('/orders')}
        />
      </ScreenContainer>
    );
  }

  const total = order.items.reduce((sum, item) => sum + item.pricePerUnit * item.quantity, 0);
  const copy = STATUS_COPY[order.status];
  const canCancel = order.status === 'requested';

  return (
    <>
      <Stack.Screen options={{ title: 'Order Status' }} />
      <ScreenContainer>
        {error && <ErrorBanner message={error} onRetry={refetch} />}

        <View style={styles.confirmation}>
          <SymbolView name={order.status === 'delivered' ? CHECK_ICON : BOX_ICON} size={40} tintColor={Colors.text} />
          <ThemedText type="subtitle" style={styles.centerText}>
            {copy.headline}
          </ThemedText>
          <StatusBadge orderStatus={order.status} />
        </View>

        <ThemedView type="backgroundElement" style={styles.card}>
          {order.items.map((orderItem, index) => (
            <OrderSummaryRow
              key={`${orderItem.materialName}-${index}`}
              label={orderItem.materialName}
              value={`${orderItem.quantity} ${pluralizeUnit(orderItem.unit, orderItem.quantity)}`}
            />
          ))}
          <OrderSummaryRow label="Estimated Total" value={formatCurrency(total)} />
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
          {order.driverName && <OrderSummaryRow label="Driver" value={order.driverName} subvalue={order.driverPhone} />}
        </ThemedView>

        <ThemedText type="small" themeColor="textSecondary" style={styles.centerText}>
          {copy.subtext}
        </ThemedText>

        {order.history.length > 0 && (
          <ThemedView type="backgroundElement" style={styles.historyCard}>
            <ThemedText type="smallBold">Status History</ThemedText>
            {order.history.map((entry) => (
              <View key={entry.id} style={styles.historyEntry}>
                <View style={styles.historyRowTop}>
                  <ThemedText type="small">{HISTORY_LABELS[entry.type] ?? entry.type}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {new Date(entry.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                  </ThemedText>
                </View>
                {entry.contactMethod && (
                  <ThemedText type="small" themeColor="textSecondary">
                    {entry.contactMethod} · {entry.outcome}
                  </ThemedText>
                )}
                {entry.note && (
                  <ThemedText type="small" themeColor="textSecondary">
                    {entry.note}
                  </ThemedText>
                )}
              </View>
            ))}
          </ThemedView>
        )}

        {cancelError && <ErrorBanner message={cancelError} onRetry={handleCancel} />}

        {canCancel && (
          <PrimaryButton label="Cancel Request" variant="outline" loading={cancelling} onPress={handleCancel} />
        )}
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
  historyCard: {
    padding: Spacing.three,
    borderRadius: Spacing.three,
    borderCurve: 'continuous',
    gap: Spacing.two,
  },
  historyRowTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  historyEntry: {
    gap: Spacing.half,
    paddingVertical: Spacing.half,
  },
});
