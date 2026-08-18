/**
 * BOT PROBE — what the co-op partner actually does, measured.
 *
 * `botsurvey.mjs` counts dishes. That is one number, it is chaotic in every
 * tuning constant this project has (see the warning at the top of content.ts),
 * and it cannot tell a kitchen that is working from a kitchen that is deadlocked
 * politely. This runs the same headless service through `__bots.probe()` — no
 * rendering at all, so a 180s service costs about a second — and reports where
 * every second of every bot's life went:
 *
 *   idle       seconds with NO PLAN AT ALL. The cardinal sin. Target < 3%.
 *   hesitate   the deliberate beat after switching task. Legibility, not waste.
 *   travel     walking to a station.
 *   station    parked at one, trying to act.
 *   work       actually holding the chop/wash button.
 *   jobs/done  plans started vs plans that ended in a button press. The ratio
 *              is the honest measure of a planner: 0.5 means half of everything
 *              a bot decided to do, it never did.
 *   voids      plans killed because the world moved under them (the player took
 *              the plate). This is ADAPTATION, and zero is as wrong as huge.
 *   stalls/sours  plans killed by the body failing to get there or to act.
 *
 * Three player policies, because the brief asks for both bounds:
 *   --mode idle    bots alone.       Too high here and the player is a spectator.
 *   --mode bot     player = 4th bot. The competent-partner ceiling.
 *   --mode chaos   player wandering and mashing grab. Finds re-plan bugs.
 *
 *   node tools/botprobe.mjs [--runs 12] [--seconds 180] [--mode idle,bot,chaos]
 *                           [--why] [--json out.json]
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
    if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1]]);
    return acc;
  }, []),
);
const RUNS = Number(argv.runs ?? 12);
const SECONDS = Number(argv.seconds ?? 180);
const MODES = String(argv.mode ?? 'idle,bot,chaos').split(',');
const SHOW_WHY = process.argv.includes('--why');

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
const { server, port } = await new Promise((resolve) => {
  const s = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    let file = path.join(DIST, decodeURIComponent(url.pathname));
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'index.html');
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  s.listen(0, '127.0.0.1', () => resolve({ server: s, port: s.address().port }));
});

const PINNED = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({
  executablePath: fs.existsSync(PINNED) ? PINNED : undefined,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 200, height: 150 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
await page.goto(`http://127.0.0.1:${port}/?capture=1`, { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.__game && !!window.__bots, null, { timeout: 20000 });

/**
 * PAIRED SEEDS. `served` swings by 4 dishes on seed alone, so an A/B on
 * unpaired runs measures luck. main.ts draws the sim seed from Math.random() as
 * the very first thing rebuild() does, so replacing Math.random with a seeded
 * generator immediately before start() pins the whole run — same kitchen, same
 * order stream, same spawn — across every variant and every mode.
 */
