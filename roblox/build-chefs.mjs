import { build } from 'esbuild';

const DIR = new URL('.', import.meta.url).pathname.replace(/\/$/, '');
const THREE = new URL('../node_modules/three', import.meta.url).pathname;

await build({
  entryPoints: [DIR + '/capture-chefs.mjs'],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: DIR + '/capture-chefs.bundle.mjs',
  logLevel: 'warning',
  banner: { js: "import.meta.env = { DEV: false, PROD: true, MODE: 'production' };" },
  plugins: [
    {
      name: 'wrap-three',
      setup(b) {
        b.onResolve({ filter: /^three$/ }, () => ({ path: DIR + '/three-wrapped.mjs' }));
        b.onResolve({ filter: /^three\/examples\/jsm\/utils\/BufferGeometryUtils(\.js)?$/ }, () => ({
          path: DIR + '/utils-wrapped.mjs',
        }));
        b.onResolve({ filter: /^REAL_THREE$/ }, () => ({ path: THREE + '/build/three.module.js' }));
        b.onResolve({ filter: /^REAL_UTILS$/ }, () => ({
          path: THREE + '/examples/jsm/utils/BufferGeometryUtils.js',
        }));
      },
    },
  ],
});
console.error('bundled ok');
