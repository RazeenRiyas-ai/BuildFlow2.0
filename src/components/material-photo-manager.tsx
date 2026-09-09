import * as ImagePicker from 'expo-image-picker';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, View } from 'react-native';

import { ErrorBanner } from '@/components/error-banner';
import { MaterialImage } from '@/components/material-image';
import { PrimaryButton } from '@/components/primary-button';
import { ThemedText } from '@/components/themed-text';
import { Colors, Spacing, StatusColors } from '@/constants/theme';
import {
  deleteMaterialPhoto,
  PickedPhotoAsset,
  replaceMaterialPhoto,
  reorderMaterialPhotos,
  setPrimaryMaterialPhoto,
  uploadMaterialPhoto,
} from '@/services/materials-admin-service';
import { ApiError } from '@/services/api-client';
import { AppIcon, MaterialPhoto } from '@/types';
import { toUserMessage } from '@/utils/format-error';

const STAR_ICON: AppIcon = { ios: 'star.fill', android: 'star', web: 'star' };
const STAR_OUTLINE_ICON: AppIcon = { ios: 'star', android: 'star_border', web: 'star_border' };
const REPLACE_ICON: AppIcon = { ios: 'arrow.triangle.2.circlepath', android: 'sync', web: 'sync' };
const DELETE_ICON: AppIcon = { ios: 'trash.fill', android: 'delete', web: 'delete' };
const UP_ICON: AppIcon = { ios: 'chevron.up', android: 'keyboard_arrow_up', web: 'keyboard_arrow_up' };
const DOWN_ICON: AppIcon = { ios: 'chevron.down', android: 'keyboard_arrow_down', web: 'keyboard_arrow_down' };
const PHOTO_ICON: AppIcon = { ios: 'photo', android: 'image', web: 'image' };

interface MaterialPhotoManagerProps {
  materialId: string;
  photos: MaterialPhoto[];
  onPhotosChange: (photos: MaterialPhoto[]) => void;
}

type PendingAction = 'primary' | 'replace' | 'delete' | null;

/**
 * TEMPORARY diagnostic logging for the Phase 3.1 photo-upload investigation ("Couldn't connect"
 * failures on upload/replace) — logs only the error's type/name/message and non-sensitive request
 * context (ids, the action attempted). Never logs the picked file's URI/bytes, an access token, or
 * any other request body content. Remove once the root cause is confirmed and fixed.
 */
function logPhotoActionError(action: string, err: unknown, context: Record<string, unknown>) {
  const isError = err instanceof Error;
  console.error('[MaterialPhotoManager] action failed', {
    action,
    ...context,
    errorConstructor: isError ? err.constructor?.name : undefined,
    errorName: isError ? err.name : typeof err,
    errorMessage: isError ? err.message : String(err),
  });
}

async function pickPhoto(): Promise<PickedPhotoAsset | null> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    Alert.alert('Photo access needed', 'Allow photo library access in Settings to upload material photos.');
    return null;
  }

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    quality: 0.9,
    allowsEditing: false,
  });
  if (result.canceled || result.assets.length === 0) return null;

  const asset = result.assets[0];
  return { uri: asset.uri, fileName: asset.fileName, mimeType: asset.mimeType };
}

