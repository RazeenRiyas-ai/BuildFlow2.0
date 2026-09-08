import { router } from 'expo-router';
import { useCallback } from 'react';
import { StyleSheet, View } from 'react-native';

import { CategoryTile } from '@/components/category-tile';
import { ErrorBanner } from '@/components/error-banner';
import { ScreenContainer } from '@/components/screen-container';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useAsyncData } from '@/hooks/use-async-data';
import { getCategories } from '@/services/categories-service';
import { Category } from '@/types';

export default function CategoriesScreen() {
  const fetchCategories = useCallback(() => getCategories(), []);
  const { data: categories, error, refetch } = useAsyncData<Category[]>(fetchCategories, []);

  return (
    <ScreenContainer edges={['top', 'bottom']}>
      <ThemedText type="subtitle">Categories</ThemedText>
      {error && <ErrorBanner message={error} onRetry={refetch} />}
      <View style={styles.grid}>
        {categories.map((category) => (
          <CategoryTile
            key={category.id}
            category={category}
            onPress={() => router.push({ pathname: '/category/[categoryId]', params: { categoryId: category.id } })}
          />
        ))}
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: Spacing.three,
  },
});
