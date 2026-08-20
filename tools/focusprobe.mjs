/**
 * FOCUS PROBE — sweeps the whole floor, every position and every heading, and
 * asks the REAL `findFocus` which station it hands back.
 *
 * The interaction layer is the one system in this game that a screenshot can
 * never judge. A focus glow under the wrong bench looks exactly like a focus
 * glow under the right one; a press that does nothing looks exactly like a
 * player who did not press. Every question the brief asks — is the cone
 * generous or sloppy, is any station unreachable, does focus flicker between
 * two benches when you stand on the seam, how often does the sim pick a
 * different station from the one you walked up to — is a number, and this
 * prints it.
 *
 *   node tools/focusprobe.mjs                  # everything
 *   node tools/focusprobe.mjs --only static    # static | acquire | service | cone
 *   node tools/focusprobe.mjs --json
 *
 * THREE RIGS.
 *
 * STATIC sweeps a 0.125u grid of every position a body actually fits in, times
 * 72 headings, through the shipped `findFocus`. It can answer questions about
 * geometry that no amount of play ever visits.
 *
 * ACQUIRE drives one chef (botCount 0, so `resolveChefCollisions` never writes
 * a position and nothing but movement can move him) at each station from eight
 * directions with the same seek a bot uses, releases the stick at arrival, and
 * asks whether the station he walked to is the station he gets. This is the
 * only rig that includes heading dynamics, coast and corner slip.
 *
 * SERVICE runs a full 170s service with the real BotDirector plus a scripted
 * player who presses grab the way a human does — on arrival, not on
 * confirmation — and counts what those presses actually did.
 */
import { build } from 'rolldown';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
// --src /tmp/ab/src runs every rig against a DIFFERENT copy of the domain, which
// is how a change to the interaction rules gets priced against the code it
// replaced rather than against a memory of it.
const SRC = process.argv.includes('--src') ? process.argv[process.argv.indexOf('--src') + 1] : path.join(ROOT, 'src');
const OUT = path.join(os.tmpdir(), `focusprobe-${process.pid}.mjs`);
const ENTRY = path.join(os.tmpdir(), `focusprobe-entry-${process.pid}.ts`);
fs.writeFileSync(
  ENTRY,
  `export * from ${JSON.stringify(path.join(SRC, 'domain/sim.ts'))};
export * from ${JSON.stringify(path.join(SRC, 'domain/content.ts'))};
export * from ${JSON.stringify(path.join(SRC, 'domain/kitchen.ts'))};
export * from ${JSON.stringify(path.join(SRC, 'bots/brain.ts'))};
export * from ${JSON.stringify(path.join(SRC, 'domain/nav.ts'))};
`,
);
await build({ input: ENTRY, output: { file: OUT, format: 'esm' }, logLevel: 'silent' });
const S = await import(OUT);
fs.rmSync(ENTRY, { force: true });
fs.rmSync(OUT, { force: true });
const {
  createSim,
  step,
  SIM_DT,
  TUNING,
  BotDirector,
  seedPans,
  findFocus,
  buildKitchen,
  stationCenter,
  isWalkable,
  cellAt,
  buildFlow,
  flowDir,
  planGrab,
} = S;

const argv = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1] ?? true]);
    return acc;
  }, []),
);
const ONLY = String(argv.only ?? 'static,cone,acquire,forgive,service,bots').split(',');
const JSONOUT = !!argv.json;
const out = {};
const say = (...a) => {
  if (!JSONOUT) console.log(...a);
};

// --tune reachCone=1.727,focusStick=0  — TUNING is read at call time, so this
// is an exact A/B of a constant and nothing else.
if (argv.tune) {
  for (const kv of String(argv.tune).split(',')) {
    const [k, v] = kv.split('=');
    TUNING[k] = Number(v);
  }
  console.log('  [tune] ' + String(argv.tune));
}

const K = buildKitchen();
const R = TUNING.chefRadius;
const NO = { move: { x: 0, y: 0 }, grabPressed: false, useHeld: false };

/** Same circle-vs-cell test the sim integrates against. */
function collides(x, y) {
  for (let cy = Math.floor(y - R); cy <= Math.floor(y + R); cy++) {
    for (let cx = Math.floor(x - R); cx <= Math.floor(x + R); cx++) {
      if (isWalkable(K, cx, cy)) continue;
      const px = Math.max(cx, Math.min(x, cx + 1));
      const py = Math.max(cy, Math.min(y, cy + 1));
      if ((x - px) ** 2 + (y - py) ** 2 < R * R) return true;
    }
  }
  return false;
}

/** Distance from a point to the station's 1x1 cell box. */
function boxDist(st, x, y) {
  const dx = Math.max(st.cell.x - x, 0, x - (st.cell.x + 1));
  const dy = Math.max(st.cell.y - y, 0, y - (st.cell.y + 1));
  return Math.hypot(dx, dy);
}

/** Is there a bench BETWEEN the chef and the station? Traced to the nearest point on its box. */
function throughStation(px, py, st) {
  const c = {
    x: Math.max(st.cell.x, Math.min(px, st.cell.x + 1)),
    y: Math.max(st.cell.y, Math.min(py, st.cell.y + 1)),
  };
  const n = 24;
  for (let i = 1; i < n; i++) {
    const x = px + (c.x - px) * (i / n);
    const y = py + (c.y - py) * (i / n);
    const cx = Math.floor(x);
    const cy = Math.floor(y);
    if (cx === st.cell.x && cy === st.cell.y) continue;
    if (cellAt(K, cx, cy) !== 'floor') return true;
  }
  return false;
}

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const fake = (x, y, h) => ({ pos: { x, y }, heading: h, carrying: null, focus: null });
/** One-shot pick with no memory: pure geometry. */
const pick = (x, y, h) => findFocus({ kitchen: K, orders: [] }, fake(x, y, h));
/** Pick THROUGH a chef that remembers, which is how the sim actually runs it. */
const pickSticky = (chef, x, y, h) => {
  chef.pos.x = x;
  chef.pos.y = y;
  chef.heading = h;
  const got = findFocus({ kitchen: K, orders: [] }, chef);
  chef.focus = got?.id ?? null;
  return got;
};
const stName = (st) => (st ? `${st.kind}${st.dispenses ? ':' + st.dispenses : ''}@${st.cell.x},${st.cell.y}` : 'null');
const wrap = (a) => {
  let d = a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
};

