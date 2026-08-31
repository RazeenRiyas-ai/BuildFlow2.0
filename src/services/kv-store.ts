import Storage from 'expo-sqlite/kv-store';

/** Thin JSON read/write helper over the on-device SQLite key-value store shared by orders/sites persistence. */
export async function readJson<T>(key: string, fallback: T): Promise<T> {
  const raw = await Storage.getItemAsync(key);
  if (raw === null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export async function writeJson<T>(key: string, value: T): Promise<void> {
  await Storage.setItemAsync(key, JSON.stringify(value));
}
