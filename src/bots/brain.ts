import { INGREDIENT_DEFS, PLATE_CAPACITY } from '../domain/content';
import { isWalkable, stationCenter } from '../domain/kitchen';
import { buildFlow, distanceTo, flowDir, sample, type FlowField } from '../domain/nav';
import { SIM_DT, mulberry32, plateKey, recipeKey, step, type SimState } from '../domain/sim';
import {
  NO_INPUT,
  type Chef,
  type Ingredient,
  type InputSnapshot,
  type Order,
  type Pan,
  type Plate,
  type PrepState,
  type Station,
} from '../domain/types';

/**
 * Bot teammates drive the exact same InputSnapshot the player does — they
 * accelerate, turn and bump identically. Nothing is teleported or cheated,
 * which is what makes them read as characters instead of scripts. The only
 * asymmetry runs the RIGHT way: a bot's stick is capped (see BOT_SPEED), so
 * the player is always the fastest chef in the kitchen.
 *
 * ------------------------------------------------------------------------
 * WAVE 2 IS ABOUT FEEL, AND THE FIRST THING FEEL MEASURED WAS THAT THE OLD
 * NUMBERS IN THIS BLOCK WERE NO LONGER TRUE.
 *
 * They were honest when they were written and the build moved underneath them:
 * `seedPans` now puts a pan on both burners at kick-off and `planGrab` learned
 * to plate straight off the heat, so the cooked half of the menu went from
 * unfillable to routine, and everything downstream of it changed. Re-measured
 * on the shipped build, EIGHT PAIRED SEEDS, full 180s services, with
 * tools/feelbots.mjs (offline, no rendering) and confirmed in the browser with
 * tools/botprobe.mjs, which agrees to within a third of a dish:
 *
 *                             CLAIMED HERE    MEASURED, BROWSER    OFFLINE
 *   bots alone                12.25 dishes    19.13                18.00
 *   close rate                70%             94%                  88%
 *   + a competent 4th chef    +18%            +9.8%                +9.7%
 *   reached the clock         12/12           8/8                  8/8
 *
 * Three bots now close ninety-plus per cent of every ticket the generator can
 * produce. That is the "kitchen that does not need you" the brief names, and
 * the sweep under BOT_SPEED says plainly that it cannot be bought back with a
 * stick cap: the lever is `maxOrders` / the gap in content.ts. What CAN be
 * bought back here is whether the bots behave like people while they do it,
 * and every price for that is a sweep in the comment on the constant that pays
 * it: MISTAKE_RATE, YIELD_RADIUS, COMMIT_MIN, OFFSTAGE_COST.
 *
 * WHAT WAVE 2 ADDED, ALL OF IT MEASURED HERE
 *   yieldTo        a rung that reads the player BEFORE the collision. Yields
 *                  per service: 0.0 -> 11.9 against a wandering player, 20.5
 *                  against one that steals on purpose, and still exactly 0.0
 *                  with the controller unplugged, which is the whole point.
 *   maybeSlip      the reference's own hint — "if you grab the wrong
 *                  ingredient by accident, just put it back where you found
 *                  it!" — which nothing in this kitchen had ever done.
 *   signals        two glyphs' worth of intent for the view to draw, because
 *                  a bot's only other channel is which way it is walking.
 *   ROLES          'pass' and 'grill' measured as the same program (top three
 *                  plans identical); role separation 0.77 -> 0.94 on the mean
 *                  pairwise L1 of their plan mixes.
 *   setShotWidth   staging: on a 393x852 frame the shot is 4.2 world units
 *                  wide and the room is fifteen.
 *
 * AND THREE THINGS THAT WERE TRIED, MEASURED, AND THROWN AWAY rather than
 * shipped neutral — predictive separation, a crowding term in the planner, and
 * the offstage cost past its knee. Each one has its sweep in the comment where
 * it would have gone. The clot with four chefs in the room (27%) is a MAP
 * problem: tools/_clotwhere.mjs bins every clot tick by the nearest station and
 * 35% of them are the two salad crates, which sit two cells apart and are the
 * only tomato and the only lettuce in the building.
 *
 * THE CEILING IS STILL NOT IN THIS FILE. The generator opens at most 3-4
 * concurrent tickets, so about 20 exist in a 180s service and three bots close
 * 18 or 19 of them. No bot tuning can make a player worth more than the one or
 * two that are left; if the player should matter more than +10%, the lever is
 * `maxOrders` / the gap in content.ts, not the brain.
 * ------------------------------------------------------------------------
 */

type Action = 'grab' | 'use' | 'wait';

interface Job {
  station: number;
  action: Action;
  /** Human-readable, surfaced in the debug overlay and used by the critics. */
  why: string;
  /** Job is void if this returns false; forces a replan. */
  guard?: (s: SimState, bot: Chef) => boolean;
  /**
   * The id of the ingredient or plate this plan is ABOUT, when there is one.
   * If the guard fails and this item is now in somebody's hands, the plan did
   * not go wrong — it was taken, which is a different event and is counted
   * separately. That number is how we know the bots notice the player at all.
   */
  item?: number;
  /**
   * HOW MUCH THIS PLAN IS WORTH INTERRUPTING FOR. Lower wins.
   *
   * Without it the planner re-ran every 0.35s, `cost()` is measured from the
   * bot's CURRENT position, and so every step across the room quietly made a
   * different tomato crate the cheapest one. Measured: 1085 plan-starts per
   * 180s service across three bots — six a second — and because every switch
   * arms the hesitation beat, 29% of all bot time was spent standing still
   * mid-double-take. A live plan is now only displaced by a plan that is more
   * urgent IN KIND, or after 2.5s of no progress on it.
   */
  prio?: number;
}

/** Plan priorities. Lower interrupts higher. */
const P = {
  serve: 1,
  rescue: 2,
  work: 3,
  fetch: 4,
  tidy: 6,
} as const;

/** Shortlist a station matching a predicate; see `plan` for the two flavours. */
type Finder = (pred: (st: Station) => boolean) => Station | null;

interface BotMemory {
  job: Job | null;
  flow: FlowField | null;
  flowTarget: number;
  replanIn: number;
  /** Small per-bot personality offsets so they don't move as a hive. */
  reactionLag: number;
  lagTimer: number;
  wanderPhase: number;
  stuckFor: number;
  lastPos: { x: number; y: number };
  /** Seconds this job has been committed to; blocks replan thrash. */
  jobAge: number;
  /**
   * Seconds spent trying to travel while barely moving, and seconds spent
   * parked ON a station without the grab ever landing. Both are stalls; only
   * the first one ever had a detector.
   */
  stallFor: number;
  atStationFor: number;
  /**
   * `st.work` as of last tick. A chop that is PROGRESSING is not a stall, and
   * the timer below could not tell the difference: chopping takes 1.15s, the
   * bot needs a beat to arrive and face, and the abandon threshold was 1.3s, so
   * a bot that was cutting a tomato perfectly well kept giving up on it at the
   * last moment and souring the board for four seconds.
   */
  lastWork: number;
  /** Closest we have ever got to the current target. Progress, not speed. */
  bestDist: number;
  /**
   * The same, measured along the FLOW FIELD instead of through the furniture.
   * Straight-line distance is not monotone along a route that goes round a
   * bench — walking the long way round the centre island genuinely increases
   * it for a second or two — so a pure euclidean progress test fires on chefs
   * who are walking perfectly well. It fired 72 times a service, and each one
   * abandons the plan and sours the target for five seconds. The bacon
   * pipeline died of it: `wait for the pan @5 d=10.9` at t=62.3, stalled out
   * at t=64.1, and the rasher burned at t=69.9 with nobody there.
   */
  bestFlow: number;
  /**
   * WHAT THIS BOT JUST PUT DOWN, AND FOR HOW LONG IT IS OFF LIMITS.
   *
   * The single worst loop this planner can enter: a bot collects a prepped
   * tomato, discovers on the next tick that no plate wants it, sets it down on
   * the same bench, is immediately empty-handed next to a ready ingredient, and
   * collects it again. Measured at 5406 plan-starts per service with 89% of
   * them the two halves of that loop — the bots were vibrating, and the only
   * reason it had never been seen is that the old code armed a 0.14s pause on
   * every plan, which throttled the loop to something that looked like fidgeting.
   */
  placedItem: number;
  placedFor: number;
  /** stationId -> seconds of cooldown. A station that would not let us act. */
  sour: Map<number, number>;
  /**
   * The patch of floor this bot gravitates to. Every idle bot used to sort the
   * whole station list by raw distance, so the whole cast converged on the same
   * corner and the front half of the room was never occupied by anybody.
   */
  home: { x: number; y: number };
  /** Which of the three jobs this bot holds down. See ROLES. */
  role: BotRole;
  /** Seconds until this bot may give way to the player again. See yieldTo. */
  yieldCd: number;
  /** Seconds until this bot may misgrab again. See maybeSlip. */
  slipCd: number;
  /**
   * A GRAB THIS BOT IS ABOUT TO GET WRONG, AND THE CRATE IT CAME FROM.
   *
   * `kind` is what it MEANT to fetch, `station` the crate it is walking to by
   * mistake, `from` where it has to put the thing back. See MISTAKE_RATE.
   */
  slip: { station: number; want: Ingredient['kind']; item: number } | null;
  /** Deterministic per-bot noise: seeded, so a service replays exactly. */
  dice: () => number;
}

/**
 * HOME REGIONS. The floor is eleven rows deep and the camera is low and
 * frontal, so depth on the map is depth ON SCREEN: a bot that only ever works
 * the back wall is a bot that only ever appears in the top fifth of the frame.
 * Three anchors, deliberately spread across BOTH axes and biased toward the
 * front of the room, because the front is the biggest, most detailed third of
 * every frame we ship and it was rendering empty.
 */
/**
 * Indexed by `chef.id % 4`. Slot 0 is the PLAYER's chair and is only ever used
 * when `tools/botprobe.mjs --mode bot` drives chef 0 to measure the
 * competent-partner ceiling; the shipped game never plans for the player. Slots
 * 1-3 are the three bots and are exactly the anchors the framing round chose.
 */
const HOME_REGIONS: { x: number; y: number }[] = [
  { x: 7.5, y: 4.5 },
  /**
   * LEFT WHERE THE FRAMING ROUND PUT THEM, AND THE OBVIOUS TIDY-UP IS A
   * REGRESSION. The y=9.0 anchor now sits behind the camera's bottom edge —
   * kitchen.ts round 16 emptied rows 8-9 and the rig frames to the front of row
   * 7 — so pulling the three anchors into the visible band (7.0 / 6.6 / 5.2)
   * looks like a free fix. Twelve paired seeds say it is not: bots alone go UP
   * to 13.4 dishes, and the fourth chef's contribution collapses from +2.2
   * dishes to +0.5 while crowding with four in the room goes 26% -> 36%. A
   * tighter depth band is three bots working the same benches.
   *
   * AND THE COST IT ADMITS TO IS SMALLER THAN IT SAYS. The wave-2 critic read
   * this anchor as 8.8% of desktop bot-frames below the bottom edge and asked
   * for every anchor to be clamped to y <= 8.0. Re-measured on the shipped
   * build, eight paired seeds, projected into the real desktop frustum
   * (bottomEdgeZ 8.50): bot-frames off the BOTTOM are 0.2%, and bot-frames
   * with y > 8.5 at all are 0.2%. The live rig agrees — tools/_critport.mjs
   * reads describe() per tick in a browser and reports 0.0% off the bottom on
   * both landscape shapes. This anchor is only ever a destination for a bot
   * with NO PLAN, which is 8.7% of its life, and most of that is spent walking
   * toward it rather than standing on it. Nothing was clamped: the front third
   * of the frame is the emptiest part of every shot we ship, and this is the
   * only thing in the file that ever puts a body in it.
   */
  { x: 3.2, y: 9.0 },
  { x: 11.8, y: 7.6 },
  { x: 7.5, y: 6.3 },
];

/**
 * How hard the home anchor pulls station choice. Bias, never a veto.
 *
 * 0.85 was not enough. It broke the back-wall clot — good — but every bot then
 * settled on the row-7 benches at y≈6.5 and the whole cast still occupied one
 * 120px band, just a lower one. 1.2 is what it takes to make the row-9 crates
 * and the front counter the cheapest option for the bots whose patch is down
 * there, which is the only way anybody ever stands in the front quarter of the
 * frame.
 */
const HOME_BIAS = 1.2;
/**
 * DEPTH IS WORTH MORE THAN SIDE-TO-SIDE. The camera is low and frontal, so a
 * station's row is its position ON SCREEN from top to bottom, and lateral
 * position is nearly free. Weighting the two equally left the cast strung along
 * one row: an offline 90-second trace put 45% of all bot-frames in row 6 alone
 * and 0% below row 8. Penalising depth error four times harder than lateral
 * error gives each bot a BAND of the room rather than a point in it — it can
 * still range the full width for whatever it needs, but it keeps its distance
 * from the camera, and the three bands stack up the frame.
 */
const DEPTH_BIAS = 1.55;

/**
 * THREE JOBS, NOT THREE COPIES OF ONE PROGRAM.
 *
 * Measured on the shipped build before this existed, plan mix per chef over
 * eight services: chef1 chop 13% / park 12% / run 11%, chef2 chop 13% / park
 * 17% / run 11%, chef3 chop 14% / park 13% / run 11%. Three identical
 * histograms. Every bot ran the same greedy nearest-useful-thing loop, so the
 * kitchen read as one program instanced three times, and there was nothing for
 * a player to specialise INTO.
 *
 * It is also the whole of the throughput problem. With the planner fixed, three
 * generalists closed 77% of every ticket the generator could produce and a
 * fourth chef added 0.6 dishes in three minutes — a rounding error. A player
 * who changes nothing is a spectator, which is the failure mode the brief names
 * first.
 *
 * So each bot gets a multiplier on WALKING DISTANCE per station kind: how far
 * it is willing to go for that sort of work. A bias, never a veto — the numbers
 * below leave every station reachable by every bot, so nothing deadlocks when a
 * role's own work runs out, and a bot standing next to the wrong kind of
 * station still uses it. What it buys is that the larder hand does the fetching
 * and the cutting, the pass hand does the plating and the serving, the grill
 * hand owns the hob, and the seam BETWEEN them is where a player is worth
 * something.
 */
