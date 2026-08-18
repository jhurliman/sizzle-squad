/**
 * Camera telemetry over a whole run, without paying for screenshots.
 *
 *   node tools/camtrace.mjs [--seconds 30] [--step 0.25]
 *
 * shoot.mjs snapshots twice per profile, which is enough to see a rest pose and
 * not nearly enough to see what a follow camera does across a service. This
 * drives the same capture path and calls the rig's own describe() every step,
 * then prints the DISTRIBUTION of the numbers a critic reads off the pixels —
 * the room-centre offset, the player's position across the frame, the join and
 * the bottom edge — plus every warning the rig raised and how often.
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
const SECONDS = Number(argv.seconds ?? 30);
const STEP = Number(argv.step ?? 0.25);

const ALL = [
  { id: 'iphone-portrait', w: 393, h: 852, touch: true },
  { id: 'iphone-landscape', w: 852, h: 393, touch: true },
  { id: 'ipad-landscape', w: 1194, h: 834, touch: true },
  { id: 'desktop', w: 1440, h: 900, touch: false },
];
const only = argv.profiles && argv.profiles !== true ? String(argv.profiles).split(',') : null;
const PROFILES = only ? ALL.filter((p) => only.includes(p.id)) : ALL;

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
function serve(dir) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let file = path.join(dir, decodeURIComponent(new URL(req.url, 'http://x').pathname));
      if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(dir, 'index.html');
      if (!fs.existsSync(file)) { res.writeHead(404); return res.end('nope'); }
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

const plan = [
  { move: { x: 0, y: 1 }, s: 0.9 }, { grab: true, s: 0.12 },
  { move: { x: -0.9, y: -0.6 }, s: 1.1 }, { move: { x: -1, y: 0 }, s: 0.7 },
  { grab: true, s: 0.12 }, { use: true, s: 1.9 }, { use: false, s: 0.1 },
  { grab: true, s: 0.15 }, { move: { x: 1, y: -0.5 }, dash: true, s: 0.9 },
  { move: { x: 0, y: -1 }, s: 0.8 }, { grab: true, s: 0.15 },
  { move: { x: 0.6, y: 1 }, s: 0.9 }, { move: { x: 0, y: 0 }, s: 0.4 },
];

function stat(name, xs, fmt = 3) {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return `${name} min ${s[0].toFixed(fmt)}  p50 ${q(0.5).toFixed(fmt)}  p90 ${q(0.9).toFixed(fmt)}  max ${s[s.length - 1].toFixed(fmt)}`;
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
  ],
});
for (const p of PROFILES) {
  const ctx = await browser.newContext({ viewport: { width: p.w, height: p.h }, deviceScaleFactor: 1, hasTouch: p.touch, isMobile: p.touch });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__game, null, { timeout: 20000 });
  await page.evaluate(() => window.__game.setCapture(true));
  await page.waitForTimeout(50);
  await page.evaluate(() => window.__game.start());
  await page.evaluate((v) => window.__game.setInput(v), { enabled: true });
  const rows = await page.evaluate(
    ({ seconds, step, plan }) => {
      const out = [];
      let t = 0;
      let pi = 0;
      while (t < seconds) {
        const d = plan[pi % plan.length];
        pi++;
        window.__game.setInput({
          enabled: true,
          move: d.move ?? { x: 0, y: 0 },
          grabPressed: !!d.grab,
          useHeld: !!d.use,
          dashPressed: !!d.dash,
        });
        let left = d.s ?? 0.4;
        while (left > 1e-4) {
          const slice = Math.min(left, step);
          window.__game.advance(slice);
          t += slice;
          left -= slice;
          const snap = window.__game.snapshot();
          const c = snap.camera;
          c.px = snap.chefs.find((q) => q.isPlayer)?.x ?? 0;
          c.py = snap.chefs.find((q) => q.isPlayer)?.y ?? 0;
          out.push(c);
        }
      }
      return out;
    },
    { seconds: SECONDS, step: STEP, plan },
  );
  const pick = (k) => rows.map((r) => r[k]);
  const warn = new Map();
  // describe() splits defects from counted composition events; a trace that
  // reads only `warnings` would stop seeing the rescue entirely. Both, tagged.
  for (const r of rows) for (const w of [...r.warnings, ...(r.notes ?? []).map((n) => `note: ${n}`)]) {
    const key = w.replace(/-?\d+\.\d+/g, '#');
    warn.set(key, (warn.get(key) ?? 0) + 1);
  }
  console.log(`\n== ${p.id}  ${rows.length} samples, ${errors.length} console errors`);
  console.log('  ' + stat('centreOffset  ', pick('centreOffset')));
  console.log('  ' + stat('|playerFrac|  ', pick('playerFrac').map(Math.abs)));
  console.log('  ' + stat('join          ', pick('wallFloorJoin')));
  console.log('  ' + stat('bottomEdgeZ   ', pick('bottomEdgeZ'), 2));
  console.log('  ' + stat('camZ          ', pick('camZ'), 2));
  console.log('  ' + stat('backWallFrac  ', pick('backWallFrac')));
  console.log('  ' + stat('visibleDepth  ', pick('visibleDepthRatio'), 2));
  if (!warn.size) console.log('  warnings: none');
  for (const [k, n] of [...warn].sort((a, b) => b[1] - a[1]))
    console.log(`  warn ${((n / rows.length) * 100).toFixed(0).padStart(3)}%  ${k}`);
  await ctx.close();
}
await browser.close();
server.close();
