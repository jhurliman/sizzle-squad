/**
 * DOES THE KITCHEN STILL WORK? — full services, many seeds, no browser.
 *
 *   node tools/soak.mjs [--seeds 12] [--seconds 180]
 *
 * planprobe asks the rules direct questions and gets exact answers. It can only
 * ask about bugs somebody thought of. This asks the one question that catches
 * the bugs nobody thought of: run the real game, with the real bots, for a full
 * service, and see whether dinner still gets served.
 *
 * THE BUG THIS EXISTS FOR. Wave 4 shipped a rule that refused to let a chef
 * lift a pan off a burner. Correct for a working pan; for a pan with burnt food
 * in it, it welded the burner shut, because nothing else in the game can empty
 * a pan in place. Both burners died a few minutes into every service and every
 * cooked recipe became unfillable. Every screenshot still looked perfect, the
 * typecheck was clean, and the reviewer who caught it was a bot reading a diff.
 *
 * What that bug DID show up as, unmistakably, is this:
 *
 *     dishes served   17 -> 7          max cook   0.833 -> 0.000
 *
 * So those are the assertions. They are outcome measures, not rule checks: they
 * do not know what a pan is, and they would have failed anyway.
 *
 * src/domain is pure by policy and src/bots imports nothing else, so all of
 * this runs in Node in a couple of seconds. See tools/domainkit.mjs.
 *
 * Exits non-zero on any failure, so it can gate a deploy.
 */
import { compileDomain, makeReport, NO_INPUT } from './domainkit.mjs';

const argv = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1]]);
    return acc;
  }, []),
);
const SEEDS = Number(argv.seeds ?? 12);
const SECONDS = Number(argv.seconds ?? 180);

/**
 * MEASURED, NOT GUESSED — and deliberately slack.
 *
 * Over 24 seeds on the build these were written against, `served` ran 14 to 19
 * with a median of 16, and every single seed drove a burner (max cook 1.00).
 * The floor is 10: comfortably under the worst honest run, comfortably over the
 * 7 the burnt-pan bug produced. A regression test that fires on ordinary
 * variance gets muted within a week, so the gap is the point.
 *
 * SINCE THE DASH WAS REMOVED the distribution sits a little lower and a little
 * wider — 11 to 20, median 15 over 12 seeds — because bots dashed on every long
 * leg and now walk them. That is the mechanic being gone, not the kitchen
 * breaking, and the floor is deliberately left at 10 rather than re-baselined
 * down to hug it: it still separates "a service happened" from "a service did
 * not", which is the only thing it is for. Worth knowing that the worst seed is
 * now one dish clear of it rather than three, so a genuinely marginal future
 * regression will show up here as a flap before it shows up as a failure.
 */
const SERVED_FLOOR = 10;

const kit = compileDomain(['src/domain/sim.ts', 'src/bots/brain.ts']);
const { createSim, seedPans, step, planGrab, SIM_DT } = await kit.load('domain/sim');
const { BotDirector } = await kit.load('bots/brain');
const R = makeReport();

const finite = (n) => typeof n === 'number' && Number.isFinite(n);

/** One full service. Returns everything the assertions below need. */
function service(seed, seconds) {
  const s = createSim({ seed });
  seedPans(s);
  const bots = new BotDirector();
  const ticks = Math.round(seconds / SIM_DT);
  const startPos = s.chefs.map((c) => ({ x: c.pos.x, y: c.pos.y }));
  const walked = s.chefs.map(() => 0);
  let maxCook = 0;
  let maxBurn = 0;
  let bad = null;

  for (let i = 0; i < ticks && !s.over; i++) {
    const prev = s.chefs.map((c) => ({ x: c.pos.x, y: c.pos.y }));
    const inputs = bots.update(s, SIM_DT);
    step(
      s,
      s.chefs.map((c) => inputs.get(c.id) ?? NO_INPUT),
    );
    s.chefs.forEach((c, n) => {
      if (!c.isPlayer) walked[n] += Math.hypot(c.pos.x - prev[n].x, c.pos.y - prev[n].y);
      if (!bad && !(finite(c.pos.x) && finite(c.pos.y) && finite(c.vel.x) && finite(c.vel.y)))
        bad = `chef ${c.id} pos/vel non-finite at t=${s.time.toFixed(1)}`;
    });
    for (const st of s.kitchen.stations) {
      if (st.cook > maxCook) maxCook = st.cook;
      if (st.burn > maxBurn) maxBurn = st.burn;
      if (!bad && !(finite(st.work) && finite(st.cook) && finite(st.burn)))
        bad = `station ${st.id} (${st.kind}) work/cook/burn non-finite at t=${s.time.toFixed(1)}`;
    }
    // Events accumulate for the renderer to drain; nothing drains them here.
    s.events.length = 0;
  }
  return { s, maxCook, maxBurn, walked, startPos, bad };
}

