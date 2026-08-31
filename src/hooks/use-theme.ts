/**
 * BuildFlow is light-mode only — this hook exists so components keep a stable
 * theming API (and the door stays open for theming changes later) without
 * reading the system color scheme.
 */

import { Colors } from '@/constants/theme';

export function useTheme() {
  return Colors;
}
