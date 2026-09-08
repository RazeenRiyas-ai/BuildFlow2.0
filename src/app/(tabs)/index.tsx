import { router } from 'expo-router';
import { useCallback } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { CategoryChip } from '@/components/category-chip';
import { ErrorBanner } from '@/components/error-banner';
import { MaterialCard } from '@/components/material-card';
import { ScreenContainer } from '@/components/screen-container';
import { SearchBar } from '@/components/search-bar';
import { SectionHeader } from '@/components/section-header';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import { useAsyncData } from '@/hooks/use-async-data';
import { getCategories } from '@/services/categories-service';
import { getFeaturedMaterials } from '@/services/materials-service';
import { Category, Material } from '@/types';

interface HomeData {
  categories: Category[];
  featuredMaterials: Material[];
}

const EMPTY_HOME_DATA: HomeData = { categories: [], featuredMaterials: [] };

export default function HomeScreen() {
  const { contractor } = useAuth();

  const fetchHomeData = useCallback(async (): Promise<HomeData> => {
    const [categories, featuredMaterials] = await Promise.all([getCategories(), getFeaturedMaterials()]);
    return { categories, featuredMaterials };
  }, []);

  const { data, error, refetch } = useAsyncData<HomeData>(fetchHomeData, EMPTY_HOME_DATA);
  const { categories, featuredMaterials } = data;

  const categoryById = new Map(categories.map((category) => [category.id, category]));

  return (
    <ScreenContainer edges={['top', 'bottom']}>
      <View style={styles.header}>
        <ThemedText type="small" themeColor="textSecondary">
          Welcome back,
        </ThemedText>
        <ThemedText type="subtitle">{contractor?.name.split(' ')[0] ?? '...'}</ThemedText>
      </View>

      {error && <ErrorBanner message={error} onRetry={refetch} />}

      <SearchBar variant="link" placeholder="Search materials" onPress={() => router.push('/search')} />

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
        {categories.map((category) => (
          <CategoryChip
            key={category.id}
            category={category}
            onPress={() => router.push({ pathname: '/category/[categoryId]', params: { categoryId: category.id } })}
          />
        ))}
      </ScrollView>

      <View style={styles.section}>
        <SectionHeader title="Popular Materials" onViewAll={() => router.push('/search')} />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.railRow}>
          {featuredMaterials.map((material) => {
            const category = categoryById.get(material.categoryId);
            if (!category) return null;
            return (
              <MaterialCard
                key={material.id}
                material={material}
                category={category}
                variant="rail"
                onPress={() => router.push({ pathname: '/material/[materialId]', params: { materialId: material.id } })}
              />
            );
          })}
        </ScrollView>
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: {
    gap: Spacing.half,
  },
  chipRow: {
    gap: Spacing.two,
    paddingRight: Spacing.four,
  },
  section: {
    gap: Spacing.three,
  },
  railRow: {
    gap: Spacing.three,
    paddingRight: Spacing.four,
  },
});
