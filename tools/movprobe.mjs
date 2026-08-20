/**
 * MOVEMENT PROBE — drives scripted routes through the REAL sim and prints
 * numbers. No renderer, no browser: `src/domain` is pure, so we bundle it with
 * rolldown and run it in node at the true fixed 60Hz tick.
 *
 * Why this exists: nobody has ever judged how this kitchen FEELS, and the
 * things that decide that — time to top speed, coast distance, how much speed a
 * corner costs, whether the carry penalty is above the just-noticeable
 * difference, whether a chef slides off a
 * bench corner or welds himself to it — are all invisible in a screenshot and
 * trivial in a log.
 *
 *   node tools/movprobe.mjs                    # full report
 *   node tools/movprobe.mjs --json             # machine readable
 *   node tools/movprobe.mjs --only accel,turn  # accel reverse turn bump
 *                                              # clip weave route lanes tuning
 *
 * TWO RIGS, ON PURPOSE.
 *
 * The MODEL measurements (accel, stop, reversal, turn) run in a 61x61
 * arena of bare floor built through the same `buildKitchen`, because in the
 * real 15x11 room a chef at 6.2 u/s hits the far wall in under two seconds and
 * every "top speed" you measure is a wall-stall. The first cut of this tool
 * reported a top speed of 0.053 u/s for exactly that reason.
 *
 * The LEVEL measurements (clip, weave, route) run in the real kitchen with
 * botCount 0. One chef means `resolveChefCollisions` never writes a position,
 * so a tick where `pos` did not advance by `vel * dt` is unambiguously a wall
 * rejection inside `moveChef` — that is how corner catches are detected from
 * outside without putting a debug hook in a pure module.
 */
import { build } from 'rolldown';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(os.tmpdir(), `movprobe-${process.pid}.mjs`);
const ENTRY = path.join(os.tmpdir(), `movprobe-entry-${process.pid}.ts`);

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

const { createSim, step, SIM_DT, TUNING, buildKitchen, isWalkable } = S;
const DT = SIM_DT;

const argv = process.argv.slice(2);
const asJson = argv.includes('--json');
const ONLY = argv.includes('--only') ? new Set(argv[argv.indexOf('--only') + 1].split(',')) : null;
const want = (k) => !ONLY || ONLY.has(k);

const r2 = (n) => Math.round(n * 100) / 100;
const r3 = (n) => Math.round(n * 1000) / 1000;

// ------------------------------------------------------------------ driving

const IN = (move = { x: 0, y: 0 }, o = {}) => ({
  move,
  grabPressed: !!o.grab,
  useHeld: !!o.use,
});

const N = 61;
const ARENA = (() => {
  const rows = [];
  for (let y = 0; y < N; y++) {
    if (y === 0 || y === N - 1) rows.push('#'.repeat(N));
    else rows.push('#' + '.'.repeat(N - 2) + '#');
  }
  return rows;
})();
const OPEN_KITCHEN = buildKitchen(ARENA);
const REAL = buildKitchen();
const MID = { x: N / 2, y: N / 2 };

function carryOf(kind) {
  if (kind === 'plate') return { type: 'plate', plate: { id: 9001, contents: [], dirty: false, stack: 1 } };
  if (kind === 'ingredient') return { type: 'ingredient', ingredient: { id: 9002, kind: 'tomato', state: 'raw', progress: 0, overcook: 0 } };
  if (kind === 'pan') return { type: 'pan', pan: { id: 9003, contents: [], onHeat: false, fire: 0 } };
  return null;
}

/** A one-chef sim. `open` swaps in the bare arena. */
function rig(at, carry = null, open = false) {
  const s = createSim({ seed: 4242, botCount: 0 });
  if (open) s.kitchen = OPEN_KITCHEN;
  const c = s.chefs[0];
  c.pos = { ...at };
  c.vel = { x: 0, y: 0 };
  c.heading = 0;
  c.carrying = carryOf(carry);
  return s;
}

function drive(s, ticks, inputFn) {
  const c = s.chefs[0];
  const log = [];
  for (let i = 0; i < ticks; i++) {
    const t = i * DT;
    const px = c.pos.x;
    const py = c.pos.y;
    const inp = inputFn(t, c) ?? IN();
    step(s, [inp]);
    s.events.length = 0;
    const dx = c.pos.x - px;
    const dy = c.pos.y - py;
    log.push({
      t: t + DT,
      x: c.pos.x,
      y: c.pos.y,
      vx: c.vel.x,
      vy: c.vel.y,
      sp: Math.hypot(c.vel.x, c.vel.y),
      gs: Math.hypot(dx, dy) / DT, // ground speed: what the eye actually reads
      heading: c.heading,
      blockX: dx === 0 && c.vel.x !== 0,
      blockY: dy === 0 && c.vel.y !== 0,
      inMag: Math.hypot(inp.move.x, inp.move.y),
    });
  }
  return log;
}

const dAng = (a, b) => {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
};

