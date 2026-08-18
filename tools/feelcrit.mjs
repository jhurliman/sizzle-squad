/**
 * FEEL CRIT — independent movement-feel measurements written by the critic.
 * Focus: what the PLAYER's body actually experiences, not aggregate chef-seconds.
 */
import { build } from 'rolldown';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(os.tmpdir(), `feelcrit-${process.pid}.mjs`);
const ENTRY = path.join(os.tmpdir(), `feelcrit-entry-${process.pid}.ts`);
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
const IN = (move = { x: 0, y: 0 }, o = {}) => ({
  move, grabPressed: !!o.grab, useHeld: !!o.use, dashPressed: !!o.dash,
});
const r2 = (n) => Math.round(n * 100) / 100;
const r3 = (n) => Math.round(n * 1000) / 1000;
const pct = (a, b) => r2((100 * a) / Math.max(1e-9, b));
const quant = (arr, q) => {
  if (!arr.length) return 0;
  const a = [...arr].sort((x, y) => x - y);
  return a[Math.min(a.length - 1, Math.floor(q * a.length))];
};

// ---------------------------------------------------------- 1. FIRST FRAMES
// "Every input produces a visible response within one frame."
{
  const N = 61;
  const rows = [];
  for (let y = 0; y < N; y++) rows.push(y === 0 || y === N - 1 ? '#'.repeat(N) : '#' + '.'.repeat(N - 2) + '#');
  const s = createSim({ seed: 1, botCount: 0 });
  s.kitchen = buildKitchen(rows);
  const c = s.chefs[0];
  c.pos = { x: 30, y: 30 }; c.vel = { x: 0, y: 0 }; c.heading = 0;
  const px0 = c.pos.x;
  const out = [];
  for (let i = 0; i < 8; i++) {
    step(s, [IN({ x: 1, y: 0 })]); s.events.length = 0;
    out.push({ f: i + 1, spd: r3(Math.hypot(c.vel.x, c.vel.y)), moved: r3(c.pos.x - px0) });
  }
  console.log('\nFIRST FRAMES FROM STANDSTILL (full stick, empty)');
  console.log('  frame  speed   cumDisplacement  %ofBodyWidth(0.72u)');
  for (const o of out) console.log(`  ${String(o.f).padEnd(6)} ${String(o.spd).padEnd(7)} ${String(o.moved).padEnd(16)} ${pct(o.moved, 0.72)}`);
}

// ------------------------------------------------ 2. WALL HITS ARE SILENT
{
  const s = createSim({ seed: 3, botCount: 0 });
  const c = s.chefs[0];
  // run flat out into a wall
  let evs = 0, hits = 0, prevSpd = 0, maxDrop = 0;
  for (let i = 0; i < 240; i++) {
    step(s, [IN({ x: 0, y: -1 })]);
    evs += s.events.filter((e) => e.t !== 'footstep').length;
    s.events.length = 0;
    const spd = Math.hypot(c.vel.x, c.vel.y);
    if (prevSpd > 3 && spd < 0.5) { hits++; maxDrop = Math.max(maxDrop, prevSpd - spd); }
    prevSpd = spd;
  }
  console.log('\nRUNNING INTO A BENCH AT FULL SPEED (4s of held stick into geometry)');
  console.log(`  hardStopsDetected        ${hits}`);
  console.log(`  speedLostInOneTick       ${r2(maxDrop)} u/s`);
  console.log(`  simEventsEmitted         ${evs}   <- audio/vfx have nothing to react to`);
  console.log(`  stunFrames               ${c.stun > 0 ? 'yes' : 0}`);
}

