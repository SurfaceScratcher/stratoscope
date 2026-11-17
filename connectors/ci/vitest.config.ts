import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Test against the library source so the tests do not need a prior build of stratoscope
export default defineConfig({
  resolve: { alias: { 'stratoscope/core': fileURLToPath(new URL('../../packages/stratoscope/src/core.ts', import.meta.url)) } },
});