// -------------------------------------------------------- 1. straight line

function straightProfile(carry) {
  const s = rig(MID, carry, true);
  const acc = drive(s, 90, () => IN({ x: 1, y: 0 })); // 1.5 s
  const top = acc[acc.length - 1].sp;
  const x0 = MID.x;
  const at = (frac) => acc.find((r) => r.sp >= top * frac);
  const start = s.chefs[0].pos.x;
  const stopLog = drive(s, 180, () => IN());
  const stopAt = (v) => {
    const hit = stopLog.find((r) => r.sp <= v);
    return hit ? { t: r3(hit.t), d: r3(hit.x - start) } : { t: NaN, d: NaN };
  };
  return {
    carry: carry ?? 'empty',
    topSpeed: r3(top),
    t50: r3(at(0.5).t),
    t90: r3(at(0.9).t),
    t99: r3(at(0.99).t),
    distTo90: r3(at(0.9).x - x0),
    stop1_0: stopAt(1.0),
    stop0_15: stopAt(0.15),
    coastTotal: r3(stopLog[stopLog.length - 1].x - start),
  };
}

// ----------------------------------------------------------- 2. reversal

function reversal(carry) {
  const s = rig(MID, carry, true);
  drive(s, 90, () => IN({ x: 1, y: 0 }));
  const top = Math.hypot(s.chefs[0].vel.x, s.chefs[0].vel.y);
  const x0 = s.chefs[0].pos.x;
  const log = drive(s, 90, () => IN({ x: -1, y: 0 }));
  const zero = log.find((r) => r.vx <= 0);
  const back = log.find((r) => r.vx <= -top * 0.9);
  return {
    carry: carry ?? 'empty',
    topSpeed: r3(top),
    tToZero: r3(zero ? zero.t : NaN),
    tToFullReverse: r3(back ? back.t : NaN),
    /** how far he keeps travelling the OLD way after the input flipped */
    slidePastFlip: r3(Math.max(...log.map((r) => r.x)) - x0),
  };
}

// -------------------------------------------------------------- 3. turns

function turn(deg, carry) {
  const s = rig(MID, carry, true);
  drive(s, 90, () => IN({ x: 1, y: 0 }));
  const top = Math.hypot(s.chefs[0].vel.x, s.chefs[0].vel.y);
  const rad = (deg * Math.PI) / 180;
  const nx = Math.cos(rad);
  const ny = Math.sin(rad);
  const log = drive(s, 60, () => IN({ x: nx, y: ny }));
  const minSp = Math.min(...log.map((r) => r.sp));
  const wantH = Math.atan2(ny, nx);
  const headOk = log.find((r) => Math.abs(dAng(r.heading, wantH)) < 0.09);
  const velOk = log.find((r) => Math.abs(dAng(Math.atan2(r.vy, r.vx), wantH)) < 0.09);
  // Widest excursion perpendicular to the NEW heading = the corner's radius.
  const px = -ny;
  const py = nx;
  const swing = Math.max(...log.map((r) => Math.abs((r.x - log[0].x) * px + (r.y - log[0].y) * py)));
  // How long the body is pointing somewhere other than where it is travelling.
  const skid = log.filter((r) => Math.abs(dAng(r.heading, Math.atan2(r.vy, r.vx))) > 0.35).length * DT;
  return {
    deg,
    carry: carry ?? 'empty',
    speedKeptPct: Math.round((minSp / top) * 100),
    tVelAligned: r3(velOk ? velOk.t : NaN),
    tHeadAligned: r3(headOk ? headOk.t : NaN),
    turnRadius: r3(swing),
    skidSeconds: r3(skid),
  };
}

// --------------------------------------------------------------- 5. bump

function bumpProfile() {
  const s = createSim({ seed: 7, botCount: 1 });
  s.kitchen = OPEN_KITCHEN;
  const [a, b] = s.chefs;
  a.pos = { x: MID.x - 4, y: MID.y };
  b.pos = { x: MID.x + 4, y: MID.y };
  a.vel = { x: 0, y: 0 };
  b.vel = { x: 0, y: 0 };
  const log = [];
  let bumpTick = -1;
  for (let i = 0; i < 300; i++) {
    step(s, [IN({ x: 1, y: 0 }), IN({ x: -1, y: 0 })]);
    for (const e of s.events) if (e.t === 'bump' && bumpTick < 0) bumpTick = i;
    s.events.length = 0;
    log.push({
      t: (i + 1) * DT,
      ax: a.pos.x,
      asp: Math.hypot(a.vel.x, a.vel.y),
      avx: a.vel.x,
      astun: a.stun,
      gap: b.pos.x - a.pos.x,
    });
  }
  if (bumpTick < 0) return { bumped: false };
  const pre = log[bumpTick - 1];
  const after = log.slice(bumpTick);
  const freed = after.find((r) => r.astun <= 0);
  const backX = after.find((r) => r.ax >= pre.ax);
  return {
    bumped: true,
    tBump: r3(log[bumpTick].t),
    closingSpeed: r3(pre.asp * 2),
    speedAtBump: r3(pre.asp),
    speedOneTickLater: r3(log[bumpTick].asp),
    /** signed: negative would be a real knockback. 0 = you just stop. */
    peakRecoilSpeed: r3(Math.min(...after.slice(0, 30).map((r) => r.avx))),
    knockbackUnits: r3(pre.ax - Math.min(...after.slice(0, 30).map((r) => r.ax))),
    stunSeconds: TUNING.bumpStun,
    tStunClears: r3(freed ? freed.t - log[bumpTick].t : NaN),
    /** seconds before you are back where you were standing when you hit */
    tRegainGround: r3(backX ? backX.t - log[bumpTick].t : NaN),
  };
}

