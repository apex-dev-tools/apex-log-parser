import codspeedPlugin from '@codspeed/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Applies to `vitest bench` only.
  plugins: [codspeedPlugin()],
  test: {
    globals: true,
    include: ['src/**/__tests__/**/*.test.ts', 'scripts/__tests__/**/*.test.ts'],
    benchmark: { include: ['src/__bench__/**/*.bench.ts'] },
  },
});
