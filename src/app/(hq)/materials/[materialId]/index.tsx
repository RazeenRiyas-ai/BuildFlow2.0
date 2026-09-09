import { Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet } from 'react-native';

import { ErrorBanner } from '@/components/error-banner';
import { MaterialForm } from '@/components/material-form';
import { MaterialPhotoManager } from '@/components/material-photo-manager';
import { ScreenContainer } from '@/components/screen-container';
import { useAsyncData } from '@/hooks/use-async-data';
import { getCategories } from '@/services/categories-service';
import { getSuppliers } from '@/services/hq-service';
import { getHqMaterialById, updateHqMaterial } from '@/services/materials-admin-service';
import { Category, HqMaterial, MaterialFormInput, MaterialPhoto, Supplier } from '@/types';
import { toUserMessage } from '@/utils/format-error';

interface EditData {
  material: HqMaterial | null;
  categories: Category[];
  suppliers: Supplier[];
}

const EMPTY_DATA: EditData = { material: null, categories: [], suppliers: [] };

export default function EditHqMaterialScreen() {
  const { materialId } = useLocalSearchParams<{ materialId: string }>();

  const fetchData = useCallback(async (): Promise<EditData> => {
    const [material, categories, suppliers] = await Promise.all([getHqMaterialById(materialId), getCategories(), getSuppliers()]);
    return { material, categories, suppliers };
  }, [materialId]);
  const { data, isLoading, error, refetch, setData } = useAsyncData<EditData>(fetchData, EMPTY_DATA);
  const { material, categories, suppliers } = data;

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!successMessage) return;
    const timer = setTimeout(() => setSuccessMessage(null), 3000);
    return () => clearTimeout(timer);
  }, [successMessage]);

  async function handleSubmit(values: MaterialFormInput) {
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      const updated = await updateHqMaterial(materialId, values);
      setData((prev) => ({ ...prev, material: updated }));
      setSuccessMessage('Saved');
    } catch (err) {
      setSubmitError(toUserMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  }

  function handlePhotosChange(photos: MaterialPhoto[]) {
    setData((prev) => (prev.material ? { ...prev, material: { ...prev.material, photos } } : prev));
  }

  if (isLoading) {
    return (
      <ScreenContainer contentContainerStyle={styles.centered}>
        <Stack.Screen options={{ title: 'Material' }} />
        <ActivityIndicator />
      </ScreenContainer>
    );
  }

  if (error || !material) {
    return (
      <ScreenContainer>
        <Stack.Screen options={{ title: 'Material' }} />
        <ErrorBanner message={error ?? 'This material could not be found.'} onRetry={refetch} />
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer>
      <Stack.Screen options={{ title: material.name }} />

      <MaterialForm
        categories={categories}
        suppliers={suppliers}
        submitLabel="Save Changes"
        isSubmitting={isSubmitting}
        error={submitError}
        successMessage={successMessage}
        showActiveToggle
        onSubmit={handleSubmit}
        initialValues={{
          name: material.name,
          categoryId: material.categoryId,
          supplierId: material.supplierId,
          unit: material.unit,
          pricePerUnit: material.pricePerUnit,
          stockStatus: material.stockStatus,
          minOrderQuantity: material.minOrderQuantity,
          quantityStep: material.quantityStep,
          estimatedDeliveryDays: material.estimatedDeliveryDays,
          description: material.description ?? '',
          isFeatured: material.isFeatured,
          isActive: material.isActive,
        }}
      />

      <MaterialPhotoManager materialId={material.id} photos={material.photos} onPhotosChange={handlePhotosChange} />
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
