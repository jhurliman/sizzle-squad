/**
 * THE FLOATING STICK, MEASURED AS FURNITURE.
 *
 *   node tools/stickprobe.mjs [--profiles iphone-portrait,ipad-landscape] [--json out.json]
 *   node tools/stickprobe.mjs --shots shots/<label>      (also writes jpgs)
 *
 * touchprobe.mjs proves the stick is FAITHFUL (angle error, magnitude, latency).
 * It says nothing about where the control ENDS UP or what it covers, which is
 * the whole of the wave-2 verdict against this piece. Every number here is one
 * of those, driven through real CDP touch on the shipped code path:
 *
 *   drift      |origin - press point| after 250/500/750/1000ms of a 500px/s run
 *   glass      % of the 124px ring disc on screen: at edge presses, and at the
 *              end of 20 bounded sprints (thumb clamped to the glass)
 *   centre     how many of those 20 runs park the ring in the central 60%
 *   reverse    thumb px to flip the emitted vector, and to reach 90% the other way
 *   turn       thumb px of LATERAL travel to swing the vector 45deg / 90deg
 *              AFTER a 300px sprint — the cost a bounded origin can hide
 *   paint      pixels of the frame the control repaints, and by how much luma,
 *              measured by差 differencing a rendered frame against the same
 *              frame with the stick hidden
 *   confusion  mean RGB of the knob vs mean RGB of an order balloon (the two
 *              near-white round things the critic could not tell apart) and vs
 *              the game pixels the knob is covering
 */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

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
  { id: 'ipad-landscape', w: 1194, h: 834, ins: { t: 24, b: 20, l: 0, r: 0 } },
  { id: 'iphone-landscape', w: 852, h: 393, ins: { t: 0, b: 21, l: 59, r: 59 } },
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

const PINNED = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const br = await chromium.launch({
  executablePath: fs.existsSync(PINNED) ? PINNED : undefined,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});

const only = argv.profiles && argv.profiles !== true ? String(argv.profiles).split(',') : ['iphone-portrait', 'ipad-landscape'];
const SHOTROOT = argv.shots && argv.shots !== true ? path.resolve(ROOT, String(argv.shots)) : null;
const out = {};
const med = (a) => a.slice().sort((x, y) => x - y)[a.length >> 1];
const cl = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

