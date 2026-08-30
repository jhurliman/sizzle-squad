import type { IngredientDef, IngredientKind, Recipe } from './types';

export const PLATE_CAPACITY = 4;

/**
 * Tuning constants that the feel of the whole game hangs off of.
 *
 * MOVEMENT FEEL PASS — EVERY NUMBER BELOW IS NOW MEASURED, NOT GUESSED.
 *
 * These were the day-one guesses and nobody had ever judged them. The
 * instrument is `tools/movprobe.mjs`, which bundles this pure domain with
 * rolldown and drives scripted routes through the real sim at the real 60Hz
 * tick — top speed, time to top speed, coast distance, turn cost, corner
 * behaviour, parking forgiveness, bump frequency. Run it.
 *
 * Where a number moved, the comment states the LOWER bound, the UPPER bound and
 * the target between them, because the history of this project is pieces that
 * were given a direction and overshot it.
 *
 * WHAT DID NOT MOVE, AND WHY, is as much of the work as what did:
 *
 *   moveSpeed 6.2 — measured, a chef crosses the room's 13 walkable columns in
 *   1.97s empty-handed and the full diagonal in 2.98s. Both references sit in a
 *   2-3s band for a room crossing, so the number the brief expected to be wrong
 *   is the one number here that was already right. Below ~5.2 the room stops
 *   reading as fast; above ~7.0 a chef covers the 0.14u of slack either side of
 *   a one-cell lane inside two frames of lateral correction and threading
 *   becomes a coin flip. 6.2 sits between them and stays.
 *
 * AND ONE WARNING FOR WHOEVER TUNES THIS NEXT: `served` CANNOT ARBITRATE HERE.
 *
 * The obvious way to price a movement change is to race it through the bots and
 * count dishes. It does not work, and it took forty seeds a variant to be sure
 * it does not. `served` is a chaotic function of these constants rather than a
 * smooth one — the bot brain claims stations, so nudging any number reshuffles
 * which bot gets which board, and that cascades. Sweeps of a single lever came
 * back non-monotonic every time, with intermediate values scoring both above
 * and below the two endpoints, and one variant returned 3.00 dishes with a
 * standard error of ZERO across forty different seeds, which is a deadlock
 * wearing a tuning result's clothes.
 *
 * Underneath it sits a real defect that belongs to the bots, and the instrument
 * for it is in `tools/movprobe.mjs --only stall`: 12-18% of all chef time is
 * spent motionless for longer than eight seconds at a stretch, and 0.0% of that
 * happens away from a station. Every long stall is a chef standing AT a station
 * it has in focus, so nothing is welded in a lane and the movement layer is
 * clear — it is a plan that never completes. Until that is fixed, dish counts
 * measure the bot brain's luck, not how the kitchen feels.
 *
 * So every number below is justified on a DETERMINISTIC, low-noise measurement
 * — time to top speed, coast distance, corner behaviour, bump frequency, the
 * the movement tuning's own economics — and `served` is used for one thing
 * only: confirming
 * the shipped set is not a regression. It is not. 8.03 +/- 0.29 against the
 * day-one 8.05 +/- 0.23 over the same forty seeds.
 */
