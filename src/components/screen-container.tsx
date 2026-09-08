import { PropsWithChildren } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BottomTabInset, Colors, MaxContentWidth, Spacing } from '@/constants/theme';

type SafeAreaEdge = 'top' | 'bottom';

interface ScreenContainerProps extends PropsWithChildren {
  contentContainerStyle?: ViewStyle;
  /**
   * Safe-area edges this screen must account for itself. Most screens already get correct top
   * spacing from their Stack.Screen header and aren't rendered under the tab bar, so this
   * defaults to none. Pass 'top' for header-less screens (the four tab screens, login) and
   * 'bottom' for screens rendered under the native tab bar, so content isn't hidden behind it.
   */
  edges?: SafeAreaEdge[];
}

/** Standard first child for a pushed/tab screen: a full-bleed, keyboard-aware ScrollView. */
export function ScreenContainer({ children, contentContainerStyle, edges = [] }: ScreenContainerProps) {
  const insets = useSafeAreaInsets();

  const edgeStyle: ViewStyle = {};
  if (edges.includes('top')) edgeStyle.paddingTop = insets.top + Spacing.three;
  if (edges.includes('bottom')) edgeStyle.paddingBottom = BottomTabInset + insets.bottom;

  return (
    <KeyboardAvoidingView style={styles.scrollView} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView
        style={styles.scrollView}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.contentContainer, edgeStyle, contentContainerStyle]}>
        {children}
      </ScrollView>
    </KeyboardAvoidingView>
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
