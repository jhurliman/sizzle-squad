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
import { compileDomain, makeReport, NO_INPUT } from './domainkit.mjs';

const kit = compileDomain(['src/domain/sim.ts']);
const { createSim, planGrab, step, SIM_DT } = await kit.load('domain/sim');
const { INGREDIENT_DEFS } = await kit.load('domain/content');

const s = createSim({ seed: 20260818 });
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
const R = makeReport();
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
    const t = createSim({ seed: 4242 });
  const player = t.chefs[0];
  const board = t.kitchen.stations.find((st) => st.kind === 'board');
  // Stand the chef on the board's working side and give it something to cut.
  board.holding = { type: 'ingredient', ingredient: { kind: 'tomato', state: 'raw', chop: 0 } };
  player.pos = { x: board.cell.x + 0.5 + board.facing.x, y: board.cell.y + 0.5 + board.facing.y };
  player.vel = { x: 0, y: 0 };
  player.carrying = null;

  const idle = { move: { x: 0, y: 0 }, grabPressed: false, useHeld: false };
  const inputs = t.chefs.map(() => ({ ...idle, move: { x: 0, y: 0 } }));
  // One tap.
  inputs[0] = { move: { x: 0, y: 0 }, grabPressed: true, useHeld: false };
  step(t, inputs);
  const committed = player.working !== null;
  // ...and nothing else, ever again. Note move is a hard zero every tick: if
  // the chop only advanced while a button was held, this loop would never end.
  inputs[0] = { move: { x: 0, y: 0 }, grabPressed: false, useHeld: false };
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
  walk[0] = { move: { x: 0, y: 1 }, grabPressed: false, useHeld: false };
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
    const t = createSim({ seed: 99 });
  const stove = t.kitchen.stations.find((st) => st.kind === 'stove');
  stove.holding = { type: 'pan', pan: { contents: [], onHeat: false, fire: 0 } };
  stove.holding.pan.contents.push({ kind: 'bacon', state: 'raw', chop: 0, progress: 0, overcook: 0 });
  const idle = { move: { x: 0, y: 0 }, grabPressed: false, useHeld: false };
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
    const t = createSim({ seed: 7171 });
  const player = t.chefs[0];
  const board = t.kitchen.stations.find((st) => st.kind === 'board');
  board.holding = { type: 'ingredient', ingredient: { kind: 'tomato', state: 'raw', chop: 0 } };
  player.pos = { x: board.cell.x + 0.5 + board.facing.x, y: board.cell.y + 0.5 + board.facing.y };
  player.carrying = null;
  // Running, not standing: straight out from the board at cruise.
  player.vel = { x: board.facing.x * 4, y: board.facing.y * 4 };

  const idle = { move: { x: 0, y: 0 }, grabPressed: false, useHeld: false };
  const inputs = t.chefs.map(() => ({ ...idle, move: { x: 0, y: 0 } }));
  inputs[0] = { move: { x: 0, y: 0 }, grabPressed: true, useHeld: false };
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
 *
 * The escape hatch has since shrunk twice — first from lifting the PAN to
 * taking the ruined FOOD, then from taking it to scraping it out where you
 * stand — but the invariant under all three versions is the same and is what
 * this asserts: an empty-handed press at a ruined burner must DO something.
 */
{
  const t = createSim({ seed: 313 });
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
    ['a burnt pan can be cleared where it stands', spoiled === 'discard', ` (got '${spoiled}')`],
  ]) {
    if (!ok) failed++;
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${extra}`);
  }
}

/**
 * THE INVARIANT ALL THREE SHIPPED BUGS BROKE — AND THE ONLY ONE WORTH HAVING.
 *
 * Wave 3 and wave 4 leaked three rule bugs to a real player. Written out, they
 * look like three unrelated mistakes:
 *
 *   - a bun on a chopping board offered 'prep', and nothing could advance a
 *     chop on something with chopSeconds 0, so the bun and the board were gone
 *   - a crate offered 'return' for ANY ingredient and deleted it
 *   - a burner refused every press once its pan held burnt food
 *
 * They are one bug in three costumes: THE BUTTON SAID SOMETHING WOULD HAPPEN
 * AND NOTHING DID, or the reverse — nothing was offered and the object was
 * stranded. Both are the same broken promise between `planGrab`, which decides
 * what the prompt says, and `step`, which decides what actually happens.
 *
 * So rather than three more special cases, this sweeps EVERY station in the
 * real level against every shape of thing a chef can be holding, and asserts
 * the promise directly, by pressing the real button through the real `step`:
 *
 *   1. a plan of 'none' must leave the world alone   (no silent deletions)
 *   2. any other plan MUST change the world          (no dead presses)
 *
 * A press that changes nothing is a soft-lock waiting for the object that gets
 * stuck under it. Nothing here knows what a pan or a bun is, so it keeps
 * working when the menu changes.
 */
{
  const hands = () => [
    ['empty handed', null],
    ['raw tomato', { type: 'ingredient', ingredient: { kind: 'tomato', state: 'raw', chop: 0 } }],
    ['chopped tomato', { type: 'ingredient', ingredient: { kind: 'tomato', state: 'prepped', chop: 1 } }],
    ['raw bun', { type: 'ingredient', ingredient: { kind: 'bun', state: 'raw', chop: 0 } }],
    ['cooked bacon', { type: 'ingredient', ingredient: { kind: 'bacon', state: 'cooked', chop: 0, progress: 1, overcook: 0 } }],
    ['burnt bacon', { type: 'ingredient', ingredient: { kind: 'bacon', state: 'burnt', chop: 0, progress: 1, overcook: 9 } }],
    ['clean plate', { type: 'plate', plate: { contents: [], dirty: false } }],
    ['dirty plate', { type: 'plate', plate: { contents: [], dirty: true } }],
    ['loaded plate', { type: 'plate', plate: { contents: [{ kind: 'tomato', state: 'prepped', chop: 1 }], dirty: false } }],
    ['empty pan', { type: 'pan', pan: { contents: [], onHeat: false, fire: 0 } }],
  ];
  // What the station may be holding when the press lands. `undefined` means
  // "leave whatever the level seeded there".
  const sitting = () => [
    ['as built', undefined],
    ['nothing', null],
    ['a raw tomato', { type: 'ingredient', ingredient: { kind: 'tomato', state: 'raw', chop: 0 } }],
    ['a bun', { type: 'ingredient', ingredient: { kind: 'bun', state: 'raw', chop: 0 } }],
    ['a dirty plate', { type: 'plate', plate: { contents: [], dirty: true } }],
    ['a pan of burnt bacon', { type: 'pan', pan: { contents: [{ kind: 'bacon', state: 'burnt', chop: 0, progress: 1, overcook: 9 } ], onHeat: false, fire: 0 } }],
  ];

  /**
   * A PRESS IS JUDGED AGAINST NOT PRESSING — NOT AGAINST THE PAST.
   *
   * The first cut of this diffed the world before and after `step`, and it
   * accused the game of two things it had not done. `step` advances the WHOLE
   * simulation: pans cook, fires spread, tickets expire, patience drains. So a
   * plan of 'none' that legitimately did nothing still showed a changed world,
   * because three seconds of stew had moved on underneath it.
   *
   * The honest comparison is the counterfactual. Two sims, same seed, same
   * setup — therefore bit-identical, because `src/domain` is pure — stepped on
   * the same tick, one with the button and one without. Whatever differs is
   * the press and nothing else.
   */
  const stateSig = (t) =>
    JSON.stringify([
      t.chefs.map((c) => [c.carrying, c.working]),
      t.kitchen.stations.map((x) => [x.holding, x.work]),
      t.score,
      t.orders.map((o) => o.id),
    ]);

  /**
   * TWO DIFFERENT QUESTIONS, SO TWO DIFFERENT SIGNATURES.
   *
   * A press that is REFUSED still talks to the player: `grabMiss` is the thunk
   * you hear when the button had nothing to do, and handing an empty plate to
   * the pass fires `serveWrong`, a louder and more specific answer. Both are
   * designed feedback, and they pull the two halves of this invariant apart:
   *
   *   - "it promised something" is satisfied by a change in state OR by any
   *     event other than the plain refusal — an audible answer is an answer
   *   - "it promised nothing" is about STATE only, because a refusal sound on
   *     a dead press is exactly right and must not count as a side effect
   *
   * Running both against the same signature is what made the first two cuts of
   * this sweep accuse the game of bugs it did not have.
   */
  const effectSig = (t) =>
    JSON.stringify([stateSig(t), t.events.map((e) => e.t).filter((k) => k !== 'grabMiss')]);

  // Identical ids matter: swapping a raw tomato for an indistinguishable raw
  // tomato is a real change the game made, and a signature that cannot see it
  // reports a working swap as a dead press. The level's own items are numbered
  // from `nextId`, so fixtures get numbers well clear of them.
  let fixtureId = 900000;
  const stamp = (o) => {
    if (!o) return null;
    const c = JSON.parse(JSON.stringify(o));
    if (c.ingredient) c.ingredient.id = fixtureId++;
    if (c.plate) {
      c.plate.id = fixtureId++;
      for (const i of c.plate.contents) i.id = fixtureId++;
    }
    if (c.pan) {
      c.pan.id = fixtureId++;
      for (const i of c.pan.contents) i.id = fixtureId++;
    }
    return c;
  };

  /** Build one case identically every time, so two copies are the same world. */
  const setup = (stationIndex, hand, sit, seedFixtureId) => {
    fixtureId = seedFixtureId;
    const t = createSim({ seed: 555 });
    const st = t.kitchen.stations[stationIndex];
    const chef = t.chefs[0];
    if (sit !== undefined) st.holding = stamp(sit);
    chef.carrying = stamp(hand);
    chef.working = null;
    chef.vel = { x: 0, y: 0 };
    chef.pos = { x: st.cell.x + 0.5 + st.facing.x, y: st.cell.y + 0.5 + st.facing.y };
    chef.heading = Math.atan2(-st.facing.y, -st.facing.x);
    return { t, st, chef };
  };

  let dead = 0;
  let ghost = 0;
  let pressed = 0;
  const deadEg = [];
  const ghostEg = [];
  const nStations = createSim({ seed: 555 }).kitchen.stations.length;

  for (const [handLabel, hand] of hands()) {
    for (const [sitLabel, sit] of sitting()) {
      for (let i = 0; i < nStations; i++) {
        const FIX = 900000;
        const a = setup(i, hand, sit, FIX);
        const b = setup(i, hand, sit, FIX);

        /**
         * ASK ABOUT THE STATION THE GAME ACTUALLY PICKED.
         *
         * The first cut computed the plan for the bench the chef was POSED at
         * and assumed the press would land there. That held only because inert
         * stations still won focus: once a plan of 'none' stopped being a
         * candidate (see findFocus), standing at the sink empty-handed let a
         * lettuce crate two feet away take focus instead, and the press
         * correctly dispensed lettuce — which the sweep read as "a 'none' plan
         * changed the world". The rule was right and the question was wrong.
         *
         * So the promise is checked against the FOCUSED station, which is the
         * one the player sees lit and the only one the button can act on. One
         * settling tick with no input lets `step` choose it, exactly as it does
         * in play; both sims take that same tick, so they stay identical.
         */
        const settle = a.t.chefs.map(() => ({ ...NO_INPUT, move: { x: 0, y: 0 } }));
        step(a.t, settle);
        step(b.t, b.t.chefs.map(() => ({ ...NO_INPUT, move: { x: 0, y: 0 } })));
        const focused = a.t.kitchen.stations.find((x) => x.id === a.chef.focus) ?? null;
        const plan = focused ? planGrab(a.t, a.chef, focused) : 'none';

        const press = a.t.chefs.map(() => ({ ...NO_INPUT, move: { x: 0, y: 0 } }));
        press[0] = { ...NO_INPUT, move: { x: 0, y: 0 }, grabPressed: true };
        const quiet = b.t.chefs.map(() => ({ ...NO_INPUT, move: { x: 0, y: 0 } }));
        step(a.t, press);
        step(b.t, quiet);
        pressed++;

        const stateDiffers = stateSig(a.t) !== stateSig(b.t);
        const anyEffect = effectSig(a.t) !== effectSig(b.t);
        const at = focused ? `${focused.kind}${focused.dispenses ? ':' + focused.dispenses : ''}` : 'nothing focused';
        const where = `posed at ${a.st.kind} holding ${sitLabel}, ${handLabel}; focused ${at} -> '${plan}'`;
        if (plan === 'none' && stateDiffers) {
          ghost++;
          if (ghostEg.length < 5) ghostEg.push(where);
        } else if (plan !== 'none' && !anyEffect) {
          dead++;
          if (deadEg.length < 5) deadEg.push(where);
        }
      }
    }
  }

  R.section(`the button keeps its promise (${pressed} presses swept)`);
  R.check('no press does nothing when it promised something', dead === 0, dead ? `\n       ${deadEg.join('\n       ')}` : '');
  R.check("no press changes the world when it promised nothing", ghost === 0, ghost ? `\n       ${ghostEg.join('\n       ')}` : '');
}

/**
 * NOTHING LIGHTS UP THAT CANNOT BE USED.
 *
 * "Why are table positions like the sink even highlighting as interactive?
 * There's nothing you can do at the sink" — and there was not: the sink took
 * focus empty-handed and offered a press that did nothing. The glow is the
 * promise the player reads BEFORE they press, so it has to be held to the same
 * standard as the press itself.
 */
{
  const t = createSim({ seed: 606 });
  const chef = t.chefs[0];
  const idle = t.chefs.map(() => ({ ...NO_INPUT, move: { x: 0, y: 0 } }));
  let litButDead = 0;
  let everLit = 0;
  const examples = [];

  // Stand at every station in turn, empty-handed, and see what lights up.
  for (const st of t.kitchen.stations) {
    chef.carrying = null;
    chef.working = null;
    chef.vel = { x: 0, y: 0 };
    chef.pos = { x: st.cell.x + 0.5 + st.facing.x, y: st.cell.y + 0.5 + st.facing.y };
    chef.heading = Math.atan2(-st.facing.y, -st.facing.x);
    step(t, idle);
    const lit = t.kitchen.stations.find((x) => x.id === chef.focus);
    if (!lit) continue;
    everLit++;
    if (planGrab(t, chef, lit) === 'none') {
      litButDead++;
      if (examples.length < 4) examples.push(`${lit.kind} lit with nothing to do`);
    }
  }

  R.section('the glow is a promise too');
  R.check(
    `nothing highlights that the button would refuse (${everLit} stations lit)`,
    litButDead === 0,
    litButDead ? `\n       ${examples.join('\n       ')}` : '',
  );
  // Guards the check above from passing by lighting nothing at all.
  R.check('and the useful ones still light up', everLit > 0, ` (${everLit})`);
}

/**
 * THE PAN STAYS ON THE HEAT; THE RUINED FOOD COMES OFF.
 *
 * The burnt-pan rescue used to hand you the whole pan, which was a mechanic
 * with no other use and no explanation — "I don't get this mechanic of the
 * game at all". Now the press hands you the burnt rasher and leaves the pan
 * where it was, so nothing but food and plates is ever carried.
 */
{
  const t = createSim({ seed: 707 });
  const chef = t.chefs[0];
  const stove = t.kitchen.stations.find((st) => st.kind === 'stove');
  stove.holding = {
    type: 'pan',
    pan: {
      contents: [
        { id: 1, kind: 'bacon', state: 'burnt', chop: 0, progress: 1, overcook: 9 },
        { id: 2, kind: 'bacon', state: 'cooked', chop: 0, progress: 1, overcook: 0 },
      ],
      onHeat: true,
      fire: 0.7,
    },
  };
  chef.carrying = null;
  chef.working = null;
  chef.vel = { x: 0, y: 0 };
  chef.pos = { x: stove.cell.x + 0.5 + stove.facing.x, y: stove.cell.y + 0.5 + stove.facing.y };
  chef.heading = Math.atan2(-stove.facing.y, -stove.facing.x);

  const inputs = t.chefs.map(() => ({ ...NO_INPUT, move: { x: 0, y: 0 } }));
  inputs[0] = { ...NO_INPUT, move: { x: 0, y: 0 }, grabPressed: true };
  step(t, inputs);

  const held = chef.carrying;
  const pan = stove.holding?.pan;
  R.section('clearing a ruined pan');
  R.check('the pan stays on the burner', stove.holding?.type === 'pan', ` (station holds ${stove.holding?.type ?? 'nothing'})`);
  // NOTHING ENDS UP IN YOUR HANDS. The ruined rasher used to be handed over to
  // be walked to the bin, and it came back from play as an unidentifiable grey
  // object ("it looks like I picked up a small pan/skillet"). One press now
  // does the whole job on the spot, so the test of success is that the burner
  // is clean AND the chef is still empty-handed.
  R.check('the burnt food is gone from the pan', !!pan && !pan.contents.some((i) => i.state === 'burnt'), '');
  R.check('your hands stay empty', !held, ` (got ${held?.type ?? 'nothing'})`);
  R.check('the good food is left alone', !!pan && pan.contents.length === 1 && pan.contents[0].state === 'cooked', '');
  R.check('and the fire goes out with the fuel', !!pan && pan.fire === 0, ` (fire ${pan?.fire})`);
  R.check('a pan is never a thing you can hold', held?.type !== 'pan', '');
}

// The chopSeconds split the board cases above depend on, stated outright so a
// menu change that makes bacon choppable shows up here rather than as a bug.
console.log('\n=== chopSeconds (0 means the board can only hand it back)');
for (const k of ['tomato', 'lettuce', 'bacon', 'bun']) {
  console.log(`  ${k.padEnd(8)} ${INGREDIENT_DEFS[k].chopSeconds}`);
}

kit.cleanup();
failed += R.failed;
console.log(failed ? `\nFAIL: ${failed} rule(s) wrong` : '\nPASS: every station plan is what it should be');
process.exit(failed ? 1 : 0);