export const TUNING = {
  /**
   * Cells per second at full stick. Overcooked sits around 4.5 body-lengths/s;
   * a chef is ~1.09 units tall, so 5.7 is 5.2 body-lengths/s.
   *
   * WAS 6.2 (1.97s to cross the room, 2.98s corner to corner). Dropped ~8% off
   * the back of the Roblox port, where chefs read as slightly too twitchy
   * through a fixed 22.5-degree camera -- and the same note applies in the
   * browser, so the change lives here rather than as a port-side override.
   * Crossing is now ~2.14s and the diagonal ~3.24s, both still inside the 2-3s
   * band the reference sits in, and 5.7 stays clear of the ~5.2 floor below
   * which the room stops reading as fast.
   */
  moveSpeed: 5.7,
  /**
   * How many clean plates the kitchen owns.
   *
   * WASHING UP WAS DEAD CONTENT. The sink, its verb, its 2.2s timer, the
   * washDone event, a dirty-plate mesh and the bot brain's "wash the plate"
   * rule all existed, but nothing ever set `dirty` and the racks were
   * bottomless, so no player ever had a reason to walk to a sink.
   *
   * A finite stock is what gives the sink a job. Infinity restores the old
   * bottomless behaviour.
   */
  plateStock: 8,
  /**
   * Multiplier while carrying a plate or a pan — heavier, more committed.
   *
   * 0.9 WAS UNDER THE JUST-NOTICEABLE DIFFERENCE AND THEREFORE FREE.
   * Measured on the same route: 1.97s empty against 2.18s carrying, an 11%
   * trip-time delta. The Weber fraction for discriminating speed or duration
   * sits around 10%, so the old penalty was exactly at threshold — visible in
   * an A/B of two logs, invisible in play. The brief's bar is that "carrying
   * changes how you move enough that you FEEL it".
   *
   * Bounds: above 0.88 it is back under the JND. Below ~0.78 a laden chef is
   * slower than the bots' replan cadence. Target a 20-25% trip-time delta;
   * 0.82 measures 2.40s against 1.97s across the room = +23%, comfortably
   * clear of threshold and still short of a wade.
   *
   * NOT PRICED IN `served`, AND HONESTLY SO — see the note at the bottom of
   * this block. Every carry variant was raced over 40 seeds and the numbers
   * were not monotonic in the parameter, so they cannot decide this. What can
   * be said is that the shipped set is not a regression.
   *
   * And the penalty is no longer a single number: `carryAccelMul` below changes
   * the CHARACTER of carrying, not just its rate, which is what makes it read
   * as weight rather than as a debuff.
   */
  carrySpeedMul: 0.82,
  /**
   * Accel time constant multiplier while carrying. >1 = takes longer to wind
   * up: t90 goes from 0.167s empty-handed to 0.25s with a plate, so a laden
   * chef leans into the start of a run instead of snapping into it. This is the
   * channel that makes carrying read as WEIGHT rather than as a slower number,
   * and it costs nothing an instrument can find.
   */
  carryAccelMul: 1.5,
  /**
   * Turn rate multiplier while carrying. 1.0 = OFF, AND THIS IS A MEASURED
   * RETREAT, NOT AN OVERSIGHT.
   *
   * A wider swing while laden is the obvious third channel for weight, and it
   * is the one lever in this block whose sign never flipped no matter how the
   * noise was resampled: every value below 1.0 raced worse than 1.0, in two
   * separate rounds of measurement and on both sides of the spawn bug that
   * `sim.ts` documents.
   *
   * The mechanism is concrete. `findFocus` gates on the chef's HEADING, and
   * heading only advances while there is something to aim at — so a chef that
   * arrives at a station and stops keeps whatever angle the last frame of the
   * approach left it with. Slow the laden turn and that heading stops
   * converging in time to grab anything, and a laden chef is most chefs most of
   * the time.
   *
   * Not worth a mechanism that quietly stops chefs picking things up. Weight is
   * carried by speed and acceleration instead. Left in at 1.0, rather than
   * deleted, so the next person can see it was tried and priced.
   */
  carryTurnMul: 1,
  /**
   * PRODUCE IN YOUR HANDS — THE TIER THAT DID NOT EXIST.
   *
   * `isLaden` in sim.ts returned true only for a plate or a pan, so carrying a
   * tomato was measurably, bit-for-bit identical to carrying nothing: 6.200 top
   * speed both, 1.683s over a 10u sprint both, 0.00% difference on the one
   * instrument that asks the question (tools/feelcrit.mjs, CARRY
   * DIFFERENTIATION). Fetching produce is most of what a chef does, and the
   * carry pose is the loudest silhouette read the reference has.
   *
   * Bounds are its two neighbours. 1.00 is the shipped defect and is under the
   * ~10% Weber threshold by construction. `carrySpeedMul` 0.82 is what a full
   * plate costs, and matching it would make the three tiers into two again.
   * Target the middle of that gap and clear of threshold: 0.90 measures a 10.9%
   * trip-time delta, half the plate's 22.8%. You feel it; you do not fight it.
   */
  produceSpeedMul: 0.9,
  /**
   * Accel multiplier while carrying produce — a third of the plate's 1.5. A
   * tomato should cost a hint of wind-up, not a commitment: t90 goes 0.167s ->
   * 0.19s, against the plate's 0.24s.
   */
  produceAccelMul: 1.17,
  /**
   * Time constant of the approach to full speed (NOT the time to reach it:
   * 90% takes 2.3x this, 99% takes 4.6x).
   *
   * 0.085 gave t90 = 0.20s and a launch that lost 0.48u to a hypothetical
   * instant one. Bounds: below ~0.05 the launch is a teleport and the
   * anticipation REFERENCE.md asks for is gone; above ~0.10 t90 passes 0.23s
   * and the chef wades. Target t90 ~0.16s => 0.07.
   */
  accelTime: 0.07,
  /**
   * Time constant of the coast after the stick is released. Longer than accel
   * on purpose: that asymmetry IS "slightly slippery".
   *
   * The old 0.11 against 0.085 was a ratio of 1.29 — a wash. The hard ceiling
   * here is `reach` below: total coast is moveSpeed * this, and if the coast
   * exceeds the depth of the focus window you sail past every station you aim
   * at. Measured coast: 0.68u at 0.11, 0.81u at 0.13 — about 1.1 body widths,
   * and the parking probe says the release window survives it. Bounds: under
   * 0.09 the stop is a wall; over 0.16 the coast is 1.0u and stations start
   * getting overshot. Target 0.13, ratio 1.86.
   */
  decelTime: 0.13,
  /**
   * Radians/second the BODY turns. Movement does not use this at all — velocity
   * chases the stick directly — so this is purely how fast the character reads
   * as changing its mind, and lowering it buys visible skid for free.
   *
   * 18 rad/s turned 90 degrees in 0.087s: five frames, too fast to see, and it
   * is why the cast has read as sliding on rails. Bounds: below ~9 a 180 takes
   * over 0.35s and the interaction cone starts lagging behind where you are
   * standing; above ~15 the pivot is invisible. Target a 90 in ~8 frames => 12.
   *
   * Priced before shipping, because heading gates `findFocus` and a slower body
   * could have cost acquisitions. It does not measurably: 12 races level with
   * 18 over 40 seeds. (What was NOT free was slowing the turn only while laden
   * — see `carryTurnMul`.)
   */
  turnRate: 12,
  chefRadius: 0.36,
  /**
   * EXTRA CLEARANCE AT THE ROOM'S OWN WALLS, BECAUSE THE WALL IS NOT THE CELL.
   *
   * `chefRadius` keeps a body out of a blocked CELL, and for a bench that is
   * exactly right — the bench is drawn inside its cell. The room shell is not:
   * the side walls carry a rubble skirt whose stones bulge to 0.28 past the
   * cell face and a plank door that stands proud of it, so a chef pressed
   * against the left wall stood with a shoulder inside the stonework and half
   * inside the door. Reported as "my character can clip about halfway through
   * the door on the left, and a little ways through the stone in the walls".
   *
   * The chef is not the problem — its drawn half-width is about 0.27, well
   * inside the 0.36 it collides with. The art is simply in front of the line
   * the collision uses, so the collision moves to where the art is. 0.30 clears
   * the skirt with room to spare and clears the door once the door is pulled
   * back to 1.32 (see `door()` in view/world.ts, moved in the same change).
   *
   * Border cells only. Applying it to every blocked cell would push chefs a
   * third of a cell off every bench in the room and break `reach`.
   */
  wallSkirt: 0.3,
  /**
   * Speed above which the body keeps turning toward its own velocity after the
   * stick is released. Infinity disables it (which is what shipped before this
   * pass, and see sim.ts for why it mattered). 0.75 u/s is about an eighth of
   * cruise — low enough to cover the whole coast, high enough that a chef
   * jostled by the separation term does not slowly pirouette on the spot.
   */
  coastTurnSpeed: 0.75,
  coastTurnSkid: 1.05,
  /**
   * CORNER SLIP — the largest lateral correction the sim will make to carry a
   * chef around a bench corner he is clipping. Half the body radius.
   *
   * THIS IS THE ONE THAT WAS A BUG, NOT A TASTE. With axis-separated collision
   * and nothing to depenetrate, a chef running flat out down a lane whose disc
   * overlapped a bench corner by FIVE MILLIMETRES — 0.7% of his 0.72u width —
   * had his x candidate rejected every single tick, nothing ever nudged him the
   * 5mm sideways he needed, and he stood there at 0.05 u/s with the stick
   * pinned forward for the remaining 2.25 seconds of the trace. Every overlap
   * from 0.005u to 0.30u behaved identically: welded. Invisible in a
   * screenshot, one line in a log.
   *
   * The size of this number is what separates a CORNER from a FACE. Run into
   * the long side of a bench and no small lateral offset frees you, so you
   * stop, which is correct. Clip a corner and you slide off it. 0.18 = half the
   * body radius: generous enough that cutting a corner is rewarded, small
   * enough that it can never squeeze you somewhere you do not fit (the escape
   * position is collision-tested in full before it is used).
   */
  cornerSlip: 0.18,
  /**
   * How far past the EDGE of a bench the arms go. Measured from the station's
   * cell box, not from its centre — see `boxDist` in sim.ts for why the circle
   * it replaced left every diagonal grab in the game working by five
   * centimetres. Along a face this is exactly the old envelope; at the corners
   * it is 0.95 of slack instead of 0.036.
   */
  reach: 0.95,
  /**
   * HOW LONG A GRAB PRESS STAYS ALIVE LOOKING FOR SOMETHING TO DO.
   *
   * The press used to be consumed by the tick it arrived on. Measured with
   * tools/critic_station.mjs before this existed: a press one 17ms tick early
   * produced the target 0.0% of the time and a press on the exact tick 100%,
   * i.e. the window opened on a cliff one frame wide, and the human-timing rig
   * (press on arrival, which is what a person actually does) landed 6.8% of
   * presses at 50ms early and 2.3% at 100ms.
   *
   * BOTH BOUNDS ARE REAL. Too short and the cliff survives. Too long and two
   * things go wrong: the press outlives the intent and answers on the next
   * bench you walk past instead of the one you meant, and the gap between
   * pressing and the thing happening becomes a lag you can feel — the buffer's
   * own length is the worst case, and 0.15s is 9 frames.
   *
   * Swept 0.001 / 0.05 / 0.10 / 0.15 / 0.20 / 0.30 s over every crate and plate
   * stack times 24 bearings (tools/grabsweep.mjs), pressing N ms before the tick
   * the station becomes focusable:
   *
   *            on target at  -200 / -100 / -50 ms     wrong bench at -100 ms
   *     1ms         0%     0%     0%                       22%
   *    50ms         0%     0%    90%                       22%
   *   100ms         0%    75%    90%                       25%
   *   150ms         0%    75%    90%                       25%
   *   200ms        49%    75%    90%                       25%
   *
   * The wrong-bench column is the surprise and it is why this is nearly free:
   * those presses were ALREADY landing on a neighbour in the shipped build —
   * they are ticks where a different bench genuinely held the focus — and the
   * buffer adds about three points to them while converting the entire
   * "nothing happened" column into the grab the player asked for. Going past
   * 0.15 buys only the 200ms-early row and starts costing real wait: 0.15 is
   * the last value whose worst-case press-to-action delay is still inside the
   * 150ms a person reads as "immediate".
   */
  grabBufferSeconds: 0.15,
  /**
   * Below this speed a refused press is refused ON THE FRAME IT ARRIVES rather
   * than buffered — see `step`. 0.5 u/s is 8% of cruise; over the whole 150ms
   * window a chef that slow covers 0.075u, against the 0.27u-deep band in which
   * one specific crate is yours (critic_station rig 6). So there is no
   * geometry a chef under this speed can reach by waiting, and nothing is being
   * thrown away except the silence.
   */
  grabBufferMinSpeed: 0.5,
  /**
   * Max angle (radians) off-heading a station can be and still be focusable.
   *
   * WAS PI*0.55 = 99 DEGREES, WHICH IS NOT "ROUGHLY FACING", IT IS "NOT
   * DIRECTLY BEHIND". Swept in tools/focusprobe.mjs over every body-fitting
   * position and 72 headings: at 99 degrees, 5.1% of every focus this game
   * hands out is a station BEHIND the chef's shoulder line, and at 110 it is
   * 10.2%. A bench lighting up behind your back is not generosity, it is the
   * glow telling you something you cannot act on and did not mean.
   *
   * Bounds are both real and both are punishments. Too tight and a station you
   * are standing at refuses you because you are looking 50 degrees off it; too
   * wide and the button acts on things you never looked at. The sweep's costs:
   * the "walk at it and stop" acquisition rate is 100% at every value from 45
   * to 110 degrees, and the two failure modes cross around 80 — behind-picks go
   * to zero at 90 and below, jitter sensitivity flattens out above 70.
   *
   * PI*0.44 = 79 degrees: a 158-degree window, everything in front of the
   * shoulder line and nothing behind it. Verified after: behind-picks 0.0%,
   * acquisition still 100%, and the incumbent station keeps a further
   * `focusKeepCone` on top so a small turn never drops what you already have.
   */
  reachCone: Math.PI * 0.44,
  /**
   * SECONDS OF TRAVEL THE AIM POINT IS WOUND BACK BY — the whole of the fix for
   * the grab you take on the run, and the number this pass expected to spend on
   * a wider cone instead.
   *
   * The symptom: sprint down a lane past a bench and press when you are level
   * with it, and 25% of those presses landed. The diagnosis is not the cone. In
   * `step`, `moveChef` runs BEFORE the focus gate, so a press made on the frame
   * where the bench is beside you is judged from 0.103u further down the lane,
   * where that same bench is 92 degrees BEHIND you — measured tick by tick in
   * tools/driveby.mjs, which prints the angle at every press.
   *
   * So the two candidate levers were swept against each other (tools/driveby.mjs
   * sweep), cells = % of drive-by presses that produced a pickup:
   *
   *                    lead 0tk  lead 1tk  lead 2tk  lead 3tk
   *     cone + 0.0 deg      67%      100%      100%      100%
   *     cone + 4.0 deg      67%      100%      100%      100%
   *     cone +14.0 deg      67%      100%      100%      100%
   *
   * The cone column is flat: widening it buys NOTHING, at any value, and the
   * whole effect belongs to the ordering. So no cone was widened — `reachCone`
   * is untouched at 79 degrees and behind-the-shoulder picks stay where the
   * sweep at line 240 left them.
   *
   * ONE TICK, AND NOT TWO. 1/60 is exactly the offset the update order
   * introduces: it makes the gate judge the press from the position that was on
   * screen when the player decided to press it, which is a correction, not a
   * gift. The upper bound is real and `tools/driveby.mjs behind` prices it — a
   * census of every focus the gate hands a chef travelling flat out, counting
   * the ones that sit more than 90 degrees off heading measured from where the
   * body is NOW:
   *
   *     lead 0 ticks    0.00% behind    worst  78.7 deg
   *     lead 1 tick     0.00% behind    worst  83.2 deg
   *     lead 2 ticks    0.22% behind    worst  90.0 deg
   *     lead 3 ticks    3.69% behind    worst  93.4 deg
   *     lead 6 ticks   15.10% behind    worst 108.4 deg
   *
   * One tick buys the entire drive-by and costs exactly nothing. Everything
   * past it is a bench lighting up behind your back, which the cone sweep
   * already ruled out once.
   *
   * At a standstill this term is exactly zero, so every number in the static
   * sweep of tools/focusprobe.mjs is unchanged bit for bit.
   */
  focusLead: 1 / 60,
  /**
   * FOCUS HYSTERESIS — the head start, in score units, that the station you are
   * already focused on keeps over a challenger.
   *
   * Without it the winner is recomputed from scratch every tick and two benches
   * within reach trade the glow on sub-degree heading noise. Measured over six
   * 170s services with the real bots: 5.81 focus changes a second for the
   * player, 1.05 per bot, and 31%/47% of them reversed inside a quarter second.
   * That is a strobe under the furniture that no screenshot can show, and it is
   * why bots/brain.ts carries a 1.3s stall breaker for a bot parked between two
   * adjacent stations.
   *
   * The score is `angle * 0.8 + boxDistance * 0.9`, so 0.18 is worth about 13
   * degrees of turn or 0.20 units of walk. Bounds: 0 is the strobe; much past
   * 0.35 (25 degrees) the glow starts lagging behind the body and you grab the
   * bench you just turned away from, which is the same lie in the other
   * direction. Target: kill four fifths of the flip-backs and leave acquisition
   * at 100% with no added latency.
   */
  focusStick: 0.18,
  /** Extra reach and cone the incumbent station keeps — the same hold, applied at the gate. */
  focusKeepReach: 0.15,
  focusKeepCone: Math.PI * 0.06,
  /**
   * COYOTE TIME FOR FOCUS — how long the station you just lost stays yours.
   *
   * `focusStick` and `focusKeepReach` are both head starts for an incumbent
   * that still PASSES the gate. Nothing held one that had just fallen out of
   * it, so a chef working at a bench — turning, being jostled, drifting a few
   * centimetres — dropped focus to null and picked it straight back up 2.04
   * times a second, with a median dark gap of 267ms and a p90 of 850ms
   * (tools/critic_station.mjs rig 4). Every press inside a gap was destroyed.
   *
   * Bounds. Too short and the gaps survive. Too long and the glow lags the
   * body: you press and act on a bench you have already turned away from,
   * which is the same lie in the other direction. The distance gate is what
   * bounds the damage — a coyote focus is still dropped the moment you are
   * further than `reach + focusKeepReach` from the box, so it can only ever
   * survive a TURN, never a walk. Swept over six 170s services in rig 4, against
   * a shipped baseline of 22.8% in-reach-null / 2.04 blinks a second / 267ms
   * median gap:
   *
   *   0.06s   16.4%   1.92/s   217ms
   *   0.12s    9.8%   1.74/s   150ms
   *   0.20s    4.7%   1.29/s   133ms
   *   0.30s    2.0%   1.07/s    83ms
   *
   * 0.20 is where in-reach-null goes under the 5% the brief asked for, and it
   * is as far as this should go: the marker keeps burning on a bench for as
   * long as this timer, so 0.30 is 18 frames of glow on furniture the player
   * has already turned away from. The number that is NOT bought here is the
   * blink rate — 1.29/s against a 0.5 target — and the remainder is not a
   * blink at all: at 0.20 the median surviving gap is 133ms and n has fallen
   * from 1040 to 662, so what is left is mostly honest walking between benches,
   * which no coyote should paper over.
   */
  focusCoyote: 0.2,
  /**
   * How far down the list a station goes when the button would do NOTHING
   * there. Worth ~43 degrees of turn, so an inert bench you are pointing
   * straight at loses to a useful one at your shoulder — but it can still take
   * the focus when nothing else is in reach, because "you are next to this" is
   * information too. The point of the term is that a lit station is a station
   * that answers.
   */
  focusInertPenalty: 0.6,
  /**
   * And how far down a station goes when the press WOULD work but it is not
   * what the station is for — your plate on a chopping board, a swap, putting
   * an ingredient back in its crate. See `affordance` in sim.ts: without this
   * tier, the day the benches learned to hold anything, bots-alone throughput
   * fell from a median of 9 dishes to 6 because a board could out-argue the
   * counter a chef was walking to. Worth ~21 degrees of turn — enough to lose a
   * fair fight, not enough to hide.
   */
  focusOffLabelPenalty: 0.3,
  /**
   * A BUMP FIRES ON CLOSING SPEED ALONG THE CONTACT NORMAL, NOT ON |va - vb|.
   *
   * The old test was `rel > moveSpeed * 0.8`, which counts two chefs merely
   * crossing paths at speed as a head-on collision. Measured over six full
   * services driven by the real BotDirector — 13143 contact ticks — it fired on
   * 10.1% of them: one bump per chef every 2.86 seconds, with 6.9% of all chef
   * time spent frozen. That is not "a real, funny, survivable event", that is
   * weather.
   *
   * Closing speed also solves the re-fire problem for free: the tick after a
   * bump the pair is separating, so the term is negative and the event cannot
   * machine-gun.
   *
   * Bounds from that same measured distribution: a threshold of 4.0 fires on
   * 12.6% of contacts (worse than the thing being fixed), 8.0 on 2.8% (a bump
   * becomes a rarity nobody learns to expect). Target ~5% => 5.5.
   *
   * SHIPPED RESULT, four mobile chefs: one bump per chef every 4.0s with 8.1%
   * of chef time stunned, against 3.8s and 11.8% for the same rule carrying the
   * old 0.22s stun and no shove. The player is bumped every four seconds and
   * SEES one somewhere in the room roughly every second — an event for you,
   * texture for the kitchen, which is the shape the reference has.
   */
  /**
   * WAVE 2 — 5.5 WAS RIGHT FOR THE OLD ROOM AND TOO LOW FOR THIS ONE.
   *
   * The lane rewrite in kitchen.ts doubled the open floor and halved the number
   * of benches, so four chefs now converge on 15 stations instead of 29 and
   * spend 47.3% of the service within two body widths of each other against
   * 40.6% before — more crowding at the counters, not less. With the per-pair
   * lock below already down to 6.0% re-hits, the bumps that were left were all
   * genuinely separate encounters, and there were still 15.2 of them a minute
   * on the player.
   *
   * Swept on tools/bumpsweep.mjs, 8 seeds x 150s, lock held at 0.70:
   *
   *     5.5   15.2 player bumps/min   28.6 room/min   4.1% stunned
   *     6.2   12.7                    26.1           3.4%
   *     6.6   11.1                    23.2           3.0%   <- target
   *     7.0   10.7                    22.0           2.8%
   *
   * 6.6 is one bump on the player every 5.4s and one somewhere in the room
   * every 2.6s: an event for you, texture for the kitchen, which is the shape
   * the block above was aiming at and the shape the reference has. The upper
   * bound is unchanged and still 8.0 — past there a bump is "a rarity nobody
   * learns to expect" — and the flat return between 6.6 and 7.0 says there is
   * nothing left to buy in that direction anyway.
   */
  bumpClosingSpeed: 6.6,
  /**
   * Recoil speed handed to BOTH chefs along the contact normal. A bump used to
   * apply exactly nothing: the pair was separated by the overlap-resolution
   * push and then frozen, so a collision at 12.4 u/s of closing speed produced
   * 0.00 units of knockback and read as the game pausing you. Against
   * `stunDrag` below, 3.2 travels about 0.35u each — half a body width apart in
   * opposite directions, which is a shove you can see from the game camera.
   */
  bumpKnockback: 4.2,
  /**
   * Seconds of contact immunity for ONE PAIR of chefs after their bump fires.
   *
   * The comment on `bumpClosingSpeed` claims the closing-speed test is a
   * re-fire guard for free, because "the tick after a bump the pair is
   * separating". That is true only when both bodies stop driving into each
   * other, and a bot on a flow field never stops. Measured, tools/bumpprobe.mjs,
   * one head-on encounter where both sticks stay pressed in: 10 separate bump
   * events at knockback 3.2, 9 at 4.5, 8 at 5.5, still 7 at 8.0. The impulse is
   * not the mechanism and never was — which is why `bumpKnockback` above moved
   * 3.2 -> 4.2 and not 3.2 -> 6.5. The same probe says the pair is already a
   * clean 0.72u of clear air apart 0.16s after a 3.2 knock; 6.5 would have put
   * them 1.45u apart at the same instant, two body widths, a launch. 4.2 opens
   * 1.01u at 0.16s and settles at 1.34u — a shove you read from the game
   * camera, still inside two body widths.
   *
   * Swept against both failure modes at once (tools/bumpsweep.mjs, 8 seeds x
   * 150s of real BotDirector play on the rewritten map):
   *
   *     window   player bumps/min   room bumps/min   same-pair re-hit <1s
   *     0.00           23.5              49.6              48.2%
   *     0.20           23.1              48.1              49.1%   no effect
   *     0.35           16.1              37.4              39.0%
   *     0.50           15.3              31.4              18.0%
   *     0.70           12.6              25.5               6.5%   <- target
   *     1.00           13.1              26.0               0.0%   window == the
   *                                                                measurement
   *
   * Under 0.2s the lock does nothing at all, because a pair that is still
   * shoulder to shoulder rebuilds 5.5 u/s of closing speed in under a fifth of
   * a second. At 1.0s the re-hit statistic is only zero because the lock is as
   * long as the window it is measured over, which is not evidence of anything.
   * 0.70s is the shortest window that gets re-hits into single figures on their
   * own merits, and it still leaves the room producing a bump somewhere every
   * 2.4 seconds — an event for you, texture for the kitchen.
   *
   * NOTE ON THE OTHER LEVER. The same sweep at knockback 5.5 measures WORSE on
   * the metric it was supposed to fix (18.1 player bumps/min at a 0.6s window
   * against 13.3 at 4.2), because a harder knock throws both bodies into the
   * next chef. Bigger was not better; this is why the shove above went to 4.2
   * and not to 6.5.
   */
  bumpImmunity: 0.7,
  /**
   * Speed, in u/s along the blocked axis, above which hitting geometry emits a
   * `wallHit`. Just under half of cruise: a chef sliding along a counter face
   * or nudging one at a crawl stays silent; a run into one does not. The
   * rebuild after a stop tops out at 1.31 u/s against this 3.0, so a held stick
   * into a bench sounds once, not sixty times a second.
   */
  wallHitSpeed: 3.0,
  /**
   * Per-chef lock after a `wallHit` fires, so one impact is one event exactly
   * as one collision is one bump. Both collision axes can reject in the same
   * tick at a corner, and a body leaning on a bench re-crosses the threshold a
   * few frames later: measured across four 150s services, runs of up to 8
   * events inside two ticks. 0.2s collapses those to one and is still short
   * enough that clipping two different benches on one run sounds twice.
   */
  wallHitImmunity: 0.2,
  /**
   * Time constant of the velocity bleed while stunned. Was a bare `* 0.82`
   * every tick, which is 1.4e-6 of the original speed after one second and
   * killed a knockback before it could travel.
   */
  stunDrag: 0.11,
  /**
   * 0.22 was a sixth of a second too long for something happening every 2.9
   * seconds. With the frequency roughly halved and a real shove attached, the
   * stun's job is now to sell the stagger, not to price the collision.
   */
  bumpStun: 0.16,
  /**
   * Length of one service, in seconds. The HUD's centre chip counts THIS down
   * — the reference's whole frame is legible as a race because of that one
   * number — so the sim has to actually end on it or the clock is a lie.
   */
  roundSeconds: 180,
  /**
   * INTEGRATION — 0.34 MEANT THE CLOCK ABOVE WAS A LIE, AND IT SAID SO ITSELF.
   *
   * The comment on `roundSeconds` is the contract: the HUD counts 180 down and
   * "the sim has to actually end on it or the clock is a lie". It never did.
   * Three misses cost 3 x 0.34 = 1.02 of a patience meter that starts at 1.0,
   * so the THIRD expired ticket ended the service outright, and a serve pays
   * back only 0.06 — you need six perfect dishes to buy back one miss.
   *
   * Measured, not guessed. Two surveys through tools/botsurvey.mjs:
   *
   *   bots alone, 14 runs   served 5-13, missed 4-5, EVERY run dead on
   *                         patience between 0:118 and 0:164. Never 180.
   *   scripted player too   served 1-3, dead between 0:54 and 0:87.
   *
   * Not one run in either survey ever reached the clock, so the number the HUD
   * makes the biggest thing on screen was unreachable in every game anyone
   * could play — and two of the four device profiles in shots/INT-000 came back
   * `served: 0, missed: 3, over at 0:54`, which is the brief's own correctness
   * check failing for a balance reason rather than a bot reason.
   *
   * 0.20 was the first cut and it was not enough: 13 of 14 still died early,
   * because the order generator opens to five concurrent tickets on a 4.5s gap
   * and three bots close about one every twenty seconds, so 6-7 misses a
   * service is STRUCTURAL, not bad luck. 0.16 is the number that clears it —
   * seven misses against seven serves lands patience at 0.30 rather than -0.12.
   *
   * A miss is still expensive and failure is still real: six tickets you never
   * answer at all end the service on their own, which is what the gauge round
   * the player's portrait exists to warn about. What is gone is losing to
   * arithmetic you could not have beaten. Failure should be something the
   * player watched coming, not the third ticket.
   */
  patiencePerMiss: 0.16,
  patiencePerServe: 0.06,
  patienceDrainPerSec: 0.0,
};