// ------------------------------------------ 3. CARRY DIFFERENTIATION (JND)
{
  const N = 61;
  const rows = [];
  for (let y = 0; y < N; y++) rows.push(y === 0 || y === N - 1 ? '#'.repeat(N) : '#' + '.'.repeat(N - 2) + '#');
  const meas = (load) => {
    const s = createSim({ seed: 1, botCount: 0 });
    s.kitchen = buildKitchen(rows);
    const c = s.chefs[0];
    c.pos = { x: 30, y: 30 }; c.vel = { x: 0, y: 0 };
    if (load === 'ingredient') c.carrying = { type: 'ingredient', item: { id: 999, kind: 'tomato', state: 'raw', progress: 0, overcook: 0 } };
    if (load === 'plate') c.carrying = { type: 'plate', plate: { id: 998, contents: [], onHeat: false, fire: 0, dirty: false, stack: 1 } };
    if (load === 'tower') c.carrying = { type: 'plate', plate: { id: 997, contents: [], onHeat: false, fire: 0, dirty: false, stack: 4 } };
    let top = 0;
    for (let i = 0; i < 180; i++) { step(s, [IN({ x: 1, y: 0 })]); s.events.length = 0; top = Math.max(top, Math.hypot(c.vel.x, c.vel.y)); }
    // now a 10-unit sprint time
    const s2 = createSim({ seed: 1, botCount: 0 });
    s2.kitchen = buildKitchen(rows);
    const c2 = s2.chefs[0];
    c2.pos = { x: 20, y: 30 }; c2.vel = { x: 0, y: 0 }; c2.carrying = c.carrying;
    let t = 0;
    while (c2.pos.x < 30 && t < 600) { step(s2, [IN({ x: 1, y: 0 })]); s2.events.length = 0; t++; }
    return { top: r3(top), tenUnits: r3(t / 60) };
  };
  const base = meas('none');
  console.log('\nCARRY DIFFERENTIATION  ("carrying changes how you move enough that you feel it")');
  console.log('  load        topSpeed  10u sprint  deltaVsEmpty   aboveJND(~10%)?');
  for (const l of ['none', 'ingredient', 'plate', 'tower']) {
    const m = meas(l);
    const d = pct(base.tenUnits - m.tenUnits, base.tenUnits);
    console.log(`  ${l.padEnd(11)} ${String(m.top).padEnd(9)} ${String(m.tenUnits).padEnd(11)} ${String(r2(-d) + '%').padEnd(14)} ${Math.abs(d) >= 10 ? 'yes' : 'NO'}`);
  }
}

// --------------------------------------- 4. PLAYER-SIDE BUMP EXPERIENCE
{
  const seeds = [11, 23, 37, 51, 67, 83, 97, 109];
  const SEC = 150;
  let gaps = [], stunT = 0, moveT = 0, tot = 0, playerBumps = 0, allBumps = 0;
  const spdHist = { cruise: 0, mid: 0, crawl: 0, still: 0 };
  // Second histogram against the chef's OWN cruise. The absolute one below is
  // scored against a flat 6.2, which a chef carrying anything can no longer
  // reach by construction, so it conflates "blocked by the room" with "holding
  // a tomato". Both are reported; the own-cruise one is the movement question.
  const ownHist = { cruise: 0, mid: 0, crawl: 0, still: 0 };
  for (const seed of seeds) {
    const s = createSim({ seed, botCount: 3 });
    S.seedPans(s);
    const dir = new S.BotDirector();
    for (const c of s.chefs) c.isPlayer = false;
    const me = s.chefs[0];
    let last = 0;
    for (let i = 0; i < SEC * 60; i++) {
      const map = dir.update(s, DT);
      step(s, s.chefs.map((c) => map.get(c.id) ?? IN()));
      for (const e of s.events) if (e.t === 'bump') {
        allBumps++;
        if (e.a === me.id || e.b === me.id) { playerBumps++; gaps.push((i - last) / 60); last = i; }
      }
      s.events.length = 0;
      const sp = Math.hypot(me.vel.x, me.vel.y);
      const load = me.carrying === null ? 1
        : me.carrying.type === 'plate' || me.carrying.type === 'pan' ? TUNING.carrySpeedMul
        : (TUNING.produceSpeedMul ?? 1);
      const own = TUNING.moveSpeed * load;
      if (sp < 0.4) ownHist.still++;
      else if (sp < 0.5 * own) ownHist.crawl++;
      else if (sp < 0.9 * own) ownHist.mid++;
      else ownHist.cruise++;
      if (me.stun > 0) stunT += DT;
      if (sp > 0.4) moveT += DT;
      if (sp < 0.4) spdHist.still++;
      else if (sp < 0.5 * TUNING.moveSpeed) spdHist.crawl++;
      else if (sp < 0.9 * TUNING.moveSpeed) spdHist.mid++;
      else spdHist.cruise++;
      tot += DT;
      if (s.over) break;
    }
  }
  const frames = spdHist.still + spdHist.crawl + spdHist.mid + spdHist.cruise;
  console.log('\nPLAYER-SIDE BUMP EXPERIENCE  (8 seeds x 150s, chef 0 only, real BotDirector)');
  console.log(`  bumpsInvolvingPlayer     ${playerBumps}   (of ${allBumps} total in room)`);
  console.log(`  playerBumpsPerMinute     ${r2((playerBumps / tot) * 60)}`);
  console.log(`  secondsBetween p50/p90   ${r2(quant(gaps, 0.5))} / ${r2(quant(gaps, 0.9))}`);
  console.log(`  shortestGap (p05)        ${r2(quant(gaps, 0.05))} s`);
  console.log(`  %playerTimeStunned       ${pct(stunT, tot)}`);
  console.log('\nPLAYER SPEED HISTOGRAM DURING REAL PLAY (cruise = 6.2 u/s)');
  console.log(`  >90% cruise              ${pct(spdHist.cruise, frames)}%`);
  console.log(`  50-90% cruise            ${pct(spdHist.mid, frames)}%`);
  console.log(`  <50% cruise (moving)     ${pct(spdHist.crawl, frames)}%`);
  console.log(`  effectively stopped      ${pct(spdHist.still, frames)}%`);
  console.log(`  %timeMoving              ${pct(moveT, tot)}%`);
  const of2 = ownHist.still + ownHist.crawl + ownHist.mid + ownHist.cruise;
  console.log('\nPLAYER SPEED HISTOGRAM AGAINST THE CHEF\'S OWN CRUISE (empty 6.2 / produce 5.58 / plate 5.08)');
  console.log(`  >90% own cruise          ${pct(ownHist.cruise, of2)}%`);
  console.log(`  50-90% own cruise        ${pct(ownHist.mid, of2)}%`);
  console.log(`  <50% own cruise (moving) ${pct(ownHist.crawl, of2)}%`);
  console.log(`  effectively stopped      ${pct(ownHist.still, of2)}%`);
}

