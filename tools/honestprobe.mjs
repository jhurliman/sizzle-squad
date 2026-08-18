/**
 * IS THE STICK TELLING THE TRUTH?
 *
 *   node tools/honestprobe.mjs [--profiles iphone-portrait,...] [--json out.json]
 *
 * touchprobe.mjs measures the emitted vector against the MATH origin, so by
 * construction it can never see the wave-2A regression: every fidelity number
 * in it (lag 62.00px, magnitude 1.000, angle error 0.00deg) stayed perfect to
 * the digit while the control the player actually looks at drifted 238px away
 * from the finger and steered up to 62deg away from where the thumb pointed.
 * stickprobe.mjs measures where the drawn control ENDS UP, which is the other
 * half, and is likewise blind to the gap between the two.
 *
 * This probe measures ONLY the gap. The player has exactly one reference for
 * "where am I pushing": the ring that is painted on the glass. So the question
 * every number here answers is the player's question — if I read the drawn
 * control, does the chef go where it says?
 *
 *   carry   |drawn knob - finger| through a 700px sprint. A knob that is not
 *           under the thumb is a knob that is lying about which way you push.
 *   truth   angle between the emitted vector and the direction from the DRAWN
 *           ring centre to the finger, every frame of that sprint.
 *   gain    after a 300px sprint, sweep the thumb laterally and divide the
 *           change in emitted heading by the change in the drawn heading.
 *           1.00 is an absolute stick. The wave-2A verdict measured 1.4-2.1.
 *   home    how far the drawn ring sits from the finger at the end of a run,
 *           and whether that distance ever comes back down on its own.
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

const PROFILES = [
  { id: 'iphone-portrait', w: 393, h: 852, ins: { t: 59, b: 34, l: 0, r: 0 } },
  { id: 'iphone-landscape', w: 852, h: 393, ins: { t: 0, b: 21, l: 59, r: 59 } },
  { id: 'ipad-landscape', w: 1194, h: 834, ins: { t: 24, b: 20, l: 0, r: 0 } },
];

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const srv = http.createServer((req, rq) => {
  const u = new URL(req.url, 'http://x');
  let p = path.join(DIST, u.pathname === '/' ? 'index.html' : u.pathname);
  if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) p = path.join(DIST, 'index.html');
  rq.writeHead(200, { 'content-type': MIME[path.extname(p)] ?? 'application/octet-stream' });
  rq.end(fs.readFileSync(p));
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const port = srv.address().port;

if (!fs.existsSync(DIST)) {
  console.error('dist/ missing — npx vite build first');
  process.exit(1);
}

const mkTouch = (cdp, radius = 12) => {
  const down = new Set();
  const send = (type, pts) =>
    cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: pts.map((p) => ({ x: p.x, y: p.y, id: p.id, radiusX: radius, radiusY: radius, force: 1 })),
    });
  return {
    async start(pts) {
      for (const p of pts) down.add(p.id);
      await send('touchStart', pts);
    },
    move: (pts) => send('touchMove', pts),
    async end(pts) {
      if (!down.size) return;
      await send('touchEnd', pts);
      down.clear();
    },
  };
};

/**
 * A FINGER CANNOT LEAVE THE GLASS. Every touch point this probe dispatches is
 * clamped to the viewport, because CDP will happily deliver a touchMove at
 * x=-140 and the numbers that come back from one are fiction: the on-glass
 * clamp in input.ts is doing exactly its job at that point and the probe would
 * be scoring it as a lie. The first version of this file did not clamp, and it
 * reported a 1.44x gain on iphone-landscape that no thumb can reach.
 */
const onGlass = (p, w, h) => ({ ...p, x: Math.max(1, Math.min(w - 1, p.x)), y: Math.max(1, Math.min(h - 1, p.y)) });

const deg = (r) => (r * 180) / Math.PI;
const wrap = (d) => {
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return d;
};
const stats = (a) => {
  const s = a.slice().sort((p, q) => p - q);
  return { med: +s[s.length >> 1].toFixed(2), max: +Math.max(...a).toFixed(2) };
};

