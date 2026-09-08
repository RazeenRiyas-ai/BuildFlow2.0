/* eslint-disable */
// Standalone script (never imported by the app or by vitest directly) spawned as a real child
// process by process-safety.test.ts, so the actual process.exit() behavior of
// installProcessSafetyHandlers() can be observed without killing the test runner itself.
import { installProcessSafetyHandlers } from '../../process-safety';

installProcessSafetyHandlers();

const mode = process.argv[2];

if (mode === 'uncaughtException') {
  setImmediate(() => {
    throw new Error('fixture: deliberate uncaught exception');
  });
} else if (mode === 'unhandledRejection') {
  setImmediate(() => {
    Promise.reject(new Error('fixture: deliberate unhandled rejection'));
  });
} else {
  throw new Error('process-safety-fixture: unknown mode ' + mode);
}