// --------------------------------------------- 6. corner clip (the real test)

/**
 * THE CORNER TEST THAT MATTERS.
 *
 * Run flat out down a lane, parallel to a bench, at a lateral offset that makes
 * the chef's disc overlap the bench's corner cell by `pen` units. With
 * axis-separated collision and no depenetration, the x candidate is rejected
 * every tick for as long as the overlap persists — nothing ever pushes the body
 * the 3cm sideways it needs — so the chef stops dead against a corner he
 * clears 95% of. That is the failure this looks for.
 */
function cornerClip(pens = [0.005, 0.02, 0.05, 0.1, 0.18, 0.3]) {
  // A 31x31 bare arena with ONE 2x2 bench at cells (15,15)-(16,16). Isolating
  // it in an empty room is the point: the first cut of this test picked real
  // map sites whose 2-unit run-up already clipped a different bench, so it
  // reported "welded" for positions the chef was jammed in before he started.
  const M = 31;
  const rows = [];
  for (let y = 0; y < M; y++) {
    if (y === 0 || y === M - 1) {
      rows.push('#'.repeat(M));
      continue;
    }
    let r = '#';
    for (let x = 1; x < M - 1; x++) r += (x === 15 || x === 16) && (y === 15 || y === 16) ? '-' : '.';
    rows.push(r + '#');
  }
  const K = buildKitchen(rows);
  const out = [];
  for (const pen of pens) {
    // The bench's near edge is world y = 17. Put the chef's centre so his disc
    // overlaps that edge by exactly `pen`, and run him flat out along +x.
    const yc = 17 + TUNING.chefRadius - pen;
    const s = createSim({ seed: 1, botCount: 0 });
    s.kitchen = K;
    const c = s.chefs[0];
    c.pos = { x: 11, y: yc };
    c.vel = { x: 0, y: 0 };
    c.heading = 0;
    const log = drive(s, 180, () => IN({ x: 1, y: 0 }));
    const travelled = c.pos.x - 11;
    const frozen = log.filter((r) => r.gs < 0.2).length;
    out.push({
      penetrationUnits: pen,
      penetrationPctOfBody: Math.round((pen / (TUNING.chefRadius * 2)) * 100),
      travelledUnits: r2(travelled),
      frozenTicks: frozen,
      clearedTheBench: travelled > 8,
      /** how far sideways the model moved him to get him round the corner */
      lateralSlipUnits: r2(Math.abs(c.pos.y - yc)),
      exitSpeedPctOfTop: Math.round((log[log.length - 1].gs / TUNING.moveSpeed) * 100),
    });
  }
  return {
    note: '2x2 bench in a bare arena; chef runs +x with the stick pinned, disc overlapping the near edge by `pen`',
    bodyWidth: r2(TUNING.chefRadius * 2),
    passes: out,
    worstStickingPenetration: Math.min(...out.filter((r) => !r.clearedTheBench).map((r) => r.penetrationUnits), Infinity),
  };
}

// ------------------------------------------------------------- 7. weave

/**
 * SLALOM. Full stick down the length of the room, weaving one lane up and one
 * lane down through the real bench grid — the thing the brief calls "whether
 * the turn rate lets you weave between benches or fights you". Reports how much
 * of the trip is spent below half speed and how many ticks touch geometry.
 */
function weave(carry = null, amp = 1.0) {
  const s = rig({ x: 1.5, y: 8.5 }, carry, false);
  const target = TUNING.moveSpeed * (carry === 'plate' || carry === 'pan' ? TUNING.carrySpeedMul : 1);
  const log = drive(s, 60 * 8, (t, c) => {
    if (c.pos.x > 13.2) return IN();
    const wantY = 8.5 - amp * Math.sin((c.pos.x - 1.5) * 1.15);
    const dy = wantY - c.pos.y;
    const v = { x: 1, y: Math.max(-1, Math.min(1, dy * 2.2)) };
    const m = Math.hypot(v.x, v.y);
    return IN({ x: v.x / m, y: v.y / m });
  });
  const doneIdx = log.findIndex((r) => r.x > 13.2);
  const used = log.slice(0, doneIdx < 0 ? log.length : doneIdx + 1);
  let len = 0;
  for (let i = 1; i < used.length; i++) len += Math.hypot(used[i].x - used[i - 1].x, used[i].y - used[i - 1].y);
  return {
    carry: carry ?? 'empty',
    amplitude: amp,
    finished: doneIdx >= 0,
    seconds: r3(used.length * DT),
    pathUnits: r2(len),
    meanSpeed: r2(len / (used.length * DT)),
    meanSpeedPctOfTop: Math.round((len / (used.length * DT) / target) * 100),
    blockedTicks: used.filter((r) => r.blockX || r.blockY).length,
    slowTicks: used.filter((r, i) => i > 10 && r.gs < target * 0.5).length,
  };
}

