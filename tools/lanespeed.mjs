/**
 * LANE SPEED — how much of an errand does a chef actually spend at cruise?
 *
 * feelcrit.mjs answers this for chef 0 driven by the real BotDirector, which
 * folds two very different things together: how open the room is, and how much
 * the bot's own avoidance term jitters its stick. This isolates the room. One
 * chef, alone, steered straight down the flow field toward a target, no other
 * bodies to avoid — i.e. what a player holding the stick experiences.
 *
 * It runs the same errands against two maps so the delta is attributable:
 *
 *   node tools/lanespeed.mjs                 current KITCHEN_MAP
 *   node tools/lanespeed.mjs --legacy        the pre-wave-2 confetti map
 *   node tools/lanespeed.mjs --both          both, side by side
 */
import { build } from 'rolldown';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(os.tmpdir(), `ls-${process.pid}.mjs`);
const ENTRY = path.join(os.tmpdir(), `lse-${process.pid}.ts`);
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
const { createSim, step, TUNING, isWalkable, buildFlow, flowDir, buildKitchen, KITCHEN_MAP } = S;
const IN = (m) => ({ move: m, grabPressed: false, useHeld: false });

const LEGACY = [
  '###############',
  '#DSS#=====#SOO#',
  '#.....X.XD....#',
  '#.TLB.....X-..#',
  '#....XK.X...-.#',
  '#.TX.....UBW..#',
  '#.X...T.D..L-.#',
  '#.LTXB.XUT....#',
  '#.............#',
  '#.............#',
  '###############',
];

// Errand endpoints must be IDENTICAL across maps or the comparison is between
// two different sets of journeys: the shipped map has 89 walkable cells and the
// legacy one 75, so indexing into each map's own cell list silently changes
// both the distances and the routes. These are the cells walkable in both.
const COMMON = (() => {
  const a = buildKitchen(KITCHEN_MAP), b = buildKitchen(LEGACY);
  const out = [];
  for (let y = 0; y < a.height; y++) for (let x = 0; x < a.width; x++) {
    if (isWalkable(a, x, y) && isWalkable(b, x, y)) out.push({ x: x + 0.5, y: y + 0.5 });
  }
  return out;
})();

function measure(map, label) {
  const k = buildKitchen(map);
  const spots = COMMON;
  const hist = { cruise: 0, mid: 0, crawl: 0, still: 0 };
  let frames = 0, dist = 0, secs = 0, done = 0, longest = 0; const ticks = [];
  for (let i = 0; i < 120; i++) {
    const from = spots[(i * 7) % spots.length];
    const to = spots[(i * 7 + 31) % spots.length];
    if (Math.hypot(from.x - to.x, from.y - to.y) < 3) continue;
    const s = createSim({ seed: 5, botCount: 0 });
    s.kitchen = k;
    const c = s.chefs[0];
    c.pos = { ...from }; c.vel = { x: 0, y: 0 };
    const flow = buildFlow(k, [to]);
    // A timed-out errand is a flow-field dead end, not a movement measurement:
    // it contributes 900 frames of a chef standing on a zero gradient and would
    // swamp the histogram. Buffer each errand and only fold in the ones that
    // actually arrive.
    let run = 0, arrived = false;
    const buf = { cruise: 0, mid: 0, crawl: 0, still: 0 }; let bd = 0, bf = 0, blong = 0;
    for (let t = 0; t < 900; t++) {
      step(s, [IN(flowDir(flow, k, c.pos))]);
      s.events.length = 0;
      const sp = Math.hypot(c.vel.x, c.vel.y);
      bd += sp / 60; bf++;
      if (sp < 0.4) buf.still++;
      else if (sp < 0.5 * TUNING.moveSpeed) buf.crawl++;
      else if (sp < 0.9 * TUNING.moveSpeed) buf.mid++;
      else buf.cruise++;
      if (sp > 0.9 * TUNING.moveSpeed) { run++; blong = Math.max(blong, run); } else run = 0;
      if (Math.hypot(c.pos.x - to.x, c.pos.y - to.y) < 1.0) { arrived = true; ticks.push(t); break; }
    }
    if (!arrived) { ticks.push(-1); continue; }
    done++;
    hist.cruise += buf.cruise; hist.mid += buf.mid; hist.crawl += buf.crawl; hist.still += buf.still;
    dist += bd; secs += bf / 60; frames += bf; longest = Math.max(longest, blong);
  }
  const p = (n) => ((100 * n) / frames).toFixed(2).padStart(6);
  console.log(`${label}`);
  console.log(`  errands completed        ${done}`);
  console.log(`  >90% cruise             ${p(hist.cruise)}%`);
  console.log(`  50-90% cruise           ${p(hist.mid)}%`);
  console.log(`  <50% cruise (moving)    ${p(hist.crawl)}%`);
  console.log(`  effectively stopped     ${p(hist.still)}%`);
  console.log(`  mean speed              ${(dist / secs).toFixed(3)} u/s of a 6.2 cruise = ${((100 * dist) / secs / TUNING.moveSpeed).toFixed(1)}%`);
  console.log(`  longest unbroken cruise ${(longest / 60).toFixed(2)}s`);
  const ok = ticks.filter((t) => t >= 0).sort((a, b) => a - b);
  console.log(`  MEDIAN ERRAND TIME      ${(ok[ok.length >> 1] / 60).toFixed(2)}s   (p25 ${(ok[ok.length >> 2] / 60).toFixed(2)}s  p75 ${(ok[(3 * ok.length) >> 2] / 60).toFixed(2)}s)`);
  console.log(`  errands that never arrived ${ticks.filter((t) => t < 0).length} of ${ticks.length}`);
}

if (process.argv.includes('--legacy')) measure(LEGACY, 'LEGACY MAP (pre-wave-2)');
else if (process.argv.includes('--both')) { measure(LEGACY, 'LEGACY MAP (pre-wave-2)'); console.log(''); measure(KITCHEN_MAP, 'CURRENT KITCHEN_MAP'); }
else measure(KITCHEN_MAP, 'CURRENT KITCHEN_MAP');
