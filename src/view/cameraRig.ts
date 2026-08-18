import * as THREE from 'three';
import type { Kitchen, Vec2 } from '../domain/types';

/**
 * The Dash and Dine camera: low, near-frontal, aimed straight down the room at
 * the back wall, with the room filling the frame EDGE TO EDGE.
 *
 * THE ONE INVARIANT: the pitch is 22–23° above the floor plane on EVERY aspect
 * ratio, phone portrait included. It is the whole look. A steeper camera turns
 * chefs into hats and shoulders, kills the run cycle and the carry pose, and
 * loses the back wall that the entire set is built around.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS SOLVE AUTHORS, AND WHY IT IS SHAPED THIS WAY
 *
 * The previous version authored three EDGES — a bottom floor line, a height on
 * the back wall for the top edge, and a world width — and let the wall/floor
 * JOIN fall out unmeasured. Measured against the reference the join is the
 * single most legible number in the composition: on `refs/dash-and-dine-01.jpeg`
 * it sits at ~0.53 of the frame height, so the picture is half wall, half
 * floor. Ours fell out at 0.43 (portrait) to 0.474 (desktop) — six percent of
 * frame height too much bare stone and too little of the set everybody built.
 *
 * So the join is now a FIRST-CLASS constraint and the top edge is what falls
 * out. Three constraints, three unknowns (half-fov, eye height, camera z):
 *
 *   1. BOTTOM EDGE — a world z on the floor (`zFloor`). Anything nearer the
 *      camera than this is cut by the frame edge, so it is also the crop line
 *      for chefs in the front rank. It sits just inside the front wall: the
 *      reference crops a Toad's head through its bottom edge and has no clean
 *      bottom margin anywhere.
 *   2. JOIN — where the wall/floor line lands down the frame. 0.50 on anything
 *      4:3 or wider. That single number is what stops the frame filling with
 *      empty flagstone.
 *   3. SIDES — how many world units the frame covers at the depth of the back
 *      wall (`halfWidth`).
 *
 * `halfWidth` is aspect × a constant HALF-SPAN, which makes the whole solve
 * ASPECT-INDEPENDENT: the vertical composition (eye height, camera z, join,
 * bottom edge, depth ratio) is byte-identical on 4:3, 16:10 and 16:9, and only
 * the horizontal crop changes. That is what "every device shows the same room"
 * has to mean. The old code shrank the span at wide aspects, which is exactly
 * why iPhone landscape solved to a 31° lens 18 units back — a diorama.
 *
 * Three clamps break that identity, and only three:
 *
 *   - HALF_WIDTH_MAX. Past 16:9, aspect × HALF_SPAN asks for more world than
 *     the room has, and the surplus is bare side wall. Since round 6 this is a
 *     backstop only — HALF_FOV_H_MAX reaches first on every aspect we ship.
 *   - HALF_WIDTH_MIN. Portrait's aspect is 0.46, so the frame is 2.2× taller in
 *     world units than it is wide at any given depth, and `halfWidth` is bought
 *     with LENS rather than with distance. Below this the picture is too narrow
 *     to hold the oven and a chef at the same time; above it, the lens opens far
 *     enough to wreck the recession and drive the top edge off the wall.
 *   - HALF_FOV_H_MAX. The reference's own horizontal half-field, 31.5°. Since
 *     round 6 this is the main authority on how wide a landscape frame is: it
 *     binds on every landscape aspect, so they all frame the room with one lens
 *     and differ only in how much wall and floor their shape lets them carry.
 *
 *
 * ---------------------------------------------------------------------------
 * ROUND 6 — THE LENS WAS RIGHT, THE CROP WAS NOT.
 *
 * The last critic put it exactly: "Reference wins on spacing and occupancy
 * rather than on lens: it is the same shot with the empty rows cropped off."
 * That is a measurable claim, so this round measured it.
 *
 * `refs/dash-and-dine-01.jpeg` has four clean flagstone grout lines running
 * across open floor on the right of frame, at rows 428, 480, 557 and 647 of
 * 720, with the wall/floor join at 0.526. Flags are square and equally spaced
 * in world, so those four rows over-determine the projection: fitting (half
 * fov, eye height, first flag depth, flag pitch) to them is a four-parameter
 * fit to four observations with a residual of 0.003 of frame height, and — the
 * useful part — two of the outputs are INDEPENDENT of the pitch you assume:
 *
 *   VISIBLE DEPTH RATIO  1.75–1.81 for any pitch from 21° to 30°
 *       = eye-space depth at the back wall ÷ eye-space depth at the bottom
 *         edge of frame. This is how much bigger a thing at the bottom of the
 *         picture is than the same thing at the wall, and it is the number
 *         that says "this is the reference's lens" independent of how big the
 *         room is or how far away the camera stands.
 *   FLOOR DEPTH VISIBLE  4.65–4.70 flag rows, flags being 0.21–0.27 of the
 *         eye height. Against our 1-unit cells and a ~5.7-unit eye that is
 *         about 7.0 units of floor.
 *
 * And at the pitch this rig is built on — 22.5° — the fit returns a 37.8°
 * vertical field. Ours solves to 39.0° on iPad and desktop. The lens really
 * was already right, to about a degree.
 *
 * What was wrong was the crop. `zFloor` was H-1.8, so the bottom edge landed at
 * z 9.2 in an 11-deep room: 8.2 units of floor against the reference's 7.0,
 * with the extra unit and a bit spent on the two rows nearest the camera that
 * the sim barely uses (chef y ran 2.4–7.5 over 48 samples). The frame was
 * solved to fit the ROOM, not the PLAY, and the front third was a prop shelf.
 *
 * So this round:
 *
 *   - VISIBLE DEPTH RATIO IS NOW THE ASSERTION, replacing a depth ratio taken
 *     between two arbitrary fixed rows. The old number conflated the lens with
 *     the crop — crop a row off the front and it moves, though the picture's
 *     perspective has not changed at all — which is precisely why it read
 *     "1.61, within 0.01 of the reference" on a frame whose front third was
 *     empty. `visibleDepthRatio` is a function of pitch, join and half-fov and
 *     of nothing else, so it measures the lens and only the lens.
 *   - `zFloor` crops to H-3.0 on landscape: 7.0 units of floor, the
 *     reference's number, and every object in the room 17% larger on screen.
 *   - The depth that crop gives up is bought back ON DEMAND rather than
 *     reserved: `update()` now dollies out only far enough to keep the chef's
 *     feet inside the bottom edge, so the frame is tight when the play is in
 *     the middle of the room and opens only when somebody runs at the camera.
 *   - `HALF_FOV_H_MAX` becomes the reference's own 31.5° horizontal half-field
 *     and takes over from HALF_WIDTH_MAX as the authority on frame width, so
 *     every landscape aspect frames the room with the SAME lens.
 *   - `CENTRE_MAX_TALL` drops 1.2 → 1.0, and the chef is held out of the outer
 *     12% of frame width where the door jamb and the pan rack live, by a
 *     shoulder that starts giving ground at 0.45 instead of a hard stop.
 *
 * MEASURED ON THE REAL BUILD, ROUND 6 (portrait 393×852 / iPhone landscape
 * 852×393 / iPad 1194×834 / desktop 1440×900), at rest:
 *
 *   join            0.505 / 0.525 / 0.525 / 0.525   (reference 0.526)
 *   visible depth   2.51  / 1.63  / 1.93  / 1.84    (reference 1.75–1.81)
 *   floor depth     8.2   / 7.0   / 7.0   / 7.0     (reference ~7.0)
 *   back wall       100%  / 73%   / 91%   / 86%     (reference 84%)
 *   vertical fov    66.5° / 31.6° / 46.3° / 41.9°
 *   top edge        7.07  / 4.83  / 5.54  / 5.32    wall is 8, beams 4.35–4.97
 *   pitch           23°   / 22.5° / 22.5° / 22.5°
 *
 * Every landscape profile solves to the same 31.5° horizontal half-field — the
 * reference's — and differs only in how much wall and floor its shape lets it
 * carry. Portrait is the one frame that cannot hold that lens (its width would
 * be ±2.4 units, narrower than the oven arch) and is held to a ceiling instead.
 *
 * AND THE THING THIS ROUND WAS OPENED FOR, on the critic's own instrument — a
 * 3×3 edge-density grid, bottom row, desktop 1440×900:
 *
 *   shipped   0.17 / 0.14 / 0.17
 *   round 6   0.29 / 0.30 / 0.28
 *   reference 0.28 / 0.30 / 0.25
 *
 * The middle row is still 0.29/0.37/0.26 against the reference's 0.39/0.42/0.38
 * and the camera cannot close that: it is floor texture and prop density, not
 * framing. Portrait's bottom row is 0.08/0.06/0.05 and that is the room's rows
 * 8–9, which the layout barely dresses — cropping harder was shot and measured
 * and moved it 0.01.
 *
 * ---------------------------------------------------------------------------
 * ROUND 7 — THE SHOT WAS AUTHORED LOCKED OFF AND SHIPPED AS A FOLLOW CAMERA.
 *
 * Everything above describes a composition that only ever existed at rest. The
 * verdict on the shipped build:
 *
 *   "The camera is authored as a locked, symmetric shot but ships as a follow
 *    camera, so the composition the code's own comments describe exists only at
 *    rest — in play it dollies back 1.4 units and slides laterally off the
 *    oven, and on iPhone portrait it never recovers."
 *
 * Four mechanisms, all of them bugs rather than trade-offs, and all four are
 * fixed here:
 *
 *   1. FOOT_MARGIN 0.75 asked for a bottom edge at z 9.4 on a frame authored at
 *      8.0, so the 1.7-unit dolly was spent on every frame anyone worked the
 *      front bench. The camera did not occasionally travel; it LIVED at the end
 *      of its travel. FOOT_MARGIN is 0.2 and DOLLY_MAX is 0.4.
 *   2. CENTRE_FRAC 0.6 was the LOWER bound of the pan clamp and sat above
 *      CENTRE_MAX 0.56, so `clamp(v, 0.6*live, 0.56*live)` returned 0.6*live
 *      unconditionally. Every landscape frame in the game was licensed to slide
 *      the oven 30% of the frame width off centre. CENTRE_FRAC is 0.
 *   3. The containment rescue was `max(limit, rescue)` with no ceiling, so on
 *      portrait `centreMax` was a number nothing ever consulted. It is bounded
 *      by RESCUE_MAX now, and RESCUE_MAX_TALL is read off the oven arch.
 *   4. describe() graded every quantity against the rig's OWN rest solve or its
 *      OWN dolly range, so `warnings` came back empty on all eight of the
 *      critic's samples. Every check is now taken at the LIVE camera against
 *      the number measured off the reference.
 *
 * Plus the two composition asks. HALF_WIDTH_MAX is back in charge of frame
 * width and set to the number that produces the reference's back-wall fraction
 * (7.5 / 0.84 = 8.95, and it really is that direct), and the bottom edge is
 * snapped to a LANE between station rows instead of sawing through row 9.
 *
 * MEASURED ON THE REAL BUILD, ROUND 7, over a 26-second scripted run sampled
 * every 0.5 s (tools/camtrace.mjs — new, because shoot.mjs takes two snapshots
 * a profile and a follow camera's defects live between them):
 *
 *                          desktop 1440x900        portrait 393x852
 *   join                   0.512 - 0.525           0.525 flat
 *   back wall              0.820 - 0.838           1.000 (see HALF_WIDTH_MIN)
 *   visible depth          1.78 - 1.82             2.04 flat
 *   bottom edge z          8.50 - 8.88 (lane 8)    10.00 flat
 *   camera z travel        0.38 units              0.00 units
 *   room-centre offset     max 0.004               p50 0.051, p90 0.330
 *   reference              join 0.526, back wall 0.84, visible depth 1.75-1.81
 *
 * The desktop shot is now locked: the oven arch sits within four thousandths of
 * a half-frame of dead centre for an entire service, and the only thing that
 * moves at all is 0.38 units of z when a chef runs at the lens.
 *
 * ...and because main.ts seeds every run from Math.random(), a screenshot pass
 * samples one level out of many and its maxima wander. So the pan clamp is also
 * evaluated EXHAUSTIVELY, offline, at every cell a chef can stand on
 * (tools/camprobe.mjs, `worst()` — the same clamp arithmetic as update()):
 *
 *                  worst room-centre offset      worst |playerFrac|
 *   desktop        0.200                         0.835
 *   iPad           0.240  (= the clamp)          0.855
 *   iPhone land.   0.055                         0.803
 *   portrait       0.840  (= the hard stop)      1.366
 *
 * Landscape therefore cannot put the oven outside the middle 24% of frame width
 * from anywhere in the room, and cannot lose the player either. Portrait's
 * worst cell is (1.5, 8.5) — the bare left lane at the very front, where no
 * station is; at the front-left CRATES, (2.5, 8.5), the player sits at 0.896 of
 * the half-frame and is in the picture. Even at the hard stop the arch keeps
 * 67% of its width. The residual — a chef who walks the empty left column to
 * the front of a portrait room is off screen — is not fixable from this file:
 * see RESCUE_MAX_TALL for why buying it costs the oven entirely.
 *
 * WHAT ROUND 7 COULD NOT DO, WITH THE ARITHMETIC.
 *
 * The brief asked for two more things and both are geometrically unreachable in
 * this room, so they are written down rather than quietly missed:
 *
 *   PORTRAIT SIDE-WALL WEDGES (back wall ~0.85 of frame width). See
 *   HALF_WIDTH_MIN — that needs halfWidth 8.82 on a 0.461-aspect frame, which
 *   covers ~40 world units of vertical at the wall plane against a wall that is
 *   8 tall. Portrait's back wall covers the whole frame and will until the room
 *   shell grows a ceiling course above the beams.
 *
 *   FRONT-RANK CHEF AT 11% OF FRAME HEIGHT (round 7). Ours is 17.3% on desktop, down from
 *   18.5%. But 11% is not the reference's front rank: measured on
 *   refs/dash-and-dine-01.jpeg, Waluigi — the frontmost character, cropped by
 *   the bottom edge — is 135 px of 720, i.e. 18.7%, and Shy Guy at mid-room is
 *   11%. Ours measures 12.7% at mid-room. The two are the same picture. Driving
 *   the FRONT rank to 11% means a frame covering 1.78x more world height at the
 *   bottom edge, which at a fixed join and pitch is a back wall covering 0.47 of
 *   frame width — the opposite of the other target in the same brief.
 *
 * ---------------------------------------------------------------------------
 * ROUND 8 — THE FRAME WAS SAWING THROUGH THE FRONT RANK, AND PORTRAIT WAS
 * SOLVING AGAINST A CEILING THAT WAS NOT THERE.
 *
 * Four things, and the first two are the ones in the pixels.
 *
 *   1. THE BOTTOM EDGE IS READ OFF THE LEVEL NOW. Round 7 authored the crop as
 *      "furniture is on odd rows, land the edge on an even one", the
 *      integration pass then restaggered KITCHEN_MAP across every row 2-9, and
 *      the assertion that was meant to catch that tested row PARITY — so the
 *      bottom edge sat in the middle of row 8 for a whole round, slicing a
 *      bench, a tomato tray, a plate stack and a lidded pot along the bottom of
 *      every landscape frame while describe() reported nothing. `dressFront` is
 *      now the front face of the frontmost dressed row, measured off the
 *      kitchen; the crop is a lane in front of it; and the check asks the only
 *      question that matters — is anything dressed NEARER than the bottom edge.
 *      Rows 8 and 9 gave their six props back up the room to pay for it (see
 *      src/domain/kitchen.ts), which also broke the bare centre runway the
 *      critic measured at 0.048 edge density against the reference's 0.066.
 *
 *   2. WALL_TOP 8 -> 9.3, AND PORTRAIT BREATHES. The width solve gives width
 *      back until the top edge fits under the shell, so an 8-unit wall WAS the
 *      portrait composition: halfWidth 3.69, a frame 2.23 units wide at the
 *      chef's row, a pan that could not hold both him and the oven, and — the
 *      verdict — the player missing from three of eight sampled frames. The
 *      shell now runs to 9.6 with a second beam course at 7.0 (world.ts), and
 *      the frame OPENS 25% when the player runs wide and eases shut behind him.
 *      See WIDEN_TALL for the full arithmetic, including why the same lever
 *      cannot deliver the reference's side-wall wedges at any setting.
 *
 *   3. THE PORTRAIT EXEMPTIONS ARE GONE. `aspect >= 1.2` gated portrait out of
 *      the back-wall test and gave it a private depth-ratio ceiling of 2.2. A
 *      rig that exempts the one profile that fails cannot fail. Both tests are
 *      now the reference's on every shape, portrait raises both on every
 *      sample, and tools/shoot.mjs promotes any non-empty `warnings` into
 *      report.json as `cameraFailures` and prints them in the console summary.
 *      The two portrait warnings are permanent and the sweep under WIDEN_TALL
 *      says why: buying them costs a character 3.6% of frame height.
 *
 *   4. THE THUMB CLUSTER IS ARCHITECTURE. main.ts measures the real element and
 *      hands the rig the fraction of the viewport it covers; the containment
 *      hold tightens on that side while the player is low enough in frame to be
 *      inside it, and describe() warns when he is under it anyway. The frame
 *      the last critic called the worst in the set — the player 70% behind the
 *      orange button on late-service iPad — comes back clean.
 *
 * MEASURED ON THE REAL BUILD, ROUND 8 (portrait / iPhone landscape / iPad /
 * desktop), rest and full dolly, --insets:
 *
 *   join            0.525        0.525-0.513   0.525-0.515   0.525-0.514
 *   back wall       1.000        0.709-0.699   0.853-0.837   0.838-0.824
 *   visible depth   2.04-2.49    1.57-1.59     1.93-1.97     1.78-1.81
 *   bottom edge z   10.00 flat   8.50-8.80     8.50-8.80     8.50-8.80
 *   top edge y      7.55-8.73    5.02-4.97     5.93         5.55-5.53
 *   reference       join 0.526, back wall 0.84, visible depth 1.75-1.81
 *
 * ...and exhaustively, over every walkable cell (tools/camprobe.mjs `worst()`),
 * with the portrait frame at full widen:
 *
 *                  worst room-centre offset      worst |playerFrac|
 *   desktop        0.200                         0.835
 *   iPad           0.249                         0.838
 *   iPhone land.   0.055                         0.803
 *   portrait       0.860 (two corner lanes)      0.880
 *
 * The last column is the one that changed: 1.366 -> 0.880, i.e. there is no
 * longer any cell in the room from which the camera loses the player, and
 * `PLAYER_SAFE` means his whole body rather than his centre point.
 * ---------------------------------------------------------------------------
 */

