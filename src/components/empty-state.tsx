import { SymbolView } from 'expo-symbols';
import { StyleSheet, View } from 'react-native';

import { PrimaryButton } from '@/components/primary-button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors, Spacing } from '@/constants/theme';
import { AppIcon } from '@/types';

interface EmptyStateProps {
  icon: AppIcon;
  title: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function EmptyState({ icon, title, message, actionLabel, onAction }: EmptyStateProps) {
  return (
    <View style={styles.container}>
      <ThemedView type="backgroundElement" style={styles.iconCircle}>
        <SymbolView name={icon} size={28} tintColor={Colors.textSecondary} />
      </ThemedView>
      <ThemedText type="smallBold" style={styles.centerText}>
        {title}
      </ThemedText>
      {message && (
        <ThemedText type="small" themeColor="textSecondary" style={styles.centerText}>
          {message}
        </ThemedText>
      )}
      {actionLabel && onAction && (
        <View style={styles.actionWrapper}>
          <PrimaryButton label={actionLabel} onPress={onAction} variant="outline" />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.six,
    paddingHorizontal: Spacing.four,
  },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.two,
  },
  centerText: {
    textAlign: 'center',
  },
  actionWrapper: {
    marginTop: Spacing.three,
    alignSelf: 'stretch',
  },
});