// ------------------------------------------------------------------ static

const GRID = 0.125;
const spots = [];
for (let y = GRID / 2; y < K.height; y += GRID) {
  for (let x = GRID / 2; x < K.width; x += GRID) {
    if (!collides(x, y)) spots.push([x, y]);
  }
}

function staticSweep() {
  const HEADS = 72;
  // GEOMETRY IS MEASURED WITH THE INERT PENALTY OFF. An empty-handed chef in
  // front of an empty board genuinely has nothing to press, and the shipped
  // rule hands the glow to the crate beside it instead; that is a design
  // choice, counted separately below. Mixing it into the geometry number
  // measures two things at once and tells you neither.
  const keepInert = TUNING.focusInertPenalty;
  TUNING.focusInertPenalty = 0;
  // ---- 1. per-station approach band: where can you stand and be handed it?
  const rows = [];
  let worstAcq = 1;
  let acqHit = 0;
  let acqTot = 0;
  let acqNull = 0;
  let acqThrough = 0;
  for (const st of K.stations) {
    const c = stationCenter(st);
    let band = 0; // body fits, in range, clear line
    let win = 0; // ...and facing it squarely hands you it
    let nul = 0;
    for (const [x, y] of spots) {
      // "I am at this bench and facing it" — 0.9 past its edge, nothing in the
      // way. Judged on the player's belief, not on the implementation's gate.
      if (boxDist(st, x, y) > 0.9) continue;
      if (throughStation(x, y, st)) continue;
      band++;
      const got = pick(x, y, Math.atan2(c.y - y, c.x - x));
      if (got === st) win++;
      else if (!got) nul++;
    }
    acqTot += band;
    acqHit += win;
    acqNull += nul;
    const rate = band ? win / band : 0;
    if (band > 0) worstAcq = Math.min(worstAcq, rate);
    rows.push({ st: stName(st), band, win, nul, rate });
  }
  // through-station picks over the whole sweep
  let picks = 0;
  let through = 0;
  let live = 0;
  for (const [x, y] of spots) {
    let any = false;
    for (let i = 0; i < HEADS; i++) {
      const got = pick(x, y, (i / HEADS) * Math.PI * 2 - Math.PI);
      if (!got) continue;
      any = true;
      picks++;
      if (throughStation(x, y, got)) through++;
    }
    if (any) live++;
  }
  acqThrough = through / Math.max(1, picks);

  // ---- 2. flicker: rotate on the spot, count winner changes and switchbacks
  let chg = 0;
  let back = 0;
  let spotsWithSwitchback = 0;
  const JIT = (5 * Math.PI) / 180;
  let jitTot = 0;
  let jitFlip = 0;
  for (const [x, y] of spots) {
    let prev = null;
    let prev2 = null;
    let runLen = 0;
    let sb = 0;
    const mem = fake(x, y, 0);
    // Turn on the spot the way a body does — one continuous rotation with the
    // focus carried from step to step, so hysteresis is in the measurement.
    for (let i = 0; i <= 360; i++) {
      const h = (i / 360) * Math.PI * 2 - Math.PI;
      const got = pickSticky(mem, x, y, h);
      if (got !== prev) {
        if (prev !== null || got !== null) chg++;
        if (got && got === prev2 && runLen <= 12) {
          back++;
          sb++;
        }
        prev2 = prev;
        prev = got;
        runLen = 0;
      } else runLen++;
      // heading jitter at 5 degrees: does the answer survive a wobble?
      if (i % 4 === 0 && got) {
        jitTot++;
        const keep = mem.focus;
        const a = pickSticky(mem, x, y, h + JIT);
        mem.focus = keep;
        const b = pickSticky(mem, x, y, h - JIT);
        mem.focus = keep;
        if (a !== got || b !== got) jitFlip++;
      }
    }
    if (sb) spotsWithSwitchback++;
  }

  // ---- 2b. the eight cells that touch a bench. Standing in any of them and
  // facing the bench is the definition of "roughly near and roughly facing";
  // the four diagonals are the ones a circular reach around the CENTRE cuts off
  // at 1.414 against a 1.45 gate.
  let orthTot = 0;
  let orthOk = 0;
  let diagTot = 0;
  let diagOk = 0;
  for (const st of K.stations) {
    const c = stationCenter(st);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const x = st.cell.x + dx + 0.5;
      const y = st.cell.y + dy + 0.5;
      if (!isWalkable(K, st.cell.x + dx, st.cell.y + dy)) continue;
      const diag = dx !== 0 && dy !== 0;
      const got = pick(x, y, Math.atan2(c.y - y, c.x - x)) === st;
      if (diag) {
        diagTot++;
        if (got) diagOk++;
      } else {
        orthTot++;
        if (got) orthOk++;
      }
    }
  }

  // ---- 2c. what the inert penalty moves, as shipped
  TUNING.focusInertPenalty = keepInert;
  let inertTot = 0;
  let inertMoved = 0;
  for (const st of K.stations) {
    const c = stationCenter(st);
    for (const [x, y] of spots) {
      if (boxDist(st, x, y) > 0.9 || throughStation(x, y, st)) continue;
      inertTot++;
      if (pick(x, y, Math.atan2(c.y - y, c.x - x)) !== st) inertMoved++;
    }
  }

  // ---- 3. dead spots: standing next to a station and unable to reach it
  let nearSpots = 0;
  let deadSpots = 0;
  for (const [x, y] of spots) {
    let nearest = Infinity;
    for (const st of K.stations) {
      const c = stationCenter(st);
      nearest = Math.min(nearest, Math.hypot(c.x - x, c.y - y));
    }
    if (nearest > 1.6) continue;
    nearSpots++;
    let any = false;
    for (let i = 0; i < HEADS && !any; i++) if (pick(x, y, (i / HEADS) * Math.PI * 2 - Math.PI)) any = true;
    if (!any) deadSpots++;
  }

  const bad = rows.filter((r) => r.rate < 0.9).sort((a, b) => a.rate - b.rate);
  say(`\n== STATIC SWEEP  (${spots.length} body-fitting positions, ${HEADS} headings)`);
  say(`  reach ${TUNING.reach}  cone ${(TUNING.reachCone * 180 / Math.PI).toFixed(0)} deg half-angle`);
  say(`  approach band, facing the station squarely: ${(100 * acqHit / acqTot).toFixed(1)}% handed the right one`);
  say(`     (${acqTot} band positions, ${acqTot - acqHit} wrong, of which ${acqNull} focus NOTHING)`);
  say(`  stations under 90%: ${bad.length}/${rows.length}`);
  for (const r of bad.slice(0, 14)) say(`     ${(100 * r.rate).toFixed(0).padStart(3)}%  ${r.st}  (band ${r.band}, null ${r.nul})`);
  say(`  picks reaching THROUGH another station: ${(100 * acqThrough).toFixed(1)}%`);
  say(`  spots where any station is focusable: ${(100 * live / spots.length).toFixed(1)}%`);
  say(`  focus changes per 360 turn: ${(chg / spots.length).toFixed(2)} avg; switchbacks ${back} over ${spots.length} spots (${(100 * spotsWithSwitchback / spots.length).toFixed(1)}% of spots)`);
  say(`  5 deg heading jitter flips the answer: ${(100 * jitFlip / jitTot).toFixed(2)}%`);
  say(`  dead spots (within 1.6 of a station, nothing focusable at any heading): ${deadSpots}/${nearSpots}`);
  say(`  empty-handed, the glow moves off an inert bench to a useful neighbour: ${(100 * inertMoved / inertTot).toFixed(1)}% of band positions`);
  say(`  stand in a cell TOUCHING a bench and face it: orthogonal ${orthOk}/${orthTot} (${(100 * orthOk / orthTot).toFixed(1)}%), diagonal ${diagOk}/${diagTot} (${(100 * diagOk / diagTot).toFixed(1)}%)`);
  out.static = {
    spots: spots.length,
    acqRate: acqHit / acqTot,
    acqNull,
    worstStations: bad.slice(0, 8),
    through: acqThrough,
    liveFrac: live / spots.length,
    changesPerTurn: chg / spots.length,
    switchbacks: back,
    jitterFlip: jitFlip / jitTot,
    deadSpots,
    orth: orthOk / orthTot,
    diag: diagOk / diagTot,
  };
}