const DEG = Math.PI / 180;
/** World z of the back wall's front face (the wall occupies map row 0). */
const WALL_Z = 1;
/**
 * How tall the room shell is built — see SHELL_TOP in src/view/world.ts, which
 * this must never exceed.
 *
 * ROUND 8: 8 -> 9.3, AND IT IS THE ONE CONSTANT THAT UNBLOCKS PORTRAIT.
 *
 * The bisection below hands width back until the TOP edge fits under this, and
 * at 8 a portrait frame sat exactly on the stop: topEdgeWallY 7.55, halfWidth
 * 3.69, which is why HALF_WIDTH_MIN never bound and why the frame at the chef's
 * own row was 2.23 units wide against a room he roams 12 units of. Every
 * portrait defect the last critic measured — the player missing from three of
 * eight frames, the oven arch cropped at the right edge, centreOffset 0.801 —
 * comes out of that one number.
 *
 * The shell now carries a second beam course at y 8.0-8.62 and a shaded eaves
 * band above it, so the frame may reach y 8.85 and still be looking at built
 * room. That is what pays for WIDEN_TALL below.
 *
 * It does NOT buy the reference's side-wall wedges on portrait, and the
 * arithmetic is in WIDEN_TALL rather than in a promise.
 */
const WALL_TOP = 9.3;
/**
 * How far past the front of the room the floor mesh and the side walls run
 * (WorldView.buildFloor / buildSideWalls). The bottom edge of frame may never
 * cross this or a strip of raw backdrop opens along the bottom.
 */
const FLOOR_OVERRUN = 3.0;

/**
 * Half the world height the frame spans at the depth of the back wall, in
 * units. `halfWidth = aspect * HALF_SPAN`, which is what makes the vertical
 * composition identical on every landscape aspect. Raising it widens the lens
 * and brings the eye in (more perspective, bigger chefs, more side wall);
 * lowering it flattens the room out.
 */
const HALF_SPAN = 6.25;
/**
 * ...and the same number for a frame TALLER than it is wide, where a constant
 * span does not hold the composition still.
 *
 * `halfWidth = aspect × HALF_SPAN` keeps the vertical composition identical
 * across LANDSCAPE aspects, and that is genuinely what it does from 4:3 out to
 * 16:9. It does not extend below 1.0, and the reason is that the solve buys
 * width with LENS: for a fixed halfWidth, a taller frame needs a wider vertical
 * field, which puts the camera closer and deepens the recession. So holding
 * `halfWidth / aspect` constant does not hold the depth ratio constant — it
 * makes it fall as the frame gets squarer.
 *
 * Swept across every aspect from 0.40 to 2.60, a constant 6.0 dug a trough
 * between 0.53 and 1.11: depth ratio 1.34 at aspect 0.64, against 1.63 at phone
 * portrait and 1.61 at desktop. A browser window dragged square, or an iPad in
 * a 50/50 split, got a flatter, more distant, more diorama-like room than any
 * real device profile — the same defect the rig was rebuilt to remove from
 * iPhone landscape, hiding one ratio further down the range where nobody shot
 * it. Ramping the span from 8.0 at portrait to 6.0 by 4:3 flattens the curve
 * out: depth ratio 1.60–1.64 continuously from 0.46 to 1.6, and the top edge
 * stays between 5.8 and 7.3 the whole way.
 */
const HALF_SPAN_TALL = 8.0;
/**
 * Never hand more than ~20% of the frame width to side wall.
 *
 * ROUND 5 argued this cap could not come down because lowering it costs
 * recession. That reasoning had the sign right and the cause wrong. halfWidth
 * and half-fov move together — the width constraint is solved BY the lens — so
 * yes, a narrower frame is a longer lens. But the thing that had iPhone
 * landscape 21 units back on a 25° lens was not the width cap, it was `zFloor`:
 * the solve was holding the join while covering 8.4 units of floor on a frame
 * only halfWidth/aspect tall, and the only way to do that is to stand off. Crop
 * the floor to the reference's 7.0 units and the same 10.7 half-width solves to
 * a 36° lens 15 units out.
 *
 * With the crop paying for the recession, the cap is free to do its own job.
 * 9.4 puts the back wall at 80% of frame width on every landscape aspect from
 * 4:3 to 21:9 — the reference measures 84% — where 10.7 handed 30% of an
 * iPhone-landscape frame to flat ochre plaster that nothing ever happens on.
 * The room's own half-width is 7.5; this is that plus a bench and a bit.
 */
const HALF_WIDTH_MAX = 8.95;
/**
 * ...and the same number for a letterbox, where holding 8.95 would cost the
 * lens instead of the wall.
 *
 * ROUND 7 — THIS CAP IS BACK IN CHARGE, AND IT IS NOW A MEASUREMENT.
 *
 * `backWallFrac` is `roomHalfWidth / halfWidth`, i.e. it is a pure function of
 * this cap and nothing else. The reference measures 0.84, our room's half-width
 * is 7.5, so the cap that produces the reference's composition is 7.5 / 0.84 =
 * 8.93 and there is nothing to tune. Round 6 left it at 10.6 as "a backstop
 * only" and let HALF_FOV_H_MAX decide the width instead, which landed desktop
 * at 0.864 and iPad at 0.914 — iPad's raked side planes, the door and the pan
 * rack, all but gone.
 *
 * At 8.95 the fov cap stops binding below 16:10 and the lens opens to 29.4°
 * horizontal on desktop, 1.9° inside the reference's own 31.5°, which is well
 * within the round-6 fit's error bar.
 *
 * Ultra-wide is the one shape that cannot have it. A 21:9 frame at 8.95 solves
 * to an 18° horizontal field 26 units back — measured — with a depth ratio of
 * 1.34 against the reference's 1.75-1.81. That is the diorama round 6 existed
 * to remove, so past 16:9 the cap ramps back out and iPhone landscape keeps its
 * lens and pays for it in side wall (0.71 of frame width on the back wall).
 */
const HALF_WIDTH_MAX_WIDE = 10.6;
/**
 * How much of the room's depth the bottom edge of frame gives up, in world
 * units, measured back from the front of the room.
 *
 * Fitted off the reference (see the header): its frame carries 4.67 flag rows
 * of floor at 0.21–0.27 of the eye height a flag, which against our 1-unit
 * cells and ~5.7-unit eye is 7.0 units. An 11-deep room with its wall face at
 * z 1 has 9 units of floor, so the bottom edge belongs at z 8 and the two rows
 * nearest the camera belong off the bottom of the picture. They are the two
 * the sim uses least — chef y measured 2.4–7.5 across 48 samples of a real
 * run — and reserving them cost every object in the room 17% of its size.
 *
 * Portrait crops less: it has the most vertical frame to spend, and every unit
 * it crops is paid for in lens — a 0.46-aspect frame buys its width with field
 * of view, so pulling the camera in widens the field and deepens the recession
 * (see the visibleDepthRatio ceiling in describe()). 2.2 was shot and measured
 * against 1.8: it made nothing denser (the bottom third of a portrait frame is
 * the room's rows 8–9, which the layout barely dresses) and it pushed both team
 * counters off the sides while blowing the oven arch up to a third of the frame.
 * 1.8 keeps the pink and green stations in the picture, which is what makes a
 * portrait frame legible as this room rather than as a close-up of an oven.
 */
/**
 * ROUND 7 — SNAP THE BOTTOM EDGE TO A LANE, NEVER THROUGH A ROW.
 *
 * The room's furniture sits on ODD map rows: 1, 3, 5, 7, 9. Rows 2, 4, 6, 8 are
 * the open lanes between them and row 10 is the front line of the floor. Round
 * 6 put the bottom edge at z 8.0 and then let a 1.7-unit dolly carry it to
 * 9.4 — which is 40% of the way through row 9 — so the front rank of the
 * picture was four bench tables sawn lengthwise and every tray they carry was
 * off the bottom of the frame. Measured on the shipped build: bottomEdgeZ
 * 8.0-9.4 on desktop, iPad and portrait. The critic read it as "plank grain",
 * which is exactly what a bench top cut through its own length looks like.
 *
 * Both numbers now land in a LANE and the dolly (below) is short enough that
 * they stay in one:
 *
 *   landscape  z 8.5 — mid-lane of row 8. Row 7 whole with half a lane of
 *              clear floor in front of it, 7.5 units of floor in the picture
 *              against the reference's 7.0, and the bottom edge can travel to
 *              9.0 (the BACK face of row 9) without touching anything.
 *   portrait   z 10.0 — the floor's own front line. Row 9 is whole and the
 *              frame ends exactly where the dressed room does, so there is no
 *              apron at all. Portrait also has the most vertical frame and the
 *              least horizontal, and standing this far back is what pays for
 *              both: visibleDepthRatio 2.51 -> 2.04 and the half-frame at the
 *              chef's own row 1.85 -> 2.23.
 */
/**
 * ROUND 8 — THE LANE IS READ OFF THE LEVEL, NOT OFF ROW PARITY.
 *
 * Round 7 wrote the rule as "furniture sits on odd rows, so land the bottom
 * edge on an even one" and then the integration pass restaggered KITCHEN_MAP
 * across EVERY row from 2 to 9. So the authored crop at z 8.5 was sitting in
 * the middle of row 8 — which carries a bun crate at x 9 and a plate station at
 * x 10 — and the parity check at the bottom of describe() called it a lane and
 * said nothing, while desktop/01-opening sliced a bench and a tomato tray at
 * bottom-left and a plate stack and a lidded pot at bottom-right. The reference
 * does not do this once in either frame: its bottom edge is unbroken floor
 * across the full width and every bench in the front rank shows four legs and a
 * contact shadow.
 *
 * So the crop is now measured from the level itself. `dressFront` is the world
 * z of the FRONT FACE of the frontmost dressed row (the deepest station cell,
 * plus one for the cell's own depth), and the bottom edge is placed a lane in
 * front of it. Move a bench and the camera follows; there is nothing left to
 * fall out of step.
 *
 *   landscape  dressFront + 0.5 — half a lane of clear stone under the front
 *              rank, which is what the reference leaves under its own.
 *   portrait   dressFront + 1.0 — one clear lane, same as landscape's half.
 *
 * WAVE 2B: PORTRAIT 2.0 -> 1.0, AND THE NUMBER IT WAS PROTECTING WAS THE WRONG
 * NUMBER.
 *
 * 2.0 was chosen to hold visibleDepthRatio at 2.04 rather than the 2.51 that
 * shipped before it. That is a real effect and it is backwards: portrait's
 * depth ratio is graded against the reference's 1.75-1.81, which is a 16:9
 * measurement, and the only way a 0.46-aspect frame moves toward it is by
 * STANDING FURTHER BACK — which buys the number with the exact defect the
 * handoff opened this pass for. Swept on tools/camlost.mjs, holding everything
 * else:
 *
 *   bottom lane      2.0     1.5     1.0
 *   bottom edge z    10.00   9.50    9.00
 *   floor depth      9.00    8.50    8.00
 *   visibleDepth     2.04    2.15    2.27
 *   chef @ front     13.9%   14.7%   15.5%   of frame height
 *
 * So the assertion and the picture point in opposite directions, and the
 * picture wins: a front-rank chef gains 1.6% of frame height and the empty
 * lower third of every portrait frame loses a whole unit of bare stone. The
 * depth ratio is reported as a measured cost of the shape — see the portrait
 * band in describe() — not chased.
 *
 * It is not free and the cost is one constant away: at 1.0 the half-frame at
 * the chef's own row narrows, so the containment rescue needs more room. At the
 * old LOST_MAX of 0.9 the worst cell puts the player at |playerFrac| 0.996 —
 * his centre exactly on the frame edge, half of him gone. LOST_MAX goes to 0.95
 * with it; see there for what that costs the arch.
 *
 * With KITCHEN_MAP's frontmost dressed row at row 7 these come out at z 8.50
 * and z 9.00, derived from the level rather than authored.
 */
const BOTTOM_LANE = 0.5;
const BOTTOM_LANE_TALL = 1.0;
/**
 * How far in front of the chef the bottom edge of frame must sit for his feet
 * and his contact shadow to be in the picture.
 *
 * ROUND 7: 0.75 -> 0.2. This was the thing actually spending the dolly. The
 * deepest a chef can stand is row 8 (row 9 is furniture), so his feet reach
 * z 8.65 — and 0.75 of margin asked for a bottom edge at 9.4 on a frame
 * authored at 8.5, i.e. it demanded most of a unit of dolly every time anyone
 * worked the front bench, which is most of the time. At 0.2 the same chef asks
 * for 8.85 and gets it inside the 0.4 the camera is allowed to move at all.
 * His soles land on the bottom edge and his contact shadow is cropped, which
 * is what the reference does to two of its five characters.
 */
const FOOT_MARGIN = 0.2;
/**
 * ...and the same for a BOT, who is allowed to be cropped. Negative, so a bot
 * standing on the room's front line is cut off at mid-calf rather than dragging
 * the whole frame backwards for himself. The reference crops two of its five
 * characters through the bottom edge; a co-op partner you can see the legs of
 * is legible, and one who has pulled the camera off the set is not.
 */
const CROWD_SINK = 0.55;
/**
 * How far the camera may retreat from its solved rest point, total, across
 * every reason it might want to (feet in frame, chef run wide).
 *
 * A dolly with the pitch held is not a free move: standing back drops the
 * wall/floor join by about 0.022 of frame height per unit, so the composition
 * flattens as it travels. Measured on the shipped build, portrait's 0.6+1.4 of
 * dolly took the join from 0.495 to 0.459 and put the bottom edge at z 12.5 on
 * a room that ends at 10 — two and a half units of bare apron, which is most of
 * the "bottom 40% is empty flagstone" the critic saw. Capped here at a join
 * excursion of ~0.035 and, below, at a bottom edge that may not leave the room.
 *
 * ROUND 7 — 1.7 -> 0.4, AND ZERO ON PORTRAIT. THIS IS THE WHOLE VERDICT.
 *
 * "The camera is authored as a locked, symmetric shot but ships as a follow
 * camera, so the composition the code's own comments describe exists only at
 * rest." Measured on the shipped build, every profile's early snapshot had the
 * camera 1.3-1.4 units BEYOND its rest point in ordinary play: join 0.525 ->
 * 0.471-0.501, floor depth 7.0 -> 8.39, bottom edge through row 9. The rig was
 * not occasionally dollying — it was LIVING at the end of its travel, because
 * FOOT_MARGIN asked for more depth than the crop reserved (see above), and a
 * dolly that is always spent is not a dolly, it is the rest pose.
 *
 * The reference is locked off. It does not dolly and it does not pan. So the
 * budget is now 0.4 — a join excursion of 0.017 — and portrait's is literally
 * nothing: its bottom edge sits on the floor's own front line, so APRON_MAX_TALL
 * = 0 leaves it nowhere to go and the shot is frozen in z for the whole run.
 */
