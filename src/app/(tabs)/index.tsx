import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { CategoryChip } from '@/components/category-chip';
import { MaterialCard } from '@/components/material-card';
import { ScreenContainer } from '@/components/screen-container';
import { SearchBar } from '@/components/search-bar';
import { SectionHeader } from '@/components/section-header';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { MOCK_CONTRACTOR } from '@/data/contractor';
import { FEATURED_MATERIAL_IDS } from '@/data/materials';
import { getCategories } from '@/services/categories-service';
import { getMaterialsByIds } from '@/services/materials-service';
import { Category, Material } from '@/types';

export default function HomeScreen() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [featuredMaterials, setFeaturedMaterials] = useState<Material[]>([]);

  useEffect(() => {
    getCategories().then(setCategories);
    getMaterialsByIds(FEATURED_MATERIAL_IDS).then(setFeaturedMaterials);
  }, []);

  const categoryById = new Map(categories.map((category) => [category.id, category]));

  return (
    <ScreenContainer>
      <View style={styles.header}>
        <ThemedText type="small" themeColor="textSecondary">
          Welcome back,
        </ThemedText>
        <ThemedText type="subtitle">{MOCK_CONTRACTOR.name.split(' ')[0]}</ThemedText>
      </View>

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