// ------------------------------------------------------------------ cone sweep

/**
 * What does the cone actually buy? Sweep it and print BOTH failure modes at
 * once: a cone too tight refuses a station you are standing in front of, a cone
 * too wide hands you one behind your back. The knee is where they cross.
 */
function coneSweep() {
  const keepCone = TUNING.reachCone;
  const keepReach = TUNING.reach;
  const keepInert = TUNING.focusInertPenalty;
  const keepOff = TUNING.focusOffLabelPenalty;
  say(`\n== CONE SWEEP  (geometry only: the affordance penalties are off)`);
  say(`  half-angle   squarely-facing   off-heading tolerance   behind-you   jitter   changes`);
  say(`               hit               p50      worst 5%       picks        flips    /turn`);
  const table = [];
  for (const deg of [45, 55, 60, 65, 70, 75, 80, 85, 90, 99, 110]) {
    TUNING.reachCone = (deg * Math.PI) / 180;
    TUNING.focusInertPenalty = 0;
    TUNING.focusOffLabelPenalty = 0;
    let hit = 0;
    let tot = 0;
    // THE NUMBER A TIGHTER CONE ACTUALLY COSTS: standing in the band, how far
    // off the station can you be looking and still be handed it? Measured as
    // the contiguous run of offsets from dead-on, both ways.
    const tol = [];
    for (const st of K.stations) {
      const c = stationCenter(st);
      for (const [x, y] of spots) {
        if (boxDist(st, x, y) > 0.9 || throughStation(x, y, st)) continue;
        tot++;
        const face = Math.atan2(c.y - y, c.x - x);
        if (pick(x, y, face) === st) hit++;
        if ((tot & 7) === 0) {
          let t = 0;
          for (let k = 5; k <= 120; k += 5) {
            const r = (k * Math.PI) / 180;
            if (pick(x, y, face + r) !== st || pick(x, y, face - r) !== st) break;
            t = k;
          }
          tol.push(t);
        }
      }
    }
    tol.sort((p, q) => p - q);
    let behind = 0;
    let picks = 0;
    let chg = 0;
    let jitTot = 0;
    let jitFlip = 0;
    const JIT = (5 * Math.PI) / 180;
    for (const [x, y] of spots) {
      let prev = null;
      for (let i = 0; i < 72; i++) {
        const h = (i / 72) * Math.PI * 2 - Math.PI;
        const got = pick(x, y, h);
        if (got !== prev) {
          if (prev || got) chg++;
          prev = got;
        }
        if (!got) continue;
        picks++;
        jitTot++;
        if (pick(x, y, h + JIT) !== got || pick(x, y, h - JIT) !== got) jitFlip++;
        const c = stationCenter(got);
        if (Math.abs(wrap(Math.atan2(c.y - y, c.x - x) - h)) > Math.PI / 2) behind++;
      }
    }
    const row = {
      deg,
      tolP50: tol[tol.length >> 1] ?? 0,
      tolP05: tol[Math.floor(tol.length * 0.05)] ?? 0,
      hit: hit / tot,
      behind: behind / Math.max(1, picks),
      jitter: jitFlip / Math.max(1, jitTot),
      chg: chg / spots.length,
    };
    table.push(row);
    say(
      `  ${String(deg).padStart(7)} deg   ${(100 * row.hit).toFixed(1).padStart(9)}%   ${String(row.tolP50).padStart(6)}   ${String(
        row.tolP05,
      ).padStart(8)}   ${(100 * row.behind).toFixed(1).padStart(10)}%   ${(100 * row.jitter).toFixed(1).padStart(6)}%   ${row.chg
        .toFixed(2)
        .padStart(6)}`,
    );
  }
  TUNING.reachCone = keepCone;
  TUNING.reach = keepReach;
  TUNING.focusInertPenalty = keepInert;
  TUNING.focusOffLabelPenalty = keepOff;
  out.cone = table;
}