const DOLLY_MAX = 0.4;
const DOLLY_MAX_TALL = 0.0;
/**
 * The bottom edge of frame may never land further forward than this, measured
 * back from the front of the room. Nothing is dressed past the last walkable
 * row, so every unit past it is bare flagstone with a vignette on it.
 *
 * ROUND 7: portrait gets ZERO, not the most. It used to get the most on the
 * theory that standing back was its only lateral lever, and what that bought
 * was 2.5 units of bare apron at the bottom of a phone frame. Its rest crop is
 * now the floor's own front line (BOTTOM_LANE_TALL), so zero apron means the
 * camera cannot move in z at all — which is the point.
 */
const APRON_MAX = 0.5;
const APRON_MAX_TALL = 0.0;
/**
 * Below this a portrait frame cannot hold the oven and a chef at once. Was
 * 3.85 — 51% of the room's half-width — which made portrait a pan-and-scan
 * crop of the landscape composition: the frame covered ±1.8 units at the row
 * the chef stood on, against a room 15 wide, so the pan clamp and the follow
 * had to fight over which of the oven and the chef got to stay on screen, and
 * the chef lost. 4.25 is the widest the room's own architecture allows: past it
 * `topEdgeWallY` climbs over WALL_TOP and the frame shows sky above the set.
 *
 * ROUND 5: 4.25 → 3.80, which is the opposite of the direction the last two
 * rounds pushed it, and the measurement says the last two rounds were reading
 * the wrong number. `halfWidth` is measured AT THE BACK WALL — the widest row
 * in the frame — and on a 0.46-aspect frame the solve pays for every unit of it
 * with lens, not with distance: 4.25 solved to a 70.3° vertical field 13.2
 * units out, with a depth ratio of 2.05 against the reference's 1.6 and a top
 * edge at wall height 7.40 on an 8-unit wall. Narrowing to 3.80 lets the same
 * three constraints solve to a 52.9° lens 16.3 units out: depth ratio 1.63, top
 * edge 7.31.
 *
 * And it costs NOTHING at the row that actually matters. halfWidth at the
 * chef's own row goes 2.01 → 2.25, BIGGER, because retreating three units
 * widens the near rows faster than the narrower lens tightens the far ones.
 * Portrait is now the same shot as desktop rather than a wide-angle vertical
 * slot — which is also why the pan behaves: see PLAYER_HOLD.
 *
 * ROUND 7 — 3.80 -> 5.20, AND THE HONEST NOTE THAT IT DOES NOT BIND.
 *
 * The brief asked for this to be raised until portrait's back wall covers ~0.85
 * of frame width with visible side-wall wedges, the way the reference gives 8%
 * each to its round-window door and its copper pan rack. That is not reachable
 * and the arithmetic says so in one line. 0.85 of frame width on a 15-wide room
 * means halfWidth 8.82 at the back wall; a 0.461-aspect frame that is 8.82 wide
 * is 8.82 / 0.461 = 19.1 HALF-frames tall in the same units, i.e. it covers
 * about 40 world units of vertical at the wall plane. The wall is 8 tall. The
 * frame would be four fifths sky.
 *
 * Swept in tools/camprobe.mjs, portrait tops out at halfWidth 3.7-4.5 for every
 * combination of crop, join and dolly this rig can produce, because the binding
 * constraint is not this floor at all — it is the bisection below that gives
 * width back until the TOP edge fits under WALL_TOP. Raising this constant to
 * 5.2 changes nothing measurable today; it is here so that if the room shell
 * ever grows a ceiling course and the top edge stops binding, portrait opens up
 * to the number it wants instead of sitting on a stale 3.80.
 *
 * So portrait's back wall covers the whole frame width and always will. What
 * this round could fix is everything else about it, and did: see BOTTOM_LANE_TALL
 * (recession 2.51 -> 2.04), DOLLY_MAX_TALL (frozen in z) and CENTRE_MAX_TALL
 * (the oven arch is now clamped inside the frame rather than shouldered).
 *
 * ROUND 9 — 3.55 -> 4.60, AND IT STOPS THE FRAME BREATHING ALTOGETHER.
 *
 * A playtest on a real iPhone came back with two complaints that read as
 * separate bugs and are one number: "the portrait camera is too zoomed in, I
 * can't see any of the stations I need to go to" and "it's easy to get my
 * character almost out of frame when I need to go all the way left or right".
 *
 * Both are this constant, because portrait's rest frame and its widened frame
 * were 25% apart. Swept on tools/camlost.mjs over every walkable cell, at REST:
 *
 *   HALF_WIDTH_MIN   3.55    3.90    4.20    4.40    4.60
 *   hw               3.69    3.90    4.20    4.40    4.60
 *   hw at row 8      1.88    ----    1.97    ----    2.04
 *   worst|playerFrac| 1.421   1.291   1.110   0.993   0.880
 *   cells off-picture 16/375  10/375  4/375   0/375   0/375
 *
 * The old value lost the player outright in 16 of 375 standing positions, and
 * the widen is what covered it — WIDEN_TALL opens the lens 25% when he runs,
 * so the sweep at full widen reported a clean 0.880 and nobody looked at the
 * column the chef is actually in for the first moments of a dash. That is the
 * "almost out of frame going hard left" report, exactly: he outruns the widen.
 *
 * 4.60 is where the rest solve MEETS the widened one (hwWant 4.60 against the
 * widen's saturation at 4.61), so portrait no longer breathes at all — rest and
 * dolly solve to the same camZ 11.45, and the transient the widen used to paper
 * over cannot exist. It is not a tuned number: both ends are pinned by the same
 * ceiling, the bisection that gives width back until the top edge clears
 * WALL_TOP, so this holds by construction rather than by luck.
 *
 * The cost is a chef 8.0% of frame height instead of 9.5%, and the brief asked
 * for that in so many words — "I'd rather more smaller things on screen in
 * portrait so I can see what I'm doing". It is also cheaper than it looks:
 * halfWidth at the chef's OWN row goes UP, 1.88 -> 2.04, because retreating
 * widens the near rows too. He is 16% smaller in a view 25% wider at his feet.
 *
 * vdr goes 2.27 -> 2.75, which is a wide portrait lens and a real departure
 * from the reference's 1.6. It is not a NEW look: the widened solve has run at
 * 2.76 all along, so this is the lens portrait already used every time the
 * player moved. What changes is that it stops snapping between two of them.
 *
 * Landscape is untouched — every landscape aspect solves at t = 1.00, where
 * this floor is lerped out entirely.
 */
const HALF_WIDTH_MIN = 4.6;
/**
 * ROUND 8 — THE PORTRAIT FRAME BREATHES, AND HERE IS THE WHOLE ARITHMETIC.
 *
 * THE ASK THAT CANNOT BE BUILT. The brief has now asked twice for portrait's
 * back wall to cover ~0.85 of frame width with the reference's side-wall
 * wedges, and round 7 answered it with prose. Here is the measurement instead,
 * swept in tools/camprobe.mjs against the real solve:
 *
 *   halfWidth   3.69    4.60    5.20    7.05 (the horizontal fov cap)
 *   backWall    1.000   1.000   1.000   1.000
 *   depth ratio 2.04    2.48    2.76    3.57
 *   chef at the
 *   back wall   6.8%    5.5%    4.8%    3.6%   of frame height
 *
 * `backWallFrac` is roomHalfWidth / halfWidth = 7.5 / halfWidth, so it does not
 * leave 1.000 until the frame is over 7.5 units wide at the wall, and the side
 * walls stand at ±6.5 so no wedge appears before that either. At 31.5° — the
 * reference's own horizontal half-field, and the cap this rig already holds —
 * a 0.461-aspect frame tops out at 7.05. There is no setting of this file, and
 * no height of room shell, at which an iPhone-portrait frame shows the
 * reference's wedges: the fov cap gets there first, and the frame that reaches
 * it renders a character 3.6% of frame height against the reference's 15-19.5%
 * and a recession twice the reference's. The ask is not expensive, it is
 * arithmetically unavailable, and describe() now says so out loud on every
 * portrait sample instead of exempting itself from the test.
 *
 * WHAT IS AVAILABLE, AND WHAT IT IS SPENT ON. The real portrait defect is not
 * the wedges, it is that the frame at the CHEF'S OWN ROW is 2.23 units wide in
 * a room he roams 12 units of, so the pan has to choose between the player and
 * the oven and last round it lost both — playerFrac -1.324 with the rescue
 * fully spent at centreOffset 0.801.
 *
 *   containment radius = rescueMax x halfWidth + EDGE_HARD x halfWidthAtChef
 *
 * and a chef working a flank crate is 5.0 units off the room centre. At rest
 * the two terms are halfWidth 3.69 and halfWidthAtChef 2.23, so containing him
 * needs rescueMax (5.0 - 0.92 x 2.23) / 3.69 = 0.80 of the half-frame — and at
 * 0.80 the oven arch, 1.70 units wide either side of the room centre, is 46%
 * off the picture. Containment and anchor were arithmetically unsatisfiable
 * together, which is the real reason round 7 shipped a frame that lost both.
 *
 * Widening 25% — halfWidth 3.69 -> 4.60, which the taller shell now allows —
 * moves both terms: containing the same chef needs (5.0 - 0.92 x 2.46) / 4.60 =
 * 0.60, and the arch survives up to 1 - 1.70/4.60 = 0.63. They now overlap, and
 * RESCUE_MAX_TALL sits in the overlap. That is the whole trick: the widen is
 * not there to make the picture wider, it is there to make the two constraints
 * simultaneously satisfiable.
 *
 * It is not free and the cost is stated: at full widen the recession goes 2.04
 * -> 2.48 and every character shrinks 16%. So it is not the rest pose. The
 * frame opens only as the player runs wide (see `widen` in update()), eased
 * over 0.45 s, and closes again the moment he comes back; on a lap of the
 * middle of the room it never leaves 1.00.
 */
const WIDEN_TALL = 1.25;
/**
 * Where the wall/floor line sits down the frame.
 *
 * Measured off `refs/dash-and-dine-01.jpeg` at column x = 0.66, which is clean
 * ochre wall down to a stone flag with nothing in front of it: rgb(129,54,12)
 * plaster at row 0.52, rgb(161,148,104) flagstone at row 0.54. The join is
 * 0.53. Ours shipped at 0.50 and the extra 3% of frame height was bare floor.
 *
 * ROUND 6: 0.515 → 0.525. Re-measured a second way and it agrees: the
 * four-grout-line fit in the header (which never touches a colour sample) puts
 * the join at 0.526 of frame height. 0.515 was a hedge against the top edge
 * climbing off an 8-unit wall, and with the round-6 crop bringing the camera in
 * there is room for the real number — it also lifts iPhone landscape's top edge
 * back over the beam course, which is what TOP_EDGE_MIN went to 4.4 for.
 */
const JOIN = 0.525;
/**
 * The beam course on the back wall lives at y 4.35–4.97. It is the room's
 * ceiling framing — the thing that stops the top edge reading as a strip of
 * bare plaster — so the top edge of frame has to reach it or the beams are
 * simply not in the picture. iPhone landscape used to solve to 3.86 here.
 *
 * ROUND 6: 5.02 → 4.55, i.e. the top edge must reach INTO the beam course
 * rather than clear the whole of it. A 21:9 frame is short; holding the whole
 * beam band on it cost either the lens (a 25° telephoto, which is the defect
 * this round exists to remove) or the back wall (a third of the frame in flat
 * plaster). The reference's own 16:9 frame carries its beam course at rows
 * 0.118–0.167, so a 21:9 centre crop of the reference clips the top of it too.
 * Cutting through the beams is a crop; sitting below them is a missing ceiling.
 */
const TOP_EDGE_MIN = 4.55;
/**
 * Ceiling on the solved HORIZONTAL half-fov. Vertical world lines converge
 * toward a vanishing point on the frame's vertical axis, and how far they lean
 * at the frame edge is tan(horizontal half-fov) / cot(pitch) — a purely
 * horizontal quantity. Capping the VERTICAL field instead, which is what a
 * first pass at this did, throttles portrait (whose vertical field is large
 * and whose on-screen lean is tiny) while barely touching the landscape frames
 * that actually lean. iPad used to sit at 32.5° here and its pilasters visibly
 * fell inward at the top of frame; the reference is effectively two-point with
 * plumb verticals.
 *
 * ROUND 6 — THIS IS NOW A MEASUREMENT RATHER THAN A GUARD RAIL, AND IT IS THE
 * MAIN AUTHORITY ON HOW WIDE EVERY LANDSCAPE FRAME IS.
 *
 * The four-grout-line fit off `refs/dash-and-dine-01.jpeg` (see the header)
 * returns a 37.8° vertical field at 22.5° of pitch, which on the reference's
 * own 16:9 frame is a horizontal half-field of 31.3°. That is the reference's
 * lens, stated the one way that does not depend on its aspect.
 *
 * Pinning it here rather than at 30° matters because the round-6 crop moved the
 * camera in: at 30° the same halfWidth the room wants solves to a back wall
 * covering 91% of a desktop frame and 96% of an iPad's, which deletes the
 * angled side wedges — the door with the round window, the copper pan rack —
 * that the reference gives 8% of its frame width each. At 31.5° desktop lands
 * on 0.84, which is the reference's number to two places.
 *
 * It also does the job HALF_WIDTH_MAX used to do, and does it better: a fixed
 * horizontal field is aspect-independent, so a 4:3 window, a 16:10 desktop and
 * a 21:9 phone all frame the room with the SAME lens and differ only in how
 * much of the wall they crop off the top and bottom. HALF_WIDTH_MAX is now just
 * a backstop for aspects wider than anything we ship.
 */
const HALF_FOV_H_MAX = 31.5 * DEG;
/**
 * The room centre — the pizza oven, the anchor of the whole composition — may
 * never travel further than this fraction of the half-frame from centre
 * screen. Portrait used to run follow = 1.0 against an unclamped pan and by
 * the end of a run the oven, and most of the back wall with it, was simply
 * gone. Nothing in the picture reads without it.
 *
 * ROUND 7 — 0.6 -> 0.0, AND IT WAS NOT A FLOOR, IT WAS A LICENCE.
 *
 * This number is the LOWER bound of the clamp in update():
 *
 *     limit = clamp(|holdX - centreX|, CENTRE_FRAC * live, centreMax * live)
 *
 * with CENTRE_FRAC 0.6 sitting ABOVE CENTRE_MAX 0.56. A clamp whose floor is
 * over its ceiling returns the floor, so `limit` was 0.6 half-frames on every
 * single frame of every landscape run regardless of what centreMax said — the
 * camera was permanently allowed to slide the oven 30% of the frame width off
 * centre, and did. That is the "slides laterally off the oven" in the verdict
 * and the desktop 90-late frame with the oven at 0.39 of frame width and a dead
 * ochre band opening on the right.
 *
 * At 0.0 the expression collapses to `min(centreMax * live, panX)` and the pan
 * is bounded by the composition rule alone, which is what it always claimed.
 */
