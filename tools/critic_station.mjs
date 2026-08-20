/**
 * CRITIC PROBE — station interaction & forgiveness. Written by the critic, not
 * the builder. Measures the things a screenshot and the builder's own probe do
 * not: what happens to a press that arrives EARLY, a press that arrives while
 * stunned, a press that arrives during a focus blink, and what the game tells
 * the player when a press does nothing.
 */
import { build } from 'rolldown';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(os.tmpdir(), `cs-${process.pid}.mjs`);
const ENTRY = path.join(os.tmpdir(), `cs-entry-${process.pid}.ts`);
fs.writeFileSync(
  ENTRY,
  `export * from ${JSON.stringify(path.join(ROOT, 'src/domain/sim.ts'))};
export * from ${JSON.stringify(path.join(ROOT, 'src/domain/content.ts'))};
export * from ${JSON.stringify(path.join(ROOT, 'src/domain/kitchen.ts'))};
export * from ${JSON.stringify(path.join(ROOT, 'src/domain/nav.ts'))};
export * from ${JSON.stringify(path.join(ROOT, 'src/bots/brain.ts'))};
`,
);
await build({ input: ENTRY, output: { file: OUT, format: 'esm' }, logLevel: 'silent' });
const S = await import(OUT);
fs.rmSync(ENTRY, { force: true });
fs.rmSync(OUT, { force: true });
const {
  createSim, step, SIM_DT, TUNING, BotDirector, seedPans,
  findFocus, planGrab, buildKitchen, stationCenter, isWalkable, buildFlow, flowDir,
} = S;

const NO = { move: { x: 0, y: 0 }, grabPressed: false, useHeld: false };
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

function soloSim(seed = 1) {
  const s = createSim({ seed, botCount: 0 });
  seedPans(s);
  return s;
}

