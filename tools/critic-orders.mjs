import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = '/home/claude/kitchen';
const DIST = path.join(ROOT, 'dist');
const OUT = path.join(ROOT, 'shots/critic-p05-orders-r1/forced');
fs.mkdirSync(OUT, { recursive: true });

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  let file = path.join(DIST, decodeURIComponent(url.pathname));
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'index.html');
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--force-device-scale-factor=1'],
});

const profiles = [
  { id: 'iphone-portrait', viewport: { width: 393, height: 852 }, dpr: 3, touch: true },
  { id: 'iphone-landscape', viewport: { width: 852, height: 393 }, dpr: 2, touch: true },
  { id: 'ipad-landscape', viewport: { width: 1194, height: 834 }, dpr: 1, touch: true },
  { id: 'desktop', viewport: { width: 1440, height: 900 }, dpr: 1, touch: false },
];

for (const p of profiles) {
  const ctx = await browser.newContext({ viewport: p.viewport, deviceScaleFactor: p.dpr, isMobile: p.touch, hasTouch: p.touch });
  const page = await ctx.newPage();
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !!window.__game, null, { timeout: 15000 }).catch(() => {});
  await page.evaluate(() => window.__game.start());
  await sleep(300);
  for (const w of [12, 60, 150]) {
    await page.evaluate((s) => window.__game.warp(s), w === 12 ? 12 : w === 60 ? 48 : 90);
    await sleep(900);
    const snap = await page.evaluate(() => window.__game.snapshot());
    console.log(p.id, 'warp to', w, 'orders', snap.orders.length, 'time', snap.time.toFixed(1), 'patience', snap.score.patience.toFixed(2));
    await page.screenshot({ path: path.join(OUT, `${p.id}-t${w}.png`), timeout: 180000 });
  }
  await ctx.close();
}
await browser.close();
server.close();
console.log('done');
