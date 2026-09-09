import { router, Stack } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, StyleSheet } from 'react-native';

import { ErrorBanner } from '@/components/error-banner';
import { MaterialForm } from '@/components/material-form';
import { ScreenContainer } from '@/components/screen-container';
import { useAsyncData } from '@/hooks/use-async-data';
import { getCategories } from '@/services/categories-service';
import { getSuppliers } from '@/services/hq-service';
import { createHqMaterial } from '@/services/materials-admin-service';
import { Category, MaterialFormInput, Supplier } from '@/types';
import { toUserMessage } from '@/utils/format-error';

interface FormOptionsData {
  categories: Category[];
  suppliers: Supplier[];
}

const EMPTY_OPTIONS: FormOptionsData = { categories: [], suppliers: [] };

export default function NewHqMaterialScreen() {
  const fetchOptions = useCallback(async (): Promise<FormOptionsData> => {
    const [categories, suppliers] = await Promise.all([getCategories(), getSuppliers()]);
    return { categories, suppliers };
  }, []);
  const { data: options, isLoading, error: loadError, refetch } = useAsyncData<FormOptionsData>(fetchOptions, EMPTY_OPTIONS);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  async function handleSubmit(values: MaterialFormInput) {
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      const material = await createHqMaterial(values);
      router.replace({ pathname: '/(hq)/materials/[materialId]', params: { materialId: material.id } });
    } catch (err) {
      setSubmitError(toUserMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  }

  if (isLoading) {
    return (
      <ScreenContainer contentContainerStyle={styles.centered}>
        <Stack.Screen options={{ title: 'New Material' }} />
        <ActivityIndicator />
      </ScreenContainer>
    );
  }

  if (loadError || options.categories.length === 0 || options.suppliers.length === 0) {
    return (
      <ScreenContainer>
        <Stack.Screen options={{ title: 'New Material' }} />
        <ErrorBanner message={loadError ?? 'No categories or suppliers are available yet.'} onRetry={refetch} />
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer>
      <Stack.Screen options={{ title: 'New Material' }} />
      <MaterialForm
        categories={options.categories}
        suppliers={options.suppliers}
        submitLabel="Create Material"
        isSubmitting={isSubmitting}
        error={submitError}
        onSubmit={handleSubmit}
        initialValues={{
          name: '',
          categoryId: options.categories[0].id,
          supplierId: options.suppliers[0].id,
          unit: 'bag',
          pricePerUnit: 0,
          stockStatus: 'in_stock',
          minOrderQuantity: 0,
          quantityStep: 0,
          estimatedDeliveryDays: '',
          description: '',
          isFeatured: false,
          isActive: true,
        }}
      />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  centered: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
