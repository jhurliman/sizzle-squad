/**
 * Fast single-profile preview. The full harness renders four profiles at up to
 * 2880x1800 under swiftshader and takes ~6 minutes; this takes ~40 seconds, so
 * it is what you iterate against. It uses `__game.warp()` to fast-forward the
 * sim WITHOUT rendering, which is the only way to reach a state where the cast
 * is actually carrying things on a software rasteriser.
 *
 *   node tools/peek.mjs --out shots/peek [--warps 4,3,3] [--w 1440] [--h 900] [--dpr 1]
 *
 * Always finish with tools/shoot.mjs before you call anything done.
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
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1]?.startsWith('--') ? true : arr[i + 1]]);
    return acc;
  }, []),
);
const OUT = path.resolve(ROOT, argv.out ?? 'shots/peek');
const WARPS = String(argv.warps ?? '5,4,4').split(',').map(Number);
const W = Number(argv.w ?? 1440);
const H = Number(argv.h ?? 900);
const DPR = Number(argv.dpr ?? 1);

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };

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

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
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
      '--force-device-scale-factor=1',
    ],
  });
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: DPR });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));

  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !!window.__game, null, { timeout: 15000 }).catch(() => {});
  await sleep(500);
  await page.screenshot({ path: path.join(OUT, '00-title.png'), timeout: 180000 });

  await page.evaluate(() => window.__game.start());
  await sleep(400);

  const states = [];
  for (let i = 0; i < WARPS.length; i++) {
    await page.evaluate((s) => window.__game.warp(s), WARPS[i]);
    await sleep(900);
    await page.screenshot({ path: path.join(OUT, `s${i + 1}.png`), timeout: 180000 });
    states.push(await page.evaluate(() => window.__game.snapshot()));
  }

  fs.writeFileSync(
    path.join(OUT, 'peek.json'),
    JSON.stringify({ errors, states: states.map((s) => ({ time: s.time, chefs: s.chefs })) }, null, 2),
  );
  for (const s of states) {
    console.log(
      `t=${s.time.toFixed(1)} ` +
        s.chefs.map((c) => `${c.skin}@${c.x},${c.y}:${c.carrying ?? '-'}`).join('  '),
    );
  }
  console.log(`errors=${errors.length}`);
  await ctx.close();
  await browser.close();
  server.close();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