/**
 * NO BLACK HOLES — the general shape of the burnt-pan bug.
 *
 * A station holding something must be a station SOMEBODY can act on. This asks
 * it the honest way: for each station left holding an item at the end of the
 * service, is there any hand — empty, or carrying each of the things a chef can
 * carry — for which the button does something? If every answer is 'none', that
 * object and that bench are out of the game for good.
 */
function blackHoles(s) {
  const chef = s.chefs[0];
  const saved = chef.carrying;
  const hands = [
    null,
    { type: 'ingredient', ingredient: { kind: 'tomato', state: 'raw', chop: 0 } },
    { type: 'ingredient', ingredient: { kind: 'tomato', state: 'prepped', chop: 1 } },
    { type: 'plate', plate: { contents: [], dirty: false } },
    { type: 'plate', plate: { contents: [], dirty: true } },
    { type: 'pan', pan: { contents: [], onHeat: false, fire: 0 } },
  ];
  const stuck = [];
  for (const st of s.kitchen.stations) {
    if (!st.holding) continue;
    let reachable = false;
    for (const h of hands) {
      chef.carrying = h;
      if (planGrab(s, chef, st) !== 'none') {
        reachable = true;
        break;
      }
    }
    if (!reachable) stuck.push(`${st.kind}@${st.cell.x},${st.cell.y} holding ${st.holding.type}`);
  }
  chef.carrying = saved;
  return stuck;
}

console.log(`\nsoak: ${SEEDS} seeds x ${SECONDS}s of real play (bots driving)\n`);

const runs = [];
for (let i = 0; i < SEEDS; i++) {
  const seed = 1000 + i * 7919;
  const r = service(seed, SECONDS);
  const stuck = blackHoles(r.s);
  runs.push({ seed, ...r, stuck });
  console.log(
    `  seed ${String(seed).padEnd(7)} served ${String(r.s.score.served).padStart(2)}  ` +
      `missed ${String(r.s.score.missed).padStart(2)}  maxCook ${r.maxCook.toFixed(2)}  ` +
      `maxBurn ${r.maxBurn.toFixed(2)}  patience ${r.s.score.patience.toFixed(2)}` +
      (stuck.length ? `  STUCK: ${stuck.join('; ')}` : ''),
  );
}

const served = runs.map((r) => r.s.score.served);
const worst = Math.min(...served);
const cookless = runs.filter((r) => r.maxCook <= 0);
const anyStuck = runs.filter((r) => r.stuck.length);
const nonFinite = runs.filter((r) => r.bad);
// Chef 0 is the PLAYER and nothing drives it here, so it correctly stands
// still all service; only the bot chefs are expected to walk. A bot that
// never moves is a bot wedged on geometry or stuck in a plan loop.
const idle = runs.filter((r) => r.s.chefs.some((c, n) => !c.isPlayer && r.walked[n] < 5));

R.section('the service runs');
R.check(
  'every seed serves food',
  worst >= SERVED_FLOOR,
  ` (worst ${worst}, floor ${SERVED_FLOOR}, median ${[...served].sort((a, b) => a - b)[runs.length >> 1]})`,
);
R.check(
  'every seed uses a burner',
  cookless.length === 0,
  cookless.length ? ` (${cookless.length} seed(s) never cooked: ${cookless.map((r) => r.seed).join(',')})` : '',
);
R.check(
  'no station ends up a black hole',
  anyStuck.length === 0,
  anyStuck.length ? ` (${anyStuck.map((r) => r.seed).join(',')})` : '',
);
R.check('every bot walks the kitchen', idle.length === 0, idle.length ? ` (seeds ${idle.map((r) => r.seed).join(',')})` : '');
R.check('no NaN or Infinity anywhere', nonFinite.length === 0, nonFinite.length ? ` (${nonFinite[0].bad})` : '');