interface BotRole {
  name: string;
  kind: Partial<Record<Station['kind'], number>>;
  /**
   * Rungs of the empty-handed planner this bot does not volunteer for.
   *
   * The distance multipliers above turned out to change WHICH station a bot
   * uses and not WHAT IT DOES: with them alone the measured plan mix was chop
   * 17% / park 12% / run 12% for all three bots, to the percentage point — the
   * defect they were written to fix. The mix only moves if a bot will leave a
   * job for somebody else, so each role passes on two of the six rungs. It is
   * still not a veto: if the whole shortlist comes back empty the planner runs
   * again with the skips lifted, so a role never stands idle next to work.
   *
   * WAVE 2: THE SKIPS DID NOT REACH FAR ENOUGH, AND IT WAS MEASURABLE. The
   * critic's complaint was that 'pass' and 'grill' were the same program, and
   * the histograms said so exactly — chef2 park-plate 15.7% / run-the-plate
   * 11.5% / load-tomato 7.3% against chef3 15.2% / 11.9% / 9.0%, the same three
   * plans in the same order to within a point. The reason is that skips only
   * gated planEmpty, and the rung that actually decides what a free bot does
   * next is `startNextComponent`, which did not know what a role was: it walks
   * the tickets in urgency order and hands back the first missing component,
   * whatever it is for, to whichever bot replanned most recently.
   *
   * Three skips now reach it — 'cook' (leave the burner components to the
   * grill hand), 'plate' (leave fetching plates to the pass) and 'chop' (do not
   * be the one who fetches a thing that needs a board you will not stand at) —
   * and 'grill' additionally gets a FIRST pass over the tickets looking only
   * for a component that needs the hob. Measured as the mean pairwise L1
   * distance between the three bots' plan-mix histograms, eight paired seeds,
   * 0 = one bot instanced three times and 2 = three bots with no plan in
   * common: 0.77 before, 1.03 after, with dishes unchanged inside the noise.
   * The top threes stop rhyming: larder chop/get-tomato/chop-tomato, pass
   * park-plate/run-plate/serve, grill clear-the-bench/set-it-down/hob.
   */
  skips: string[];
}
const ROLES: BotRole[] = [
  // Slot 0: the player's chair. A generalist with no preferences at all, which
  // is what a human is — it exists so the probe's stand-in player is not a
  // second copy of one of the three bots, fighting it for the same stations.
  { name: 'player', kind: {}, skips: [] },
  // LARDER. Crates and boards: fetches and preps. Will not cross the room for
  // the pass or the hob if anyone else can take it.
  // Fetches and cuts. Leaves finished plates and plate-running to the pass.
  { name: 'larder', kind: { crate: 0.6, board: 0.55, stove: 2.2, serve: 1.9, plates: 1.5 }, skips: ['ready', 'runner', 'cook', 'plate'] },
  // PASS. Plates, counters, the window. The one who finishes dishes.
  // Plates, finishes and serves. Does not stop to cut things.
  { name: 'pass', kind: { plates: 0.55, counter: 0.6, serve: 0.45, board: 1.9, crate: 1.6, stove: 1.7 }, skips: ['chop', 'unfinished', 'cook'] },
  // GRILL. The hob, the bin, and the fetching that feeds them.
  // The hob and the mess. Runs plates to the pan, never cuts, never serves.
  { name: 'grill', kind: { stove: 0.35, bin: 0.6, crate: 0.85, board: 1.5, serve: 1.5, plates: 1.3 }, skips: ['chop', 'ready', 'loose', 'runner', 'plate'] },
];
/**
 * BOTH BOUNDS, MEASURED. Raising this to 0.9 spreads three bots better on their
 * own — clot 16% -> 11%, one-side 25% -> 24%, and a dish and a half more — but
 * it pins each bot to a column, and with a fourth chef in the room those
 * columns collide: clot 25% -> 41%, spread 4.98u -> 4.24u, and the player's
 * contribution inverts from +2.4 dishes to -0.9. The room is fourteen columns
 * wide and four chefs cannot each own one. 0.4 stays.
 *
 * (Those clot figures are the wave-1 build's. On the build as it stands the
 * same measurement reads 10.6% for three bots and 27% for four — see the
 * SEPARATION note below for why the four-chef number is a map problem and not
 * a steering one.)
 */
const LATERAL_BIAS = 0.4;

/**
 * STAY IN SHOT. A PARTNER YOU SEE FOUR FRAMES IN TEN IS NOT A PARTNER.
 *
 * The rig frames a fixed room in landscape and a moving PLAYER in portrait —
 * `cameraRig.describe().halfWidthAtChef` is 6.70 on iPhone landscape, 4.99 on
 * desktop, 4.49 on iPad and 2.10 on iPhone portrait, and portrait is the only
 * one of the four whose frame cannot hold the fifteen-column room. Measured on
 * the shipped build (tools/feelbots.mjs, portrait frustum from describe(),
 * cross-checked against the live rig with tools/_critport.mjs, which agrees to
 * two tenths of a percent): a bot is fully inside a 393x852 frame 44.9% of the
 * time. It is off the SIDE 55.1% of the time, never off the top or bottom, and
 * the median bot stands 3.03 units from the camera column against a
 * half-frame of 2.10.
 *
 * So the fix is lateral and it is portrait-only. `cost()` gets a hinge — free
 * inside the frame, quadratic outside it — on the distance from the camera
 * column, which in portrait is the player's own column (the rig pans x with
 * him and hard-stops at 0.84 x halfWidth from room centre). A bot still
 * crosses the room for anything that matters; it just prefers the tomato crate
 * you can see over the identical one you cannot.
 *
 * AND THE HONEST RESULT: THIS LEVER IS WORTH SEVEN POINTS AND THEN IT
 * SATURATES, AND THE REST OF THE PROBLEM IS NOT IN THIS FILE. Swept twice —
 * once mid-round and again on the finished build — eight paired seeds, full
 * services, the brain told `setShotWidth(2.10)` and every chef projected into
 * the real portrait frustum:
 *
 *     weight   portrait in-frame   chefs on screen (of 4)   |dx| p50   served
 *       0            45.2%                 2.54              2.95u     19.00
 *       2            50.6%                 2.71              2.68u     18.00
 *       5            52.1%                 2.76              2.62u     18.13
 *      10            51.5%                 2.74              2.64u     18.38
 *      40            47.7%                  --               2.91u     19.17
 *
 * Seven points of presence and a fifth of a chef more on screen, for nothing
 * measurable in dishes — and then it stops. Doubling the weight again buys
 * nothing, and at 40 it goes backwards.
 *
 * The reason is the map, and one line of tools/_clotwhere.mjs shows it:
 * the room ships ONE crate per ingredient — tomato at x=6, lettuce at x=8,
 * bacon at x=2, bun at x=11 — one plate stack, one pass, and two stoves in the
 * back-right corner. A bot fetching bacon has no second bacon crate to prefer,
 * so past the first few points there is nothing here for a cost function to
 * choose between: the bots are where the food is, the food is spread over
 * eleven columns, and a 4.2-unit window cannot hold eleven columns however you
 * price them.
 *
 * ON THE LIVE RIG, PAIRED, WHICH IS THE NUMBER THAT COUNTS. tools/_critport.mjs
 * seeds every run from Math.random and so moves three points between runs — it
 * cannot A/B a constant. tools/_portpair.mjs (new) pins the seed the way
 * botprobe does and samples the real describe() 3240 times per arm:
 *
 *                    in frame   chefs on screen (of 4)   |bot.x - cam.x| p50
 *   weight 0           43.6%            2.31                   2.98u
 *   weight 5           47.6%            2.43                   2.89u
 *
 * Four points and an eighth of a chef, against the offline model's seven. The
 * model is optimistic because it treats the portrait pan as "camera column =
 * player column"; the real clamp holds the PLAYER at 0.88 of the half-frame,
 * near the edge, so a bot that has come to the player's column is often on the
 * outside of him and still cropped. That is the single most useful thing this
 * sweep found for whoever owns the rig: the bots now arrive where the camera is
 * pointing, and the pan spends the frame on the wrong side of the player.
 *
 * Portrait presence past ~52% therefore has to come from the RIG — a pan
 * target weighted toward the centroid of the player and the nearest bot — or
 * from a map with duplicate crates. Both are other people's files, and the
 * sweep above is the evidence that they are where the rest of it lives.
 */
const OFFSTAGE_COST = 5.0;
/**
 * The fraction of the half-frame a bot may drift out to before the hinge bites.
 * 1.0 would push against the very edge of the picture, where a body is half
 * cropped; 0.75 keeps the whole silhouette in.
 */
const FRAME_KEEP = 0.75;
/**
 * Below this half-frame the shot cannot hold the room and the hinge comes on;
 * above it, the term is off entirely. The four shipped profiles measure 2.10 /
 * 4.49 / 4.99 / 6.70, so the ramp from 3.6 down to 2.1 separates portrait from
 * every landscape shape without any of them sitting inside it — no profile is
 * half-staged, and landscape behaviour is bit-identical to before.
 */
const SHOT_NARROW = 3.6;
const SHOT_WIDE = 4.4;
/**
 * HOW CLOSE THE PLAYER HAS TO BE, IN WORLD UNITS, BEFORE A BOT GIVES WAY, AND
 * WHY THE FIRST THREE VERSIONS OF THIS RUNG WERE ALL WORSE THAN NOTHING.
 *
 * Every row below is eight paired seeds, full services, `chaos` = a player
 * wandering the room and mashing grab, `thief` = a player that walks at
 * whatever station a bot is currently heading for and takes it (20-30 times a
 * service). The design log, in the order it happened:
 *
 *                                        yields/svc   chaos    thief
 *   no rung at all (the shipped file)        1.0      17.63     8.50
 *   r2.5, drop the claim + sour the bench   18.8      14.00      --
 *   r1.5, drop the claim + sour the bench   13.9      16.50      --
 *   r2.5, hold a beat, KEEP the plan        20.9      16.38      --
 *   r2.0 + 45deg cone + 10s cooldown        11.9      16.00     4.25 (1/8 alive)
 *   ...and only if the player's hands empty   7.6      16.00     7.75 (6/8 alive)
 *
 * Three things came out of that which are worth more than the constant:
 *
 * 1. DROPPING THE PLAN IS NOT COURTESY, IT IS THRASH. Releasing the claim and
 *    souring the bench — which is the obvious reading of "release the claim and
 *    replan" — cost three and a half dishes a service. The bot has already paid
 *    for the walk; abandoning it at the door throws that away and shuffles the
 *    whole plate assignment behind it. Holding a beat and CARRYING ON costs the
 *    beat and nothing else, and if the player really does take the thing, the
 *    guard voids the plan a moment later and the double-take fires anyway.
 * 2. A ROOM OF BOTS THAT GIVE WAY TO ANYBODY IS EXPLOITABLE. At one yield every
 *    nine seconds the adversarial player broke the kitchen outright — 4.25
 *    dishes, seven runs of eight dead before the clock. That is "a co-op
 *    partner who loses you the game on his own", which this file already
 *    names as the failure mode below BOT_SPEED.
 * 3. HANDS FULL IS NOT COMPETITION, and that one gate is what makes the rung
 *    safe: it halves the yields against a saboteur and restores the whole
 *    3.5 dishes, while leaving the normal case — you, empty-handed, running at
 *    the crate a bot was about to reach — completely intact.
 *
 * WHAT IT IS WORTH. yields per service now read 0.0 with the player frozen,
 * 7.6 with a player wandering, and 17.4 with one taking things on purpose. The
 * old file scored 0.0, 1.0 and 1.9 on the same three, which is why the critic
 * could say the bots would run the same service with the controller unplugged.
 * The price is 1.6 dishes a service against a flailing player and nothing at
 * all against no player.
 */
/**
 * HOW OFTEN A CRATE FETCH GOES TO THE WRONG TRAY. Per fetch, per bot, seeded.
 * See maybeSlip for what it is for; this is what it costs. Eight paired seeds,
 * bots alone (measured before the BOT_SPEED and COMMIT_MIN changes below, so
 * read the served column as a delta against its own 19.50 baseline):
 *
 *     rate / cooldown    slips per service    served
 *       0                      0.0            19.50
 *       2% / 25s               1.8            19.13
 *       3.5% / 25s             2.0            18.88
 *       4% / 18s               3.1            18.00
 *       5% / 25s               4.1            17.50
 *
 * Half a dish per slip, which is more than the four or five seconds of walking
 * it costs, because the component it was for is that much later to the plate.
 * 3% and a 22-second floor is 2.5 slips a service — near enough one per bot,
 * so a player sees one most services — for about half a dish. Past 4 a service
 * the bots stop looking human and start looking drunk, and it shows up in the
 * close rate rather than in the charm.
 */
const MISTAKE_RATE = 0.03;
/** Seconds before the same bot may be wrong again. */
const SLIP_CD = 22;
/**
 * The double-take on arrival. Longer than the 0.34s "you took it" beat because
 * this one has to read as a realisation rather than a hesitation, and it is the
 * only moment in the game where a bot is visibly wrong.
 */
const SLIP_BEAT = 0.45;

const YIELD_RADIUS = 2.0;
/**
 * The beat. Not independently swept: it is set to the length of the double-take
 * this file already arms when a plan is taken out of a bot's hands (0.34s),
 * because giving way is the same event one second earlier and should read at
 * the same length. Under about 0.2s nothing registers at 60fps; over half a
 * second a standing chef starts to look broken rather than polite.
 */
const YIELD_BEAT = 0.36;
/**
 * cos of the half-angle of the cone the player has to be running into: 0.7 is
 * about 45 degrees either side. At 0.35 (70 degrees) a player crossing the room
 * counted as "closing on" every bench along the way and the rung fired twice as
 * often for half the reason.
 */
const YIELD_CONE = 0.7;
/** Seconds before the same bot may give way again. Six was 19 yields a service
 * against a wandering player, which reads as three timid chefs; ten is 7.6. */
const YIELD_CD = 10;

/** Desktop, so an integration that never calls `setShotWidth` changes nothing. */
const DEFAULT_SHOT = 4.99;
/** How far the rig may pan off room centre in portrait: 0.84 x halfWidth 3.69. */
const PAN_LIMIT = 3.1;

/**
 * Bodies start pushing apart inside this radius, in world units, and the push
 * is capped so it can bias a path but never fight it.
 *
 * BOTH BOUNDS, AND THE OBVIOUS DIRECTION IS THE WRONG ONE. Crowding is measured
 * (`clotFrac`: ticks with three or more chefs inside one 2-unit circle) at 16%
 * for three bots, which is one frame in six with a blob in it. Pushing harder
 * to fix that — 1.45 -> 1.80 radius, 0.62 -> 0.72 cap, eight paired seeds —
 * made crowding WORSE, not better: clot 16% -> 18%, four chefs 25% -> 32%, and
 * throughput fell 13% (12.4 -> 10.8 dishes) with two runs dying before the
 * clock. A stronger repulsion makes a bot shoved off its line come back through
 * the neighbour it was avoiding. The clot is caused by shared destinations, not
 * by weak avoidance, which is what the role split addresses.
 */
