import { router, Stack } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useCallback, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { EmptyState } from '@/components/empty-state';
import { ErrorBanner } from '@/components/error-banner';
import { OrderSummaryRow } from '@/components/order-summary-row';
import { PrimaryButton } from '@/components/primary-button';
import { QuantityStepper } from '@/components/quantity-stepper';
import { ScreenContainer } from '@/components/screen-container';
import { SiteSelector } from '@/components/site-selector';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useCart } from '@/context/cart-context';
import { useOrders } from '@/context/orders-context';
import { useSites } from '@/context/sites-context';
import { Colors, Spacing } from '@/constants/theme';
import { useAsyncData } from '@/hooks/use-async-data';
import { getMaterialById } from '@/services/materials-service';
import { AppIcon, Material } from '@/types';
import { toUserMessage } from '@/utils/format-error';
import { formatCurrency } from '@/utils/format-currency';
import { generateIdempotencyKey } from '@/utils/generate-idempotency-key';
import { pluralizeUnit } from '@/types/unit';

const BOX_ICON: AppIcon = { ios: 'shippingbox.fill', android: 'inventory_2', web: 'inventory_2' };
const REMOVE_ICON: AppIcon = { ios: 'trash', android: 'delete_outline', web: 'delete_outline' };
const EMPTY_MATERIALS_BY_ID: Record<string, Material> = {};

export default function OrderReviewScreen() {
  const { cart, updateQuantity, removeItem, setSite, reset } = useCart();
  const { getSiteById, sites } = useSites();
  const { submitOrder } = useOrders();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submittingRef = useRef(false);
  // Generated once for this submission attempt (on the first tap of Submit) and reused for any
  // retry of that same attempt — a network timeout followed by tapping Submit again must replay
  // the original request server-side, not create a second order. Cleared after a successful
  // submit so a genuinely new order (a new cart) gets its own fresh key. See
  // server/docs/idempotency.md.
  const idempotencyKeyRef = useRef<string | null>(null);

  // Keyed on the actual set of material ids (not cart.items itself) so an in-place quantity edit
  // never re-fetches every material again — only the set of materials in the cart changing does.
  const materialIdsKey = cart.items.map((item) => item.materialId).join(',');
  const fetchMaterials = useCallback(async () => {
    const results = await Promise.all(cart.items.map((item) => getMaterialById(item.materialId)));
    const found: Record<string, Material> = {};
    results.forEach((material) => {
      if (material) found[material.id] = material;
    });
    return found;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [materialIdsKey]);
  const { data: materialsById, isLoading: materialsLoading } = useAsyncData<Record<string, Material>>(
    fetchMaterials,
    EMPTY_MATERIALS_BY_ID,
  );

  const site = cart.siteId ? getSiteById(cart.siteId) : undefined;

  // A material that failed to load (deleted/deactivated between being added and reviewing) is
  // silently excluded from the reviewable/submittable set rather than shown broken — the cart
  // itself still has the stale entry until the contractor removes it or it's dropped at submit
  // time by the same server-side validation every other item goes through.
  const resolvedItems = cart.items
    .map((item) => ({ item, material: materialsById[item.materialId] }))
    .filter((entry): entry is { item: (typeof cart.items)[number]; material: Material } => !!entry.material);

  const total = resolvedItems.reduce((sum, { item, material }) => sum + material.pricePerUnit * item.quantity, 0);

  async function handleSubmit() {
    if (!cart.siteId || resolvedItems.length === 0) return;
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    setError(null);
    if (!idempotencyKeyRef.current) {
      idempotencyKeyRef.current = generateIdempotencyKey();
    }
    try {
      const order = await submitOrder(
        {
          siteId: cart.siteId,
          items: resolvedItems.map(({ item }) => ({ materialId: item.materialId, quantity: item.quantity })),
        },
        idempotencyKeyRef.current,
      );
      idempotencyKeyRef.current = null;
      reset();
      router.replace({ pathname: '/order/[orderId]', params: { orderId: order.id } });
    } catch (err) {
      // Cart is intentionally left untouched here so the contractor can retry without re-entering
      // anything — and idempotencyKeyRef is intentionally left set too, so that retry replays this
      // same attempt server-side instead of starting a new one.
      setError(toUserMessage(err));
    } finally {
      setSubmitting(false);
      submittingRef.current = false;
    }
  }

  if (cart.items.length === 0) {
    return (
      <ScreenContainer edges={['top', 'bottom']}>
        <Stack.Screen options={{ title: 'Your Cart' }} />
        <EmptyState
          icon={BOX_ICON}
          title="Your cart is empty"
          message="Add materials from the catalog to build a request."
          actionLabel="Browse Materials"
          onAction={() => router.dismissAll()}
        />
      </ScreenContainer>
    );
  }

  const canSubmit = !materialsLoading && !!cart.siteId && resolvedItems.length > 0;

  return (
    <>
      <Stack.Screen options={{ title: 'Your Cart' }} />
      <ScreenContainer>
        <View style={styles.section}>
          <ThemedText type="smallBold">Items</ThemedText>
          {resolvedItems.map(({ item, material }) => (
            <ThemedView key={item.materialId} type="backgroundElement" style={styles.itemCard}>
              <View style={styles.itemHeader}>
                <ThemedText type="smallBold" numberOfLines={1} style={styles.itemName}>
                  {material.name}
                </ThemedText>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => removeItem(item.materialId)}
                  style={({ pressed }) => pressed && styles.pressed}>
                  <SymbolView name={REMOVE_ICON} size={18} tintColor={Colors.textSecondary} />
                </Pressable>
              </View>
              <QuantityStepper
                quantity={item.quantity}
                minQuantity={material.minOrderQuantity}
                step={material.quantityStep}
                unit={material.unit}
                onChange={(quantity) => updateQuantity(item.materialId, quantity)}
              />
              <ThemedText type="small" themeColor="textSecondary">
                {formatCurrency(material.pricePerUnit)} / {pluralizeUnit(material.unit, 1)} · {formatCurrency(material.pricePerUnit * item.quantity)}
              </ThemedText>
            </ThemedView>
          ))}
        </View>

        <View style={styles.section}>
          <ThemedText type="smallBold">Delivery Site</ThemedText>
          <SiteSelector sites={sites} selectedSiteId={cart.siteId} onSelect={setSite} onAddNew={() => router.push('/sites/new')} />
        </View>

        <ThemedView type="backgroundElement" style={styles.card}>
          <OrderSummaryRow label="Estimated Total" value={formatCurrency(total)} />
          {site && <OrderSummaryRow label="Delivery Site" value={site.label} subvalue={site.address} />}
        </ThemedView>

        <ThemedText type="small" themeColor="textSecondary">
          This is an estimate based on listed pricing — the supplier will confirm final availability and cost.
        </ThemedText>

        {error && <ErrorBanner message={error} onRetry={handleSubmit} />}

        <View style={styles.actions}>
          <PrimaryButton label="Submit Request" disabled={!canSubmit} loading={submitting} onPress={handleSubmit} />
          <Pressable onPress={() => router.dismissAll()} style={({ pressed }) => pressed && styles.pressed}>
            <ThemedText type="link" themeColor="textSecondary" style={styles.editLink}>
              Add More Materials
            </ThemedText>
          </Pressable>
        </View>
      </ScreenContainer>
    </>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: Spacing.two,
  },
  itemCard: {
    padding: Spacing.three,
    borderRadius: Spacing.three,
    borderCurve: 'continuous',
    gap: Spacing.two,
  },
  itemHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  itemName: {
    flex: 1,
    flexShrink: 1,
  },
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
