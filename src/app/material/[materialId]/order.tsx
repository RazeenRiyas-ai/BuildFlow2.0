import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useCallback } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { ErrorBanner } from '@/components/error-banner';
import { PrimaryButton } from '@/components/primary-button';
import { QuantityStepper } from '@/components/quantity-stepper';
import { ScreenContainer } from '@/components/screen-container';
import { SiteSelector } from '@/components/site-selector';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useOrderDraft } from '@/context/order-draft-context';
import { useSites } from '@/context/sites-context';
import { Spacing } from '@/constants/theme';
import { useAsyncData } from '@/hooks/use-async-data';
import { getMaterialById } from '@/services/materials-service';
import { Material } from '@/types';
import { formatCurrency } from '@/utils/format-currency';
import { pluralizeUnit } from '@/types/unit';

export default function MaterialOrderScreen() {
  const { materialId } = useLocalSearchParams<{ materialId: string }>();
  const { draft, setQuantity, setSite } = useOrderDraft();
  const { sites } = useSites();

  const fetchMaterial = useCallback(() => getMaterialById(materialId), [materialId]);
  const { data: material, isLoading, error, refetch } = useAsyncData<Material | undefined>(fetchMaterial, undefined);

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

  const canReview = draft.quantity >= material.minOrderQuantity && !!draft.siteId;

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
            quantity={draft.quantity}
            minQuantity={material.minOrderQuantity}
            step={material.quantityStep}
            unit={material.unit}
            onChange={setQuantity}
          />
          <ThemedText type="small" themeColor="textSecondary">
            Minimum order: {material.minOrderQuantity} {pluralizeUnit(material.unit, material.minOrderQuantity)}
          </ThemedText>
        </View>

        <View style={styles.section}>
          <ThemedText type="smallBold">Delivery Site</ThemedText>
          <SiteSelector
            sites={sites}
            selectedSiteId={draft.siteId}
            onSelect={setSite}
            onAddNew={() => router.push('/sites/new')}
          />
        </View>

        <PrimaryButton label="Review Request" disabled={!canReview} onPress={() => router.push('/order/review')} />
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
