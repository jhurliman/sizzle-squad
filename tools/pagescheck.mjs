/**
 * DOES THE BUILD ACTUALLY WORK WHERE IT IS PUBLISHED?
 *
 *   node tools/pagescheck.mjs [--base /sizzle-squad]
 *
 * Every other server in tools/ mounts dist/ at the ROOT. GitHub Pages does not:
 * a project site is served from /<repo>/, and that one difference is enough to
 * ship a blank page while all four capture profiles report zero errors. This
 * serves dist/ under the subpath, refuses anything outside it exactly the way
 * Pages does, boots the real game and advances the real sim.
 *
 * It fails on three things a root-mounted harness cannot see: an asset URL that
 * resolved against the wrong root (which is why vite.config.ts sets base './'
 * and not '/sizzle-squad/' — see the note there), any request that escapes the
 * base, and any response >= 400. The last one caught /favicon.ico, which a
 * browser asks for on its own and which lands outside the base on every single
 * load; index.html answers it with an inline data URI now.
 *
 * Exits non-zero on failure, so it can gate a deploy.
 */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const argv = process.argv.slice(2);
const BASE = (argv[argv.indexOf('--base') + 1] ?? '').startsWith('/') ? argv[argv.indexOf('--base') + 1] : '/sizzle-squad';
if (!fs.existsSync(DIST)) {
  console.error('dist/ missing — npx vite build first');
  process.exit(1);
}
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const srv = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (!u.pathname.startsWith(BASE)) { res.writeHead(404); return res.end('404 outside base'); }
  let rel = u.pathname.slice(BASE.length) || '/';
  let p = path.join(DIST, rel === '/' ? 'index.html' : rel);
  if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end('404 ' + rel); }
  res.writeHead(200, { 'content-type': MIME[path.extname(p)] ?? 'application/octet-stream' });
  res.end(fs.readFileSync(p));
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const port = srv.address().port;
const PINNED = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({
  executablePath: fs.existsSync(PINNED) ? PINNED : undefined,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const bad = [];
page.on('console', (m) => { if (m.type() === 'error') bad.push('[console] ' + m.text()); });
page.on('pageerror', (e) => bad.push('[pageerror] ' + e.message));
page.on('requestfailed', (r) => bad.push('[404/failed] ' + r.url()));
page.on('response', (r) => { if (r.status() >= 400) bad.push(`[HTTP ${r.status()}] ${r.url()}`); });
await page.goto(`http://127.0.0.1:${port}${BASE}/?capture=1`, { waitUntil: 'networkidle' });
const booted = await page.waitForFunction(() => !!window.__game && !!window.__input, null, { timeout: 20000 }).then(() => true).catch(() => false);
const served = await page.evaluate(() => { window.__game.start(); window.__game.setCapture(true); window.__game.advance(6); return window.__game.snapshot()?.score ?? null; }).catch((e) => 'ERR ' + e.message);
console.log(`\n=== dist/ served at ${BASE}/ , the way GitHub Pages serves it`);
console.log('  boot        ', booted ? 'OK — window.__game and window.__input are live' : 'FAILED');
console.log('  sim         ', JSON.stringify(served));
console.log('  problems    ', bad.length ? '' : 'none');
for (const b of bad.slice(0, 8)) console.log('    ! ' + b);
await browser.close();
srv.close();
process.exit(booted && !bad.length ? 0 : 1);