// ------------------------------------------------------------------ acquire

/**
 * Walk at a station from eight directions with the real movement code and ask
 * whether arriving hands you the thing you walked to. Failures here are the
 * ones the player actually meets.
 */
function acquireRig(carry = null) {
  const fails = [];
  let tot = 0;
  let ok = 0;
  let slow = 0;
  let noPath = 0;
  let wrong = 0;
  let nothing = 0;
  const lat = [];
  const starts = [];
  for (let y = 1; y < K.height - 1; y++) {
    for (let x = 1; x < K.width - 1; x++) if (isWalkable(K, x, y)) starts.push([x + 0.5, y + 0.5]);
  }
  for (const target of K.stations) {
    const c = stationCenter(target);
    const flow = buildFlow(K, [{ x: target.cell.x, y: target.cell.y }]);
    // eight starts spread around the room, far enough to build real speed
    const ring = starts
      .filter(([x, y]) => Math.hypot(x - c.x, y - c.y) > 2.4)
      .map(([x, y]) => ({ x, y, a: Math.atan2(y - c.y, x - c.x) }));
    const chosen = [];
    for (let a = 0; a < 8; a++) {
      const want = (a / 8) * Math.PI * 2 - Math.PI;
      let bestP = null;
      let bestD = Infinity;
      for (const p of ring) {
        const d = Math.abs(wrap(p.a - want)) + Math.abs(Math.hypot(p.x - c.x, p.y - c.y) - 4) * 0.35;
        if (d < bestD) {
          bestD = d;
          bestP = p;
        }
      }
      if (bestP && !chosen.some((q) => q === bestP)) chosen.push(bestP);
    }
    for (const st0 of chosen) {
      const s = createSim({ seed: 99, botCount: 0 });
      seedPans(s);
      const chef = s.chefs[0];
      chef.pos.x = st0.x;
      chef.pos.y = st0.y;
      chef.heading = Math.atan2(c.y - st0.y, c.x - st0.x);
      if (carry) chef.carrying = carry(s);
      tot++;
      let arriveT = -1;
      let acqT = -1;
      let minD = Infinity;
      for (let i = 0; i < 60 * 8; i++) {
        const dx = c.x - chef.pos.x;
        const dy = c.y - chef.pos.y;
        const d = Math.hypot(dx, dy);
        minD = Math.min(minD, d);
        // Same approach the bot brain uses: flow field until 1.3, then a soft
        // seek straight at the station so the body faces what it walked to.
        let mv;
        if (d < 1.3) {
          if (arriveT < 0) arriveT = i;
          mv = { x: (dx / d) * 0.42, y: (dy / d) * 0.42 };
        } else {
          const f = flowDir(flow, K, chef.pos);
          mv = Math.hypot(f.x, f.y) < 0.2 ? { x: dx / d, y: dy / d } : f;
        }
        step(s, [{ move: mv, grabPressed: false, useHeld: false }]);
        s.events.length = 0;
        if (arriveT >= 0 && chef.focus === target.id) {
          acqT = (i - arriveT) / 60;
          break;
        }
        if (arriveT >= 0 && i - arriveT > 120) break;
      }
      if (acqT >= 0) {
        ok++;
        lat.push(acqT);
        if (acqT > 0.25) slow++;
      } else {
        const f = findFocus(s, chef);
        const d = Math.hypot(c.x - chef.pos.x, c.y - chef.pos.y);
        const why = arriveT < 0 ? 'nopath' : f ? 'wrong' : 'nothing';
        if (why === 'nopath') noPath++;
        else if (why === 'wrong') wrong++;
        else nothing++;
        fails.push({
          target: stName(target),
          from: `${st0.x.toFixed(1)},${st0.y.toFixed(1)}`,
          got: stName(f),
          why,
          dist: d.toFixed(2),
          minD: minD.toFixed(2),
        });
      }
    }
  }
  lat.sort((p, q) => p - q);
  say(`\n== ACQUIRE RIG  (walk at every station from 8 bearings, real movement + real flow field)`);
  say(`  acquired: ${ok}/${tot} (${(100 * ok / tot).toFixed(1)}%)  slower than 0.25s after arrival: ${slow}`);
  say(`  latency after arrival p50 ${(lat[lat.length >> 1] ?? 0).toFixed(3)}s  p95 ${(lat[Math.floor(lat.length * 0.95)] ?? 0).toFixed(3)}s`);
  say(`  misses: ${wrong} handed a DIFFERENT station, ${nothing} handed nothing, ${noPath} never got within 1.3 (pathing, not focus)`);
  const byTarget = {};
  for (const f of fails) if (f.why !== 'nopath') byTarget[f.target] = (byTarget[f.target] ?? 0) + 1;
  for (const [t, n] of Object.entries(byTarget).sort((a, b) => b[1] - a[1]).slice(0, 12)) {
    const eg = fails.find((f) => f.target === t && f.why !== 'nopath');
    say(`     MISS x${n}  ${t}  e.g. stood ${eg.dist} away and got ${eg.got}`);
  }
  out.acquire = { tot, ok, slow, wrong, nothing, noPath, byTarget };
}