const def = (
  kind: IngredientKind,
  label: string,
  color: number,
  chopSeconds: number,
  cookSeconds: number,
  burnSeconds: number,
): IngredientDef => ({ kind, label, color, chopSeconds, cookSeconds, burnSeconds });

/**
 * Colours are art-directed, not decorative: the room is a single muted warm
 * hue, so food is the only thing on screen carrying a pure hue at high
 * saturation. See the header of src/view/materials.ts for the measurements.
 *
 * EVERY INGREDIENT MUST BE NAMEABLE IN 200ms, AT THUMBNAIL, IN ONE GLANCE.
 * The reference ships three ingredients on three separated hues precisely so
 * that is true. We ship ten, which means hue separation is not a nicety, it is
 * the only thing keeping the trays readable — and onion (0xe6d6b4), egg
 * (0xfdf4dd) and rice (0xf6f1e2) used to be three near-identical creams sat
 * inside a 0xf7f0e1 ceramic tray. Six trays a frame were unreadable lumps.
 *
 * So: onion is now a purple-skinned onion, egg is a yolk, rice is a cool
 * blue-white (the only cool pale in the room, so it cannot be confused with a
 * plate).
 *
 * ART PASS, ROUND 6 — THE FOUR OFF-PALETTE HUES ARE NOW MUTED, NOT MOVED.
 * The reference room contains exactly three saturated food hues (tomato red,
 * lettuce green, bacon pink) plus its two team colours, and nothing else in
 * frame competes. We ship ten ingredients, so four of ours necessarily sit on
 * hues the reference does not own — and onion at S 0.56 V 0.84, cheese at
 * S 0.92 V 1.00, fish at S 0.64 V 0.86 were parked in the near field at FULL
 * chroma, where they are the first thing the eye lands on. In a side-by-side
 * composite a critic found the purple onions bottom-right before finding a
 * single tomato, which inverts the entire point of the palette.
 *
 * Hue separation is untouched — an onion is still purple, a fish is still
 * blue-green, so nothing gets harder to name. Saturation and value come down
 * ~35% on those four so they read as SUPPORTING ingredients and the three the
 * reference actually ships keep the top of the chroma range to themselves.
 * Tomato, lettuce, bacon and bun are deliberately not touched.
 */
