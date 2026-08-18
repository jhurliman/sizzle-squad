/**
 * HUD/orders instrument.
 *
 *   node tools/hud-probe.mjs            geometry: icon size, balloon rects, strip fit
 *   node tools/hud-probe.mjs shots/x    also warps until a THIRD ticket is live and
 *                                       screenshots it, plus a forced ready state
 *
 * Exists because the two things this piece is judged on — "is the food 8% of
 * frame height" and "does the third ticket have a home" — are both numbers, and
 * a screenshot alone cannot tell you either one.
 */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const OUT = process.argv[2] ? path.resolve(ROOT, process.argv[2]) : null;

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
function serve(dir) {
  return new Promise((res) => {
    const s = http.createServer((req, rq) => {
      const u = new URL(req.url, 'http://x');
      let p = path.join(dir, u.pathname === '/' ? 'index.html' : u.pathname);
      if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) p = path.join(dir, 'index.html');
      rq.writeHead(200, { 'content-type': MIME[path.extname(p)] ?? 'application/octet-stream' });
      rq.end(fs.readFileSync(p));
    });
    s.listen(0, '127.0.0.1', () => res({ server: s, port: s.address().port }));
  });
}

const PROFILES = [
  ['iphone-portrait', 393, 852],
  ['iphone-landscape', 852, 393],
  ['ipad-landscape', 1194, 834],
  ['desktop', 1440, 900],
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (OUT) fs.mkdirSync(OUT, { recursive: true });
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
    '--force-device-scale-factor=1',
  ],
});

for (const [id, width, height] of PROFILES) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const cdp = await page.context().newCDPSession(page);
  await page.goto(`http://127.0.0.1:${port}/?capture=1`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !!window.__game, null, { timeout: 15000 }).catch(() => {});
  await page.evaluate(() => window.__game.start());
  let n = 0;
  for (let i = 0; i < 40; i++) {
    n = await page.evaluate(() => {
      window.__game.warp(2);
      return window.__game.snapshot().orders.length;
    });
    if (n >= 3) break;
  }
  await sleep(1800);
  const out = await page.evaluate((h) => {
    const layer = document.querySelector('.bubbles');
    const cs = getComputedStyle(layer);
    const bubs = [...document.querySelectorAll('.bub')].map((b) => {
      const r = (q) => {
        const e = b.querySelector(q);
        if (!e) return null;
        const x = e.getBoundingClientRect();
        return [Math.round(x.left), Math.round(x.top), Math.round(x.width), Math.round(x.height)];
      };
      return { cls: b.className.replace('bub ', ''), bal: r('.balloon'), ico: r('.ico'), awn: r('.awn') };
    });
    // Force a ready state on the first ticket and read back what CSS decided.
    const first = document.querySelector('.bub');
    let readyAnim = null;
    if (first) {
      first.classList.add('ready');
      readyAnim = getComputedStyle(first.querySelector('.balloon')).animationName;
      first.classList.remove('ready');
    }
    const box = (q) => {
      const e = document.querySelector(q);
      if (!e) return null;
      const x = e.getBoundingClientRect();
      return [Math.round(x.left), Math.round(x.right)];
    };
    return {
      icon: cs.getPropertyValue('--icon'),
      awnOff: cs.getPropertyValue('--awn-off'),
      bubs,
      iconPctH: bubs[0]?.ico ? +((100 * bubs[0].ico[3]) / h).toFixed(1) : null,
      score: getComputedStyle(document.querySelector('#score')).fontSize,
      scorePctH: +((100 * parseFloat(getComputedStyle(document.querySelector('#score')).fontSize)) / h).toFixed(1),
      facePctH: +((100 * (document.querySelector('.face')?.getBoundingClientRect().height ?? 0)) / h).toFixed(1),
      readyAnim,
      scorePill: box('.pill-score'),
      clockPill: box('.pill-clock'),
      pause: box('#btnPause'),
      servedPill: box('.pill-served'),
      squadOuter: box('.strip-left .face'),
      passOuter: box('.squad-pass .face:last-child'),
    };
  }, height);
  console.log(`\n${id} ${width}x${height}  orders=${n}`);
  console.log(
    `  icon=${out.icon} (${out.iconPctH}% of frame H)  awnOff=${out.awnOff}  score=${out.score} (${out.scorePctH}%)  face=${out.facePctH}%`,
  );
  console.log(`  readyAnim=${out.readyAnim}`);
  const L = out.squadOuter && out.scorePill ? [Math.min(out.squadOuter[0], out.scorePill[0]), Math.max(out.squadOuter[1], out.scorePill[1])] : out.scorePill;
  const Rr = out.passOuter && out.servedPill ? [Math.min(out.passOuter[0], out.servedPill[0]), Math.max(out.passOuter[1], out.servedPill[1])] : out.servedPill;
  const wid = (b) => (b ? b[1] - b[0] : 0);
  console.log(`  strip: score${JSON.stringify(out.scorePill)} clock${JSON.stringify(out.clockPill)} served${JSON.stringify(out.servedPill)}`);
  console.log(`  TRIAD: leftObj=${wid(L)} rightObj=${wid(Rr)} ratio=${(wid(L) / Math.max(1, wid(Rr))).toFixed(2)}  gapL=${out.clockPill && L ? out.clockPill[0] - L[1] : '?'} (${out.clockPill && L ? (100 * (out.clockPill[0] - L[1]) / width).toFixed(1) : '?'}%)  gapR=${out.clockPill && Rr ? Rr[0] - out.clockPill[1] : '?'} (${out.clockPill && Rr ? (100 * (Rr[0] - out.clockPill[1]) / width).toFixed(1) : '?'}%)`);
  for (const b of out.bubs) console.log(`   [${b.cls}] bal=${JSON.stringify(b.bal)} awn=${JSON.stringify(b.awn)}`);
  if (OUT) {
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 84, fromSurface: false });
    fs.writeFileSync(path.join(OUT, `${id}.jpg`), Buffer.from(data, 'base64'));
  }
  await ctx.close();
}
await browser.close();
server.close();
