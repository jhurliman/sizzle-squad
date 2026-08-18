/**
 * One service, recorded plan by plan. `botprobe.mjs` says WHAT the aggregate
 * is; this says what happened, in order, to one chef and one ingredient.
 *   node tools/bottrace.mjs [--seed 2] [--seconds 180] [--mode idle] [--grep bacon]
 */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const argv = Object.fromEntries(
  process.argv.slice(2).reduce((a, x, i, arr) => (x.startsWith('--') ? [...a, [x.slice(2), arr[i + 1]]] : a), []),
);
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
const { server, port } = await new Promise((res) => {
  const s = http.createServer((req, rs) => {
    let f = path.join(DIST, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(DIST, 'index.html');
    rs.writeHead(200, { 'content-type': MIME[path.extname(f)] ?? 'application/octet-stream' });
    fs.createReadStream(f).pipe(rs);
  });
  s.listen(0, '127.0.0.1', () => res({ server: s, port: s.address().port }));
});
const PINNED = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({
  executablePath: fs.existsSync(PINNED) ? PINNED : undefined,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 200, height: 150 } });
await page.goto(`http://127.0.0.1:${port}/?capture=1`, { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.__bots, null, { timeout: 20000 });
const r = await page.evaluate(
  ([sec, mode, run]) => {
    let a = (run * 0x9e3779b1) >>> 0;
    Math.random = () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    window.__game.start();
    window.__game.warp(0.02);
    return window.__bots.probe(sec, mode, run + 1, true);
  },
  [Number(argv.seconds ?? 180), argv.mode ?? 'idle', Number(argv.seed ?? 0)],
);
const re = argv.grep ? new RegExp(argv.grep, 'i') : null;
for (const line of r.trace) if (!re || re.test(line)) console.log(line);
console.log(`\nserved=${r.served} missed=${r.missed} closed=${JSON.stringify(r.closed)} rotted=${JSON.stringify(r.rotted)}`);
await browser.close();
server.close();
