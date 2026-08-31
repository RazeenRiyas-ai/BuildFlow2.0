import { router, Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { EmptyState } from '@/components/empty-state';
import { MaterialCard } from '@/components/material-card';
import { ScreenContainer } from '@/components/screen-container';
import { SearchBar } from '@/components/search-bar';
import { Spacing } from '@/constants/theme';
import { getCategories } from '@/services/categories-service';
import { searchMaterials } from '@/services/materials-service';
import { AppIcon, Category, Material } from '@/types';

const SEARCH_ICON: AppIcon = { ios: 'magnifyingglass', android: 'search', web: 'search' };

export default function SearchScreen() {
  const [query, setQuery] = useState('');
  const [categories, setCategories] = useState<Category[]>([]);
  const [results, setResults] = useState<Material[]>([]);

  useEffect(() => {
    getCategories().then(setCategories);
  }, []);

  useEffect(() => {
    searchMaterials(query).then(setResults);
  }, [query]);

  const categoryById = new Map(categories.map((category) => [category.id, category]));

  return (
    <>
      <Stack.Screen options={{ title: 'Search' }} />
      <ScreenContainer>
        <SearchBar variant="input" placeholder="Search materials" value={query} onChangeText={setQuery} autoFocus />

        {results.length === 0 ? (
          <EmptyState icon={SEARCH_ICON} title="No materials found" message="Try a different search term." />
        ) : (
          <View style={styles.grid}>
            {results.map((material) => {
              const category = categoryById.get(material.categoryId);
              if (!category) return null;
              return (
                <MaterialCard
                  key={material.id}
                  material={material}
                  category={category}
                  onPress={() =>
                    router.push({ pathname: '/material/[materialId]', params: { materialId: material.id } })
                  }
                />
              );
            })}
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