const SEPARATION_RADIUS = 1.45;
/**
 * Seconds of lead on the other body's velocity when separating. Swept below;
 * 0 is the positional separation that shipped.
 */
const SEPARATION_MAX = 0.62;

/**
 * THE PLAYER IS THE FASTEST CHEF IN THE KITCHEN, AND THAT IS THE WHOLE POINT.
 *
 * Cap on the length of the movement vector a bot may emit. `moveChef` scales
 * top speed linearly with input magnitude, so 0.85 is a bot that runs at 5.3
 * against the player's 6.2 — a fifth of a second slower over a room crossing,
 * which is under the threshold at which it looks sluggish and well over the one
 * at which the player feels quick.
 *
 * BOTH BOUNDS, RE-MEASURED ON THE SHIPPED BUILD — AND THE TWO INSTRUMENTS
 * DISAGREE, WHICH IS THE MOST USEFUL THING IN THIS COMMENT.
 *
 * `alone` is three bots with the player standing still; `+4th` is chef 0 driven
 * by this same brain as a competent partner, which is the only way to price
 * what a player is worth. Eight paired seeds everywhere.
 *
 *   OFFLINE (tools/feelbots.mjs, seeds 13, 7932, ...)
 *     cap     alone   close   +4th    the player is worth
 *     0.85    21.13    97%    20.88   -0.25 dishes  (nothing at all)
 *     0.75    18.00    88%    19.75   +1.75 dishes  (+9.7%)
 *     0.70    18.00    88%    20.38   +2.38 dishes  (+13%)
 *     0.60    15.50    82%    19.17   +3.67 dishes  (+24%)
 *
 *   IN A BROWSER, ON THE SHIPPED BUNDLE (tools/botprobe.mjs, its own seeds)
 *     0.85    19.00    93%    21.25   +2.25 dishes  (+11.8%)
 *     0.75    19.13    94%    21.00   +1.87 dishes  (+9.8%)
 *
 * Offline, dropping the cap to 0.75 costs three dishes and hands the player a
 * job. In the browser it does nothing at all — the two rows are the same row.
 * Same brain, same sim, same 60Hz tick; what differs is the ORDER STREAM, and
 * a service is only about twenty tickets long, so which recipes turn up in
 * which order moves the total by more than this constant does.
 *
 * So the cap STAYS AT 0.85, and the reason is that a 12% speed cut is a change
 * you can see — a partner you visibly outrun is a worse partner — bought with
 * an effect that only one of two instruments can find. The lower bound has
 * moved since this comment was first written, though, and it is worth
 * recording: 0.60 does not die the way this used to claim. Eight of eight runs
 * still reach the clock. It just stops being a kitchen you would want to work
 * in, at 82% and three and a half missed tickets a service.
 *
 * WHAT IS TRUE ON BOTH INSTRUMENTS is that this file's own target band — 12-14
 * dishes and a 65-75% close rate — is long gone: the bots close 93-97% of every
 * ticket the generator can produce, at every cap between 0.75 and 0.85. That is
 * the "kitchen that does not need you" the brief names, it is not fixable with
 * a stick cap without making the cast look slow, and the lever for it is
 * `maxOrders` / the gap in content.ts.
 *
 * It is a WEAKER input than the player's, never a stronger one. Nothing here
 * cheats: same acceleration model, same carry penalty, same collisions.
 */
const BOT_SPEED = 0.85;

/**
 * THE YOUNGEST A PLAN MAY BE AND STILL BE DISPLACED by a more urgent KIND of
 * plan. The wave-2 critic asked for this to go from 0.3s to about 1.2s on
 * legibility grounds — "a teammate you cannot predict for even a second and a
 * half is not legible from across the room" — and they were right, but not for
 * the reason given. Eight paired seeds:
 *
 *     COMMIT_MIN    served   completion   plan starts/bot/min   median life
 *        0.3        19.13       73%            56.9               0.83s
 *        0.8        20.63       76%            56.5               0.83s
 *        1.2        21.13       75%            55.6               0.83s
 *        2.0        19.25       76%            54.3               0.83s
 *
 * Plan LIFE does not move, because plan churn in this file is not indecision:
 * three quarters of all plans end in the button press they were made for, and
 * a plan is one grab, so a bot that is working hard starts a lot of them. What
 * the longer commitment buys is the other quarter — completion 73% -> 75-76%
 * and, at the peak, two dishes a service. Past 2.0 a bot holds a plan through
 * a change it should have answered and the gain reverses. 1.2 is the peak of a
 * curve with both ends measured.
 */
const COMMIT_MIN = 1.2;

// --------------------------------------------------------------- telemetry
/**
 * WHY THIS EXISTS AT ALL.
 *
 * Every bot defect this project has ever found was found in a log: a planner
 * oscillation rendered as a statue, a bot parked 1.10 units from a station it
 * could not reach, a flow field with no opinion. None of them were visible in a
 * screenshot, because a chef standing still looks exactly like a chef who is
 * busy. So the brain keeps its own books: where every second of every bot's
 * life went, how many plans it started, how many it finished, and why the rest
 * died. `tools/botprobe.mjs` reads this.
 *
 * The cost is a handful of adds per chef per tick. It stays on in the shipped
 * build because the numbers are the only way anyone can ever check this piece.
 */
interface BotTrack {
  /** Seconds, and they must sum to the run length. */
  idle: number;
  hesitate: number;
  travel: number;
  station: number;
  work: number;
  /** Plans started / plans that ended in an actual button press. */
  jobs: number;
  done: number;
  /** Plans killed by: a guard (the world moved), a stall, a station gone sour. */
  voids: number;
  stalls: number;
  sours: number;
  /** Guard kills specifically caused by ANOTHER CHEF taking our target. */
  stolen: number;
  yields: number;
  metres: number;
  /** Running sums of position, so the report can print where a bot LIVES. */
  posX: number;
  posY: number;
  posN: number;
  why: Map<string, number>;
  /** Why the planner came back with NOTHING. The idle budget, itemised. */
  nullWhy: Map<string, number>;
}

const mkTrack = (): BotTrack => ({
  idle: 0,
  hesitate: 0,
  travel: 0,
  station: 0,
  work: 0,
  jobs: 0,
  done: 0,
  voids: 0,
  stalls: 0,
  sours: 0,
  stolen: 0,
  yields: 0,
  metres: 0,
  posX: 0,
  posY: 0,
  posN: 0,
  why: new Map(),
  nullWhy: new Map(),
});

class Telemetry {
  t = 0;
  tracks = new Map<number, BotTrack>();
  /** Ticks in which every bot in the room had no plan at all. */
  joblessAll = 0;
  /** Ticks / rising edges of two bodies inside one body-width of each other. */
  contactTicks = 0;
  contactEvents = 0;
  private touching = new Set<string>();
  /** Ticks in which no board in the room was available to a human player. */
  boardsAllTaken = 0;
  boardFreeSum = 0;
  /** Plates in circulation (carried + parked), summed per tick for a mean. */
  platesOutSum = 0;
  /**
   * CROWDING, WHICH IS A LOOK PROBLEM AS WELL AS A FEEL ONE. Three chefs inside
   * two units of each other render as one indistinct mass from the game camera
   * — it is in the wave-1 verdicts twice — and it is invisible in an aggregate
   * unless somebody counts it. `clot` is ticks with three or more bodies inside
   * a 2.0-unit circle; `spreadSum` is the mean pairwise separation.
   */
  clotTicks = 0;
  onesideTicks = 0;
  spreadSum = 0;
  samples = 0;

  track(id: number): BotTrack {
    let t = this.tracks.get(id);
    if (!t) {
      t = mkTrack();
      this.tracks.set(id, t);
    }
    return t;
  }

  reset() {
    this.t = 0;
    this.tracks.clear();
    this.joblessAll = 0;
    this.contactTicks = 0;
    this.contactEvents = 0;
    this.touching.clear();
    this.boardsAllTaken = 0;
    this.boardFreeSum = 0;
    this.platesOutSum = 0;
    this.clotTicks = 0;
    this.onesideTicks = 0;
    this.spreadSum = 0;
    this.samples = 0;
  }

  frame(s: SimState, dt: number, claims: Map<number, number>, jobless: boolean) {
    this.t += dt;
    this.samples++;
    if (jobless) this.joblessAll++;

    for (let i = 0; i < s.chefs.length; i++) {
      for (let j = i + 1; j < s.chefs.length; j++) {
        const a = s.chefs[i];
        const b = s.chefs[j];
        const d = Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y);
        const key = `${a.id}:${b.id}`;
        if (d < 0.78) {
          this.contactTicks++;
          if (!this.touching.has(key)) {
            this.touching.add(key);
            this.contactEvents++;
          }
        } else if (d > 0.95) {
          this.touching.delete(key);
        }
      }
    }

    let pairs = 0;
    let sum = 0;
    for (let i = 0; i < s.chefs.length; i++)
      for (let j = i + 1; j < s.chefs.length; j++) {
        sum += Math.hypot(s.chefs[i].pos.x - s.chefs[j].pos.x, s.chefs[i].pos.y - s.chefs[j].pos.y);
        pairs++;
      }
    this.spreadSum += pairs ? sum / pairs : 0;
    // ONE HALF OF THE ROOM EMPTY IS A FRAMING DEFECT AS WELL AS A FEEL ONE: the
    // camera is low and frontal and shows the whole width, so every tick with
    // the whole cast on one side of the oven is a frame with a dead half.
    let left = 0;
    let right = 0;
    for (const c of s.chefs) (c.pos.x < 7 ? left++ : right++);
    if (left === 0 || right === 0) this.onesideTicks++;
    for (const a of s.chefs) {
      let near = 0;
      for (const b of s.chefs) if (Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y) < 2) near++;
      if (near >= 3) {
        this.clotTicks++;
        break;
      }
    }

    let freeBoards = 0;
    for (const st of s.kitchen.stations) {
      if (st.kind !== 'board') continue;
      if (!claims.has(st.id)) freeBoards++;
    }
    this.boardFreeSum += freeBoards;
    if (freeBoards === 0) this.boardsAllTaken++;

    let plates = 0;
    for (const c of s.chefs) if (c.carrying?.type === 'plate') plates++;
    for (const st of s.kitchen.stations) if (st.holding?.type === 'plate') plates++;
    this.platesOutSum += plates;
  }

  /** Plain JSON for the Playwright bridge. */
  report() {
    const bots: Record<string, unknown> = {};
    for (const [id, t] of this.tracks) {
      bots[id] = {
        idle: +t.idle.toFixed(1),
        hesitate: +t.hesitate.toFixed(1),
        travel: +t.travel.toFixed(1),
        station: +t.station.toFixed(1),
        work: +t.work.toFixed(1),
        jobs: t.jobs,
        done: t.done,
        voids: t.voids,
        stalls: t.stalls,
        sours: t.sours,
        stolen: t.stolen,
        yields: t.yields,
        metres: +t.metres.toFixed(0),
        home: `${(t.posX / Math.max(1, t.posN)).toFixed(1)},${(t.posY / Math.max(1, t.posN)).toFixed(1)}`,
        why: Object.fromEntries([...t.why].sort((a, b) => b[1] - a[1])),
        nullWhy: Object.fromEntries([...t.nullWhy].sort((a, b) => b[1] - a[1])),
      };
    }
    const n = Math.max(1, this.samples);
    return {
      seconds: +this.t.toFixed(1),
      bots,
      joblessAllFrac: +(this.joblessAll / n).toFixed(3),
      contactPerMin: +((this.contactEvents / Math.max(1, this.t)) * 60).toFixed(1),
      contactFrac: +(this.contactTicks / n).toFixed(3),
      boardsAllTakenFrac: +(this.boardsAllTaken / n).toFixed(3),
      boardsFreeMean: +(this.boardFreeSum / n).toFixed(2),
      platesOutMean: +(this.platesOutSum / n).toFixed(2),
      clotFrac: +(this.clotTicks / n).toFixed(3),
      onesideFrac: +(this.onesideTicks / n).toFixed(3),
      spreadMean: +(this.spreadSum / n).toFixed(2),
    };
  }
}

export class BotDirector {
  private mem = new Map<number, BotMemory>();
  /** stationId -> chefId, so two bots never chase the same board. */
  private claims = new Map<number, number>();
  readonly tele = new Telemetry();
  /**
   * Optional plan trace. Off unless a probe asks for it: every plan start,
   * completion and void, with a timestamp, so a single service can be read
   * back like a flight recorder. This is how the bacon pipeline was diagnosed.
   */
  private trace: string[] | null = null;
  /** Set only by the probe harness; the shipped game never drives chef 0. */
  private drivePlayer = false;

  private lastSim: SimState | null = null;
  /**
   * HOW WIDE THE PICTURE IS, IN WORLD UNITS, AT THE CHEF'S ROW.
   *
   * `cameraRig.describe().halfWidthAtChef`. main.ts hands it over on every
   * resize; see OFFSTAGE_COST for what it buys and what it costs. Defaulted to
   * the desktop value so the brain behaves identically if nobody ever calls it.
   * This is the ONLY thing the brain knows about the view, it is one number, it
   * is read-only, and it biases staging — never capability.
   */
  private shotHalfWidth = DEFAULT_SHOT;
  /**
   * WHAT A BOT WANTS THE PLAYER TO NOTICE, DRAINED BY THE VIEW.
   *
   * A bot emits the same InputSnapshot the player does, so the only thing it
   * can say out loud is which way it is walking — and it is off the side of a
   * portrait frame half the time. These are the two moments worth a glyph: a
   * bot giving way to the player, and a bot noticing it has picked up the wrong
   * thing. main.ts drains this after every step and hands it to `vfx`; if
   * nobody drains it, `update` caps it and drops the oldest.
   */
  readonly signals: { chef: number; kind: 'yield' | 'oops'; at: { x: number; y: number } }[] = [];

  constructor() {
    const g = globalThis as unknown as Record<string, unknown>;
    g.__bots = {
      report: () => this.tele.report(),
      resetStats: () => this.tele.reset(),
      probe: (seconds: number, mode: string, seed: number, trace?: boolean) => this.probe(seconds, mode, seed, trace),
      jobs: () => this.jobsDebug(),
    };
  }

  reset() {
    this.mem.clear();
    this.claims.clear();
    this.tele.reset();
    this.signals.length = 0;
  }

  /**
   * PROBE ONLY. Hand chef 0 to the brain as a fourth, role-less chef, which is
   * how every tool in tools/ measures the competent-partner ceiling: if three
   * bots plus a good fourth is no better than three bots, the player has no
   * job. `probe()` sets it internally; offline harnesses set it directly.
   */
  setDrivePlayer(on: boolean) {
    this.drivePlayer = on;
  }

