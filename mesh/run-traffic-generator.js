import { startTrafficGenerator } from './traffic-generator.js';

startTrafficGenerator({
  onRequest: ({ target, status, ok, error }) => {
    if (!ok) {
      console.error(`[traffic-generator] ${target} -> ${error ?? status}`);
    }
  },
});

console.log('[traffic-generator] running: ~5 req/s (jittered) across web and checkout');
