/**
 * THE THUMB, MEASURED.
 *
 *   node tools/touchprobe.mjs [--profiles iphone-portrait,...] [--json out.json]
 *
 * Everything else in tools/ drives the game through window.__game.setInput(),
 * which BYPASSES src/input entirely — the scripted hook writes an
 * InputSnapshot straight into the loop. So the touch layer, which is what the
 * majority of players will actually hold, has never once been exercised by the
 * harness. Not the stick, not the buttons, not multi-touch, not a cancel.
 *
 * This drives CDP Input.dispatchTouchEvent, which produces genuine
 * Pointer/Touch events in Chromium — the same code path a finger takes — and
 * reads back src/input's own per-frame trace buffer (InputManager.trace).
 * Real insets are injected exactly the way shoot.mjs --insets does.
 *
 * Tests, each printing a number, not a verdict:
 *   region     which control owns every pixel of the screen (16px grid)
 *   spawn      does the stick appear under the thumb, exactly
 *   sprint     a 700px drag: origin lag, magnitude, direction error
 *   deadzone   1px sweep out from the origin: where does the chef start moving
 *   angles     36 directions: emitted angle vs thumb angle
 *   buttons    tap the centre and the four edges of every action disc
 *   second     a second finger on grab/chop while the stick is running
 *   cancel     touchCancel mid-sprint, and what it takes to recover
 *   reach      thumb-arc distance to each disc from a one-handed grip pivot
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

/**
 * CDP touch: `pts` is [{id,x,y}]. Tracks what is currently down, because CDP
 * throws "Must send a TouchStart first" if you lift nothing, and a probe that
 * dies half way through is a probe that measures nothing.
 */
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
      if (!pts.length) down.clear();
      else for (const p of pts) down.delete(p.id);
    },
    async cancel() {
      // CDP requires touchCancel to carry NO points; it cancels everything.
      if (!down.size) return;
      await send('touchCancel', []);
      down.clear();
    },
    get count() {
      return down.size;
    },
  };
};

const T0 = Date.now();
const mark = (s) => console.log(`  [${((Date.now() - T0) / 1000).toFixed(1)}s] ${s}`);
const fmt = (n, d = 2) => (Number.isFinite(n) ? n.toFixed(d) : '?');

