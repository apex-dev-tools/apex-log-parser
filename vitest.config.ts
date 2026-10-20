import codspeedPlugin from '@codspeed/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Applies to `vitest bench` only.
  plugins: [codspeedPlugin()],
  test: {
    globals: true,
    // One worker runs many files; no suite relies on a fresh module state.
    isolate: false,
    include: [
      'src/**/__tests__/**/*.test.ts',
      'scripts/__tests__/**/*.test.ts',
      'benchmarks/__tests__/**/*.test.ts',
    ],
    benchmark: { include: ['benchmarks/**/*.bench.ts'] },
  },
});
