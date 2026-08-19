/**
 * WHAT DOES THE BUTTON DO HERE? — the station plan matrix, asserted.
 *
 *   node tools/planprobe.mjs
 *
 * Every other tool in this directory drives Chromium and looks at pixels. That
 * is the right instrument for a camera or a control, and it is the wrong one
 * for `planGrab`, which is a pure function returning a word. Three bugs shipped
 * to a real player in one build because nothing in the project could ask it a
 * direct question:
 *
 *   - a crate took ANY ingredient back and deleted it, so the lettuce bin was
 *     a working incinerator for bread and for chopped tomatoes
 *   - a sink accepted loose ingredients, because `isSurface` lists it
 *   - a burner handed you its frying pan, a move with no use and a real cost
 *
 * None of those is visible in a screenshot and none would fail a capture run.
 *
 * src/domain is pure on purpose — no three.js, no DOM, no wall clock — which is
 * exactly what makes this possible: it compiles standalone and the rules can be
 * asked directly. That purity rule in AGENTS.md has been load-bearing for the
 * sim's determinism since the start; this is the first thing to also make it
 * load-bearing for testing.
 *
 * Exits non-zero on any mismatch, so it can gate a deploy.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'planprobe-'));

// tsc with the config ignored: tsconfig.json targets the whole app (DOM libs,
// three.js paths) and we want just the four pure files and their imports.
execFileSync(
  'npx',
  ['tsc', path.join(ROOT, 'src/domain/sim.ts'), '--ignoreConfig', '--outDir', OUT,
   '--module', 'esnext', '--target', 'es2022', '--moduleResolution', 'bundler', '--skipLibCheck'],
  { cwd: ROOT, stdio: 'inherit' },
);
// tsc emits extensionless relative imports; Node's ESM loader requires them.
for (const f of fs.readdirSync(OUT).filter((f) => f.endsWith('.js'))) {
  const p = path.join(OUT, f);
  fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace(/(from '\.\/[A-Za-z]+)'/g, "$1.js'"));
}

const { createSim, planGrab } = await import(path.join(OUT, 'sim.js'));
const { INGREDIENT_DEFS } = await import(path.join(OUT, 'content.js'));

const s = createSim(20260818);
const chef = s.chefs[0];
const stationOf = (kind, dispenses) =>
  s.kitchen.stations.find((st) => st.kind === kind && (!dispenses || st.dispenses === dispenses));

const ing = (kind, state = 'raw') => ({ type: 'ingredient', ingredient: { kind, state, chop: 0 } });
const plate = (dirty = false, contents = []) => ({ type: 'plate', plate: { contents, dirty } });
const pan = (contents = []) => ({ type: 'pan', pan: { contents, onHeat: false, fire: 0 } });

/** [label, station kind, what the station holds, what the chef holds, expected] */
const CASES = [
  // A crate is an infinite source of ONE kind. Anything else handed to it is
  // destroyed, so it must refuse everything but its own raw output.
  ['crate refuses foreign food', 'crate:lettuce', null, ing('bun'), 'none'],
  ['crate refuses prepped work', 'crate:lettuce', null, ing('lettuce', 'prepped'), 'none'],
  ['crate takes its own back', 'crate:lettuce', null, ing('lettuce'), 'return'],
  ['crate dispenses to empty hands', 'crate:lettuce', null, null, 'dispense'],

  // A sink washes plates. It is not a shelf.
  ['sink refuses loose food', 'sink', null, ing('tomato'), 'none'],
  ['sink refuses a clean plate', 'sink', null, plate(false), 'none'],
  ['sink takes a dirty plate', 'sink', null, plate(true), 'place'],

  // The pan stays on the heat; the plate comes to it.
  ['burner will not hand over its pan', 'stove', pan(), null, 'none'],
  ['burner takes an ingredient', 'stove', pan(), ing('bacon'), 'combine'],

  // Boards: hold to chop what can be chopped, plain pick-up for what cannot.
  // The second case is the soft-lock guard — without it a bun on a board is
  // stuck there forever, because nothing advances a chop with chopSeconds 0.
  ['board offers prep for choppables', 'board', ing('tomato'), null, 'prep'],
  ['board hands back what it cannot cut', 'board', ing('bun'), null, 'take'],

  // The general-purpose surface still takes anything.
  ['counter takes anything', 'counter', null, ing('bun'), 'place'],
];

