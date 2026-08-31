import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { EmptyState } from '@/components/empty-state';
import { MaterialCard } from '@/components/material-card';
import { ScreenContainer } from '@/components/screen-container';
import { Spacing } from '@/constants/theme';
import { getCategoryById } from '@/services/categories-service';
import { getMaterialsByCategory } from '@/services/materials-service';
import { Category, CategoryId, Material } from '@/types';

export default function CategoryScreen() {
  const { categoryId } = useLocalSearchParams<{ categoryId: CategoryId }>();
  const [category, setCategory] = useState<Category | null>(null);
  const [materials, setMaterials] = useState<Material[]>([]);

  useEffect(() => {
    getCategoryById(categoryId).then((result) => setCategory(result ?? null));
    getMaterialsByCategory(categoryId).then(setMaterials);
  }, [categoryId]);

  return (
    <>
      <Stack.Screen options={{ title: category?.name ?? 'Category' }} />
      <ScreenContainer>
        {category && materials.length === 0 ? (
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
