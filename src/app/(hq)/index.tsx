import { router, Stack, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { EmptyState } from '@/components/empty-state';
import { ErrorBanner } from '@/components/error-banner';
import { HqOrderRow } from '@/components/hq-order-row';
import { ScreenContainer } from '@/components/screen-container';
import { StatusFilterChip } from '@/components/status-filter-chip';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing, StatusColors } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import { useAsyncData } from '@/hooks/use-async-data';
import { getHqOrders } from '@/services/hq-service';
import { registerForPushNotificationsAsync, registerPushToken } from '@/services/push-service';
import { AppIcon, HqOrderQueueItem, OrderStatus } from '@/types';

const BOX_ICON: AppIcon = { ios: 'shippingbox.fill', android: 'inventory_2', web: 'inventory_2' };
const ATTENTION_STATUSES: OrderStatus[] = ['requested', 'supplier_rejected'];

const FILTERS: { label: string; status: OrderStatus | 'all' }[] = [
  { label: 'All', status: 'all' },
  { label: 'Requested', status: 'requested' },
  { label: 'Contacting Supplier', status: 'supplier_contacted' },
  { label: 'Supplier Confirmed', status: 'supplier_confirmed' },
  { label: 'Finding Supplier', status: 'supplier_rejected' },
  { label: 'Driver Assigned', status: 'driver_assigned' },
  { label: 'Out for Delivery', status: 'out_for_delivery' },
  { label: 'Delivered', status: 'delivered' },
  { label: 'Cancelled', status: 'cancelled' },
];

export default function HqDashboardScreen() {
  const { logout } = useAuth();
  const [filter, setFilter] = useState<OrderStatus | 'all'>('all');

  const fetchOrders = useCallback(() => getHqOrders(), []);
  const { data: orders, isLoading, error, refetch } = useAsyncData<HqOrderQueueItem[]>(fetchOrders, [], { auto: false });

  useFocusEffect(
    useCallback(() => {
      refetch();
    }, [refetch]),
  );

  useEffect(() => {
    registerForPushNotificationsAsync().then((token) => {
      if (token) registerPushToken(token).catch((err) => console.warn('registerPushToken failed:', err));
    });
  }, []);

  const attentionCount = orders.filter((order) => ATTENTION_STATUSES.includes(order.status)).length;
  const visibleOrders = filter === 'all' ? orders : orders.filter((order) => order.status === filter);

  return (
    <>
      <Stack.Screen
        options={{
          headerRight: () => (
            <Pressable onPress={() => logout()}>
              <ThemedText type="link">Log Out</ThemedText>
            </Pressable>
          ),
        }}
      />
      <ScreenContainer>
        <ThemedText type="subtitle">HQ Queue</ThemedText>

        {error && <ErrorBanner message={error} onRetry={refetch} />}

        {attentionCount > 0 && (
          <Pressable
            onPress={() => setFilter(filter === 'requested' ? 'all' : 'requested')}
            style={({ pressed }) => pressed && styles.pressed}>
            <ThemedView type="backgroundElement" style={styles.attentionBanner}>
              <View style={[styles.attentionDot, { backgroundColor: StatusColors.negative }]} />
              <ThemedText type="smallBold">
                {attentionCount} {attentionCount === 1 ? 'request needs' : 'requests need'} attention
              </ThemedText>
            </ThemedView>
          </Pressable>
        )}

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          {FILTERS.map((f) => (
            <StatusFilterChip key={f.status} label={f.label} active={filter === f.status} onPress={() => setFilter(f.status)} />
          ))}
        </ScrollView>

        {!isLoading && !error && visibleOrders.length === 0 && (
          <EmptyState icon={BOX_ICON} title="No requests" message="Nothing matches this filter right now." />
        )}

        <View style={styles.list}>
          {visibleOrders.map((order) => (
            <Pressable
              key={order.id}
              onPress={() => router.push({ pathname: '/(hq)/orders/[orderId]', params: { orderId: order.id } })}
              style={({ pressed }) => pressed && styles.pressed}>
              <HqOrderRow order={order} />
            </Pressable>
          ))}
        </View>
      </ScreenContainer>
    </>
  );
}

const styles = StyleSheet.create({
  attentionBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    padding: Spacing.three,
    borderRadius: Spacing.three,
    borderCurve: 'continuous',
  },
  attentionDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  chipRow: {
    gap: Spacing.two,
    paddingRight: Spacing.four,
  },
  list: {
    gap: Spacing.two,
    paddingBottom: Spacing.four,
  },
  pressed: {
    opacity: 0.7,
  },
});