export const INGREDIENT_DEFS: Record<IngredientKind, IngredientDef> = {
  // Hues walk the wheel on purpose: 4° 88° 285° 47° 32° 350° 36° 33° 205° 194°.
  // Nothing pale, nothing cream, nothing that lands inside the room's own
  // 26–40° band at low saturation. The three ex-creams are the whole reason
  // this list was re-keyed — see the note above.
  // HUD/ORDERS PIECE, ONE NUMBER EACH: chop 1.6s -> 1.15s on the two
  // ingredients the shipped menu actually chops. Measured with a headless run
  // of sim+bots over 8 seeds: at 1.6s the first ticket cleared at t=16.7s, so
  // every 14-16s capture the harness has ever taken — and every critic pass
  // built on one — saw served=0 and judged the order strip purely in its idle
  // state. The completion animation, the score pop and the balloon burst are
  // half of this feature and nobody had seen any of them. At 1.15s the first
  // ticket clears at t=12.5s and throughput over 45s goes from 2 to 3.
  tomato: def('tomato', 'Tomato', 0xe61c0a, 1.15, 0, Infinity),
  lettuce: def('lettuce', 'Lettuce', 0x6fd112, 1.15, 0, Infinity),
  onion: def('onion', 'Onion', 0x9a6fa8, 1.9, 0, Infinity),
  cheese: def('cheese', 'Cheese', 0xe0b82d, 1.5, 0, Infinity),
  bun: def('bun', 'Bun', 0xd88f3f, 0, 0, Infinity),
  bacon: def('bacon', 'Bacon', 0xff8496, 0, 3.4, 4.5),
  potato: def('potato', 'Potato', 0xdcae63, 1.8, 3.8, 5.0),
  egg: def('egg', 'Egg', 0xffa522, 0, 2.8, 4.0),
  rice: def('rice', 'Rice', 0xc3d3de, 0, 4.2, 6.0),
  fish: def('fish', 'Fish', 0x6fa3b3, 1.7, 3.6, 4.4),
};