let failed = 0;
console.log('\n=== station plans');
for (const [label, kindSpec, holding, carrying, expected] of CASES) {
  const [kind, dispenses] = kindSpec.split(':');
  const st = stationOf(kind, dispenses);
  if (!st) {
    console.log(`  ?? ${label.padEnd(34)} no '${kindSpec}' station in the level`);
    failed++;
    continue;
  }
  const prev = st.holding;
  st.holding = holding;
  chef.carrying = carrying;
  const got = planGrab(s, chef, st);
  st.holding = prev;
  chef.carrying = null;
  const ok = got === expected;
  if (!ok) failed++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label.padEnd(34)} expected '${expected}', got '${got}'`);
}

/**
 * ONE TAP CHOPS — the behavioural claim, not just the plan word.
 *
 * Chopping used to require holding the button. A tap now commits the chef and
 * the job runs to completion with NO further input, which is the only gesture a
 * player finds without being told. This drives the real step() loop and asserts
 * three things a plan lookup cannot: the press sets the commitment, progress
 * happens on ticks where the input is empty, and the commitment releases itself
 * when the food is cut.
 */
{
  const { step } = await import(path.join(OUT, 'sim.js'));
  const t = createSim(4242);
  const player = t.chefs[0];
  const board = t.kitchen.stations.find((st) => st.kind === 'board');
  // Stand the chef on the board's working side and give it something to cut.
  board.holding = { type: 'ingredient', ingredient: { kind: 'tomato', state: 'raw', chop: 0 } };
  player.pos = { x: board.cell.x + 0.5 + board.facing.x, y: board.cell.y + 0.5 + board.facing.y };
  player.vel = { x: 0, y: 0 };
  player.carrying = null;

  const idle = { move: { x: 0, y: 0 }, grabPressed: false, useHeld: false, dashPressed: false };
  const inputs = t.chefs.map(() => ({ ...idle, move: { x: 0, y: 0 } }));
  // One tap.
  inputs[0] = { move: { x: 0, y: 0 }, grabPressed: true, useHeld: false, dashPressed: false };
  step(t, inputs);
  const committed = player.working !== null;
  // ...and nothing else, ever again. Note move is a hard zero every tick: if
  // the chop only advanced while a button was held, this loop would never end.
  inputs[0] = { move: { x: 0, y: 0 }, grabPressed: false, useHeld: false, dashPressed: false };
  let ticks = 0;
  while (ticks < 300 && board.holding?.ingredient?.state === 'raw') {
    step(t, inputs);
    ticks++;
  }
  const cut = board.holding?.ingredient?.state === 'prepped';
  const secs = (ticks / 60).toFixed(2);
  // The loop above exits the instant the food is cut; the commitment is
  // released at the top of the FOLLOWING tick, so give it that tick. What
  // matters to the player is not the flag, it is that the stick answers again —
  // so the real assertion is that the chef moves when told to.
  step(t, inputs);
  const released = player.working === null;
  const before = { x: player.pos.x, y: player.pos.y };
  const walk = t.chefs.map(() => ({ ...idle, move: { x: 0, y: 0 } }));
  walk[0] = { move: { x: 0, y: 1 }, grabPressed: false, useHeld: false, dashPressed: false };
  for (let i = 0; i < 20; i++) step(t, walk);
  const moved = Math.hypot(player.pos.x - before.x, player.pos.y - before.y) > 0.2;

  console.log('\n=== one tap, then hands off');
  for (const [label, ok, extra] of [
    ['tap commits the chef', committed, ''],
    ['chop completes with no held button', cut, ` after ${secs}s`],
    ['commitment releases itself', released, ''],
    ['the chef can walk away afterwards', moved, ''],
  ]) {
    if (!ok) failed++;
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${extra}`);
  }
}