// ------------------------------------------------------------------ service

/**
 * A human presses grab when they are near enough and pointed roughly the right
 * way — NOT when the glow has confirmed. Counting what those presses did is the
 * only honest measure of whether the interaction layer is forgiving.
 */
function serviceRig(runs = 6) {
  let presses = 0;
  let noop = 0;
  let wrongStation = 0;
  const noopWhy = {};
  let focusChanges = 0;
  let flipBacks = 0;
  let focusTicks = 0;
  let ticks = 0;
  let combosLost = 0;
  let blinks = 0;
  let swaps = 0;
  let botChanges = 0;
  let botSwaps = 0;
  let botFlips = 0;
  let botTicks = 0;
  const served = [];
  const flows = new Map();
  const flowFor = (st) => {
    if (!flows.has(st.id)) flows.set(st.id, buildFlow(K, [{ x: st.cell.x, y: st.cell.y }]));
    return flows.get(st.id);
  };
  for (let r = 0; r < runs; r++) {
    const s = createSim({ seed: 1000 + r * 37, botCount: 3 });
    seedPans(s);
    const dir = new BotDirector();
    const chef = s.chefs[0];
    const rnd = mulberry(9001 + r * 7717);
    let target = s.kitchen.stations[Math.floor(rnd() * s.kitchen.stations.length)];
    let dwell = 0;
    let pressed = false;
    let lastFocus = null;
    let prevFocus = null;
    let lastChangeTick = -99;
    const botLast = {};
    const botPrev = {};
    const botLastT = {};
    for (const b of s.chefs) {
      botLast[b.id] = null;
      botPrev[b.id] = null;
      botLastT[b.id] = -99;
    }
    for (let i = 0; i < 60 * 170 && !s.over; i++) {
      // BotDirector hands back a MAP keyed by chef id; `step` indexes an
      // ARRAY. Passing the map straight through silently gives every bot
      // NO_INPUT — four chefs standing still while the rig reports on their
      // behaviour. (It cost this probe two rounds of nonsense: "bots alone,
      // served 0".)
      const map = dir.update(s, SIM_DT);
      const inputs = s.chefs.map((c) => map.get(c.id) ?? NO);
      const c = stationCenter(target);
      const dx = c.x - chef.pos.x;
      const dy = c.y - chef.pos.y;
      const d = Math.hypot(dx, dy);
      const inp = { move: { x: 0, y: 0 }, grabPressed: false, useHeld: false };
      if (d < 1.3) {
        dwell++;
        inp.move = { x: (dx / d) * 0.42, y: (dy / d) * 0.42 };
        // A HUMAN PRESSES ON ARRIVAL, NOT ON CONFIRMATION. 0.3s after getting
        // there, whatever the glow says.
        if (dwell === 18 && !pressed) {
          inp.grabPressed = true;
          pressed = true;
        }
      } else {
        const f = flowDir(flowFor(target), K, chef.pos);
        inp.move = Math.hypot(f.x, f.y) < 0.2 ? { x: dx / d, y: dy / d } : f;
      }
      const before = {
        carry: chef.carrying,
        hold: s.kitchen.stations.map((st) => st.holding),
        served: s.score.served,
        combo: s.score.combo,
        contents:
          chef.carrying?.type === 'plate'
            ? chef.carrying.plate.contents.length
            : chef.carrying?.type === 'pan'
              ? chef.carrying.pan.contents.length
              : -1,
      };
      inputs[0] = inp;
      step(s, inputs);
      s.events.length = 0;
      ticks++;
      if (chef.focus != null) focusTicks++;
      // the bots move deliberately; if THEY strobe too it is not my player
      for (const b of s.chefs) {
        if (b.isPlayer) continue;
        botTicks++;
        if (b.focus !== botLast[b.id]) {
          botChanges++;
          if (b.focus !== null && botLast[b.id] !== null) botSwaps++;
          if (b.focus === botPrev[b.id] && b.focus !== null && i - botLastT[b.id] < 15) botFlips++;
          botPrev[b.id] = botLast[b.id];
          botLast[b.id] = b.focus;
          botLastT[b.id] = i;
        }
      }
      if (chef.focus !== lastFocus) {
        focusChanges++;
        if (chef.focus === null || lastFocus === null) blinks++;
        else swaps++;
        if (chef.focus === prevFocus && chef.focus !== null && i - lastChangeTick < 15) flipBacks++;
        prevFocus = lastFocus;
        lastFocus = chef.focus;
        lastChangeTick = i;
      }
      if (inp.grabPressed) {
        presses++;
        const after =
          chef.carrying?.type === 'plate'
            ? chef.carrying.plate.contents.length
            : chef.carrying?.type === 'pan'
              ? chef.carrying.pan.contents.length
              : -1;
        const changed =
          before.carry !== chef.carrying ||
          before.contents !== after ||
          before.served !== s.score.served ||
          s.kitchen.stations.some((st, k) => st.holding !== before.hold[k]);
        if (before.combo > 0 && s.score.combo === 0 && before.served === s.score.served) combosLost++;
        if (chef.focus !== target.id) wrongStation++;
        if (!changed) {
          noop++;
          const f = s.kitchen.stations.find((st) => st.id === chef.focus);
          const key = `${chef.carrying ? 'carrying ' + chef.carrying.type : 'empty-handed'} at ${f ? f.kind + (f.holding ? ' (full)' : ' (empty)') : 'NOTHING IN FOCUS'}`;
          noopWhy[key] = (noopWhy[key] ?? 0) + 1;
        }
      }
      if (pressed || dwell > 90) {
        target = s.kitchen.stations[Math.floor(rnd() * s.kitchen.stations.length)];
        dwell = 0;
        pressed = false;
      }
    }
    served.push(s.score.served);
  }
  say(`\n== SERVICE RIG  (${runs} runs, real bots + a player who presses on arrival)`);
  say(`  presses ${presses}: did nothing ${noop} (${(100 * noop / presses).toFixed(1)}%), landed on a station other than the one walked to ${wrongStation} (${(100 * wrongStation / presses).toFixed(1)}%)`);
  for (const [k, n] of Object.entries(noopWhy).sort((a, b) => b[1] - a[1]).slice(0, 12)) {
    say(`     ${String(n).padStart(4)}  ${k}`);
  }
  say(`  focus changes ${(focusChanges / (ticks / 60)).toFixed(2)}/s = ${(blinks / (ticks / 60)).toFixed(2)} blink on/off + ${(swaps / (ticks / 60)).toFixed(2)} bench-to-bench; flip-backs within 0.25s: ${flipBacks} (${(100 * flipBacks / focusChanges).toFixed(1)}%)`);
  say(`  bots (deliberate movers): ${(botChanges / (botTicks / 60 / 3)).toFixed(2)} changes/s per bot, ${(botSwaps / (botTicks / 60 / 3)).toFixed(2)} bench-to-bench, flip-backs ${botFlips} (${(100 * botFlips / Math.max(1, botChanges)).toFixed(1)}%)`);
  say(`  ticks with a focus: ${(100 * focusTicks / ticks).toFixed(1)}%   combos lost to a press: ${combosLost}   served ${served.join('/')}`);
  out.service = {
    presses,
    noop,
    noopRate: noop / presses,
    wrongStation,
    noopWhy,
    changesPerSec: focusChanges / (ticks / 60),
    blinksPerSec: blinks / (ticks / 60),
    swapsPerSec: swaps / (ticks / 60),
    flipBacks,
    served,
    botChangesPerSec: botChanges / (botTicks / 60 / 3),
    botSwapsPerSec: botSwaps / (botTicks / 60 / 3),
    botFlipBacks: botFlips,
  };
}