  /**
   * Tell the brain how wide the shot is. `cameraRig.describe().halfWidthAtChef`,
   * called on resize. See OFFSTAGE_COST.
   */
  setShotWidth(halfWidthAtChef: number) {
    if (Number.isFinite(halfWidthAtChef) && halfWidthAtChef > 0.5) this.shotHalfWidth = halfWidthAtChef;
  }

  /**
   * 0 when the whole room is in frame, 1 when the frame is a portrait slot.
   * Everything staging-related is multiplied by this, so landscape is exactly
   * the code that shipped.
   */
  private stagePressure(): number {
    const t = (SHOT_WIDE - this.shotHalfWidth) / (SHOT_WIDE - SHOT_NARROW);
    return Math.max(0, Math.min(1, t));
  }

  /**
   * The column the camera is looking down. In portrait the rig pans x with the
   * player and hard-stops PAN_LIMIT off room centre, which is exactly this; in
   * landscape stagePressure() is 0 and nothing reads it.
   */
  private cameraColumn(s: SimState): number {
    const mid = s.kitchen.width / 2;
    const player = s.chefs.find((c) => c.isPlayer);
    if (!player) return mid;
    return mid + Math.max(-PAN_LIMIT, Math.min(PAN_LIMIT, player.pos.x - mid));
  }

  /** One line per bot: what it is doing and why. Read by tools and by humans. */
  jobsDebug() {
    const out: Record<string, string> = {};
    for (const [id, m] of this.mem) out[id] = `${m.role.name}: ${m.job ? `${m.job.why} @${m.job.station}` : 'idle'}`;
    return out;
  }

  private memFor(bot: Chef): BotMemory {
    let m = this.mem.get(bot.id);
    if (!m) {
      m = {
        job: null,
        flow: null,
        flowTarget: -1,
        replanIn: 0,
        reactionLag: 0.09 + (bot.id % 3) * 0.045,
        lagTimer: 0,
        wanderPhase: bot.id * 2.1,
        stuckFor: 0,
        lastWork: 0,
        lastPos: { ...bot.pos },
        jobAge: 0,
        stallFor: 0,
        atStationFor: 0,
        bestDist: Infinity,
        bestFlow: Infinity,
        placedItem: -1,
        placedFor: 0,
        sour: new Map(),
        home: HOME_REGIONS[bot.id % HOME_REGIONS.length],
        role: ROLES[bot.id % ROLES.length],
        yieldCd: 0,
        slipCd: 0,
        slip: null,
        // Seeded off the chef id alone: the domain is deterministic and the
        // bots must be too, or a probe cannot pair seeds and a replay diverges.
        dice: mulberry32(0x9e37 + bot.id * 7919),
      };
      this.mem.set(bot.id, m);
    }
    return m;
  }

  /**
   * A WHOLE SERVICE, HEADLESS, WITH A PLAYER IN IT.
   *
   * `__game.warp()` runs the bots with the player standing still, and
   * `botsurvey.mjs --drive` runs a scripted player but has to RENDER a frame
   * per advance, which costs ten minutes a run. Neither can answer the two
   * questions this piece is actually judged on — what the bots do WITHOUT a
   * player, and what they do when a player is taking things out from under
   * them — cheaply enough to run thirty seeds a variant.
   *
   * This does. No rendering, no view, same sim, same 60Hz tick, same brain.
   *
   *   idle   nobody at the fourth station. The floor of the range.
   *   bot    the player chef driven by this same brain: a competent partner,
   *          i.e. the ceiling. If this clears the board, the player is a
   *          spectator.
   *   chaos  a player wandering the room and mashing grab: takes plates off
   *          benches, leaves food where it does not belong, stands in doorways.
   *          This is the one that finds re-plan bugs.
   */
  private probe(seconds: number, mode: string, seed: number, trace = false) {
    const s = this.lastSim;
    if (!s) return { error: 'probe called before the sim ran a tick' };
    this.tele.reset();
    this.trace = trace ? [] : null;
    const rand = mulberry32((seed >>> 0) || 1);
    this.drivePlayer = mode === 'bot';
    const player = s.chefs.find((c) => c.isPlayer)!;
    const k = s.kitchen;
    let target = { ...player.pos };
    let retarget = 0;
    let grabIn = 0.5;
    let useUntil = 0;
    const inputs: InputSnapshot[] = [];
    // WHICH TICKETS CLOSE AND WHICH ONES ROT. A single `served` count cannot
    // tell you that an entire branch of the menu is unfillable.
    const events: Record<string, number> = {};
    const closed: Record<string, number> = {};
    const rotted: Record<string, number> = {};
    let prevServed = s.score.served;
    let prevMissed = s.score.missed;
    let live = new Map(s.orders.map((o) => [o.id, o.recipe.name]));
    let t = 0;
    while (t < seconds && !s.over) {
      const bi = this.update(s, SIM_DT);
      inputs.length = 0;
      for (const c of s.chefs) inputs[c.id] = bi.get(c.id) ?? NO_INPUT;
      if (mode === 'chaos') {
        retarget -= SIM_DT;
        if (retarget <= 0) {
          retarget = 1.4 + rand() * 2.4;
          for (let tries = 0; tries < 40; tries++) {
            const cx = 1 + Math.floor(rand() * (k.width - 2));
            const cy = 1 + Math.floor(rand() * (k.height - 2));
            if (isWalkable(k, cx, cy)) {
              target = { x: cx + 0.5, y: cy + 0.5 };
              break;
            }
          }
        }
        const vx = target.x - player.pos.x;
        const vy = target.y - player.pos.y;
        const d = Math.hypot(vx, vy) || 1;
        grabIn -= SIM_DT;
        const grab = grabIn <= 0;
        if (grab) grabIn = 0.7 + rand() * 1.3;
        useUntil -= SIM_DT;
        if (useUntil < -1.2 && rand() < 0.02) useUntil = 0.9;
        inputs[player.id] = {
          move: { x: (vx / d) * 0.95, y: (vy / d) * 0.95 },
          grabPressed: grab,
          useHeld: useUntil > 0,
        };
      }
      step(s, inputs);
      // Event census: cooks, burns, fires, wrong serves. The only way to see
      // that a whole branch of the menu is being started and never finished.
      for (const e of s.events) events[e.t] = (events[e.t] ?? 0) + 1;
      s.events.length = 0;
      if (s.score.served !== prevServed || s.score.missed !== prevMissed) {
        const now = new Set(s.orders.map((o) => o.id));
        const bin = s.score.served > prevServed ? closed : rotted;
        for (const [id, name] of live) if (!now.has(id)) bin[name] = (bin[name] ?? 0) + 1;
        prevServed = s.score.served;
        prevMissed = s.score.missed;
      }
      live = new Map(s.orders.map((o) => [o.id, o.recipe.name]));
      t += SIM_DT;
    }
    this.drivePlayer = false;
    return {
      mode,
      closed,
      rotted,
      events,
      ...this.tele.report(),
      served: s.score.served,
      missed: s.score.missed,
      coins: s.score.coins,
      patience: +s.score.patience.toFixed(2),
      time: +s.time.toFixed(1),
      over: s.over,
      trace: this.trace ?? undefined,
    };
  }

  /** Produce one frame of input for every bot chef. */
  update(s: SimState, dt: number): Map<number, InputSnapshot> {
    this.lastSim = s;
    const out = new Map<number, InputSnapshot>();
    // Drop claims from bots that no longer hold the job.
    for (const [stationId, chefId] of [...this.claims]) {
      const m = this.mem.get(chefId);
      if (!m || m.job?.station !== stationId) this.claims.delete(stationId);
    }

    let jobless = true;
    for (const bot of s.chefs) {
      if (bot.isPlayer && !this.drivePlayer) continue;
      out.set(bot.id, this.updateBot(s, bot, dt));
      if (this.mem.get(bot.id)?.job) jobless = false;
    }
    this.tele.frame(s, dt, this.claims, jobless);
    return out;
  }

