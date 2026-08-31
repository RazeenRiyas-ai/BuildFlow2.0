import { PropsWithChildren } from 'react';
import { ScrollView, StyleSheet, ViewStyle } from 'react-native';

import { Colors, MaxContentWidth, Spacing } from '@/constants/theme';

interface ScreenContainerProps extends PropsWithChildren {
  contentContainerStyle?: ViewStyle;
}

/** Standard first child for a pushed/tab screen: a full-bleed ScrollView with safe-area-aware insets. */
export function ScreenContainer({ children, contentContainerStyle }: ScreenContainerProps) {
  return (
    <ScrollView
      style={styles.scrollView}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={[styles.contentContainer, contentContainerStyle]}>
      {children}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scrollView: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  contentContainer: {
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.six,
    gap: Spacing.five,
  },
});
