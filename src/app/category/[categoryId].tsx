import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useCallback } from 'react';
import { StyleSheet, View } from 'react-native';

import { EmptyState } from '@/components/empty-state';
import { ErrorBanner } from '@/components/error-banner';
import { MaterialCard } from '@/components/material-card';
import { ScreenContainer } from '@/components/screen-container';
import { Spacing } from '@/constants/theme';
import { useAsyncData } from '@/hooks/use-async-data';
import { getCategoryById } from '@/services/categories-service';
import { getMaterialsByCategory } from '@/services/materials-service';
import { Category, CategoryId, Material } from '@/types';

interface CategoryData {
  category: Category | null;
  materials: Material[];
}

const EMPTY_CATEGORY_DATA: CategoryData = { category: null, materials: [] };

export default function CategoryScreen() {
  const { categoryId } = useLocalSearchParams<{ categoryId: CategoryId }>();

  const fetchCategoryData = useCallback(async (): Promise<CategoryData> => {
    const [category, materials] = await Promise.all([getCategoryById(categoryId), getMaterialsByCategory(categoryId)]);
    return { category: category ?? null, materials };
  }, [categoryId]);

  const { data, isLoading, error, refetch } = useAsyncData<CategoryData>(fetchCategoryData, EMPTY_CATEGORY_DATA);
  const { category, materials } = data;

  return (
    <>
      <Stack.Screen options={{ title: category?.name ?? 'Category' }} />
      <ScreenContainer>
        {error && <ErrorBanner message={error} onRetry={refetch} />}

        {!isLoading && category && materials.length === 0 ? (
          <EmptyState icon={category.icon} title="No materials in this category yet" />
        ) : (
          <View style={styles.grid}>
            {category &&
              materials.map((material) => (
                <MaterialCard
                  key={material.id}
                  material={material}
                  category={category}
                  onPress={() =>
                    router.push({ pathname: '/material/[materialId]', params: { materialId: material.id } })
                  }
                />
              ))}
          </View>
        )}
      </ScreenContainer>
    </>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.three,
  },
});
