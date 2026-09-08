/**
 * expo-secure-store does not support web (confirmed: iOS/Android/tvOS only).
 * Falling back to localStorage for the web target only — a documented Expo
 * tradeoff, acceptable here since BuildFlow's primary target is the native app.
 */
export const secureStorage = {
  getItem: async (key: string): Promise<string | null> => {
    if (typeof window === 'undefined') return null;
    return window.localStorage.getItem(key);
  },
  setItem: async (key: string, value: string): Promise<void> => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(key, value);
  },
  deleteItem: async (key: string): Promise<void> => {
    if (typeof window === 'undefined') return;
    window.localStorage.removeItem(key);
  },
};