const results = {};
for (const mode of MODES) {
  const rows = [];
  for (let i = 0; i < RUNS; i++) {
    const r = await page.evaluate(
      async ([sec, mode, run]) => {
        let a = (run * 0x9e3779b1) >>> 0;
        Math.random = () => {
          a = (a + 0x6d2b79f5) >>> 0;
          let t = a;
          t = Math.imul(t ^ (t >>> 15), t | 1);
          t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
          return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
        window.__game.start();
        window.__game.warp(0.02); // hand the brain a reference to this run's sim
        return window.__bots.probe(sec, mode, run + 1);
      },
      [SECONDS, mode, i],
    );
    rows.push(r);
    const b = Object.values(r.bots).filter((_, idx) => idx < 4);
    const idle = b.reduce((s, x) => s + x.idle, 0) / b.length;
    const jobs = b.reduce((s, x) => s + x.jobs, 0);
    const done = b.reduce((s, x) => s + x.done, 0);
    console.log(
      `${mode.padEnd(5)} run ${String(i + 1).padStart(2)}  t=${String(r.time).padStart(5)}  served=${String(r.served).padStart(2)}` +
        `  missed=${String(r.missed).padStart(2)}  pat=${String(r.patience).padStart(4)}` +
        `  idle=${((idle / r.seconds) * 100).toFixed(0).padStart(2)}%  done/jobs=${done}/${jobs}` +
        `  void=${b.reduce((s, x) => s + x.voids, 0)}  stall=${b.reduce((s, x) => s + x.stalls, 0)}` +
        `  sour=${b.reduce((s, x) => s + x.sours, 0)}  bump/min=${r.contactPerMin}`,
    );
  }
  results[mode] = rows;
}

function stat(rows, f) {
  const v = rows.map(f).sort((a, b) => a - b);
  const mean = v.reduce((s, x) => s + x, 0) / v.length;
  return { min: v[0], med: v[(v.length / 2) | 0], max: v[v.length - 1], mean: +mean.toFixed(2) };
}

console.log('\n================ SUMMARY ================');
for (const mode of MODES) {
  const rows = results[mode];
  const nBots = Object.keys(rows[0].bots).length;
  const agg = (key) =>
    stat(rows, (r) => Object.values(r.bots).reduce((s, x) => s + x[key], 0) / (nBots * r.seconds));
  const served = stat(rows, (r) => r.served);
  const missed = stat(rows, (r) => r.missed);
  console.log(
    `\n[${mode}]  chefs working=${nBots}   served ${served.min}/${served.med}/${served.max} (mean ${served.mean})` +
      `  = ${((served.mean / SECONDS) * 60).toFixed(2)} dishes/min`,
  );
  console.log(
    `  missed ${missed.min}/${missed.med}/${missed.max}   close rate ${(
      (served.mean / Math.max(1, served.mean + missed.mean)) *
      100
    ).toFixed(0)}%   reached-the-clock ${rows.filter((r) => r.time >= SECONDS - 2).length}/${rows.length}`,
  );
  for (const key of ['idle', 'hesitate', 'travel', 'station', 'work']) {
    const a = agg(key);
    console.log(`  ${key.padEnd(9)} ${(a.mean * 100).toFixed(1).padStart(5)}%  (min ${(a.min * 100).toFixed(1)}%  max ${(a.max * 100).toFixed(1)}%)`);
  }
  const jobs = stat(rows, (r) => Object.values(r.bots).reduce((s, x) => s + x.jobs, 0));
  const done = stat(rows, (r) => Object.values(r.bots).reduce((s, x) => s + x.done, 0));
  console.log(`  jobs ${jobs.mean}  done ${done.mean}  completion ${((done.mean / jobs.mean) * 100).toFixed(0)}%`);
  for (const key of ['voids', 'stolen', 'stalls', 'sours', 'yields']) {
    console.log(`  ${key.padEnd(9)} ${stat(rows, (r) => Object.values(r.bots).reduce((s, x) => s + x[key], 0)).mean}`);
  }
  console.log(
    `  jobless-all ${(stat(rows, (r) => r.joblessAllFrac).mean * 100).toFixed(1)}%` +
      `  bumps/min ${stat(rows, (r) => r.contactPerMin).mean}` +
      `  in-contact ${(stat(rows, (r) => r.contactFrac).mean * 100).toFixed(1)}%`,
  );
  console.log(
    `  clot (3+ chefs within 2u) ${(stat(rows, (r) => r.clotFrac).mean * 100).toFixed(1)}%` +
      `  mean pairwise spread ${stat(rows, (r) => r.spreadMean).mean}u` +
      `  whole cast on one side of the room ${(stat(rows, (r) => r.onesideFrac).mean * 100).toFixed(1)}%`,
  );
  console.log(
    `  boards free (mean of 9) ${stat(rows, (r) => r.boardsFreeMean).mean}` +
      `  all-boards-taken ${(stat(rows, (r) => r.boardsAllTakenFrac).mean * 100).toFixed(1)}%` +
      `  plates out ${stat(rows, (r) => r.platesOutMean).mean}`,
  );
  if (SHOW_WHY) {
    const why = new Map();
    for (const r of rows)
      for (const b of Object.values(r.bots))
        for (const [k, v] of Object.entries(b.why)) why.set(k, (why.get(k) ?? 0) + v);
    const total = [...why.values()].reduce((s, x) => s + x, 0);
    const nulls = new Map();
    for (const r of rows)
      for (const b of Object.values(r.bots))
        for (const [k, v] of Object.entries(b.nullWhy ?? {})) nulls.set(k, (nulls.get(k) ?? 0) + v);
    const nt = [...nulls.values()].reduce((s, x) => s + x, 0);
    console.log('  IDLE, itemised (planner returned nothing because):');
    for (const [k, v] of [...nulls].sort((a, b) => b[1] - a[1]))
      console.log(`    ${((v / nt) * 100).toFixed(1).padStart(5)}%  ${k}`);
    const closed = new Map();
    const rotted = new Map();
    for (const r of rows) {
      for (const [k, v] of Object.entries(r.closed ?? {})) closed.set(k, (closed.get(k) ?? 0) + v);
      for (const [k, v] of Object.entries(r.rotted ?? {})) rotted.set(k, (rotted.get(k) ?? 0) + v);
    }
    console.log('  tickets by recipe   closed / rotted:');
    for (const k of new Set([...closed.keys(), ...rotted.keys()]))
      console.log(`    ${String(closed.get(k) ?? 0).padStart(4)} / ${String(rotted.get(k) ?? 0).padStart(4)}   ${k}`);
    const ev = new Map();
    for (const r of rows) for (const [k, v] of Object.entries(r.events ?? {})) ev.set(k, (ev.get(k) ?? 0) + v);
    console.log(
      '  events/run: ' +
        [...ev]
          .filter(([k]) => !['footstep', 'chopTick', 'place', 'pickup'].includes(k))
          .map(([k, v]) => `${k} ${(v / rows.length).toFixed(1)}`)
          .join('  '),
    );
    console.log('  plans by kind:');
    for (const [k, v] of [...why].sort((a, b) => b[1] - a[1]))
      console.log(`    ${((v / total) * 100).toFixed(1).padStart(5)}%  ${k}`);
    // Per-bot job mix: are they three copies of one program?
    for (let id = 0; id < 4; id++) {
      const mix = new Map();
      let n = 0;
      for (const r of rows) {
        const b = r.bots[id];
        if (!b) continue;
        for (const [k, v] of Object.entries(b.why)) {
          mix.set(k, (mix.get(k) ?? 0) + v);
          n += v;
        }
      }
      if (!n) continue;
      const top = [...mix].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k} ${((v / n) * 100) | 0}%`);
      const where = rows.map((r) => r.bots[id]?.home).filter(Boolean);
      console.log(`    chef ${id} (lives at ${where[0] ?? '?'}): ${top.join(' | ')}`);
    }
  }
}
console.log(`\npageerrors: ${errors.length}`);
if (errors.length) console.log(errors.slice(0, 5).join('\n'));
if (argv.json) fs.writeFileSync(path.join(ROOT, argv.json), JSON.stringify(results, null, 1));

await browser.close();
server.close();