// ---------------------------------------------------- 7b. parking / forgiveness

/**
 * FORGIVENESS. Run flat out at a station down its approach lane, release the
 * stick at a range of distances, and report the band of release points that
 * leave the chef stopped with that station in `findFocus`. That band is what
 * "roughly near and roughly facing is enough" means as a number, and the coast
 * distance is what shrinks it.
 */
function parking(carry = null) {
  const K = REAL;
  // Find every station with a straight clear approach lane and average the
  // release window over all of them — one hand-picked crate is one anecdote.
  const DIRS = [
    { dx: 0, dy: 1 },
    { dx: 0, dy: -1 },
    { dx: 1, dy: 0 },
    { dx: -1, dy: 0 },
  ];
  // The chef's DISC has to fit at the start of the run-up, not just its centre.
  // The first cut of this test only checked cell walkability and reported nine
  // "unparkable" approaches that were really nine chefs spawned overlapping the
  // bench behind them and welded there before the run began.
  const fits = (x, y) => {
    const r = TUNING.chefRadius;
    for (const [ox, oy] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r], [r * 0.71, r * 0.71], [-r * 0.71, r * 0.71], [r * 0.71, -r * 0.71], [-r * 0.71, -r * 0.71]])
      if (!isWalkable(K, Math.floor(x + ox), Math.floor(y + oy))) return false;
    return true;
  };
  const sites = [];
  for (const st of K.stations) {
    for (const d of DIRS) {
      let n = 0;
      while (n < 5 && isWalkable(K, st.cell.x + d.dx * (n + 1), st.cell.y + d.dy * (n + 1))) n++;
      if (n < 3) continue;
      if (!fits(st.cell.x + 0.5 + d.dx * 3.4, st.cell.y + 0.5 + d.dy * 3.4)) continue;
      sites.push({ st, d, lane: n });
    }
  }
  const windows = [];
  const rows = [];
  for (const { st, d } of sites) {
    const target = { x: st.cell.x + 0.5, y: st.cell.y + 0.5 };
    const start = { x: target.x + d.dx * 3.4, y: target.y + d.dy * 3.4 };
    const ok = [];
    for (let rel = 0.15; rel <= 3.0; rel += 0.05) {
      const s = rig(start, carry, false);
      let released = false;
      drive(s, 200, (t, c) => {
        if (Math.hypot(c.pos.x - target.x, c.pos.y - target.y) <= rel) released = true;
        return released ? IN() : IN({ x: -d.dx, y: -d.dy });
      });
      const c = s.chefs[0];
      const f = S.findFocus(s, c);
      if (f && f.id === st.id && Math.hypot(c.vel.x, c.vel.y) < 0.3) ok.push(rel);
    }
    if (!ok.length) {
      rows.push({ station: `${st.kind}@${st.cell.x},${st.cell.y}`, window: 0 });
      continue;
    }
    const w = Math.max(...ok) - Math.min(...ok);
    windows.push(w);
    rows.push({ station: `${st.kind}@${st.cell.x},${st.cell.y}`, window: r2(w), from: r2(Math.min(...ok)), to: r2(Math.max(...ok)) });
  }
  windows.sort((a, b) => a - b);
  return {
    carry: carry ?? 'empty',
    approachesTested: sites.length,
    approachesThatCanNeverPark: rows.filter((r) => !r.window).length,
    medianReleaseWindowUnits: windows.length ? r2(windows[Math.floor(windows.length / 2)]) : 0,
    worstReleaseWindowUnits: windows.length ? r2(windows[0]) : 0,
    /** the same window expressed as seconds of stick-release timing slack */
    medianWindowSeconds: windows.length ? r3(windows[Math.floor(windows.length / 2)] / TUNING.moveSpeed) : 0,
  };
}

// --------------------------------------------- 7c. bumps in a real service