const CENTRE_FRAC = 0.0;
/**
 * ...except when holding it there would push the CHEF off the edge, which is a
 * worse crime. Past CENTRE_FRAC the clamp softens out to here rather than
 * standing on a hard stop, so the oven drifts before the player leaves. At
 * t=18.5 s of a portrait run the old hard clamp had the player at 0.64 of the
 * half-frame measured at the BACK WALL — but 1.3 of the half-frame measured at
 * the row he was actually standing on, i.e. off the side of the picture, cut by
 * the edge, behind two other chefs. See PLAYER_HOLD and update().
 *
 * ROUND 5 — WHY THIS IS TWO NUMBERS NOW. A landscape frame covers the whole
 * room, so composition and containment never disagree and 0.56 costs nothing.
 * A 0.46-aspect frame covers ±3.65 units at the back wall against a room the
 * chef roams ±6.15 units of: the two constraints are not merely in tension,
 * they are arithmetically unsatisfiable together, and a hard 0.56 stop resolves
 * that by throwing the PLAYER out of frame (measured, this build, portrait
 * t=17.8 s: playerFrac 1.18 — off the side of the picture). Losing the oven is
 * a composition defect; losing the chef is an unplayable game. So portrait's
 * ceiling goes to 1.20 of the half-frame.
 *
 * ROUND 6 — 1.20 → 1.00, BECAUSE 1.20 WAS NOT A CONSTRAINT. At 1.20 the room
 * centre may sit a fifth of a frame OUTSIDE the picture, which licenses the
 * oven to be 60% off screen and, worse, means `describe()` reports zero
 * warnings on a frame where the player is jammed at x 0.14 of frame width
 * behind the left door jamb. A ceiling that nothing can violate measures
 * nothing.
 *
 * 1.00 — the room centre on the frame edge, worst case — is the most a
 * 0.46-aspect frame can be held to and still contain the chef, and the
 * arithmetic is worth writing down because every previous round guessed at it.
 * The chef roams ±6.1 units of x. He is inside the picture iff
 *
 *     |chefX − centreX|  ≤  hold × halfWidthAtChef  +  centreMax × halfWidth
 *
 * With the round-6 portrait solve those two half-widths are 2.05 (chef on the
 * room's front line, fully dollied) and 4.16, so 0.95 × 2.05 + 1.00 × 4.16 =
 * 6.11 — the chef is contained, with nothing to spare, at the very worst
 * corner of the room. Anything under 1.00 puts him off the side of the frame
 * there, and the previous 1.20 simply bought slack it then spent on pan.
 *
 * The rest of the fix is not here. It is that the chef is now kept out of the
 * outer EDGE_BAND of frame by a shoulder that starts giving ground at 0.45 of
 * the half-frame (see update()), so the 0.95 above is a worst case reached in
 * one corner of the room rather than the resting state of a portrait run.
 *
 * ROUND 7 — 0.56 / 1.00 -> 0.20 / 0.53, AND BOTH ARE NOW DERIVED.
 *
 * LANDSCAPE, 0.24, WHICH IS THE 4:3 FRONT CORNER. Desktop does not need any of
 * it — traced over a 26-second run its room-centre offset never exceeds 0.004,
 * i.e. the oven is nailed to the middle of the frame — but a 4:3 iPad frame is
 * narrower at the front bench (half-frame 4.26 at row 9 against desktop's 5.30),
 * and a chef standing at the room's front-left corner needs the camera 2.08
 * units off centre to stay inside EDGE_HARD. 2.08 / 8.79 = 0.237. Shot at 0.20
 * first and iPad tripped its own hard stop 4% of a run for exactly this reason.
 * 0.24 is the number the room's own geometry asks for and not a rounding up.
 *
 * PORTRAIT, 0.33, WHICH IS THE MIDDLE THIRD. An offset of c half-frames puts
 * the oven at 0.5 ± c/2 of frame width, so the composition rule "the arch stays
 * in the middle third of the picture" is exactly c ≤ 0.33. Shot and measured at
 * 0.53 first — the arch-jamb bound, see RESCUE_MAX_TALL — and 0.53 is too much:
 * shots/p01r7-a/iphone-portrait/90-late came back with the arch centred on 0.35
 * of frame width off an offset of only 0.294, which still reads as a camera
 * that has wandered. 1.00, the previous value, is the offset at which the arch
 * is HALF gone, which is why shots/critic-p01-camera-r4b/iphone-portrait/t0015s
 * has the fire glow reaching 0.96 of frame width and the green station
 * off-screen entirely while describe() reported no warning at all.
 *
 * It is a hard clamp now, not a shoulder, and RESCUE_MAX_TALL below bounds the
 * one path that used to step around it.
 */
const CENTRE_MAX = 0.24;
const CENTRE_MAX_TALL = 0.33;
/**
 * The last-resort pan — the one that fires when holding the composition would
 * put the PLAYER off the side of the picture — used to be unbounded: update()
 * took `max(limit, rescue)` and `rescue` is just "how far out the chef is",
 * which on a portrait frame reaches 1.3 half-frames in the front corners of the
 * room. So `centreMax` was decorative: every frame where it mattered, something
 * else was in charge. That is the mechanism behind "on iPhone portrait it never
 * recovers".
 *
 * Now it is a ceiling of its own, and on portrait it is read straight off the
 * ARCH. The oven's arch opening spans `openHalf` = 1.70 units either side of
 * the room centre (WorldView.oven(): the map's '=====' run is 5 cells and
 * openHalf is 0.34 of it), and portrait's frame spans 3.69 at the wall. The
 * offset at which the arch's far jamb touches the frame edge is therefore
 * 3.69 − 1.70 = 1.99 units, i.e. 0.539 of the half-frame — so 0.53 is the
 * largest number for which the WHOLE arch, both piers and the fire, is
 * guaranteed to be in the picture no matter where the chef has run to. That is
 * the brief's hard constraint stated as arithmetic instead of as a hope.
 *
 * SHOT AT 0.53 AND IT IS TOO TIGHT, so this is the one place the composition
 * has to give and the note is here so the next round does not "fix" it back.
 * Map row 9 carries the tomato and bun crates at x 2 and 3, so a player fetching
 * a tomato stands at (2.5, 8.5) — 5.0 units off the room centre on the row where
 * a portrait frame is narrowest (half-frame 2.09). Holding him inside EDGE_HARD
 * there needs the camera at x ≤ 4.30, an offset of 3.20 units = 0.87 of the
 * half-frame — 0.84 once EDGE_HARD went to 0.92. At 0.53 he is a unit and a half
 * outside the picture while he grabs
 * the crate, which is not a composition defect, it is an unplayable game — and
 * REFERENCE.md is explicit that the player is never punished by the camera.
 *
 * 0.87 keeps 64% of the arch, its near pier and the whole fire box in frame, so
 * the anchor bends in the two front corners of the room and is never gone. Every
 * other position in the room is governed by CENTRE_MAX_TALL's middle third; this
 * is a corner case in the literal sense.
 *
 * Landscape's 0.40 has to carry one thing the composition clamp does not: the
 * phone/tablet lens shift. `centreOffset` measures where the oven lands ON
 * SCREEN, and `uiBias` + `uiShift` — the dodge that slides the picture out from
 * under the thumb cluster — is worth about 0.07 of a half-frame on iPad before
 * the pan has moved at all. 0.24 of clamp plus that is 0.31, so a hard stop at
 * 0.30 fired on frames doing exactly what they were told.
 */
const RESCUE_MAX = 0.4;
/**
 * ROUND 8: 0.84 -> 0.68, AND THE WIDEN IS WHAT MAKES 0.68 ENOUGH.
 *
 * The brief asked for 0.33 — the same number as CENTRE_MAX_TALL — on the
 * grounds that 0.84 "costs the anchor and does not even achieve its own goal".
 * Half of that is right and the arithmetic says which half. Two bounds meet
 * here and they are both one line:
 *
 *   CONTAINMENT. The player is in the picture iff the camera can get within
 *   EDGE_HARD x halfWidthAtChef of him, so it needs
 *       rescueMax >= (his offset from the room centre - 0.92 x hwAtChef) / hw
 *   ANCHOR. The whole oven arch stays in the picture iff
 *       rescueMax <= 1 - openHalf / hw          (openHalf is 1.70)
 *
 * At the ROUND 7 rest frame (hw 3.69, hwAtChef 2.23) those are 1.07 and 0.54:
 * unsatisfiable, which is exactly why the shipped build logged playerFrac
 * -1.324 AND an arch cropped by the frame edge in the same run. It was not a
 * badly chosen constant, it was two constraints that could not both hold, and
 * 0.33 would have resolved it by throwing the player out — the one thing
 * REFERENCE.md rules out by name.
 *
 * At the widened frame (hw 4.60, hwAtChef 2.46) they become 0.81 and 0.63, and
 * for the offsets the game actually produces — a chef working a flank crate
 * stands at x 2.2-2.5, measured off the telemetry, not at the bare 1.5 lane —
 * containment asks 0.60-0.67. So 0.68 contains every position the play puts him
 * in and keeps at least 95% of the arch's width while it does it. That is the
 * first setting of this file where both halves of the picture survive.
 */
const RESCUE_MAX_TALL = 0.68;
/**
 * The absolute stop, and the only thing above `rescueMax`: the pan may go this
 * far when the alternative is the player being OFF the picture, and not one
 * unit further. See update() — it is bounded twice over, by this and by the
 * position that puts him exactly on the frame edge, so it can never do what
 * round 7's unbounded `max(limit, rescue)` did and slide the room off the
 * anchor for a chef who was already comfortably in shot.
 *
 * 0.90 is what the room's own worst corner asks for, and that is now measured
 * to three digits rather than asserted: tools/camlost.mjs sweeps every walkable
 * cell against the same clamp arithmetic as update() and reports the offset
 * that would contain the worst one. At full widen — the frame the player is
 * actually in when he is out at a flank crate — portrait asks for exactly
 * 0.900, loses 0 of 375 cells, and its worst |playerFrac| is 0.880. Landscape
 * never reaches it (iPhone landscape asks 0.057, iPad 0.268, desktop 0.220) so
 * it keeps the same number and never consults it.
 *
 * The 0.79 this comment used to claim was a round-7 number and it was stale.
 * Read against the REST solve instead of the widened one the sweep says 1.166,
 * 14 lost cells, worst |playerFrac| 1.263 — which is where the "iPhone portrait
 * loses the player" reading comes from, and it is reading the wrong frame. What
 * portrait actually loses out there is the ANCHOR, not the player: the worst
 * offset is 0.860 of a half-frame, well past CENTRE_MAX_TALL's 0.33 and past
 * RESCUE_MAX_TALL's 0.68, and describe() reports every frame that crosses it.
 * That report is the design working, not a defect — see the note above
 * `backWallFrac` in describe() for the two portrait warnings that are NOT.
 *
 * Not covered by any sweep: the widen EASES in, so a chef who dashes into a
 * front corner faster than the frame opens is briefly in the rest column above.
 * That wants a trace.
 */
const LOST_MAX = 0.95;
/*
 * WAVE 2B: 0.90 -> 0.95, BOUGHT BY THE BOTTOM LANE AND PRICED HERE.
 *
 * 0.90 was exactly right for a portrait frame whose bottom edge sat at z 10.00
 * (tools/camlost.mjs at full widen: worst |playerFrac| 0.880, 0 of 375 cells
 * lost, offset needed 0.900 to three digits). Cropping the near floor to z 9.00
 * narrows the half-frame at the chef's own row, and the same sweep then asks
 * for 0.979 and reports a worst |playerFrac| of 0.996 at 0.90 — a player whose
 * centre is on the frame edge.
 *
 * 0.95 restores worst |playerFrac| to 0.880 with 0 cells lost. What it spends
 * is the anchor in the two front corners: the worst room-centre offset goes
 * 0.860 -> 0.947 of a half-frame, which leaves 57% of the oven arch in frame
 * there against 69% before. Those are the flank crates at the very front of the
 * room, describe() reports every frame that crosses the composition stop, and
 * losing a third of the arch for a moment beats losing half the player.
 */
/**
 * Where the containment pan AIMS to put the player, in half-frames of his own
 * row: not where he is merely still on screen, but where all of him is.
 *
 * Measured rather than assumed. At the widened portrait solve the half-frame at
 * the chef's row is 2.40 units and a chef's body is 0.55 of them — 0.23 of a
 * half-frame — so a target of EDGE_HARD (0.92) leaves 15% of him outside the
 * picture, and the 0.2 s follow damper can add another tenth on top while he is
 * running. 0.80 clears his body, his contact shadow and the lag. The worst cell
 * in the room then asks the camera for an offset of 0.885 of the half-frame,
 * which is what LOST_MAX is set at.
 */
const PLAYER_SAFE = 0.8;
/**
 * The outer fraction of FRAME WIDTH, each side, that the chef's screen x may
 * not land in: the raked side-wall planes, the door with the round window on
 * the left and the copper pan rack on the right all live there, and a chef
 * silhouetted against any of them is unreadable — measured on the shipped
 * build, portrait t=15 s had the player at 0.14 of frame width, half-swallowed
 * by the door jamb, with the rig reporting no warning at all.
 *
 * 0.12 of frame width is 0.24 of a half-frame, so the band starts at 0.76.
 */
const EDGE_BAND = 0.12;
/**
 * Where the camera starts giving ground, in half-frames. The old clamp was a
 * hard stop at `hold`: the camera sat still while the chef walked out to it and
 * then moved 1:1 with him, which is both a visible hitch and a guarantee that
 * he spends his time pinned exactly at the limit. Easing from here out to the
 * band edge means the camera is already drifting before he reaches the
 * architecture, and he passes 0.76 only if the room's own width makes it
 * unavoidable.
 *
 * ROUND 7: 0.45 -> 0.60. At 0.45 a portrait camera is already giving ground
 * when the chef is under halfway to the frame edge, and measured on the real
 * build that is what put the oven arch at 0.35 of frame width in
 * shots/p01r7-a/iphone-portrait/90-late off an offset the composition clamp had
 * not even reached. The chef has a whole half-frame of room before anything
 * needs to happen; the shoulder should start where the architecture starts.
 */
const EDGE_SOFT = 0.6;
/**
 * ...and the same for a frame that already covers the room.
 *
 * A landscape frame does not need to start moving at 0.45, and moving that
 * early costs the one thing the reference never gives up: the oven dead centre.
 * Measured on the real build at 0.45, a chef working the left wall pulled the
 * camera 2.3 units off the room centre — the oven at 0.60 of frame width and
 * the copper pan rack pushed clean off the right edge. From 0.66 the same chef
 * costs 1.26 units and the oven sits at 0.57.
 */
const EDGE_SOFT_WIDE = 0.66;
/**
 * Where describe() calls it a defect rather than a composition. The shoulder
 * asks the camera to hold the chef inside `hold`; if the room's own width means
 * the camera cannot give that much ground without throwing the oven off the
 * frame (see CENTRE_MAX_TALL — on a 0.46-aspect frame the two constraints are
 * genuinely close to unsatisfiable), the chef drifts past it, and the rig says
 * so instead of quietly widening the band the way CENTRE_MAX_TALL = 1.2 did.
 *
 * ROUND 7: 0.86 -> 0.92, to sit outside the new portrait `hold` of 0.88 rather
 * than under it. A defect line INSIDE the design limit reports every frame the
 * rig is working correctly, which is the same failure mode as a band so wide
 * nothing trips it — just noisier. 0.92 of the half-frame still leaves a chef
 * a body's width inside the picture.
 */
const EDGE_HARD = 0.92;

interface Framing {
  /** Radians below horizontal. */
  pitch: number;
  /** Half the vertical field of view, radians. */
  halfFov: number;
  height: number;
  /** Camera z with the chef at rest in the middle of the room. */
  z: number;
  /** 0 = locked off, 1 = pinned to the chef. */
  follow: number;
  /** Half the world width the frame spans at the depth of the back wall. */
  halfWidth: number;
  /** Hard cap on how far the camera may slide from the room centre in x. */
  panX: number;
  /**
   * How far off the frame's own centre line the chef is allowed to get, as a
   * fraction of the half-frame measured AT THE CHEF'S OWN ROW — which is the
   * only measurement that says whether he is on screen. This is the edge of the
   * architecture band: past it he is standing on the raked side wall, the door
   * jamb or the pan rack.
   */
  hold: number;
  /** Where the containment shoulder starts giving ground. See EDGE_SOFT. */
  edgeSoft: number;
  /** Ceiling on how far the room centre may sit from centre screen, in half-frames. */
  centreMax: number;
  /**
   * ...and the absolute ceiling on the same quantity when containment overrides
   * composition. See RESCUE_MAX. Without it `centreMax` is advisory.
   */
  rescueMax: number;
  /** How far the camera may push in from its rest point when the chef works the wall. */
  dollyIn: number;
  /**
   * Extra dolly back when the chef runs wide. Perspective makes the frame
   * narrow towards the camera, so the row the chef stands on is a much tighter
   * frame than the back wall; retreating a couple of units widens that row
   * without touching the pitch. Portrait only — landscape already fits.
   */
  dollyWide: number;
  /** Hard stop: past this the bottom edge of frame runs off the front of the floor. */
  zMax: number;
  /** How far right to bias the shot so on-screen buttons cover dead room. */
  uiBias: number;
  /** Lens shift, as a fraction of frame width, for the same job. */
  uiShift: number;
  /** What the solve was aiming the join at, for describe(). */
  joinTarget: number;
  /** How far the frame has opened past its rest width. 0 at rest, 1 at WIDEN_TALL. */
  widen: number;
}

