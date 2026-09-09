import { router, Stack, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { EmptyState } from '@/components/empty-state';
import { ErrorBanner } from '@/components/error-banner';
import { HqMaterialRow } from '@/components/hq-material-row';
import { ScreenContainer } from '@/components/screen-container';
import { SearchBar } from '@/components/search-bar';
import { StatusFilterChip } from '@/components/status-filter-chip';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useAsyncData } from '@/hooks/use-async-data';
import { getCategories } from '@/services/categories-service';
import { getHqMaterials } from '@/services/materials-admin-service';
import { AppIcon, Category, HqMaterial } from '@/types';

const BOX_ICON: AppIcon = { ios: 'shippingbox.fill', android: 'inventory_2', web: 'inventory_2' };

export default function HqMaterialsListScreen() {
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [includeInactive, setIncludeInactive] = useState(false);

  const fetchCategories = useCallback(() => getCategories(), []);
  const { data: categories } = useAsyncData<Category[]>(fetchCategories, []);
  const categoryById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);

  const fetchMaterials = useCallback(
    () => getHqMaterials({ q: search.trim() || undefined, categoryId: categoryId ?? undefined, includeInactive }),
    [search, categoryId, includeInactive],
  );
  const { data: materials, isLoading, error, refetch } = useAsyncData<HqMaterial[]>(fetchMaterials, [], { auto: false });

  // Re-runs whenever refetch's identity changes (i.e. whenever search/categoryId/includeInactive
  // change), and also on every screen focus (e.g. returning from creating/editing a material).
  useFocusEffect(
    useCallback(() => {
      refetch();
    }, [refetch]),
  );

  return (
    <>
      <Stack.Screen
        options={{
          headerRight: () => (
            <Pressable onPress={() => router.push('/(hq)/materials/new')}>
              <ThemedText type="link">New</ThemedText>
            </Pressable>
          ),
        }}
      />
      <ScreenContainer>
        <ThemedText type="subtitle">Materials</ThemedText>

        {error && <ErrorBanner message={error} onRetry={refetch} />}

        <SearchBar variant="input" placeholder="Search materials" value={search} onChangeText={setSearch} />

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          <StatusFilterChip label="All categories" active={categoryId === null} onPress={() => setCategoryId(null)} />
          {categories.map((category) => (
            <StatusFilterChip key={category.id} label={category.name} active={categoryId === category.id} onPress={() => setCategoryId(category.id)} />
          ))}
          <StatusFilterChip label="Show inactive" active={includeInactive} onPress={() => setIncludeInactive((v) => !v)} />
        </ScrollView>

        {!isLoading && !error && materials.length === 0 && (
          <EmptyState icon={BOX_ICON} title="No materials found" message="Try a different search or category, or create a new material." />
        )}

        <View style={styles.list}>
          {materials.map((material) => (
            <Pressable
              key={material.id}
              onPress={() => router.push({ pathname: '/(hq)/materials/[materialId]', params: { materialId: material.id } })}
              style={({ pressed }) => pressed && styles.pressed}>
              <HqMaterialRow material={material} category={categoryById.get(material.categoryId)} />
            </Pressable>
          ))}
        </View>
      </ScreenContainer>
    </>
  );
}

const styles = StyleSheet.create({
  chipRow: {
    gap: Spacing.two,
    paddingRight: Spacing.four,
  },
  list: {
    gap: Spacing.two,
    paddingBottom: Spacing.four,
  },
  pressed: {
    opacity: 0.7,
  },
});