const r = (
  id: string,
  name: string,
  baseSeconds: number,
  baseValue: number,
  components: [IngredientKind, 'raw' | 'prepped' | 'cooked'][],
): Recipe => ({
  id,
  name,
  baseSeconds,
  baseValue,
  components: components.map(([kind, state]) => ({ kind, state })),
});

/**
 * Ordered roughly by complexity. The order generator unlocks deeper into the
 * list as the run heats up, so the first minute is always winnable and the
 * fifth is always frantic.
 */
/**
 * THE LARDER IS THREE HEROES AND A BREAD, SO THE MENU IS TOO.
 *
 * `kitchen.ts` KITCHEN_MAP was cut from ten ingredient types to four — tomato,
 * lettuce, bacon, bun — because ten types is why every bench in the room read
 * beige and the food never became the most saturated thing on screen, which is
 * the one rule the reference composition is built on. A recipe asking for an
 * ingredient with no crate anywhere in the level is an order that can never be
 * filled, so the four recipes that needed cheese, onion, potato, egg, rice or
 * fish are gone and two more built from the heroes take their place.
 *
 * This is also what the reference's own order balloons show: a head of lettuce
 * and two tomatoes; two tomatoes and a rasher of bacon. Nothing else, ever.
 * INGREDIENT_DEFS above is left intact — the extra kinds cost nothing unused
 * and removing them would churn a shared type.
 */