for (const P of PROFILES.filter((p) => only.includes(p.id))) {
  const ctx = await br.newContext({
    viewport: { width: P.w, height: P.h },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 1,
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  });
  const page = await ctx.newPage();
  await page.addInitScript((v) => {
    // TRANSITIONS DO NOT SETTLE UNDER ?capture=1. The loop owns the clock and
    // never calls requestAnimationFrame, so the document timeline barely
    // advances and getComputedStyle(ring).opacity came back 1 while the inline
    // value the loop had written was 0.55 — i.e. every "faded" frame this probe
    // captured was secretly at full presence. Killing the transition on the one
    // element under test makes each capture the SETTLED state, which is the
    // thing worth measuring; the 0.14s ramp itself is a real-device concern and
    // is not what these numbers are about.
    const css = `#stickRing,#stickRing *{transition:none !important}\n:root{--safe-t:${v.t}px !important;--safe-b:${v.b}px !important;--safe-l:${v.l}px !important;--safe-r:${v.r}px !important}`;
    const put = () => {
      const e = document.createElement('style');
      e.textContent = css;
      document.head.appendChild(e);
    };
    if (document.head) put();
    else document.addEventListener('DOMContentLoaded', put);
  }, P.ins);
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message)));
  await page.goto(`http://127.0.0.1:${port}/?capture=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.__game && !!window.__input, null, { timeout: 180000 });
  const hideCanvas = (yes) =>
    page.evaluate((v) => {
      const c = document.getElementById('stage');
      if (c) c.style.visibility = v ? 'hidden' : 'visible';
    }, yes);
  await hideCanvas(true);
  const cdp = await page.context().newCDPSession(page);
  const down = new Set();
  const send = (t, p) =>
    cdp.send('Input.dispatchTouchEvent', {
      type: t,
      touchPoints: p.map((q) => ({ x: q.x, y: q.y, id: q.id, radiusX: 12, radiusY: 12, force: 1 })),
    });
  const T = {
    start: async (p) => {
      p.forEach((q) => down.add(q.id));
      await send('touchStart', p);
    },
    move: (p) => send('touchMove', p),
    end: async () => {
      if (down.size) {
        await send('touchEnd', []);
        down.clear();
      }
    },
  };
  await page.evaluate(() => {
    window.__game.start();
    window.__game.setCapture(true);
    window.__input.traceOn = true;
    window.__input.trace.length = 0;
  });
  const step = (n = 1) => page.evaluate((k) => { for (let i = 0; i < k; i++) window.__input.sample(); }, n);
  const sim = (s) => page.evaluate((v) => window.__game.advance(v), s);
  // THE DRAWN CONTROL, NOT THE MATH ORIGIN. `anchor` is where the ring is
  // painted (src/input/input.ts); older builds had only `origin` and drew
  // there, so fall back to it and the same probe measures both.
  const stk = async () => {
    const s = await page.evaluate(() => JSON.parse(JSON.stringify(window.__input.stick)));
    return { ...s, anchor: s.anchor ?? s.origin };
  };
  const lastRow = () => page.evaluate(() => window.__input.trace.at(-1) ?? null);
  const R = { id: P.id, vp: [P.w, P.h] };
  const RAD = await page.evaluate(() => window.__input.stick.radius);
  R.radius = RAD;

  const ringOnGlass = (ox, oy) => {
    let inn = 0, tot = 0;
    for (let dy = -RAD; dy <= RAD; dy += 2)
      for (let dx = -RAD; dx <= RAD; dx += 2) {
        if (dx * dx + dy * dy > RAD * RAD) continue;
        tot++;
        if (ox + dx >= 0 && ox + dx < P.w && oy + dy >= 0 && oy + dy < P.h) inn++;
      }
    return (100 * inn) / tot;
  };

  console.log(`\n=== ${P.id} ${P.w}x${P.h}   stick radius ${RAD}px`);

  const QUICK = !!argv.quick;
  // ------------------------------------------------------------- drift
  // A held run at 500px/s straight up the glass. How far does the CONTROL
  // travel from where the thumb first pressed?
  if (!QUICK) {
    const x0 = Math.round(P.w * 0.5);
    const y0 = P.h - 40;
    const dist = Math.min(500, P.h - 80); // stay on the glass: a thumb cannot leave it
    await T.start([{ id: 0, x: x0, y: y0 }]);
    await step(1);
    const press = await stk().then((s) => ({ ...s.anchor }));
    const marks = {};
    const FR = 60;
    for (let f = 1; f <= FR; f++) {
      const y = y0 - (dist * f) / FR;
      await T.move([{ id: 0, x: x0, y }]);
      await step(1);
      if (f % 15 === 0) {
        const s = await stk();
        // Walk of the DRAWN control from where it was painted on press.
        marks[`${(f / FR) * 1000 | 0}ms`] = +Math.hypot(s.anchor.x - press.x, s.anchor.y - press.y).toFixed(0);
      }
    }
    const s = await stk();
    R.drift = { marks, endAnchor: [+s.anchor.x.toFixed(0), +s.anchor.y.toFixed(0)], mathOrigin: [+s.origin.x.toFixed(0), +s.origin.y.toFixed(0)], press: [press.x, press.y] };
    R.driftPctPerSec = +((100 * (marks['1000ms'] ?? 0)) / P.h).toFixed(1);
    await T.end();
    await step(2);
    console.log(`  drift      ${Object.entries(marks).map(([k, v]) => `${k} ${v}px`).join('  ')}   = ${R.driftPctPerSec}% of screen height per second of run`);
  }

  // ------------------------------------------------------- edge presses
  if (!QUICK) {
    const pts = [
      ['corner', 12, 12],
      ['side', 4, Math.round(P.h * 0.5)],
      ['bottom', Math.round(P.w * 0.45), P.h - 12],
      ['mid', Math.round(P.w * 0.3), Math.round(P.h * 0.6)],
    ];
    const rows = [];
    for (const [name, x, y] of pts) {
      await T.start([{ id: 0, x, y }]);
      await step(1);
      const s = await stk();
      const r = await lastRow();
      rows.push({
        at: name,
        spawnOffsetPx: +Math.hypot(s.anchor.x - x, s.anchor.y - y).toFixed(1),
        ringOnGlassPct: +ringOnGlass(s.anchor.x, s.anchor.y).toFixed(0),
        moveOnPress: +Math.hypot(r.mx, r.my).toFixed(3),
      });
      await T.end();
      await step(2);
    }
    R.edgePress = rows;
    console.log(`  edge press ${rows.map((r) => `${r.at}: ring ${r.ringOnGlassPct}% on glass, spawn off ${r.spawnOffsetPx}px, emits ${r.moveOnPress}`).join('  |  ')}`);
  }

  // --------------------------------------------------- bounded sprints
  if (!QUICK) {
    const starts = [[0.22, 0.72], [0.5, 0.8], [0.75, 0.55], [0.3, 0.45], [0.2, 0.35]];
    const dirs = [[0.774, -0.633], [1, 0], [0, -1], [-0.7, -0.7]];
    const land = [];
    for (const [fx, fy] of starts)
      for (const [dx, dy] of dirs) {
        const x0 = Math.round(P.w * fx), y0 = Math.round(P.h * fy);
        await T.start([{ id: 0, x: x0, y: y0 }]);
        await step(1);
        const a0 = (await stk()).anchor;
        for (let i = 1; i <= 40; i++) {
          await T.move([{ id: 0, x: cl(x0 + dx * i * 12, 2, P.w - 2), y: cl(y0 + dy * i * 12, 2, P.h - 2) }]);
          await step(1);
        }
        const s = await stk();
        const r = await lastRow();
        land.push({
          ofx: s.anchor.x / P.w,
          ofy: s.anchor.y / P.h,
          vis: ringOnGlass(s.anchor.x, s.anchor.y),
          mag: Math.hypot(r.mx, r.my),
          walked: Math.hypot(s.anchor.x - a0.x, s.anchor.y - a0.y),
        });
        await T.end();
        await step(2);
      }
    const vis = land.map((l) => l.vis);
    R.bounded = {
      runs: land.length,
      medOfx: +med(land.map((l) => l.ofx)).toFixed(2),
      medOfy: +med(land.map((l) => l.ofy)).toFixed(2),
      ringMedPct: +med(vis).toFixed(0),
      ringWorstPct: +Math.min(...vis).toFixed(0),
      under90: vis.filter((v) => v < 90).length,
      // NOTE ON inCentral60: this counts where the ring ENDS UP, and once the
      // ring stops walking it ends up wherever the thumb pressed — so with a
      // fixed anchor this number is a fact about the probe's five synthetic
      // press points, not about the control. `walked` is the number that
      // matters now: how far the ring moved from the press during the sprint.
      inCentral60: land.filter((l) => l.ofx > 0.2 && l.ofx < 0.8 && l.ofy > 0.2 && l.ofy < 0.8).length,
      walkedPxMax: +Math.max(...land.map((l) => l.walked)).toFixed(1),
      walkedRuns: land.filter((l) => l.walked > 1).length,
      magMin: +Math.min(...land.map((l) => l.mag)).toFixed(3),
    };
    console.log(`  bounded    ${land.length} sprints: ring origin med ${R.bounded.medOfx},${R.bounded.medOfy} of frame; ring on glass med ${R.bounded.ringMedPct}% worst ${R.bounded.ringWorstPct}%; under 90%: ${R.bounded.under90}/${land.length}; ring walked from the press point in ${R.bounded.walkedRuns}/${land.length} runs (max ${R.bounded.walkedPxMax}px); ends inside the central 60%: ${R.bounded.inCentral60}/${land.length} (= where the probe pressed); min mag at speed ${R.bounded.magMin}`);
  }

  // ----------------------------------------------------------- reverse
  if (!QUICK) {
    const x0 = Math.round(P.w * 0.3), y0 = Math.round(P.h * 0.55);
    await T.start([{ id: 0, x: x0, y: y0 }]);
    await step(1);
    for (let i = 1; i <= 10; i++) {
      await T.move([{ id: 0, x: cl(x0 + i * 30, 2, P.w - 2), y: y0 }]);
      await step(1);
    }
    const peak = cl(x0 + 300, 2, P.w - 2);
    let flipPx = -1, ninetyPx = -1;
    for (let d = 3; d <= 300; d += 3) {
      await T.move([{ id: 0, x: cl(peak - d, 2, P.w - 2), y: y0 }]);
      await step(1);
      const r = await lastRow();
      if (flipPx < 0 && r.mx < 0) flipPx = d;
      if (ninetyPx < 0 && r.mx <= -0.9) { ninetyPx = d; break; }
    }
    R.reverse = { flipPx, ninetyPx, msAt800: ninetyPx > 0 ? +((ninetyPx / 800) * 1000).toFixed(0) : -1 };
    await T.end();
    await step(2);
    console.log(`  reverse    flips after ${flipPx}px of thumb travel back, 90% the other way at ${ninetyPx}px (~${R.reverse.msAt800}ms at 800px/s)`);
  }

  // -------------------------------------------------------------- turn
  // The metric a bounded origin can quietly wreck: after a long straight
  // sprint, how many px of LATERAL thumb travel swing the emitted vector.
  if (!QUICK) {
    const x0 = Math.round(P.w * 0.5), y0 = P.h - 30;
    const runY = Math.min(300, P.h - 120);
    await T.start([{ id: 0, x: x0, y: y0 }]);
    await step(1);
    for (let i = 1; i <= 25; i++) {
      await T.move([{ id: 0, x: x0, y: y0 - (runY * i) / 25 }]);
      await step(1);
    }
    const a0 = await lastRow().then((r) => Math.atan2(r.my, r.mx));
    let p45 = -1, p90 = -1;
    for (let d = 4; d <= 400; d += 4) {
      await T.move([{ id: 0, x: cl(x0 + d, 2, P.w - 2), y: y0 - runY }]);
      await step(1);
      const r = await lastRow();
      let dd = ((Math.atan2(r.my, r.mx) - a0) * 180) / Math.PI;
      while (dd > 180) dd -= 360;
      while (dd < -180) dd += 360;
      if (p45 < 0 && Math.abs(dd) >= 45) p45 = d;
      if (p90 < 0 && Math.abs(dd) >= 89) { p90 = d; break; }
    }
    R.turn = { lat45Px: p45, lat90Px: p90 };
    await T.end();
    await step(2);
    console.log(`  turn       after a ${runY}px sprint: 45deg of turn costs ${p45}px of lateral thumb, 90deg costs ${p90}px`);
  }

  // ------------------------------------------------------------- paint
  // What the control COSTS the picture, in pixels of the game repainted.
  // Same game frame twice: stick live, then stick hidden.
  {
    const x0 = Math.round(P.w * 0.3), y0 = Math.round(P.h * 0.72);
    await sim(0.016);
    await T.start([{ id: 0, x: x0, y: y0 }]);
    await step(1);
    // AT REST FIRST. The fade only applies to a committed run, so a shot of a
    // sprint says nothing about how the control reads the moment it spawns —
    // which is when the player is actually looking at it.
    await hideCanvas(false);
    await page.evaluate(() => window.__game.advance(1 / 60));
    await new Promise((r) => setTimeout(r, 300));
    const shotR = Buffer.from((await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: false })).data, 'base64');
    const restAnchor = (await stk()).anchor;
    await hideCanvas(true);
    for (let i = 1; i <= 12; i++) {
      await T.move([{ id: 0, x: cl(x0 + i * 12, 2, P.w - 2), y: cl(y0 - i * 9, 2, P.h - 2) }]);
      await step(1);
    }
    const s = await stk();
    await hideCanvas(false);
    // One step of world to get a rendered frame, and then the world is frozen.
    await page.evaluate(() => window.__game.advance(1 / 60));
    await new Promise((r) => setTimeout(r, 300));
    // NO advance() BETWEEN THE THREE CAPTURES. advance(0) is not a no-op — it
    // rounds up to one 1/60 step (see __game.advance in main.ts), so every
    // capture used to move the world and the "noise floor" between two shots of
    // the identical state came out at 7.9% of the window. The canvas keeps its
    // last rendered frame (preserveDrawingBuffer under ?capture=1), so the 3D
    // pixels are frozen and only the DOM control changes underneath them.
    const opA = await page.evaluate(() => getComputedStyle(document.getElementById('stickRing')).opacity);
    const shotA = Buffer.from((await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: false })).data, 'base64');
    await page.evaluate(() => {
      const st = document.createElement('style');
      st.id = 'nofade';
      st.textContent = '#stickRing{opacity:1 !important}';
      document.head.appendChild(st);
    });
    const opF = await page.evaluate(() => getComputedStyle(document.getElementById('stickRing')).opacity);
    const shotF = Buffer.from((await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: false })).data, 'base64');
    // A FOURTH STATE ON THE SAME FRAME: the art as it shipped into wave 2 —
    // 58px of near-opaque cream, a 3px rim, no fade. Injected rather than
    // remembered, so the regression baseline is re-measured on every run
    // instead of quoted from a run nobody can reproduce.
    await page.evaluate(() => {
      const st = document.createElement('style');
      st.id = 'oldart';
      st.textContent = `#stickRing{opacity:1 !important;border:3px solid rgba(255,255,255,0.78) !important;
        box-shadow:0 0 0 2px rgba(46,30,17,0.34), inset 0 0 0 2px rgba(46,30,17,0.16), 0 2px 10px rgba(0,0,0,0.22) !important}
        #stickRing>.stick-knob{width:58px !important;height:58px !important;margin:-29px 0 0 -29px !important;
        background:radial-gradient(120% 120% at 34% 26%,#fffdf6,#f2e6d4 62%,#e6d6bd) !important;
        box-shadow:0 0 0 2px rgba(46,30,17,0.26), inset 0 -3px 0 rgba(120,92,58,0.2), 0 3px 10px rgba(0,0,0,0.34) !important}`;
      document.head.appendChild(st);
    });
    const shotO = Buffer.from((await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: false })).data, 'base64');
    await page.evaluate(() => document.getElementById('oldart')?.remove());
    await page.evaluate(() => document.getElementById('nofade')?.remove());
    await page.evaluate(() => { document.getElementById('stickRing').style.visibility = 'hidden'; });
    const shotB = Buffer.from((await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: false })).data, 'base64');
    const shotB2 = Buffer.from((await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: false })).data, 'base64');
    await page.evaluate(() => { document.getElementById('stickRing').style.visibility = ''; });
    const A = await sharp(shotA).raw().toBuffer({ resolveWithObject: true });
    const F = await sharp(shotF).raw().toBuffer({ resolveWithObject: true });
    const B = await sharp(shotB).raw().toBuffer({ resolveWithObject: true });
    const W = A.info.width, H = A.info.height, CH = A.info.channels;
    const lum = (d, i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    // ONLY THE CONTROL'S OWN NEIGHBOURHOOD. The HUD balloons breathe on CSS
    // animations that run on wall time, and captures taken 300ms apart differ
    // up there whatever the stick is doing. The window is the ring plus its
    // full deflection plus a margin; the denominator stays the whole frame, so
    // the numbers still read as % of picture.
    const scaleW = W / P.w;
    const wx = s.anchor.x * scaleW, wy = s.anchor.y * scaleW;
    const wr = (RAD * 2 + 50) * scaleW;
    const cover = (X) => {
      let changed = 0, sum = 0, heavy = 0;
      for (let y = Math.max(0, (wy - wr) | 0); y < Math.min(H, (wy + wr) | 0); y++)
        for (let x = Math.max(0, (wx - wr) | 0); x < Math.min(W, (wx + wr) | 0); x++) {
          const i = (y * W + x) * CH;
          const dl = Math.abs(lum(X.data, i) - lum(B.data, i));
          if (dl > 8) { changed++; sum += dl; if (dl > 60) heavy++; }
        }
      const px = W * H;
      return {
        pctChanged: +((100 * changed) / px).toFixed(2),
        pctHeavy: +((100 * heavy) / px).toFixed(2),
        meanDeltaLuma: changed ? +(sum / changed).toFixed(1) : 0,
      };
    };
    R.opacityFaded = opA;
    R.opacityFull = opF;
    console.log(`  opacity    running ${opA}  forced-full ${opF}`);
    R.paint = cover(A);
    R.paintUnfaded = cover(F);
    R.paintLegacy = cover(await sharp(shotO).raw().toBuffer({ resolveWithObject: true }));
    R.paintNoise = cover(await sharp(shotB2).raw().toBuffer({ resolveWithObject: true }));
    console.log(`  paint      running (faded): repaints ${R.paint.pctChanged}% of the frame, mean dLuma ${R.paint.meanDeltaLuma}, ${R.paint.pctHeavy}% covered by >60 luma`);
    console.log(`             same frame, at rest (unfaded): ${R.paintUnfaded.pctChanged}% / dLuma ${R.paintUnfaded.meanDeltaLuma} / ${R.paintUnfaded.pctHeavy}% heavy`);
    console.log(`             same frame, WAVE-2 ART: ${R.paintLegacy.pctChanged}% / dLuma ${R.paintLegacy.meanDeltaLuma} / ${R.paintLegacy.pctHeavy}% heavy   (noise floor ${R.paintNoise.pctChanged}%)`);

    // ------------------------------------------------------- confusion
    // knob vs balloon vs the game underneath, in mean RGB.
    const meanDisc = (buf, info, cx, cy, r) => {
      const { width, height, channels } = info;
      let n = 0, R2 = 0, G = 0, Bl = 0;
      for (let y = Math.max(0, cy - r); y < Math.min(height, cy + r); y++)
        for (let x = Math.max(0, cx - r); x < Math.min(width, cx + r); x++) {
          if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) continue;
          const i = (y * width + x) * channels;
          R2 += buf[i]; G += buf[i + 1]; Bl += buf[i + 2]; n++;
        }
      return n ? [R2 / n, G / n, Bl / n] : null;
    };
    const scale = W / P.w;
    const knobR = await page.evaluate(() => {
      const k = document.querySelector('.stick-knob');
      const b = k.getBoundingClientRect();
      return { cx: b.x + b.width / 2, cy: b.y + b.height / 2, r: b.width / 2 };
    });
    const balloons = await page.evaluate(() =>
      [...document.querySelectorAll('.balloon')].map((e) => {
        const b = e.getBoundingClientRect();
        return { cx: b.x + b.width / 2, cy: b.y + b.height / 2, r: Math.min(b.width, b.height) / 2 };
      }),
    );
    // THE PAPER, NOT THE FOOD. A balloon's mean colour is dominated by the
    // lettuce and tomatoes sitting in it; what the knob was mistakable for is
    // the white FIELD around them, so take the balloon's upper luma half.
    const paper = (buf, info, b) => {
      const { width, height, channels } = info;
      const px = [];
      const r = Math.round(b.r * scale * 0.85);
      const cx = Math.round(b.cx * scale), cy = Math.round(b.cy * scale);
      for (let y = Math.max(0, cy - r); y < Math.min(height, cy + r); y++)
        for (let x = Math.max(0, cx - r); x < Math.min(width, cx + r); x++) {
          if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) continue;
          const i = (y * width + x) * channels;
          px.push([buf[i], buf[i + 1], buf[i + 2], 0.299 * buf[i] + 0.587 * buf[i + 1] + 0.114 * buf[i + 2]]);
        }
      if (!px.length) return null;
      px.sort((p, q) => p[3] - q[3]);
      const hi = px.slice(Math.floor(px.length * 0.6));
      const m = [0, 1, 2].map((k) => hi.reduce((a, p) => a + p[k], 0) / hi.length);
      return m;
    };
    const O = await sharp(shotO).raw().toBuffer({ resolveWithObject: true });
    const kA = meanDisc(A.data, A.info, Math.round(knobR.cx * scale), Math.round(knobR.cy * scale), Math.round(knobR.r * scale * 0.7));
    const kB = meanDisc(B.data, B.info, Math.round(knobR.cx * scale), Math.round(knobR.cy * scale), Math.round(knobR.r * scale * 0.7));
    const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
    const balls = balloons.map((b) => paper(A.data, A.info, b)).filter(Boolean);
    const luma = (p) => 0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2];
    // The same disc under the wave-2 art, so the "is it a ticket" number has a
    // before as well as an after on the identical frame.
    const kO = meanDisc(O.data, O.info, Math.round(knobR.cx * scale), Math.round(knobR.cy * scale), Math.round(29 * scale * 0.7));
    R.confusion = {
      knobLuma: kA ? +luma(kA).toFixed(0) : null,
      knobLumaWave2: kO ? +luma(kO).toFixed(0) : null,
      dLumaVsPaperWave2: kO && balls.length ? +Math.min(...balls.map((b) => Math.abs(luma(kO) - luma(b)))).toFixed(0) : null,
      paperLuma: balls.length ? +Math.max(...balls.map(luma)).toFixed(0) : null,
      dLumaVsPaper: kA && balls.length ? +Math.min(...balls.map((b) => Math.abs(luma(kA) - luma(b)))).toFixed(0) : null,
      knobRGB: kA?.map((v) => +v.toFixed(0)),
      underRGB: kB?.map((v) => +v.toFixed(0)),
      balloonRGB: balls.map((b) => b.map((v) => +v.toFixed(0))),
      knobVsBalloon: balls.length && kA ? +Math.min(...balls.map((b) => dist(kA, b))).toFixed(1) : null,
      knobVsUnder: kA && kB ? +dist(kA, kB).toFixed(1) : null,
    };
    console.log(`  confusion  knob luma ${R.confusion.knobLuma} vs balloon paper luma ${R.confusion.paperLuma} -> ${R.confusion.dLumaVsPaper} apart; wave-2 knob luma ${R.confusion.knobLumaWave2} -> ${R.confusion.dLumaVsPaperWave2} apart; knob vs the game under it ${R.confusion.knobVsUnder} RGB (smaller = more of the room survives)`);

    if (SHOTROOT) {
      const dir = path.join(SHOTROOT, P.id);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'sprint-live.png'), shotA);
      fs.writeFileSync(path.join(dir, 'rest-live.png'), shotR);
      fs.writeFileSync(path.join(dir, 'sprint-unfaded.png'), shotF);
      fs.writeFileSync(path.join(dir, 'sprint-nostick.png'), shotB);
      fs.writeFileSync(path.join(dir, 'sprint-wave2art.png'), shotO);
      // 2x crop around the ring, which is where the hairline argument lives
      const cx = Math.round(s.anchor.x * scale), cy = Math.round(s.anchor.y * scale);
      const half = Math.round((RAD + 30) * scale);
      const left = cl(cx - half, 0, W - 1), top = cl(cy - half, 0, H - 1);
      const cw = Math.min(half * 2, W - left), ch = Math.min(half * 2, H - top);
      await sharp(shotA).extract({ left, top, width: cw, height: ch }).resize({ width: cw * 2, kernel: 'nearest' }).toFile(path.join(dir, 'ring-2x.png'));
      for (const [nm, buf] of [['ring-unfaded-2x', shotF], ['ring-wave2art-2x', shotO]])
        await sharp(buf).extract({ left, top, width: cw, height: ch }).resize({ width: cw * 2, kernel: 'nearest' }).toFile(path.join(dir, `${nm}.png`));
      const rx = Math.round(restAnchor.x * scale), ry = Math.round(restAnchor.y * scale);
      const rl = cl(rx - half, 0, W - 1), rt = cl(ry - half, 0, H - 1);
      await sharp(shotR)
        .extract({ left: rl, top: rt, width: Math.min(half * 2, W - rl), height: Math.min(half * 2, H - rt) })
        .resize({ width: Math.min(half * 2, W - rl) * 2, kernel: 'nearest' })
        .toFile(path.join(dir, 'ring-rest-2x.png'));
    }
    await T.end();
    await step(2);
    await hideCanvas(true);
  }

  R.errors = errors;
  if (errors.length) console.log(`  ERRORS     ${errors.slice(0, 3).join(' | ')}`);
  out[P.id] = R;
  await ctx.close();
}
await br.close();
srv.close();
if (argv.json) {
  fs.writeFileSync(path.resolve(ROOT, String(argv.json)), JSON.stringify(out, null, 2));
  console.log(`\nWrote ${argv.json}`);
}
