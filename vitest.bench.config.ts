import { defineConfig, mergeConfig } from 'vitest/config';
import base from './vitest.config.js';

// Vite's module runner reads each import through a getter: about 4× slower than a consumer's build.
// Native import with tsx's loader times the parser as Node runs it.
export default mergeConfig(
  base,
  defineConfig({
    test: {
      experimental: { viteModuleRunner: false },
      execArgv: ['--import', 'tsx'],
    },
  }),
);