/** How often does a bump actually happen with the real bots in the real room? */
function bumpRate(seconds = 150, seeds = [3, 11, 29, 101, 555, 909]) {
  // THE REAL BOTS, not an approximation: BotDirector is pure and bundles fine,
  // so this is the bump pressure an actual service produces. All four chefs run
  // on the brain (the player slot included) so the number is per-chef honest.
  let bumps = 0;
  let chefSeconds = 0;
  let served = 0;
  let stunTicks = 0;
  for (const seed of seeds) {
    const s = createSim({ seed, botCount: 3 });
    S.seedPans(s);
    const dir = new S.BotDirector();
    for (const c of s.chefs) c.isPlayer = false;
    let t = 0;
    for (let i = 0; i < seconds * 60; i++) {
      const map = dir.update(s, DT);
      step(s, s.chefs.map((c) => map.get(c.id) ?? IN()));
      for (const e of s.events) if (e.t === 'bump') bumps++;
      s.events.length = 0;
      for (const c of s.chefs) if (c.stun > 0) stunTicks++;
      t = i + 1;
      if (s.over) break;
    }
    chefSeconds += (t / 60) * s.chefs.length;
    served += s.score.served;
  }
  return {
    bumps,
    servedAcrossSeeds: served,
    perChefMinute: r2((bumps / chefSeconds) * 60),
    secondsBetweenBumpsPerChef: r2(chefSeconds / Math.max(1, bumps)),
    stunSeconds: TUNING.bumpStun,
    pctOfChefTimeStunned: r2(((stunTicks * DT) / chefSeconds) * 100),
    /** stun + the time to spin back up to cruise, per bump */
    fullCostPerBumpSeconds: r3(TUNING.bumpStun + 2.3 * TUNING.accelTime),
  };
}

// -------------------------------------------------- 7d. throughput A/B

/**
 * DOES THE TUNING COST THE KITCHEN ANYTHING? Slower carrying falls on the
 * bots, who carry constantly on every long
 * leg, so a movement pass that reads better and serves fewer dishes is a
 * regression wearing a nice coat.
 *
 * `TUNING` is a plain exported object and the sim reads every field at call
 * time, so we can flip the entire tuning set at runtime and race two variants
 * over identical seeds. The sim is deterministic, so this is an exact A/B, not
 * a sampled one.
 */
const PRE_PASS_TUNING = {
  moveSpeed: 6.2,
  carrySpeedMul: 0.9,
  carryAccelMul: 1,
  carryTurnMul: 1,
  accelTime: 0.085,
  decelTime: 0.11,
  turnRate: 18,
  cornerSlip: 0,
  bumpClosingSpeed: -Infinity, // the old test was on |va-vb|, approximated below
  bumpKnockback: 0,
  stunDrag: 0.11,
  bumpStun: 0.22,
};

