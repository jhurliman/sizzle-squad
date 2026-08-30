// TS twin of smoke.luau: runs the same barrel (src/shared/index.ts) under
// Node for cross-platform comparison against the TSTL/Luau build.
// Usage: node tools/smoke-ts.mjs [seed]
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const outfile = path.join(HERE, '../out/shared-bundle.node.mjs');
await build({
  entryPoints: [path.join(HERE, '../src/shared/index.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile,
  logLevel: 'warning',
});
const shared = await import(pathToFileURL(outfile));

const seed = Number(process.argv[2] ?? 12345);
const sim = shared.createSim({ seed, botCount: 3 });
shared.seedPans(sim);
const bots = shared.makeBotDirector();

let ticks = 0;
const t0 = performance.now();
while (!sim.over) {
  const botInputs = bots.update(sim, shared.SIM_DT);
  const inputs = [];
  for (const chef of sim.chefs) inputs[chef.id] = botInputs.get(chef.id) ?? shared.NO_INPUT;
  shared.step(sim, inputs);
  sim.events = [];
  if (++ticks > 60 * 600) throw new Error('round never ended');
}
const ms = performance.now() - t0;
console.log(
  `seed=${seed} ticks=${ticks} time=${Math.floor(sim.time * 10) / 10}s coins=${sim.score.coins} served=${sim.score.served} missed=${sim.score.missed} combo=${sim.score.bestCombo}`,
);
console.error(`wall=${ms.toFixed(0)}ms (${Math.floor((ticks / ms) * 1000)} ticks/s)`);
