import { router, Stack, useLocalSearchParams } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ErrorBanner } from '@/components/error-banner';
import { MaterialImage } from '@/components/material-image';
import { PrimaryButton } from '@/components/primary-button';
import { ScreenContainer } from '@/components/screen-container';
import { StatusBadge } from '@/components/status-badge';
import { ThemedText } from '@/components/themed-text';
import { Colors, Spacing } from '@/constants/theme';
import { useAsyncData } from '@/hooks/use-async-data';
import { getCategoryById } from '@/services/categories-service';
import { getMaterialById } from '@/services/materials-service';
import { getSupplierById } from '@/services/suppliers-service';
import { AppIcon, Category, Material, Supplier } from '@/types';
import { formatCurrency } from '@/utils/format-currency';
import { pluralizeUnit } from '@/types/unit';

const TRUCK_ICON: AppIcon = { ios: 'shippingbox.fill', android: 'local_shipping', web: 'local_shipping' };
const STORE_ICON: AppIcon = { ios: 'storefront.fill', android: 'storefront', web: 'storefront' };

interface MaterialDetailData {
  material: Material | null;
  category: Category | null;
  supplier: Supplier | null;
}

const EMPTY_MATERIAL_DETAIL: MaterialDetailData = { material: null, category: null, supplier: null };

export default function MaterialDetailScreen() {
  const { materialId } = useLocalSearchParams<{ materialId: string }>();
  const [selectedPhotoIndex, setSelectedPhotoIndex] = useState(0);

  const fetchMaterialDetail = useCallback(async (): Promise<MaterialDetailData> => {
    const material = await getMaterialById(materialId);
    if (!material) return { material: null, category: null, supplier: null };

    const [category, supplier] = await Promise.all([
      getCategoryById(material.categoryId),
      getSupplierById(material.supplierId),
    ]);
    return { material, category: category ?? null, supplier: supplier ?? null };
  }, [materialId]);

  const { data, isLoading, error, refetch } = useAsyncData<MaterialDetailData>(fetchMaterialDetail, EMPTY_MATERIAL_DETAIL);
  const { material, category, supplier } = data;

  if (isLoading && !material) {
    return (
      <ScreenContainer contentContainerStyle={styles.centeredContent}>
        <ActivityIndicator />
      </ScreenContainer>
    );
  }

  if (error && !material) {
    return (
      <ScreenContainer>
        <Stack.Screen options={{ title: 'Material' }} />
        <ErrorBanner message={error} onRetry={refetch} />
      </ScreenContainer>
    );
  }

  if (!material) {
    return (
      <ScreenContainer>
        <Stack.Screen options={{ title: 'Material' }} />
        <ThemedText type="small" themeColor="textSecondary">
          This material could not be found.
        </ThemedText>
      </ScreenContainer>
    );
  }

  const outOfStock = material.stockStatus === 'out_of_stock';

  return (
    <>
      <Stack.Screen options={{ title: material.name }} />
      <ScreenContainer>
        {error && <ErrorBanner message={error} onRetry={refetch} />}

        <MaterialImage
          imageUrl={(material.photos?.[selectedPhotoIndex] ?? material.photos?.[0])?.url ?? material.imageUrl}
          fallbackIcon={category?.icon ?? { ios: 'shippingbox.fill', android: 'inventory_2', web: 'inventory_2' }}
          iconSize={56}
          style={styles.imagePlaceholder}
        />

        {material.photos && material.photos.length > 1 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.thumbnailRow}>
            {material.photos.map((photo, index) => (
              <Pressable
                key={photo.id}
                accessibilityRole="button"
                onPress={() => setSelectedPhotoIndex(index)}
                style={[styles.thumbnailWrapper, index === selectedPhotoIndex && styles.thumbnailSelected]}>
                <MaterialImage imageUrl={photo.url} fallbackIcon={category?.icon ?? { ios: 'photo', android: 'image', web: 'image' }} style={styles.thumbnail} />
              </Pressable>
            ))}
          </ScrollView>
        )}

        <View style={styles.titleBlock}>
          {category && (
            <ThemedText type="small" themeColor="textSecondary">
              {category.name}
            </ThemedText>
          )}
          <ThemedText type="subtitle">{material.name}</ThemedText>
          <ThemedText type="title" style={styles.price}>
            {formatCurrency(material.pricePerUnit)}
            <ThemedText type="default" themeColor="textSecondary">
              {' '}
              / {pluralizeUnit(material.unit, 1)}
            </ThemedText>
          </ThemedText>
          <StatusBadge stockStatus={material.stockStatus} />
        </View>

        {material.description && <ThemedText type="default">{material.description}</ThemedText>}

        <View style={styles.metaList}>
          {supplier && (
            <View style={styles.metaRow}>
              <SymbolView name={STORE_ICON} size={18} tintColor={Colors.textSecondary} />
              <ThemedText type="small" themeColor="textSecondary">
                Supplied by {supplier.name}, {supplier.locality}
              </ThemedText>
            </View>
          )}
          <View style={styles.metaRow}>
            <SymbolView name={TRUCK_ICON} size={18} tintColor={Colors.textSecondary} />
            <ThemedText type="small" themeColor="textSecondary">
              Estimated delivery: {material.estimatedDeliveryDays}
            </ThemedText>
          </View>
        </View>

        <PrimaryButton
          label={outOfStock ? 'Out of Stock' : 'Request This Material'}
          disabled={outOfStock}
          onPress={() => router.push({ pathname: '/material/[materialId]/order', params: { materialId: material.id } })}
        />
      </ScreenContainer>
    </>
  );
}

const styles = StyleSheet.create({
  centeredContent: {
    // flexGrow (not flex) is what actually centers content vertically inside a ScrollView's
    // contentContainerStyle — it lets the container stretch to fill the viewport when content is
    // shorter than the screen, while still scrolling normally if it's ever taller.
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  imagePlaceholder: {
    aspectRatio: 16 / 10,
    borderRadius: Spacing.four,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbnailRow: {
    gap: Spacing.two,
  },
  thumbnailWrapper: {
    width: 56,
    height: 56,
    borderRadius: Spacing.two,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: 'transparent',
  },
  thumbnailSelected: {
    borderColor: Colors.text,
  },
  thumbnail: {
    flex: 1,
    borderRadius: Spacing.two - 2,
  },
  titleBlock: {
    gap: Spacing.two,
    alignItems: 'flex-start',
  },
  price: {
    fontSize: 28,
    lineHeight: 34,
  },
  metaList: {
    gap: Spacing.two,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
});
