import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { Pressable, StyleSheet, View } from 'react-native';

import { EmptyState } from '@/components/empty-state';
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
  const { orders, isLoading } = useOrders();

  if (!isLoading && orders.length === 0) {
    return (
      <ScreenContainer>
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
    <ScreenContainer>
      <ThemedText type="subtitle">Orders</ThemedText>
      <View style={styles.list}>
        {orders.map((order) => {
          const item = order.items[0];
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
                    {item.materialName}
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {item.quantity} {pluralizeUnit(item.unit, item.quantity)} ·{' '}
                    {new Date(order.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
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
