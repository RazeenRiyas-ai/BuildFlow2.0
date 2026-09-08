// Entry point for `node --import ./scripts/register-test-hooks.mjs --test ...` — registers the
// alias-resolution hook so test files (and whatever they import) can use the same `@/*` imports
// as the rest of the app.
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

register('./test-alias-loader.mjs', pathToFileURL(import.meta.filename));