/**
 * BOTS ALONE. The interaction rules are shared with the bot brain, so any
 * change to what a press does has to be priced against throughput before it
 * ships. `kitchen.ts` documents the base map at a median of 9 served; this is
 * the same measurement, in node, at the true tick.
 */
function botsRig(runs = 20) {
  let atTarget = 0;
  let blockedTicks = 0;
  const served = [];
  const missed = [];
  const ended = [];
  for (let r = 0; r < runs; r++) {
    const s = createSim({ seed: 1000 + r * 37, botCount: 3 });
    seedPans(s);
    // Four bots, nobody human: the same convention tools/movab.mjs uses, so
    // the numbers are comparable with the movement piece's.
    for (const c of s.chefs) c.isPlayer = false;
    const dir = new BotDirector();
    for (let i = 0; i < 60 * 190 && !s.over; i++) {
      const map = dir.update(s, SIM_DT);
      step(s, s.chefs.map((c) => map.get(c.id) ?? NO));
      s.events.length = 0;
      // THE ONE FAILURE MODE THE BOT BRAIN CANNOT SEE FROM INSIDE: it presses
      // only when `focus` equals the station it walked to, so a chef standing
      // at its own target with the glow on the bench NEXT to it is frozen. The
      // brain's memory is `private` in TypeScript and a plain field at runtime,
      // so the probe can just read it.
      for (const c of s.chefs) {
        const m = dir.mem?.get(c.id);
        const jid = m?.job?.station;
        if (jid == null) continue;
        const st = s.kitchen.stations.find((x) => x.id === jid);
        if (!st) continue;
        const d = Math.hypot(stationCenter(st).x - c.pos.x, stationCenter(st).y - c.pos.y);
        if (d > 1.3) continue;
        atTarget++;
        if (c.focus !== jid) blockedTicks++;
      }
    }
    served.push(s.score.served);
    missed.push(s.score.missed);
    ended.push(Math.round(s.time));
  }
  const med = (a) => [...a].sort((p, q) => p - q)[a.length >> 1];
  say(`\n== BOTS ALONE  (${runs} runs, no player)`);
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const sem = (a) => Math.sqrt(a.reduce((x, y) => x + (y - mean(a)) ** 2, 0) / (a.length - 1) / a.length);
  say(`  served mean ${mean(served).toFixed(2)} +/- ${sem(served).toFixed(2)}  median ${med(served)}  ${served.join('/')}`);
  say(`  missed median ${med(missed)}  ended median ${med(ended)}s`);
  say(`  bot standing AT its own target with the glow on something else: ${(100 * blockedTicks / Math.max(1, atTarget)).toFixed(1)}% of at-target ticks (${(blockedTicks / 60 / runs).toFixed(1)}s per run)`);
  out.bots = { served, missed, ended, medianServed: med(served) };
}