/**
 * THE SAME SEED TWICE IS THE SAME SERVICE.
 *
 * AGENTS.md forbids `Date.now()` and unseeded `Math.random()` anywhere under
 * src/domain, and the entire reason the rest of this file can exist — a whole
 * game running in Node with no browser — is that the rule has been kept. Until
 * now nothing enforced it. One stray wall-clock call would not fail a
 * typecheck, would not fail a screenshot, and would quietly make every other
 * test on this page flaky rather than false, which is the worst way to lose a
 * test suite.
 */
R.section('determinism (the purity rule, enforced)');
{
  /**
   * THE WHOLE STATE, NOT A CORNER OF IT.
   *
   * The first cut compared the final score and the chef positions. That is a
   * keyhole: a wall clock reaching into ticket creation, station bookkeeping,
   * id allocation or the heat ramp moves none of those two things on a 60s run,
   * so the check would sit there green while the purity rule it exists to
   * defend was already broken. `SimState` is plain data end to end — the only
   * non-serialisable field is the seeded `rand` closure, which JSON drops by
   * itself — so there is no reason to compare anything less than all of it.
   */
  const fullSig = (t) => JSON.stringify(t);

  const a = service(4242, 60);
  const b = service(4242, 60);
  const same = fullSig(a.s) === fullSig(b.s);
  let firstDiff = '';
  if (!same) {
    // Point at the field that moved rather than dumping 7KB of JSON at whoever
    // has to fix this: a purity bug is much easier to find with a name attached.
    for (const k of Object.keys(a.s)) {
      if (JSON.stringify(a.s[k]) !== JSON.stringify(b.s[k])) {
        firstDiff = ` (first divergence: '${k}')`;
        break;
      }
    }
  }
  R.check('one seed, two runs, identical in EVERY field', same, firstDiff);

  const c = service(9001, 60);
  R.check('and a different seed is a different service', fullSig(c.s) !== fullSig(a.s), '');
}

/**
 * ...AND A DIRECT GUARD, BECAUSE RUNNING IT TWICE IS NOT ENOUGH.
 *
 * The comparison above is necessary and it is not sufficient, which a review
 * caught by proposing exactly the right counter-example: put
 * `Math.floor(Date.now() / 1000)` in ticket creation and the two runs still
 * match — they execute milliseconds apart, so the wall clock hands them the
 * same number. Tried it; the check stayed green. A clock only shows up as
 * nondeterminism if you wait, and a test that has to wait a second to be
 * correct is a test that gets deleted.
 *
 * So the clock is caught where it can actually be seen: in the source. This is
 * the AGENTS.md purity rule read literally — no wall clock and no unseeded
 * randomness anywhere the simulation lives — and it is what makes every other
 * assertion on this page trustworthy rather than merely usually-true.
 *
 * Comments are stripped first. These files argue with themselves at length
 * about `Date.now()` and `Math.random()`, and a guard that cannot tell prose
 * from code would fire on its own documentation.
 */
R.section('purity (no wall clock, no unseeded randomness)');
{
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { ROOT } = await import('./domainkit.mjs');
  const BANNED = [
    [/\bDate\s*\.\s*now\s*\(/, 'Date.now()'],
    [/\bnew\s+Date\s*\(/, 'new Date()'],
    [/\bperformance\s*\.\s*now\s*\(/, 'performance.now()'],
    [/\bMath\s*\.\s*random\s*\(/, 'Math.random()'],
  ];
  const walk = (dir, out = []) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const f = path.join(dir, e.name);
      if (e.isDirectory()) walk(f, out);
      else if (e.name.endsWith('.ts')) out.push(f);
    }
    return out;
  };
  const strip = (src) =>
    src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .map((l) => l.replace(/\/\/.*$/, ''))
      .join('\n');

  const offences = [];
  const roots = ['src/domain', 'src/bots'].map((r) => path.join(ROOT, r));
  let scanned = 0;
  for (const root of roots) {
    for (const file of walk(root)) {
      scanned++;
      const code = strip(fs.readFileSync(file, 'utf8'));
      code.split('\n').forEach((line, i) => {
        for (const [re, name] of BANNED) {
          if (re.test(line)) offences.push(`${path.relative(ROOT, file)}:${i + 1}  ${name}`);
        }
      });
    }
  }
  R.check(
    `no wall clock or unseeded randomness in the simulation (${scanned} files scanned)`,
    offences.length === 0,
    offences.length ? `\n       ${offences.join('\n       ')}` : '',
  );
}

kit.cleanup();
process.exit(R.finish('the kitchen still works'));