// ===================================================================== RIG 1
// EARLY PRESS. Walk one chef at a station with the real flow field. Press grab
// exactly once, at a chosen offset (in ticks) relative to the first tick the
// station is focusable. Negative = the player pressed before the game agreed.
// A game with an input buffer converts early presses into actions.
function earlyPressSweep() {
  const offsets = [];
  for (let t = -12; t <= 8; t++) offsets.push(t);
  const stations = K0.stations.filter((st) => st.kind === 'crate');
  const bearings = 8;
  const tally = new Map(offsets.map((o) => [o, { hit: 0, tot: 0 }]));

  for (const target of stations) {
    const c = stationCenter(target);
    const flow = buildFlow(K0, [{ x: Math.floor(c.x), y: Math.floor(c.y) }]);
    for (let b = 0; b < bearings; b++) {
      const a = (b / bearings) * Math.PI * 2;
      // find a legal start ~4 units out on this bearing
      let start = null;
      for (let d = 4.5; d >= 2.0; d -= 0.25) {
        const x = c.x + Math.cos(a) * d;
        const y = c.y + Math.sin(a) * d;
        if (x > R && y > R && x < K0.width - R && y < K0.height - R && !collides(K0, x, y)) { start = { x, y }; break; }
      }
      if (!start) continue;

      // Pass 1: no press, learn the tick at which the target first becomes focus.
      let firstFocus = -1;
      {
        const s = soloSim(7);
        const ch = s.chefs[0];
        ch.pos.x = start.x; ch.pos.y = start.y; ch.vel.x = 0; ch.vel.y = 0;
        ch.carrying = null;
        for (let t = 0; t < 240; t++) {
          const d = flowDir(flow, K0, ch.pos);
          const arrived = boxDist(target, ch.pos.x, ch.pos.y) < 0.75;
          step(s, [{ ...NO, move: arrived ? { x: 0, y: 0 } : d }]);
          if (ch.focus === target.id) { firstFocus = t; break; }
        }
      }
      if (firstFocus < 0) continue;

      for (const off of offsets) {
        const pressTick = firstFocus + off;
        if (pressTick < 0) continue;
        const s = soloSim(7);
        const ch = s.chefs[0];
        ch.pos.x = start.x; ch.pos.y = start.y; ch.vel.x = 0; ch.vel.y = 0;
        ch.carrying = null;
        let got = false; let gotFrom = -1;
        for (let t = 0; t < firstFocus + 40; t++) {
          const d = flowDir(flow, K0, ch.pos);
          const arrived = boxDist(target, ch.pos.x, ch.pos.y) < 0.75;
          s.events.length = 0;
          step(s, [{ ...NO, move: arrived ? { x: 0, y: 0 } : d, grabPressed: t === pressTick }]);
          /**
           * WHICH BENCH DID THAT COME OFF? READ IT, DO NOT INFER IT.
           *
           * This line used to be
           *     gotFrom = t === pressTick ? (ch.focus ?? willFocus) : -2;
           * which scores ANY pickup that resolves later than its own press tick
           * as "wrong item", by definition. That was sound when a press could
           * only ever resolve on the tick it arrived; against the input buffer
           * this piece added it reported 100% wrong-item for grabs that are in
           * fact 100% on target, and would have read as a catastrophic
           * regression that never happened. The `pickup` event carries `at` =
           * stationCenter of the station `doGrab` actually acted on, which is
           * the sim's own answer and cannot be wrong.
           */
          const ev = s.events.find((e) => e.t === 'pickup');
          if (ev) {
            got = true;
            gotFrom = -2;
            for (const cand of K0.stations) {
              const cc = stationCenter(cand);
              if (Math.abs(cc.x - ev.at.x) < 1e-6 && Math.abs(cc.y - ev.at.y) < 1e-6) { gotFrom = cand.id; break; }
            }
            break;
          }
        }
        const rec = tally.get(off);
        rec.tot++;
        if (got) { if (gotFrom === target.id) rec.hit++; else rec.wrong = (rec.wrong ?? 0) + 1; }
        else rec.dead = (rec.dead ?? 0) + 1;
      }
    }
  }
  console.log('== RIG 1  EARLY PRESS  (crates, 8 bearings each, real flow-field walk-up)');
  console.log('   press offset vs first focusable tick  ->  fraction that produced a pickup');
  for (const o of offsets) {
    const r = tally.get(o);
    if (!r.tot) continue;
    const ms = (o * SIM_DT * 1000).toFixed(0).padStart(5);
    const pct = ((r.hit / r.tot) * 100).toFixed(1).padStart(6);
    const bar = '#'.repeat(Math.round((r.hit / r.tot) * 40));
    const w = (((r.wrong ?? 0) / r.tot) * 100).toFixed(0).padStart(3);
    const d = (((r.dead ?? 0) / r.tot) * 100).toFixed(0).padStart(3);
    console.log(`   t${o >= 0 ? '+' : ''}${String(o).padStart(3)} (${ms} ms)  got target ${pct}%  wrong item ${w}%  NOTHING ${d}%  ${bar}`);
  }
}

// ===================================================================== RIG 2
// STUNNED PRESS. sim.ts:1206 does `if (chef.stun > 0) continue;` BEFORE reading
// grabPressed. Confirm the press is destroyed, and price how often a real
// service puts the player in that state.
function stunPress() {
  const s = soloSim(3);
  const ch = s.chefs[0];
  // park at a crate
  const crate = K0.stations.find((st) => st.kind === 'crate');
  const c = stationCenter(crate);
  const fc = crate.facing;
  ch.pos.x = c.x + fc.x * 1.0; ch.pos.y = c.y + fc.y * 1.0;
  ch.heading = Math.atan2(-fc.y, -fc.x);
  for (let i = 0; i < 6; i++) step(s, [NO]);
  const focused = ch.focus === crate.id;
  ch.stun = TUNING.bumpStun;
  let carriedDuring = null;
  const stunTicks = Math.ceil(TUNING.bumpStun / SIM_DT);
  step(s, [{ ...NO, grabPressed: true }]);   // press lands mid-stun
  carriedDuring = ch.carrying;
  for (let i = 0; i < stunTicks + 20; i++) step(s, [NO]); // no further press
  console.log('\n== RIG 2  PRESS WHILE STUNNED');
  console.log(`   focused before stun: ${focused}   stun length ${(TUNING.bumpStun * 1000).toFixed(0)}ms = ${stunTicks} ticks`);
  console.log(`   pressed grab on tick 1 of the stun -> carrying immediately after: ${carriedDuring ? 'YES' : 'NO'}`);
  console.log(`   ...and ${stunTicks + 20} ticks later, with no second press: ${ch.carrying ? 'YES (buffered)' : 'NO  (press destroyed)'}`);
}

