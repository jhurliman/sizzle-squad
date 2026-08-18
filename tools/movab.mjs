/**
 * MOVEMENT A/B — races tuning variants over identical seeds and reports what
 * each one costs the kitchen.
 *
 * `TUNING` is a plain exported object and the sim reads every field at call
 * time, so a variant is just `Object.assign(TUNING, overrides)`. The sim is
 * deterministic, so this is an EXACT A/B: same seed plus same inputs is the
 * same run, and a difference between two rows is caused by the override and by
 * nothing else. Re-running a row reproduces it to the digit.
 *
 *   node tools/movab.mjs                    # the shipped-vs-day-one race
 *   node tools/movab.mjs carry              # carry weight sweep
 *   node tools/movab.mjs turn coast bump dash
 *   SEEDBASE=50021 SEEDSTEP=113 node tools/movab.mjs turn
 *
 * READ THE SEM COLUMN BEFORE BELIEVING A ROW. `served` is a chaotic function of
 * the tuning, not a smooth one: the bot brain claims stations, and shifting any
 * constant by a hair reshuffles which bot gets which board, which cascades. An
 * early 12-seed sweep of this had "revert one lever" variants scoring both
 * above and below the two endpoints, which is noise wearing a hat. Forty seeds
 * is the minimum that separates a lever from a butterfly, and anything worth
 * shipping should also survive a second seed family via SEEDBASE.
 */
import { build } from 'rolldown';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(os.tmpdir(), `movab-${process.pid}.mjs`);
const ENTRY = path.join(os.tmpdir(), `movab-entry-${process.pid}.ts`);
fs.writeFileSync(
  ENTRY,
  `export * from ${JSON.stringify(path.join(ROOT, 'src/domain/sim.ts'))};
export * from ${JSON.stringify(path.join(ROOT, 'src/domain/content.ts'))};
export * from ${JSON.stringify(path.join(ROOT, 'src/domain/kitchen.ts'))};
export * from ${JSON.stringify(path.join(ROOT, 'src/bots/brain.ts'))};
`,
);
await build({ input: ENTRY, output: { file: OUT, format: 'esm' }, logLevel: 'silent' });
const S = await import(OUT);
fs.rmSync(ENTRY, { force: true });
fs.rmSync(OUT, { force: true });
const { createSim, step, SIM_DT, TUNING, BotDirector, seedPans } = S;

const NO = { move: { x: 0, y: 0 }, grabPressed: false, useHeld: false, dashPressed: false };
const RUNS = Number(process.env.RUNS ?? 40);
const SECONDS = Number(process.env.SECONDS ?? 170);
const SEEDS = [];
for (let i = 0; i < RUNS; i++) SEEDS.push(Number(process.env.SEEDBASE ?? 1000) + i * Number(process.env.SEEDSTEP ?? 37));

function run() {
  const served = [];
  let bumps = 0;
  let chefSeconds = 0;
  let stunTicks = 0;
  for (const seed of SEEDS) {
    const s = createSim({ seed, botCount: 3 });
    seedPans(s);
    const dir = new BotDirector();
    // Every chef on the brain, player slot included: this measures the movement
    // model under load, not one scripted route.
    for (const c of s.chefs) c.isPlayer = false;
    let t = 0;
    for (let i = 0; i < SECONDS * 60; i++) {
      const map = dir.update(s, SIM_DT);
      step(s, s.chefs.map((c) => map.get(c.id) ?? NO));
      for (const e of s.events) if (e.t === 'bump') bumps++;
      s.events.length = 0;
      for (const c of s.chefs) if (c.stun > 0) stunTicks++;
      t = i + 1;
      if (s.over) break;
    }
    chefSeconds += (t / 60) * s.chefs.length;
    served.push(s.score.served);
  }
  const sorted = [...served].sort((a, b) => a - b);
  const mean = served.reduce((a, b) => a + b, 0) / served.length;
  const sd = Math.sqrt(served.reduce((a, b) => a + (b - mean) ** 2, 0) / served.length);
  return {
    mean: mean.toFixed(2),
    sem: (sd / Math.sqrt(served.length)).toFixed(2),
    med: sorted[Math.floor(sorted.length / 2)],
    lo: sorted[0],
    hi: sorted[sorted.length - 1],
    bumpGap: (chefSeconds / Math.max(1, bumps)).toFixed(1),
    stunPct: (((stunTicks * SIM_DT) / chefSeconds) * 100).toFixed(2),
  };
}

/**
 * The day-one tuning, for the headline race. `bumpClosingSpeed` has no honest
 * pre-pass value — the old rule tested |va - vb| against moveSpeed * 0.8, which
 * is a different quantity — so this set leaves the new rule in place and the
 * bump row of the headline race is NOT a like-for-like. The real old bump
 * numbers are one per chef every 2.86s at 6.88% of chef time stunned, measured
 * on the unmodified sim by `tools/movprobe.mjs --only bumprate`.
 */