/**
 * FORGIVENESS — every mistake, and what it costs to take it back.
 *
 * The reference tells the player in so many words: "If you grab the wrong
 * ingredient by accident, just put it back where you found it!" Each case below
 * makes the mistake in the real sim and then tries to undo it.
 */
function forgivenessRig() {
  const rows = [];
  const mk = () => {
    const s = createSim({ seed: 7, botCount: 0 });
    seedPans(s);
    return s;
  };
  const at = (s, kind, pred) => s.kitchen.stations.find((st) => st.kind === kind && (!pred || pred(st)));
  const press = (s, st) => {
    const chef = s.chefs[0];
    const c = stationCenter(st);
    // stand square on to it, facing it: what the sim sees is all that matters
    chef.pos.x = c.x - st.facing.x * 0.9 - (st.facing.x ? 0 : 0);
    chef.pos.y = c.y - st.facing.y * 0.9;
    chef.pos.x = c.x + (st.facing.x || 0) * 0.9;
    chef.pos.y = c.y + (st.facing.y || 0) * 0.9;
    chef.heading = Math.atan2(c.y - chef.pos.y, c.x - chef.pos.x);
    step(s, [{ move: { x: 0, y: 0 }, grabPressed: true, useHeld: false }]);
    s.events.length = 0;
  };
  const check = (name, fn) => {
    let ok = false;
    let note = '';
    try {
      const r = fn();
      ok = !!r.ok;
      note = r.note ?? '';
    } catch (e) {
      note = String(e.message);
    }
    rows.push({ name, ok, note });
  };

  check('wrong ingredient -> put it back in ANY crate', () => {
    const s = mk();
    const t = at(s, 'crate', (st) => st.dispenses === 'tomato');
    const l = at(s, 'crate', (st) => st.dispenses === 'lettuce');
    press(s, t);
    const took = s.chefs[0].carrying?.type === 'ingredient';
    press(s, l);
    return { ok: took && s.chefs[0].carrying === null, note: took ? '' : 'never picked one up' };
  });
  check('wrong plate -> put it back on the stack', () => {
    const s = mk();
    const d = at(s, 'plates');
    press(s, d);
    const took = s.chefs[0].carrying?.type === 'plate';
    press(s, d);
    return { ok: took && s.chefs[0].carrying === null };
  });
  check('half-chopped, lifted and put back -> progress survives', () => {
    const s = mk();
    const chef = s.chefs[0];
    const t = at(s, 'crate', (st) => st.dispenses === 'tomato');
    const b = at(s, 'board');
    press(s, t);
    press(s, b);
    const c = stationCenter(b);
    chef.pos.x = c.x + (b.facing.x || 0) * 0.9;
    chef.pos.y = c.y + (b.facing.y || 0) * 0.9;
    chef.heading = Math.atan2(c.y - chef.pos.y, c.x - chef.pos.x);
    for (let i = 0; i < 40; i++) {
      step(s, [{ move: { x: 0, y: 0 }, grabPressed: false, useHeld: true }]);
      s.events.length = 0;
    }
    const mid = b.work;
    press(s, b); // lift it
    press(s, b); // put it straight back
    return { ok: mid > 0.05 && Math.abs(b.work - mid) < 1e-6, note: `progress ${mid.toFixed(2)} -> ${b.work.toFixed(2)}` };
  });
  check('one wrong ingredient on a plate -> bin takes ONE, not the plate', () => {
    const s = mk();
    const chef = s.chefs[0];
    const d = at(s, 'plates');
    press(s, d);
    const plate = chef.carrying.plate;
    plate.contents.push({ id: 900, kind: 'tomato', state: 'prepped', progress: 0, overcook: 0 });
    plate.contents.push({ id: 901, kind: 'lettuce', state: 'prepped', progress: 0, overcook: 0 });
    press(s, at(s, 'bin'));
    return { ok: plate.contents.length === 1, note: `2 -> ${plate.contents.length}` };
  });
  check('mis-press on an occupied bench -> swap, and swap back', () => {
    const s = mk();
    const chef = s.chefs[0];
    const co = at(s, 'counter');
    const t = at(s, 'crate', (st) => st.dispenses === 'tomato');
    press(s, t);
    press(s, co); // place
    press(s, t); // take another
    const mine = chef.carrying.ingredient.id;
    const theirs = co.holding.ingredient.id;
    press(s, co); // swap
    const swapped = chef.carrying.ingredient.id === theirs && co.holding.ingredient.id === mine;
    press(s, co); // swap back
    const back = chef.carrying.ingredient.id === mine && co.holding.ingredient.id === theirs;
    return { ok: swapped && back, note: swapped ? '' : 'no swap' };
  });
  check('serving a half-built plate does not break the combo', () => {
    const s = mk();
    const chef = s.chefs[0];
    s.score.combo = 5;
    const d = at(s, 'plates');
    press(s, d);
    const want = s.orders[0].recipe.components[0];
    chef.carrying.plate.contents.push({ id: 902, kind: want.kind, state: want.state, progress: 0, overcook: 0 });
    press(s, at(s, 'serve'));
    return { ok: s.score.combo === 5, note: `combo 5 -> ${s.score.combo}` };
  });
  check('serving a genuinely wrong dish still costs the combo', () => {
    const s = mk();
    const chef = s.chefs[0];
    s.score.combo = 5;
    press(s, at(s, 'plates'));
    for (let i = 0; i < 4; i++)
      chef.carrying.plate.contents.push({ id: 910 + i, kind: 'bun', state: 'burnt', progress: 0, overcook: 0 });
    press(s, at(s, 'serve'));
    return { ok: s.score.combo === 0, note: `combo 5 -> ${s.score.combo}` };
  });

  say(`\n== FORGIVENESS`);
  for (const r of rows) say(`  ${r.ok ? 'ok  ' : 'FAIL'}  ${r.name}${r.note ? '   [' + r.note + ']' : ''}`);
  out.forgiveness = rows;

  // NOWHERE TO PUT THIS. For each thing a chef can be holding, how far is the
  // worst spot on the floor from somewhere the button would take it?
  const s0 = mk();
  const loads = {
    'raw ingredient': { type: 'ingredient', ingredient: { id: 1, kind: 'tomato', state: 'raw', progress: 0, overcook: 0 } },
    'clean plate': { type: 'plate', plate: { id: 2, contents: [], dirty: false, stack: 1 } },
    'plate + food': {
      type: 'plate',
      plate: { id: 3, contents: [{ id: 4, kind: 'tomato', state: 'prepped', progress: 0, overcook: 0 }], dirty: false, stack: 1 },
    },
    pan: { type: 'pan', pan: { id: 5, contents: [], onHeat: false, fire: 0 } },
  };
  say(`  worst walk to somewhere the press works, by what you are holding:`);
  for (const [name, load] of Object.entries(loads)) {
    const chef = { ...s0.chefs[0], carrying: load, focus: null };
    let worst = 0;
    let worstAt = '';
    for (const [x, y] of spots) {
      let near = Infinity;
      for (const st of K.stations) {
        if (planGrab(s0, { ...chef, pos: { x, y } }, st) === 'none') continue;
        near = Math.min(near, boxDist(st, x, y));
      }
      if (near > worst) {
        worst = near;
        worstAt = `${x.toFixed(1)},${y.toFixed(1)}`;
      }
    }
    say(`     ${name.padEnd(15)} ${worst.toFixed(2)} units (at ${worstAt})`);
  }
}