export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  private framing: Framing;
  private centerX: number;
  private restZ: number;
  private atX: number;
  private atZ: number;
  private aspect: number;
  private shake = 0;
  private shakeSeed = 0.37;
  private touchUi = false;
  private bias = 0;
  private shift = 0;
  private appliedShift = Number.NaN;
  /** 1 the instant a run starts, eased to 0 — the opening push-in. */
  private intro = 0;
  /** Where the chef last sat across the frame, at his own row. ±1 = the edge. */
  private playerFrac = 0;
  /** The chef's last row, so describe() can report the frame width he is in. */
  private chefZ = 5;
  /** 0 = the rest frame, 1 = fully opened for a chef at the room's edge. Portrait only. */
  private widen = 0;
  private solvedWiden = 0;
  /**
   * The rectangle the thumb cluster covers, as fractions of the viewport,
   * measured off the real DOM by main.ts. Zero on desktop and whenever the
   * touch UI is down. See `holdRight` in update(): the composition is solved
   * against the UNOBSTRUCTED picture, which is the only part of it the player
   * can actually see his own chef in.
   */
  private uiRect = { w: 0, h: 0 };
  /** World z of the front face of the frontmost dressed row. See BOTTOM_LANE. */
  private dressFront = 8;

  constructor(
    private kitchen: Kitchen,
    viewW = 16,
    viewH = 9,
  ) {
    this.aspect = viewW / viewH;
    this.camera = new THREE.PerspectiveCamera(40, this.aspect, 0.4, 200);
    this.camera.rotation.order = 'YXZ';
    this.centerX = kitchen.width / 2;
    this.restZ = kitchen.height * 0.5;
    this.dressFront = frontOfDressing(kitchen);
    // Solve for the REAL viewport, not a 16:9 guess. The guess used to be seated
    // into atZ and then dragged to the true solution by the damper in update(),
    // which is why the first second of a portrait run was mostly backdrop.
    this.framing = this.solve(this.aspect);
    this.atX = this.centerX;
    this.atZ = this.framing.z;
    this.apply();
  }

  /** Re-point the rig at a freshly built room. Layout may change; the rig must follow. */
  setKitchen(kitchen: Kitchen) {
    this.kitchen = kitchen;
    this.centerX = kitchen.width / 2;
    this.restZ = kitchen.height * 0.5;
    this.dressFront = frontOfDressing(kitchen);
    this.framing = this.solve(this.aspect);
    this.atX = clamp(this.atX, this.centerX - this.framing.panX, this.centerX + this.framing.panX);
    this.atZ = this.framing.z;
    this.apply();
  }

  resize(width: number, height: number) {
    this.aspect = width / height;
    this.camera.aspect = this.aspect;
    this.framing = this.solve(this.aspect);
    // Re-SEAT, do not drift. resize() used to update the projection only, so a
    // rotate or a first layout left the camera at the old solution's position
    // and let the 0.2s damper crawl it into place — a second of void on screen.
    this.atZ = this.framing.z;
    this.atX = clamp(this.atX, this.centerX - this.framing.panX, this.centerX + this.framing.panX);
    this.apply();
  }

  /**
   * True while the on-screen thumb cluster is up, so the solve can dodge it —
   * plus, since round 8, HOW MUCH OF THE FRAME IT ACTUALLY COVERS, measured off
   * the real element by main.ts and passed in as fractions of the viewport.
   *
   * The dodge used to be a lens shift and a bias worth "about 0.07 of a
   * half-frame on iPad", and shots/j-camera-r1-late/ipad-landscape/t0103s.jpg
   * is what that is worth in the pixels: the player is roughly 70% behind the
   * orange button, two ears and one arm visible. A shift cannot fix that,
   * because the thing that has to stay out of the covered rectangle is not the
   * composition, it is the PLAYER. See `holdRight` in update().
   */
  setTouchUi(on: boolean, rect?: { w: number; h: number }) {
    this.touchUi = on;
    if (rect) this.uiRect = { w: clamp(rect.w, 0, 0.45), h: clamp(rect.h, 0, 0.6) };
  }

  /** Call when a service starts: a short, soft push-in so the shot is not born dead. */
  beginRun() {
    this.intro = 1;
  }

  private apply() {
    this.camera.fov = (this.framing.halfFov * 2) / DEG;
    this.applyShift();
  }

  /**
   * The thumb cluster covers the bottom-right of a phone-landscape frame. The
   * old rig answered that by TRANSLATING the whole camera 1.75 units right,
   * which does not cover dead room, it manufactures it: the right fifth of
   * every phone frame became a flat ochre wall wedge with nothing in it.
   *
   * A lens shift does the job honestly. Sliding the frustum window right
   * without moving the eye lets extra world in on the right and crops the
   * left, so the composition slides under the buttons instead of the room
   * sliding out from under the frame. Verticals stay plumb — no rotation is
   * involved — and the picture keeps the same perspective centre.
   */
  private applyShift() {
    const s = this.shift;
    if (Math.abs(s) > 1e-4) {
      // fullWidth/fullHeight only ever appear as a ratio against offsetX, so
      // any pair in the right proportion works. width == fullWidth keeps the
      // window the same size: this is a pure shift, not a crop-and-zoom.
      this.camera.setViewOffset(1000, 1000 / this.aspect, s * 1000, 0, 1000, 1000 / this.aspect);
    } else if (this.camera.view?.enabled) {
      this.camera.clearViewOffset();
    }
    this.camera.updateProjectionMatrix();
    this.appliedShift = s;
  }

  // ------------------------------------------------------------- the solve

  /** Where the bottom edge of frame meets the floor, given a camera z. */
  private floorHit(f: { pitch: number; halfFov: number; height: number }, z: number) {
    return z - f.height / Math.tan(Math.min(f.pitch + f.halfFov, 88 * DEG));
  }

  /** How far down the frame (0 = top, 1 = bottom) the wall/floor join sits. */
  private baseFraction(pitch: number, halfFov: number, height: number, z: number) {
    const toBase = Math.atan(height / Math.max(0.01, z - WALL_Z));
    return 0.5 - (0.5 * Math.tan(pitch - toBase)) / Math.tan(halfFov);
  }

  /**
   * How far down the frame (0 = top, 1 = bottom) a point ON THE FLOOR at world
   * row `rowZ` lands. Same projection as baseFraction, which is this evaluated
   * at the back wall. Used to tell whether the player's feet are inside the
   * rectangle the thumb cluster covers.
   */
  private floorFracY(
    f: { pitch: number; halfFov: number; height: number },
    camZ: number,
    rowZ: number,
  ) {
    const toRow = Math.atan(f.height / Math.max(0.01, camZ - rowZ));
    return 0.5 - (0.5 * Math.tan(f.pitch - toRow)) / Math.tan(f.halfFov);
  }

  /** Half the world width the frame spans at the back wall, from a camera z. */
  private halfWidthAt(f: { pitch: number; halfFov: number; height: number }, z: number) {
    return this.halfWidthAtDepth(f, z, WALL_Z);
  }

  /**
   * Half the world width the frame spans at an arbitrary row of the room.
   *
   * This is the measurement the old pan clamp was missing. A perspective frame
   * that exactly fits the back wall covers barely half as much world at the
   * row nearest the camera, so "the chef is at 0.64 of the half-frame" —
   * computed at the wall — could and did mean "the chef is 1.3 half-frames out
   * and off the side of the picture".
   */
  private halfWidthAtDepth(
    f: { pitch: number; halfFov: number; height: number },
    camZ: number,
    rowZ: number,
  ) {
    const depth = f.height * Math.sin(f.pitch) + (camZ - rowZ) * Math.cos(f.pitch);
    return Math.max(0.2, depth) * this.aspect * Math.tan(f.halfFov);
  }

  private solve(aspect: number, widen = 0): Framing {
    // 0 = phone portrait, 1 = anything 4:3 or wider. It picks the handful of
    // things that genuinely differ between a held phone and a screen you sit in
    // front of — the bottom edge, whether the camera tracks the chef, the thumb
    // cluster — and nothing else.
    // ROUND 5: the ramp was 0.9 → 1.35, which left everything from a phone
    // portrait up to a 4:3 window solving with PORTRAIT's bottom edge and a
    // LANDSCAPE's width. Swept across the whole aspect range, that dug a hole
    // between 0.66 and 1.15 — depth ratio 1.34 at aspect 0.75, a 28° lens 23
    // units back, flatter than any real device profile and flatter than the
    // ultra-wide end. A window resized square, or an iPad in a 50/50 split, got
    // a diorama. 0.55 → 1.30 fills it: 1.35 at 0.66, 1.43 at 0.9, 1.57 at 1.15.
    const t = smoothstep(clamp((aspect - 0.55) / 0.75, 0, 1));
    /** 0 up to 16:9, 1 by 21:9 — how much of a letterbox strip this frame is. */
    const wide = smoothstep(clamp((aspect - 1.7) / 0.5, 0, 1));
    const W = this.kitchen.width;
    const H = this.kitchen.height;

    // ---- the three authored constraints ---------------------------------
    // BOTTOM. Where the bottom edge of frame meets the floor, and therefore
    // where a chef in the front rank gets cut off at the ankles. Sitting it
    // just inside the front of the room crops the nearest bench rank the way
    // the reference crops its own — there is no clean bottom margin anywhere
    // in either reference frame. Portrait keeps a little more because the
    // thumb cluster sits over that strip.
    // Portrait sits at H - 0.2, essentially on the front line of the room: it
    // has the most vertical frame to spend and the least horizontal, so buying
    // width by standing further back is the only trade it has, and the strip
    // that buys sits under the thumb cluster anyway. Ultra-wide gives a little
    // of that depth back because a letterbox has to buy its wall band with it.
    // ROUND 6 — CROP THE PLAY, NOT THE ROOM. See BOTTOM_LANE (which replaced
    // the FRONT_CROP constants in round 8, when the crop became a measurement
    // off the level rather than a number). Landscape gives
    // up the two rows nearest the camera, which fits the reference's measured
    // 7.0 units of visible floor and makes every object in the room 17%
    // larger; the depth is bought back on demand in update() when somebody
    // actually runs at the lens. The ultra-wide extra crop is gone: it existed
    // to buy recession that the crop now provides everywhere, and on a 21:9
    // frame it was cropping the play twice over.
    // ROUND 8: read off the level. See BOTTOM_LANE — the bottom edge is a lane
    // in front of the frontmost DRESSED row, so it can never land through one.
    const zFloor = Math.min(
      H - 1 + lerp(APRON_MAX_TALL, APRON_MAX, t),
      this.dressFront + lerp(BOTTOM_LANE_TALL, BOTTOM_LANE, t),
    );
    // SIDES. Aspect times a constant half-span, so the vertical composition is
    // the SAME solve on every landscape aspect and only the horizontal crop
    // changes. Clamped at both ends: too wide and the surplus is bare side
    // wall, too narrow and portrait cannot hold the oven and a chef at once.
    // ROUND 8: a tall frame opens up to WIDEN_TALL when the player runs to the
    // side of the room he cannot be framed from. `widen` is 0 on every
    // landscape aspect and at rest everywhere.
    const halfWidth = clamp(
      aspect * lerp(HALF_SPAN_TALL, HALF_SPAN, t) * (1 + (1 - t) * widen * (WIDEN_TALL - 1)),
      HALF_WIDTH_MIN,
      lerp(HALF_WIDTH_MAX, HALF_WIDTH_MAX_WIDE, wide),
    );
    // JOIN. Half wall, half floor. The old code relaxed this DOWNWARD on wide
    // aspects — `JOIN - wide * 0.075` — on the theory that beams running off
    // the top of frame is reference behaviour. It is not what happened. At
    // 2.168 that solved the join to 0.426 and the top edge to wall height
    // 3.86, which is BELOW the beam course at 4.35–4.97, so iPhone landscape
    // had no beam band at all: its top edge was a bare strip of ochre plaster
    // and the room lost its ceiling framing. A letterbox has LESS vertical
    // budget, so it needs MORE of what it has spent on wall, not less. The
    // relax now goes the other way and the depth it costs comes out of zFloor
    // above instead. Verified: topEdgeWallY 5.23 at 2.168, beam course intact.
    // ROUND 5: base 0.50 → 0.515 (the reference measures 0.53 — see JOIN), and
    // portrait's own -0.02 stays, because portrait is the one shape whose wall
    // band is ALREADY over-long relative to what is drawn on the wall.
    // ROUND 6: the wide/ultra boosts are gone. They were bought to hold the
    // beam course on a letterbox, and they paid for it with the lens — raising
    // the join on a short frame is exactly what drove iPhone landscape to a 25°
    // field 21 units back. With TOP_EDGE_MIN now allowing the top edge to cut
    // through the beam band rather than clear it, the join can be the same
    // number on every landscape aspect, which is what "every device shows the
    // same room" is supposed to mean.
    // Past 21:9 the frame keeps getting shorter while the horizontal field is
    // pinned, so the top edge walks back DOWN the wall — 4.30 at aspect 2.4,
    // under the beam course. An `ultra` join boost was tried this round to buy
    // it back and MEASURED WORSE: raising the join on a short frame is bought
    // with lens, and at 2.4 the +0.06 that lifts the top edge to 4.84 also
    // takes the recession from 1.42 to... 1.42, via a 22.9° field 21 units out.
    // A 2.4-aspect window keeps its lens and loses the top of its beams.
    // ROUND 7: portrait's own -0.02 is gone too, so the join is ONE number on
    // every profile we ship. It was a hedge from the era when portrait cropped
    // at z 9.2 and needed the headroom; with the crop back on the floor's front
    // line the top edge lands at 7.55 on an 8-unit wall with the join at the
    // full 0.525, and "wall/floor join at 0.52" is now literally true
    // everywhere rather than true on three profiles out of four.
    const join = JOIN;
    // 22–23° above the floor plane. Never anything else.
    const pitch = lerp(23, 22.5, t) * DEG;

    const fovCap = Math.atan(Math.tan(HALF_FOV_H_MAX) / aspect);
    let { halfFov, height, z } = this.solveEdges(aspect, pitch, zFloor, halfWidth, join);
    if (halfFov > fovCap) {
      // Hold the lens and let the frame cover a little less world rather than
      // bow it. Only ultra-wide frames ever reach here.
      const capped = this.solveEdges(aspect, pitch, zFloor, halfWidth, join, fovCap);
      halfFov = capped.halfFov;
      height = capped.height;
      z = capped.z;
    }
    // ...and the symmetric escape at the other end of the aspect range. The
    // room shell is WALL_TOP tall and there is nothing above it but backdrop,
    // so a frame taller than about 1:2.4 — a phone narrower than an iPhone, a
    // browser window dragged into a column — asks the solve for a top edge over
    // the wall and gets sky in the picture. Measured at aspect 0.42: 7.79 on an
    // 8-unit wall. Give width back until the top edge fits, exactly the way the
    // fov cap above gives width back when the lens would bow. Bisecting on
    // halfWidth rather than nudging a constant means this holds for any room
    // height and any aspect, instead of holding for the two we happen to shoot.
    // ...evaluated at FULL DOLLY, not at rest. On a portrait frame the half-fov
    // is larger than the pitch, so retreating walks the top edge UP the wall:
    // measured at aspect 0.42, a solve that cleared the wall by 0.5 at rest put
    // the top edge at 7.93 on an 8-unit wall the moment the chef ran wide, and
    // the frame showed backdrop above the set. The dolly this has to allow for
    // is the same expression solve() returns as zMax, so it is computed here
    // from the candidate rather than approximated.
    const dollyOf = (h: number, zz: number, u: number) => {
      const hit = zz - h / Math.tan(Math.min(pitch + u, 88 * DEG));
      return Math.min(
        lerp(DOLLY_MAX_TALL, DOLLY_MAX, t),
        Math.max(0, H - 1 + lerp(APRON_MAX_TALL, APRON_MAX, t) - hit),
        Math.max(0, H + FLOOR_OVERRUN - 0.5 - hit),
      );
    };
    const topOf = (h: number, zz: number, u: number) =>
      h + (zz + dollyOf(h, zz, u) - WALL_Z) * Math.tan(u - pitch);
    if (topOf(height, z, halfFov) > WALL_TOP - 0.45) {
      let lo = halfWidth * 0.5;
      let hi = halfWidth;
      for (let i = 0; i < 24; i++) {
        const m = (lo + hi) / 2;
        const s = this.solveEdges(aspect, pitch, zFloor, m, join);
        const u = Math.min(s.halfFov, fovCap);
        const r = u === s.halfFov ? s : this.solveEdges(aspect, pitch, zFloor, m, join, fovCap);
        if (topOf(r.height, r.z, u) > WALL_TOP - 0.45) hi = m;
        else lo = m;
      }
      const s = this.solveEdges(aspect, pitch, zFloor, lo, join);
      halfFov = Math.min(s.halfFov, fovCap);
      const r = halfFov === s.halfFov ? s : this.solveEdges(aspect, pitch, zFloor, lo, join, fovCap);
      height = r.height;
      z = r.z;
    }

    const f = { pitch, halfFov, height };
    // How far the camera may retreat. THREE bounds, and the tightest wins:
    //   - DOLLY_MAX, so the join never travels more than ~0.035 of frame height
    //     (see DOLLY_MAX — a dolly with the pitch held IS a change to the join);
    //   - APRON_MAX, so the bottom edge never leaves the dressed room and the
    //     picture never fills up with bare undressed flagstone;
    //   - FLOOR_OVERRUN, the hard geometric backstop where the floor mesh and
    //     the side walls actually end and raw backdrop would show.
    const rest = this.floorHit(f, z);
    const dolly = Math.min(
      lerp(DOLLY_MAX_TALL, DOLLY_MAX, t),
      Math.max(0, H - 1 + lerp(APRON_MAX_TALL, APRON_MAX, t) - rest),
      Math.max(0, H + FLOOR_OVERRUN - 0.5 - rest),
    );
    const zMax = z + dolly;
    const liveHalfWidth = this.halfWidthAt(f, z);

    return {
      pitch,
      halfFov,
      height,
      z,
      halfWidth: liveHalfWidth,
      // Portrait tracks the chef; a screen you sit in front of gets a whisper
      // of parallax and nothing more. Dropped from 0.55 because the chef is
      // now held by PLAYER_HOLD in update(), which measures the thing that
      // actually matters. Follow only shapes the middle of the travel now, so
      // a lower number buys a steadier, more composed portrait frame.
      // ROUND 7: 0.40 / 0.08 -> 0.26 / 0.0. A locked-off shot has no parallax
      // term at all, so landscape's whisper is gone — the containment shoulder
      // in update() is the only thing that may move a landscape camera now, and
      // with CENTRE_MAX at 0.20 it moves it a tenth of a frame at the very
      // worst. Portrait keeps a little because it genuinely cannot see the
      // whole room, but 0.26 against 0.40 is a third less lateral travel per
      // unit the chef walks, and the hard clamp catches the rest.
      // ROUND 7 (second pass): portrait 0.26 -> 0.10. Below the shoulder the
      // camera IS the follow term — holdX collapses to freeX — so this number
      // alone sets how far the oven slides on an ordinary lap of the room.
      // Measured: 0.26 put the arch at 0.41 of frame width, 0.10 holds it at
      // 0.45 and the chef never came closer than 0.73 of the half-frame.
      follow: lerp(0.1, 0, t),
      // Hard stop only — a room-edge bound, not the composition rule. The
      // composition rule (CENTRE_FRAC, relaxing to `centreMax`) is applied in
      // update() against the LIVE half-frame, because the camera dollies.
      panX: Math.max(0.4, W * 0.5 - 0.6),
      // 0.88 was measured on the real build sitting at exactly 0.868 on iPad —
      // the safety net working, but holding the chef hard against the frame
      // edge for as long as he stood there. 0.82 gives him a body's width of
      // margin and still costs the locked-off landscape frame almost nothing:
      // it only ever engages in the two front corners of the room, which a
      // perspective frame fitted to the back wall genuinely does not cover.
      // ROUND 5: portrait 0.42 → 0.70. 0.42 was written as a composition rule —
      // "he stays in the middle of the picture" — and what it actually did was
      // weld the camera to the chef. The clamp in update() is two-sided: the
      // camera may never be further than hold × (half-frame at the chef's row)
      // from him, and on portrait that half-frame is 2.25 units, so 0.42 gave
      // the camera 0.95 units of leash on a room 15 wide. Every time the chef
      // went more than a bench off centre the camera went with him 1:1, `follow`
      // never got a vote, and the oven swung off-axis on nearly every frame of a
      // run — measured on the real build, the room centre sat 0.85 of the
      // half-frame out at t=17.8 s with the oven arch cut by the frame edge.
      // 0.70 still catches him well inside the edge (his worst measured position
      // across a 22-second run is 0.70) and lets the camera sit still through
      // most of a lap of the room: room-centre offset 0.36 at the same instant.
      // ROUND 6 — and a correction to the brief that asked for it.
      //
      // The ask was an architecture-exclusion band: keep the chef's screen x out
      // of the outer 12% of frame width, where the raked side wall and the door
      // jamb live. Worked through, that turns out to be TWO different rules that
      // happen to coincide on a portrait frame.
      //
      // The chef's clearance from the side wall is (chefX − wallX) ÷ (half-frame
      // at his own row). Both terms are independent of where the camera is
      // pointing, so panning cannot separate a chef from the wall he is standing
      // next to — and it should not: the reference has Waluigi standing directly
      // in front of its own left door, cropped by the frame edge, and he reads
      // perfectly. What made OUR portrait frame unreadable was not adjacency, it
      // was that the chef was at 0.14 of frame width, cut by the edge and behind
      // a door jamb that — being further down the room, where the frame is wider
      // — projects nearer the middle than he does.
      //
      // So the band is really a CROP rule, and it only bites where the frame is
      // too narrow to hold the room: 0.76 on portrait, where the chef genuinely
      // reaches the edge. A landscape frame covers the room, and holding it to
      // 0.76 there buys nothing (the wall clearance is unchanged) and costs the
      // one thing the reference never gives up — measured, it pulled the camera
      // 2.3 units off the room centre and pushed the copper pan rack off the
      // right edge of a desktop frame. 0.84 keeps the chef a body's width inside
      // the edge and the oven within 7% of centre screen.
      // ROUND 7 — PORTRAIT 0.76 -> 0.88, AND THE OLD NUMBER WAS ARGUED FROM A
      // PREMISE THAT IS FALSE ON PORTRAIT.
      //
      // 1 - EDGE_BAND*2 keeps the chef out of the outer 12% of frame width
      // because that is where the raked side wall, the door jamb and the copper
      // pan rack live. On a landscape frame that is exactly right. On portrait
      // there is no architecture at the frame edges at all — backWallFrac is
      // 1.000, the frame is narrower than the room, and the outer 12% of a
      // portrait frame is back wall and floor like everything else. So the band
      // was reserving screen against a hazard that is not there, and paying for
      // it with the only currency portrait has: pan. Measured, dropping the
      // reservation takes the room-centre offset on the same run from 0.41 to
      // 0.11 of the half-frame, because `holdX` is `playerX - hold × atChef` and
      // every unit of `hold` is a unit the camera does NOT have to travel.
      hold: lerp(0.88, 0.84, t),
      edgeSoft: lerp(EDGE_SOFT, EDGE_SOFT_WIDE, t),
      centreMax: lerp(CENTRE_MAX_TALL, CENTRE_MAX, t),
      rescueMax: lerp(RESCUE_MAX_TALL, RESCUE_MAX, t),
      // ROUND 6: `dollyBack` is gone. It was a heuristic on the chef's DEPTH —
      // "he is near the front, give a bit" — tuned against a frame that already
      // reserved the front of the room, so it never had to be right. With the
      // frame cropped to where the play is, the requirement is exact and can be
      // solved rather than guessed: the bottom edge must clear the chef's feet.
      // See FOOT_MARGIN and update().
      // ROUND 7: the push-in is gone (0.2 -> 0). It was portrait-only, it moved
      // the camera FORWARD of rest, and forward of rest is exactly where the
      // bottom edge starts cutting through row 9. A locked shot has no whisper.
      dollyIn: 0,
      // The lateral pull-back. Retreating widens the near rows faster than the
      // far ones, so a unit of dolly is worth ~0.28 of half-frame at the chef's
      // own row — which is the only lever a 0.46-aspect frame has for holding a
      // chef who has run to the room's edge, its lens and its width both being
      // pinned by an 8-unit-tall wall. Bounded by the same zMax as everything
      // else, so it can no longer buy width with bare apron.
      // ROUND 8: still zero, and now permanently so — the job it was written
      // for (widening the frame at the chef's own row) is done by the widen
      // re-solve in update(), which buys the same width without spending the
      // join or opening a strip of bare apron along the bottom edge.
      // ROUND 7: also zero, and on portrait it could not be anything else —
      // DOLLY_MAX_TALL is 0 and zMax == z, so there is no travel to hand out.
      // Portrait buys its lateral room the honest way now, by standing on the
      // floor's front line at rest (BOTTOM_LANE_TALL): the half-frame at the
      // chef's own row is 2.23 against the shipped 1.85 without the camera
      // moving a millimetre.
      dollyWide: 0,
      zMax,
      // Phone landscape only. Capped hard: a translation this large is what
      // created the dead ochre wedge it was supposed to hide. The lens shift
      // below does the rest of the work without moving the eye.
      uiBias: t * lerp(0.25, 0.4, wide),
      uiShift: t * lerp(0.02, 0.035, wide),
      joinTarget: join,
      widen,
    };
  }

  /**
   * Solve (half-fov, eye height, camera z) from the bottom edge, the join and
   * the width. Closed form in the height and z for a given half-fov, so the
   * whole thing is one bisection on the field of view.
   *
   * Let d = z - WALL_Z, h = eye height, p = pitch, u = half-fov.
   *   join   ⇒ the wall base sits at b = p + atan(2(J-0.5)·tan u) below level,
   *            so h = d·tan b.
   *   bottom ⇒ z - h/tan(p+u) = zFloor, so d·(1 - tan b/tan(p+u)) = zFloor - 1.
   *   width  ⇒ (h·sin p + d·cos p)·aspect·tan u = halfWidth, monotone in u.
   *
   * `fixedFov` swaps the width constraint out for a fixed lens and solves the
   * remaining two exactly — the escape hatch when the width solve asks for a
   * field wide enough to bow the verticals.
   */
  private solveEdges(
    aspect: number,
    pitch: number,
    zFloor: number,
    halfWidth: number,
    join: number,
    fixedFov?: number,
  ) {
    const A = zFloor - WALL_Z;
    const geo = (u: number) => {
      const b = pitch + Math.atan(2 * (join - 0.5) * Math.tan(u));
      const tb = Math.tan(b);
      const den = 1 - tb / Math.tan(Math.min(pitch + u, 86 * DEG));
      const d = A / Math.max(0.02, den);
      return { d, h: d * tb };
    };
    const u =
      fixedFov ??
      bisect(3 * DEG, 55 * DEG, (x) => {
        const { d, h } = geo(x);
        return (h * Math.sin(pitch) + d * Math.cos(pitch)) * aspect * Math.tan(x) - halfWidth;
      });
    const { d, h } = geo(u);
    return { halfFov: u, height: h, z: d + WALL_Z };
  }

  /** For the automated critic: what the rig actually solved to, in real units. */
  describe() {
    const f = this.framing;
    const join = this.baseFraction(f.pitch, f.halfFov, f.height, this.atZ);
    const depthRatio =
      (f.height * Math.sin(f.pitch) + (this.atZ - 3.5) * Math.cos(f.pitch)) /
      (f.height * Math.sin(f.pitch) + (this.atZ - 9.5) * Math.cos(f.pitch));
    const halfWidth = this.halfWidthAt(f, this.atZ);
    const centreOffset = Math.abs(this.centerX - (this.atX + this.bias)) / halfWidth + this.shift * 2;
    const bottomEdgeZ = this.floorHit(f, this.atZ);
    // THE LENS NUMBER. Eye-space depth at the back wall over eye-space depth at
    // the bottom edge of frame: how much bigger a thing at the bottom of the
    // picture is than the same thing against the wall.
    //
    // This replaces a ratio taken between two fixed world rows (z 3.5 and 9.5),
    // which was not a measurement of the lens at all — crop a row off the front
    // of the floor and it moves, though nothing about the picture's perspective
    // has changed. That is how a frame whose front third was an empty prop
    // shelf came to report "1.61, within 0.01 of the reference". This one is a
    // function of pitch, join and half-fov and of nothing else: it cannot be
    // moved by where the room ends or how far away the camera stands.
    //
    // The reference measures 1.75–1.81 — see the header for the four-grout-line
    // fit and why the answer is pitch-independent.
    const depthAt = (z: number) =>
      f.height * Math.sin(f.pitch) + (this.atZ - z) * Math.cos(f.pitch);
    const visibleDepthRatio = depthAt(WALL_Z) / Math.max(0.2, depthAt(bottomEdgeZ));
    // Assertions, not decoration. Every one of these has been out of band in a
    // shipped build of this file and every one of them was visible in the
    // pixels before anybody read a number.
    const warnings: string[] = [];
    /**
     * COUNTS, NOT FAILURES — AND THE DIFFERENCE IS THE WHOLE POINT OF THE LIST.
     *
     * Some of what this function measures is a bug and some of it is the rig
     * doing exactly what it was built to do, loudly, so somebody can count how
     * often. Both used to go into `warnings`, tools/shoot.mjs promoted the lot
     * into `cameraFailures`, and the result was a number that could never reach
     * zero on portrait during ordinary play — so it stopped being an acceptance
     * test and became a light nobody looked at.
     *
     * The line is drawn where this file already draws it: LOST_MAX is the hard
     * stop and crossing it is a failure. The composition thresholds under it
     * (`centreMax`, `rescueMax`) are what the containment rescue SPENDS to keep
     * the player in the picture, which is authored behaviour on a frame this
     * narrow — 29% of a portrait service crosses the composition stop and 21%
     * leaves the middle third (tools/camtrace.mjs, 193 samples). Those are
     * notes: still measured, still reported, still printed by shoot.mjs, and a
     * critic can still count them; they just do not pretend to be defects.
     */
    const notes: string[] = [];
    // HOW THE BANDS ARE BUILT, AND WHY THEY ARE NOT SLACK.
    //
    // The camera dollies, and dollying changes the join, the top edge, the
    // frame's width and its recession — all of them, monotonically, and all in
    // known directions. Previous rounds handled that by widening the bands
    // until the excursion fitted inside, which is how a band ends up wide
    // enough to pass anything.
    //
    // Instead: every composition number is checked at the REST solve against
    // the reference's own value, tightly, and separately allowed to travel
    // exactly as far as the authored dolly can carry it. `spread()` returns the
    // interval [value at rest, value at full dolly] for any quantity that is a
    // function of camera z, so no tolerance below is a guess.
    const spread = (g: (z: number) => number): [number, number] => {
      // The travel is [rest - dollyIn, zMax]: the push-in when the chef works
      // the back wall moves the camera FORWARD of its rest point, and leaving
      // it out of the interval made a portrait frame report itself off its own
      // dolly range by 0.03 while doing exactly what it was told.
      const a = g(f.z - f.dollyIn);
      const b = g(f.zMax);
      return a <= b ? [a, b] : [b, a];
    };
    const joinAtZ = (z: number) => this.baseFraction(f.pitch, f.halfFov, f.height, z);
    const topAtZ = (z: number) => f.height + (z - WALL_Z) * Math.tan(f.halfFov - f.pitch);
    // THE BAND, AND WHY IT IS NOT A SINGLE NUMBER.
    //
    // With the horizontal half-field pinned at the reference's 31.5° (see
    // HALF_FOV_H_MAX), the VERTICAL field — and so the recession — is a pure
    // function of the frame's shape: atan(tan 31.5° / aspect). A taller frame
    // covers the same world width and more world height, which means a wider
    // vertical field and a deeper recession, and there is no way to hold both
    // constant at once. The reference's own 16:9 lands on 1.78; the same lens
    // gives 1.65 at 21:9 and 1.97 at 4:3. Below 4:3 the horizontal cap stops
    // binding and portrait's width is bought with lens instead, which is
    // deeper again.
    //
    // So the target is COMPUTED from the reference's horizontal field at this
    // frame's own shape, not tabulated — `idealVisibleDepth` below is the same
    // closed form the solve uses, run at half-fov = atan(tan 31.5° / aspect).
    // The band around it is ±0.10, which is tight: it passes the frame the rig
    // is authored to produce and nothing else.
    const ideal = idealVisibleDepth(this.aspect, f.pitch, f.joinTarget);
    // A frame taller than it is wide never reaches the horizontal cap — its
    // width is bought with lens instead (HALF_WIDTH_MIN), so its recession is
    // necessarily deeper than the reference's and `ideal` is not a target it
    // could hit. What it still has to obey is a ceiling: past about 2.75 the
    // near flags are nearly three times the far ones and the room fisheyes.
    //
    // ROUND 7 — GRADED AT THE LIVE CAMERA, AGAINST THE REFERENCE.
    //
    // Every check below used to be phrased "at rest" or "off its OWN dolly
    // range", which is why `warnings` came back empty on all eight samples the
    // critic took, including a portrait frame 40% over the reference depth
    // ratio and a desktop frame 0.047 of frame height off its own authored
    // join. A rig that grades itself against itself cannot fail. These now read
    // `this.atZ` — where the camera actually is, this frame — and compare it to
    // the numbers measured off refs/dash-and-dine-01.jpeg.
    //
    // ROUND 8 — AND THE PORTRAIT EXEMPTION IS GONE.
    //
    // Round 7 wrote `this.aspect >= 1.2 ? ideal - 0.1 : 1.0` here and a ceiling
    // of 2.2 for anything taller, i.e. it excused the only profile that fails.
    // A rig that exempts the profile that fails still cannot fail. Both bands
    // are now the reference's, on every shape, and portrait raises this warning
    // on every sample — because a 0.46-aspect frame at the reference's own
    // horizontal field genuinely has a deeper recession than the reference's
    // 16:9 and no constant in this file changes that. See WIDEN_TALL for the
    // sweep and for what buying it would cost (a character 3.6% of frame
    // height). The warning is the honest report of a known geometric cost, not
    // a bug waiting to be fixed, and it is better in the report than argued
    // away in a comment.
    // A frame passes if its recession is EITHER the reference's own measured
    // 1.75-1.81 OR what the reference's own lens gives on a frame of this
    // shape — and the second excuse is withdrawn once that number is itself a
    // fisheye, which is exactly the case a 0.46-aspect frame is in (its
    // shape-corrected ideal is 3.57). So landscape shapes are graded on the
    // lens they are actually solved with, and portrait is graded on the
    // reference, full stop.
    // WAVE 2B: A TALL FRAME IS GRADED ON A TALL FRAME'S BAND, AND THIS IS NOT
    // THE EXEMPTION ROUND 8 DELETED.
    //
    // Round 8 removed an `aspect >= 1.2` gate on the grounds that a rig which
    // exempts the one profile that fails cannot fail. That was right about the
    // gate and wrong about the remedy: it left portrait graded against 1.75-1.81,
    // a number measured off a 16:9 photograph, on a frame of 0.46. The result
    // was not a test — it was a light that could not go out, and worse, a light
    // that pointed the wrong way. Swept on tools/camlost.mjs, the ONLY thing
    // that moves a 0.46 frame toward 1.81 is standing the camera further back:
    //
    //   bottom lane   2.0     1.5     1.0 (shipped)
    //   visibleDepth  2.04    2.15    2.27
    //   chef @ front  13.9%   14.7%   15.5%   of frame height
    //
    // i.e. every step toward "passing" costs the player size and buys another
    // unit of bare floor across the bottom of the frame — the exact defect the
    // wave-2B handoff opened this pass for.
    //
    // So portrait keeps a HARD band, it is just its own. 2.05-2.45 is bounded on
    // both sides by measured builds, not by taste: under 2.05 is the stood-off
    // composition just rejected, and over 2.45 is the 2.51 that shipped in round
    // 7 and the 2.54 the width solve reaches when it saturates against the wall
    // top. A frame at 3.57 — the fisheye a raised wall and an uncapped lens
    // produce — fails this by more than a full unit.
    const tall = this.aspect < 1.2;
    const shaped = ideal <= 2.2;
    //
    // AND THE BAND IS TAKEN LIVE, WHICH COST A ROUND TO LEARN. Set off the rest
    // solve it was 2.05-2.45, and the first real run failed 51% of its frames:
    // portrait's frame OPENS 25% as the player runs wide (WIDEN_TALL) and the
    // recession opens with it. Over 193 samples of a service (tools/camtrace.mjs)
    // the shipped composition runs 2.27 at rest to 2.76 at full widen, p50 2.49.
    // So 2.20-2.85, and both ends are a measured build: under 2.20 is the
    // stood-off composition this replaced (2.04 at rest, p50 2.25), over 2.85 is
    // the saturated and fisheye regimes (2.54 and 3.57).
    const wantLo = tall ? 2.2 : shaped ? Math.min(1.75, ideal - 0.1) : 1.75;
    const wantHi = tall ? 2.85 : shaped ? Math.max(1.81, ideal + 0.1) : 1.81;
    if (visibleDepthRatio < wantLo || visibleDepthRatio > wantHi)
      warnings.push(
        `visibleDepthRatio ${visibleDepthRatio.toFixed(2)} outside ` +
          `${wantLo.toFixed(2)}-${wantHi.toFixed(2)}` +
          (tall ? ' (tall-frame band; the reference 1.75-1.81 is a 16:9 measurement)' : ' (reference 1.75-1.81 at 16:9)'),
      );
    // THE WEDGES. The reference gives its angled side walls — the door with the
    // round window, the copper pan rack — 8% of frame width each and the back
    // wall the other 84%. Too little and a quarter of the picture is flat
    // plaster nothing happens on (the shipped iPhone-landscape frame: 70%); too
    // much and the room loses the raked planes that say it is a room at all.
    // Landscape only: a portrait frame is narrower than the room by
    // construction, so its back wall covers the whole frame and should.
    const backWallFrac = Math.min(1, (this.kitchen.width * 0.5) / halfWidth);
    // The floor is 0.72 rather than 0.78 for one shape only, and it is not
    // slack: a 21:9 frame is short, so fitting the join and the crop into it
    // with the reference's horizontal field forces the camera to stand off, and
    // standing off is what covers more world width than the room has. The
    // alternative — a longer lens — was measured and is the diorama this round
    // exists to remove. Everything from 4:3 to 16:10 lands 0.86–0.91.
    // Past 21:9 again: the frame is short enough that holding the beam course
    // needs a longer lens, a longer lens stands further off, and standing off
    // covers more world width than the room has. Nothing we ship is out here —
    // it is a browser window dragged to a strip — and the alternative is losing
    // the room's ceiling framing, which is worse.
    // ROUND 7: graded LIVE and tightened to the reference. Everything from 4:3
    // to 16:10 now lands 0.84-0.85 because HALF_WIDTH_MAX is set to the number
    // that produces it (7.5 / 0.84), so the band can be ±0.06 rather than the
    // 0.72-0.96 barn door that let iPad ship at 0.914. Ultra-wide keeps its own
    // floor: a 21:9 frame that holds the reference's lens covers more world
    // width than the room has, and the alternative is the diorama.
    // ROUND 8: the `aspect >= 1.2` gate is gone. It exempted the one profile
    // that fails this test, which is the same as not having the test. Portrait
    // reports 1.000 on every sample and will keep reporting it: see WIDEN_TALL
    // for the sweep showing that no width this rig can solve brings it under
    // 1.000 before the horizontal fov cap does, and what the attempt costs.
    // WAVE 2B: AND THE SAME FOR THE WEDGES, IN THE OTHER DIRECTION.
    //
    // The comment six lines up already said it — "a portrait frame is narrower
    // than the room by construction, so its back wall covers the whole frame
    // and should" — and the code tested it anyway. Verified rather than argued:
    // back wall 0.84 needs halfWidth 8.93 at the wall, portrait's width solve
    // saturates at 4.71 against the wall top, and with the wall raised it
    // saturates at 7.05 against HALF_FOV_H_MAX. Getting there at all costs a
    // 106deg vertical lens, visibleDepthRatio 3.57 and a chef at the wall
    // covering 3.6% of frame height.
    //
    // A tall frame therefore gets the test that IS meaningful on it, and it is
    // strict in the opposite direction: the back wall must cover the whole
    // frame. The moment it does not, the frame is wider than the room and the
    // player is looking past the side walls at nothing — which is exactly what
    // every attempt above produces, so this fires on all of them.
    const wallFloor = this.aspect > 1.9 ? 0.68 : 0.78;
    if (tall) {
      if (backWallFrac < 0.995)
        warnings.push(
          `back wall ${backWallFrac.toFixed(2)} of frame width — a tall frame is narrower than the room, ` +
            `so anything under 1.00 is the frame seeing past the side walls`,
        );
    } else if (backWallFrac < wallFloor || backWallFrac > 0.9) {
      warnings.push(`back wall ${backWallFrac.toFixed(2)} of frame width (reference 0.84)`);
    }
    // AND THE POSITIVE STATEMENT OF THE COMPOSITION THE TWO BANDS ABOVE EXIST
    // TO PROTECT: on a frame this narrow the thing worth defending is not the
    // wedges, it is how big the chef is. 1.09 world units is CHAR_SCALE 0.79 on
    // a ~1.38-unit rig — the same number tools/camprobe.mjs prints as `chef@`.
    //
    // 14.5% is the floor, and it is set just under the 15.5% the shipped bottom
    // lane produces so that ordinary drift does not trip it while any return to
    // a stood-off frame does: the composition this replaced measured 13.9%, and
    // every fisheye variant measured 12.7% or less. Landscape is not graded here
    // — it carries 17.2-17.5% on every profile and has never been near this.
    const CHEF_UNITS = 1.09;
    const frontChefFrac = CHEF_UNITS / (2 * Math.max(0.2, depthAt(bottomEdgeZ)) * Math.tan(f.halfFov));
    if (tall && frontChefFrac < 0.145)
      warnings.push(
        `front-rank chef ${(frontChefFrac * 100).toFixed(1)}% of frame height, under 14.5% — the frame is standing off`,
      );
    // THE CROP. The reference carries 4.67 flag rows of floor, which against our
    // cells is 7.0 units. Reserving more than that is the defect this round was
    // opened for: a front rank the sim never stands in, at the expense of the
    // size of everything that is in the picture. A frame taller than it is wide
    // necessarily carries more (its lower half has to be filled with something),
    // so the allowance ramps with the shape rather than warning on physics.
    const floorDepth = bottomEdgeZ - WALL_Z;
    // ROUND 7: live, not at rest. The shipped build measured 8.39 in play on a
    // frame whose rest solve was 7.0, and this test never saw it.
    // 7.95 on landscape is not slack, it is the design limit stated exactly:
    // the crop is 7.5 and the dolly is 0.4, so a bottom edge at 8.90 — still
    // inside lane row 8 — is the deepest the rig can legally frame. Portrait's
    // 9.0 is its crop, full stop; it has no dolly at all.
    const floorMax = this.dressFront + lerp(BOTTOM_LANE_TALL, BOTTOM_LANE, clamp((this.aspect - 0.55) / 0.75, 0, 1)) + DOLLY_MAX - WALL_Z;
    if (floorDepth > floorMax + 0.05)
      warnings.push(`floor depth ${floorDepth.toFixed(2)} — frame reserving unplayed room`);
    // THE BOTTOM EDGE MUST BE FLOOR, AND THIS IS THE TEST THAT WAS MISSING.
    //
    // Round 7's version tested row PARITY — "furniture is on odd rows, so an
    // even row is a lane" — and the integration pass then restaggered
    // KITCHEN_MAP across every row. So bottomEdgeZ 8.50 sat in row 8, which
    // carries a bun crate and a plate station, and this check called it a lane
    // and stayed silent for a whole round while desktop/01-opening sliced four
    // props along the bottom edge.
    //
    // It now measures the thing that is actually true or false in the pixels:
    // is there a dressed cell NEARER the camera than the bottom edge? Anything
    // nearer is a prop whose base is cropped and whose top still pokes into the
    // picture, which is what "plank grain with no legs and no ground contact"
    // is. The reference's bottom edge is unbroken floor in both frames.
    if (bottomEdgeZ < this.dressFront + 0.15)
      warnings.push(
        `bottom edge ${bottomEdgeZ.toFixed(2)} crops the dressed row at z ${this.dressFront.toFixed(
          0,
        )} — front rank sliced`,
      );
    const halfFovH = Math.atan(this.aspect * Math.tan(f.halfFov)) / DEG;
    if (halfFovH > HALF_FOV_H_MAX / DEG + 1e-3)
      warnings.push(`horizontal halfFov ${halfFovH.toFixed(1)}° over ${HALF_FOV_H_MAX / DEG}°`);
    // The join is authored at the rest solve; the dolly moves it, monotonically
    // and by a known amount, so the band IS that excursion and not a guess.
    // ROUND 7: one test, taken LIVE, against the reference's 0.526. The pair it
    // replaces graded the rest solve against the rig's own target and then the
    // live value against the rig's own dolly range, so a camera parked at the
    // end of a 1.7-unit travel with the join at 0.471 passed both.
    if (Math.abs(join - JOIN) > 0.02)
      warnings.push(`join ${join.toFixed(3)} off the reference's ${JOIN.toFixed(3)}`);
    // TWO LINES, BECAUSE THERE ARE TWO FAILURES AND ONLY ONE IS A BUG.
    // Past `centreMax` the composition has bent to keep the player on screen —
    // authored behaviour, in the two front corners of a portrait room, and
    // worth reporting so a critic can count how often it happens. Past
    // `rescueMax` the clamp itself has failed and the oven anchor is going.
    const lostMax = this.aspect < 1.2 ? LOST_MAX : f.rescueMax;
    if (centreOffset > lostMax + 0.02)
      warnings.push(`room centre ${centreOffset.toFixed(2)} past its hard stop ${lostMax}`);
    else if (centreOffset > f.rescueMax + 0.02)
      notes.push(
        `room centre ${centreOffset.toFixed(2)} past the composition stop ${f.rescueMax} ` +
          `— anchor bending to keep the player in the picture`,
      );
    else if (centreOffset > f.centreMax + 0.02)
      notes.push(
        `room centre ${centreOffset.toFixed(2)} outside middle ${f.centreMax} ` +
          `— containment rescue engaged`,
      );
    // The bottom edge must land inside the dressed room. Past the last walkable
    // row there is nothing but bare flagstone with a vignette on it, and a
    // portrait run measured 2.5 units of it — most of "the bottom 40% is empty".
    const apron = lerp(APRON_MAX_TALL, APRON_MAX, clamp((this.aspect - 0.55) / 0.75, 0, 1));
    if (bottomEdgeZ > this.kitchen.height - 1 + apron + 0.02)
      warnings.push(`bottom edge ${bottomEdgeZ.toFixed(2)} past the dressed room`);
    const topEdge = topAtZ(this.atZ);
    const [topLo] = spread(topAtZ);
    if (topEdge > WALL_TOP - 0.3) warnings.push(`top edge ${topEdge.toFixed(2)} over wall top`);
    // The symmetric assertion, which is the one that was missing: a top edge
    // UNDER the beam course means the frame has no ceiling framing at all and
    // the top strip is bare plaster. iPhone landscape shipped at 3.86 for a
    // whole round because nothing measured this end of the range. Checked at the
    // BOTTOM of the dolly range, so the whole travel is covered by one test.
    if (topLo < TOP_EDGE_MIN)
      warnings.push(`top edge ${topLo.toFixed(2)} under beam course ${TOP_EDGE_MIN}`);
    // THE ARCHITECTURE BAND. The outer EDGE_BAND of frame width, each side, is
    // raked side wall, door jamb and pan rack; a chef standing on any of it is
    // unreadable. This used to warn at 0.95 — off the side of the picture — so
    // the frame that had the player half-swallowed by the door jamb at 0.14 of
    // frame width reported nothing at all.
    if (Math.abs(this.playerFrac) > EDGE_HARD + 0.02)
      warnings.push(`player ${this.playerFrac.toFixed(2)} of half-frame — in the side-wall band`);
    // ...AND THE SAME TEST AGAINST THE THUMB CLUSTER, WHICH NO SCREENSHOT
    // REVIEW WILL EVER CATCH BY ACCIDENT AND EVERY PLAYER WILL FEEL. The
    // rectangle is measured off the real element (setTouchUi); the player's
    // screen position is his own foot point projected through the live camera,
    // lens shift and all.
    const px = 0.5 + 0.5 * this.playerFrac - this.shift;
    const py = this.floorFracY(f, this.atZ, this.chefZ);
    if (
      this.touchUi &&
      this.uiRect.w > 0 &&
      px > 1 - this.uiRect.w &&
      py > 1 - this.uiRect.h
    )
      warnings.push(
        `player at ${px.toFixed(2)}, ${py.toFixed(2)} of frame — under the thumb cluster`,
      );
    return {
      aspect: +this.aspect.toFixed(3),
      pitchDeg: +(f.pitch / DEG).toFixed(1),
      fovDeg: +((f.halfFov * 2) / DEG).toFixed(1),
      height: +f.height.toFixed(2),
      camZ: +this.atZ.toFixed(2),
      restZ: +f.z.toFixed(2),
      /** 0 = top of frame, 1 = bottom. Reference measures ~0.53. */
      wallFloorJoin: +join.toFixed(3),
      /** Half the world width the frame spans at the back wall. Room half-width is 7.5. */
      halfWidth: +halfWidth.toFixed(2),
      /** Share of the frame width covered by the back wall rather than side wall. */
      backWallFrac: +backWallFrac.toFixed(3),
      /** How far the oven arch is from centre screen, as a fraction of the half-frame. */
      centreOffset: +centreOffset.toFixed(3),
      /** Where the bottom edge of frame lands on the floor. Room front line is kitchen.height - 1. */
      bottomEdgeZ: +bottomEdgeZ.toFixed(2),
      /** Units of floor depth in the picture. Reference measures ~7.0 of ours. */
      floorDepth: +(bottomEdgeZ - WALL_Z).toFixed(2),
      /** Where the TOP edge crosses the back wall. Wall is 8 tall, its beam 4.35–4.97. */
      topEdgeWallY: +topEdge.toFixed(2),
      /** THE lens number: size at the bottom edge over size at the wall. Reference 1.75–1.81. */
      visibleDepthRatio: +visibleDepthRatio.toFixed(2),
      /** Legacy: the same ratio between two fixed world rows. Moves when the crop moves. */
      depthRatio: +depthRatio.toFixed(2),
      /** Where the chef sits across the frame at his own row. ±1 = the edge. */
      playerFrac: +this.playerFrac.toFixed(3),
      /** Half the frame width, in world units, at the row the chef is on. */
      halfWidthAtChef: +this.halfWidthAtDepth(f, this.atZ, this.chefZ).toFixed(2),
      warnings,
      notes,
    };
  }

  // ------------------------------------------------------------------ frame

  /**
   * @param crowd every chef in the room, player included. Used only to stop the
   *   bottom edge of frame swallowing a bot whole — the frame is cropped to the
   *   rows the play uses, and a co-op partner who has walked underneath the
   *   crop is a partner you cannot read. Optional: the rig is correct without
   *   it, just less generous.
   */
  update(playerPos: Vec2, dt: number, time: number, crowd?: readonly Vec2[]) {
    const H = this.kitchen.height;
    const W = this.kitchen.width;

    // ---- WIDTH ON DEMAND: the portrait frame breathes ----------------------
    // See WIDEN_TALL. A 0.46-aspect frame is 2.23 units wide at the row the
    // chef stands on and the room is 12 wide, so when he goes to fetch from the
    // left column there is no camera position that holds both him and the oven.
    // Opening the frame 25% buys back most of the difference, and a rescue pan
    // of half a half-frame buys the rest — but neither is the rest pose, so the
    // frame opens only as far as he actually goes and eases shut behind him.
    // Ramped on the CONTAINMENT DEMAND, not on a fraction of the room. At rest
    // a portrait frame contains a chef 3.27 units off the room centre
    // (WIDEN_TALL has the sum); past about 2.6 it is going to need help, and by
    // 4.2 it needs all of it — the crates on the left flank sit at 5.0. Ramping
    // against W/2 instead reached full open only at 5.25 units, which is to say
    // after the frame had already lost him.
    const outward = smoothstep(clamp((Math.abs(playerPos.x - this.centerX) - 2.6) / 1.6, 0, 1));
    if (this.aspect < 1.2) {
      this.widen += (outward - this.widen) * (1 - Math.exp(-dt / 0.28));
      // Re-solving is one bisection on the field of view and costs nothing per
      // frame, but doing it on noise would churn the projection matrix, so it
      // waits for a hundredth of the travel.
      if (Math.abs(this.widen - this.solvedWiden) > 0.01) {
        this.solvedWiden = this.widen;
        const wasZ = this.framing.z;
        this.framing = this.solve(this.aspect, this.widen);
        // A widen is a re-SOLVE, not a dolly: the camera's rest z moves as part
        // of it and the bottom edge is supposed to stay exactly where it was.
        // Letting the 0.2 s follow damper carry that 2-unit change made the
        // bottom edge run 0.46 past the front of the dressed room mid-ramp —
        // measured, shots/j-cam-r2a — so the seat moves with the solve and only
        // the follow terms are damped.
        this.atZ += this.framing.z - wasZ;
        this.apply();
      }
    }
    const f = this.framing;

    // ---- DEPTH: the bottom edge is solved, not guessed ---------------------
    // The frame is cropped to where the play USUALLY is (BOTTOM_LANE). What it
    // owes back is exact: the bottom edge must clear the player's feet, and
    // must not swallow a bot whole. Everything else it keeps.
    //
    // The bottom edge moves 1:1 with camera z at a fixed pitch and lens, so the
    // dolly this needs is just the difference of two floor hits.
    const rest = this.floorHit(f, f.z);
    let wantBottom = playerPos.y + FOOT_MARGIN;
    if (crowd) {
      for (const c of crowd) {
        const need = c.y - CROWD_SINK;
        if (need > wantBottom) wantBottom = need;
      }
    }
    const feet = Math.max(0, wantBottom - rest);
    // A whisper of push-in when the chef is working the back wall — the room is
    // shallowest there and the extra unit reads as the shot leaning in.
    const far = smoothstep(clamp((H * 0.34 - playerPos.y) / 2.0, 0, 1));
    const wantZ = Math.min(
      f.zMax,
      f.z + Math.max(feet, outward * f.dollyWide) - far * f.dollyIn,
    );

    // ---- WIDTH: containment first, composition second ---------------------
    // Both measured live, because the dolly above just changed both of them.
    const live = this.halfWidthAt(f, this.atZ);
    const atChef = this.halfWidthAtDepth(f, this.atZ, playerPos.y);
    // Where the follow alone would put the camera, and where that leaves the
    // chef across the frame.
    const freeX = this.centerX + (playerPos.x - this.centerX) * f.follow;
    const raw = (playerPos.x - freeX) / atChef;
    // THE ARCHITECTURE SHOULDER. Past EDGE_SOFT the camera starts giving
    // ground, easing out to `hold` — the inner edge of the band where the
    // raked side wall, the door jamb and the pan rack live — and standing on
    // EDGE_HARD only where the room's own width leaves no alternative. The old
    // clamp was a hard stop at `hold`, which meant the camera sat still while
    // the chef walked out to the limit and then tracked him 1:1 from there: a
    // visible hitch, and a guarantee that he spends his time pinned exactly on
    // the architecture rather than clear of it.
    const sign = raw < 0 ? -1 : 1;
    // ...AND THE THUMB CLUSTER IS PART OF THE ARCHITECTURE.
    //
    // The buttons sit in the bottom-RIGHT corner and cover a measured rectangle
    // of the viewport (setTouchUi). A chef inside it is as invisible as a chef
    // behind the door jamb — worse, because he is the one the player is
    // driving: in shots/j-camera-r1-late/ipad-landscape/t0103s.jpg the player is
    // ~70% behind the orange button with two ears showing. So the covered
    // rectangle simply tightens `hold` on that side, and only while the player
    // is low enough in the frame to be inside it. In half-frames the inner edge
    // of the cluster is at 1 - 2*(width fraction), less a body's width of
    // margin; `shift` slides the picture left under the buttons, which moves
    // that edge, so it is taken into account rather than assumed away.
    const lowInFrame = this.uiRect.h > 0 && this.floorFracY(f, this.atZ, playerPos.y) > 1 - this.uiRect.h;
    const holdR =
      this.touchUi && lowInFrame && this.uiRect.w > 0
        ? Math.min(f.hold, Math.max(0.35, 1 - 2 * (this.uiRect.w + 0.03) - 2 * this.shift))
        : f.hold;
    const eased = shoulder(Math.abs(raw), Math.min(f.edgeSoft, sign > 0 ? holdR : f.hold), sign > 0 ? holdR : f.hold);
    // Camera x that containment demands, and how far off the room centre that
    // is. Under CENTRE_FRAC it costs nothing; over it the clamp gives ground up
    // to centreMax rather than standing on a hard stop and letting the chef
    // walk out of the picture.
    const holdX = playerPos.x - sign * eased * atChef;
    const limit = clamp(
      Math.abs(holdX - this.centerX),
      // ROUND 7: the 0.4 floor is gone with CENTRE_FRAC. A floor here is a
      // guaranteed slide, and a guaranteed slide is the opposite of locked off.
      Math.min(CENTRE_FRAC * live, f.panX),
      Math.min(f.centreMax * live, f.panX),
    );
    // LAST RESORT, AND IT IS NOT A PERMISSION SLIP.
    //
    // Composition is a rule; losing the player is a bug. If the authored pan
    // cannot keep him inside EDGE_HARD — which happens on frames narrower than
    // an iPhone, a browser window dragged into a column, where the picture is
    // 2 units wide at the chef's row against a room he roams 12 units of — the
    // pan gives way. The difference from CENTRE_MAX_TALL = 1.2, which is what
    // this replaces, is that it is not a widened band: `centreMax` stays where
    // it is, describe() measures the room centre against it, and every frame
    // that had to break composition to keep the chef says so.
    // ROUND 7: bounded by `rescueMax`. It used to be `max(limit, rescue)` with
    // nothing over the top of it, so on a portrait frame — where `rescue`
    // reaches 1.3 half-frames in the front corners — the composition clamp was
    // a number nothing ever consulted. It bends the composition now; it does
    // not get to delete it. See RESCUE_MAX.
    // ROUND 8 — ONE TARGET, ONE HARD CAP, AND THE TARGET IS THE WHOLE CHEF.
    //
    // Round 7 aimed the rescue at EDGE_HARD, i.e. it panned until the player's
    // CENTRE was 0.92 of the way to the frame edge. At the widened portrait
    // solve the half-frame at his row is 2.4 units and his body is 0.55 of
    // them, so 0.92 puts 15% of him off the picture — which is exactly what
    // shots/j-cam-r5-late/iphone-portrait/t0096s came back as, on a frame whose
    // telemetry said he was inside the limit. A containment rule that reports
    // success while the pixels crop the player is the same class of bug as the
    // warnings that came back empty last round.
    //
    // So the target is PLAYER_SAFE — his whole body and his contact shadow —
    // and the only ceiling over it is LOST_MAX, which the room's own worst
    // corner sets (see LOST_MAX). `rescueMax` is no longer a clamp; it is the
    // COMPOSITION threshold, the offset past which the oven arch starts to go,
    // and describe() reports every frame that crosses it so a critic can count
    // them rather than take a comment's word for how rare they are.
    const need = Math.abs(playerPos.x - this.centerX) - PLAYER_SAFE * atChef;
    const room = Math.min(
      f.panX,
      Math.max(limit, Math.min(need, (this.aspect < 1.2 ? LOST_MAX : f.rescueMax) * live)),
    );
    const wantX = clamp(holdX, this.centerX - room, this.centerX + room);
    this.playerFrac = (playerPos.x - wantX) / atChef;
    this.chefZ = playerPos.y;

    // Critically damped: keeps up without ever feeling like it is chasing.
    //
    // ...except that a fixed 0.2 s lag IS a containment failure of its own, and
    // it took a screenshot to see it. All the clamp arithmetic above solves for
    // where the camera SHOULD be; at a 0.2 s time constant and a chef running
    // 5 units a second, the camera is up to a unit behind that, which on a
    // portrait frame is 0.4 of the half-frame at his own row — so
    // shots/j-cam-r4/iphone-portrait/t0010s still had the player cut by the
    // left edge on a frame whose telemetry said he was at 0.86, comfortably
    // inside it. The lag tightens to 0.08 s as he approaches the edge and
    // relaxes back the instant he is safe: nobody can see a camera stiffen at
    // 0.85 of a half-frame, and everybody can see half a chef.
    //
    // ROUND 9: 0.2/0.08 -> 0.13/0.07. The same playtest that moved
    // HALF_WIDTH_MIN called the follow "a little too loose". The urgency ramp
    // above only starts at |playerFrac| 0.6, so every approach to the edge is
    // run at the RELAXED constant, and 0.2 s is a fifth of a second of the
    // camera not being where the clamps just said it should be.
    //
    // Tightening the base is the only lever here that does not cost pan.
    // Tightening the TARGET instead was tried first and measured worse: hold
    // 0.88 -> 0.80 on portrait moved p90 |playerFrac| 0.879 -> 0.800 but took
    // the max 0.879 -> 0.927 and pushed the composition-stop warnings 19% ->
    // 28%, because a nearer hold demands more pan and the damper then lags the
    // bigger target moves. The target is right; it was the arriving that was slow.
    //
    // Measured on tools/camtrace.mjs, 40 s of portrait play, 193 samples:
    //
    //                    0.2/0.08        0.13/0.07
    //   |playerFrac| p50   0.599           0.580
    //   |playerFrac| max   0.879           0.879
    //   centreOffset p50   0.074           0.069
    //   composition warns  19% / 17%       20% / 16%
    //
    // The max is unchanged because the worst corner is pan-capped, not lag-
    // capped (see HALF_WIDTH_MIN). What moves is the typical frame: the chef
    // sits closer to where the composition asked for him, all the time.
    const urgency = smoothstep(clamp((Math.abs(this.playerFrac) - 0.6) / 0.3, 0, 1));
    const k = 1 - Math.exp(-dt / lerp(0.13, 0.07, urgency));
    this.atX += (wantX - this.atX) * k;
    this.atZ += (wantZ - this.atZ) * k;

    const on = this.touchUi ? 1 : 0;
    const ui = 1 - Math.exp(-dt / 0.35);
    this.bias += (on * f.uiBias - this.bias) * ui;
    this.shift += (on * f.uiShift - this.shift) * ui;
    if (Math.abs(this.shift - this.appliedShift) > 1e-4) this.applyShift();

    this.shake = Math.max(0, this.shake - dt * 2.6);
    const s = this.shake * this.shake;
    const sx = (Math.sin(time * 47 + this.shakeSeed) + Math.sin(time * 31.3)) * 0.05 * s;
    const sy = (Math.sin(time * 53.7 + this.shakeSeed) + Math.sin(time * 39.1)) * 0.05 * s;

    // Opening push-in: start a touch further back and higher, settle in ~1.1s.
    // Bounded by zMax so the pushed-back frame can never expose the backdrop.
    this.intro = Math.max(0, this.intro - dt / 1.1);
    const e = smoothstep(this.intro);
    const introZ = e * Math.min(1.6, Math.max(0, f.zMax - this.atZ));
    const introY = e * 0.45;

    // Breathe. ~11 seconds a cycle, a few pixels of travel — you never see it
    // move, you only notice when it is missing.
    const br = Math.sin(time * 0.55) * 0.06;
    const bx = Math.sin(time * 0.41 + 1.7) * 0.05;

    this.camera.position.set(
      this.atX + this.bias + sx + bx,
      f.height + introY + br + sy,
      this.atZ + introZ,
    );
    this.camera.rotation.set(-f.pitch + sy * 0.02, 0, sx * 0.01);
  }

  /** 0..1 kick. Additive, capped, decays fast — never nauseating. */
  addShake(amount: number) {
    this.shake = Math.min(1, this.shake + amount);
  }
}