function throughput(label, seconds = 170, seeds = [3, 11, 29, 101, 555, 909, 1234, 2468, 31337, 77]) {
  const served = [];
  let bumps = 0;
  let stunTicks = 0;
  let chefSeconds = 0;
  for (const seed of seeds) {
    const s = createSim({ seed, botCount: 3 });
    S.seedPans(s);
    const dir = new S.BotDirector();
    for (const c of s.chefs) c.isPlayer = false;
    let t = 0;
    for (let i = 0; i < seconds * 60; i++) {
      const map = dir.update(s, DT);
      step(s, s.chefs.map((c) => map.get(c.id) ?? IN()));
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
  return {
    label,
    seeds: seeds.length,
    servedMedian: sorted[Math.floor(sorted.length / 2)],
    servedTotal: served.reduce((a, b) => a + b, 0),
    servedRange: `${sorted[0]}-${sorted[sorted.length - 1]}`,
    bumpsPerChefMinute: r2((bumps / chefSeconds) * 60),
    pctChefTimeStunned: r2(((stunTicks * DT) / chefSeconds) * 100),
  };
}

// ------------------------------------------------------- 7e. stall audit

/**
 * STALL AUDIT — how much of a service does a chef spend motionless, and is it
 * the bot choosing to stand still or the SIM REFUSING ITS INPUT?
 *
 * This is the metric that should have been the headline all along. `served` is
 * chaotic under tuning changes; "seconds a body did not move" is not, and it
 * separates a movement defect from a planning defect cleanly: a chef stalled
 * with no station in focus is stuck in the geometry and that is the movement
 * layer's fault, while a chef stalled AT a station it is looking straight at is
 * a plan that never completed and belongs to the bot brain.
 *
 * As shipped: 12.4% of chef time is spent motionless for over eight seconds,
 * and 0.0% of it happens away from a station.
 */
function stallAudit(seconds = 170, runs = 24) {
  const seeds = [];
  for (let i = 0; i < runs; i++) seeds.push(1000 + i * 37);
  const maxima = [];
  let chefSeconds = 0;
  let over3 = 0;
  let over8AtStation = 0;
  let over8Adrift = 0;
  for (const seed of seeds) {
    const s = createSim({ seed, botCount: 3 });
    S.seedPans(s);
    const dir = new S.BotDirector();
    for (const c of s.chefs) c.isPlayer = false;
    const still = s.chefs.map(() => 0);
    const mx = s.chefs.map(() => 0);
    const last = s.chefs.map((c) => ({ ...c.pos }));
    let t = 0;
    for (let i = 0; i < seconds * 60; i++) {
      const map = dir.update(s, DT);
      step(s, s.chefs.map((c) => map.get(c.id) ?? IN()));
      s.events.length = 0;
      s.chefs.forEach((c, j) => {
        const d = Math.hypot(c.pos.x - last[j].x, c.pos.y - last[j].y);
        if (d < 0.004) {
          still[j] += DT;
          mx[j] = Math.max(mx[j], still[j]);
          if (still[j] > 3) over3 += DT;
          if (still[j] > 8) {
            if (c.focus != null) over8AtStation += DT;
            else over8Adrift += DT;
          }
        } else still[j] = 0;
        last[j] = { ...c.pos };
      });
      t = i + 1;
      if (s.over) break;
    }
    chefSeconds += (t / 60) * s.chefs.length;
    maxima.push(...mx);
  }
  maxima.sort((a, b) => a - b);
  return {
    runs: seeds.length,
    medianLongestStallSeconds: r2(maxima[Math.floor(maxima.length / 2)]),
    worstStallSeconds: r2(maxima[maxima.length - 1]),
    pctChefTimeStalledOver3s: r2((over3 / chefSeconds) * 100),
    /** a plan that never completed — the bot brain's */
    pctStalledOver8sAtAStation: r2((over8AtStation / chefSeconds) * 100),
    /** stuck in the geometry — the movement layer's. Must stay at 0. */
    pctStalledOver8sAwayFromAnyStation: r2((over8Adrift / chefSeconds) * 100),
  };
}

// ------------------------------------------------------------- 8. routes

function bfs(K, from, to) {
  const W = K.width;
  const key = (x, y) => y * W + x;
  const prev = new Map([[key(from[0], from[1]), null]]);
  const q = [from];
  while (q.length) {
    const [x, y] = q.shift();
    if (x === to[0] && y === to[1]) break;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (!isWalkable(K, nx, ny) || prev.has(key(nx, ny))) continue;
      prev.set(key(nx, ny), [x, y]);
      q.push([nx, ny]);
    }
  }
  if (!prev.has(key(to[0], to[1]))) return null;
  const out = [];
  let cur = to;
  while (cur) {
    out.push([cur[0] + 0.5, cur[1] + 0.5]);
    cur = prev.get(key(cur[0], cur[1]));
  }
  return out.reverse();
}

function clearFor(K, ax, ay, bx, by, r) {
  const n = Math.ceil(Math.hypot(bx - ax, by - ay) * 16);
  const offs = [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r], [r * 0.71, r * 0.71], [-r * 0.71, r * 0.71], [r * 0.71, -r * 0.71], [-r * 0.71, -r * 0.71]];
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    const x = ax + (bx - ax) * u;
    const y = ay + (by - ay) * u;
    for (const [ox, oy] of offs) if (!isWalkable(K, Math.floor(x + ox), Math.floor(y + oy))) return false;
  }
  return true;
}

/** String-pull, at `r` clearance. r < chefRadius = a player cutting corners. */
function smooth(K, pts, r) {
  const out = [pts[0]];
  let i = 0;
  while (i < pts.length - 1) {
    let j = pts.length - 1;
    for (; j > i + 1; j--) if (clearFor(K, pts[i][0], pts[i][1], pts[j][0], pts[j][1], r)) break;
    out.push(pts[j]);
    i = j;
  }
  return out;
}

function route(name, fromCell, toCell, carry = null, opts = {}) {
  const K = REAL;
  const cells = bfs(K, fromCell, toCell);
  if (!cells) return { name, error: 'unreachable' };
  const way = smooth(K, cells, opts.clearance ?? TUNING.chefRadius + 0.02);
  const s = rig({ x: way[0][0], y: way[0][1] }, carry, false);
  let wi = 1;
  const ARRIVE = 0.3;
  let done = -1;
  const log = drive(s, 60 * 25, (t, c) => {
    if (wi >= way.length) return IN();
    let tx = way[wi][0] - c.pos.x;
    let ty = way[wi][1] - c.pos.y;
    let d = Math.hypot(tx, ty);
    while (d < ARRIVE && wi < way.length - 1) {
      wi++;
      tx = way[wi][0] - c.pos.x;
      ty = way[wi][1] - c.pos.y;
      d = Math.hypot(tx, ty);
    }
    if (wi === way.length - 1 && d < ARRIVE) {
      if (done < 0) done = t;
      wi = way.length;
      return IN();
    }
    return IN({ x: tx / d, y: ty / d });
  });
  const ticks = done < 0 ? log.length : Math.round(done / DT);
  const used = log.slice(0, ticks);
  const target = TUNING.moveSpeed * (carry === 'plate' || carry === 'pan' ? TUNING.carrySpeedMul : 1);
  let len = 0;
  for (let i = 1; i < used.length; i++) len += Math.hypot(used[i].x - used[i - 1].x, used[i].y - used[i - 1].y);
  return {
    name,
    carry: carry ?? 'empty',
    seconds: r3(ticks * DT),
    pathUnits: r2(len),
    meanSpeed: r2(len / (ticks * DT)),
    blockedPct: Math.round((used.filter((r) => r.blockX || r.blockY).length / Math.max(1, ticks)) * 100),
    catchTicks: used.filter((r, i) => i > 12 && r.inMag > 0.9 && r.gs < target * 0.45).length,
    finished: done >= 0,
  };
}