/**
 * THE BURNER COOKS, THEN BURNS — AND THE DIAL HAS SOMETHING TO SHOW.
 *
 * The second playtest asked for progress on cooking as well as chopping: "I
 * have no idea when the food is about to burn". The dial that answers it reads
 * `station.cook` and `station.burn`, and a capture run could not verify either
 * of them, because in 54 seconds of live bot play both burners sat at cook 0
 * for the whole run — the bots never cook. That is a gap in the BOTS, not in
 * the rules, and the distinction is only provable down here.
 *
 * So this drives a burner directly: bacon into the pan, and step until it is
 * cooked and then until it is ruined. It asserts the two numbers the dial is
 * drawn from actually move, in the right order, and reset when the food is
 * taken off the heat — which is the whole contract the ring depends on.
 */
{
  const { step } = await import(path.join(OUT, 'sim.js'));
  const t = createSim(99);
  const stove = t.kitchen.stations.find((st) => st.kind === 'stove');
  stove.holding = { type: 'pan', pan: { contents: [], onHeat: false, fire: 0 } };
  stove.holding.pan.contents.push({ kind: 'bacon', state: 'raw', chop: 0, progress: 0, overcook: 0 });
  const idle = { move: { x: 0, y: 0 }, grabPressed: false, useHeld: false, dashPressed: false };
  const inputs = t.chefs.map(() => ({ ...idle, move: { x: 0, y: 0 } }));

  let sawCookRise = false, cookAtHalf = 0, ticks = 0;
  while (ticks < 3000 && stove.holding.pan.contents[0].state === 'raw') {
    step(t, inputs);
    if (stove.cook > 0.01) sawCookRise = true;
    if (stove.cook > 0.4 && stove.cook < 0.6) cookAtHalf = stove.cook;
    ticks++;
  }
  const cooked = stove.holding.pan.contents[0].state === 'cooked';
  const cookSecs = (ticks / 60).toFixed(2);

  // ...and now it is sitting on a hot pan with nobody coming for it.
  let sawBurnRise = false, bticks = 0;
  while (bticks < 3000 && stove.holding.pan.contents[0].state === 'cooked') {
    step(t, inputs);
    if (stove.burn > 0.01) sawBurnRise = true;
    bticks++;
  }
  const burnt = stove.holding.pan.contents[0].state === 'burnt';
  const burnSecs = (bticks / 60).toFixed(2);

  // Off the heat, both readings must fall back to zero or the ring is a ghost.
  stove.holding = null;
  step(t, inputs);
  const cleared = stove.cook === 0 && stove.burn === 0;

  console.log('\n=== the burner, and the numbers the dial is drawn from');
  for (const [label, ok, extra] of [
    ['cook climbs off zero', sawCookRise, ''],
    ['cook passes through mid-sweep', cookAtHalf > 0, ` (${cookAtHalf.toFixed(2)})`],
    ['bacon reaches cooked', cooked, ` after ${cookSecs}s`],
    ['burn climbs once cooked', sawBurnRise, ''],
    ['cooked food does burn if left', burnt, ` after a further ${burnSecs}s`],
    ['both reset when the pan leaves', cleared, ''],
  ]) {
    if (!ok) failed++;
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${extra}`);
  }
}

/**
 * A TAP AT A RUN STOPS THE CHEF — REGRESSION, CAUGHT IN REVIEW.
 *
 * The committed branch in moveChef zeroes the STICK, and the deceleration that
 * a released stick relies on lives inside the branch it skips. So a chef who
 * tapped while still moving kept every unit per second they had, coasted out
 * past `reach`, and `stillWants` cancelled the job they had just started —
 * a one-tap chop that silently aborts, which is worse than the hold it replaced.
 *
 * The tap here happens at full cruise on approach, which is how it happens in
 * a real service; nobody walks up to a board and stops first.
 */
{
  const { step } = await import(path.join(OUT, 'sim.js'));
  const t = createSim(7171);
  const player = t.chefs[0];
  const board = t.kitchen.stations.find((st) => st.kind === 'board');
  board.holding = { type: 'ingredient', ingredient: { kind: 'tomato', state: 'raw', chop: 0 } };
  player.pos = { x: board.cell.x + 0.5 + board.facing.x, y: board.cell.y + 0.5 + board.facing.y };
  player.carrying = null;
  // Running, not standing: straight out from the board at cruise.
  player.vel = { x: board.facing.x * 4, y: board.facing.y * 4 };

  const idle = { move: { x: 0, y: 0 }, grabPressed: false, useHeld: false, dashPressed: false };
  const inputs = t.chefs.map(() => ({ ...idle, move: { x: 0, y: 0 } }));
  inputs[0] = { move: { x: 0, y: 0 }, grabPressed: true, useHeld: false, dashPressed: false };
  step(t, inputs);
  inputs[0] = { ...idle, move: { x: 0, y: 0 } };

  let ticks = 0;
  while (ticks < 300 && player.working !== null && board.holding?.ingredient?.state === 'raw') {
    step(t, inputs);
    ticks++;
  }
  const cut = board.holding?.ingredient?.state === 'prepped';
  const drift = Math.hypot(
    player.pos.x - (board.cell.x + 0.5 + board.facing.x),
    player.pos.y - (board.cell.y + 0.5 + board.facing.y),
  );

  console.log('\n=== tapping while still moving');
  for (const [label, ok, extra] of [
    ['the job survives the coast', cut, ''],
    ['the chef comes to rest', Math.hypot(player.vel.x, player.vel.y) < 0.2, ''],
    ['and does not slide out of reach', drift < 0.6, ` (drifted ${drift.toFixed(2)})`],
  ]) {
    if (!ok) failed++;
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${extra}`);
  }
}