  private updateBot(s: SimState, bot: Chef, dt: number): InputSnapshot {
    const m = this.memFor(bot);
    const tel = this.tele.track(bot.id);
    tel.metres += Math.hypot(bot.pos.x - m.lastPos.x, bot.pos.y - m.lastPos.y);
    tel.posX += bot.pos.x;
    tel.posY += bot.pos.y;
    tel.posN++;
    m.lastPos = { ...bot.pos };
    m.replanIn -= dt;
    m.jobAge += dt;
    m.placedFor -= dt;
    m.slipCd -= dt;
    // THE MOMENT THE MISTAKE LANDS. The grab is pressed a tick before the sim
    // resolves it, so this is where a bot first sees what is actually in its
    // hands: the wrong tray's ingredient. Take a beat, say so, and the planner
    // below walks it back. See maybeSlip.
    if (m.slip) {
      const held = bot.carrying;
      if (m.slip.item < 0) {
        if (held?.type === 'ingredient' && held.ingredient.kind !== m.slip.want) {
          m.slip.item = held.ingredient.id;
          m.lagTimer = Math.max(m.lagTimer, SLIP_BEAT);
          this.signal(bot, 'oops');
          if (this.trace && this.trace.length < 20000)
            this.trace.push(`${s.time.toFixed(1)} c${bot.id} OOPS wanted ${m.slip.want}, took ${held.ingredient.kind}`);
        } else if (held || (m.job && m.job.station !== m.slip.station)) {
          // The trip was abandoned or landed on something else entirely: the
          // mistake never happened, so it must not cost a cooldown either.
          m.slip = null;
        }
      }
    }
    for (const [id, t] of m.sour) {
      const left = t - dt;
      if (left <= 0) m.sour.delete(id);
      else m.sour.set(id, left);
    }

    if (m.job && m.job.guard && !m.job.guard(s, bot)) {
      tel.voids++;
      if (this.trace && this.trace.length < 20000)
        this.trace.push(`${s.time.toFixed(1)} c${bot.id} VOID ${m.job.why} @${m.job.station}`);
      const taken = m.job.item;
      if (taken !== undefined && taken >= 0) {
        for (const other of s.chefs) {
          const c = other.carrying;
          if (other.id === bot.id || !c) continue;
          const id = c.type === 'ingredient' ? c.ingredient.id : c.type === 'plate' ? c.plate.id : -1;
          if (id !== taken) continue;
          tel.stolen++;
          // A DOUBLE TAKE, AND IT IS THE WHOLE OF THE 'REACTS TO THE PLAYER'
          // BRIEF. The thing this bot was walking across the room for is now in
          // somebody else's hands. It stops dead for a beat before it turns
          // away, which is the only channel a bot has — it emits the same
          // InputSnapshot the player does — for saying "oh, you've got it".
          // Long enough to read at 60fps (0.34s = 20 frames), short enough that
          // it never reads as a hang.
          m.lagTimer = other.isPlayer ? 0.34 : 0.16;
          // ...and the beat is invisible from across the room, which is what
          // the wave-2 critic said and the measurement agreed with: total
          // hesitation is 1% of a bot's life either way, so a player cannot
          // tell it from a bot walking round a bench. Say it out loud instead.
          if (other.isPlayer) this.signal(bot, 'yield');
          break;
        }
      }
      m.job = null;
      m.replanIn = 0;
    }
    if (m.job && m.sour.has(m.job.station)) {
      m.job = null;
      m.replanIn = 0;
    }
    m.yieldCd -= dt;
    if (this.yieldTo(s, bot, m)) {
      tel.yields++;
      tel.hesitate += dt;
      return { move: { x: 0, y: 0 }, grabPressed: false, useHeld: false };
    }
    // RATE-LIMITED, INCLUDING WHEN THERE IS NO PLAN. The condition here used to
    // be `!m.job || m.replanIn <= 0`, so a bot between plans re-planned every
    // tick — 60 breadth-first searches a second per bot on a phone, for a
    // decision that cannot change that fast. Every site that clears a plan now
    // zeroes the timer instead, which replans on the very next tick and then
    // goes back to three a second.
    if (m.replanIn <= 0) {
      const job = this.plan(s, bot);
      const cur = m.job;
      if (job?.station !== cur?.station || job?.action !== cur?.action) {
        // COMMIT. A job used to be replaceable 0.35s after it started, and
        // every switch re-armed `lagTimer` — so a bot whose planner flip-flopped
        // between two equally-good stations spent its whole life inside the
        // hesitation beat, emitting a zero input frame after frame. That is the
        // `mochi sp=0.00 intent=idle` in the telemetry: not a body jam, a
        // planner oscillation rendered as a statue.
        //
        // A flat time threshold was not enough (see Job.prio): what displaces a
        // live plan is a MORE URGENT KIND of plan, not a nearer one.
        // WHAT MAY INTERRUPT A LIVE PLAN, AND NOTHING ELSE MAY.
        //
        // There used to be a catch-all here — anything could displace a plan
        // older than 2.5s — and it is all over the trace as `(dropped load the
        // bun at age 2.6)` followed nine seconds later by the same bot planning
        // the same load again. A bot that is walking somewhere is not stuck;
        // the stall detector and the station timer are what catch stuck. So:
        // only a more urgent KIND of plan interrupts, and only after a third of
        // a second, which stops two equal-cost stations trading a bot back and
        // forth on sub-metre changes in its own position.
        const preempt = !cur || !job || ((job.prio ?? P.fetch) < (cur.prio ?? P.fetch) && m.jobAge > COMMIT_MIN);
        if (preempt) {
          if (job) {
            tel.jobs++;
            tel.why.set(job.why, (tel.why.get(job.why) ?? 0) + 1);
            if (this.trace && this.trace.length < 20000)
              this.trace.push(
                `${s.time.toFixed(1)} c${bot.id} PLAN ${job.why} @${job.station}${cur ? ` (dropped ${cur.why} at age ${m.jobAge.toFixed(1)})` : ''}`,
              );
          }
          // THE BEAT IS FOR ABANDONING SOMETHING, NOT FOR STARTING SOMETHING.
          // Arming it on every plan — including the one that follows a
          // successful grab — spent a quarter of the run's animation budget on
          // chefs standing still a tenth of a second at a time. It now fires
          // only when a plan the bot was mid-way through is dropped, which is
          // the moment that is worth reading.
          if (cur) m.lagTimer = m.reactionLag;
          m.job = job;
          m.jobAge = 0;
          m.flow = null;
          m.atStationFor = 0;
          m.stallFor = 0;
          m.bestDist = Infinity;
          m.bestFlow = Infinity;
        }
      }
      // A bot with no plan retries three times as often as one that has one:
      // the usual reason for an empty plan is that another chef is two seconds
      // from parking a plate, and the difference between noticing that at 0.12s
      // and at 0.35s is a measurable dish a service.
      m.replanIn = m.job ? 0.35 : 0.12;
    }

    const input: InputSnapshot = {
      move: { x: 0, y: 0 },
      grabPressed: false,
      useHeld: false,
    };

    if (m.lagTimer > 0) {
      m.lagTimer -= dt;
      tel.hesitate += dt;
      return input;
    }

    if (!m.job) {
      tel.idle += dt;
      // No job: walk back to this bot's own patch of floor rather than swaying
      // on the spot. Standing still is the one thing a co-op partner may never
      // do, and swaying in a 0.18 circle at whatever station it last used is
      // what pinned three of four chefs to the back wall in every capture.
      // The idle patch is staged too: on a portrait frame an anchor two thirds
      // of the room away from the camera column is a bot that loiters
      // off-screen. Depth is untouched — depth is the LONG axis of a 393x852
      // frame, and it is what keeps three idle bots from stacking up.
      const stage = this.stagePressure();
      const homeX =
        stage > 0
          ? m.home.x + (this.cameraColumn(s) - m.home.x) * stage * 0.8
          : m.home.x;
      const hx = homeX - bot.pos.x;
      const hy = m.home.y - bot.pos.y;
      const hd = Math.hypot(hx, hy);
      m.wanderPhase += dt * 0.9;
      if (hd > 1.1) {
        input.move.x = (hx / hd) * 0.8;
        input.move.y = (hy / hd) * 0.8;
      } else {
        // Loiter, but loiter WIDE — a full-metre orbit of the anchor, so an
        // idle bot still crosses lanes and still reads as somebody working.
        input.move.x = Math.cos(m.wanderPhase) * 0.42;
        input.move.y = Math.sin(m.wanderPhase * 0.7) * 0.42;
      }
      this.applySeparation(s, bot, input, 1);
      clampMove(input, bot.isPlayer ? 1 : BOT_SPEED);
      return input;
    }

    const st = s.kitchen.stations.find((x) => x.id === m.job!.station);
    if (!st) {
      m.job = null;
      return input;
    }
    this.claims.set(st.id, bot.id);

    if (!m.flow || m.flowTarget !== st.id) {
      m.flow = buildFlow(s.kitchen, [{ x: st.cell.x, y: st.cell.y }]);
      m.flowTarget = st.id;
    }

    const c = stationCenter(st);
    const dx = c.x - bot.pos.x;
    const dy = c.y - bot.pos.y;
    const dist = Math.hypot(dx, dy);

    let travelling = false;

    // ARRIVAL RADIUS 1.3, NOT 1.05. A station cell is SOLID and the chef radius
    // is 0.36, so a body can never get closer than 0.86 to the centre of a
    // station it is square on to — and if it approaches even slightly off the
    // cell's axis, or the neighbouring cell is another station, the closest
    // reachable point is over 1.05 away. The bot then never entered its own
    // "close enough" branch: it stood at 1.10 pushing a flow direction of
    // (-0.03, -0.01) into a bench, holding a plate, for the entire run. That is
    // `mochi (8.6,4.4) v0.1 plate` at every single sample from t=7 to t=40 in
    // the offline trace. 1.3 is still inside `reach + 0.5`, so `findFocus` can
    // still see the station from there.
    if (dist < 1.3) {
      // Close enough: face it and act.
      input.move.x = (dx / dist) * 0.42;
      input.move.y = (dy / dist) * 0.42;
      const facing = Math.abs(angleDelta(bot.heading, Math.atan2(dy, dx))) < 0.6;
      if (facing) {
        if (m.job.action === 'wait') {
          // Nothing to press yet. Stand square to the station and hold — see
          // the 'wait for the pan' rung. The guard drops this job the moment
          // there is something to take, and the next plan presses grab.
        } else if (m.job.action === 'use') {
          input.useHeld = true;
        } else if (bot.focus === st.id) {
          input.grabPressed = true;
          tel.done++;
          if (this.trace && this.trace.length < 20000)
            this.trace.push(`${s.time.toFixed(1)} c${bot.id} DONE ${m.job.why} @${st.id}`);
          if (m.slip && m.slip.item >= 0 && st.id === m.slip.station) {
            m.slip = null;
            m.slipCd = SLIP_CD;
          }
          // Putting something down? Remember it, so this bot does not turn
          // round and pick the same thing straight back up. See placedItem.
          const c = bot.carrying;
          if (c) {
            m.placedItem = c.type === 'ingredient' ? c.ingredient.id : c.type === 'plate' ? c.plate.id : -1;
            m.placedFor = 3;
          }
          m.job = null;
          m.jobAge = 0;
          m.atStationFor = 0;
          m.replanIn = 0.12;
        }
      }
      // THE STALL NOBODY WAS WATCHING FOR. `focus` is chosen by the sim, not by
      // us, and when a bot parks between two adjacent stations — the plate
      // dispenser at (8,3) sits shoulder to shoulder with a board at (7,3) —
      // the sim can hand it the neighbour forever. The grab then never fires,
      // the job never completes, and the bot presses into the counter at
      // sp≈0.05 with intent 'moving' until the clock runs out. That is exactly
      // `pip sp=0.05 / nori sp=0.05 / mochi sp=0.06` in report.json: three bots
      // leaning on three benches, all of them flagged as running.
      if (m.job) {
        // Progress resets the patience. See BotMemory.lastWork.
        if (st.work > m.lastWork + 1e-4) m.atStationFor = 0;
        m.lastWork = st.work;
        m.atStationFor += dt;
        // A DELIBERATE WAIT IS NOT A STALL. Standing at the hob for the bacon
        // is the plan working, not the plan failing, so it gets a longer rope —
        // but a finite one, because a pan that burns leaves nothing to wait for
        // and the guard cannot always see that in time.
        const patience = m.job.action === 'wait' ? 5.5 : 1.3;
        if (m.atStationFor > patience) {
          // Back off, sour the station for a few seconds so the planner cannot
          // immediately re-pick it, and go find other work.
          tel.sours++;
          if (this.trace && this.trace.length < 20000)
            this.trace.push(`${s.time.toFixed(1)} c${bot.id} GIVEUP ${m.job?.why ?? '?'} @${st.id}`);
          m.sour.set(st.id, 4);
          this.claims.delete(st.id);
          m.job = null;
          m.jobAge = 0;
          m.atStationFor = 0;
          m.replanIn = 0;
          input.move.x = -(dx / dist) * 0.9;
          input.move.y = -(dy / dist) * 0.9;
        } else if (m.atStationFor > 0.7 && m.job.action !== 'wait') {
          // Shuffle sideways first: half the time the sim just needs the body a
          // few centimetres off the seam between two stations.
          const side = bot.id % 2 === 0 ? 1 : -1;
          input.move.x += (-dy / dist) * 0.5 * side;
          input.move.y += (dx / dist) * 0.5 * side;
        }
      }
    } else {
      m.atStationFor = 0;
      travelling = true;
      const d = flowDir(m.flow, s.kitchen, bot.pos);
      // The flow field is built to a SOLID cell, and on the ring of walkable
      // cells right around it the gradient can collapse to nothing — `flowDir`
      // handed back (-0.03, -0.01) while the bot was still 1.1 units short.
      // A near-zero flow is not "you have arrived", it is "the field has no
      // opinion here": steer straight at the station instead.
      if (Math.hypot(d.x, d.y) < 0.3) {
        input.move.x = dx / dist;
        input.move.y = dy / dist;
      } else {
        input.move.x = d.x;
        input.move.y = d.y;
      }
    }

    // PROGRESS-BASED STALL DETECTOR, not speed-based. A speed threshold looks
    // right and does not work: the moment the sidestep kick lands, speed crosses
    // the threshold, the timer resets, the bot creeps back into the same corner,
    // and the whole thing loops forever at an average of 0.1 units/s. In the
    // offline trace that produced a bot with `stall` bouncing 0.0–0.6 for
    // thirteen consecutive seconds without ever tripping.
    //
    // What actually matters is whether we are getting CLOSER. Every 12cm gained
    // on the target resets the clock; 1.6s without gaining any is a stall, full
    // stop, whatever the instantaneous velocity says.
    if (travelling) {
      // Two measures of progress, and it only takes one: cells closed along the
      // route (monotone, but quantised to whole cells) or metres closed in a
      // straight line (continuous, but wrong when the route bends). See
      // BotMemory.bestFlow.
      const fd = m.flow ? distanceTo(m.flow, bot.pos) : Number.MAX_SAFE_INTEGER;
      if (fd < m.bestFlow || dist < m.bestDist - 0.12) {
        m.bestFlow = Math.min(m.bestFlow, fd);
        m.bestDist = Math.min(m.bestDist, dist);
        m.stallFor = 0;
      } else {
        m.stallFor += dt;
      }
      if (m.stallFor > 0.55) {
        // Sidestep PERPENDICULAR to where we want to go, consistently per bot,
        // so two jammed bots peel apart in opposite directions instead of
        // mirroring each other into a deadlock the way a shared sine did.
        const side = bot.id % 2 === 0 ? 1 : -1;
        input.move.x += (-dy / dist) * 1.05 * side;
        input.move.y += (dx / dist) * 1.05 * side;
      }
      if (m.stallFor > 1.6) {
        tel.stalls++;
        if (this.trace && this.trace.length < 20000)
          this.trace.push(`${s.time.toFixed(1)} c${bot.id} STALL ${m.job?.why ?? '?'} @${st.id} d=${dist.toFixed(1)}`);
        m.stallFor = 0;
        m.bestDist = Infinity;
        m.bestFlow = Infinity;
        m.sour.set(st.id, 5);
        this.claims.delete(st.id);
        m.job = null;
        m.jobAge = 0;
        m.replanIn = 0;
      }
    } else {
      m.stallFor = 0;
      m.bestDist = Infinity;
      m.bestFlow = Infinity;
    }
    m.stuckFor = 0;

    if (travelling) tel.travel += dt;
    else {
      tel.station += dt;
      if (input.useHeld) tel.work += dt;
    }

    this.applySeparation(s, bot, input, travelling ? 1 : 0.9);
    // The probe's stand-in player is not a bot and must not be handicapped like
    // one, or the ceiling it measures is not a ceiling.
    clampMove(input, bot.isPlayer ? 1 : BOT_SPEED);
    return input;
  }

  /**
   * "IF YOU GRAB THE WRONG INGREDIENT BY ACCIDENT, JUST PUT IT BACK WHERE YOU
   * FOUND IT!" — the reference's own on-screen hint, and the one thing in the
   * whole minigame our bots could not do, because they were never wrong.
   *
   * Measured over 22 services before this existed: 0 wrong serves, 0 wrong
   * grabs, 0.4% of all plans 'pre-stage a plate'. Nothing a bot did was ever
   * funny. A partner who is never wrong is not a partner, it is a subroutine —
   * and the sim has had the mechanism since the grab rewrite (`planGrab` returns
   * 'return' for an ingredient at a crate) with nothing in the game to use it.
   *
   * So: a seeded, per-bot chance that a fetch walks to the WRONG crate. The bot
   * commits to it exactly as if it were right, gets there, picks the thing up,
   * takes a beat (the '!' the view draws), and walks it back to the tray it came
   * from. It is not random noise in the planner — the plan is coherent all the
   * way through, it is just aimed one crate over, which is precisely the
   * mistake a person makes.
   *
   * Both bounds are swept in the comment on MISTAKE_RATE. The mistake is a
   * whole plan, not a jitter: it is chosen once, at the moment the fetch is
   * decided, and the bot is then as committed to being wrong as it would have
   * been to being right — which is what stops it looking like a glitch.
   */
  private maybeSlip(s: SimState, bot: Chef, crate: Station, want: Ingredient['kind']): Station {
    const m = this.memFor(bot);
    if (m.slip || m.slipCd > 0 || m.dice() > MISTAKE_RATE) return crate;
    // The crate NEXT to the right one. Nearest by walking distance, so the
    // mistake is always a plausible one — the tray beside the tray — and never
    // a march to the far end of the room.
    let wrong: Station | null = null;
    let best = Infinity;
    for (const st of s.kitchen.stations) {
      if (st.kind !== 'crate' || st.id === crate.id || !st.dispenses) continue;
      const d = Math.hypot(st.cell.x - crate.cell.x, st.cell.y - crate.cell.y);
      if (d < best) {
        best = d;
        wrong = st;
      }
    }
    if (!wrong) return crate;
    m.slip = { station: wrong.id, want, item: -1 };
    return wrong;
  }

  /**
   * AFTER YOU — THE RUNG THAT WAS MISSING, AND THE ONE THE BRIEF IS ABOUT.
   *
   * The file had exactly two ways of noticing a player: the shortlist skips the
   * bench he is standing at (`playerAt` in plan()), and a plan whose item has
   * just left in somebody's hands arms a 0.34s double-take. Both are reactions
   * to something that has ALREADY happened, and the measurement said so — plans
   * voided by another chef taking the item ran 15.0 per service with the player
   * frozen and 12.6 with him awake and grabbing, and `yields` was 0.0 per
   * service in both. Indistinguishable. Unplug the controller and the kitchen
   * runs the same service.
   *
   * This is the missing tense: the player is not AT the bench yet, he is
   * CLOSING ON IT, and this bot has claimed it. A teammate reads that and backs
   * off before the collision, not after it. So: drop the claim, sour the bench
   * for two seconds so the planner cannot immediately take it back, hold still
   * for one beat that the player can see, and go and find something else.
   *
   * IT MUST NOT FIRE ON A PLAYER WHO IS SIMPLY STANDING THERE. A stationary
   * player is already handled by `playerAt`, and a bot that gives way to a
   * parked body would deadlock the pass. Hence the speed gate: he has to be
   * MOVING, and moving roughly at the bench (cos > 0.35, about a 70-degree
   * cone), and nearer to it than the bot is.
   */
  private yieldTo(s: SimState, bot: Chef, m: BotMemory): boolean {
    if (!m.job || m.yieldCd > 0 || m.jobAge < 0.35) return false;
    const st = s.kitchen.stations.find((x) => x.id === m.job!.station);
    if (!st) return false;
    const c = stationCenter(st);
    // ALREADY THERE IS ALREADY THERE. A bot parked at the bench with its hand
    // out is one frame from finishing; walking away from that is not courtesy,
    // it is the plan thrash this file spent two rounds removing.
    if (Math.hypot(c.x - bot.pos.x, c.y - bot.pos.y) < 1.3) return false;
    for (const other of s.chefs) {
      if (!other.isPlayer || other.id === bot.id) continue;
      // HANDS FULL IS NOT COMPETITION. A chef already carrying something cannot
      // take the thing off the bench this bot is walking to, and giving way to
      // one is pure loss. It is also the difference between a rung and an
      // exploit: measured against the adversarial `thief` policy — a player
      // that grabs a bot's live target 20-30 times a service and dumps it —
      // yielding to a full-handed player cost 3.75 dishes a service and killed
      // seven runs of eight before the clock.
      if (other.carrying) continue;
      const px = c.x - other.pos.x;
      const py = c.y - other.pos.y;
      const pd = Math.hypot(px, py);
      if (pd > YIELD_RADIUS) continue;
      if (pd > Math.hypot(c.x - bot.pos.x, c.y - bot.pos.y)) continue;
      const sp = Math.hypot(other.vel.x, other.vel.y);
      if (sp < 1.2) continue;
      if ((other.vel.x * px + other.vel.y * py) / (sp * Math.max(0.001, pd)) < YIELD_CONE) continue;
      m.lagTimer = YIELD_BEAT;
      m.yieldCd = YIELD_CD;
      this.signal(bot, 'yield');
      if (this.trace && this.trace.length < 20000)
        this.trace.push(`${s.time.toFixed(1)} c${bot.id} YIELD @${st.id} to the player`);
      return true;
    }
    return false;
  }