// -------------------------------------------------------------- 9. lanes

function lanes() {
  const K = REAL;
  const gaps = [];
  const scan = (get, n, m, tag) => {
    for (let a = 0; a < n; a++) {
      let run = 0;
      for (let b = 0; b < m; b++) {
        if (get(a, b)) run++;
        else {
          if (run) gaps.push({ tag, a, w: run });
          run = 0;
        }
      }
      if (run) gaps.push({ tag, a, w: run });
    }
  };
  scan((y, x) => isWalkable(K, x, y), K.height, K.width, 'h');
  scan((x, y) => isWalkable(K, x, y), K.width, K.height, 'v');
  const d = TUNING.chefRadius * 2;
  const hist = {};
  for (const g of gaps) hist[g.w] = (hist[g.w] ?? 0) + 1;
  return {
    chefDiameter: r2(d),
    gapWidthHistogram: hist,
    slackThreadingOneCell: r2((1 - d) / 2),
    slackForTwoAbreastInTwoCells: r2((2 - 2 * d) / 2),
    roomInteriorCells: `${K.width - 2} x ${K.height - 2}`,
    crossWidthAtTopSpeed: r3((K.width - 2) / TUNING.moveSpeed),
    crossDiagonalAtTopSpeed: r3(Math.hypot(K.width - 2, K.height - 3) / TUNING.moveSpeed),
  };
}

// ----------------------------------------------------------------- assemble

const report = {};
if (want('tuning')) report.tuning = { ...TUNING };
if (want('lanes')) report.lanes = lanes();
if (want('accel')) report.straight = [null, 'ingredient', 'plate'].map(straightProfile);
if (want('reverse')) report.reversal = [null, 'plate'].map(reversal);
if (want('turn')) report.turns = [45, 90, 135, 180].map((d) => turn(d, null));
if (want('bump')) report.bump = bumpProfile();
if (want('clip')) report.corners = cornerClip();
if (want('park')) {
  report.parking = [parking(null), parking('plate')];
  const keep = TUNING.coastTurnSpeed;
  TUNING.coastTurnSpeed = Infinity;
  report.parking.push({ ...parking(null), carry: 'empty NO coast-turn' });
  TUNING.coastTurnSpeed = keep;
}
if (want('bumprate')) report.bumpRate = bumpRate();
if (want('stall')) report.stall = stallAudit();
if (want('throughput')) {
  const now = { ...TUNING };
  report.throughput = [throughput('after  (shipped tuning)')];
  Object.assign(TUNING, PRE_PASS_TUNING, { bumpClosingSpeed: TUNING.moveSpeed * 0.45 });
  report.throughput.push(throughput('before (day-one tuning)'));
  Object.assign(TUNING, now);
}
if (want('weave')) report.weave = [weave(null, 1.0), weave(null, 1.6), weave('plate', 1.0)];
if (want('route')) {
  report.routes = [
    route('room diagonal   (1,9)->(13,2)', [1, 9], [13, 2]),
    route('room width      (1,8)->(13,8)', [1, 8], [13, 8]),
    route('plates->pinkserve (10,2)->(2,2)', [10, 2], [2, 2]),
    route('pinkserve->far crate (2,2)->(10,6)', [2, 2], [10, 6]),
    route('greenserve->board (11,2)->(4,6)', [11, 2], [4, 6]),
    route('room diagonal CARRY', [1, 9], [13, 2], 'plate'),
    route('room width CARRY', [1, 8], [13, 8], 'plate'),
    route('room diagonal CUT CORNERS', [1, 9], [13, 2], null, { clearance: 0.22 }),
  ];
}