export function MaterialPhotoManager({ materialId, photos, onPhotosChange }: MaterialPhotoManagerProps) {
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [pendingByPhotoId, setPendingByPhotoId] = useState<Record<string, PendingAction>>({});
  const [rowError, setRowError] = useState<string | null>(null);

  const sortedPhotos = [...photos].sort((a, b) => a.displayOrder - b.displayOrder);

  async function handleAddPhoto() {
    setUploadError(null);
    const asset = await pickPhoto();
    if (!asset) return;

    setIsUploading(true);
    try {
      const photo = await uploadMaterialPhoto(materialId, asset);
      onPhotosChange([...photos, photo]);
    } catch (err) {
      logPhotoActionError('upload', err, { materialId });
      setUploadError(toUserMessage(err));
    } finally {
      setIsUploading(false);
    }
  }

  function withPending(photoId: string, action: PendingAction, fn: () => Promise<void>) {
    setRowError(null);
    setPendingByPhotoId((prev) => ({ ...prev, [photoId]: action }));
    return fn()
      .catch((err) => {
        logPhotoActionError(action ?? 'reorder', err, { materialId, photoId });
        setRowError(toUserMessage(err));
      })
      .finally(() => setPendingByPhotoId((prev) => ({ ...prev, [photoId]: null })));
  }

  function handleSetPrimary(photoId: string) {
    withPending(photoId, 'primary', async () => {
      await setPrimaryMaterialPhoto(materialId, photoId);
      onPhotosChange(photos.map((p) => ({ ...p, isPrimary: p.id === photoId })));
    });
  }

  function handleReplace(photoId: string) {
    withPending(photoId, 'replace', async () => {
      const asset = await pickPhoto();
      if (!asset) return;
      const updated = await replaceMaterialPhoto(materialId, photoId, asset);
      onPhotosChange(photos.map((p) => (p.id === photoId ? updated : p)));
    });
  }

  function handleDelete(photoId: string) {
    Alert.alert('Delete photo', 'This photo will be permanently removed. This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          withPending(photoId, 'delete', async () => {
            try {
              await deleteMaterialPhoto(materialId, photoId);
            } catch (err) {
              // A repeated/duplicate delete request lands here as a plain 404 — treat it as
              // already-successful rather than an error the operator needs to see.
              if (!(err instanceof ApiError && err.status === 404)) throw err;
            }
            onPhotosChange(photos.filter((p) => p.id !== photoId));
          });
        },
      },
    ]);
  }

  function handleMove(photoId: string, direction: -1 | 1) {
    const index = sortedPhotos.findIndex((p) => p.id === photoId);
    const targetIndex = index + direction;
    if (index === -1 || targetIndex < 0 || targetIndex >= sortedPhotos.length) return;

    const reordered = [...sortedPhotos];
    [reordered[index], reordered[targetIndex]] = [reordered[targetIndex], reordered[index]];
    const newOrderIds = reordered.map((p) => p.id);

    // Optimistic local reorder, corrected from the server's response (or rolled back on failure) —
    // never leaves the UI showing an order the server didn't actually confirm.
    const optimistic = reordered.map((p, i) => ({ ...p, displayOrder: i }));
    onPhotosChange(optimistic);

    withPending(photoId, null, async () => {
      try {
        const updated = await reorderMaterialPhotos(materialId, newOrderIds);
        onPhotosChange(updated);
      } catch (err) {
        onPhotosChange(photos); // roll back to the pre-reorder order
        throw err;
      }
    });
  }

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <ThemedText type="smallBold">Photos</ThemedText>
        <PrimaryButton label={isUploading ? 'Uploading…' : 'Add Photo'} variant="outline" loading={isUploading} onPress={handleAddPhoto} />
      </View>

      {uploadError && <ErrorBanner message={uploadError} onRetry={handleAddPhoto} />}
      {rowError && <ErrorBanner message={rowError} />}

      {sortedPhotos.length === 0 && !isUploading && (
        <View style={styles.emptyState}>
          <SymbolView name={PHOTO_ICON} size={28} tintColor={Colors.textSecondary} />
          <ThemedText type="small" themeColor="textSecondary">
            No photos yet. Add one to show contractors what this material looks like.
          </ThemedText>
        </View>
      )}

      <View style={styles.grid}>
        {sortedPhotos.map((photo, index) => {
          const pending = pendingByPhotoId[photo.id];
          return (
            <View key={photo.id} style={styles.tile}>
              <MaterialImage imageUrl={photo.url} fallbackIcon={PHOTO_ICON} style={styles.thumbnail} />

              {photo.isPrimary && (
                <View style={styles.primaryBadge}>
                  <SymbolView name={STAR_ICON} size={12} tintColor={Colors.background} />
                  <ThemedText type="small" style={styles.primaryBadgeText}>
                    Primary
                  </ThemedText>
                </View>
              )}

              {pending && (
                <View style={styles.tileOverlay}>
                  <ActivityIndicator color={Colors.background} />
                </View>
              )}

              <View style={styles.tileActions}>
                <Pressable accessibilityRole="button" disabled={photo.isPrimary || !!pending} onPress={() => handleSetPrimary(photo.id)} style={styles.actionButton}>
                  <SymbolView name={photo.isPrimary ? STAR_ICON : STAR_OUTLINE_ICON} size={16} tintColor={Colors.text} />
                </Pressable>
                <Pressable accessibilityRole="button" disabled={!!pending} onPress={() => handleReplace(photo.id)} style={styles.actionButton}>
                  <SymbolView name={REPLACE_ICON} size={16} tintColor={Colors.text} />
                </Pressable>
                <Pressable accessibilityRole="button" disabled={!!pending} onPress={() => handleMove(photo.id, -1)} style={styles.actionButton}>
                  <SymbolView name={UP_ICON} size={16} tintColor={index === 0 ? Colors.border : Colors.text} />
                </Pressable>
                <Pressable accessibilityRole="button" disabled={!!pending} onPress={() => handleMove(photo.id, 1)} style={styles.actionButton}>
                  <SymbolView name={DOWN_ICON} size={16} tintColor={index === sortedPhotos.length - 1 ? Colors.border : Colors.text} />
                </Pressable>
                <Pressable accessibilityRole="button" disabled={!!pending} onPress={() => handleDelete(photo.id)} style={styles.actionButton}>
                  <SymbolView name={DELETE_ICON} size={16} tintColor={StatusColors.negative} />
                </Pressable>
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: Spacing.three,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  emptyState: {
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.four,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.three,
  },
  tile: {
    width: 140,
    gap: Spacing.one,
  },
  thumbnail: {
    width: 140,
    height: 140,
    borderRadius: Spacing.three,
    borderCurve: 'continuous',
  },
  primaryBadge: {
    position: 'absolute',
    top: Spacing.one,
    left: Spacing.one,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(0,0,0,0.65)',
    paddingHorizontal: Spacing.two,
    paddingVertical: 2,
    borderRadius: Spacing.five,
  },
  primaryBadgeText: {
    color: Colors.background,
  },
  tileOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 140,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.35)',
    borderRadius: Spacing.three,
  },
  tileActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  actionButton: {
    padding: Spacing.one,
  },
});