async function run() {
  if (!fs.existsSync(DIST)) {
    console.error('dist/ missing — npx vite build first');
    process.exit(1);
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
    ],
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
      if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`);
    });
    page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));

    await page.goto(`http://127.0.0.1:${port}/?capture=1`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => !!window.__game && !!window.__input, null, { timeout: 20000 });
    mark('loaded');
    // See the note on step(): the canvas is the whole cost of this probe.
    await page.evaluate(() => {
      const c = document.getElementById('stage');
      if (c) c.style.visibility = 'hidden';
    });
    const cdp = await page.context().newCDPSession(page);
    const touch = mkTouch(cdp);

    // Real service, harness clock: advance() runs the true frame loop, so
    // every touch we dispatch is sampled by the same sample() a player hits.
    await page.evaluate(() => {
      window.__game.start();
      window.__game.setCapture(true);
      window.__input.traceOn = true;
      window.__input.trace.length = 0;
    });
    /**
     * ONE FRAME OF INPUT, NOT ONE FRAME OF GAME.
     *
     * Measured on this box: window.__game.advance(1/60) costs 1518ms because
     * it renders through the software rasteriser, and even a bare CDP touch
     * dispatch costs 974ms because the event forces a compositor paint of the
     * WebGL canvas. Hiding the canvas (it is position:absolute, so nothing
     * else moves) takes those to 49ms, and stepping input through the very
     * function the loop calls — InputManager.sample() — takes it to 2ms.
     * Full probe: ~7 minutes to ~25 seconds, same code path, same numbers.
     */
    const step = (n = 1) =>
      page.evaluate((k) => {
        for (let i = 0; i < k; i++) window.__input.sample();
      }, n);
    /** The real loop, sim and all. Used only where the chef must actually move. */
    const simStep = (sec) => page.evaluate((v) => window.__game.advance(v), sec);
    const stick = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__input.stick)));
    const lastRow = () => page.evaluate(() => window.__input.trace.at(-1) ?? null);
    const clearTrace = () => page.evaluate(() => (window.__input.trace.length = 0));
    const traceOf = () => page.evaluate(() => window.__input.trace.slice());
    const lift = async () => {
      await touch.end([]);
      await step(2);
    };

    /**
     * THE CONTROLS HAVE NEVER BEEN PHOTOGRAPHED IN USE.
     *
     * shoot.mjs drives the scripted hook, so no frame it has ever taken has a
     * thumb down: no stick ring, no knob, no pressed disc. --shots takes them,
     * with the fingers where a player's would be and the same real insets.
     * The canvas is un-hidden for the render and re-hidden after, because a
     * render costs 1.5s on this box and a probe costs 25.
     */
    const SHOTS = argv.shots && argv.shots !== true ? path.resolve(ROOT, String(argv.shots), id) : null;
    if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
    const capture = async (name) => {
      if (!SHOTS) return;
      // Let CSS transitions land. The press is a 70ms move, and a frame taken
      // the instant the finger touches down photographs the button on its way
      // rather than pressed — which is how a broken press state hides.
      await new Promise((r) => setTimeout(r, 160));
      await page.evaluate(() => {
        const c = document.getElementById('stage');
        if (c) c.style.visibility = 'visible';
      });
      await page.evaluate(() => window.__game.advance(1 / 60));
      const { data } = await cdp.send('Page.captureScreenshot', {
        format: 'jpeg',
        quality: 82,
        fromSurface: false,
        captureBeyondViewport: false,
      });
      fs.writeFileSync(path.join(SHOTS, `${name}.jpg`), Buffer.from(data, 'base64'));
      await page.evaluate(() => {
        const c = document.getElementById('stage');
        if (c) c.style.visibility = 'hidden';
      });
    };

    const R = { id, viewport: [w, h], insets: ins };

    // ---------------------------------------------------------- geometry
    mark('geometry');
    R.geom = await page.evaluate(() => {
      const rect = (sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const b = el.getBoundingClientRect();
        return { x: +b.x.toFixed(1), y: +b.y.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1) };
      };
      return {
        cluster: rect('.action-cluster'),
        grab: rect('#btnGrab'),
        use: rect('#btnUse'),
        dash: rect('#btnDash'),
      };
    });

    // ---------------------------------------------------------- regions
    mark('regions');
    // Which control owns each pixel, off the SHIPPED predicate plus real
    // hit-testing for the buttons. Anything owned by nobody is a tap that
    // does nothing, and those are counted in px^2 of the frame.
    R.region = await page.evaluate(() => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      const S = 8;
      const counts = { stick: 0, button: 0, dead: 0 };
      const grid = [];
      for (let y = S / 2; y < h; y += S) {
        const row = [];
        for (let x = S / 2; x < w; x += S) {
          const el = document.elementFromPoint(x, y);
          const btn = el && el.closest ? el.closest('.btn') : null;
          let k;
          if (btn) k = 'button';
          else k = window.__input.regionAt(x, y) === 'stick' ? 'stick' : 'dead';
          counts[k]++;
          row.push(k[0]);
        }
        grid.push(row.join(''));
      }
      const total = counts.stick + counts.button + counts.dead;
      return {
        pctStick: +((100 * counts.stick) / total).toFixed(1),
        pctButton: +((100 * counts.button) / total).toFixed(1),
        pctDead: +((100 * counts.dead) / total).toFixed(1),
        grid,
      };
    });

    // Ground-truth the predicate with real touches at a scatter of points.
    {
      const pts = [];
      for (let i = 0; i < 12; i++) {
        const x = Math.round(((i % 4) + 0.5) * (w / 4));
        const y = Math.round((Math.floor(i / 4) + 0.5) * (h / 3));
        pts.push([x, y]);
      }
      const mismatch = [];
      for (const [x, y] of pts) {
        const predicted = await page.evaluate(([x, y]) => window.__input.regionAt(x, y), [x, y]);
        await touch.start([{ id: 0, x, y }]);
        await step(1);
        const s = await stick();
        await lift();
        const actual = s.active ? 'stick' : 'not-stick';
        const ok = (predicted === 'stick') === (actual === 'stick');
        if (!ok) mismatch.push({ x, y, predicted, actual });
      }
      R.regionTruth = { sampled: pts.length, mismatch };
    }

    // ------------------------------------------------- pointer identity
    // The manager keys the chop hold on a POINTER ID and uses the literal 1 as
    // a sentinel for "held by something that is not a pointer" (gamepad, HUD).
    // If a real touch ever gets pointerId 1 those two namespaces collide.
    {
      await page.evaluate(() => {
        window.__pid = [];
        const rec = (e) => window.__pid.push({ type: e.type, id: e.pointerId, target: e.target.id || e.target.className || e.target.tagName });
        for (const t of ['pointerdown', 'pointerup', 'pointercancel']) window.addEventListener(t, rec, true);
      });
      await touch.start([{ id: 0, x: Math.round(w * 0.3), y: Math.round(h * 0.6) }]);
      await touch.start([
        { id: 0, x: Math.round(w * 0.3), y: Math.round(h * 0.6) },
        { id: 1, x: Math.round(w * 0.35), y: Math.round(h * 0.7) },
      ]);
      await touch.end([]);
      await step(1);
      R.pointerIds = await page.evaluate(() => window.__pid.slice());
    }

    // ---------------------------------------------------------- spawn
    mark('spawn');
    // The stick must appear exactly under the thumb, not snap to a corner.
    {
      const pts = [
        [40, h - 40],
        [Math.round(w * 0.25), Math.round(h * 0.5)],
        [12, 12],
        [Math.round(w * 0.45), h - 12],
      ];
      const rows = [];
      for (const [x, y] of pts) {
        await touch.start([{ id: 0, x, y }]);
        await step(1);
        const s = await stick();
        rows.push({ at: [x, y], active: s.active, offset: +Math.hypot(s.origin.x - x, s.origin.y - y).toFixed(2) });
        await lift();
      }
      R.spawn = rows;
    }

    // ---------------------------------------------------------- sprint
    mark('sprint');
    // 700px of drag in 14px steps, one frame per step: the long diagonal
    // sprint across a kitchen. Origin lag is the distance from thumb to
    // origin (must stay == radius once saturated); mag must sit at 1.0.
    {
      const x0 = Math.round(w * 0.22);
      const y0 = Math.round(h * 0.62);
      await touch.start([{ id: 0, x: x0, y: y0 }]);
      await step(1);
      await clearTrace();
      const ang = -Math.PI * 0.28; // up and to the right
      const N = 50;
      for (let i = 1; i <= N; i++) {
        const d = i * 14;
        await touch.move([{ id: 0, x: x0 + Math.cos(ang) * d, y: y0 + Math.sin(ang) * d }]);
        await step(1);
      }
      const tr = await traceOf();
      const lag = [];
      const mag = [];
      const errDeg = [];
      for (const r of tr) {
        if (!r.active) continue;
        lag.push(Math.hypot(r.kx - r.ox, r.ky - r.oy));
        const m = Math.hypot(r.mx, r.my);
        mag.push(m);
        if (m > 0.2) {
          let d = ((Math.atan2(r.my, r.mx) - ang) * 180) / Math.PI;
          while (d > 180) d -= 360;
          while (d < -180) d += 360;
          errDeg.push(Math.abs(d));
        }
      }
      const stats = (a) => ({
        min: +Math.min(...a).toFixed(3),
        med: +a.slice().sort((p, q) => p - q)[a.length >> 1].toFixed(3),
        max: +Math.max(...a).toFixed(3),
      });
      // How many frames of the sprint ran at less than 95% speed
      const slow = mag.filter((m) => m < 0.95).length;
      R.sprint = {
        frames: mag.length,
        lagPx: stats(lag),
        mag: stats(mag),
        framesBelow95pct: slow,
        angleErrDeg: errDeg.length ? stats(errDeg) : null,
      };
      await lift();
    }

    // ------------------------------------------------------ end-to-end
    // The one test that proves the whole chain: a real finger drag, the real
    // frame loop, and the chef's own position out of the sim. Four directions,
    // because a chef parked against a bench measures zero however good the
    // stick is.
    {
      const x0 = Math.round(w * 0.25);
      const y0 = Math.round(h * 0.6);
      const at = () =>
        page.evaluate(() => {
          const c = window.__game.snapshot().chefs.find((c) => c.isPlayer);
          return [c.x, c.y, c.speed];
        });
      const dirs = [
        ['up', 0, -80],
        ['down', 0, 80],
        ['left', -80, 0],
        ['right', 80, 0],
      ];
      const rows = [];
      for (const [name, dx, dy] of dirs) {
        const p0 = await at();
        await touch.start([{ id: 0, x: x0, y: y0 }]);
        await touch.move([{ id: 0, x: x0 + dx, y: y0 + dy }]);
        await simStep(0.5);
        const p1 = await at();
        await touch.end([{ id: 0, x: x0 + dx, y: y0 + dy }]);
        await simStep(0.35);
        const p2 = await at();
        rows.push({
          dir: name,
          movedUnits: +Math.hypot(p1[0] - p0[0], p1[1] - p0[1]).toFixed(2),
          speedHeld: p1[2],
          speedAfterLift: p2[2],
        });
      }
      // CONTROL: the same four directions through the scripted hook, which
      // bypasses src/input entirely. If the numbers match, the touch layer is
      // faithful and any shortfall belongs to the world, not the thumb.
      const ctrl = [];
      for (const [name, dx, dy] of dirs) {
        const p0 = await at();
        const m = Math.hypot(dx, dy);
        await page.evaluate((v) => window.__game.setInput({ enabled: true, move: v }), { x: dx / m, y: dy / m });
        await simStep(0.5);
        const p1 = await at();
        await page.evaluate(() => window.__game.setInput({ enabled: false, move: { x: 0, y: 0 } }));
        await simStep(0.35);
        ctrl.push({ dir: name, movedUnits: +Math.hypot(p1[0] - p0[0], p1[1] - p0[1]).toFixed(2), speedHeld: p1[2] });
      }
      R.endToEnd = rows;
      R.endToEndScripted = ctrl;
    }

    // ---------------------------------------------------------- deadzone
    mark('deadzone');
    // Push out 1px at a time and record the emitted magnitude. Reports the
    // px at which the chef first moves at all, and where it reaches 50%.
    {
      const x0 = Math.round(w * 0.25);
      const y0 = Math.round(h * 0.6);
      await touch.start([{ id: 0, x: x0, y: y0 }]);
      await step(1);
      const curve = [];
      for (let d = 0; d <= 70; d += 1) {
        await touch.move([{ id: 0, x: x0 + d, y: y0 }]);
        await step(1);
        const r = await lastRow();
        curve.push(+Math.hypot(r.mx, r.my).toFixed(4));
      }
      const first = curve.findIndex((v) => v > 0);
      const half = curve.findIndex((v) => v >= 0.5);
      const full = curve.findIndex((v) => v >= 0.999);
      R.deadzone = { firstMovePx: first, half50Px: half, fullPx: full, curve };
      await lift();
    }

    // ------------------------------------------------------- sim turn
    // CONTROL FOR THE ONE ABOVE. The chef has its own acceleration; if the sim
    // takes longer to turn around than the stick does, the stick's reversal
    // cost is hidden inside it and is not worth spending feel on.
    {
      const vel = () =>
        page.evaluate(() => {
          const c = window.__game.snapshot().chefs.find((c) => c.isPlayer);
          return [c.x, c.y, c.speed];
        });
      await page.evaluate(() => window.__game.setInput({ enabled: true, move: { x: 1, y: 0 } }));
      await simStep(0.5);
      const a = await vel();
      await page.evaluate(() => window.__game.setInput({ move: { x: -1, y: 0 } }));
      let flipMs = -1;
      let prev = a[0];
      for (let i = 1; i <= 12; i++) {
        await simStep(3 / 60);
        const b = await vel();
        if (flipMs < 0 && b[0] < prev - 1e-4) flipMs = +((i * 3 * 1000) / 60).toFixed(0);
        prev = b[0];
      }
      const c = await vel();
      await page.evaluate(() => window.__game.setInput({ enabled: false, move: { x: 0, y: 0 } }));
      await simStep(0.2);
      R.simTurn = { xReversesAfterMs: flipMs, speedBefore: a[2], speedAfter: c[2] };
    }

    // --------------------------------------------------------- reverse
    // THE COST OF THE ORIGIN DRAG. Dragging the origin is what keeps a sprint
    // saturated, but it also parks the origin a full radius BEHIND the thumb,
    // so a change of mind has to walk the thumb back across the whole ring
    // before the chef turns. Measured in px of thumb travel from the moment
    // the thumb reverses to the moment the sim sees 90% speed the other way;
    // 800px/s is a brisk thumb, so px/0.8 is roughly milliseconds.
    {
      const x0 = Math.round(w * 0.3);
      const y0 = Math.round(h * 0.55);
      await touch.start([{ id: 0, x: x0, y: y0 }]);
      await step(1);
      for (let i = 1; i <= 10; i++) {
        await touch.move([{ id: 0, x: x0 + i * 30, y: y0 }]);
        await step(1);
      }
      const peak = x0 + 300;
      let flipPx = -1;
      let ninetyPx = -1;
      for (let d = 3; d <= 200; d += 3) {
        await touch.move([{ id: 0, x: peak - d, y: y0 }]);
        await step(1);
        const r = await lastRow();
        if (flipPx < 0 && r.mx < 0) flipPx = d;
        if (ninetyPx < 0 && r.mx <= -0.9) {
          ninetyPx = d;
          break;
        }
      }
      R.reverse = { flipPx, ninetyPx, msAt800: ninetyPx > 0 ? +((ninetyPx / 800) * 1000).toFixed(0) : -1 };
      await lift();
    }

    // ---------------------------------------------------------- angles
    mark('angles');
    {
      const x0 = Math.round(w * 0.25);
      const y0 = Math.round(h * 0.55);
      const errs = [];
      for (let i = 0; i < 36; i++) {
        const a = (i * Math.PI * 2) / 36;
        await touch.start([{ id: 0, x: x0, y: y0 }]);
        await step(1);
        await touch.move([{ id: 0, x: x0 + Math.cos(a) * 40, y: y0 + Math.sin(a) * 40 }]);
        await step(1);
        const r = await lastRow();
        let d = ((Math.atan2(r.my, r.mx) - a) * 180) / Math.PI;
        while (d > 180) d -= 360;
        while (d < -180) d += 360;
        errs.push({ deg: Math.round((a * 180) / Math.PI), err: +d.toFixed(2), mag: +Math.hypot(r.mx, r.my).toFixed(3) });
        await lift();
      }
      const mags = errs.map((e) => e.mag);
      R.angles = {
        maxErrDeg: +Math.max(...errs.map((e) => Math.abs(e.err))).toFixed(2),
        magMin: +Math.min(...mags).toFixed(3),
        magMax: +Math.max(...mags).toFixed(3),
        worst: errs.slice().sort((a, b) => Math.abs(b.err) - Math.abs(a.err))[0],
      };
    }

    // ---------------------------------------------------------- buttons
    mark('buttons');
    // Centre plus four points 2px inside each edge, plus four points 10px
    // OUTSIDE each edge (the near-miss a thumb actually produces).
    {
      const rows = [];
      for (const [name, key] of [
        ['grab', 'grab'],
        ['use', 'use'],
        ['dash', 'dash'],
      ]) {
        const b = R.geom[key];
        if (!b) continue;
        const cx = b.x + b.w / 2;
        const cy = b.y + b.h / 2;
        const probes = [
          ['centre', cx, cy],
          ['left+2', b.x + 2, cy],
          ['right-2', b.x + b.w - 2, cy],
          ['top+2', cx, b.y + 2],
          ['bot-2', cx, b.y + b.h - 2],
          ['miss-l10', b.x - 10, cy],
          ['miss-t10', cx, b.y - 10],
          ['miss-b10', cx, b.y + b.h + 10],
          ['miss-r10', b.x + b.w + 10, cy],
        ];
        for (const [label, x, y] of probes) {
          if (x < 0 || y < 0 || x > w || y > h) {
            rows.push({ btn: name, at: label, fired: 'offscreen' });
            continue;
          }
          await clearTrace();
          const elem = await page.evaluate(
            ([x, y]) => {
              const e = document.elementFromPoint(x, y);
              return e ? e.id || (typeof e.className === 'string' ? e.className : e.tagName) : 'null';
            },
            [x, y],
          );
          await touch.start([{ id: 0, x, y }]);
          await step(2);
          const tr = await traceOf();
          const s = await stick();
          // Does the disc VISIBLY answer? :active has to survive a real touch,
          // and a press the player cannot see is a press they will repeat.
          // Read it AFTER the 70ms transition has had time to land, or the
          // computed value is the identity matrix the transition starts from
          // and every press looks like no press.
          let pressed = null;
          if (label === 'centre') {
            await new Promise((r) => setTimeout(r, 140));
            pressed = await page.evaluate((sel) => {
              const el = document.querySelector(sel);
              const cs = getComputedStyle(el);
              return { transform: cs.transform, cls: el.className, shadow: cs.boxShadow.slice(0, 40) };
            }, `#btn${name[0].toUpperCase()}${name.slice(1)}`);
          }
          await lift();
          await step(2);
          const fired =
            name === 'use' ? tr.some((r) => r.use) : name === 'grab' ? tr.some((r) => r.grab) : tr.some((r) => r.dash);
          rows.push({ btn: name, at: label, fired, elem, pressed, stickStolen: s.active });
        }
      }
      R.buttons = rows;
    }

    // ---------------------------------------------------------- second finger
    mark('second finger');
    // Stick running with finger 0; finger 1 taps grab, then holds chop, then
    // finger 0 lifts. Nothing may be lost in either direction.
    {
      const x0 = Math.round(w * 0.22);
      const y0 = Math.round(h * 0.6);
      const g = R.geom.grab;
      const u = R.geom.use;
      const gc = [g.x + g.w / 2, g.y + g.h / 2];
      const uc = [u.x + u.w / 2, u.y + u.h / 2];
      await clearTrace();
      await touch.start([{ id: 0, x: x0, y: y0 }]);
      await touch.move([{ id: 0, x: x0 + 50, y: y0 - 30 }]);
      await step(2);
      const beforeMag = await lastRow().then((r) => Math.hypot(r.mx, r.my));
      // second finger down on grab
      await touch.start([
        { id: 0, x: x0 + 50, y: y0 - 30 },
        { id: 1, x: gc[0], y: gc[1] },
      ]);
      await step(2);
      const midMag = await lastRow().then((r) => Math.hypot(r.mx, r.my));
      const grabFired = await traceOf().then((t) => t.some((r) => r.grab));
      // keep steering with finger 0 while finger 1 stays down
      await touch.move([
        { id: 0, x: x0 + 90, y: y0 - 60 },
        { id: 1, x: gc[0], y: gc[1] },
      ]);
      await step(2);
      const steerMag = await lastRow().then((r) => Math.hypot(r.mx, r.my));
      // finger 1 moves to chop and holds; finger 0 lifts mid-hold
      await touch.end([{ id: 1, x: gc[0], y: gc[1] }]);
      await step(1);
      await touch.start([
        { id: 0, x: x0 + 90, y: y0 - 60 },
        { id: 1, x: uc[0], y: uc[1] },
      ]);
      await step(2);
      const useOn = await lastRow().then((r) => r.use);
      await touch.end([{ id: 0, x: x0 + 90, y: y0 - 60 }]);
      await step(3);
      const useAfterStickLift = await lastRow().then((r) => r.use);
      await touch.end([]);
      await step(2);
      const useAfterRelease = await lastRow().then((r) => r.use);
      R.second = {
        magBeforeSecondFinger: +beforeMag.toFixed(3),
        magWithSecondFinger: +midMag.toFixed(3),
        magSteeringWithSecondFinger: +steerMag.toFixed(3),
        grabFired,
        chopHeld: useOn,
        chopSurvivedStickLift: useAfterStickLift,
        chopReleasedOnLift: !useAfterRelease,
      };
      await lift();
    }

    // --------------------------------------------- two left fingers (roll)
    mark('roll');
    // Thumb rolls: a second finger lands, the first lifts. A stick that only
    // listens to pointerdown loses the player until they lift and re-press.
    {
      const x0 = Math.round(w * 0.18);
      const y0 = Math.round(h * 0.62);
      await touch.start([{ id: 0, x: x0, y: y0 }]);
      await touch.move([{ id: 0, x: x0 + 40, y: y0 }]);
      await step(2);
      await touch.start([
        { id: 0, x: x0 + 40, y: y0 },
        { id: 2, x: x0 + 10, y: y0 + 60 },
      ]);
      await step(1);
      await touch.end([{ id: 0, x: x0 + 40, y: y0 }]);
      await step(2);
      await touch.move([{ id: 2, x: x0 + 60, y: y0 + 60 }]);
      await step(2);
      const r = await lastRow();
      R.roll = { stillSteering: Math.hypot(r.mx, r.my) > 0.2, mag: +Math.hypot(r.mx, r.my).toFixed(3) };
      await touch.end([]);
      await step(2);
    }

    // ---------------------------------------------------------- cancel
    mark('cancel');
    {
      const x0 = Math.round(w * 0.22);
      const y0 = Math.round(h * 0.6);
      await touch.start([{ id: 0, x: x0, y: y0 }]);
      await touch.move([{ id: 0, x: x0 + 60, y: y0 - 20 }]);
      await step(2);
      const before = await lastRow().then((r) => Math.hypot(r.mx, r.my));
      await touch.cancel();
      await step(2);
      const after = await lastRow().then((r) => Math.hypot(r.mx, r.my));
      // Can the player get moving again with a fresh press?
      await touch.start([{ id: 3, x: x0, y: y0 }]);
      await touch.move([{ id: 3, x: x0 + 60, y: y0 }]);
      await step(2);
      const recovered = await lastRow().then((r) => Math.hypot(r.mx, r.my));
      // The coast has to END. A decay that never reaches zero is a chef that
      // never stops.
      await touch.end([]);
      await new Promise((r) => setTimeout(r, 400));
      await step(1);
      const settled = await lastRow().then((r) => Math.hypot(r.mx, r.my));
      R.cancelSettled = +settled.toFixed(4);
      R.cancel = {
        magBefore: +before.toFixed(3),
        magAfterCancel: +after.toFixed(3),
        magAfterFreshPress: +recovered.toFixed(3),
      };
      await touch.end([]);
      await step(2);
    }

    // ---------------------------------------------------------- reach
    mark('reach');
    // One-handed grip: the right thumb pivots roughly at the bottom-right
    // corner, 8px in and 12px up. Comfortable arc is ~45-100mm; at
    // 6.04 CSS px/mm on a 15 Pro that is 270-600 CSS px.
    {
      const pivot = [w - 8, h - 12];
      const PX_PER_MM = 6.04;
      const d = (b) => {
        const cx = b.x + b.w / 2;
        const cy = b.y + b.h / 2;
        const px = Math.hypot(cx - pivot[0], cy - pivot[1]);
        return { px: +px.toFixed(0), mm: +(px / PX_PER_MM).toFixed(1) };
      };
      R.reach = {
        pivot,
        grab: d(R.geom.grab),
        use: d(R.geom.use),
        dash: d(R.geom.dash),
        sizesMm: {
          grab: +(R.geom.grab.w / PX_PER_MM).toFixed(1),
          use: +(R.geom.use.w / PX_PER_MM).toFixed(1),
          dash: +(R.geom.dash.w / PX_PER_MM).toFixed(1),
        },
        clusterFracOfWidth: +(R.geom.cluster.w / w).toFixed(3),
        clusterFracOfArea: +((R.geom.cluster.w * R.geom.cluster.h) / (w * h)).toFixed(4),
        homeIndicatorGapPx: +(h - ins.b - (R.geom.cluster.y + R.geom.cluster.h)).toFixed(1),
      };
    }

    if (SHOTS) {
      mark('shots');
      const gx = R.geom.grab.x + R.geom.grab.w / 2;
      const gy = R.geom.grab.y + R.geom.grab.h / 2;
      const ux = R.geom.use.x + R.geom.use.w / 2;
      const uy = R.geom.use.y + R.geom.use.h / 2;
      // 1: thumb down, stick at rest, exactly where it landed.
      const sx = Math.round(w * 0.2);
      const sy = Math.round(h * 0.72);
      await touch.start([{ id: 0, x: sx, y: sy }]);
      await step(1);
      await capture('stick-rest');
      // 2: mid-sprint, full deflection up-right, origin dragged.
      for (let i = 1; i <= 12; i++) {
        await touch.move([{ id: 0, x: sx + i * 12, y: sy - i * 9 }]);
        await step(1);
      }
      await capture('stick-sprint');
      // 3: steering with one thumb, chop held with the other.
      await touch.start([
        { id: 0, x: sx + 144, y: sy - 108 },
        { id: 1, x: ux, y: uy },
      ]);
      await step(1);
      await capture('two-thumbs-chop');
      // 4: the grab disc pressed (:active), stick still live.
      await touch.end([{ id: 1, x: ux, y: uy }]);
      await touch.start([
        { id: 0, x: sx + 144, y: sy - 108 },
        { id: 1, x: gx, y: gy },
      ]);
      await step(1);
      await capture('grab-pressed');
      await touch.end([]);
      await step(2);
      await capture('idle');
    }

    R.errors = errors;
    out[id] = R;

    // ---------------------------------------------------------- print
    const g = R.geom;
    console.log(`\n=== ${id}  ${w}x${h}  insets t${ins.t} b${ins.b} l${ins.l} r${ins.r}`);
    console.log(
      `  discs      grab ${g.grab.w}px (${R.reach.sizesMm.grab}mm)  use ${g.use.w}px (${R.reach.sizesMm.use}mm)  dash ${g.dash.w}px (${R.reach.sizesMm.dash}mm)`,
    );
    console.log(
      `  cluster    ${g.cluster.w}x${g.cluster.h}  ${(R.reach.clusterFracOfWidth * 100).toFixed(1)}% of width  ${(R.reach.clusterFracOfArea * 100).toFixed(2)}% of area  gap to home-indicator ${R.reach.homeIndicatorGapPx}px`,
    );
    console.log(
      `  reach      grab ${R.reach.grab.mm}mm  use ${R.reach.use.mm}mm  dash ${R.reach.dash.mm}mm  from thumb pivot`,
    );
    console.log(
      `  regions    stick ${R.region.pctStick}%  button ${R.region.pctButton}%  DEAD ${R.region.pctDead}%  (predicate mismatches: ${R.regionTruth.mismatch.length})`,
    );
    for (const m of R.regionTruth.mismatch) console.log(`     ! (${m.x},${m.y}) predicted ${m.predicted} got ${m.actual}`);
    console.log(`  spawn      ${R.spawn.map((s) => `${s.at.join(',')}→${s.active ? `off ${s.offset}px` : 'NO STICK'}`).join('  ')}`);
    console.log(
      `  sprint     ${R.sprint.frames}f  lag ${fmt(R.sprint.lagPx.min)}/${fmt(R.sprint.lagPx.med)}/${fmt(R.sprint.lagPx.max)}px  mag ${fmt(R.sprint.mag.min, 3)}/${fmt(R.sprint.mag.med, 3)}/${fmt(R.sprint.mag.max, 3)}  below95%: ${R.sprint.framesBelow95pct}f  angErr max ${fmt(R.sprint.angleErrDeg?.max, 2)}deg`,
    );
    console.log(
      `  deadzone   first move at ${R.deadzone.firstMovePx}px  50% at ${R.deadzone.half50Px}px  100% at ${R.deadzone.fullPx}px`,
    );
    console.log(`  simTurn    chef x reverses ${R.simTurn.xReversesAfterMs}ms after the input flips (speed ${R.simTurn.speedBefore} → ${R.simTurn.speedAfter})`);
    console.log(`  reverse    output flips after ${R.reverse.flipPx}px of thumb travel, 90% the other way at ${R.reverse.ninetyPx}px (~${R.reverse.msAt800}ms at 800px/s)`);
    console.log(`  angles     max err ${R.angles.maxErrDeg}deg  mag ${R.angles.magMin}..${R.angles.magMax}`);
    const bad = R.buttons.filter((b) => (b.at.startsWith('miss') ? false : b.fired !== true));
    const near = R.buttons.filter((b) => b.at.startsWith('miss') && b.fired === true);
    console.log(
      `  buttons    ${R.buttons.filter((b) => b.fired === true).length}/${R.buttons.length} fired; ON-DISC MISSES: ${bad.length ? bad.map((b) => b.btn + '/' + b.at).join(' ') : 'none'}; near-miss forgiven: ${near.length ? near.map((b) => b.btn + '/' + b.at).join(' ') : 'none'}`,
    );
    console.log(`  endToEnd   ${R.endToEnd.map((r) => `${r.dir} ${r.movedUnits}u v${r.speedHeld}`).join('  ')}`);
    console.log(`  (scripted) ${R.endToEndScripted.map((r) => `${r.dir} ${r.movedUnits}u v${r.speedHeld}`).join('  ')}`);
    console.log(`  pointerIds ${R.pointerIds.map((p) => `${p.type}#${p.id}→${p.target}`).join(' ')}`);
    console.log(
      `  pressed    ${R.buttons.filter((b) => b.pressed).map((b) => `${b.btn}:${b.pressed.transform === 'none' ? 'NO VISIBLE PRESS' : b.pressed.transform}`).join('  ')}`,
    );
    console.log(`  second     ${JSON.stringify(R.second)}`);
    console.log(`  roll       ${JSON.stringify(R.roll)}`);
    console.log(`  cancel     ${JSON.stringify(R.cancel)} settledAfter400ms=${R.cancelSettled}`);
    console.log(`  console    ${errors.length ? errors.slice(0, 4).join(' | ') : 'clean'}`);

    await ctx.close();
  }

  await browser.close();
  server.close();
  if (argv.json) {
    fs.writeFileSync(path.resolve(ROOT, String(argv.json)), JSON.stringify(out, null, 2));
    console.log(`\nWrote ${argv.json}`);
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
