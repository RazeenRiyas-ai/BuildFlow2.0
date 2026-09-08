import * as SecureStore from 'expo-secure-store';

/** Native secure storage (iOS Keychain / Android Keystore) for auth tokens. */
export const secureStorage = {
  getItem: (key: string) => SecureStore.getItemAsync(key),
  setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value),
  deleteItem: (key: string) => SecureStore.deleteItemAsync(key),
};
