import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { CategoryTile } from '@/components/category-tile';
import { ScreenContainer } from '@/components/screen-container';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { getCategories } from '@/services/categories-service';
import { Category } from '@/types';

export default function CategoriesScreen() {
  const [categories, setCategories] = useState<Category[]>([]);

  useEffect(() => {
    getCategories().then(setCategories);
  }, []);

  return (
    <ScreenContainer>
      <ThemedText type="subtitle">Categories</ThemedText>
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
