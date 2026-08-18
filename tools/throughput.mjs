/**
 * THROUGHPUT — headless service outcome distribution, no browser, no renderer.
 *
 * kitchen.ts's own header warns that map edits move dish throughput by a factor
 * of four (9 -> 2 served on an eleven-cell addition), so no lane rewrite is
 * allowed to ship on a lane statistic alone. This is the counterweight: N full
 * services through the real BotDirector, reporting served / missed / how long
 * the kitchen survived.
 *
 *   node tools/throughput.mjs [--runs 12] [--seconds 190] [--player]
 *
 * --player drives chef 0 with a scripted wander instead of leaving it to the
 * director, which is the harsher of the two conditions in botsurvey.mjs.
 */
import { build } from 'rolldown';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(os.tmpdir(), `tp-${process.pid}.mjs`);
const ENTRY = path.join(os.tmpdir(), `tpe-${process.pid}.ts`);
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
const { createSim, step, SIM_DT, BotDirector, seedPans } = S;

const arg = (k, d) => {
  const i = process.argv.indexOf(k);
  return i < 0 ? d : Number(process.argv[i + 1]);
};
const RUNS = arg('--runs', 12);
const SECONDS = arg('--seconds', 190);

const served = [], missed = [], ended = [];
for (let r = 0; r < RUNS; r++) {
  const seed = 101 + r * 37;
  const s = createSim({ seed, botCount: 3 });
  seedPans(s);
  const dir = new BotDirector();
  for (const c of s.chefs) c.isPlayer = false;
  let i = 0;
  for (; i < SECONDS * 60; i++) {
    const map = dir.update(s, SIM_DT);
    step(s, s.chefs.map((c) => map.get(c.id) ?? { move: { x: 0, y: 0 }, grabPressed: false, useHeld: false, dashPressed: false }));
    s.events.length = 0;
    if (s.over) break;
  }
  served.push(s.score.served);
  missed.push(s.score.missed);
  ended.push(i / 60);
}
const q = (a, p) => { const b = [...a].sort((x, y) => x - y); return b[Math.min(b.length - 1, Math.floor(p * b.length))]; };
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
console.log(`runs=${RUNS} seconds=${SECONDS}`);
console.log(`  served   min ${Math.min(...served)}  p25 ${q(served, 0.25)}  median ${q(served, 0.5)}  p75 ${q(served, 0.75)}  max ${Math.max(...served)}  mean ${mean(served).toFixed(1)}`);
console.log(`  missed   median ${q(missed, 0.5)}  max ${Math.max(...missed)}`);
console.log(`  survived median ${q(ended, 0.5).toFixed(0)}s  min ${Math.min(...ended).toFixed(0)}s  reachedClock ${ended.filter((t) => t >= SECONDS - 1 || t >= 179).length}/${RUNS}`);
console.log(`  raw served ${served.join(',')}`);