// ===================================================================== RIG 3
// SILENT FAILURE. How many events does the sim emit when a press does nothing?
function silentFailure() {
  const s = soloSim(5);
  const ch = s.chefs[0];
  const crate = K0.stations.find((st) => st.kind === 'crate');
  const c = stationCenter(crate);
  ch.pos.x = c.x + crate.facing.x * 1.0; ch.pos.y = c.y + crate.facing.y * 1.0;
  ch.heading = Math.atan2(-crate.facing.y, -crate.facing.x);
  for (let i = 0; i < 6; i++) step(s, [NO]);
  s.events.length = 0;
  step(s, [{ ...NO, grabPressed: true }]);
  const goodEvents = s.events.map((e) => e.t);
  // now hold a pan at that crate: planGrab -> 'none'
  s.events.length = 0;
  ch.carrying = { type: 'pan', pan: { id: 999, contents: [], onHeat: false, fire: 0 } };
  for (let i = 0; i < 4; i++) step(s, [NO]);
  s.events.length = 0;
  step(s, [{ ...NO, grabPressed: true }]);
  const deadEvents = s.events.map((e) => e.t);
  // and in open floor with no station at all
  s.events.length = 0;
  ch.pos.x = K0.width / 2 + 0.5; ch.pos.y = K0.height / 2 + 0.5;
  ch.carrying = null;
  let openFocus = null;
  for (let i = 0; i < 8; i++) { step(s, [NO]); openFocus = ch.focus; }
  s.events.length = 0;
  step(s, [{ ...NO, grabPressed: true }]);
  const openEvents = s.events.map((e) => e.t);
  console.log('\n== RIG 3  WHAT A FAILED PRESS SOUNDS LIKE');
  console.log(`   press that WORKS  (empty hands at a crate):  events ${JSON.stringify(goodEvents)}`);
  console.log(`   press that is REFUSED (pan at a crate, plan='none'): events ${JSON.stringify(deadEvents)}`);
  console.log(`   press with NOTHING focused (mid-floor, focus=${openFocus}): events ${JSON.stringify(openEvents)}`);
}

// ===================================================================== RIG 4
// FOCUS CONTINUITY under real play. How much of the time, while standing
// stationary within reach of a station, is focus NULL? A blink is a dead press.
function blink() {
  const seeds = [11, 12, 13, 14, 15, 16];
  let ticks = 0, nullTicks = 0, changes = 0, blinkOff = 0, offRuns = [];
  let stunTicks = 0, inReachTicks = 0, inReachNull = 0;
  for (const seed of seeds) {
    const s = createSim({ seed, botCount: 3 });
    seedPans(s);
    const bots = new BotDirector(s);
    bots.drivePlayer = true; // drive chef 0 with the same brain: a competent human stand-in
    const player = s.chefs[0];
    // player is driven by the bot brain too — a "deliberate mover", the fairest
    // stand-in for a competent human, and identical across A/B.
    let prev = null, runLen = 0;
    for (let t = 0; t < Math.floor(170 / SIM_DT); t++) {
      const bi = bots.update(s, SIM_DT);
      step(s, s.chefs.map((c) => bi.get(c.id) ?? NO));
      ticks++;
      if (player.stun > 0) stunTicks++;
      const near = s.kitchen.stations.some((st) => boxDist(st, player.pos.x, player.pos.y) <= TUNING.reach);
      if (near) { inReachTicks++; if (player.focus === null) inReachNull++; }
      if (player.focus === null) { nullTicks++; runLen++; }
      else if (runLen > 0) { offRuns.push(runLen); runLen = 0; }
      if (player.focus !== prev) { changes++; if (player.focus === null || prev === null) blinkOff++; prev = player.focus; }
      if (s.over) break;
    }
  }
  offRuns.sort((a, b) => a - b);
  const secs = ticks * SIM_DT;
  console.log('\n== RIG 4  FOCUS CONTINUITY  (6 x 170s services, 4 chefs, real bot brain driving the player)');
  console.log(`   focus is NULL ${((nullTicks / ticks) * 100).toFixed(1)}% of all ticks`);
  console.log(`   STANDING WITHIN REACH of a bench and focused on nothing: ${((inReachNull / inReachTicks) * 100).toFixed(1)}% of ${inReachTicks} in-reach ticks`);
  console.log(`   focus changes ${(changes / secs).toFixed(2)}/s   of which on/off blinks ${(blinkOff / secs).toFixed(2)}/s`);
  console.log(`   focus-off gaps: n=${offRuns.length}  median ${(offRuns[Math.floor(offRuns.length / 2)] * SIM_DT * 1000).toFixed(0)}ms  p90 ${(offRuns[Math.floor(offRuns.length * 0.9)] * SIM_DT * 1000).toFixed(0)}ms`);
  console.log(`   player stunned ${((stunTicks / ticks) * 100).toFixed(1)}% of ticks -> presses in that window are destroyed`);
}