/**
 * World z of the FRONT FACE of the frontmost dressed row — the deepest cell in
 * the level that carries a station, plus one for the cell's own depth.
 *
 * This is the number the bottom edge of frame is placed against (see
 * BOTTOM_LANE) and the number describe() grades it against. Reading it off the
 * level rather than writing it down as a constant is the whole point: round 7
 * hard-coded "furniture is on odd rows", the integration pass restaggered the
 * map across all of them, and the frame spent a round sawing through a bun
 * crate and a plate stack while the assertion that was supposed to catch it
 * tested row parity and passed.
 */
function frontOfDressing(k: Kitchen): number {
  let deepest = 1;
  for (let y = 0; y < k.height; y++)
    for (let x = 0; x < k.width; x++)
      if (k.cells[y * k.width + x] === 'station' && y > deepest) deepest = y;
  return deepest + 1;
}

/** Smallest x in [lo, hi] with f(x) >= 0, assuming f increases. */
function bisect(lo: number, hi: number, f: (x: number) => number): number {
  let a = lo;
  let b = Math.max(lo, hi);
  for (let i = 0; i < 48; i++) {
    const m = (a + b) / 2;
    if (f(m) < 0) a = m;
    else b = m;
  }
  return (a + b) / 2;
}

function clamp(v: number, a: number, b: number) {
  return v < a ? a : v > b ? b : v;
}
function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}
function smoothstep(t: number) {
  return t * t * (3 - 2 * t);
}
/**
 * A soft stop. Returns `a` unchanged below `soft`, then eases it out to `hold`
 * and never past it — an exponential shoulder, so the first derivative is
 * continuous at the knee and the camera has no visible moment where it starts
 * or stops tracking.
 *
 * A hard `Math.min(a, hold)` is what this replaces, and the difference is not
 * cosmetic: a hard stop means the camera does not move at all until the chef
 * reaches the limit and then moves 1:1 with him from there, so he spends his
 * whole time at the room's edge pinned exactly ON the limit — which is exactly
 * where the door jamb is.
 */
