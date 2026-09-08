// Node module customization hooks that let `node --test` resolve this project's `@/*` path alias
// (defined in tsconfig.json for Metro/TypeScript) without adding a bundler or test framework —
// Node 22+ already runs TypeScript test files natively via built-in type stripping.
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const projectRoot = path.resolve(import.meta.dirname, '..');

// This loader only ever runs under `node --test` (never in the shipped app), so it's safe to
// unconditionally swap the native-module-backed secure-storage implementation for an in-memory
// one here, rather than requiring every test file to mock it individually.
const MOCK_SECURE_STORAGE_URL = 'buildflow-test:secure-storage';

const MOCK_SOCKET_IO_CLIENT_URL = pathToFileURL(path.join(projectRoot, 'scripts', 'test-mocks', 'socket-io-client.mjs')).href;

export async function resolve(specifier, context, nextResolve) {
  if (specifier === '@/services/secure-storage') {
    return { url: MOCK_SECURE_STORAGE_URL, shortCircuit: true };
  }
  if (specifier === 'socket.io-client') {
    return { url: MOCK_SOCKET_IO_CLIENT_URL, shortCircuit: true };
  }
  if (specifier.startsWith('@/')) {
    const mapped = pathToFileURL(path.join(projectRoot, 'src', specifier.slice(2)) + '.ts').href;
    return nextResolve(mapped, context);
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url === MOCK_SECURE_STORAGE_URL) {
    return {
      format: 'module',
      shortCircuit: true,
      source: `
        const store = new Map();
        export const secureStorage = {
          getItem: async (key) => (store.has(key) ? store.get(key) : null),
          setItem: async (key, value) => { store.set(key, value); },
          deleteItem: async (key) => { store.delete(key); },
        };
      `,
    };
  }
  return nextLoad(url, context);
}
