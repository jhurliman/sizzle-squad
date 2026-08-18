/**
 * A fast sibling of tools/shoot.mjs for iterating on anything time-dependent.
 *
 *   node tools/hudshot.mjs --out shots/hud-1 [--warp 40] [--only iphone-portrait]
 *
 * The full harness drives the game in wall-clock time, but the headless box
 * renders through swiftshader at roughly one frame a second, so in a 12 second
 * run the sim advances well under a second — no orders, no heat, no patience
 * loss, nothing to look at. This boots the same built bundle at the same four
 * device profiles and uses __game.warp() to push the SIM forward without
 * waiting on the rasteriser, then takes one shot per profile.
 */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Duplicated rather than imported: shoot.mjs runs main() on import.
const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const IPAD_UA =
  'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const PROFILES = [
  { id: 'iphone-portrait', viewport: { width: 393, height: 852 }, dpr: 3, touch: true, ua: IPHONE_UA },
  { id: 'iphone-landscape', viewport: { width: 852, height: 393 }, dpr: 3, touch: true, ua: IPHONE_UA },
  { id: 'ipad-landscape', viewport: { width: 1194, height: 834 }, dpr: 2, touch: true, ua: IPAD_UA },
  { id: 'desktop', viewport: { width: 1440, height: 900 }, dpr: 2, touch: false, ua: undefined },
];

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

const argv = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1]?.startsWith('--') ? true : arr[i + 1]]);
    return acc;
  }, []),
);

const OUT = path.resolve(ROOT, argv.out ?? 'shots/hud');
const WARP = Number(argv.warp ?? 40);
const ONLY = argv.only ? String(argv.only).split(',') : null;

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };

function serve(dir) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://x');
      let file = path.join(dir, decodeURIComponent(url.pathname));
      if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(dir, 'index.html');
      if (!fs.existsSync(file)) {
        res.writeHead(404);
        return res.end('nope');
      }
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFrames(page, n, timeoutMs) {
  const start = await page.evaluate(() => window.__game.snapshot().perf.frames);
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const now = await page.evaluate(() => window.__game.snapshot().perf.frames);
    if (now - start >= n) return now - start;
    await sleep(250);
  }
  console.warn(`  (only got ${n} frames? timed out waiting)`);
  return -1;
}

const { server, port } = await serve(DIST);
const PINNED = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({
  executablePath: fs.existsSync(PINNED) ? PINNED : undefined,
  args: [
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--enable-unsafe-swiftshader',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-webgl',
    '--ignore-gpu-blocklist',
    '--disable-lcd-text',
    '--force-device-scale-factor=1',
    '--autoplay-policy=no-user-gesture-required',
  ],
});

fs.mkdirSync(OUT, { recursive: true });
const report = { warp: WARP, profiles: [] };

for (const prof of PROFILES) {
  if (ONLY && !ONLY.includes(prof.id)) continue;
  const ctx = await browser.newContext({
    viewport: prof.viewport,
    deviceScaleFactor: prof.dpr,
    isMobile: prof.touch,
    hasTouch: prof.touch,
    userAgent: prof.ua,
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));

  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !!window.__game, null, { timeout: 15000 }).catch(() => {});
  await sleep(500);
  await page.evaluate(() => window.__game.start());
  // The camera rig eases toward its solved framing at ~0.22 per frame, so on a
  // software rasteriser it needs a couple of dozen RENDERED frames before the
  // room is framed the way a player would ever see it. Wall-clock sleeps are
  // not enough — wait on the frame counter.
  await waitFrames(page, prof.id === 'desktop' ? 16 : 30, 300000);
  await page.evaluate((s) => window.__game.warp(s), WARP);
  await waitFrames(page, 3, 120000);
  const snap = await page.evaluate(() => window.__game.snapshot());
  const file = path.join(OUT, `${prof.id}.png`);
  await page.screenshot({ path: file, timeout: 180000 });
  report.profiles.push({ id: prof.id, errors, orders: snap.orders, score: snap.score, time: snap.time });
  console.log(`${prof.id}: ${snap.orders.length} orders, patience ${snap.score.patience.toFixed(2)}, ${errors.length} console issues`);
  for (const e of errors.slice(0, 6)) console.log('   ', e);
  await ctx.close();
}

fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
await browser.close();
server.close();
console.log('wrote', OUT);
