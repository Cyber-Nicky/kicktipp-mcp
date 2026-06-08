import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    ktipp: 'src/bin/ktipp.ts',
    mcp: 'src/bin/mcp.ts',
  },
  format: ['esm'],
  target: 'node22',
  clean: true,
  banner: { js: '#!/usr/bin/env node' },
});