/**
 * WHERE THE KNOB IS PAINTED. Mirrors main.ts's draw exactly: the deflection is
 * measured from the math origin, clamped to the radius, and then drawn from
 * the anchor. If this ever drifts from main.ts the probe is measuring fiction,
 * so it is written the same way round, off the same three numbers.
 */
function drawnKnob(row, radius) {
  const dx = row.kx - row.ox;
  const dy = row.ky - row.oy;
  const d = Math.min(radius, Math.hypot(dx, dy));
  const a = Math.atan2(dy, dx);
  return { x: row.ax + Math.cos(a) * d, y: row.ay + Math.sin(a) * d };
}

const PINNED = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({
  executablePath: fs.existsSync(PINNED) ? PINNED : undefined,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});

const only = argv.profiles && argv.profiles !== true ? String(argv.profiles).split(',') : null;
const chosen = PROFILES.filter((p) => !only || only.includes(p.id));
const out = {};

for (const prof of chosen) {
  const { id, w, h, ins } = prof;
  const ctx = await browser.newContext({
    viewport: { width: w, height: h },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 1,
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  });
  const page = await ctx.newPage();
  await page.addInitScript((v) => {
    const css = `:root{--safe-t:${v.t}px !important;--safe-b:${v.b}px !important;--safe-l:${v.l}px !important;--safe-r:${v.r}px !important}`;
    const put = () => {
      const el = document.createElement('style');
      el.textContent = css;
      document.head.appendChild(el);
    };
    if (document.head) put();
    else document.addEventListener('DOMContentLoaded', put);
  }, ins);
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto(`http://127.0.0.1:${port}/?capture=1`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !!window.__game && !!window.__input, null, { timeout: 20000 });
  await page.evaluate(() => {
    const c = document.getElementById('stage');
    if (c) c.style.visibility = 'hidden';
  });
  const cdp = await page.context().newCDPSession(page);
  const touch = mkTouch(cdp);
  await page.evaluate(() => {
    window.__game.start();
    window.__game.setCapture(true);
    window.__input.traceOn = true;
    window.__input.trace.length = 0;
  });
  const step = (n = 1) =>
    page.evaluate((k) => {
      for (let i = 0; i < k; i++) window.__input.sample();
    }, n);
  const clearTrace = () => page.evaluate(() => (window.__input.trace.length = 0));
  const traceOf = () => page.evaluate(() => window.__input.trace.slice());
  const radius = await page.evaluate(() => window.__input.stick.radius);

  const R = { radius };

  // ------------------------------------------------- carry / truth / home
  // A 700px sprint up-and-right, 14px a frame. Every frame we know exactly
  // where the finger is, so the drawn control can be held to it.
  {
    const x0 = Math.round(w * 0.22);
    const y0 = Math.round(h * 0.62);
    const ang = -Math.PI * 0.28;
    await touch.start([{ id: 0, x: x0, y: y0 }]);
    await step(1);
    await clearTrace();
    const finger = [];
    for (let i = 1; i <= 50; i++) {
      const d = i * 14;
      const p = onGlass({ x: x0 + Math.cos(ang) * d, y: y0 + Math.sin(ang) * d }, w, h);
      await touch.move([{ id: 0, ...p }]);
      finger.push(p);
      await step(1);
    }
    const tr = (await traceOf()).filter((r) => r.active);
    const carry = [];
    const truth = [];
    const ringGap = [];
    // The trace has one row per sample() and we stepped once per move, so the
    // tail of the trace lines up with the finger path from the end backwards.
    const n = Math.min(tr.length, finger.length);
    for (let i = 0; i < n; i++) {
      const row = tr[tr.length - n + i];
      const f = finger[finger.length - n + i];
      const k = drawnKnob(row, radius);
      carry.push(Math.hypot(k.x - f.x, k.y - f.y));
      ringGap.push(Math.hypot(row.ax - f.x, row.ay - f.y));
      const m = Math.hypot(row.mx, row.my);
      if (m > 0.2) truth.push(Math.abs(wrap(deg(Math.atan2(row.my, row.mx)) - deg(Math.atan2(f.y - row.ay, f.x - row.ax)))));
    }
    R.carry = stats(carry);
    R.truth = stats(truth);
    R.ringGap = stats(ringGap);
    await touch.end([]);
    await step(3);
  }

  // ------------------------------------------------------------ gain
  // 300px sprint straight up, then sweep the thumb sideways in 8px steps.
  // Gain is d(emitted heading) / d(heading the drawn control shows), taken as
  // a ratio of the total swing so one noisy frame cannot dominate it.
  {
    // 300px of run has to FIT: on an 852x393 landscape a run straight up from
    // 0.8h leaves 314px of screen, so the sprint is scaled to the viewport and
    // the lateral sweep with it. A probe that presses the thumb into the top
    // edge for 20 frames is measuring the clamp, not the stick.
    const run = Math.min(300, Math.round(h * 0.62));
    const sweep = Math.min(96, Math.round(w * 0.24));
    const x0 = Math.round(w * 0.5);
    const y0 = Math.round(h * 0.9);
    await touch.start([{ id: 0, x: x0, y: y0 }]);
    await step(1);
    for (let i = 1; i <= 30; i++) {
      await touch.move([onGlass({ id: 0, x: x0, y: y0 - (i * run) / 30 }, w, h)]);
      await step(1);
    }
    await clearTrace();
    const y1 = y0 - run;
    const samples = [];
    for (let i = 0; i <= 12; i++) {
      const p = onGlass({ x: x0 + (i * sweep) / 12, y: y1 }, w, h);
      await touch.move([{ id: 0, ...p }]);
      await step(1);
      const row = (await traceOf()).at(-1);
      if (row?.active && Math.hypot(row.mx, row.my) > 0.2) {
        samples.push({
          emitted: deg(Math.atan2(row.my, row.mx)),
          drawn: deg(Math.atan2(p.y - row.ay, p.x - row.ax)),
        });
      }
    }
    const first = samples[0];
    const last = samples.at(-1);
    const dEmit = Math.abs(wrap(last.emitted - first.emitted));
    const dDrawn = Math.abs(wrap(last.drawn - first.drawn));
    R.gain = {
      runPx: run,
      sweepPx: sweep,
      emittedSwingDeg: +dEmit.toFixed(2),
      drawnSwingDeg: +dDrawn.toFixed(2),
      gain: dDrawn > 0.5 ? +(dEmit / dDrawn).toFixed(3) : null,
    };
    // The steady-state lie: after all that, how far apart are the two headings?
    R.gain.endHeadingErrDeg = +Math.abs(wrap(last.emitted - last.drawn)).toFixed(2);
    await touch.end([]);
    await step(3);
  }

  R.console = errors.length ? errors.slice(0, 3) : 'clean';
  out[id] = R;

  console.log(`\n=== ${id} ${w}x${h}   stick radius ${radius}px`);
  console.log(`  carry      drawn knob sits med ${R.carry.med}px / max ${R.carry.max}px from the finger through a 700px sprint`);
  console.log(`  ringGap    drawn ring centre med ${R.ringGap.med}px / max ${R.ringGap.max}px from the finger`);
  console.log(`  truth      emitted heading vs the heading the drawn control shows: med ${R.truth.med}deg / max ${R.truth.max}deg`);
  console.log(
    `  gain       lateral sweep after a ${R.gain.runPx}px sprint: emitted swings ${R.gain.emittedSwingDeg}deg while the drawn control swings ${R.gain.drawnSwingDeg}deg -> gain ${R.gain.gain} (1.00 = absolute); heading error at the end ${R.gain.endHeadingErrDeg}deg`,
  );
  console.log(`  console    ${R.console === 'clean' ? 'clean' : R.console.join(' | ')}`);
  await ctx.close();
}

await browser.close();
srv.close();
if (argv.json && argv.json !== true) fs.writeFileSync(path.resolve(ROOT, String(argv.json)), JSON.stringify(out, null, 2));