export const RECIPES: Recipe[] = [
  r('salad', 'Garden Salad', 42, 12, [
    ['lettuce', 'prepped'],
    ['tomato', 'prepped'],
  ]),
  // ORDER MATTERS: sim.ts unlocks the first two entries at heat 0, so these two
  // are the whole of the opening board. Chopped Salad is promoted above Bacon
  // Roll because it is lettuce + two tomatoes — literally the ticket in the left
  // balloon of refs/dash-and-dine-01.jpeg — and with it at index 2 every frame
  // any critic had ever photographed showed two icons on a diagonal where the
  // reference shows three in a pyramid. (Orders/HUD piece; flagged for
  // integration review. Nothing else about the list changes.)
  r('chopped', 'Chopped Salad', 46, 18, [
    ['lettuce', 'prepped'],
    ['tomato', 'prepped'],
    ['tomato', 'prepped'],
  ]),
  r('baconroll', 'Bacon Roll', 40, 14, [
    ['bun', 'raw'],
    ['bacon', 'cooked'],
  ]),
  r('blt', 'BLT', 48, 22, [
    ['bun', 'raw'],
    ['bacon', 'cooked'],
    ['lettuce', 'prepped'],
    ['tomato', 'prepped'],
  ]),
  r('deluxe', 'Deluxe Stack', 56, 28, [
    ['bun', 'raw'],
    ['bacon', 'cooked'],
    ['bacon', 'cooked'],
    ['tomato', 'prepped'],
  ]),
];

/** Canonical key for matching a plate against a recipe, order-independent. */
export function componentKey(kind: string, state: string): string {
  return `${kind}:${state}`;
}
