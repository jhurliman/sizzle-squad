/**
 * GRAB SWEEP — prices the input buffer at both bounds.
 *
 * This is tools/critic_station.mjs rig 1 with its classifier repaired and a
 * sweep wrapped round it.
 *
 * THE CLASSIFIER BUG. Rig 1 decides which crate a pickup came from with
 *
 *     gotFrom = t === pressTick ? (ch.focus ?? willFocus) : -2;
 *
 * i.e. anything that resolves on a LATER tick than the press is recorded as
 * "wrong item" by definition. That was sound when a press could only ever
 * resolve on its own tick; against a buffered press it reports 100% wrong-item
 * for grabs that are in fact 100% on target. Here the source station is read
 * off the `pickup` event's own `at`, which is `stationCenter(st)` of the
 * station `doGrab` actually acted on — the sim's answer, not an inference.
 *
 *   node tools/grabsweep.mjs            # sweep the buffer 0 -> 0.30s
 *   node tools/grabsweep.mjs 0.15       # one value, full offset table
 */
import { build } from 'rolldown';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(os.tmpdir(), `gs-${process.pid}.mjs`);
const ENTRY = path.join(os.tmpdir(), `gs-entry-${process.pid}.ts`);
fs.writeFileSync(
  ENTRY,
  `export * from ${JSON.stringify(path.join(ROOT, 'src/domain/sim.ts'))};
export * from ${JSON.stringify(path.join(ROOT, 'src/domain/content.ts'))};
export * from ${JSON.stringify(path.join(ROOT, 'src/domain/kitchen.ts'))};
export * from ${JSON.stringify(path.join(ROOT, 'src/domain/nav.ts'))};
`,
);
await build({ input: ENTRY, output: { file: OUT, format: 'esm' }, logLevel: 'silent' });
const S = await import(OUT);
fs.rmSync(ENTRY, { force: true });
fs.rmSync(OUT, { force: true });
const { createSim, step, SIM_DT, TUNING, seedPans, buildKitchen, stationCenter, isWalkable, buildFlow, flowDir } = S;

const NO = { move: { x: 0, y: 0 }, grabPressed: false, useHeld: false, dashPressed: false };
const R = TUNING.chefRadius;
const K0 = buildKitchen();

function collides(K, x, y) {
  for (let cy = Math.floor(y - R); cy <= Math.floor(y + R); cy++)
    for (let cx = Math.floor(x - R); cx <= Math.floor(x + R); cx++) {
      if (isWalkable(K, cx, cy)) continue;
      const px = Math.max(cx, Math.min(x, cx + 1));
      const py = Math.max(cy, Math.min(y, cy + 1));
      if ((x - px) ** 2 + (y - py) ** 2 < R * R) return true;
    }
  return false;
}
const boxDist = (st, x, y) =>
  Math.hypot(Math.max(st.cell.x - x, 0, x - (st.cell.x + 1)), Math.max(st.cell.y - y, 0, y - (st.cell.y + 1)));
function soloSim(seed = 7) {
  const s = createSim({ seed, botCount: 0 });
  seedPans(s);
  return s;
}
/** Which station is this event's `at` the centre of? */
function stationAtPoint(p) {
  for (const st of K0.stations) {
    const c = stationCenter(st);
    if (Math.abs(c.x - p.x) < 1e-6 && Math.abs(c.y - p.y) < 1e-6) return st.id;
  }
  return -1;
}

const BEARINGS = 24;
const OFFSETS = [];
for (let t = -18; t <= 2; t++) OFFSETS.push(t);

