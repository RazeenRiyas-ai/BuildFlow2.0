import { router, useFocusEffect } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useCallback, useRef } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { EmptyState } from '@/components/empty-state';
import { ErrorBanner } from '@/components/error-banner';
import { NotificationOptInBanner } from '@/components/notification-opt-in-banner';
import { ScreenContainer } from '@/components/screen-container';
import { StatusBadge } from '@/components/status-badge';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useOrders } from '@/context/orders-context';
import { Colors, Spacing } from '@/constants/theme';
import { AppIcon } from '@/types';
import { pluralizeUnit } from '@/types/unit';

const BOX_ICON: AppIcon = { ios: 'shippingbox.fill', android: 'inventory_2', web: 'inventory_2' };

export default function OrdersScreen() {
  const { orders, isLoading, error, refetch } = useOrders();

  // The provider already fetches once on mount/login — skip that first focus so returning to
  // this tab later (not the initial arrival) is what triggers the refresh, avoiding a duplicate
  // request right after the provider's own load.
  const hasFocusedBefore = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (!hasFocusedBefore.current) {
        hasFocusedBefore.current = true;
        return;
      }
      refetch();
    }, [refetch]),
  );

  if (!isLoading && orders.length === 0 && error) {
    return (
      <ScreenContainer edges={['top', 'bottom']}>
        <ThemedText type="subtitle">Orders</ThemedText>
        <ErrorBanner message={error} onRetry={refetch} />
      </ScreenContainer>
    );
  }

  if (!isLoading && orders.length === 0) {
    return (
      <ScreenContainer edges={['top', 'bottom']}>
        <ThemedText type="subtitle">Orders</ThemedText>
        <EmptyState
          icon={BOX_ICON}
          title="No requests yet"
          message="Materials you request will show up here so you can track their status."
          actionLabel="Browse Materials"
          onAction={() => router.push('/')}
        />
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer edges={['top', 'bottom']}>
      <ThemedText type="subtitle">Orders</ThemedText>
      {error && <ErrorBanner message={error} onRetry={refetch} />}
      <NotificationOptInBanner />
      <View style={styles.list}>
        {orders.map((order) => {
          // A single-item order (still the common case) names its one material directly, exactly
          // as every order row already did; more than one shows a count instead — the date is the
          // only thing that still makes sense to show alongside items from different materials.
          const isSingleItem = order.items.length === 1;
          const title = isSingleItem ? order.items[0].materialName : `${order.items.length} items`;
          const dateLabel = new Date(order.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
          return (
            <Pressable
              key={order.id}
              onPress={() => router.push({ pathname: '/order/[orderId]', params: { orderId: order.id } })}
              style={({ pressed }) => pressed && styles.pressed}>
              <ThemedView type="backgroundElement" style={styles.row}>
                <View style={styles.thumbnail}>
                  <SymbolView name={BOX_ICON} size={22} tintColor={Colors.textSecondary} />
                </View>
                <View style={styles.rowDetails}>
                  <ThemedText type="smallBold" numberOfLines={1}>
                    {title}
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {isSingleItem ? `${order.items[0].quantity} ${pluralizeUnit(order.items[0].unit, order.items[0].quantity)} · ${dateLabel}` : dateLabel}
                  </ThemedText>
                  <StatusBadge orderStatus={order.status} />
                </View>
              </ThemedView>
            </Pressable>
          );
        })}
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: Spacing.two,
  },
  pressed: {
    opacity: 0.7,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: Spacing.three,
    borderCurve: 'continuous',
  },
  thumbnail: {
    width: 48,
    height: 48,
    borderRadius: Spacing.two,
    borderCurve: 'continuous',
    backgroundColor: Colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowDetails: {
    flex: 1,
    gap: Spacing.half,
    alignItems: 'flex-start',
  },
});
