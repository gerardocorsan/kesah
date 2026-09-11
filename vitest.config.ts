import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config.ts';

export default mergeConfig(
  viteConfig,
  defineConfig({
    // Solid's client build in tests; this file is not used by the production build.
    resolve: { conditions: ['development', 'browser', 'module'] },
    test: {
      environment: 'jsdom',
      setupFiles: ['src/test/setup.ts'],
      css: false,
      coverage: {
        provider: 'v8',
        include: ['src/**/*.{ts,tsx}'],
        exclude: ['src/**/*.test.*', 'src/test/**', 'src/vite-env.d.ts'],
        reporter: ['text', 'html'],
        thresholds: { lines: 85, functions: 85, branches: 85, statements: 85 },
      },
    },
  }),
);
