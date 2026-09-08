import { StyleSheet, View } from 'react-native';

import { PrimaryButton } from '@/components/primary-button';
import { ThemedText } from '@/components/themed-text';
import { Spacing, StatusColors } from '@/constants/theme';

interface ErrorBannerProps {
  message: string;
  onRetry?: () => void;
}

/** Consistent failure UI for fetches and mutations: a human-readable message plus an optional
 * Retry action, so a failed request never just looks like empty/missing data. */
export function ErrorBanner({ message, onRetry }: ErrorBannerProps) {
  return (
    <View style={styles.container}>
      <ThemedText type="small" style={styles.message}>
        {message}
      </ThemedText>
      {onRetry && <PrimaryButton label="Retry" variant="outline" onPress={onRetry} />}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: Spacing.two,
    alignItems: 'center',
  },
  message: {
    color: StatusColors.negative,
    textAlign: 'center',
  },
});
