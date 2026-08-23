import { INGREDIENT_DEFS, PLATE_CAPACITY, RECIPES, TUNING, componentKey } from './content';
import { buildKitchen, isWalkable, stationById, stationCenter } from './kitchen';
import type {
  Carryable,
  Chef,
  Ingredient,
  InputSnapshot,
  Kitchen,
  Order,
  Pan,
  Plate,
  Recipe,
  ScoreState,
  SimEvent,
  Station,
  Vec2,
} from './types';
import { NO_INPUT } from './types';
import { filled, hypot } from './portable';

// --------------------------------------------------------------------- rng

/**
 * 32-bit multiply, low word — `Math.imul` spelled in plain arithmetic and
 * bitwise ops. Both factors stay under 2^49 so the f64 products are exact,
 * and every intermediate is reduced mod 2^32 by the trailing `| 0`, so this
 * returns bit-identical results to `Math.imul` in V8 and in bit32-compiled
 * Luau alike (signed/unsigned representation differs only by multiples of
 * 2^32, which the reductions erase).
 */
function imul(a: number, b: number): number {
  return ((a & 0xffff) * b + ((((a >>> 16) * b) & 0xffff) << 16)) | 0;
}

/** Deterministic PRNG so a seed reproduces an entire run exactly. */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = imul(a ^ (a >>> 15), 1 | a);
    t = (t + imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------- director

/**
 * LIVE-DIRECTOR KNOBS.
 *
 * The multiplayer port scales pacing by human count and skill — more humans
 * means faster tickets, brand-new players get gentler timers — WITHOUT
 * retuning the sim itself. Every knob defaults to exactly the shipped
 * single-player behavior; a sim that never touches `director` plays
 * identically to one built before this existed (the seeded-replay suite
 * enforces that). The knobs are re-read live, so an external director may
 * adjust them between ticks (the port's pressure director rubber-bands
 * `orderGapMul` a few percent every second).
 */
export interface DirectorKnobs {
  /** Scales the gap between order spawns. <1 = faster kitchen. */
  orderGapMul: number;
  /** Added to the concurrent-ticket cap. */
  maxOrdersBonus: number;
  /** Scales each NEW ticket's timer (existing tickets are untouched). */
  ticketTimeMul: number;
  /** Scales the patience cost of an expired ticket. */
  patienceMissMul: number;
  /** Scales how long cooked food sits before burning (assist: >1 is kinder). */
  burnTimeMul: number;
  /** Max recipe size (component count) the board may ask for. Infinity = all. */
  recipeDepthCap: number;
  /**
   * Coin multiplier for a dish whose plating was done by a bot chef —
   * leaderboard integrity in the port ("bots take a cut"). 1 = off.
   */
  botServeValueMul: number;
}

export const DEFAULT_DIRECTOR: DirectorKnobs = {
  orderGapMul: 1,
  maxOrdersBonus: 0,
  ticketTimeMul: 1,
  patienceMissMul: 1,
  burnTimeMul: 1,
  recipeDepthCap: Infinity,
  botServeValueMul: 1,
};

// ------------------------------------------------------------------- state

export interface SimState {
  tick: number;
  time: number;
  kitchen: Kitchen;
  chefs: Chef[];
  orders: Order[];
  score: ScoreState;
  events: SimEvent[];
  over: boolean;
  /** Seconds until the next ticket. */
  nextOrderIn: number;
  /** 0..1 ramp of how hard the run currently is. */
  heat: number;
  rand: (this: void) => number;
  nextId: number;
  /** Pacing knobs, all defaulted to shipped behavior. See DirectorKnobs. */
  director: DirectorKnobs;
  /** Cosmetic: distance walked since last footstep, per chef. */
  stepAccum: number[];
  /**
   * PER-PAIR CONTACT IMMUNITY, in seconds remaining, indexed `a * n + b`.
   *
   * One collision has to be one event. Measured before this existed
   * (tools/bumpprobe.mjs, two chefs head-on at cruise who both keep leaning in,
   * which is what a bot and a player do all day): a single encounter fired
   * between 7 and 10 separate bumps, and RAISING the knockback barely moved
   * that — 3.2 fired 10, 8.0 still fired 7. In the real room 75.7% of all bumps
   * re-hit the same chef inside a second. The impulse was never the mechanism.
   */
  contactLock: number[];
}

export const SIM_HZ = 60;
export const SIM_DT = 1 / SIM_HZ;

export interface SimOptions {
  seed?: number;
  botCount?: number;
}

export function createSim(opts: SimOptions = {}): SimState {
  const kitchen = buildKitchen();
  const rand = mulberry32(opts.seed ?? 1337);
  const botCount = opts.botCount ?? 2;
  const skins = ['bramble', 'pip', 'nori', 'mochi'];
  // Staggered in BOTH axes. Three chefs on the same row put one head straight
  // on top of another's torso from the game camera — at the opening frame
  // bramble and mochi collapsed into a single unreadable brown-and-orange
  // mass. No two of these share a camera-space column or a depth band.
  //
  // THE FOURTH SPAWN WAS INSIDE A CHOPPING BOARD.
  //
  // (6.5, 2.5) is cell (6,2), and KITCHEN_MAP row 2 is '#.....X.XD....#' — index
  // 6 is 'X'. main.ts ships `botCount: 3`, so EVERY run of this game started
  // with one of its four chefs embedded in a bench, both collision axes
  // rejected forever, standing at exactly v = 0.00 with a full input vector
  // pointing away from it for the entire service. A 170s trace has it at
  // (6.50, 2.50) at t=0 and still at (6.50, 2.50) at t=136, with its heading
  // wound up to 19485 degrees from spinning on the spot. The kitchen has been
  // playing a chef short since the map was last moved, and no screenshot could
  // show it because a stationary chef looks like a chef who is busy.
  //
  // Moved one row down the same column to (6.5, 3.5), which keeps the stagger
  // this list exists for — no two spawns share a camera-space column or a depth
  // band — and `safeSpawn` below now guarantees the class of bug rather than
  // this instance of it.
  const spawns: Vec2[] = [
    { x: 7.5, y: 8.6 },
    { x: 4.5, y: 6.5 },
    { x: 10.5, y: 4.5 },
    { x: 6.5, y: 3.5 },
  ];
  const chefs: Chef[] = [];
  for (let i = 0; i < 1 + botCount; i++) {
    chefs.push({
      id: i,
      isPlayer: i === 0,
      skin: skins[i % skins.length],
      pos: safeSpawn(kitchen, spawns[i % spawns.length]),
      vel: { x: 0, y: 0 },
      heading: -Math.PI / 2,
      carrying: null,
      intent: 'idle',
      focus: null,
      working: null,
      focusAction: 'none',
      grabBuffer: 0,
      focusHold: 0,
      stun: 0,
      effort: 0,
    });
  }

  const state: SimState = {
    tick: 0,
    time: 0,
    kitchen,
    chefs,
    orders: [],
    score: {
      coins: 0,
      combo: 0,
      bestCombo: 0,
      served: 0,
      missed: 0,
      patience: 1,
    },
    events: [],
    over: false,
    nextOrderIn: 1.2,
    heat: 0,
    rand,
    nextId: 1,
    director: { ...DEFAULT_DIRECTOR },
    stepAccum: chefs.map(() => 0),
    contactLock: filled(chefs.length * chefs.length, 0),
  };
  seedOrders(state);
  return state;
}

/**
 * Nearest point at which a chef's body actually fits, spiralling out from the
 * requested one. A spawn that overlaps a station cannot be recovered from by
 * anything downstream — both collision axes reject every candidate, corner slip
 * has no shallow escape because the body is fully inside, and the bot brain
 * cannot steer out of a sim that is refusing every input it can produce — so
 * the only safe place to catch it is here, before the run starts.
 *
 * Deterministic: fixed ring order, no rand, same map gives the same answer.
 */
function safeSpawn(k: Kitchen, want: Vec2): Vec2 {
  const r = TUNING.chefRadius;
  if (!collides(k, want.x, want.y, r)) return { ...want };
  for (let ring = 1; ring <= 6; ring++) {
    const step = 0.25 * ring;
    for (let a = 0; a < 16; a++) {
      const ang = (a / 16) * Math.PI * 2;
      const x = want.x + Math.cos(ang) * step;
      const y = want.y + Math.sin(ang) * step;
      if (!collides(k, x, y, r)) return { x, y };
    }
  }
  return { ...want };
}

// ------------------------------------------------------------------ helpers

function mkIngredient(s: SimState, kind: Ingredient['kind']): Ingredient {
  return { id: s.nextId++, kind, state: 'raw', progress: 0, overcook: 0 };
}

/**
 * A PLATE IS A PLATE.
 *
 * This used to hand out an ARMFUL: a seeded `stack` of 4-8 that the view drew
 * as the reference's comedy tower, taller than the chef carrying it. It was
 * cosmetic-only — no recipe, bot plan or serve check ever read it — and that
 * was exactly the problem, because a player cannot tell cosmetic-only by
 * looking:
 *
 *   "When I pick up a plate I get a huge stack of plates. Cute, but this is
 *    not how the gameplay works so we should cut it down to holding a single
 *    plate"
 *
 * A prop that implies a mechanic the game does not have costs more than the
 * joke earns. `stack` is gone from the type, from here, and from the five
 * places that had to remember to reset it.
 */
function mkPlate(s: SimState): Plate {
  return { id: s.nextId++, contents: [], dirty: false };
}

function mkPan(s: SimState): Pan {
  return { id: s.nextId++, contents: [], onHeat: false, fire: 0 };
}

function emit(s: SimState, e: SimEvent) {
  s.events.push(e);
}

function len(v: Vec2) {
  return hypot(v.x, v.y);
}

function angleDelta(a: number, b: number) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** Multiset key for a plate, so recipe matching ignores assembly order. */
export function plateKey(plate: Plate): string {
  return plate.contents
    .map((i) => componentKey(i.kind, i.state))
    .sort()
    .join('|');
}

export function recipeKey(recipe: Recipe): string {
  return recipe.components
    .map((c) => componentKey(c.kind, c.state))
    .sort()
    .join('|');
}

// -------------------------------------------------------------- movement

/**
 * HOW THE LOAD IN YOUR ARMS CHANGES HOW YOU MOVE — THREE TIERS, NOT TWO.
 *
 * This used to be a boolean: plate or pan = laden, anything else = empty. The
 * consequence was measurable and bad. tools/feelcrit.mjs, a 10-unit sprint:
 *
 *     empty        top 6.200   10u in 1.683s
 *     ingredient   top 6.200   10u in 1.683s    <- 0.00% different
 *     plate        top 5.084   10u in 2.067s       22.8% different
 *
 * Carrying a tomato was bit-for-bit identical to carrying nothing, and fetching
 * produce is what a chef spends most of a service doing. REFERENCE.md's feel bar
 * is "carrying changes how you move enough that you feel it", and the carry pose
 * is the loudest silhouette read the reference has — a character holding
 * something in front of them should not move like a character with free hands.
 *
 * Bounds are the two neighbours: at 1.00 it is under the ~10% Weber threshold
 * by definition (it IS zero), and at `carrySpeedMul` 0.82 produce would feel the
 * same as a full plate and the tiering would be pointless. Target the middle of
 * the gap and clear of threshold: 0.90 measures 10.9% on trip time, a third of
 * the plate's penalty. The accel channel carries the rest of the character, at
 * a third of the plate's stiffness — a tomato is a nudge in the wind-up, a
 * plate is a commitment.
 *
 * Turn rate is deliberately NOT touched for either tier; see `carryTurnMul` in
 * content.ts for the measured reason.
 */
interface CarryLoad {
  speed: number;
  accel: number;
  turn: number;
}
const LOAD_FREE: CarryLoad = { speed: 1, accel: 1, turn: 1 };

function carryLoad(chef: Chef): CarryLoad {
  const c = chef.carrying;
  if (!c) return LOAD_FREE;
  if (c.type === 'plate' || c.type === 'pan') {
    return { speed: TUNING.carrySpeedMul, accel: TUNING.carryAccelMul, turn: TUNING.carryTurnMul };
  }
  return { speed: TUNING.produceSpeedMul, accel: TUNING.produceAccelMul, turn: 1 };
}

/**
 * CORNER SLIP — the smallest lateral offset, within `TUNING.cornerSlip`, that
 * makes a rejected position legal. Returns 0 when there isn't one.
 *
 * This is the whole difference between a CORNER and a FACE, and it is decided
 * by geometry rather than by a special case: run at the long side of a bench
 * and no small sideways offset frees you, so you stop; clip the corner of one
 * and a few centimetres does, so you slide off it. Every candidate is
 * collision-tested in full before it is returned, so slip can never post a chef
 * somewhere they do not fit.
 *
 * `prefer` breaks the tie when both sides are free at the same magnitude — the
 * only case is a body dead-centre on a narrow pillar, and it must resolve the
 * same way every run or the sim stops being reproducible.
 */
const SLIP_STEPS = 4;

function cornerSlip(k: Kitchen, x: number, y: number, r: number, axis: 'x' | 'y', prefer: number): number {
  const step = TUNING.cornerSlip / SLIP_STEPS;
  for (let i = 1; i <= SLIP_STEPS; i++) {
    const d = step * i;
    const first = prefer < 0 ? -d : d;
    for (const o of [first, -first]) {
      const cx = axis === 'x' ? x : x + o;
      const cy = axis === 'x' ? y + o : y;
      if (!collides(k, cx, cy, r)) return o;
    }
  }
  return 0;
}

function moveChef(s: SimState, chef: Chef, input: InputSnapshot, dt: number) {
  const load = carryLoad(chef);
  const carryMul = load.speed;
  const cruise = TUNING.moveSpeed * carryMul;
  let mx = 0;
  let my = 0;
  let m = 0;

  if (chef.stun > 0) {
    chef.stun -= dt;
    chef.intent = 'stunned';
    // A knockback has to survive long enough to be seen. The old `* 0.82` per
    // tick left 8% of the impulse after a fifth of a second, which is why a
    // 12.4 u/s head-on collision used to move nobody anywhere.
    const kd = 1 - Math.exp(-dt / Math.max(0.0001, TUNING.stunDrag));
    chef.vel.x -= chef.vel.x * kd;
    chef.vel.y -= chef.vel.y * kd;
  } else if (chef.working !== null) {
    /**
     * COMMITTED: THE STICK IS IGNORED UNTIL THE JOB IS DONE.
     *
     * This is the other half of tap-to-chop. A tap that started a job the
     * player could immediately walk out of would be a tap that did nothing
     * visible — and the old hold at least made the commitment obvious by
     * occupying a thumb. Freezing the chef IS the feedback: you can see that
     * you are busy, and you get the seconds back the moment it finishes.
     *
     * Deliberately not a stun: no knockback drag, no 'stunned' intent, and the
     * chef keeps its heading. step() clears `working` on completion, on losing
     * reach, on picking something up, and on a second press.
     *
     * AND IT HAS TO BRAKE, NOT JUST STOP STEERING.
     *
     * Zeroing the stick is not zeroing the chef. The deceleration a released
     * stick relies on lives in the `else` branch below — `vel += (0 - vel) * k`
     * with `decelTime` — and this branch skips that integration entirely, so
     * the first version kept every unit per second the chef was carrying and
     * coasted at a dead constant speed. Tap while walking in and the chef sails
     * past the bench, `stillWants` sees `boxDist > reach` and cancels the job
     * a fraction of a second after starting it: a one-tap chop that silently
     * aborts, which is strictly worse than the hold it replaced. Nobody walks
     * up to a board and stops before pressing, so this was the normal path.
     *
     * Same time constant as letting go of the stick, so it reads as the chef
     * planting their feet rather than hitting a wall — EXCEPT for the one
     * component that cannot be allowed to coast at all. Braking alone is not
     * enough: at cruise the release curve still carries the chef 0.45 units,
     * and committing from 0.5 out puts `boxDist` at 0.954 against a `reach` of
     * 0.95, so the job died anyway — by four thousandths of a unit. Measured,
     * not reasoned: see the "tapping while still moving" case in planprobe.
     *
     * So the OUTBOUND component — the part of the velocity pointing away from
     * the bench just committed to — is removed outright, and everything else
     * decays normally. That is the honest reading of the gesture: a chef who
     * has committed to a station is not still walking away from it, while a
     * chef sliding sideways along its face is fine and keeps the soft stop.
     * A knockback still cancels the job, because a shove puts the chef outside
     * `reach` in one tick rather than coasting there.
     */
    mx = 0;
    my = 0;
    m = 0;
    const brake = 1 - Math.exp(-dt / Math.max(0.0001, TUNING.decelTime));
    chef.vel.x -= chef.vel.x * brake;
    chef.vel.y -= chef.vel.y * brake;
    const ws = stationById(s.kitchen, chef.working);
    if (ws) {
      let ax = ws.cell.x + 0.5 - chef.pos.x;
      let ay = ws.cell.y + 0.5 - chef.pos.y;
      const a = hypot(ax, ay);
      if (a > 1e-4) {
        ax /= a;
        ay /= a;
        // Positive is travelling TOWARD the bench, which is welcome.
        const along = chef.vel.x * ax + chef.vel.y * ay;
        if (along < 0) {
          chef.vel.x -= along * ax;
          chef.vel.y -= along * ay;
        }
      }
    }
  } else {
    mx = input.move.x;
    my = input.move.y;
    m = hypot(mx, my);
    if (m > 1) {
      mx /= m;
      my /= m;
      m = 1;
    }

    /**
     * THERE IS NO DASH. Asked for directly: "Remove the dash button and
     * mechanic, we want to keep this game as simple as possible."
     *
     * It was a 0.16s burst on a 1s cooldown with a 0.4s recovery tax, and the
     * tax existed because without it mashing the button was strictly faster
     * than walking, so the correct play was to hold it down all service. A
     * mechanic that needs a penalty to stop being mandatory is a mechanic
     * asking to be deleted — and on a phone it was a second thumb target
     * competing with the one button that does everything.
     *
     * What is left is the same accel/decel curve every other frame already
     * used, with the burst's recovery ceiling gone with it.
     */
    const desiredX = mx * cruise;
    const desiredY = my * cruise;
    const rate = m > 0.05 ? TUNING.accelTime * load.accel : TUNING.decelTime;
    const k = 1 - Math.exp(-dt / Math.max(0.0001, rate));
    chef.vel.x += (desiredX - chef.vel.x) * k;
    chef.vel.y += (desiredY - chef.vel.y) * k;

    // THE BODY KEEPS TURNING WHILE IT IS STILL TRAVELLING.
    //
    // `heading` used to advance only while the stick was pressed, so the
    // instant you let go the body froze mid-turn and then coasted 0.75 units
    // pointing wherever the last input happened to leave it. That matters for
    // more than looks: `findFocus` gates on heading, and a chef that arrives at
    // a station and stops keeps that stale angle — it is the mechanism behind
    // the whole `carryTurnMul` measurement in content.ts. During the coast
    // there is no stick to aim at, so we aim at where the body is actually
    // going, which is both what the eye expects and what the station in front
    // of you needs.
    const vmag = hypot(chef.vel.x, chef.vel.y);
    const maxTurn = TUNING.turnRate * load.turn * dt;
    if (m > 0.05) {
      const dd = angleDelta(chef.heading, Math.atan2(my, mx));
      chef.heading += Math.max(-maxTurn, Math.min(maxTurn, dd));
    } else if (vmag > TUNING.coastTurnSpeed) {
      // THE BODY KEEPS TURNING WHILE IT IS STILL TRAVELLING — but only through a
      // real skid. `heading` used to advance solely while the stick was pressed,
      // so the instant you let go the body froze mid-turn and coasted 0.8 units
      // pointing wherever the last input left it.
      //
      // The gate is not decoration. Turning toward velocity on EVERY coast drags
      // the heading backwards down the approach — velocity lags the stick — and
      // `findFocus` gates on heading, so a chef arriving at a station ends up
      // facing away from it. Measured over three independent 40-seed families,
      // ungated cost 1.5 to 2.4 dishes a service every time; gated to skids
      // wider than 60 degrees it is free, and lifts the worst run of the 40 from
      // 3 dishes to 6. See tools/movab.mjs coast.
      const dd = angleDelta(chef.heading, Math.atan2(chef.vel.y, chef.vel.x));
      if (Math.abs(dd) > TUNING.coastTurnSkid) chef.heading += Math.max(-maxTurn, Math.min(maxTurn, dd));
    }
    // KEEP IT BOUNDED. `angleDelta` normalises differences, so nothing ever read
    // wrong, but the raw value was free to run away: the welded chef in the
    // trace that found the spawn bug reached 19485 degrees, and a number that
    // large has lost most of its useful mantissa for anything the view wants to
    // lerp or compare.
    if (chef.heading > Math.PI || chef.heading < -Math.PI) {
      chef.heading -= Math.PI * 2 * Math.floor((chef.heading + Math.PI) / (Math.PI * 2));
    }
  }

  const speed = len(chef.vel);

  if (chef.stun <= 0) {
    // A chef coasting 0.8 units off the end of a sprint is not idle. `intent`
    // used to be read straight off the stick, so for the whole of the
    // deceleration — 0.4s, most of a body length of travel — the sim told the
    // view "idle" while the body was still doing 6 u/s.
    chef.intent = m > 0.05 || speed > 0.75 ? 'moving' : 'idle';
  }

  // 0..1 against the chef's OWN cruise, so a laden chef still reads as flat out
  // when they are flat out.
  const effortTarget = Math.min(1, speed / Math.max(0.001, cruise));
  chef.effort += (effortTarget - chef.effort) * (1 - Math.exp(-dt / 0.12));

  // Integrate with axis-separated collision so sliding along counters is
  // smooth, plus corner slip so clipping one does not weld you to it.
  const r = TUNING.chefRadius;
  const k = s.kitchen;

  // A BODY ALREADY INSIDE GEOMETRY CAN NEVER ARGUE ITS WAY OUT.
  //
  // Once a chef is embedded, every candidate on both axes overlaps the same
  // cell, both are rejected, and corner slip finds no shallow escape because
  // the body is not clipping an edge — it is inside. The chef is then deleted
  // from the game while still costing a draw call, which is exactly what the
  // fourth spawn did for the entire history of this build. `safeSpawn` stops it
  // happening at t=0; this stops it being permanent if a bump, a map edit or a
  // future push ever manages it mid-run. Bounded to a walking pace so it can
  // never look like a teleport.
  if (collides(k, chef.pos.x, chef.pos.y, r)) {
    const out = safeSpawn(k, chef.pos);
    const ox = out.x - chef.pos.x;
    const oy = out.y - chef.pos.y;
    const od = hypot(ox, oy);
    if (od > 0) {
      const stepOut = Math.min(od, TUNING.moveSpeed * dt);
      chef.pos.x += (ox / od) * stepOut;
      chef.pos.y += (oy / od) * stepOut;
    }
  }

  // RUNNING INTO A BENCH USED TO BE THE QUIETEST THING IN THE GAME.
  //
  // Measured (tools/feelcrit.mjs, four seconds of held stick into geometry):
  // 3.81 u/s deleted in a single tick, 0 sim events emitted, 0 stun frames. Two
  // thirds of cruise speed vanished and the sim told nobody, so audio and vfx
  // had nothing to react to and the wall was softer than a footstep.
  // REFERENCE.md's bar is an audible response within two frames.
  //
  // Threshold 3 u/s is just under half cruise: a chef sliding along a counter
  // face or nudging into one at a crawl stays silent, a run into it does not.
  //
  // ONE IMPACT, ONE EVENT — same rule as the bump. Both collision axes can
  // reject in the same tick when a body clips a corner, and a chef bouncing
  // along a bench face can re-cross the threshold a few frames later; measured
  // over four 150s services that produced runs of up to 8 events inside two
  // ticks. The lock lives on the unused diagonal of `contactLock` (a chef is
  // never paired with itself), so it costs no allocation and decays on the same
  // clock.
  const selfLock = chef.id * s.chefs.length + chef.id;
  const wallHit = (speedInto: number) => {
    if (speedInto > TUNING.wallHitSpeed && s.contactLock[selfLock] <= 0) {
      s.contactLock[selfLock] = TUNING.wallHitImmunity;
      emit(s, { t: 'wallHit', chef: chef.id, at: { ...chef.pos }, speed: speedInto });
    }
  };

  const nx = chef.pos.x + chef.vel.x * dt;
  if (!collides(k, nx, chef.pos.y, r)) {
    chef.pos.x = nx;
  } else {
    const off = cornerSlip(k, nx, chef.pos.y, r, 'x', chef.vel.y);
    if (off === 0) {
      wallHit(Math.abs(chef.vel.x));
      chef.vel.x = 0;
    } else {
      // Slide sideways no faster than we were travelling forward, so the escape
      // is a slide at speed and a nudge at a crawl — never a teleport.
      const budget = Math.abs(chef.vel.x) * dt;
      const move = Math.min(Math.abs(off), budget) * Math.sign(off);
      const ty = chef.pos.y + move;
      if (!collides(k, chef.pos.x, ty, r)) chef.pos.y = ty;
      if (!collides(k, nx, chef.pos.y, r)) chef.pos.x = nx;
    }
  }

  const ny = chef.pos.y + chef.vel.y * dt;
  if (!collides(k, chef.pos.x, ny, r)) {
    chef.pos.y = ny;
  } else {
    const off = cornerSlip(k, chef.pos.x, ny, r, 'y', chef.vel.x);
    if (off === 0) {
      wallHit(Math.abs(chef.vel.y));
      chef.vel.y = 0;
    } else {
      const budget = Math.abs(chef.vel.y) * dt;
      const move = Math.min(Math.abs(off), budget) * Math.sign(off);
      const tx = chef.pos.x + move;
      if (!collides(k, tx, chef.pos.y, r)) chef.pos.x = tx;
      if (!collides(k, chef.pos.x, ny, r)) chef.pos.y = ny;
    }
  }

  s.stepAccum[chef.id] += speed * dt;
  if (s.stepAccum[chef.id] > 0.62) {
    s.stepAccum[chef.id] = 0;
    emit(s, { t: 'footstep', chef: chef.id, at: { ...chef.pos } });
  }
}

function collides(k: Kitchen, x: number, y: number, r: number): boolean {
  // The scan has to reach as far as the widest cell box can, or the border
  // cells whose boxes `wallSkirt` grows are never even looked at: at x 1.38
  // with r 0.36 this used to examine column 1 only, so the enlarged wall at
  // column 0 sat outside the loop and the pad did nothing at all.
  const P = TUNING.wallSkirt;
  const minX = Math.floor(x - r - P);
  const maxX = Math.floor(x + r + P);
  const minY = Math.floor(y - r - P);
  const maxY = Math.floor(y + r + P);
  for (let cy = minY; cy <= maxY; cy++) {
    for (let cx = minX; cx <= maxX; cx++) {
      if (isWalkable(k, cx, cy)) continue;
      // circle vs axis-aligned cell — grown by `wallSkirt` at the room's own
      // border, where the shell's rubble and its door stand proud of the cell
      // face. See TUNING.wallSkirt.
      const border = cx <= 0 || cy <= 0 || cx >= k.width - 1 || cy >= k.height - 1;
      const pad = border ? TUNING.wallSkirt : 0;
      const closestX = Math.max(cx - pad, Math.min(x, cx + 1 + pad));
      const closestY = Math.max(cy - pad, Math.min(y, cy + 1 + pad));
      const dx = x - closestX;
      const dy = y - closestY;
      if (dx * dx + dy * dy < r * r) return true;
    }
  }
  return false;
}

function resolveChefCollisions(s: SimState, dt: number) {
  const r = TUNING.chefRadius;
  const n = s.chefs.length;
  for (let i = 0; i < s.contactLock.length; i++) {
    if (s.contactLock[i] > 0) s.contactLock[i] = Math.max(0, s.contactLock[i] - dt);
  }
  for (let i = 0; i < s.chefs.length; i++) {
    for (let j = i + 1; j < s.chefs.length; j++) {
      const a = s.chefs[i];
      const b = s.chefs[j];
      const dx = b.pos.x - a.pos.x;
      const dy = b.pos.y - a.pos.y;
      const dist = hypot(dx, dy);
      const min = r * 2;
      if (dist === 0) continue;
      if (dist >= min) {
        // PERSONAL SPACE.
        //
        // Hard collision at 2r keeps two chefs from occupying the same point,
        // and that is not the same thing as keeping them from occupying the
        // same OUTLINE. The camera looks at the room from a low near-frontal
        // angle, so two bodies 0.75 units apart in world space can project
        // completely on top of each other — which is exactly what
        // desktop/t0017s and ipad/90-late showed, and the reference never lets
        // two characters merge into one silhouette.
        //
        // So below `soft` there is a weak radial drift pushing them apart. It
        // is an order of magnitude below walking pace (0.22 u/s at full
        // overlap against a 6.2 u/s move speed), so it never fights a bot that
        // genuinely wants to be somewhere and never reads as a force field —
        // it just means two chefs idling near each other slowly drift into two
        // separate silhouettes instead of standing in each other.
        //
        // Gated on neither chef being mid-task: a chef at a board is standing
        // where the sim needs it to stand, and sliding it off its own station
        // would be a gameplay bug dressed as a composition fix.
        const soft = r * 3.3;
        if (dist < soft && a.intent !== 'working' && b.intent !== 'working') {
          const k = ((soft - dist) / soft) * 0.008;
          const sx = (dx / dist) * k;
          const sy = (dy / dist) * k;
          if (!collides(s.kitchen, a.pos.x - sx, a.pos.y, r)) a.pos.x -= sx;
          if (!collides(s.kitchen, a.pos.x, a.pos.y - sy, r)) a.pos.y -= sy;
          if (!collides(s.kitchen, b.pos.x + sx, b.pos.y, r)) b.pos.x += sx;
          if (!collides(s.kitchen, b.pos.x, b.pos.y + sy, r)) b.pos.y += sy;
        }
        continue;
      }
      const push = (min - dist) / 2;
      const ux = dx / dist;
      const uy = dy / dist;
      // NEVER PUSH A BODY INTO GEOMETRY. This used to write the separated
      // positions unconditionally, and `moveChef`'s axis-separated integration
      // then had no way to undo it: once a chef is inside a station cell, BOTH
      // candidate positions still overlap that cell, both axes are rejected,
      // and the chef is welded to the bench for the rest of the run at exactly
      // v = 0.00 with a full input vector pointing away from it.
      //
      // That is the actual mechanism behind "three stalled bots and a statue".
      // An offline 40-second trace had nori shoved 0.1 units into the counter
      // at (9,5) at t=1.5s by a routine bump with mochi and still standing
      // there, frozen to two decimal places, at t=39.5. No amount of bot
      // cleverness recovers from it, because the sim was refusing every input
      // the bot could possibly produce.
      //
      // Each half of the push is now applied only if it lands somewhere legal,
      // per axis, exactly like ordinary movement. Worst case the pair stays
      // overlapped for a frame — which the reference is full of, chefs bump
      // constantly — instead of one of them being deleted from the game.
      const shove = (c: Chef, mx: number, my: number) => {
        if (!collides(s.kitchen, c.pos.x + mx, c.pos.y, r)) c.pos.x += mx;
        if (!collides(s.kitchen, c.pos.x, c.pos.y + my, r)) c.pos.y += my;
      };
      shove(a, -ux * push, -uy * push);
      shove(b, ux * push, uy * push);

      // A BUMP IS A COLLISION, NOT A PROXIMITY.
      //
      // The old test was `|va - vb| > moveSpeed * 0.8`, which counts two chefs
      // merely crossing paths at speed as a head-on. Measured across six full
      // services driven by the real BotDirector, 13143 contact ticks: it fired
      // on 10.1% of them — one bump per chef every 2.86 seconds, 6.9% of all
      // chef time frozen. Weather, not an event.
      //
      // What matters is how fast the two are closing ALONG THE LINE BETWEEN
      // THEM. A graze contributes almost nothing to that term and a head-on
      // contributes all of it, which is both more physical and, for free, a
      // re-fire guard: the tick after a bump the pair is separating, the term
      // goes negative, and one collision can no longer emit an event every
      // frame while the bodies untangle.
      //
      // AND CLOSING SPEED WAS NOT ENOUGH ON ITS OWN. The prediction above —
      // "the tick after a bump the pair is separating, so the term is negative
      // and the event cannot machine-gun" — holds only if both bodies stop
      // driving into each other, and a bot on a flow field never does.
      // tools/bumpprobe.mjs, one head-on encounter with both sticks still
      // pressed in: 10 separate bump events at knockback 3.2, and still 7 at
      // knockback 8.0. In the real room 75.7% of bumps re-hit the same chef
      // within a second, which is why the player was taking 45.7 a minute.
      //
      // So the pair gets a lock. One collision, one knock, one sound, then
      // `bumpImmunity` seconds in which these two bodies can jostle all they
      // like without the game shouting about it. Keyed on the ordered id pair
      // and indexed rather than hashed, so it is allocation-free and stays
      // deterministic. The physical separation above still runs — they are not
      // allowed to overlap, they are just allowed to touch quietly.
      const lock = a.id * n + b.id;
      const closing = (a.vel.x - b.vel.x) * ux + (a.vel.y - b.vel.y) * uy;
      if (closing > TUNING.bumpClosingSpeed && s.contactLock[lock] <= 0) {
        s.contactLock[lock] = TUNING.bumpImmunity;
        a.stun = TUNING.bumpStun;
        b.stun = TUNING.bumpStun;
        // And it has to SHOVE. Before this a 12.4 u/s head-on produced exactly
        // zero units of knockback: the pair was separated by the overlap push
        // above and then frozen, so the whole event read as the game pausing
        // you. Scaled by how hard the contact was, so a jog into someone's back
        // is a nudge and a full-pelt head-on is a comedy sprawl.
        const kick = TUNING.bumpKnockback * Math.max(0.6, Math.min(1.4, closing / TUNING.moveSpeed));
        a.vel.x = -ux * kick;
        a.vel.y = -uy * kick;
        b.vel.x = ux * kick;
        b.vel.y = uy * kick;
        emit(s, { t: 'bump', a: a.id, b: b.id, at: { x: (a.pos.x + b.pos.x) / 2, y: (a.pos.y + b.pos.y) / 2 } });
      }
    }
  }
}

// ------------------------------------------------------------ interaction

/**
 * DISTANCE TO THE BENCH, NOT TO THE MIDDLE OF THE BENCH.
 *
 * Reach used to be a circle around the station's CENTRE: `dist > reach + 0.5`,
 * where the 0.5 is half a cell. That is exact for a chef standing square on to
 * a face and wrong everywhere else, and the error is worst exactly where the
 * player most often stands — the corner. The four cells that touch a bench
 * diagonally have their centres at 1.4142 from it, and the gate was 1.45: every
 * diagonal grab in this game worked by 0.036 units, about five centimetres, and
 * anybody who trimmed `reach` by a hair would have silently deleted all 92 of
 * them (measured: tools/focusprobe.mjs, "stand in a cell TOUCHING a bench").
 *
 * The distance from the chef to the station's 1x1 CELL BOX has no such cliff.
 * `reach` now means what it says — how far past the edge of the bench the arms
 * go — and the envelope is a rounded rectangle around the bench instead of a
 * circle around its middle. Along a face nothing moves at all (0.95 past the
 * edge is still 1.45 from the centre, so this is not a range increase); at the
 * corners it goes from 5cm of slack to 24cm.
 */
function boxDist(st: Station, x: number, y: number): number {
  const dx = Math.max(st.cell.x - x, 0, x - (st.cell.x + 1));
  const dy = Math.max(st.cell.y - y, 0, y - (st.cell.y + 1));
  return hypot(dx, dy);
}

/**
 * True when another bench sits between the chef and the station.
 *
 * 1.5% of all focus picks in the baseline sweep were through a solid cell —
 * standing on one side of the centre-back run and being handed the crate on the
 * far side of it. Nothing in the room tells the player that station is even
 * theirs to take, and walking round to it is the opposite of what the glow just
 * told them to do. Traced to the nearest point on the target's own box rather
 * than to its centre, so a diagonal stand — where the line legitimately grazes
 * the corner of a neighbour — is not falsely rejected.
 */
function occluded(k: Kitchen, x: number, y: number, st: Station): boolean {
  const tx = Math.max(st.cell.x, Math.min(x, st.cell.x + 1));
  const ty = Math.max(st.cell.y, Math.min(y, st.cell.y + 1));
  const n = 6;
  for (let i = 1; i < n; i++) {
    const px = x + (tx - x) * (i / n);
    const py = y + (ty - y) * (i / n);
    const cx = Math.floor(px);
    const cy = Math.floor(py);
    if (cx === st.cell.x && cy === st.cell.y) continue;
    if (!isWalkable(k, cx, cy)) return true;
  }
  return false;
}

/**
 * WHAT A PRESS WOULD DO, DECIDED IN ONE PLACE.
 *
 * `findFocus` needs to know whether a station can be acted on at all, and
 * `doGrab` needs to know what to do. When those were two different pieces of
 * code the glow could promise something the button then refused — the player
 * pressed, the kitchen said nothing, and there is no way to tell that apart
 * from a dropped input. Now the plan is computed once and both callers use it,
 * so a lit station is a station that answers by construction.
 *
 * Exported so the view/HUD can render the verb before the press if it wants it
 * (`chef.focusAction` carries the same value every tick).
 */
export type GrabKind =
  | 'none'
  | 'dispense' // a crate or the plate stack hands you one
  | 'take' // lift what is sitting on the bench
  | 'place' // set what you hold on an empty surface
  | 'combine' // held ingredient joins a plate or a pan
  | 'load' // held plate scoops up a loose ingredient
  | 'swap' // exchange what you hold for what is there
  | 'return' // put it back where you found it
  | 'serve'
  | 'discard'
  /**
   * HOLD THIS ONE — it is what makes a single action button possible.
   *
   * A board with raw food on it, or a sink with a dirty plate in it, is a
   * station whose job is WORK rather than a transfer. Before the button was
   * unified, a press there resolved to 'take' and the chopping lived on a
   * separate held button, which is the arrangement a player called out
   * directly: "on desktop I don't even know how to use that action button, on
   * mobile it's weird to have a dedicated button, why not combine into a
   * unified action button?"
   *
   * Naively pointing one button at both signals does not work. The press fires
   * `grabPressed` on the same tick the hold begins, `doGrab` lifts the raw
   * tomato off the board, and `useHeld`'s own `!chef.carrying` guard then
   * refuses to chop the thing now in your hands. You would pick food up every
   * single time you tried to cut it.
   *
   * So the plan layer answers first: at a station that wants work from empty
   * hands, the press is a NO-OP that consumes itself, and the hold does the
   * job. Taking raw food back off a board is the one thing this costs, and the
   * bin already undoes a mistake in one press.
   */
  | 'prep';

/** Flat surfaces: anything can rest on them. */
function isSurface(kind: Station['kind']): boolean {
  return kind === 'counter' || kind === 'board' || kind === 'sink';
}

/**
 * WHAT A STATION IS FOR versus WHAT IT WILL PUT UP WITH — and why the
 * difference has to reach the focus ranking.
 *
 * Making every flat surface accept every payload is the right rule for the
 * player: you should never be holding something with nowhere to put it. But an
 * affordance is not free, because a station that can be acted on competes for
 * the glow, and the kitchen is full of shoulder-to-shoulder benches. Shipped
 * blind, it measured: a chef standing at the station it walked to with the
 * glow on the bench NEXT to it went from 23.2% of at-target ticks to 33.8%,
 * and bots-alone throughput fell from a median of 9 dishes to 6 over 24 seeds
 * (tools/focusprobe.mjs --only bots). The forgiveness was real and so was the
 * bill.
 *
 * So affordances are tiered rather than binary. A chopping board's job is to
 * hold food that needs cutting; it will also hold your plate, but it does not
 * get to outrank the counter you were walking to for the privilege. Same for a
 * sink that is not being asked to wash, for a swap, and for putting something
 * back in the crate it came from — all of them stay legal, none of them
 * campaign for the glow.
 *
 * 0 = what the station is for, 1 = it will put up with it, 2 = nothing.
 */
function affordance(chef: Chef, st: Station, plan: GrabKind): 0 | 1 | 2 {
  if (plan === 'none') return 2;
  if (plan === 'prep') return 0;
  if (plan === 'swap' || plan === 'return') return 1;
  if (plan === 'place') {
    const held = chef.carrying;
    // A board's job is food that needs cutting. It will still HOLD a bun — you
    // should never be carrying something with nowhere to put it — but it does
    // not get to outrank the counter you were walking to for the privilege.
    if (st.kind === 'board' && held?.type === 'ingredient' && INGREDIENT_DEFS[held.ingredient.kind].chopSeconds <= 0)
      return 1;
    if (st.kind === 'board' && held?.type !== 'ingredient') return 1;
    if (st.kind === 'sink' && !(held?.type === 'plate' && held.plate.dirty)) return 1;
  }
  return 0;
}

export function planGrab(s: SimState, chef: Chef, st: Station | null): GrabKind {
  if (!st) return 'none';
  const held = chef.carrying;

  if (!held) {
    if (st.kind === 'crate' && st.dispenses) return 'dispense';
    if (st.kind === 'plates') return 'dispense';
    /**
     * A PAN NEVER LEAVES THE BURNER. YOU ONLY EVER HANDLE FOOD.
     *
     * Wave 4 made one exception to this: a pan with burnt food in it could be
     * lifted, because nothing else could empty it and the burner would
     * otherwise be dead for the rest of the service. That fixed the soft-lock
     * and bought a mechanic nobody could explain, which is exactly how it came
     * back from play:
     *
     *   "I was able to pick up a frying pan off the stove... doesn't do
     *    anything else does it? ...you can simply pick up the bacon to do the
     *    same thing no? I don't get this mechanic of the game at all."
     *
     * They are right, and the answer is the simpler one they suggested. The
     * escape hatch never needed the PAN to move — it needed the ruined food to
     * come out.
     *
     * AND IT DOES NOT NEED TO COME OUT INTO YOUR HANDS EITHER. Handing over the
     * burnt rasher bought a second errand (walk it to the bin) and an object
     * nobody could identify, straight back from play:
     *
     *   "the burnt bacon is the same grey color as the pan so it looks like I
     *    picked up a small pan/skillet and not burnt bacon. Honestly maybe the
     *    burnt bacon should just disappear anyways"
     *
     * It should. Nothing downstream wants a ruined ingredient — the bin is its
     * only destination and every route there is a chore — so the press does the
     * whole job where you stand: the pan is scraped out, the fire goes out, and
     * your hands stay empty. One press, one concept, and no grey lump to carry
     * around being mistaken for cookware.
     *
     * `doGrab` does the scraping; see `case 'discard'`. Everything else about
     * the rule is unchanged: a pan doing its job stays put, and a plate still
     * comes to the pan rather than the other way round (the 'load' rung below).
     */
    if (st.kind === 'stove' && st.holding?.type === 'pan')
      return st.holding.pan.contents.some((i) => i.state === 'burnt') ? 'discard' : 'none';
    // See 'prep' above. Same conditions the `useHeld` gate in step() tests, and
    // the SAME chopSeconds test updateStations makes before it advances any
    // work — all three have to agree or the button lies.
    //
    // The chopSeconds check is not defensive tidying, it is a soft-lock fix. A
    // bun and a rasher of bacon are both chopSeconds 0 and both are ingredients
    // the player carries constantly. Put either on a board without this and:
    // planGrab says 'prep', so the press is consumed as a no-op; the hold runs
    // but updateStations refuses to advance an ingredient that cannot be
    // chopped; and there is no other plan that lifts it. The item and the board
    // are gone for the rest of the run, for the player and for the bots.
    if (
      st.kind === 'board' &&
      st.holding?.type === 'ingredient' &&
      st.holding.ingredient.state === 'raw' &&
      INGREDIENT_DEFS[st.holding.ingredient.kind].chopSeconds > 0
    )
      return 'prep';
    if (st.kind === 'sink' && st.holding?.type === 'plate' && st.holding.plate.dirty) return 'prep';
    return st.holding ? 'take' : 'none';
  }

  switch (st.kind) {
    case 'bin':
      if (held.type === 'ingredient') return 'discard';
      if (held.type === 'plate' && held.plate.contents.length) return 'discard';
      if (held.type === 'pan' && held.pan.contents.length) return 'discard';
      return 'none';
    case 'serve':
      // A wrong plate is not a no-op: it is a refusal with a sound, and since
      // this pass it no longer costs a combo the player was mid-way through.
      return held.type === 'plate' ? 'serve' : 'none';
    case 'crate':
      // "If you grab the wrong ingredient by accident, just put it back where
      // you found it!" — the reference's own on-screen instruction.
      //
      // WHERE YOU FOUND IT. A crate is an infinite SOURCE of exactly one kind,
      // so anything handed to it is deleted rather than stored. Without the two
      // tests below that made the lettuce bin a working incinerator for bread:
      // reported from play as "I am able to pick up bread and put it in the
      // lettuce supply station, where it disappears into." A chopped tomato
      // went the same way, which is worse — that is work destroyed, silently,
      // on a press the player thought was a put-down.
      //
      // So a crate takes back only the thing it dispenses, only in the state it
      // dispenses it in. Anything else is 'none' and the bench next door gets
      // the press.
      return held.type === 'ingredient' &&
        held.ingredient.kind === st.dispenses &&
        held.ingredient.state === 'raw'
        ? 'return'
        : 'none';
    case 'plates':
      return held.type === 'plate' && !held.plate.dirty && held.plate.contents.length === 0 ? 'return' : 'none';
    case 'stove':
      if (st.holding?.type === 'pan' && held.type === 'ingredient' && st.holding.pan.contents.length < 3) return 'combine';
      /**
       * BOTS PIECE, MINIMAL FIX — COOKED FOOD COULD NOT LEAVE THE PAN.
       *
       * There was no plan anywhere in this function that moved an ingredient
       * OUT of a pan and onto a plate. `combine` puts one in; `take` lifts the
       * whole pan; a held plate at a stove returned 'none'; and a held pan at a
       * counter carrying a plate resolved to 'swap'. So every recipe with a
       * cooked component was unfillable BY ANYONE — measured over six 180s
       * services with tools/botprobe.mjs: Bacon Roll 0 closed / 14 expired,
       * BLT 0 / 2, against Garden Salad 22 / 10. Three of the five recipes on
       * the menu were tickets that could only ever rot, which is most of the
       * miss rate in the game and is not a bot defect — a human player cannot
       * serve a Bacon Roll either.
       *
       * Plating straight off the pan is also what the reference does: the pan
       * stays on the heat and the plate comes to it.
       */
      if (
        st.holding?.type === 'pan' &&
        held.type === 'plate' &&
        !held.plate.dirty &&
        held.plate.contents.length < PLATE_CAPACITY &&
        st.holding.pan.contents.some((i) => i.state === 'cooked')
      )
        return 'load';
      return !st.holding && held.type === 'pan' ? 'place' : 'none';
    case 'sink':
      /**
       * A SINK WASHES PLATES. That is its whole job, and until now it was also
       * a shelf: `isSurface` lists it, so the default rung below let any loose
       * ingredient be set down in the washing-up water, where it did nothing
       * and could only be picked back up. Reported from play as "it looks like
       * someone was able to set an ingredient in the sink? Another bug."
       *
       * It is not a crash, it is a station advertising an action worth nothing,
       * and the ask was explicit: fewer useless actions. Dirty plates only.
       */
      if (held.type === 'plate' && held.plate.dirty && !st.holding) return 'place';
      return 'none';
    default: {
      if (!st.holding) return 'place';
      if (st.holding.type === 'plate' && held.type === 'ingredient' && st.holding.plate.contents.length < PLATE_CAPACITY)
        return 'combine';
      if (st.holding.type === 'pan' && held.type === 'ingredient' && st.holding.pan.contents.length < 3) return 'combine';
      if (held.type === 'plate' && st.holding.type === 'ingredient' && held.plate.contents.length < PLATE_CAPACITY)
        return 'load';
      // Same rule as the stove above, for a pan parked on a bench: a plate takes
      // cooked food off ANY pan, wherever it is standing. Without this the same
      // press resolved to `swap` and put a hot pan in the player's hands.
      if (
        held.type === 'plate' &&
        st.holding.type === 'pan' &&
        !held.plate.dirty &&
        held.plate.contents.length < PLATE_CAPACITY &&
        st.holding.pan.contents.some((i) => i.state === 'cooked')
      )
        return 'load';
      // Last resort, and the reason the button is never dead on a dressed
      // bench: trade. It is its own undo — press again and you have your own
      // thing back — which is the cheapest possible price for a mis-press.
      return isSurface(st.kind) ? 'swap' : 'none';
    }
  }
}

/**
 * FOCUS: GENEROUS IN THE GATE, DECISIVE IN THE RANKING, AND STICKY ENOUGH TO
 * STOP STROBING.
 *
 * Measured on the shipped build (tools/focusprobe.mjs, six 170s services with
 * the real bots): the focused station changed 5.81 times a second for the
 * player and 1.05 for each bot, and 31% / 47% of those changes REVERSED inside
 * a quarter of a second. Two benches within reach traded the glow back and
 * forth on sub-degree heading noise, because the winner was recomputed from
 * scratch every tick with no memory and no margin. Nothing in a screenshot can
 * show that; it is a strobe under the furniture, and it is why the bot brain
 * carries a 1.3-second stall breaker (see bots/brain.ts) for chefs parked
 * between two adjacent stations.
 *
 * Three terms, in the order they matter:
 *
 *  - GATE. Box distance (see `boxDist`), a cone, and a check that no bench is
 *    in the way. The gate is the "roughly near and roughly facing" test and it
 *    is deliberately loose.
 *  - RANK. Angle first, distance second — a station you are pointing at beats a
 *    nearer one you are not. Ranking on the CENTRE while gating on the BOX is
 *    the point: the box has no opinion about which of two shoulder-to-shoulder
 *    benches you mean, and the centre does.
 *  - HOLD. The station you already have keeps a `focusStick` head start and a
 *    slightly wider gate, so a tie has to be lost by a real margin — a body
 *    turn, a step — before the glow moves.
 *
 * Plus one honesty term: a station where the button would do nothing is pushed
 * down the list, so if anything within reach can answer the press, that is the
 * thing that lights up.
 */
export function findFocus(s: SimState, chef: Chef): Station | null {
  return gateFocus(s, chef) ?? coyoteFocus(s, chef);
}

/** The strict gate + rank. Returns null the instant nothing qualifies. */
function gateFocus(s: SimState, chef: Chef): Station | null {
  let best: Station | null = null;
  let bestScore = Infinity;
  const hx = Math.cos(chef.heading);
  const hy = Math.sin(chef.heading);
  /**
   * THE AIM IS ANCHORED WHERE THE BODY WAS WHEN THE FRAME WAS DRAWN.
   *
   * `moveChef` runs before this in `step`, so by the time the gate is evaluated
   * the chef has already travelled a tick — 0.103u at cruise. Measured in
   * tools/driveby.mjs, a chef pressing at the exact moment he is level with a
   * bench is judged from 0.103u FURTHER ON, and the bench he was beside turns
   * out to be 92 degrees behind him: the miss is caused by the ordering of the
   * update, not by the player. Winding the aim point back by `focusLead`
   * measures the angle from where the body was on the frame the player was
   * looking at when they pressed. Zero at a standstill, so nothing a static
   * sweep can see moves at all.
   *
   * Only the ANGLE is wound back. `reach` is about where the arms are now.
   */
  const v = chef.vel;
  const ax = chef.pos.x - (v !== undefined ? v.x : 0) * TUNING.focusLead;
  const ay = chef.pos.y - (v !== undefined ? v.y : 0) * TUNING.focusLead;
  for (const st of s.kitchen.stations) {
    const held = st.id === chef.focus;
    const bd = boxDist(st, chef.pos.x, chef.pos.y);
    if (bd > TUNING.reach + (held ? TUNING.focusKeepReach : 0)) continue;
    const c = stationCenter(st);
    const dx = c.x - ax;
    const dy = c.y - ay;
    const dist = hypot(dx, dy);
    const dot = (dx * hx + dy * hy) / (dist || 1);
    const ang = Math.acos(Math.max(-1, Math.min(1, dot)));
    if (ang > TUNING.reachCone + (held ? TUNING.focusKeepCone : 0)) continue;
    if (occluded(s.kitchen, chef.pos.x, chef.pos.y, st)) continue;
    /**
     * A STATION YOU CANNOT ACT ON IS NOT A STATION YOU GET TO FOCUS.
     *
     * This used to be a PENALTY: an inert bench scored `focusInertPenalty`
     * worse than a live one, so it lost whenever something useful was in
     * range — and won whenever nothing was. Standing at the sink with empty
     * hands lit the sink up, offering a press that does nothing, which came
     * back from play as "why are table positions like the sink even
     * highlighting as interactive? There's nothing you can do at the sink".
     *
     * That is the same broken promise the whole plan matrix is built around,
     * wearing its other face: the glow says yes and the button says no. The
     * fix is not a bigger penalty, it is that a plan of 'none' is not a
     * candidate. The press still answers — with `focus` null, `doGrab`
     * refuses and the buffered press becomes the `grabMiss` thunk — so the
     * player is told nothing happened rather than shown a light that lies.
     */
    const plan = planGrab(s, chef, st);
    if (plan === 'none') continue;
    let score = ang * 0.8 + bd * 0.9;
    score += [0, TUNING.focusOffLabelPenalty, TUNING.focusInertPenalty][affordance(chef, st, plan)];
    if (held) score -= TUNING.focusStick;
    if (score < bestScore) {
      bestScore = score;
      best = st;
    }
  }
  return best;
}

/**
 * COYOTE FOCUS. The gate rejected everything this tick — but if the station you
 * had a moment ago is still within arm's length, you still have it.
 *
 * The timer is spent in `step`, and it only ever runs while the gate is failing,
 * so a focus that keeps passing the gate never touches this path. The distance
 * check is deliberately the same `reach + focusKeepReach` the incumbent already
 * gets: coyote can carry you through a turn, a jostle or a heading blip, and it
 * can never carry you to a bench you have walked away from.
 */
function coyoteFocus(s: SimState, chef: Chef): Station | null {
  if (chef.focus === null || !((chef.focusHold ?? 0) > 0)) return null;
  const st = stationById(s.kitchen, chef.focus);
  if (!st) return null;
  if (boxDist(st, chef.pos.x, chef.pos.y) > TUNING.reach + TUNING.focusKeepReach) return null;
  if (occluded(s.kitchen, chef.pos.x, chef.pos.y, st)) return null;
  // ...and it does not get to hand back a bench that has since gone inert:
  // put the last plate in the sink and the sink must go dark immediately, not
  // linger lit for the length of the coyote window. See findFocus.
  if (planGrab(s, chef, st) === 'none') return null;
  return st;
}

/**
 * Execute the press. Returns TRUE if it actually did something.
 *
 * The return value is the whole point: `step` keeps a buffered press alive
 * until a tick where this says yes, and turns it into a `grabMiss` when it
 * never does. Every early return below is a press the player would otherwise
 * have watched vanish in silence.
 */
function doGrab(s: SimState, chef: Chef, st: Station | null): boolean {
  if (!st) return false;
  const plan = planGrab(s, chef, st);
  if (plan === 'none') return false;
  const at = stationCenter(st);
  const held = chef.carrying;

  switch (plan) {
    case 'dispense':
      chef.carrying =
        st.kind === 'plates'
          ? { type: 'plate', plate: mkPlate(s) }
          : { type: 'ingredient', ingredient: mkIngredient(s, st.dispenses!) };
      emit(s, { t: 'pickup', chef: chef.id, at });
      return true;
    case 'take': {
      // Nothing is ever lifted off a burner — see planGrab. A burning pan is
      // handled by 'discard' below, and the pan itself is a fixture.
      chef.carrying = st.holding;
      st.holding = null;
      st.work = 0;
      emit(s, { t: 'pickup', chef: chef.id, at });
      return true;
    }
    case 'place':
      if (!held) return false;
      // The armful is down: the rest of the pile joins the bench, one plate
      // stays as the working plate. Stations only ever draw a single plate.
      st.holding = held;
      // A HALF-CHOPPED TOMATO STAYS HALF CHOPPED. `work` used to be zeroed by
      // every place and every pickup, so lifting an ingredient off a board to
      // see what it was — or being bumped into pressing grab — threw away up to
      // 1.4s of chopping. The progress travels with the FOOD now (`ing.chop`),
      // so it survives the trip and the board picks it straight back up.
      st.work = held.type === 'ingredient' ? (held.ingredient.chop ?? 0) : 0;
      chef.carrying = null;
      emit(s, { t: 'place', chef: chef.id, at });
      return true;
    case 'combine':
      if (held?.type !== 'ingredient' || !st.holding) return false;
      if (st.holding.type === 'plate') {
        st.holding.plate.contents.push(held.ingredient);
        if (!chef.isPlayer) st.holding.plate.botMade = true;
      } else if (st.holding.type === 'pan') {
        st.holding.pan.contents.push(held.ingredient);
      }
      chef.carrying = null;
      emit(s, { t: 'place', chef: chef.id, at });
      return true;
    case 'load': {
      if (held?.type !== 'plate') return false;
      // Off a bench: the plate takes the whole item.
      if (st.holding?.type === 'ingredient') {
        held.plate.contents.push(st.holding.ingredient);
        if (!chef.isPlayer) held.plate.botMade = true;
        st.holding = null;
        st.work = 0;
        emit(s, { t: 'place', chef: chef.id, at });
        return true;
      }
      // Off the heat: one cooked item leaves the pan, the pan stays put.
      if (st.holding?.type === 'pan') {
        const i = st.holding.pan.contents.findIndex((x) => x.state === 'cooked');
        if (i < 0) return false;
        held.plate.contents.push(st.holding.pan.contents.splice(i, 1)[0]);
        if (!chef.isPlayer) held.plate.botMade = true;
        emit(s, { t: 'place', chef: chef.id, at });
        return true;
      }
      return false;
    }
    case 'swap': {
      if (!held || !st.holding) return false;
      const there = st.holding;
      st.holding = held;
      st.work = held.type === 'ingredient' ? (held.ingredient.chop ?? 0) : 0;
      chef.carrying = there;
      emit(s, { t: 'place', chef: chef.id, at });
      return true;
    }
    case 'return':
      // Back on the tray it came from. Crates are infinite sources, so the
      // ingredient simply rejoins the pile; the plate stack takes its plate
      // back the same way. This is the reference's own instruction to the
      // player and it was the one thing the kitchen could not do.
      chef.carrying = null;
      emit(s, { t: 'place', chef: chef.id, at });
      return true;
    case 'prep':
      // A TAP COMMITS. This used to consume the press and do nothing, because
      // the HOLD on the same button did the work — and a hold is a gesture
      // nobody finds. Now the press starts the job and `chef.working` keeps it
      // running until the station stops needing work; see step().
      chef.working = st.id;
      chef.intent = 'working';
      return true;
    case 'discard':
      /**
       * EMPTY-HANDED AT A BURNING PAN: SCRAPE IT, DO NOT PICK IT UP.
       *
       * The only 'discard' that does not happen at the bin. Everything ruined
       * goes at once rather than one rasher per press — the previous rhythm
       * existed to match the bin's undo, and there is nothing to undo here: a
       * burnt rasher has exactly one future wherever it is standing. The fire
       * goes out with its fuel.
       */
      if (!held) {
        if (st.kind !== 'stove' || st.holding?.type !== 'pan') return false;
        const pan = st.holding.pan;
        const keep = pan.contents.filter((i) => i.state !== 'burnt');
        if (keep.length === pan.contents.length) return false;
        pan.contents = keep;
        pan.fire = 0;
        emit(s, { t: 'trash', at });
        return true;
      }
      // ONE ITEM PER PRESS, NOT THE WHOLE PLATE. The bin used to empty a plate
      // outright, so a single wrong ingredient on a three-item order cost the
      // other two as well — the most expensive mis-press in the game, and the
      // only one with no way back. Now the bin is an undo: it takes the last
      // thing you put on, and pressing it again takes the next.
      if (!held) return false;
      if (held.type === 'ingredient') chef.carrying = null;
      else if (held.type === 'plate') held.plate.contents.pop();
      else if (held.type === 'pan') {
        held.pan.contents.pop();
        if (!held.pan.contents.length) held.pan.fire = 0;
      }
      emit(s, { t: 'trash', at });
      return true;
    case 'serve':
      // A refused plate is not a miss: `trySer` emits its own serveWrong, which
      // is a louder and more specific answer than the generic thunk.
      if (held?.type !== 'plate') return false;
      trySer(s, chef, held.plate, at);
      return true;
  }
  return false;
}

/**
 * Is this plate a mistake, or is it a job half done? A plate whose contents are
 * a sub-multiset of some live ticket is somebody two thirds of the way through
 * an order who walked past the pass, and charging them a combo for it is
 * punishing a player for the ambiguity of a hitbox they cannot see.
 */
function plateIsWorkInProgress(s: SimState, plate: Plate): boolean {
  if (plate.contents.length === 0) return true;
  const have = new Map<string, number>();
  for (const i of plate.contents) {
    const k = componentKey(i.kind, i.state);
    have.set(k, (have.get(k) ?? 0) + 1);
  }
  for (const o of s.orders) {
    const want = new Map<string, number>();
    for (const c of o.recipe.components) {
      const k = componentKey(c.kind, c.state);
      want.set(k, (want.get(k) ?? 0) + 1);
    }
    let ok = true;
    for (const [k, n] of have) {
      if ((want.get(k) ?? 0) < n) {
        ok = false;
        break;
      }
    }
    if (ok) return true;
  }
  return false;
}

function trySer(s: SimState, chef: Chef, plate: Plate, at: Vec2) {
  const key = plateKey(plate);
  const idx = s.orders.findIndex((o) => recipeKey(o.recipe) === key);
  if (idx === -1) {
    emit(s, { t: 'serveWrong', at });
    if (!plateIsWorkInProgress(s, plate)) s.score.combo = 0;
    return;
  }
  const order = s.orders[idx];
  s.orders.splice(idx, 1);
  s.score.combo += 1;
  s.score.bestCombo = Math.max(s.score.bestCombo, s.score.combo);
  s.score.served += 1;
  // Fresher tickets tip better; combos multiply. Rewards flow, not hoarding.
  const freshness = 0.6 + 0.4 * (order.remaining / order.total);
  const comboMul = 1 + Math.min(1.5, (s.score.combo - 1) * 0.15);
  const value = Math.round(order.recipe.baseValue * freshness * comboMul * (plate.botMade === true ? s.director.botServeValueMul : 1));
  s.score.coins += value;
  s.score.patience = Math.min(1, s.score.patience + TUNING.patiencePerServe);
  chef.carrying = null;
  emit(s, { t: 'serve', at, value, combo: s.score.combo, orderId: order.id });
}

// ------------------------------------------------------------- stations

function updateStations(s: SimState, dt: number) {
  for (const st of s.kitchen.stations) {
    const at = stationCenter(st);
    if (st.kind === 'board' && st.holding?.type === 'ingredient') {
      const ing = st.holding.ingredient;
      const def = INGREDIENT_DEFS[ing.kind];
      if (def.chopSeconds > 0 && ing.state === 'raw') {
        if (st.active) {
          // THE PROGRESS BELONGS TO THE FOOD, NOT TO THE BENCH. Chopping used
          // to live in `st.work`, which every pickup and every place reset to
          // zero: lifting a tomato off a board — to check it, to make room, or
          // because a bump landed on the grab button — silently threw away up
          // to 1.4 seconds of work, and putting it straight back started from
          // nothing. It rides on the ingredient now, so the mistake costs the
          // walk and not the chopping.
          ing.chop = (ing.chop ?? 0) + dt / def.chopSeconds;
          emit(s, { t: 'chopTick', at, progress: Math.min(1, ing.chop) });
          if (ing.chop >= 1) {
            ing.state = 'prepped';
            ing.chop = 0;
            emit(s, { t: 'chopDone', at, kind: ing.kind });
          }
        }
        // Mirrored onto the station every tick so the progress ring shows a
        // part-chopped item sitting idle on a board, which is now a state the
        // kitchen can be in and something the player needs to be able to see.
        st.work = ing.state === 'raw' ? (ing.chop ?? 0) : 0;
      }
    }

    if (st.kind === 'sink' && st.holding?.type === 'plate' && st.holding.plate.dirty) {
      if (st.active) {
        st.work += dt / 2.2;
        if (st.work >= 1) {
          st.holding.plate.dirty = false;
          st.work = 0;
          emit(s, { t: 'washDone', at });
        }
      }
    }

    if (st.kind === 'stove' && st.holding?.type === 'pan') {
      const pan = st.holding.pan;
      pan.onHeat = true;
      /**
       * ONE NUMBER FOR "COOKING" AND ONE FOR "ABOUT TO BURN".
       *
       * The pan can hold three things at different stages, so the arc the
       * player reads has to pick. It picks the WORST case in each direction:
       * the least-cooked item drives `cook` (the pan is not done until the last
       * rasher is), and the most-overcooked drives `burn` (the pan is in danger
       * as soon as ANY of it is). Anything else would show a reassuring number
       * while something in there was catching fire.
       */
      let minCook = 1;
      let maxBurn = 0;
      let cooking = false;
      for (const ing of pan.contents) {
        const def = INGREDIENT_DEFS[ing.kind];
        if (def.cookSeconds <= 0) continue;
        if (ing.state === 'raw' || ing.state === 'prepped') {
          cooking = true;
          minCook = Math.min(minCook, ing.progress);
        } else if (ing.state === 'cooked' && Number.isFinite(def.burnSeconds)) {
          maxBurn = Math.max(maxBurn, Math.min(1, ing.overcook / (def.burnSeconds * s.director.burnTimeMul)));
        } else if (ing.state === 'burnt') {
          maxBurn = 1;
        }
      }
      st.cook = cooking ? minCook : 0;
      st.burn = maxBurn;
      for (const ing of pan.contents) {
        const def = INGREDIENT_DEFS[ing.kind];
        if (def.cookSeconds <= 0) continue;
        if (ing.state === 'raw' || ing.state === 'prepped') {
          ing.progress += dt / def.cookSeconds;
          if (ing.progress >= 1) {
            ing.progress = 0;
            ing.state = 'cooked';
            emit(s, { t: 'cookDone', at, kind: ing.kind });
          }
        } else if (ing.state === 'cooked' && Number.isFinite(def.burnSeconds)) {
          ing.overcook += dt;
          if (ing.overcook >= def.burnSeconds * s.director.burnTimeMul) {
            ing.state = 'burnt';
            emit(s, { t: 'burn', at });
          }
        } else if (ing.state === 'burnt') {
          const before = pan.fire;
          pan.fire = Math.min(1, pan.fire + dt / 9);
          if (before < 1 && pan.fire >= 1) emit(s, { t: 'fireStart', at });
        }
      }
    } else if (st.holding?.type === 'pan') {
      st.holding.pan.onHeat = false;
      st.cook = 0;
      st.burn = 0;
    } else {
      st.cook = 0;
      st.burn = 0;
    }

    st.active = false;
  }
}

// --------------------------------------------------------------- orders

function pickRecipe(s: SimState): Recipe {
  // Unlock deeper recipes as heat rises so minute one is always fair.
    const unlocked = Math.max(2, Math.min(RECIPES.length, 2 + Math.floor(s.heat * (RECIPES.length - 2) + 0.5)));
  // Assist gating (DirectorKnobs.recipeDepthCap): while a crew is learning,
  // the board never asks for a recipe bigger than the cap. At the default
  // (Infinity) the pool is exactly the unlocked prefix and every draw below
  // is bit-identical to the pre-knob code — same rand() count, same indices.
  let pool = RECIPES.slice(0, unlocked).filter((r) => r.components.length <= s.director.recipeDepthCap);
  if (pool.length === 0) pool = RECIPES.slice(0, 2);
  const i = Math.floor(s.rand() * pool.length);
  const pick = pool[Math.min(i, pool.length - 1)];
  // NEVER TWO IDENTICAL TICKETS ON THE BOARD.
  //
  // The reference's two balloons are always visibly different, and that
  // difference is half the read — a glance tells you which pass wants what. We
  // shipped runs where both live orders were "Bacon Roll" and the two tickets
  // rendered pixel-identical, at which point the colour-coded passes are
  // carrying the entire load. Walk forward from the drawn index to the first
  // recipe nobody is already waiting on; if every unlocked recipe is live,
  // fall through and accept the duplicate rather than starve the board.
  if (s.orders.some((o) => o.recipe.id === pick.id)) {
    for (let k = 1; k < pool.length; k++) {
      const alt = pool[(Math.min(i, pool.length - 1) + k) % pool.length];
      if (!s.orders.some((o) => o.recipe.id === alt.id)) return alt;
    }
  }
  return pick;
}

/** Push one ticket onto the board and announce it. */
function addOrder(s: SimState, recipe: Recipe) {
  const timeScale = 1 - 0.28 * s.heat;
  const order: Order = {
    id: s.nextId++,
    recipe,
    remaining: recipe.baseSeconds * timeScale * s.director.ticketTimeMul,
    total: recipe.baseSeconds * timeScale * s.director.ticketTimeMul,
    createdTick: s.tick,
  };
  s.orders.push(order);
  emit(s, { t: 'orderNew', orderId: order.id });
  return order;
}

/**
 * TWO TICKETS FROM FRAME ONE.
 *
 * The kitchen has two mirrored passes with a server standing at each, and the
 * first ticket used to land at t≈1.2 with the second nine and a half seconds
 * behind it. For the whole opening of every run — and for every frame of a
 * screenshot — the back wall carried one balloon on the left and empty air over
 * an identically dressed station on the right, which reads as a bug rather than
 * as a lull. The reference opens on a balanced pair and so do we. Distinct
 * recipes, so the two balloons are not the same picture twice.
 */
export function seedOrders(s: SimState) {
  const a = addOrder(s, pickRecipe(s));
  let b = pickRecipe(s);
  for (let i = 0; i < 4 && b.id === a.recipe.id; i++) b = pickRecipe(s);
  addOrder(s, b);
  // Long enough that the opening of a run reads as the reference's balanced
  // pair rather than as a board already three deep before the player moves.
  s.nextOrderIn = 13;
}

function updateOrders(s: SimState, dt: number) {
  // Heat ramps over ~4 minutes, then plateaus. Score attack should crest, not cliff.
  s.heat = Math.min(1, s.time / 240);

  s.nextOrderIn -= dt;
  const maxOrders = 3 + Math.floor(s.heat * 2) + s.director.maxOrdersBonus;
  if (s.nextOrderIn <= 0 && s.orders.length < maxOrders && s.time < TUNING.roundSeconds) {
    addOrder(s, pickRecipe(s));
    const gap = 9.5 - 5.0 * s.heat;
    s.nextOrderIn = gap * s.director.orderGapMul * (0.8 + s.rand() * 0.4);
  }

  for (let i = s.orders.length - 1; i >= 0; i--) {
    const o = s.orders[i];
    o.remaining -= dt;
    if (o.remaining <= 0) {
      s.orders.splice(i, 1);
      s.score.missed += 1;
      s.score.combo = 0;
      s.score.patience = Math.max(0, s.score.patience - TUNING.patiencePerMiss * s.director.patienceMissMul);
      emit(s, { t: 'orderExpired', orderId: o.id });
    }
  }

  // The clock in the HUD counts TUNING.roundSeconds down; service has to
  // actually end when it reaches zero or that number is decoration.
  if ((s.score.patience <= 0 || s.time >= TUNING.roundSeconds) && !s.over) {
    s.over = true;
    emit(s, { t: 'gameOver', score: s.score.coins });
  }
}

// ----------------------------------------------------------------- step

/**
 * Advance the sim exactly one fixed tick. `inputs` is indexed by chef id.
 * Callers must drain `state.events` after each step.
 */
/**
 * THE FOUR PHASES OF A TICK, EXPORTED SEPARATELY.
 *
 * `step()` below is still the only sanctioned way to advance a whole sim, and
 * its behaviour is unchanged. The phases exist as named exports because the
 * Roblox port splits authority down exactly these seams: a client integrates
 * `movePhase` for its own chef (zero-latency feel), while the server owns
 * collisions, interaction, stations and orders. Keeping the seams here — in
 * the file that defines the ordering — is what stops the two halves from
 * drifting apart.
 */

/** Integrate one chef's movement. Phase 1 of a tick. */
export function movePhase(s: SimState, chef: Chef, input: InputSnapshot, dt: number) {
  moveChef(s, chef, input, dt);
}

/** Chef-vs-chef separation, bumps, knockback. Phase 2 of a tick. */
export function collidePhase(s: SimState, dt: number) {
  resolveChefCollisions(s, dt);
}

/** Stations advance work/cook/burn; orders spawn, expire, and end the round. Phase 4. */
export function stationPhase(s: SimState, dt: number) {
  updateStations(s, dt);
  updateOrders(s, dt);
}

export function step(s: SimState, inputs: InputSnapshot[]) {
  if (s.over) return;
  const dt = SIM_DT;
  s.tick++;
  s.time += dt;

  for (const chef of s.chefs) {
    const input = inputs[chef.id] ?? NO_INPUT;
    movePhase(s, chef, input, dt);
  }
  collidePhase(s, dt);

  for (const chef of s.chefs) {
    const input = inputs[chef.id] ?? NO_INPUT;
    interactPhase(s, chef, input, dt);
  }

  stationPhase(s, dt);
}

/**
 * Focus, the grab buffer, and the committed job — one chef's interaction
 * slice of a tick. Phase 3. Order inside this function is load-bearing;
 * every block below carries the comment explaining why.
 */
export function interactPhase(s: SimState, chef: Chef, input: InputSnapshot, dt: number) {
  {
    /**
     * Gate first, coyote second, and the coyote timer is spent HERE so that
     * `findFocus` stays a pure question anyone can ask. A tick the gate wins
     * refills the timer; a tick it loses spends it.
     */
    const gated = gateFocus(s, chef);
    chef.focusHold = gated ? TUNING.focusCoyote : Math.max(0, chef.focusHold - dt);
    const st = gated ?? coyoteFocus(s, chef);
    chef.focus = st?.id ?? null;
    // Published every tick so the view can say what the press will do BEFORE
    // it happens. Same plan `doGrab` runs, so the prompt cannot lie.
    chef.focusAction = planGrab(s, chef, st);

    /**
     * CANCEL IS ANSWERED FIRST, AND THAT ORDERING IS THE WHOLE FIX.
     *
     * A committed chop is cancelled by pressing the button again. Handled
     * further down — after the grab buffer — that press would reach `doGrab`,
     * resolve to 'prep' against the same board, and re-commit on the very tick
     * it was meant to cancel. The job would look uncancellable and the button
     * dead. So the press is consumed HERE, before anything else can read it.
     */
    if (chef.working !== null && input.grabPressed) {
      chef.working = null;
      chef.grabBuffer = 0;
      if (chef.intent === 'working') chef.intent = 'idle';
      return;
    }

    /**
     * THE PRESS IS A REQUEST, NOT AN INSTANT.
     *
     * This used to be `if (chef.stun > 0) continue; if (input.grabPressed)
     * doGrab(...)`: the press had to arrive on exactly the tick the gate said
     * yes, and any press that arrived during a stun was deleted before it was
     * even read. Both are now the same buffer.
     *
     * The buffer does NOT decay while stunned. A bump is 160ms and the buffer
     * is 150ms, so a decaying buffer would still have destroyed a press made on
     * the first tick of a bump — the exact case rig 2 measures. Freezing it
     * means the press waits out the stun and lands the instant the chef has his
     * feet back, which is what "I pressed grab" meant.
     */
    if (input.grabPressed) chef.grabBuffer = TUNING.grabBufferSeconds;
    else if (chef.stun <= 0 && chef.grabBuffer > 0) {
      chef.grabBuffer = Math.max(0, chef.grabBuffer - dt);
      // Expired without ever finding an answer. This is a failed press, and
      // announcing it on the press tick instead would slander every press that
      // is merely early.
      if (chef.grabBuffer === 0) emit(s, { t: 'grabMiss', chef: chef.id, at: { x: chef.pos.x, y: chef.pos.y } });
    }
    if (chef.stun > 0) return;
    if (chef.grabBuffer > 0) {
      if (doGrab(s, chef, st)) chef.grabBuffer = 0;
      else if (input.grabPressed && len(chef.vel) < TUNING.grabBufferMinSpeed) {
        /**
         * A STANDING CHEF'S REFUSAL IS ANSWERED ON THE FRAME IT HAPPENS.
         *
         * The buffer exists to bridge TRAVEL — to let a press made a tenth of a
         * second before you arrive still be the grab you meant. A chef who is
         * not moving is not about to arrive anywhere: the set of stations
         * inside `reach` cannot change, so waiting 150ms to admit the press
         * failed buys the player nothing and costs them nine frames of silence.
         * REFERENCE.md wants a visible response inside ONE frame.
         *
         * What this gives up is small and worth naming: a chef standing at a
         * stove who presses just before the pan finishes cooking no longer gets
         * the grace window, because the thing that changed was the station and
         * not the chef. Press again.
         */
        chef.grabBuffer = 0;
        emit(s, { t: 'grabMiss', chef: chef.id, at: { x: chef.pos.x, y: chef.pos.y } });
      }
    }
    /**
     * THE COMMITTED JOB, AND EVERY WAY OUT OF IT.
     *
     * `chef.working` is set by a tap (see doGrab's 'prep') and runs the station
     * with no button held. It clears on the four things that genuinely end a
     * job, and nothing else — in particular NOT on the movement stick, because
     * being unable to wander off mid-chop is the feedback that says you are
     * committed:
     *   - the work finished, so the station no longer wants any
     *   - the chef walked out of reach (knockback, a shove from a bot)
     *   - the chef is holding something, so this is no longer a free hand
     *   - the player pressed the button again, which is the deliberate escape
     */
    if (chef.working !== null) {
      const ws = stationById(s.kitchen, chef.working);
      const stillWants =
        !!ws &&
        !chef.carrying &&
        boxDist(ws, chef.pos.x, chef.pos.y) <= TUNING.reach &&
        ((ws.kind === 'board' &&
          ws.holding?.type === 'ingredient' &&
          ws.holding.ingredient.state === 'raw' &&
          INGREDIENT_DEFS[ws.holding.ingredient.kind].chopSeconds > 0) ||
          (ws.kind === 'sink' && ws.holding?.type === 'plate' && ws.holding.plate.dirty));
      if (!stillWants) {
        chef.working = null;
        if (chef.intent === 'working') chef.intent = 'idle';
      } else {
        ws.active = true;
        chef.intent = 'working';
      }
    }
    // The held path stays for the bots, which emit a 'use' job rather than a
    // tap, and for anything else driving InputSnapshot directly.
    if (input.useHeld && st) {
      // Same three-way agreement as planGrab above: without the chopSeconds
      // test this lights the station and puts the chef into 'working' over a
      // bun that updateStations will never advance — a chef miming a chop
      // forever at a board that cannot be used.
      const usable =
        (st.kind === 'board' &&
          st.holding?.type === 'ingredient' &&
          st.holding.ingredient.state === 'raw' &&
          INGREDIENT_DEFS[st.holding.ingredient.kind].chopSeconds > 0) ||
        (st.kind === 'sink' && st.holding?.type === 'plate' && st.holding.plate.dirty);
      if (usable && !chef.carrying) {
        st.active = true;
        chef.intent = 'working';
      }
    }
  }
}

/** Seed the kitchen with the pans the run starts with. */
export function seedPans(s: SimState) {
  const stoves = s.kitchen.stations.filter((st) => st.kind === 'stove');
  for (const st of stoves) {
    st.holding = { type: 'pan', pan: mkPan(s) };
  }
}