/**
 * A BURNT PAN CAN STILL BE CLEARED — REGRESSION, CAUGHT IN REVIEW.
 *
 * "A pan is fixture, not luggage" is right for a working burner and wrong for a
 * ruined one. Nothing else in the kitchen can empty a pan in place: the bin
 * only discards the contents of a pan you are CARRYING, and the plate `load`
 * rung only ever moves items in state 'cooked'. So refusing the pan
 * unconditionally left burnt food welded to the burner, ticking `pan.fire`
 * toward a fire that never stops, with bots/brain.ts's own `rescue`-priority
 * "clear the burnt pan" job resolving to a press that does nothing. Two burners
 * lost that way and no cooked recipe is fillable for the rest of the service.
 */
{
  const t = createSim(313);
  const chef = t.chefs[0];
  const stove = t.kitchen.stations.find((st) => st.kind === 'stove');
  chef.carrying = null;

  stove.holding = { type: 'pan', pan: { contents: [], onHeat: false, fire: 0 } };
  const good = planGrab(t, chef, stove);

  stove.holding.pan.contents.push({ kind: 'bacon', state: 'burnt', chop: 0, progress: 1, overcook: 9 });
  const spoiled = planGrab(t, chef, stove);
  chef.carrying = null;

  console.log('\n=== the burner is not a one-way trip');
  for (const [label, ok, extra] of [
    ['a working pan stays put', good === 'none', ` (got '${good}')`],
    ['a burnt pan can be lifted off', spoiled === 'take', ` (got '${spoiled}')`],
  ]) {
    if (!ok) failed++;
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${extra}`);
  }
}

// The chopSeconds split the board cases above depend on, stated outright so a
// menu change that makes bacon choppable shows up here rather than as a bug.
console.log('\n=== chopSeconds (0 means the board can only hand it back)');
for (const k of ['tomato', 'lettuce', 'bacon', 'bun']) {
  console.log(`  ${k.padEnd(8)} ${INGREDIENT_DEFS[k].chopSeconds}`);
}

fs.rmSync(OUT, { recursive: true, force: true });
console.log(failed ? `\nFAIL: ${failed} plan(s) wrong` : '\nPASS: every station plan is what it should be');
process.exit(failed ? 1 : 0);