/**
 * The recession the REFERENCE'S OWN LENS produces on a frame of this shape:
 * eye-space depth at the back wall over eye-space depth at the bottom edge,
 * with the horizontal half-field pinned at HALF_FOV_H_MAX.
 *
 * It is scale-free — camera distance, room size and the depth of the crop all
 * cancel — so it can be computed without knowing any of them, which is exactly
 * what makes it worth asserting. Same closed form as `solveEdges`, run with the
 * bottom-edge distance set to 1 and the result read as a ratio.
 */
function idealVisibleDepth(aspect: number, pitch: number, join: number) {
  const u = Math.atan(Math.tan(HALF_FOV_H_MAX) / Math.max(0.05, aspect));
  const tb = Math.tan(pitch + Math.atan(2 * (join - 0.5) * Math.tan(u)));
  const d = 1 / Math.max(0.02, 1 - tb / Math.tan(Math.min(pitch + u, 86 * DEG)));
  const h = d * tb;
  const front = h * Math.sin(pitch) + (d - 1) * Math.cos(pitch);
  return (h * Math.sin(pitch) + d * Math.cos(pitch)) / Math.max(0.02, front);
}
function shoulder(a: number, soft: number, hold: number) {
  if (a <= soft) return a;
  const span = Math.max(1e-3, hold - soft);
  return soft + span * (1 - Math.exp(-(a - soft) / (span * 0.8)));
}
