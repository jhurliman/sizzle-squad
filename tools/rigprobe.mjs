/**
 * RIG PROBE — reads window.__rig() at the same instants shoot.mjs photographs.
 *
 *   node tools/rigprobe.mjs [--seconds 16] [--warp 0]
 *
 * The mascot piece's verdict is a claim that two numbers disagree: the sim says
 * a chef is at speed 5.36 and the render shows a doll. This dumps both sides at
 * every sampled frame — sim speed against the thigh split, rig pitch, foot
 * clearance and payload gap the rig ACTUALLY wrote to the bones — so the
 * mechanism can be named before anything is changed.
 *
 * Desktop profile only, one context, no screenshots: it runs in ~40 seconds.
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
const SECONDS = Number(argv.seconds ?? 16);
const WARP = Number(argv.warp ?? 0);
const EVERY = Number(argv.every ?? 0.25);

function serve(dir) {
  const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
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

const PINNED = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

async function main() {
  const { server, port } = await serve(DIST);
  const browser = await chromium.launch({
    executablePath: fs.existsSync(PINNED) ? PINNED : undefined,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
  });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e.message)));
  await page.goto(`http://127.0.0.1:${port}/?capture=1`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !!window.__game, null, { timeout: 15000 });
  await page.evaluate(() => window.__game.start());
  await page.evaluate(() => window.__game.setCapture(true));
  if (WARP > 0) await page.evaluate((n) => window.__game.warp(n), WARP);
  await page.evaluate(() => window.__game.setInput({ enabled: true }));

  const plan = [
    { move: { x: 0, y: 1 }, s: 0.9 },
    { grab: true, s: 0.12 },
    { move: { x: -0.9, y: -0.6 }, s: 1.1 },
    { move: { x: -1, y: 0 }, s: 0.7 },
    { grab: true, s: 0.12 },
    { use: true, s: 1.9 },
    { use: false, s: 0.1 },
    { grab: true, s: 0.15 },
    { move: { x: 1, y: -0.5 }, dash: true, s: 0.9 },
    { move: { x: 0, y: -1 }, s: 0.8 },
    { grab: true, s: 0.15 },
    { move: { x: 0.6, y: 1 }, s: 0.9 },
    { move: { x: 0, y: 0 }, s: 0.4 },
  ];

  const rows = [];
  let t = 0;
  let p = 0;
  while (t < SECONDS) {
    const d = plan[p % plan.length];
    p++;
    await page.evaluate(
      (v) => window.__game.setInput(v),
      { move: d.move ?? { x: 0, y: 0 }, grabPressed: !!d.grab, useHeld: !!d.use, dashPressed: !!d.dash, enabled: true },
    );
    let remaining = d.s ?? 0.4;
    while (remaining > 1e-4) {
      const slice = Math.min(remaining, EVERY);
      await page.evaluate((sec) => window.__game.advance(sec), slice);
      t += slice;
      remaining -= slice;
      const r = await page.evaluate(() => window.__rig());
      for (const x of r) rows.push({ t: +t.toFixed(2), ...x });
    }
  }

  await browser.close();
  server.close();

  // --- report
  const moving = rows.filter((r) => r.run > 0.3);
  const still = rows.filter((r) => r.run <= 0.05);
  const carrying = rows.filter((r) => r.mode > 0);
  const fmt = (n) => (n === undefined ? '  -  ' : String(n).padStart(6));
  console.log(`rows=${rows.length} moving(run>0.3)=${moving.length} still=${still.length} carrying=${carrying.length}`);
  const stat = (arr, k) => {
    if (!arr.length) return 'n/a';
    const v = arr.map((r) => r[k]).sort((a, b) => a - b);
    const q = (f) => v[Math.min(v.length - 1, Math.floor(f * v.length))];
    return `min ${fmt(v[0])}  p10 ${fmt(q(0.1))}  med ${fmt(q(0.5))}  p90 ${fmt(q(0.9))}  max ${fmt(v[v.length - 1])}`;
  };
  console.log('\n== FRAMES WITH run > 0.3 (the verdict\'s bar) ==');
  for (const k of ['speed', 'run', 'gait', 'amp', 'brake', 'thighSplitDeg', 'pitchDeg', 'armSplitDeg', 'footLowY', 'footHighY', 'dt']) {
    console.log(`  ${k.padEnd(14)} ${stat(moving, k)}`);
  }
  console.log('\n== SHADOW ==');
  for (const k of ['shOp', 'shY', 'shSX', 'shSY', 'shVis']) console.log(`  ${k.padEnd(14)} ${stat(rows, k)}`);
  console.log('\n== CARRYING (mode>0) ==');
  for (const k of ['payloadGap', 'headClear', 'bodyClear', 'thighSplitDeg']) console.log(`  ${k.padEnd(14)} ${stat(carrying, k)}`);
  const bad = moving.filter((r) => r.thighSplitDeg < 45);
  console.log(`\nVIOLATIONS: ${bad.length}/${moving.length} moving frames under 45deg thigh split (${((100 * bad.length) / Math.max(1, moving.length)).toFixed(0)}%)`);
  const cruise = rows.filter((r) => r.run > 0.6);
  const badPitch = cruise.filter((r) => r.pitchDeg < 12);
  console.log(`VIOLATIONS: ${badPitch.length}/${cruise.length} CRUISE frames (run>0.6) under 12deg forward pitch`);
  const backLean = moving.filter((r) => r.pitchDeg < 0);
  console.log(`VIOLATIONS: ${backLean.length}/${moving.length} moving frames leaning BACKWARD`);
  const sunk = rows.filter((r) => r.footLowY < -0.01);
  console.log(`VIOLATIONS: ${sunk.length}/${rows.length} frames with a foot below the floor`);
  const onHead = carrying.filter((r) => r.headClear > 0.001);
  console.log(`VIOLATIONS: ${onHead.length}/${carrying.length} carrying frames with the payload inside the head's clear zone`);
  const air = moving.filter((r) => r.footHighY < 0.12);
  console.log(`VIOLATIONS: ${air.length}/${moving.length} moving frames with no foot above 0.12`);
  console.log('\nWORST 12 MOVING FRAMES BY THIGH SPLIT:');
  for (const r of moving.sort((a, b) => a.thighSplitDeg - b.thighSplitDeg).slice(0, 12)) {
    console.log(
      `  t=${String(r.t).padStart(6)} ${r.skin.padEnd(8)} speed=${fmt(r.speed)} run=${fmt(r.run)} gait=${fmt(r.gait)} amp=${fmt(r.amp)} brake=${fmt(r.brake)} thigh=${fmt(r.thighSplitDeg)} pitch=${fmt(r.pitchDeg)} footHi=${fmt(r.footHighY)} gap=${fmt(r.payloadGap)} ${r.carrying}`,
    );
  }
  const towers = rows.filter((r) => r.mode === 4);
  console.log(`\nTOWER FRAMES (mode 4): ${towers.length}`);
  for (const r of towers.slice(0, 10)) {
    console.log(`  t=${String(r.t).padStart(6)} ${r.skin.padEnd(8)} headClear=${fmt(r.headClear)} gap=${fmt(r.payloadGap)} pitch=${fmt(r.pitchDeg)}`);
  }
  const m2 = rows.filter((r) => r.mode === 2 || r.mode === 1);
  console.log(`\nHAND-CARRY FRAMES (mode 1/2): ${m2.length}  headClear>0: ${m2.filter((r)=>r.headClear>0.001).length}`);
  const plates = rows.filter((r) => r.mode === 2);
  console.log(`PLATE FRAMES (mode 2): ${plates.length}`);
  for (const r of plates.slice(0, 16)) {
    console.log(`  t=${String(r.t).padStart(6)} ${r.skin.padEnd(8)} gap=${fmt(r.payloadGap)} bodyClear=${fmt(r.bodyClear)} headClear=${fmt(r.headClear)} side=${fmt(r.carrySide)}`);
  }
  const inBody = rows.filter((r) => r.mode > 0 && r.mode !== 4 && r.bodyClear < -0.001);
  console.log(`VIOLATIONS: ${inBody.length} carrying frames left INSIDE the torso after the clamp`);
  console.log('\nSAMPLE OF FAST FRAMES (speed>4):');
  for (const r of rows.filter((x) => x.speed > 4).slice(0, 14)) {
    console.log(
      `  t=${String(r.t).padStart(6)} ${r.skin.padEnd(8)} speed=${fmt(r.speed)} amp=${fmt(r.amp)} brake=${fmt(r.brake)} thigh=${fmt(r.thighSplitDeg)} pitch=${fmt(r.pitchDeg)} footHi=${fmt(r.footHighY)} gap=${fmt(r.payloadGap)} ${r.carrying}`,
    );
  }
  if (errors.length) console.log(`\nCONSOLE: ${errors.length} errors/warnings\n  ${errors.slice(0, 5).join('\n  ')}`);
  else console.log('\nCONSOLE: clean');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