  /**
   * One glyph's worth of intent, queued for the view. Capped: if main.ts is not
   * draining it (every probe in tools/ isn't), it must not grow without bound.
   */
  private signal(bot: Chef, kind: 'yield' | 'oops') {
    this.signals.push({ chef: bot.id, kind, at: { x: bot.pos.x, y: bot.pos.y } });
    if (this.signals.length > 16) this.signals.splice(0, this.signals.length - 16);
  }

  /**
   * PERSONAL SPACE. Station claiming stopped two bots targeting the same board;
   * it never once stopped two BODIES occupying the same square metre, and the
   * sim's collision resolver only fires after they already interpenetrate. The
   * result on screen was three chefs fused into one indistinct 100×140px mass
   * at the green counter — four good models rendered as one bad blob.
   *
   * A quadratic falloff over 1.2 units, hard-capped at 0.62 so it can bias a
   * path but never fight it, plus a tangential term: pure radial repulsion
   * makes two bots on a head-on approach bounce, whereas a tangent makes them
   * pass, which is what the reference's lanes are for.
   */
  private applySeparation(s: SimState, bot: Chef, input: InputSnapshot, weight: number) {
    let sx = 0;
    let sy = 0;
    for (const other of s.chefs) {
      if (other.id === bot.id) continue;
      // THE PLAYER GETS MORE ROOM THAN A TEAMMATE DOES. Bumping is texture
      // between bots and an interruption when it happens to you: a bot starts
      // giving way half a metre earlier and pushes half again as hard for the
      // player as it does for another bot. Measured, four chefs in this room:
      // it is the difference between a fourth body being worth dishes and a
      // fourth body being worth collisions.
      const radius = other.isPlayer ? SEPARATION_RADIUS + 0.5 : SEPARATION_RADIUS;
      const gain = other.isPlayer ? 1.5 : 1;
      const ox = bot.pos.x - other.pos.x;
      const oy = bot.pos.y - other.pos.y;
      const d2 = ox * ox + oy * oy;
      if (d2 >= radius * radius || d2 < 1e-6) continue;
      const d = Math.sqrt(d2);
      const f = (1 - d / radius) ** 2 * gain;
      sx += (ox / d) * f;
      sy += (oy / d) * f;
      // Tangential: swing around the neighbour rather than backing away from
      // it. Sign is fixed by id order so the pair always rotates the same way.
      const turn = other.isPlayer ? (bot.id % 2 ? 1 : -1) : other.id > bot.id ? 1 : -1;
      sx += (-oy / d) * f * 0.55 * turn;
      sy += (ox / d) * f * 0.55 * turn;
    }
    const mag = Math.hypot(sx, sy);
    if (mag < 1e-5) return;
    const k = (Math.min(mag, SEPARATION_MAX) / mag) * weight;
    input.move.x += sx * k;
    input.move.y += sy * k;
  }

  // ------------------------------------------------------------- planning

  private plan(s: SimState, bot: Chef): Job | null {
    const k = s.kitchen;
    const stations = k.stations;
    const m = this.memFor(bot);
    // A station is free if nobody else has claimed it AND nobody else has
    // claimed one right next to it. Claiming by id alone stopped two bots
    // reaching for the same board and did nothing at all about two bots
    // reaching for two boards 1.0 apart — which is the same square metre of
    // floor, and is why three chefs kept fusing into one 100x140px mass at the
    // green counter. The exclusion radius is 1.1 cells — strictly
    // adjacent only. Wider (1.6 was tried) empties the shortlist so often that
    // the fallback rungs run the show and the home bands stop working: front-of
    // -room occupancy fell from 80% of frames to 40% for a 20-point gain in
    // crowding, which is the wrong trade when the whole complaint is an empty
    // foreground.
    const claimedNear = (st: Station) => {
      for (const [id, owner] of this.claims) {
        if (owner === bot.id || id === st.id) continue;
        const other = stations.find((x) => x.id === id);
        if (!other) continue;
        if (Math.hypot(other.cell.x - st.cell.x, other.cell.y - st.cell.y) < 1.1) return true;
      }
      return false;
    };
    // Cost, not raw distance. Straight nearest-first sent every idle bot to
    // whichever corner it happened to be standing in, and since the whole cast
    // spawns near the pass, that corner was always the back wall. Adding the
    // bot's own home region to the cost spreads equivalent stations — there are
    // five tomato crates, four boards and four counters, at every depth in the
    // room — across the floor instead of collapsing them onto one.
    // A LADDER, not a cliff. The first cut of this had one fallback that
    // dropped EVERY filter at once, which handed the planner straight back the
    // station it had just given up on: souring existed but could not bite, and
    // a bot resumed leaning on the same bench inside one frame. It also meant
    // that as soon as neighbour-exclusion emptied the shortlist — which it does
    // often, because the map puts stations in adjacent pairs — the bots fell
    // all the way back to raw nearest-first and re-formed the clot.
    //
    // Relax one constraint at a time instead: give up personal space first,
    // then give up exclusivity, and never give up `sour`, because `sour` is the
    // record of a station that has already proven it will not let us act.
    // WALKING DISTANCE, NOT LINE-OF-SIGHT DISTANCE.
    //
    // `cost` used to measure `hypot(station - bot)`, which is the distance a
    // thrown object would travel. Chefs walk. The two stoves sit in the
    // back-right corner behind a one-cell corridor at column 13, so a bot
    // standing eight metres away across the centre island reads them as near
    // and then spends four seconds discovering they are not — the trace is full
    // of `cook bacon @5 STALL d=6.0 / cook bacon @6 STALL d=6.3`, a bot
    // bouncing between two burners it could not reach. One breadth-first field
    // from the bot's own cell prices every station in the room correctly, and
    // it costs one 165-cell BFS per plan.
    const reach = buildFlow(k, [{ x: Math.floor(bot.pos.x), y: Math.floor(bot.pos.y) }]);
    const walkCache = new Map<number, number>();
    const walk = (st: Station) => {
      let d = walkCache.get(st.id);
      if (d !== undefined) return d;
      d = Math.min(
        sample(reach, st.cell.x + 1, st.cell.y),
        sample(reach, st.cell.x - 1, st.cell.y),
        sample(reach, st.cell.x, st.cell.y + 1),
        sample(reach, st.cell.x, st.cell.y - 1),
      );
      // Unreachable is not "far", it is "no". Big, finite, and still ordered by
      // the home term so the shortlist never comes back empty.
      if (d >= Number.MAX_SAFE_INTEGER) d = 60;
      walkCache.set(st.id, d);
      return d;
    };
    // See OFFSTAGE_COST. Zero on every landscape shape.
    const stage = this.stagePressure();
    const column = stage > 0 ? this.cameraColumn(s) : 0;
    const keep = this.shotHalfWidth * FRAME_KEEP;
    const cost = (st: Station) => {
      const depth = Math.abs(st.cell.y - m.home.y) * DEPTH_BIAS;
      const side = Math.abs(st.cell.x - m.home.x) * LATERAL_BIAS;
      let offstage = 0;
      if (stage > 0) {
        const out = Math.abs(st.cell.x + 0.5 - column) - keep;
        if (out > 0) offstage = out * out * OFFSTAGE_COST * stage;
      }
      return walk(st) * (m.role.kind[st.kind] ?? 1) + (depth + side) * HOME_BIAS + offstage;
    };
    const pick = (list: Station[]) => (list.length ? list.sort((a, b) => cost(a) - cost(b))[0] : null);
    /**
     * AFTER YOU.
     *
     * `chef.focus` is the sim's own answer to "which bench is this chef stood
     * at", recomputed every tick for everybody, and for the player it is the
     * bench their button would act on — the one the game is already glowing
     * under them. A bot that walks into it is a bot competing with you for the
     * thing you are visibly about to use, which is the single most annoying
     * thing a co-op partner does.
     *
     * So the player's focused station drops off the shortlist, on the same
     * ladder as personal space: given up before exclusivity, never before
     * `sour`. It is not psychic — it reads exactly what the glow under the
     * player's feet already shows them — and it is not a veto, so a kitchen
     * where the player is parked on the only free counter still works.
     */
    const playerAt = new Set<number>();
    for (const c of s.chefs) if (c.isPlayer && c.focus !== null) playerAt.add(c.focus);
    const find = (pred: (st: Station) => boolean) => {
      const usable = stations.filter((st) => pred(st) && !m.sour.has(st.id));
      const mine = (st: Station) => {
        const owner = this.claims.get(st.id);
        return owner === undefined || owner === bot.id;
      };
      const free = (st: Station) => !playerAt.has(st.id);
      const first = pick(usable.filter((st) => mine(st) && free(st) && !claimedNear(st)));
      if (first) return first;
      const second = pick(usable.filter((st) => mine(st) && free(st)));
      if (second) {
        if (usable.some((st) => !free(st))) this.tele.track(bot.id).yields++;
        return second;
      }
      return pick(usable.filter(mine)) ?? pick(usable);
    };

    /**
     * Last resort: ignores claims and personal space, used by the rungs that
     * must never come back empty (the bin, the pass, the plate stack).
     *
     * IT HAS TO CLEAR `sour` WHEN IT OVERRIDES IT, and not clearing it was a
     * 3Hz infinite loop. The top of `updateBot` voids any plan whose station is
     * sour, so a `findAny` that handed back a soured bin got its plan killed on
     * the very next tick, re-planned to the same bin, and did it again three
     * times a second for as long as the bot held the thing: 'bin the burnt one'
     * measured 35% of one bot's entire plan history for two burnt rashers a
     * service. Deciding to try a station again and remembering that it is
     * blacklisted are the same decision.
     */
    const findAny = (pred: (st: Station) => boolean) => {
      const clean = pick(stations.filter((st) => pred(st) && !m.sour.has(st.id)));
      if (clean) return clean;
      const any = pick(stations.filter(pred));
      if (any) m.sour.delete(any.id);
      return any;
    };

    const held = bot.carrying;
    // BACK ON THE TRAY IT CAME FROM, before any other rung gets to be clever
    // about the thing in this bot's hands. Without the first claim here the
    // tidy rung bins it, which is a different and much less charming story.
    if (m.slip && m.slip.item >= 0) {
      if (held?.type === 'ingredient' && held.ingredient.id === m.slip.item) {
        const back = stations.find((x) => x.id === m.slip!.station);
        if (back) return { station: back.id, action: 'grab', why: 'put it back where I found it', prio: P.work };
      }
      m.slip = null;
      m.slipCd = SLIP_CD;
    }
    const job =
      held?.type === 'plate'
        ? this.planPlate(s, bot, held.plate, find, findAny)
        : held?.type === 'pan'
          ? this.planPan(s, held.pan, find, findAny)
          : held?.type === 'ingredient'
            ? this.planIngredient(s, held.ingredient, find, findAny)
            : this.planEmpty(s, bot, find, m.role.skips) ?? this.planEmpty(s, bot, find, []);
    if (job) return job;

    // ITEMISE THE IDLE. `plan` returning null is the single most expensive
    // thing this file can do — it is a chef standing in the room doing nothing
    // — and until this counter existed nobody could say which of eight
    // fall-throughs was responsible for it.
    const t = this.tele.track(bot.id);
    const why = !held
      ? this.emptyHandedNull
      : held.type === 'plate'
        ? held.plate.contents.length
          ? 'stuck: part-built plate'
          : 'stuck: empty plate'
        : held.type === 'pan'
          ? 'stuck: pan'
          : `stuck: ${held.ingredient.kind}:${held.ingredient.state}`;
    t.nullWhy.set(why, (t.nullWhy.get(why) ?? 0) + 1);
    return null;
  }

  /** Set by `startNextComponent` so the idle itemisation can name the cause. */
  private emptyHandedNull = 'nothing to do';

