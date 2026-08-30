// Reference-side parity recorder: runs seeded bot-only rounds of the shared
// sim under Node and writes per-tick state digests. tools/parity.luau writes
// the same format from the TSTL/Luau build; tools/parity-compare.mjs diffs.
// Usage: node tools/parity-ts.mjs [seeds...]
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const OUT = path.join(HERE, '../out');
const outfile = path.join(OUT, 'shared-bundle.node.mjs');
await build({
  entryPoints: [path.join(HERE, '../src/shared/index.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile,
  logLevel: 'warning',
});
const shared = await import(pathToFileURL(outfile));

const seeds = process.argv.slice(2).map(Number);
if (seeds.length === 0) seeds.push(12345, 777, 424242);

for (const seed of seeds) {
  const sim = shared.createSim({ seed, botCount: 3 });
  shared.seedPans(sim);
  const bots = shared.makeBotDirector();
  const lines = [];
  let ticks = 0;
  while (!sim.over) {
    const botInputs = bots.update(sim, shared.SIM_DT);
    const inputs = [];
    for (const chef of sim.chefs) inputs[chef.id] = botInputs.get(chef.id) ?? shared.NO_INPUT;
    shared.step(sim, inputs);
    sim.events = [];
    ticks++;
    const chefs = sim.chefs
      .map((c) => `${c.pos.x.toPrecision(17)},${c.pos.y.toPrecision(17)},${c.vel.x.toPrecision(17)},${c.vel.y.toPrecision(17)}`)
      .join(';');
    const stations = sim.kitchen.stations.map((st) => `${st.id}:${st.holding ? st.holding.type : '-'}`).join(',');
    lines.push(
      `${sim.tick}|${chefs}|${sim.score.coins},${sim.score.served},${sim.score.missed},${sim.score.combo}|${sim.orders.length}|${stations}`,
    );
    if (ticks > 60 * 600) throw new Error('round never ended');
  }
  fs.writeFileSync(path.join(OUT, `parity-ts-${seed}.txt`), lines.join('\n') + '\n');
  console.error(`seed ${seed}: ${ticks} ticks recorded`);
}