// ===================================================================== RIG 5
// HUMAN PRESS MODEL. A human does not press on the frame the sim says yes. Model
// the press as: the player decides to press when the station is visually within
// a body-length, plus a normally distributed reaction jitter. Count how many of
// those presses land.
function humanPress() {
  const jitters = [0, 50, 100, 150, 200];
  console.log('\n== RIG 5  HUMAN TIMING  (press fires "arrival + N ms early", 8 bearings x every crate)');
  const stations = K0.stations.filter((st) => st.kind === 'crate' || st.kind === 'plates');
  for (const early of jitters) {
    const et = Math.round(early / 1000 / SIM_DT);
    let hit = 0, tot = 0;
    for (const target of stations) {
      const c = stationCenter(target);
      const flow = buildFlow(K0, [{ x: Math.floor(c.x), y: Math.floor(c.y) }]);
      for (let b = 0; b < 8; b++) {
        const a = (b / 8) * Math.PI * 2;
        let start = null;
        for (let d = 4.5; d >= 2.0; d -= 0.25) {
          const x = c.x + Math.cos(a) * d, y = c.y + Math.sin(a) * d;
          if (x > R && y > R && x < K0.width - R && y < K0.height - R && !collides(K0, x, y)) { start = { x, y }; break; }
        }
        if (!start) continue;
        // learn firstFocus
        let ff = -1;
        {
          const s = soloSim(9); const ch = s.chefs[0];
          ch.pos.x = start.x; ch.pos.y = start.y; ch.carrying = null;
          for (let t = 0; t < 240; t++) {
            const d = flowDir(flow, K0, ch.pos);
            step(s, [{ ...NO, move: boxDist(target, ch.pos.x, ch.pos.y) < 0.75 ? { x: 0, y: 0 } : d }]);
            if (ch.focus === target.id) { ff = t; break; }
          }
        }
        if (ff < 0) continue;
        const pressTick = Math.max(0, ff - et);
        const s = soloSim(9); const ch = s.chefs[0];
        ch.pos.x = start.x; ch.pos.y = start.y; ch.carrying = null;
        let got = false;
        for (let t = 0; t < ff + 40; t++) {
          const d = flowDir(flow, K0, ch.pos);
          step(s, [{ ...NO, move: boxDist(target, ch.pos.x, ch.pos.y) < 0.75 ? { x: 0, y: 0 } : d, grabPressed: t === pressTick }]);
          if (ch.carrying) { got = true; break; }
        }
        tot++; if (got) hit++;
      }
    }
    console.log(`   ${String(early).padStart(4)} ms early:  ${((hit / tot) * 100).toFixed(1)}% of ${tot} presses landed`);
  }
}

