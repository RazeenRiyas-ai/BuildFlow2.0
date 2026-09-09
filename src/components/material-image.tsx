import { Image } from 'expo-image';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors } from '@/constants/theme';
import { toAbsoluteApiUrl } from '@/services/api-client';
import { AppIcon } from '@/types';

const RETRY_ICON: AppIcon = { ios: 'arrow.clockwise', android: 'refresh', web: 'refresh' };

interface MaterialImageProps {
  /** Server-relative photo URL (Material.imageUrl / MaterialPhoto.url) — undefined when the
   * material has no photo at all, which renders the category-icon fallback directly, no network
   * request attempted. */
  imageUrl?: string;
  fallbackIcon: AppIcon;
  iconSize?: number;
  style?: StyleProp<ViewStyle>;
}

/**
 * Shared image cell for anywhere a material's photo appears (catalog cards, material detail,
 * HQ material rows). Three states beyond the "no photo uploaded" fallback: loading (a spinner over
 * the placeholder background), loaded (the real photo), and failed (network/decoding error) — the
 * failed state is tappable to retry, which just remounts the underlying <Image> with a fresh key so
 * expo-image issues a new request rather than replaying its own cached failure.
 */
export function MaterialImage({ imageUrl, fallbackIcon, iconSize = 32, style }: MaterialImageProps) {
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<'loading' | 'loaded' | 'failed'>('loading');

  if (!imageUrl) {
    return (
      <ThemedView type="backgroundElement" style={[styles.fallback, style]}>
        <SymbolView name={fallbackIcon} size={iconSize} tintColor={Colors.textSecondary} />
      </ThemedView>
    );
  }

  return (
    <View style={[styles.container, style]}>
      {status !== 'failed' && (
        <Image
          key={attempt}
          source={{ uri: toAbsoluteApiUrl(imageUrl) }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          transition={150}
          onLoadStart={() => setStatus('loading')}
          onLoad={() => setStatus('loaded')}
          onError={() => setStatus('failed')}
        />
      )}

      {status === 'loading' && (
        <ThemedView type="backgroundElement" style={[StyleSheet.absoluteFill, styles.center]}>
          <ActivityIndicator size="small" color={Colors.textSecondary} />
        </ThemedView>
      )}

      {status === 'failed' && (
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            setStatus('loading');
            setAttempt((value) => value + 1);
          }}
          style={StyleSheet.absoluteFill}>
          <ThemedView type="backgroundElement" style={[StyleSheet.absoluteFill, styles.center, styles.retryGap]}>
            <SymbolView name={RETRY_ICON} size={iconSize * 0.6} tintColor={Colors.textSecondary} />
            <ThemedText type="small" themeColor="textSecondary">
              Retry
            </ThemedText>
          </ThemedView>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
  },
  fallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryGap: {
    gap: 4,
  },
});