  /**
   * HOLDING A PLATE — AND THE ONE BUG THAT WAS COSTING HALF THE SERVICE.
   *
   * Measured before this was written, over six 180s services: 46% of all bot
   * time was spent with NO PLAN AT ALL, all three bots were simultaneously
   * planless for 30% of the run, and 89.7% of every planless tick was a bot
   * standing in the room holding a clean empty plate. The old rung had exactly
   * two escapes — serve it, or park it on a free counter — and the map ships
   * three counters. Once those three held anything, a plate in a pair of hands
   * was a chef removed from the game for the rest of the service, and because a
   * carried plate is not a station, `workingPlateFor` could not see it either,
   * so the OTHER bots went and fetched more plates and joined it.
   *
   * The rule now is that this branch may never return null. Serve, scrape,
   * load, park, put it back, or set it on any flat surface — in that order —
   * and the last rung is the bin, which always exists.
   */
  private planPlate(s: SimState, bot: Chef, plate: Plate, find: Finder, findAny: Finder): Job | null {
    // 1. It matches a live ticket. Take it to the window.
    if (plate.contents.length) {
      const key = plateKey(plate);
      if (s.orders.some((o) => recipeKey(o.recipe) === key)) {
        const serve = find((st) => st.kind === 'serve') ?? findAny((st) => st.kind === 'serve');
        if (serve) return { station: serve.id, action: 'grab', why: 'serve the order', prio: P.serve };
      }
    }
    if (plate.dirty) {
      const sink = find((st) => st.kind === 'sink' && !st.holding);
      if (sink) return { station: sink.id, action: 'grab', why: 'wash the plate', prio: P.tidy };
    }
    // 2. Nothing on the board can ever want this combination — a ticket
    //    expired while it was being built. Scrape it rather than carry a dead
    //    plate around, or park it and block a counter with it forever.
    const dead = plate.contents.length > 0 && !s.orders.some((o) => isSubset(plate.contents, o));
    if (dead) {
      const bin = find((st) => st.kind === 'bin') ?? findAny((st) => st.kind === 'bin');
      if (bin) return { station: bin.id, action: 'grab', why: 'scrape the dead plate', prio: P.tidy };
    }
    // 3. Something this plate wants is sitting ready somewhere. Go and get it.
    //    This is also the ONLY route cooked food has out of a pan.
    if (plate.contents.length < PLATE_CAPACITY) {
      const load = find((st) => this.loadableFor(s, plate, st));
      if (load)
        return {
          station: load.id,
          action: 'grab',
          why: `load the ${this.loadableName(s, plate, load)}`,
          prio: P.work,
          item: this.loadableId(s, plate, load),
          guard: (sim) => {
            const cur = sim.kitchen.stations.find((x) => x.id === load.id);
            return !!cur && this.loadableFor(sim, plate, cur);
          },
        };
    }
    // 4. STAND AT THE HOB AND WAIT FOR IT.
    //
    //    Bacon cooks in 3.4s and burns 4.5s later, and the only way it reaches
    //    a plate is a plate arriving at the stove, so a plate that sets off
    //    when the bacon is already cooked has about four seconds to cross the
    //    room. It did not make it: Bacon Roll closed 3 of 17 tickets and BLT 1
    //    of 5, against Garden Salad's 53 of 58. Going EARLY and waiting is
    //    what a cook does, it is the only way those recipes ever land, and it
    //    is the most legible thing in this file — a chef stood over the pan
    //    with a plate in both hands, which is a pose the player can read from
    //    across the room. Capped at 5s by the station timer, and the guard
    //    drops it the instant the pan is ready so the load fires immediately.
    if (plate.contents.length < PLATE_CAPACITY) {
      const soon = find((st) => this.panCookingFor(s, plate, st));
      if (soon)
        return {
          station: soon.id,
          action: 'wait',
          why: 'wait for the pan',
          prio: P.work,
          guard: (sim) => {
            const cur = sim.kitchen.stations.find((x) => x.id === soon.id);
            return !!cur && this.panCookingFor(sim, plate, cur) && !this.loadableFor(sim, plate, cur);
          },
        };
    }

    // 5. Park it where the rest of the kitchen can build on it. The map ships
    //    THREE counters and the kitchen runs three or four tickets at once, so
    //    counters alone are not enough surface: an empty board is a perfectly
    //    good place to stand a plate and there are nine of them.
    const counter =
      find((st) => st.kind === 'counter' && !st.holding) ?? find((st) => st.kind === 'board' && !st.holding);
    if (counter) return { station: counter.id, action: 'grab', why: 'park plate to finish it', prio: P.fetch };
    // 5. Put it back on the stack. `planGrab` only allows this for a clean,
    //    empty plate, which is exactly the case this rung is for.
    if (!plate.contents.length && !plate.dirty) {
      const disp = find((st) => st.kind === 'plates') ?? findAny((st) => st.kind === 'plates');
      if (disp) return { station: disp.id, action: 'grab', why: 'put the spare plate back', prio: P.tidy };
    }
    // 6. Any flat surface at all, then the bin. One of these always exists.
    const surface = find((st) => (st.kind === 'counter' || st.kind === 'board' || st.kind === 'sink') && !st.holding);
    if (surface) return { station: surface.id, action: 'grab', why: 'set the plate down', prio: P.tidy };
    if (plate.contents.length) {
      const bin = findAny((st) => st.kind === 'bin');
      if (bin) return { station: bin.id, action: 'grab', why: 'scrape the plate', prio: P.tidy };
    }
    return null;
  }

  /**
   * HOLDING A PAN. Nothing used to handle this case at all, and a bot could
   * reach one: the burning-rescue rung lifts a pan off a stove, and every rung
   * below tests for `ingredient` or `!held`, so the bot fell through to null
   * and stood there with it. Burnt contents go in the bin; everything else goes
   * straight back on a burner, because a pan on a counter is a pan nobody can
   * ever plate from.
   */
  private planPan(s: SimState, pan: Pan, find: Finder, findAny: Finder): Job | null {
    if (pan.contents.some((i) => i.state === 'burnt')) {
      const bin = find((st) => st.kind === 'bin') ?? findAny((st) => st.kind === 'bin');
      if (bin) return { station: bin.id, action: 'grab', why: 'bin the burnt one', prio: P.tidy };
    }
    const stove = find((st) => st.kind === 'stove' && !st.holding) ?? findAny((st) => st.kind === 'stove' && !st.holding);
    if (stove) return { station: stove.id, action: 'grab', why: 'pan back on the heat', prio: P.rescue };
    const surface = find((st) => (st.kind === 'counter' || st.kind === 'board') && !st.holding);
    if (surface) return { station: surface.id, action: 'grab', why: 'put the pan down', prio: P.tidy };
    return null;
  }

  /** Holding food: finish preparing it, plate it, or stage it. Never null. */
  private planIngredient(s: SimState, ing: Ingredient, find: Finder, findAny: Finder): Job | null {
    if (ing.state === 'burnt') {
      const bin = find((st) => st.kind === 'bin') ?? findAny((st) => st.kind === 'bin');
      if (bin) return { station: bin.id, action: 'grab', why: 'bin the burnt one', prio: P.tidy };
    }
    const need = this.neededStateFor(s, ing);
    if (need === 'prepped' && ing.state === 'raw' && INGREDIENT_DEFS[ing.kind].chopSeconds > 0) {
      const board = find((st) => st.kind === 'board' && !st.holding);
      if (board) return { station: board.id, action: 'grab', why: `chop ${ing.kind}`, prio: P.work };
    }
    if (need === 'cooked' && ing.state !== 'cooked') {
      const stove = find(
        (st) => st.kind === 'stove' && st.holding?.type === 'pan' && st.holding.pan.contents.length < 3,
      );
      if (stove) return { station: stove.id, action: 'grab', why: `cook ${ing.kind}`, prio: P.work };
    }
    // Ready: onto a plate that wants it. THE GUARD IS THE POINT — the plate can
    // be picked up by the player between the decision and the arrival, and a
    // bot that walks the length of the room to combine with a bench that is now
    // bare is the single most obviously stupid thing this piece can do.
    const plateSt = find((st) => st.holding?.type === 'plate' && this.plateWants(s, st.holding.plate.contents, ing));
    if (plateSt) {
      const plateId = plateSt.holding?.type === 'plate' ? plateSt.holding.plate.id : -1;
      return {
        station: plateSt.id,
        action: 'grab',
        why: `plate the ${ing.kind}`,
        prio: P.work,
        item: plateId,
        guard: (sim) => {
          const cur = sim.kitchen.stations.find((x) => x.id === plateSt.id);
          return cur?.holding?.type === 'plate' && cur.holding.plate.id === plateId && cur.holding.plate.contents.length < PLATE_CAPACITY;
        },
      };
    }
    const counter = find((st) => st.kind === 'counter' && !st.holding);
    if (counter) return { station: counter.id, action: 'grab', why: 'set it down', prio: P.tidy };
    const surface = find((st) => (st.kind === 'board' || st.kind === 'sink') && !st.holding);
    if (surface) return { station: surface.id, action: 'grab', why: 'set it down', prio: P.tidy };
    const bin = findAny((st) => st.kind === 'bin');
    if (bin) return { station: bin.id, action: 'grab', why: 'no room for it', prio: P.tidy };
    return null;
  }

  /** Empty-handed: pick the most valuable thing in the room to touch next. */
  private planEmpty(s: SimState, bot: Chef, find: Finder, skips: string[]): Job | null {
    const m = this.memFor(bot);
    const off = (rung: string) => skips.includes(rung);
    /** Not the thing this bot set down three seconds ago. See placedItem. */
    const fresh = (st: Station) => {
      const h = st.holding;
      if (m.placedFor <= 0 || !h) return true;
      const id = h.type === 'ingredient' ? h.ingredient.id : h.type === 'plate' ? h.plate.id : -1;
      return id !== m.placedItem;
    };
    // 1. A plate on a bench that already matches a ticket. Free points —
    //    EXCEPT when that plate is the working plate of a LONGER ticket that is
    //    still alive. Garden Salad is lettuce + tomato and Chopped Salad is
    //    lettuce + tomato + tomato, so every Chopped Salad plate passes through
    //    a state that exactly matches a Garden Salad, and bots cashed it in
    //    there every single time: measured 50 Garden Salads closed against 2
    //    Chopped Salads for 23 expired. Unless the matching ticket is about to
    //    rot, the deeper ticket keeps its plate.
    const dealtTo = new Map<number, number>();
    for (const [orderId, st] of this.assignPlates(s)) dealtTo.set(st.id, orderId);
    const ready = off('ready') ? null : find((st) => {
      if (st.holding?.type !== 'plate' || !fresh(st)) return false;
      const key = plateKey(st.holding.plate);
      const match = s.orders.find((o) => recipeKey(o.recipe) === key);
      if (!match) return false;
      const mine = dealtTo.get(st.id);
      if (mine !== undefined && mine !== match.id) {
        const owner = s.orders.find((o) => o.id === mine);
        if (owner && owner.recipe.components.length > match.recipe.components.length && match.remaining > 12) return false;
      }
      return true;
    });
    if (ready) {
      const plateId = ready.holding?.type === 'plate' ? ready.holding.plate.id : -1;
      return {
        station: ready.id,
        action: 'grab',
        why: 'collect finished plate',
        prio: P.serve,
        item: plateId,
        guard: (sim) => {
          const cur = sim.kitchen.stations.find((x) => x.id === ready.id);
          return cur?.holding?.type === 'plate' && cur.holding.plate.id === plateId;
        },
      };
    }

    // 2. Chopping is the bottleneck and the board is a dead end until someone
    //    works it, so it outranks fetching. Raw food on a board that nothing
    //    wants is deliberately excluded — that is what the tidy rung is for.
    const board = off('chop') ? null : find(
      (st) =>
        st.kind === 'board' &&
        st.holding?.type === 'ingredient' &&
        st.holding.ingredient.state === 'raw' &&
        this.neededStateFor(s, st.holding.ingredient) === 'prepped',
    );
    if (board)
      return {
        station: board.id,
        action: 'use',
        why: 'chop',
        prio: P.work,
        guard: (sim) => {
          const cur = sim.kitchen.stations.find((x) => x.id === board.id);
          return cur?.holding?.type === 'ingredient' && cur.holding.ingredient.state === 'raw';
        },
      };

    // 3. A part-built plate with everything it still needs already lying about:
    //    carry the plate to the food. This is the only way a cooked item ever
    //    leaves a pan, and it is the most legible thing a bot does — a chef
    //    walking a plate around the room collecting things onto it.
    const runner = off('runner') ? null : find((st) => {
      if (st.holding?.type !== 'plate' || !fresh(st)) return false;
      const plate = st.holding.plate;
      if (plate.dirty || plate.contents.length >= PLATE_CAPACITY) return false;
      if (!s.orders.some((o) => isSubset(plate.contents, o))) return false;
      return s.kitchen.stations.some((other) => other.id !== st.id && this.loadableFor(s, plate, other));
    });
    if (runner) {
      const plateId = runner.holding?.type === 'plate' ? runner.holding.plate.id : -1;
      return {
        station: runner.id,
        action: 'grab',
        why: 'run the plate round',
        prio: P.fetch,
        item: plateId,
        guard: (sim) => {
          const cur = sim.kitchen.stations.find((x) => x.id === runner.id);
          return cur?.holding?.type === 'plate' && cur.holding.plate.id === plateId;
        },
      };
    }

    // 4. Something prepared sitting on a bench that a ticket wants — AND that
    //    has somewhere to go. Without the second half this rung is one half of
    //    a perpetual motion machine: collect it, find that no plate wants it,
    //    put it down, collect it again. A ready ingredient with no plate to
    //    receive it is better off staying on the bench where the next bot to
    //    park a plate can see it.
    const loose = off('loose') ? null : find((st) => {
      if (st.kind === 'crate' || st.kind === 'plates') return false;
      const h = st.holding;
      if (h?.type !== 'ingredient' || !fresh(st)) return false;
      if (this.neededStateFor(s, h.ingredient) !== h.ingredient.state) return false;
      return s.kitchen.stations.some(
        (dest) => dest.holding?.type === 'plate' && this.plateWants(s, dest.holding.plate.contents, h.ingredient),
      );
    });
    if (loose) {
      const ingId = loose.holding?.type === 'ingredient' ? loose.holding.ingredient.id : -1;
      return {
        station: loose.id,
        action: 'grab',
        why: 'collect ready ingredient',
        prio: P.fetch,
        item: ingId,
        guard: (sim) => {
          const cur = sim.kitchen.stations.find((x) => x.id === loose.id);
          return cur?.holding?.type === 'ingredient' && cur.holding.ingredient.id === ingId;
        },
      };
    }

    // 4b. FOOD THAT STILL NEEDS DOING, LEFT ON A BENCH. Without this rung a
    //     single raw rasher put down anywhere froze the whole bacon half of the
    //     menu: `missingFor` counts it as in flight so nobody fetches another,
    //     the ready-collect rung above skips it because it is not in the state
    //     the ticket wants, and the tidy rung skips it because a ticket does
    //     want it. It sat there and every Bacon Roll on the board rotted.
    //     Boards are excluded — raw food on a board is the chop rung's job, in
    //     place, not something to carry off.
    const unfinished = off('unfinished') ? null : find((st) => {
      if (st.kind === 'crate' || st.kind === 'plates' || st.kind === 'board' || st.kind === 'stove') return false;
      const h = st.holding;
      if (h?.type !== 'ingredient' || !fresh(st)) return false;
      const ing = h.ingredient;
      if (ing.state === 'burnt' || !this.wantedByAnyOrder(s, ing)) return false;
      const need = this.neededStateFor(s, ing);
      if (need === ing.state) return false;
      if (need === 'prepped') return s.kitchen.stations.some((b) => b.kind === 'board' && !b.holding);
      if (need === 'cooked')
        return s.kitchen.stations.some(
          (b) => b.kind === 'stove' && b.holding?.type === 'pan' && b.holding.pan.contents.length < 3,
        );
      return false;
    });
    if (unfinished) {
      const ingId = unfinished.holding?.type === 'ingredient' ? unfinished.holding.ingredient.id : -1;
      return {
        station: unfinished.id,
        action: 'grab',
        why: 'pick up what needs doing',
        prio: P.fetch,
        item: ingId,
        guard: (sim) => {
          const cur = sim.kitchen.stations.find((x) => x.id === unfinished.id);
          return cur?.holding?.type === 'ingredient' && cur.holding.ingredient.id === ingId;
        },
      };
    }

    // 4c. A pan with something burnt in it. Nothing else in the kitchen can
    //     empty it, it will catch fire on its own in nine seconds, and until it
    //     is cleared the burner is dead.
    const spoiled = find(
      (st) => st.kind === 'stove' && st.holding?.type === 'pan' && st.holding.pan.contents.some((i) => i.state === 'burnt'),
    );
    if (spoiled) return { station: spoiled.id, action: 'grab', why: 'clear the burnt pan', prio: P.rescue };

    // 5. Start the next missing component of the most urgent ticket.
    const job = this.startNextComponent(s, bot, find, skips, m.role);
    if (job) return job;

    // 6. TIDY. Nothing the board wants is outstanding, so clear the debris —
    //    food nobody ordered left on a bench, plates that belong to expired
    //    tickets. This is the rung that keeps the room from silting up, and it
    //    is why a bot with genuinely nothing to do is now rare rather than
    //    normal. It also reads: a chef clearing a bench is obviously working.
    const junk = find((st) => {
      const h = st.holding;
      if (!h) return false;
      if (st.kind === 'crate' || st.kind === 'plates' || st.kind === 'stove') return false;
      if (h.type === 'ingredient') return !this.wantedByAnyOrder(s, h.ingredient) || h.ingredient.state === 'burnt';
      if (h.type === 'plate') return h.plate.contents.length > 0 && !s.orders.some((o) => isSubset(h.plate.contents, o));
      return false;
    });
    if (junk) return { station: junk.id, action: 'grab', why: 'clear the bench', prio: P.tidy };
    return null;
  }