if (asJson) {
  console.log(JSON.stringify(report, null, 2));
} else {
  const line = (k, v) => console.log(`  ${String(k).padEnd(28)} ${v}`);
  const head = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);
  if (report.tuning) {
    head('TUNING');
    for (const [k, v] of Object.entries(report.tuning)) if (typeof v === 'number') line(k, r3(v));
  }
  if (report.lanes) {
    head('ROOM SCALE vs CHEF');
    for (const [k, v] of Object.entries(report.lanes)) line(k, typeof v === 'object' ? JSON.stringify(v) : v);
  }
  if (report.straight) {
    head('STRAIGHT LINE  (bare arena, full stick)');
    console.log('  carry        top    t50    t90    t99    d@90   stop<1.0      stop<0.15     coast');
    for (const p of report.straight)
      console.log(
        `  ${p.carry.padEnd(11)} ${String(p.topSpeed).padEnd(6)} ${String(p.t50).padEnd(6)} ${String(p.t90).padEnd(6)} ${String(p.t99).padEnd(6)} ${String(p.distTo90).padEnd(6)} ${(p.stop1_0.t + 's/' + p.stop1_0.d + 'u').padEnd(13)} ${(p.stop0_15.t + 's/' + p.stop0_15.d + 'u').padEnd(13)} ${p.coastTotal}u`,
      );
  }
  if (report.reversal) {
    head('REVERSAL  (input flipped 180 at top speed)');
    for (const p of report.reversal) console.log(`  ${p.carry.padEnd(11)} v=0 at ${p.tToZero}s | full reverse at ${p.tToFullReverse}s | slid ${p.slidePastFlip}u past the flip`);
  }
  if (report.turns) {
    head('TURNS  (full speed, input rotated)');
    console.log('  deg   speed kept   vel aligned   head aligned   drift    skid');
    for (const p of report.turns)
      console.log(`  ${String(p.deg).padEnd(5)} ${(p.speedKeptPct + '%').padEnd(11)} ${(p.tVelAligned + 's').padEnd(13)} ${(p.tHeadAligned + 's').padEnd(14)} ${(p.turnRadius + 'u').padEnd(8)} ${p.skidSeconds}s`);
  }
  if (report.bump) {
    head('BUMP  (two chefs, head on, full speed)');
    for (const [k, v] of Object.entries(report.bump)) line(k, v);
  }
  if (report.corners) {
    head(`CORNER CLIP  (flat out past a bench corner, body width ${report.corners.bodyWidth}u)`);
    console.log('  overlap  %body   travelled   frozen   slipped   exit spd   cleared?');
    for (const r of report.corners.passes)
      console.log(
        `  ${String(r.penetrationUnits).padEnd(8)} ${(r.penetrationPctOfBody + '%').padEnd(7)} ${String(r.travelledUnits).padEnd(11)} ${(r.frozenTicks + 't').padEnd(8)} ${(r.lateralSlipUnits + 'u').padEnd(9)} ${(r.exitSpeedPctOfTop + '%').padEnd(10)} ${r.clearedTheBench ? 'yes' : 'NO — WELDED'}`,
      );
  }
  if (report.parking) {
    head('PARKING FORGIVENESS  (release the stick approaching a crate, is it in focus?)');
    for (const p of report.parking)
      console.log(
        `  ${p.carry.padEnd(11)} ${p.approachesTested} approaches, ${p.approachesThatCanNeverPark} unparkable | median window ${p.medianReleaseWindowUnits}u (${p.medianWindowSeconds}s of slack), worst ${p.worstReleaseWindowUnits}u`,
      );
  }
  if (report.bumpRate) {
    head('BUMP RATE  (real BotDirector, 6 seeds x 150s, all four chefs on the brain)');
    for (const [k, v] of Object.entries(report.bumpRate)) line(k, v);
  }
  if (report.stall) {
    head('STALL AUDIT  (real bots, 24 seeds x 170s)');
    for (const [k, v] of Object.entries(report.stall)) line(k, v);
  }
  if (report.throughput) {
    head('THROUGHPUT A/B  (real BotDirector, 10 seeds x 170s, identical seeds both sides)');
    console.log('  variant                    servedMed  total  range   bumps/chef-min  %stunned');
    for (const t of report.throughput)
      console.log(`  ${t.label.padEnd(26)} ${String(t.servedMedian).padEnd(10)} ${String(t.servedTotal).padEnd(6)} ${t.servedRange.padEnd(7)} ${String(t.bumpsPerChefMinute).padEnd(15)} ${t.pctChefTimeStunned}%`);
  }
  if (report.weave) {
    head('WEAVE  (slalom the length of the room at full stick)');
    console.log('  carry       amp    secs    path    mean    %oftop   blocked  slow');
    for (const w of report.weave)
      console.log(`  ${w.carry.padEnd(11)} ${String(w.amplitude).padEnd(6)} ${String(w.seconds).padEnd(7)} ${String(w.pathUnits).padEnd(7)} ${String(w.meanSpeed).padEnd(7)} ${(w.meanSpeedPctOfTop + '%').padEnd(8)} ${String(w.blockedTicks).padEnd(8)} ${w.slowTicks}${w.finished ? '' : '  DID NOT FINISH'}`);
  }
  if (report.routes) {
    head('ROUTES  (real kitchen, string-pulled path, full stick)');
    console.log('  name                                  carry      secs    path    mean    blocked  catches');
    for (const r of report.routes) {
      if (r.error) {
        console.log(`  ${r.name}  ${r.error}`);
        continue;
      }
      console.log(
        `  ${r.name.padEnd(37)} ${r.carry.padEnd(10)} ${String(r.seconds).padEnd(7)} ${String(r.pathUnits).padEnd(7)} ${String(r.meanSpeed).padEnd(7)} ${(r.blockedPct + '%').padEnd(8)} ${r.catchTicks}t${r.finished ? '' : '  DID NOT FINISH'}`,
      );
    }
  }
  console.log('');
}