const DAY_ONE = {
  carrySpeedMul: 0.9,
  carryAccelMul: 1,
  carryTurnMul: 1,
  accelTime: 0.085,
  decelTime: 0.11,
  turnRate: 18,
  cornerSlip: 0,
  coastTurnSpeed: Infinity,
  dashSpeed: 12.5,
  dashSeconds: 0.18,
  dashCooldown: 0.55,
  bumpKnockback: 0,
  bumpStun: 0.22,
};

const SUITES = {
  ship: [
    ['shipped', {}],
    ['day-one movement (see note)', DAY_ONE],
    ['shipped minus corner slip', { cornerSlip: 0 }],
    ['shipped minus carry weight', { carrySpeedMul: 0.9, carryAccelMul: 1 }],
    ['shipped with the old dash', { dashSpeed: 12.5, dashSeconds: 0.18, dashCooldown: 0.55 }],
  ],
  carry: [
    ['carry 0.90 / accel 1.0', { carrySpeedMul: 0.9, carryAccelMul: 1 }],
    ['carry 0.86 / accel 1.5', { carrySpeedMul: 0.86 }],
    ['carry 0.82 / accel 1.5 (shipped)', {}],
    ['carry 0.82 / accel 1.0', { carryAccelMul: 1 }],
    ['carry 0.78 / accel 1.5', { carrySpeedMul: 0.78 }],
  ],
  turn: [
    ['turnRate 18 (day one)', { turnRate: 18 }],
    ['turnRate 15', { turnRate: 15 }],
    ['turnRate 12 (shipped)', {}],
    ['turnRate 10', { turnRate: 10 }],
    ['turnRate 12 + carryTurnMul 0.78', { carryTurnMul: 0.78 }],
  ],
  coast: [
    ['coast-turn off', { coastTurnSpeed: Infinity }],
    ['coast-turn always', { coastTurnSkid: 0 }],
    ['coast-turn skid > 34 deg', { coastTurnSkid: 0.6 }],
    ['coast-turn skid > 60 deg (shipped)', {}],
  ],
  bump: [
    ['bumpClosingSpeed 4.5', { bumpClosingSpeed: 4.5 }],
    ['bumpClosingSpeed 5.0', { bumpClosingSpeed: 5.0 }],
    ['bumpClosingSpeed 5.5 (shipped)', {}],
    ['bumpClosingSpeed 6.5', { bumpClosingSpeed: 6.5 }],
    ['no knockback, 0.22s stun', { bumpKnockback: 0, bumpStun: 0.22 }],
  ],
  cross: [
    ['turn 18, coast off', { turnRate: 18, coastTurnSpeed: Infinity }],
    ['turn 18, coast skid60', { turnRate: 18 }],
    ['turn 15, coast off', { turnRate: 15, coastTurnSpeed: Infinity }],
    ['turn 15, coast skid60', { turnRate: 15 }],
    ['turn 12, coast off', { turnRate: 12, coastTurnSpeed: Infinity }],
    ['turn 12, coast skid60 (shipped)', {}],
    ['turn 10, coast off', { turnRate: 10, coastTurnSpeed: Infinity }],
    ['turn 10, coast skid60', { turnRate: 10 }],
  ],
  dash: [
    ['12.5 / 0.18 / 0.55 (day one)', { dashSpeed: 12.5, dashSeconds: 0.18, dashCooldown: 0.55 }],
    ['12.0 / 0.16 / 0.80', { dashCooldown: 0.8 }],
    ['12.0 / 0.16 / 1.00 (shipped)', {}],
    ['12.0 / 0.16 / 1.30', { dashCooldown: 1.3 }],
  ],
};

const BASE = { ...TUNING };
const which = process.argv.slice(2).filter((a) => SUITES[a]);
for (const name of which.length ? which : ['ship']) {
  console.log(`\n\x1b[1m${name.toUpperCase()}\x1b[0m   ${SEEDS.length} seeds x ${SECONDS}s, seedbase ${SEEDS[0]}`);
  console.log('  variant                              served  +/-    med  range   bump gap  stunned');
  for (const [label, ov] of SUITES[name]) {
    Object.assign(TUNING, BASE, ov);
    const r = run();
    console.log(
      `  ${label.padEnd(36)} ${String(r.mean).padEnd(7)} ${String(r.sem).padEnd(6)} ${String(r.med).padEnd(4)} ${(r.lo + '-' + r.hi).padEnd(7)} ${(r.bumpGap + 's').padEnd(9)} ${r.stunPct}%`,
    );
  }
  Object.assign(TUNING, BASE);
}
console.log('');
