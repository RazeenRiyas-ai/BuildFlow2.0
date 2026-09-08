import { router, Stack } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { EmptyState } from '@/components/empty-state';
import { ErrorBanner } from '@/components/error-banner';
import { MaterialCard } from '@/components/material-card';
import { ScreenContainer } from '@/components/screen-container';
import { SearchBar } from '@/components/search-bar';
import { Spacing } from '@/constants/theme';
import { useAsyncData } from '@/hooks/use-async-data';
import { getCategories } from '@/services/categories-service';
import { searchMaterials } from '@/services/materials-service';
import { AppIcon, Category, Material } from '@/types';

const SEARCH_ICON: AppIcon = { ios: 'magnifyingglass', android: 'search', web: 'search' };

/** Typing pauses this long before a search actually fires — long enough to collapse a fast typist's
 * whole word into one request, short enough to still feel instant. Not user-configurable, not
 * meant to be. */
const SEARCH_DEBOUNCE_MS = 300;

export default function SearchScreen() {
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');

  // Debounce: only ever updates `debouncedQuery` — the actual fetch trigger below — after typing
  // has paused. The timer is cleared on every keystroke, so a fast typist never fires more than
  // one request for the word they actually finished typing. On mount, `query` and
  // `debouncedQuery` are already equal (both ''), so this never delays the very first load.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  const fetchCategories = useCallback(() => getCategories(), []);
  const { data: categories, error: categoriesError, refetch: refetchCategories } = useAsyncData<Category[]>(
    fetchCategories,
    [],
  );

  // useAsyncData's own request-id guard is what actually solves the stale-response race: this
  // fetcher's identity only changes once debouncedQuery changes, and if a slower, earlier request
  // resolves after a newer one, useAsyncData discards it instead of letting it overwrite the
  // latest results — the latest query always owns what's displayed, regardless of response order.
  const fetchResults = useCallback(() => searchMaterials(debouncedQuery), [debouncedQuery]);
  const { data: results, isLoading, error: resultsError, refetch: refetchResults } = useAsyncData<Material[]>(
    fetchResults,
    [],
  );

  const error = resultsError ?? categoriesError;
  function retry() {
    refetchCategories();
    refetchResults();
  }

  const categoryById = new Map(categories.map((category) => [category.id, category]));

  return (
    <>
      <Stack.Screen options={{ title: 'Search' }} />
      <ScreenContainer>
        <SearchBar variant="input" placeholder="Search materials" value={query} onChangeText={setQuery} autoFocus />

        {error && <ErrorBanner message={error} onRetry={retry} />}

        {!isLoading && !error && results.length === 0 ? (
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
