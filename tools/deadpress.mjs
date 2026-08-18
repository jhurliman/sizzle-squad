/**
 * DEAD PRESS CENSUS — splits "the game refused me" from "I asked for nothing".
 *
 * Both the builder's focusprobe SERVICE rig and the critic's rig 4 report one
 * number: the fraction of grab presses that did nothing. It is the wrong
 * number on its own, because it pools two completely different events:
 *
 *   TARGETING FAILURE — something within arm's reach could have answered the
 *     press and the interaction layer did not give it to you. This is the bug.
 *   IMPOSSIBLE REQUEST — you pressed holding a plate at a tomato crate. Nothing
 *     within reach can answer that, and no amount of forgiveness should invent
 *     an action. This is the player (or the bot brain driving them) being wrong,
 *     and the correct response is a sound, not a pickup.
 *
 * So for every press that produced no `pickup` / `place` / `trash` / `serve`,
 * this asks the sim whether ANY station inside `reach` had a plan other than
 * 'none' at that tick. That is the only version of "dead press" a change to
 * findFocus or the input buffer can move.
 *
 * ONE CAVEAT, AND IT IS THE REASON THIS IS NOT THE HEADLINE NUMBER: the bot
 * brain only presses once `bot.focus === st.id`, i.e. it waits for the game to
 * confirm. A human presses on ARRIVAL. So this rig understates timing failures
 * by construction and is the CONSERVATIVE read — the human-timing model lives
 * in tools/critic_station.mjs rigs 1 and 5 and in tools/grabsweep.mjs.
 *
 *   node tools/deadpress.mjs [--src /tmp/base/src]
 */
import { build } from 'rolldown';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SRC = process.argv.includes('--src') ? process.argv[process.argv.indexOf('--src') + 1] : path.join(ROOT, 'src');
const OUT = path.join(os.tmpdir(), `dp-${process.pid}.mjs`);
const ENTRY = path.join(os.tmpdir(), `dp-entry-${process.pid}.ts`);
fs.writeFileSync(
  ENTRY,
  `export * from ${JSON.stringify(path.join(SRC, 'domain/sim.ts'))};
export * from ${JSON.stringify(path.join(SRC, 'domain/content.ts'))};
export * from ${JSON.stringify(path.join(SRC, 'domain/kitchen.ts'))};
export * from ${JSON.stringify(path.join(SRC, 'domain/nav.ts'))};
export * from ${JSON.stringify(path.join(SRC, 'bots/brain.ts'))};
`,
);
await build({ input: ENTRY, output: { file: OUT, format: 'esm' }, logLevel: 'silent' });
const S = await import(OUT);
fs.rmSync(ENTRY, { force: true });
fs.rmSync(OUT, { force: true });
const { createSim, step, SIM_DT, TUNING, seedPans, BotDirector, planGrab } = S;

const NO = { move: { x: 0, y: 0 }, grabPressed: false, useHeld: false, dashPressed: false };
const boxDist = (st, x, y) =>
  Math.hypot(Math.max(st.cell.x - x, 0, x - (st.cell.x + 1)), Math.max(st.cell.y - y, 0, y - (st.cell.y + 1)));
const DID = new Set(['pickup', 'place', 'trash', 'serve', 'serveWrong']);

let presses = 0, worked = 0, targeting = 0, impossible = 0, misses = 0, stunned = 0;
for (const seed of [11, 12, 13, 14, 15, 16]) {
  const s = createSim({ seed, botCount: 3 });
  seedPans(s);
  const bots = new BotDirector(s);
  bots.drivePlayer = true;
  const player = s.chefs[0];
  let armed = false;
  for (let t = 0; t < Math.floor(170 / SIM_DT); t++) {
    const bi = bots.update(s, SIM_DT);
    const inputs = s.chefs.map((c) => bi.get(c.id) ?? NO);
    // The bot brain holds grab down; count RISING EDGES, which is what a human
    // and the real input layer produce.
    const pressed = !!inputs[0]?.grabPressed;
    const edge = pressed && !armed;
    armed = pressed;
    // What could possibly have answered, evaluated BEFORE the step.
    let answerable = false;
    if (edge) {
      for (const st of s.kitchen.stations) {
        if (boxDist(st, player.pos.x, player.pos.y) > TUNING.reach) continue;
        if (planGrab(s, player, st) !== 'none') { answerable = true; break; }
      }
      if (player.stun > 0) stunned++;
    }
    s.events.length = 0;
    step(s, inputs);
    if (edge) {
      presses++;
      // A buffered press can resolve on a later tick, so credit is given for
      // anything the player did in the buffer window rather than on this tick.
      let acted = s.events.some((e) => DID.has(e.t) && e.chef === 0);
      for (let k = 0; k < Math.ceil(TUNING.grabBufferSeconds / SIM_DT) + 1 && !acted; k++) {
        const bi2 = bots.update(s, SIM_DT);
        const in2 = s.chefs.map((c) => bi2.get(c.id) ?? NO);
        in2[0] = { ...in2[0], grabPressed: false };
        s.events.length = 0;
        step(s, in2);
        t++;
        acted = s.events.some((e) => DID.has(e.t) && e.chef === 0);
        if (s.events.some((e) => e.t === 'grabMiss' && e.chef === 0)) { misses++; break; }
      }
      if (acted) worked++;
      else if (answerable) targeting++;
      else impossible++;
    }
    if (s.over) break;
  }
}
const pct = (n) => `${((n / presses) * 100).toFixed(1)}%`;
console.log(`== DEAD PRESS CENSUS  (6 x 170s, 4 chefs, bot brain driving the player, rising edges only)`);
console.log(`   presses ${presses}`);
console.log(`   did something                                        ${String(worked).padStart(4)}  ${pct(worked)}`);
console.log(`   DEAD, and something in reach COULD have answered      ${String(targeting).padStart(4)}  ${pct(targeting)}   <- the interaction layer's bill`);
console.log(`   dead, and nothing in reach could answer              ${String(impossible).padStart(4)}  ${pct(impossible)}   (plate at a crate; a sound, not a pickup)`);
console.log(`   pressed while stunned                                ${String(stunned).padStart(4)}  ${pct(stunned)}`);
console.log(`   grabMiss events emitted                              ${String(misses).padStart(4)}`);
