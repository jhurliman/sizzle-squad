import { defineConfig } from 'vite';
export default defineConfig({
  /**
   * RELATIVE, AND IT HAS TO BE RELATIVE.
   *
   * GitHub Pages serves this repo from a subpath (/sizzle-squad/), so the built
   * index.html cannot reference /assets/... — that 404s on Pages. The obvious
   * fix is base: '/sizzle-squad/', and it would quietly destroy the harness:
   * every server in tools/ (shoot, touchprobe, stickprobe, camtrace, ...) serves
   * dist/ AT ROOT and falls back to index.html for anything it cannot find. An
   * absolute base makes them look for dist/sizzle-squad/assets/index-*.js, miss,
   * and hand back index.html with a JavaScript content type — so every probe
   * would load a blank page and report numbers for a game that never booted.
   *
   * './' resolves correctly under both: /sizzle-squad/assets/... on Pages and
   * /assets/... on a harness server, off the same build.
   */
  base: './',
  server: { host: '0.0.0.0', port: 5173, strictPort: false },
  build: { target: 'es2020', sourcemap: false },
});
