/* eslint-disable */
// Standalone script (never imported by the app or by vitest directly), spawned as a real child
// process by process-safety.test.ts — same pattern as process-safety-fixture.ts, extended to prove
// the REAL Sentry wiring in process-safety.ts actually fires, not just that sentry.ts's own
// functions behave correctly in isolation (see sentry-observability.test.ts /
// sentry-safety.test.ts, which deliberately test the module directly, not this integration).
//
// This fixture calls the real initSentry() with a fake-but-valid-shaped DSN and a custom transport
// (Sentry's own supported extension point), then installs the real installProcessSafetyHandlers()
// and triggers a real uncaught exception / unhandled rejection in a real separate process. The
// transport writes every captured envelope to a file path passed on argv, so the parent test
// process can read back what the real fatal-error handler actually sent to Sentry after this
// process has exited — proof the wiring works end to end, not just that each piece works alone.
import fs from 'fs';
import { installProcessSafetyHandlers } from '../../process-safety';
import { initSentry } from '../../observability/sentry';

const outputFile = process.argv[2];
const mode = process.argv[3];

const envelopes: unknown[] = [];

initSentry({
  dsn: 'https://fakepublickey@fake.ingest.sentry.io/1234567',
  transport: () => ({
    send: async (envelope: unknown) => {
      envelopes.push(envelope);
      // Written on every send (not just once) so the parent test can read a partial result even
      // if the process is killed before a clean exit — matches this fixture's own job of proving
      // capture-before-exit ordering, not assuming it.
      fs.writeFileSync(outputFile, JSON.stringify(envelopes));
      return {};
    },
    flush: async () => true,
  }),
});

installProcessSafetyHandlers();

if (mode === 'uncaughtException') {
  setImmediate(() => {
    throw new Error('fixture: deliberate uncaught exception for real Sentry wiring test');
  });
} else if (mode === 'unhandledRejection') {
  setImmediate(() => {
    Promise.reject(new Error('fixture: deliberate unhandled rejection for real Sentry wiring test'));
  });
} else {
  throw new Error('process-safety-sentry-fixture: unknown mode ' + mode);
}
