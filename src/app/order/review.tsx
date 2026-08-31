import { router, Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { OrderSummaryRow } from '@/components/order-summary-row';
import { PrimaryButton } from '@/components/primary-button';
import { ScreenContainer } from '@/components/screen-container';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useOrderDraft } from '@/context/order-draft-context';
import { useOrders } from '@/context/orders-context';
import { useSites } from '@/context/sites-context';
import { Spacing } from '@/constants/theme';
import { getMaterialById } from '@/services/materials-service';
import { Material } from '@/types';
import { formatCurrency } from '@/utils/format-currency';
import { pluralizeUnit } from '@/types/unit';

export default function OrderReviewScreen() {
  const { draft, reset } = useOrderDraft();
  const { getSiteById } = useSites();
  const { submitOrder } = useOrders();
  const [material, setMaterial] = useState<Material | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (draft.materialId) getMaterialById(draft.materialId).then((result) => setMaterial(result ?? null));
  }, [draft.materialId]);

  const site = draft.siteId ? getSiteById(draft.siteId) : undefined;

  if (!material || !site || !draft.materialId || !draft.siteId) return null;

  const subtotal = material.pricePerUnit * draft.quantity;

  async function handleSubmit() {
    if (!draft.materialId || !draft.siteId) return;
    setSubmitting(true);
    const order = await submitOrder({ materialId: draft.materialId, quantity: draft.quantity, siteId: draft.siteId });
    reset();
    router.replace({ pathname: '/order/[orderId]', params: { orderId: order.id } });
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Review Request' }} />
      <ScreenContainer>
        <ThemedView type="backgroundElement" style={styles.card}>
          <OrderSummaryRow label="Material" value={material.name} />
          <OrderSummaryRow label="Quantity" value={`${draft.quantity} ${pluralizeUnit(material.unit, draft.quantity)}`} />
          <OrderSummaryRow
            label="Estimated Subtotal"
            value={formatCurrency(subtotal)}
            subvalue={`${formatCurrency(material.pricePerUnit)} / ${pluralizeUnit(material.unit, 1)}`}
          />
          <OrderSummaryRow label="Delivery Site" value={site.label} subvalue={site.address} />
          <OrderSummaryRow label="Estimated Delivery" value={material.estimatedDeliveryDays} />
        </ThemedView>

        <ThemedText type="small" themeColor="textSecondary">
          This is an estimate based on listed pricing — the supplier will confirm final availability and cost.
        </ThemedText>

        <View style={styles.actions}>
          <PrimaryButton label="Submit Request" loading={submitting} onPress={handleSubmit} />
          <Pressable onPress={() => router.back()} style={({ pressed }) => pressed && styles.pressed}>
            <ThemedText type="link" themeColor="textSecondary" style={styles.editLink}>
              Edit
            </ThemedText>
          </Pressable>
        </View>
      </ScreenContainer>
    </>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: Spacing.three,
    borderRadius: Spacing.three,
    borderCurve: 'continuous',
  },
  actions: {
    gap: Spacing.three,
    alignItems: 'center',
  },
  pressed: {
    opacity: 0.6,
  },
  editLink: {
    textAlign: 'center',
  },
});
