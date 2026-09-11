import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { ErrorBanner } from '@/components/error-banner';
import { PrimaryButton } from '@/components/primary-button';
import { QuantityStepper } from '@/components/quantity-stepper';
import { ScreenContainer } from '@/components/screen-container';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useCart } from '@/context/cart-context';
import { Spacing } from '@/constants/theme';
import { useAsyncData } from '@/hooks/use-async-data';
import { getMaterialById } from '@/services/materials-service';
import { Material } from '@/types';
import { formatCurrency } from '@/utils/format-currency';
import { pluralizeUnit } from '@/types/unit';

export default function MaterialOrderScreen() {
  const { materialId } = useLocalSearchParams<{ materialId: string }>();
  const { addItem } = useCart();
  // Local to this screen, not the cart — the cart only ever holds a *confirmed* line (added via
  // "Add to Cart" below); nothing here is written to cart state until that tap happens, so
  // navigating away without tapping it leaves the cart untouched. Only ever set by the stepper's
  // own onChange (a real event handler, never an effect) — starts null and falls back to the
  // material's own minimum below, so there's no setState-in-effect needed to seed it once the
  // material finishes loading.
  const [quantityOverride, setQuantityOverride] = useState<number | null>(null);

  const fetchMaterial = useCallback(() => getMaterialById(materialId), [materialId]);
  const { data: material, isLoading, error, refetch } = useAsyncData<Material | undefined>(fetchMaterial, undefined);
  const quantity = quantityOverride ?? material?.minOrderQuantity ?? 0;

  if (isLoading && !material) {
    return (
      <ScreenContainer contentContainerStyle={styles.centeredContent}>
        <ActivityIndicator />
      </ScreenContainer>
    );
  }

  if (error && !material) {
    return (
      <ScreenContainer>
        <Stack.Screen options={{ title: 'Request Details' }} />
        <ErrorBanner message={error} onRetry={refetch} />
      </ScreenContainer>
    );
  }

  if (!material) {
    return (
      <ScreenContainer>
        <Stack.Screen options={{ title: 'Request Details' }} />
        <ThemedText type="small" themeColor="textSecondary">
          This material could not be found.
        </ThemedText>
      </ScreenContainer>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Request Details' }} />
      <ScreenContainer>
        {error && <ErrorBanner message={error} onRetry={refetch} />}

        <ThemedView type="backgroundElement" style={styles.summaryCard}>
          <ThemedText type="smallBold" numberOfLines={1} style={styles.summaryName}>
            {material.name}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {formatCurrency(material.pricePerUnit)} / {pluralizeUnit(material.unit, 1)}
          </ThemedText>
        </ThemedView>

        <View style={styles.section}>
          <ThemedText type="smallBold">Quantity</ThemedText>
          <QuantityStepper
            quantity={quantity}
            minQuantity={material.minOrderQuantity}
            step={material.quantityStep}
            unit={material.unit}
            onChange={setQuantityOverride}
          />
          <ThemedText type="small" themeColor="textSecondary">
            Minimum order: {material.minOrderQuantity} {pluralizeUnit(material.unit, material.minOrderQuantity)}
          </ThemedText>
        </View>

        <PrimaryButton
          label="Add to Cart"
          onPress={() => {
            addItem(material.id, quantity);
            router.push('/order/review');
          }}
        />
      </ScreenContainer>
    </>
  );
}

const styles = StyleSheet.create({
  centeredContent: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  summaryCard: {
    padding: Spacing.three,
    borderRadius: Spacing.three,
    borderCurve: 'continuous',
    gap: Spacing.half,
  },
  summaryName: {
    flexShrink: 1,
  },
  section: {
    gap: Spacing.two,
  },
});