// ===================================================================== RIG 6
// GEOMETRY IN BODIES. Absolute forgiveness envelope, in units a player feels.
function envelope() {
  console.log('\n== RIG 6  THE ENVELOPE IN BODY WIDTHS');
  const bodyW = R * 2;
  console.log(`   chef radius ${R}  (body ${bodyW.toFixed(2)}u)   cell 1.00u   reach ${TUNING.reach}u past the bench edge`);
  console.log(`   -> the gap between body surface and bench edge at max reach: ${(TUNING.reach - R).toFixed(2)}u = ${((TUNING.reach - R) / bodyW).toFixed(2)} body widths`);
  console.log(`   cone half-angle ${((TUNING.reachCone * 180) / Math.PI).toFixed(0)} deg (${((TUNING.reachCone * 360) / Math.PI).toFixed(0)} deg window)`);
  console.log(`   coast after release: moveSpeed ${TUNING.moveSpeed} * decelTime ${TUNING.decelTime} = ${(TUNING.moveSpeed * TUNING.decelTime).toFixed(2)}u = ${((TUNING.moveSpeed * TUNING.decelTime) / bodyW).toFixed(2)} body widths`);
  // how deep is the usable band, radially, along a face?
  const st = K0.stations.find((x) => x.kind === 'crate');
  const c = stationCenter(st);
  const f = st.facing;
  let inMin = 99, inMax = 0;
  for (let d = 0.4; d < 2.4; d += 0.01) {
    const x = c.x + f.x * d, y = c.y + f.y * d;
    if (collides(K0, x, y)) continue;
    const got = findFocus({ kitchen: K0, orders: [] }, { pos: { x, y }, heading: Math.atan2(-f.y, -f.x), carrying: null, focus: null });
    if (got && got.id === st.id) { inMin = Math.min(inMin, d); inMax = Math.max(inMax, d); }
  }
  console.log(`   standing square on ${st.kind}@${st.cell.x},${st.cell.y}: it is yours from ${inMin.toFixed(2)}u to ${inMax.toFixed(2)}u from centre — a ${(inMax - inMin).toFixed(2)}u deep band (${((inMax - inMin) / bodyW).toFixed(2)} body widths)`);
}

// ===================================================================== RIG 7
// MOVING PRESS. Grab while still walking past a bench — the thing a good player
// does constantly. Does the game let you take on the move?
function driveBy() {
  console.log('\n== RIG 7  GRAB ON THE MOVE (run past a bench at cruise, press at closest approach)');
  const rows = [];
  for (const off of [0.7, 0.9, 1.1, 1.3, 1.5]) {
    let hit = 0, tot = 0, speeds = [];
    for (const st of K0.stations.filter((x) => x.kind === 'crate' || x.kind === 'plates')) {
      const c = stationCenter(st);
      const f = st.facing;
      const perp = { x: -f.y, y: f.x };
      for (let dir = -1; dir <= 1; dir += 2) {
        const stand = { x: c.x + f.x * off, y: c.y + f.y * off };
        if (collides(K0, stand.x, stand.y)) continue;
        let start = null;
        for (let d = 3.0; d >= 1.2; d -= 0.2) {
          const x = stand.x - perp.x * dir * d, y = stand.y - perp.y * dir * d;
          if (x > R && y > R && x < K0.width - R && y < K0.height - R && !collides(K0, x, y)) { start = { x, y, d }; break; }
        }
        if (!start || start.d < 1.8) continue;
        const s = soloSim(4); const ch = s.chefs[0];
        ch.pos.x = start.x; ch.pos.y = start.y; ch.carrying = null;
        ch.heading = Math.atan2(perp.y * dir, perp.x * dir);
        let got = false, peak = 0;
        for (let t = 0; t < 200; t++) {
          const dx = stand.x - ch.pos.x, dy = stand.y - ch.pos.y;
          const along = dx * perp.x * dir + dy * perp.y * dir;
          peak = Math.max(peak, Math.hypot(ch.vel.x, ch.vel.y));
          step(s, [{ ...NO, move: { x: perp.x * dir, y: perp.y * dir }, grabPressed: Math.abs(along) < 0.12 }]);
          if (ch.carrying) { got = true; break; }
          if (along < -1.8) break;
        }
        tot++; if (got) hit++; speeds.push(peak);
      }
    }
    if (tot) rows.push(`   stand-off ${off.toFixed(1)}u from bench centre: ${hit}/${tot} (${((hit/tot)*100).toFixed(0)}%) drive-by grabs landed, peak speed ${(speeds.reduce((a,b)=>a+b,0)/speeds.length).toFixed(1)} u/s`);
  }
  rows.forEach((r) => console.log(r));
}

const which = process.argv[2] ?? 'all';
if (which === 'all' || which === '1') earlyPressSweep();
if (which === 'all' || which === '2') stunPress();
if (which === 'all' || which === '3') silentFailure();
if (which === 'all' || which === '6') envelope();
if (which === 'all' || which === '7') driveBy();
if (which === 'all' || which === '5') humanPress();
if (which === 'all' || which === '4') blink();
