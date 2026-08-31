import { router, Stack, useLocalSearchParams } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { PrimaryButton } from '@/components/primary-button';
import { ScreenContainer } from '@/components/screen-container';
import { StatusBadge } from '@/components/status-badge';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useOrderDraft } from '@/context/order-draft-context';
import { Colors, Spacing } from '@/constants/theme';
import { getCategoryById } from '@/services/categories-service';
import { getMaterialById } from '@/services/materials-service';
import { getSupplierById } from '@/services/suppliers-service';
import { AppIcon, Category, Material, Supplier } from '@/types';
import { formatCurrency } from '@/utils/format-currency';
import { pluralizeUnit } from '@/types/unit';

const TRUCK_ICON: AppIcon = { ios: 'shippingbox.fill', android: 'local_shipping', web: 'local_shipping' };
const STORE_ICON: AppIcon = { ios: 'storefront.fill', android: 'storefront', web: 'storefront' };

export default function MaterialDetailScreen() {
  const { materialId } = useLocalSearchParams<{ materialId: string }>();
  const { startDraft } = useOrderDraft();
  const [material, setMaterial] = useState<Material | null>(null);
  const [category, setCategory] = useState<Category | null>(null);
  const [supplier, setSupplier] = useState<Supplier | null>(null);

  useEffect(() => {
    getMaterialById(materialId).then((result) => {
      setMaterial(result ?? null);
      if (result) {
        getCategoryById(result.categoryId).then((c) => setCategory(c ?? null));
        getSupplierById(result.supplierId).then((s) => setSupplier(s ?? null));
      }
    });
  }, [materialId]);

  if (!material) return null;

  const outOfStock = material.stockStatus === 'out_of_stock';

  return (
    <>
      <Stack.Screen options={{ title: material.name }} />
      <ScreenContainer>
        <ThemedView type="backgroundElement" style={styles.imagePlaceholder}>
          {category && <SymbolView name={category.icon} size={56} tintColor={Colors.textSecondary} />}
        </ThemedView>

        <View style={styles.titleBlock}>
          {category && (
            <ThemedText type="small" themeColor="textSecondary">
              {category.name}
            </ThemedText>
          )}
          <ThemedText type="subtitle">{material.name}</ThemedText>
          <ThemedText type="title" style={styles.price}>
            {formatCurrency(material.pricePerUnit)}
            <ThemedText type="default" themeColor="textSecondary">
              {' '}
              / {pluralizeUnit(material.unit, 1)}
            </ThemedText>
          </ThemedText>
          <StatusBadge stockStatus={material.stockStatus} />
        </View>

        {material.description && <ThemedText type="default">{material.description}</ThemedText>}

        <View style={styles.metaList}>
          {supplier && (
            <View style={styles.metaRow}>
              <SymbolView name={STORE_ICON} size={18} tintColor={Colors.textSecondary} />
              <ThemedText type="small" themeColor="textSecondary">
                Supplied by {supplier.name}, {supplier.locality}
              </ThemedText>
            </View>
          )}
          <View style={styles.metaRow}>
            <SymbolView name={TRUCK_ICON} size={18} tintColor={Colors.textSecondary} />
            <ThemedText type="small" themeColor="textSecondary">
              Estimated delivery: {material.estimatedDeliveryDays}
            </ThemedText>
          </View>
        </View>

        <PrimaryButton
          label={outOfStock ? 'Out of Stock' : 'Request This Material'}
          disabled={outOfStock}
          onPress={() => {
            startDraft(material.id, material.minOrderQuantity);
            router.push({ pathname: '/material/[materialId]/order', params: { materialId: material.id } });
          }}
        />
      </ScreenContainer>
    </>
  );
}

const styles = StyleSheet.create({
  imagePlaceholder: {
    aspectRatio: 16 / 10,
    borderRadius: Spacing.four,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleBlock: {
    gap: Spacing.two,
    alignItems: 'flex-start',
  },
  price: {
    fontSize: 28,
    lineHeight: 34,
  },
  metaList: {
    gap: Spacing.two,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
});