/**
 * THE HARNESS'S OWN SCRIPT, REPLAYED IN NODE. tools/shoot.mjs drives a fixed
 * plan of moves and presses; if a change to the interaction rules alters what
 * that script does, every screenshot in the project changes with it. Same plan,
 * same order, game-seconds for game-seconds.
 */
function harnessRig(seconds = 16) {
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
  const s = createSim({ seed: 4242, botCount: 3 });
  seedPans(s);
  const dir = new BotDirector();
  const chef = s.chefs[0];
  let t = 0;
  let p = 0;
  const log = [];
  let presses = 0;
  let acted = 0;
  while (t < seconds && !s.over) {
    const d = plan[p % plan.length];
    p++;
    let left = d.s;
    let firstTick = true;
    while (left > 1e-6 && t < seconds) {
      const map = dir.update(s, SIM_DT);
      const inputs = s.chefs.map((c) => map.get(c.id) ?? NO);
      inputs[0] = {
        move: d.move ?? { x: 0, y: 0 },
        grabPressed: !!d.grab && firstTick,
        useHeld: !!d.use && firstTick,
      };
      const before = chef.carrying;
      const beforeHold = s.kitchen.stations.map((x) => x.holding);
      step(s, inputs);
      s.events.length = 0;
      if (inputs[0].grabPressed) {
        presses++;
        if (before !== chef.carrying || s.kitchen.stations.some((x, i) => x.holding !== beforeHold[i])) acted++;
      }
      firstTick = false;
      left -= SIM_DT;
      t += SIM_DT;
    }
    log.push(
      `    t=${t.toFixed(1)}s  ${chef.pos.x.toFixed(1)},${chef.pos.y.toFixed(1)}  focus ${chef.focus}  ${chef.focusAction}  ${
        chef.carrying ? chef.carrying.type : '-'
      }`,
    );
  }
  say(`\n== HARNESS SCRIPT REPLAY (${seconds}s, the exact plan tools/shoot.mjs drives)`);
  say(`  player presses ${presses}, of which did something: ${acted}`);
  say(`  served ${s.score.served}  missed ${s.score.missed}  patience ${s.score.patience.toFixed(2)}`);
  for (const l of log.slice(0, 14)) say(l);
  out.harness = { presses, acted, served: s.score.served };
}

/** Sim cost per tick with four chefs. findFocus now plans every candidate. */
function perfRig() {
  const s = createSim({ seed: 5, botCount: 3 });
  seedPans(s);
  for (const c of s.chefs) c.isPlayer = false;
  const dir = new BotDirector();
  const N = 30000;
  // warm up
  for (let i = 0; i < 3000; i++) {
    const m = dir.update(s, SIM_DT);
    step(s, s.chefs.map((c) => m.get(c.id) ?? NO));
    s.events.length = 0;
  }
  const inputs = s.chefs.map(() => NO);
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < N; i++) {
    s.over = false;
    step(s, inputs);
    s.events.length = 0;
  }
  const us = Number(process.hrtime.bigint() - t0) / 1000 / N;
  say(`\n== SIM COST  ${us.toFixed(1)} us/tick with 4 chefs (16667 us of budget at 60Hz => ${((us / 16667) * 100).toFixed(2)}% of a frame)`);
  out.perf = { usPerTick: us };
}

if (ONLY.includes('perf')) perfRig();
if (ONLY.includes('harness')) harnessRig(Number(argv.seconds ?? 16));
if (ONLY.includes('forgive')) forgivenessRig();
if (ONLY.includes('bots')) botsRig(Number(argv.runs ?? 20));
if (ONLY.includes('static')) staticSweep();
if (ONLY.includes('cone')) coneSweep();
if (ONLY.includes('acquire')) acquireRig();
if (ONLY.includes('service')) serviceRig(Number(argv.runs ?? 6));
if (JSONOUT) console.log(JSON.stringify(out, null, 2));