function runOnce() {
  const tally = new Map(OFFSETS.map((o) => [o, { hit: 0, wrong: 0, dead: 0, tot: 0, lat: [] }]));
  for (const target of K0.stations.filter((st) => st.kind === 'crate' || st.kind === 'plates')) {
    const c = stationCenter(target);
    const flow = buildFlow(K0, [{ x: Math.floor(c.x), y: Math.floor(c.y) }]);
    for (let b = 0; b < BEARINGS; b++) {
      const a = (b / BEARINGS) * Math.PI * 2;
      let start = null;
      for (let d = 4.5; d >= 2.0; d -= 0.25) {
        const x = c.x + Math.cos(a) * d;
        const y = c.y + Math.sin(a) * d;
        if (x > R && y > R && x < K0.width - R && y < K0.height - R && !collides(K0, x, y)) { start = { x, y }; break; }
      }
      if (!start) continue;
      // Pass 1 with the buffer disabled: the tick the station first becomes
      // focusable is a property of the GATE, and must not move as we sweep.
      const keep = TUNING.grabBufferSeconds;
      TUNING.grabBufferSeconds = 0;
      let firstFocus = -1;
      {
        const s = soloSim();
        const ch = s.chefs[0];
        ch.pos.x = start.x; ch.pos.y = start.y; ch.carrying = null;
        for (let t = 0; t < 240; t++) {
          step(s, [{ ...NO, move: boxDist(target, ch.pos.x, ch.pos.y) < 0.75 ? { x: 0, y: 0 } : flowDir(flow, K0, ch.pos) }]);
          if (ch.focus === target.id) { firstFocus = t; break; }
        }
      }
      TUNING.grabBufferSeconds = keep;
      if (firstFocus < 0) continue;

      for (const off of OFFSETS) {
        const pressTick = firstFocus + off;
        if (pressTick < 0) continue;
        const s = soloSim();
        const ch = s.chefs[0];
        ch.pos.x = start.x; ch.pos.y = start.y; ch.carrying = null;
        let from = null, at = -1;
        for (let t = 0; t < firstFocus + 40; t++) {
          s.events.length = 0;
          step(s, [{ ...NO, move: boxDist(target, ch.pos.x, ch.pos.y) < 0.75 ? { x: 0, y: 0 } : flowDir(flow, K0, ch.pos), grabPressed: t === pressTick }]);
          const ev = s.events.find((e) => e.t === 'pickup');
          if (ev) { from = stationAtPoint(ev.at); at = t; break; }
        }
        const rec = tally.get(off);
        rec.tot++;
        if (from === null) rec.dead++;
        else if (from === target.id) { rec.hit++; rec.lat.push((at - pressTick) * SIM_DT * 1000); }
        else rec.wrong++;
      }
    }
  }
  return tally;
}

function table(tally) {
  console.log('   press offset vs first focusable tick -> what the press did (source read off the pickup event)');
  for (const o of OFFSETS) {
    const r = tally.get(o);
    if (!r.tot) continue;
    const lat = r.lat.length ? r.lat.reduce((a, b) => a + b, 0) / r.lat.length : 0;
    console.log(
      `   t${o >= 0 ? '+' : ''}${String(o).padStart(3)} (${(o * SIM_DT * 1000).toFixed(0).padStart(5)} ms)  ON TARGET ${((r.hit / r.tot) * 100).toFixed(1).padStart(6)}%  wrong bench ${((r.wrong / r.tot) * 100).toFixed(0).padStart(3)}%  nothing ${((r.dead / r.tot) * 100).toFixed(0).padStart(3)}%  mean wait ${lat.toFixed(0).padStart(3)}ms  ${'#'.repeat(Math.round((r.hit / r.tot) * 34))}`,
    );
  }
}

const arg = process.argv[2];
if (arg) {
  TUNING.grabBufferSeconds = Number(arg);
  console.log(`== GRAB BUFFER ${(TUNING.grabBufferSeconds * 1000).toFixed(0)}ms`);
  table(runOnce());
} else {
  console.log('== GRAB BUFFER SWEEP  (crates x 8 bearings, real flow-field walk-up)');
  console.log('   buffer |  on target at -200 / -100 / -50 / 0 ms   |  wrong bench at -200ms  | dead at -100ms');
  for (const v of [0.001, 0.05, 0.1, 0.15, 0.2, 0.3]) {
    TUNING.grabBufferSeconds = v;
    const t = runOnce();
    const pick = (o, k) => {
      const r = t.get(o);
      return r && r.tot ? ((r[k] / r.tot) * 100).toFixed(0).padStart(4) : '   -';
    };
    console.log(
      `   ${(v * 1000).toFixed(0).padStart(4)}ms |      ${pick(-12, 'hit')}% ${pick(-6, 'hit')}% ${pick(-3, 'hit')}% ${pick(0, 'hit')}%          |          ${pick(-12, 'wrong')}%          |     ${pick(-6, 'dead')}%`,
    );
  }
}