// ---------------------------------------------- 5. DASH IN THE REAL ROOM
{
  const s0 = createSim({ seed: 5, botCount: 0 });
  const k = s0.kitchen;
  const spots = [];
  for (let y = 0; y < k.height; y++) for (let x = 0; x < k.width; x++) if (isWalkable(k, x, y)) spots.push({ x: x + 0.5, y: y + 0.5 });
  let n = 0, wallEnded = 0, gained = [];
  for (const sp of spots) {
    for (let a = 0; a < 8; a++) {
      const ang = (a / 8) * Math.PI * 2;
      const dir = { x: Math.cos(ang), y: Math.sin(ang) };
      const run = (dash) => {
        const s = createSim({ seed: 5, botCount: 0 });
        const c = s.chefs[0];
        c.pos = { ...sp }; c.vel = { x: dir.x * TUNING.moveSpeed, y: dir.y * TUNING.moveSpeed }; c.heading = ang;
        const p0 = { ...c.pos };
        for (let i = 0; i < 30; i++) { step(s, [IN(dir, { dash: dash && i === 0 })]); s.events.length = 0; }
        return Math.hypot(c.pos.x - p0.x, c.pos.y - p0.y);
      };
      const w = run(false), d = run(true);
      n++; gained.push(d - w);
      if (d - w < 0.4) wallEnded++;
    }
  }
  console.log('\nDASH IN THE REAL ROOM (every walkable cell x 8 directions, 0.5s window)');
  console.log(`  samples                  ${n}`);
  console.log(`  medianUnitsGained        ${r3(quant(gained, 0.5))}   (arena figure: 1.32)`);
  console.log(`  p10 / p90 gained         ${r3(quant(gained, 0.1))} / ${r3(quant(gained, 0.9))}`);
  console.log(`  %dashesWorthUnder0.4u    ${pct(wallEnded, n)}%   <- burnt a 1.0s cooldown into geometry`);
}

// ------------------------------------------------- 6. STOP PRECISION
{
  const N = 61;
  const rows = [];
  for (let y = 0; y < N; y++) rows.push(y === 0 || y === N - 1 ? '#'.repeat(N) : '#' + '.'.repeat(N - 2) + '#');
  console.log('\nSTOP PRECISION (release stick at speed; where does the body come to rest?)');
  for (const load of ['none', 'plate']) {
    const s = createSim({ seed: 1, botCount: 0 });
    s.kitchen = buildKitchen(rows);
    const c = s.chefs[0];
    c.pos = { x: 20, y: 30 }; c.vel = { x: 0, y: 0 };
    if (load === 'plate') c.carrying = { type: 'plate', plate: { id: 1, contents: [], onHeat: false, fire: 0, dirty: false, stack: 1 } };
    for (let i = 0; i < 120; i++) { step(s, [IN({ x: 1, y: 0 })]); s.events.length = 0; }
    const rel = c.pos.x;
    let tStop = 0;
    for (let i = 0; i < 300; i++) {
      step(s, [IN()]); s.events.length = 0;
      if (Math.hypot(c.vel.x, c.vel.y) < 0.05) { tStop = i / 60; break; }
    }
    console.log(`  ${load.padEnd(7)} coast ${r3(c.pos.x - rel)}u = ${pct(c.pos.x - rel, 0.72)}% of a body width, settles in ${r2(tStop)}s`);
  }
  console.log(`  reach (grab radius)      ${TUNING.reach}u — coast/reach = ${r2(0.755 / TUNING.reach)}`);
}
