/**
 * BUMP PROBE — how far apart does one bump actually put two bodies?
 *
 * The critic measured 0.261u of separation against a 0.72u body diameter and
 * 75.7% of bumps re-hitting the same chef inside a second. Both bounds matter:
 * under one diameter the pair cannot part, and far over it the knock stops
 * being "loud, funny, survivable" and becomes a launch. This sweeps
 * TUNING.bumpKnockback and reports, in body widths, what each value buys.
 *
 *   node tools/bumpprobe.mjs [--sweep 3.2,5,6.5,8]
 *
 * Arena is a bare 61x61 box so nothing but the impulse is being measured.
 */
import { build } from 'rolldown';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(os.tmpdir(), `bp-${process.pid}.mjs`);
const ENTRY = path.join(os.tmpdir(), `bpe-${process.pid}.ts`);
fs.writeFileSync(
  ENTRY,
  `export * from ${JSON.stringify(path.join(ROOT, 'src/domain/sim.ts'))};
export * from ${JSON.stringify(path.join(ROOT, 'src/domain/content.ts'))};
export * from ${JSON.stringify(path.join(ROOT, 'src/domain/kitchen.ts'))};
`,
);
await build({ input: ENTRY, output: { file: OUT, format: 'esm' }, logLevel: 'silent' });
const S = await import(OUT);
fs.rmSync(ENTRY, { force: true });
fs.rmSync(OUT, { force: true });
const { createSim, step, TUNING, buildKitchen } = S;
const IN = (m = { x: 0, y: 0 }) => ({ move: m, grabPressed: false, useHeld: false, dashPressed: false });

const N = 61;
const rows = [];
for (let y = 0; y < N; y++) rows.push(y === 0 || y === N - 1 ? '#'.repeat(N) : '#' + '.'.repeat(N - 2) + '#');
const D = 2 * TUNING.chefRadius;

const arg = (k, d) => { const i = process.argv.indexOf(k); return i < 0 ? d : process.argv[i + 1]; };
const SWEEP = String(arg('--sweep', '3.2,4.5,5.5,6.5,8.0')).split(',').map(Number);

/** head-on at cruise, both holding the stick into each other after the bump */
function run(kick, holdInto) {
  TUNING.bumpKnockback = kick;
  const s = createSim({ seed: 1, botCount: 1 });
  s.kitchen = buildKitchen(rows);
  const [a, b] = s.chefs;
  a.pos = { x: 28.0, y: 30 }; a.vel = { x: TUNING.moveSpeed, y: 0 }; a.heading = 0;
  b.pos = { x: 32.0, y: 30 }; b.vel = { x: -TUNING.moveSpeed, y: 0 }; b.heading = Math.PI;
  let bumpTick = -1, bumps = 0, peakSep = 0;
  const sepAt = {};
  for (let i = 0; i < 180; i++) {
    // hold the stick INTO the contact until the bump fires; after that either
    // keep leaning in (worst case) or let go (pure impulse)
    const lean = holdInto || bumpTick < 0;
    const inA = lean ? IN({ x: 1, y: 0 }) : IN();
    const inB = lean ? IN({ x: -1, y: 0 }) : IN();
    step(s, [inA, inB]);
    for (const e of s.events) if (e.t === 'bump') { bumps++; if (bumpTick < 0) bumpTick = i; }
    s.events.length = 0;
    const sep = Math.abs(b.pos.x - a.pos.x);
    peakSep = Math.max(peakSep, sep);
    if (bumpTick >= 0) {
      const dt = (i - bumpTick) / 60;
      for (const t of [0.16, 0.35, 0.6, 1.0]) if (Math.abs(dt - t) < 1 / 120) sepAt[t] = sep - D;
    }
  }
  return { bumps, sepAt, peakGap: peakSep - D };
}

const base = TUNING.bumpKnockback;
console.log(`body diameter ${D.toFixed(2)}u   stunDrag ${TUNING.stunDrag}   bumpStun ${TUNING.bumpStun}`);
console.log('\nHEAD-ON AT CRUISE, BOTH STICKS RELEASED ON IMPACT (pure impulse)');
console.log('  kick   bumps  gapAt0.16s  gapAt0.35s  gapAt0.6s  gapAt1.0s   (gap = surface to surface, u)');
for (const k of SWEEP) {
  const r = run(k, false);
  const f = (v) => (v === undefined ? '   -   ' : v.toFixed(3).padStart(7));
  console.log(`  ${String(k).padEnd(6)} ${String(r.bumps).padEnd(6)} ${f(r.sepAt[0.16])}     ${f(r.sepAt[0.35])}     ${f(r.sepAt[0.6])}    ${f(r.sepAt[1.0])}`);
}
console.log('\nHEAD-ON AT CRUISE, BOTH STICKS STILL PRESSED INTO EACH OTHER (worst case)');
console.log('  kick   bumps  gapAt0.16s  gapAt0.35s  gapAt0.6s  gapAt1.0s   bumps = re-fires');
for (const k of SWEEP) {
  const r = run(k, true);
  const f = (v) => (v === undefined ? '   -   ' : v.toFixed(3).padStart(7));
  console.log(`  ${String(k).padEnd(6)} ${String(r.bumps).padEnd(6)} ${f(r.sepAt[0.16])}     ${f(r.sepAt[0.35])}     ${f(r.sepAt[0.6])}    ${f(r.sepAt[1.0])}`);
}
TUNING.bumpKnockback = base;