  /**
   * Is this stove about to produce something this plate wants? Used by the
   * wait rung above; deliberately separate from `loadableFor`, which is about
   * NOW.
   */
  private panCookingFor(s: SimState, plate: Plate, st: Station): boolean {
    if (st.kind !== 'stove' || st.holding?.type !== 'pan') return false;
    if (plate.dirty || plate.contents.length >= PLATE_CAPACITY) return false;
    return st.holding.pan.contents.some(
      (i) =>
        (i.state === 'raw' || i.state === 'prepped') &&
        this.plateWants(s, plate.contents, { ...i, state: 'cooked' }),
    );
  }

  /** Could this station hand something straight onto that plate right now? */
  private loadableFor(s: SimState, plate: Plate, st: Station): boolean {
    if (plate.dirty || plate.contents.length >= PLATE_CAPACITY) return false;
    const h = st.holding;
    if (!h) return false;
    if (h.type === 'ingredient') return this.plateWants(s, plate.contents, h.ingredient);
    if (h.type === 'pan')
      return h.pan.contents.some((i) => i.state === 'cooked' && this.plateWants(s, plate.contents, i));
    return false;
  }

  private loadableItem(s: SimState, plate: Plate, st: Station): Ingredient | null {
    const h = st.holding;
    if (h?.type === 'ingredient') return h.ingredient;
    if (h?.type === 'pan')
      return h.pan.contents.find((i) => i.state === 'cooked' && this.plateWants(s, plate.contents, i)) ?? null;
    return null;
  }

  private loadableName(s: SimState, plate: Plate, st: Station): string {
    return this.loadableItem(s, plate, st)?.kind ?? 'food';
  }

  private loadableId(s: SimState, plate: Plate, st: Station): number {
    return this.loadableItem(s, plate, st)?.id ?? -1;
  }

  /** Does any live ticket still have room for this exact item? */
  private wantedByAnyOrder(s: SimState, ing: Ingredient): boolean {
    for (const o of s.orders) if (o.recipe.components.some((c) => c.kind === ing.kind)) return true;
    return false;
  }

  private startNextComponent(
    s: SimState,
    bot: Chef,
    find: (pred: (st: Station) => boolean) => Station | null,
    skips: string[] = [],
    role?: BotRole,
  ): Job | null {
    const orders = [...s.orders].sort((a, b) => a.remaining - b.remaining);
    /**
     * THE HOB HAS AN OWNER NOW, AND THE OTHER TWO STOP DRIFTING ONTO IT.
     *
     * The role split moved WHICH station a bot walks to and, measured, not what
     * it did with its hands: 'pass' and 'grill' came back with the same top
     * three plans — park the plate, run the plate round, load the tomato —
     * because the thing that actually picks a bot's next job is this function,
     * and this function did not know what a role was. It walks the tickets in
     * urgency order and hands back the first missing component, so whichever
     * bot replans first takes whatever is next, whatever it is for.
     *
     * So the cooked half of the menu gets a first claim and a right of way:
     * 'grill' looks for a component that needs a burner BEFORE it looks at the
     * board, and 'larder' and 'pass' skip cooked components entirely on their
     * first pass. It is still not a veto — planEmpty runs a second time with
     * every skip lifted, so if the grill hand is stuck in the sink nobody
     * stands idle and the bacon still gets fetched.
     */
    if (role?.name === 'grill') {
      for (const order of orders) {
        const plateSt = this.assignPlates(s).get(order.id) ?? null;
        const missing = this.missingFor(s, order, plateSt ? this.contentsOf(plateSt) : []);
        if (!missing || missing.state !== 'cooked') continue;
        const crate = find((st) => st.kind === 'crate' && st.dispenses === missing.kind);
        if (crate) {
          const slip = this.maybeSlip(s, bot, crate, missing.kind);
          return { station: slip.id, action: 'grab', why: `get ${missing.kind}`, prio: P.fetch };
        }
      }
    }
    const leaveTheHob = skips.includes('cook');
    const assigned = this.assignPlates(s);
    let sawPlateless = false;
    let sawSatisfied = false;
    for (const order of orders) {
      const plateSt = assigned.get(order.id) ?? null;
      // A PLATE ALREADY ON ITS WAY IS A PLATE. `workingPlateFor` only looks at
      // stations, so while a teammate was carrying one across the room every
      // other bot read the order as plateless and went to fetch another. Three
      // bots, three plates, one order — and it was measurable: 3.2 plates in
      // circulation at all times against three counters to park them on.
      const coming =
        !plateSt &&
        s.chefs.some(
          (c) =>
            c.id !== bot.id &&
            c.carrying?.type === 'plate' &&
            !c.carrying.plate.dirty &&
            c.carrying.plate.contents.length < PLATE_CAPACITY &&
            isSubset(c.carrying.plate.contents, order),
        );
      // FETCHING A PLATE YOU CANNOT PUT DOWN IS THE PUREST WASTE IN THE FILE.
      // Measured before this gate: 'put the spare plate back' was the most
      // common plan in the game at 15.6% of all plans — a bot walked to the
      // stack, took a plate, found every counter occupied, and walked it back —
      // while 'get bacon' ran at 0.4%, because this branch returns as soon as a
      // ticket has no plate and never reaches the ingredients below. Bacon Roll
      // closed 4 tickets of 19 for exactly that reason. If there is nowhere to
      // park one, fall through and prep the components instead; somebody else
      // will free a surface.
      const canPark = s.kitchen.stations.some((st) => (st.kind === 'counter' || st.kind === 'board') && !st.holding);
      if (!plateSt && !coming && canPark && !skips.includes('plate')) {
        sawPlateless = true;
        const dispenser = find((st) => st.kind === 'plates');
        if (dispenser) return { station: dispenser.id, action: 'grab', why: `plate for ${order.recipe.name}`, prio: P.fetch };
      }
      // With a plate coming, work against an empty one: fetch and prep the
      // first component so the two halves of the job land together.
      const missing = this.missingFor(s, order, plateSt ? this.contentsOf(plateSt) : []);
      if (!missing) {
        sawSatisfied = true;
        continue;
      }
      if (leaveTheHob && missing.state === 'cooked') continue;
      // A bot that will not stand at a board should not be the one fetching
      // the thing that needs one: it walks the tomato to a bench and somebody
      // else walks it to the board. Same ladder as everything else — the
      // second planEmpty pass lifts it, so the crate is never unattended.
      if (skips.includes('chop') && missing.state === 'prepped') continue;
      const crate = find((st) => st.kind === 'crate' && st.dispenses === missing.kind);
      if (crate) {
        const slip = this.maybeSlip(s, bot, crate, missing.kind);
        return { station: slip.id, action: 'grab', why: `get ${missing.kind}`, prio: P.fetch };
      }
    }
    // No order in flight needs anything: pre-stage a plate.
    const anyPlate = s.kitchen.stations.some((st) => st.holding?.type === 'plate');
    if (!anyPlate) {
      const dispenser = find((st) => st.kind === 'plates');
      if (dispenser) return { station: dispenser.id, action: 'grab', why: 'pre-stage a plate', prio: P.tidy };
    }
    this.emptyHandedNull = sawSatisfied
      ? 'every order already has everything in flight'
      : sawPlateless
        ? 'no plate station reachable'
        : 'no crate reachable';
    return null;
  }

  /**
   * ONE PLATE, ONE TICKET.
   *
   * This used to answer "is there any parked plate whose contents fit this
   * order", per order, independently — and an EMPTY plate fits every order, so
   * a single clean plate on a bench told all four live tickets that they were
   * covered. Nobody fetched a second one, every ingredient in the room raced
   * for the same plate, and the measured consequence was 1.29 plates in
   * circulation against 3-4 open tickets while 63% of all plans were a bot
   * picking a prepped tomato up and putting it down again because no plate
   * anywhere wanted it.
   *
   * So plates are DEALT to tickets: most urgent first, each ticket taking the
   * plate that is furthest along and nobody else's. The result is a working
   * plate per ticket, which is how a kitchen actually runs a pass.
   *
   * Recomputed per plan call rather than cached, because it has to reflect the
   * player's interference — a plate the player picks up must vanish from the
   * assignment on the same tick.
   */
  private assignPlates(s: SimState): Map<number, Station> {
    const out = new Map<number, Station>();
    const taken = new Set<number>();
    const orders = [...s.orders].sort((a, b) => a.remaining - b.remaining);
    for (const order of orders) {
      let best: Station | null = null;
      let bestCount = -1;
      for (const st of s.kitchen.stations) {
        if (st.holding?.type !== 'plate' || taken.has(st.id)) continue;
        const plate = st.holding.plate;
        if (plate.dirty || plate.contents.length >= PLATE_CAPACITY) continue;
        if (!isSubset(plate.contents, order)) continue;
        if (plate.contents.length > bestCount) {
          bestCount = plate.contents.length;
          best = st;
        }
      }
      if (best) {
        out.set(order.id, best);
        taken.add(best.id);
      }
    }
    return out;
  }

  /** The plate dealt to this ticket, if any. */
  private workingPlateFor(s: SimState, order: Order): Station | null {
    return this.assignPlates(s).get(order.id) ?? null;
  }

  private contentsOf(st: Station): Ingredient[] {
    return st.holding?.type === 'plate' ? st.holding.plate.contents : [];
  }

  private missingFor(s: SimState, order: Order, contents: Ingredient[]): { kind: Ingredient['kind']; state: PrepState } | null {
    const have = countBy(contents.map((i) => `${i.kind}:${i.state}`));
    // Anything already in flight (carried or on a station) counts as handled.
    // (A slipped ingredient on its way back to its tray needs no exemption
    // here: `keyFor` files it under a kind the recipe never asked for, so it
    // was never in this census in the first place. Measured — the exemption
    // changed nothing, to the dish.)
    for (const chef of s.chefs) {
      if (chef.carrying?.type === 'ingredient') bump(have, keyFor(chef.carrying.ingredient, order));
    }
    for (const st of s.kitchen.stations) {
      if (st.holding?.type === 'ingredient') bump(have, keyFor(st.holding.ingredient, order));
      if (st.holding?.type === 'pan') for (const i of st.holding.pan.contents) bump(have, keyFor(i, order));
    }
    for (const c of order.recipe.components) {
      const key = `${c.kind}:${c.state}`;
      const n = have.get(key) ?? 0;
      if (n > 0) {
        have.set(key, n - 1);
        continue;
      }
      return { kind: c.kind, state: c.state };
    }
    return null;
  }

  private plateWants(s: SimState, contents: Ingredient[], ing: Ingredient): boolean {
    for (const order of s.orders) {
      const next = [...contents, ing];
      if (isSubset(next, order)) return true;
    }
    return false;
  }

  /** What state does any live order want this ingredient in? */
  private neededStateFor(s: SimState, ing: Ingredient): PrepState {
    for (const order of s.orders) {
      for (const c of order.recipe.components) {
        if (c.kind === ing.kind) return c.state;
      }
    }
    const def = INGREDIENT_DEFS[ing.kind];
    if (def.cookSeconds > 0) return 'cooked';
    if (def.chopSeconds > 0) return 'prepped';
    return 'raw';
  }
}

// ------------------------------------------------------------------ utils

function keyFor(ing: Ingredient, order: Order): string {
  // BURNT IS NOT IN FLIGHT, IT IS RUBBISH — and counting it as in flight was a
  // permanent kitchen-wide deadlock, not a rounding error. One burnt rasher
  // left in a pan reads here as "a cooked bacon is already on its way", for
  // every Bacon Roll and BLT for the rest of the service, so no bot ever
  // fetched another one: 2 closed against 14 expired.
  if (ing.state === 'burnt') return `${ing.kind}:burnt`;
  // Treat an ingredient that is mid-transformation as its eventual state, so
  // bots don't stampede for a second tomato while one is already on the board.
  const target = order.recipe.components.find((c) => c.kind === ing.kind);
  if (target) return `${ing.kind}:${target.state}`;
  return `${ing.kind}:${ing.state}`;
}

function countBy(keys: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const k of keys) m.set(k, (m.get(k) ?? 0) + 1);
  return m;
}

function bump(m: Map<string, number>, key: string) {
  m.set(key, (m.get(key) ?? 0) + 1);
}

function isSubset(contents: Ingredient[], order: Order): boolean {
  const want = countBy(order.recipe.components.map((c) => `${c.kind}:${c.state}`));
  for (const i of contents) {
    const key = `${i.kind}:${i.state}`;
    const n = want.get(key) ?? 0;
    if (n <= 0) return false;
    want.set(key, n - 1);
  }
  return true;
}

/** Never longer than `max`. Direction preserved. */
function clampMove(input: InputSnapshot, max: number) {
  const m = Math.hypot(input.move.x, input.move.y);
  if (m <= max || m < 1e-6) return;
  input.move.x = (input.move.x / m) * max;
  input.move.y = (input.move.y / m) * max;
}

function angleDelta(a: number, b: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}
