/**
 * BuildFlow is light-mode only by design (no dark mode / system-scheme switching).
 * Colors are a flat black/white/neutral-gray palette per the brand's minimal design direction.
 */

import '@/global.css';

import { Platform } from 'react-native';

export const Colors = {
  text: '#000000',
  background: '#ffffff',
  backgroundElement: '#F0F0F3',
  backgroundSelected: '#E0E1E6',
  textSecondary: '#60646C',
  border: '#E0E1E6',
} as const;

export type ThemeColor = keyof typeof Colors;

/** Restrained semantic colors used only for stock/order status signaling — the one deliberate exception to the black/white/gray rule. */
export const StatusColors = {
  positive: '#1F7A45',
  positiveBackground: '#E7F4EC',
  caution: '#946200',
  cautionBackground: '#FBF0DC',
  negative: '#B3261E',
  negativeBackground: '#FBE9E8',
} as const;

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
