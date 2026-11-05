// Empacota o servidor (TypeScript) em ESM em dist/server (index.js e cli.js).
import { build } from 'esbuild';

await build({
  entryPoints: ['server/index.ts', 'server/cli.ts'],
  outdir: 'dist/server',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  packages: 'external',
  sourcemap: true,
  logLevel: 'info',
});
