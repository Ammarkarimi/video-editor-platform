// Bundles the server (including the @vep/core workspace package) into dist/.
// Third-party dependencies stay external and are installed from package.json at deploy time.
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const external = Object.keys(pkg.dependencies ?? {}).filter((name) => !name.startsWith('@vep/'));

await build({
  entryPoints: {
    index: 'src/index.ts',
    'render-worker': 'src/render/worker.ts',
  },
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,
  external: [...external, 'node:*'],
  logLevel: 'info',
});
