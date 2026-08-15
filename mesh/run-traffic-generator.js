import { startTrafficGenerator } from './traffic-generator.js';

startTrafficGenerator({
  onRequest: ({ target, status, ok, error }) => {
    if (!ok) {
      console.error(`[traffic-generator] ${target} -> ${error ?? status}`);
    }
  },
});

// startTrafficGenerator's scheduling timers are deliberately unref'd (so a
// caller embedding it, e.g. a test, can let the process exit without an
// explicit stop() — see traffic-generator.test.js). This entry point *is*
// the process, though, so without something ref'd the event loop has
// nothing to wait on and Node exits right after the log line below,
// before a single request ever fires. Hold it open.
setInterval(() => {}, 1 << 30);

console.log('[traffic-generator] running: ~5 req/s (jittered) across web and checkout');
