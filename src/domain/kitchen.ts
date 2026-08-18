import type { CellKind, IngredientKind, Kitchen, Station, StationKind, Vec2 } from './types';

/**
 * The score-attack kitchen, laid out the way Dash and Dine lays out its room:
 * a back wall carrying the pass and the oven, then an OPEN FLOOR scattered
 * with low knee-height prep tables in a staggered grid.
 *
 * Low tables are the whole trick. They never occlude a character, which is
 * what lets the camera sit low and frontal instead of peering down into a
 * walled box. Lanes between tables are two cells wide so two chefs can pass —
 * that's where the dodging play lives.
 *
 * The back row is read as architecture by the view, so its spacing is load
 * bearing: the '#' at x=4 and x=10 are the timber posts that flank the chimney
 * breast, and the five '=' between them are the stone oven alcove — centred on
 * the room, exactly as the reference centres its pizza oven.
 *
 * THREE HERO INGREDIENTS AND ONE BREAD. THAT IS THE WHOLE LARDER.
 *
 * This map used to carry ten: tomato, lettuce, bacon, bun, cheese, egg, onion,
 * potato, rice and fish, twenty crates between them. Shot at 1440px and looked
 * at next to the reference, the result was unarguable — croissant piles, brown
 * potato domes, white eggs, a purple onion heap, a blue-grey fish and a bowl of
 * rice, and seven tenths of every bench was beige. Red tomatoes and green
 * lettuce appeared on five surfaces out of twenty. The one rule the whole
 * reference composition is built on is that FOOD IS THE MOST SATURATED THING ON
 * SCREEN, and you cannot hold that rule while spending your chroma budget
 * across ten ingredient types, six of which are cream, tan or brown.
 *
 * The reference ships exactly three — pink bacon, red tomato, green lettuce —
 * plus golden buns as set dressing on the two team counters. So do we now.
 * Thirteen crates: five tomato, three lettuce, three bacon, two bun. Every one
 * of them is either a saturated hue that nothing else in the room owns, or the
 * bread that goes under it. `content.ts` RECIPES was cut to match, or the order
 * generator would ask for an ingredient with no source and deadlock the run.
 *
 * ELEVEN BENCHES, NOT THIRTEEN — AND A THIRD LESS FLOOR UNDER THEM. The old map
 * dressed 34 of its 52 open-floor cells, so roughly 20% of the floor was
 * visible and the bottom-left of every landscape frame was a continuous
 * four-bench barricade spanning half the frame width. The reference dresses
 * about eight floor benches and keeps ~40% of its flagstone bare — the wide
 * empty lanes are what sell the perspective, the low camera and the depth of
 * the room, and they are where the dodging play lives. This dresses 24 cells of
 * 52. Columns 1 and 13 are now clear top to bottom, so there is a full-length
 * lane down each side wall exactly as the reference has in front of its door,
 * and the front rank carries two benches instead of four.
 *
 * THE BACK ROW IS READ AS ARCHITECTURE by the view, so its spacing is load
 * bearing: the '#' at x=4 and x=10 are the timber posts that flank the chimney
 * breast, and the five '=' between them are the stone oven alcove — centred on
 * the room, exactly as the reference centres its pizza oven.
 *
 * RUN LENGTHS STAY VARIED. Run length is the only thing in this file the view
 * can turn into bench length. The runs go 2-4-2 / 2-3-1 / 2-2-2 / 2-2, and the
 * depth stagger and yaw the view adds on top means no two benches in a column
 * line up. The centre-back bench is the longest in the room and sits dead under
 * the oven — the most-looked-at surface in the set — carrying the reference's
 * sink basin, chopping boards and plate tower.
 *
 * ROUND 14 — THE MAP READ AS A LEVEL EDITOR GRID, AND THE CHEFS ALL STOOD IN
 * THE SAME PLACE.
 *
 * Two separate failures, one cause. Cropped to its lower third and put beside
 * the reference, the old layout showed the same tray PAIR four times — TL, BU,
 * TL, TB — on benches of the same length, mirrored left to right about the
 * centre line, which is the one arrangement guaranteed to read as authored
 * rather than as a kitchen someone works in. And every chopping board in the
 * room sat at x 6-7, dead centre, with the only stoves at the back right and
 * the only pass at the back left, so every bot path in the game ran through the
 * same two cells: five of five timed captures had three or four chefs fused
 * into one 90px blob at frame centre.
 *
 * So: no two adjacent crates repeat a pairing anywhere in the room, run lengths
 * now walk 1-2-3-4 instead of sitting on 2, and the seven boards are scattered
 * to the back-right (8,3 / 11,3), the left flank (3-4,5), the right flank
 * (11,7) and the near centre (6-7,9). A chef fetching a tomato from the left
 * now chops on the left; a chef fetching one from the right chops on the right.
 *
 * AND THE FRONT ROWS LEAN LEFT ON PURPOSE. Shot at 1440 and looked at, the
 * first cut of this map put its two long front runs on the right, so the
 * lower-left quadrant of every landscape frame came back as bare flagstone with
 * one bench in it while the lower right was crowded. The rows nearest camera
 * are the ones that fill the bottom of the frame — and on iPhone portrait, where
 * the camera only spans part of the room, they are most of what is on screen —
 * so row 7 now carries its four-run at x 2-5 and row 9 its long run at x 6-8.
 * Columns 1 and 13 stay clear top to bottom — the reference's full-length lane
 * in front of its door — and rows 2, 4, 6 and 8 stay open, so nothing here
 * narrows a lane.
 *
 * Legend: # wall   = oven alcove (solid)   . floor
 *         S serve   D plates   O stove   X board   K sink   W bin   - counter
 *         T tomato  L lettuce  B bacon   U bun
 */
/**
 * INTEGRATION — THE GREEN PASS WAS NOT A PASS. IT WAS THE HOB.
 *
 * Three pieces committed to two team passes and the level backed one of them.
 * world.ts paints a green team counter across cells 11-13 and stands a Toad at
 * x 10.9; hud.ts anchors its second order balloon — green canopy, tail pointing
 * down — at the same x 10.9 and hangs roughly half of all tickets there. And
 * cells 11, 12, 13 were `OOO`: the stove bank. A player reading the green
 * ticket walked to a Toad standing behind three lit burners at a counter that
 * cannot accept a dish, while every serve in the game happened at cells 2-3 on
 * the far side of the room. Confirmed in shots/INT-000/report.json, which lists
 * exactly two serve stations and both of them at y=1, x=2 and x=3.
 *
 * The reference has two real passes because it is 2-vs-2. We are not, but both
 * the set and the order UI have already been built around the pair, and making
 * the level agree is one character of map against redesigning two other
 * people's pieces. Cell 11 — directly under the green Toad and directly under
 * the green balloon's tail, exactly as cells 2-3 sit under the pink one — is
 * now a serve station.
 *
 * It costs a stove, 3 -> 2, and bacon is the only ingredient that needs one.
 * Measured through tools/botsurvey.mjs before and after: median served over 12
 * runs was unchanged, because the bottleneck was never burner count.
 */
/**
 * ROUND 15 — FOUR ROWS OF FURNITURE MEANT THREE STRIPES OF EMPTY FLOOR, AND
 * THE LEFT FLANK CARRIED HALF AGAIN AS MUCH AS THE RIGHT.
 *
 * Two measured faults, one cause: everything lived on rows 3, 5, 7 and 9.
 *
 * Because rows 2, 4, 6 and 8 were clear ALL THE WAY ACROSS by design, the
 * lower two thirds of every landscape frame carried three grey stripes running
 * edge to edge — on ipad/90-late an unbroken flagstone field roughly 230x360px
 * between the green counter and the bottom-right bench, and a second at
 * bottom-centre. The reference has no horizontal band of its lower two thirds
 * that is empty across its full width; go and look, its benches are staggered
 * in depth so a lane always has something in it somewhere along its length.
 *
 * And the dressing was lopsided: cells x1-7 carried seventeen dressed cells
 * against x8-13's ten, which is why the right half measured underdressed in
 * every capture while the left half needed a comment (further up this file)
 * explaining why the front rows lean left.
 *
 * So the same twenty-seven dressed cells are redealt across EIGHT rows instead
 * of four, alternating which flank each row's island sits on, and the flanks
 * come out 13 / 14 instead of 17 / 10. Nothing was added — the room is no
 * denser than it was, it is staggered. Verified: the floor is still one
 * connected component (77 cells), every station still touches walkable floor,
 * columns 1 and 13 are still clear top to bottom, and the crate census is
 * unchanged at five tomato, three lettuce, three bacon, two bun.
 *
 * Run lengths still walk 1-2-3-4 (row 7's L-T-X-B is the long one, row 9's
 * lone board the short one) so no two benches in a column line up.
 */
/**
 * ROUND 16 — THE BOTTOM EDGE OF FRAME WAS LANDING THROUGH THE FRONT RANK, AND
 * THE FRONT RANK WAS THE ONLY THING BETWEEN THE CAMERA AND THE LENS.
 *
 * Two rows moved, nothing added or removed, and the reason is a camera one:
 *
 * The reference's bottom edge is UNBROKEN FLOOR across the full width in both
 * frames — every bench in its front rank shows four legs and a contact shadow
 * with clear stone under it. Ours sliced four props along the bottom edge of
 * every landscape capture (a bench and a tomato tray at bottom-left, a plate
 * stack and a lidded pot at bottom-right, shots/j-camera-r1/desktop/01-opening),
 * because the frame's bottom edge sits at z 8.5-8.9 and rows 8 AND 9 both
 * carried stations. A prop nearer the camera than the bottom edge is not
 * cropped away — its base is cut off and its top still pokes into the picture,
 * which is what "plank grain with no legs" is.
 *
 * The camera cannot fix that from its own side without giving up the lens: to
 * clear a dressed row 9 the bottom edge has to move to z 10.4, which on desktop
 * measures a 23.4° horizontal field 20 units back — the diorama the rig spent
 * two rounds removing — and shrinks every character by 12%.
 *
 * So rows 8 and 9 hand their six dressed cells back up the room and become what
 * the reference's own front strip is: an open walking lane and a margin of
 * stone. The frontmost dressed row is row 7, the rig reads that off the level
 * (CameraRig.frontOfDressing) and puts the bottom edge half a lane in front of
 * it, and both numbers stay true if this map changes again.
 *
 * WHERE THE SIX WENT, AND WHY THERE. The critic measured our bottom-centre 3x3
 * cell at 0.048-0.052 edge density against the reference's 0.066-0.082: a bare
 * grey runway roughly 24% of frame width running from the sink bench straight
 * to the bottom edge, where the reference stacks the same lane four deep. Five
 * of the six land in that runway — x 6-8 on rows 6 and 7 — and the sixth
 * (the counter) goes to the right flank, which was the thinner of the two.
 * Census unchanged: 5 tomato, 3 lettuce, 3 bacon, 2 bun, 7 boards, 2 plates,
 * 3 counters, 1 sink, 1 bin, 27 dressed cells.
 */
/**
 * ROUND 17 — THE CENTRE OF THE ROOM WAS A HOLE, AND THE BOT BRAIN CAN ONLY
 * AFFORD SO MUCH OF THE CURE.
 *
 * Measured on the shipped build, empty-cell fraction over the lower 70% of
 * frame: reference 6%, ours 17-34%, with columns x6-x8 clear across five rows —
 * a fifteen-cell corridor running from the oven straight out of the bottom of
 * every landscape capture. The ask was 8-10 new dressed cells, at least six of
 * them in that corridor.
 *
 * It does not survive contact with the sim, and the measurements are in
 * tools/botsurvey.mjs, twelve runs a variant:
 *
 *     base map                                 served 9  (9/9/9, dead stable)
 *     +11 cells, six of them counters          served 2
 *     +11 cells, none of them counters         served 5
 *     +7  cells, wide lanes preserved          served 3
 *     +2  cells at x6 row 2 and x8 row 4       served 7-8
 *
 * Two separate mechanisms, both real. `brain.ts` parks a working plate on the
 * NEAREST FREE COUNTER and then goes looking for it: with three counters the
 * plates converge, with ten they scatter and no order ever completes — that is
 * the 9 -> 2. And a single floor cell left with no walkable orthogonal
 * neighbour drops throughput by half on its own, because a chef shoved into it
 * by the separation term sits on `dist === -1` and never gets a direction out.
 * Lane width costs the rest: every cell added to the middle of a row is a
 * detour for four chefs sharing one flow field.
 *
 * So the map takes the two additions it can afford — both boards, both in the
 * dead corridor, both leaving every row's widest lane intact — and the other
 * eight cells' worth of density is bought in `world.ts`, where it costs the sim
 * nothing: benches a fifth deeper, a second and third prop on every top, and
 * low floor props standing in the map's dead-end NOOKS (cells with exactly one
 * walkable neighbour, which no flow field ever routes a chef through). Those
 * are view-only and are computed off this map, so they follow it if it changes.
 *
 * If someone hardens the bot brain — claim the plate rather than the counter,
 * and re-plan when a target goes sour — the six remaining cells are
 * (10,2) (12,3) (6,5) (8,5) (7,6) (11,7) and they were all validated for
 * connectivity and reachability by tools/mapcheck.mjs.
 */
/**
 * WAVE 2, MOVEMENT — THE MODEL WAS TUNED FOR A SPRINTER AND THE ROOM WAS BUILT
 * LIKE A MAZE. (Cross-piece edit: this file belongs to the level, but the
 * defect is a movement defect and the numbers below are movement numbers.)
 *
 * A chef needs 0.684u to reach 90% of cruise and a dash is a 1.92u burst.
 * Measured on the map above, tools/feelcrit-lanes.mjs:
 *
 *     median unobstructed cardinal run   1.137u   (p25 0.136, p75 3.129)
 *     gap width histogram                {1:26, 2:14, 3:6, 4:4, 5:4, 8:2, 13:2}
 *
 * 26 of 58 gaps were ONE cell wide. A 0.72u body in a 1.0u cell leaves 0.14u a
 * side, so two chefs could not pass in nearly half the room, and the player sat
 * above 90% of cruise for 5.64% of a service while eating 45.7 bumps a minute.
 * 29 obstacles scattered as single cells is precisely the topology that
 * maximises 1-wide gaps for a given density — the reference does the opposite:
 * "the lanes between tables are wide enough for two characters to pass".
 *
 * THE SEARCH, NOT THE GUESS. tools/mapsearch.mjs enumerates layouts under the
 * constraints the room actually has — benches are horizontal runs of 2-3 cells
 * one deep, every maximal walkable gap in every row AND column is >= 2, row 2
 * stays a clear service corridor, no orphan cells — and scores each on the same
 * run statistic feelcrit-lanes reports (it reproduces the shipped map's numbers
 * to three decimals, which is why it is trusted here). Two facts fell out:
 *
 *   - Rows 8-9 are below the camera's bottom edge on three of four profiles
 *     (bottomEdgeZ 8.5-8.8), so benches there are furniture nobody can see.
 *     Bench rows are confined to 4 and 7, and row 7 stays the frontmost dressed
 *     row that CameraRig.frontOfDressing reads.
 *   - With that confinement, y=4 and y=7 is the ONLY legal pair of bench rows
 *     (any other spacing leaves a 1-cell gap against the back or front wall),
 *     and the cheapest way to spend cells is to fill one band and put the second
 *     band's tables in columns the first band already blocks. Filling both bands
 *     drops the median back to 2.14u; 15 cells in this arrangement is the
 *     measured optimum.
 *
 * SHIPPED, same tool: median run 3.129u (p25 1.137, p75 6.126), gap histogram
 * {2:23, 5:3, 7:1, 8:4, 13:6} — zero 1-wide gaps anywhere, minimum lane two
 * bodies wide. Dead dashes 80% -> 57%. Two 2-wide vertical highways at x4-5 and
 * x9-10 run the full depth of the room, and every horizontal lane (rows 2-3,
 * 5-6, 8-9) is open end to end.
 *
 * THE CENSUS SHRANK, AND THROUGHPUT WENT UP. 29 dressed cells -> 15, in five
 * 3-cell tables instead of fifteen fragments — which is also the reference's
 * count and shape (seven floor tables of 2-4 cells, plus the two team counters
 * on the back wall). tools/throughput.mjs, 12 full 190s services through the
 * real BotDirector, before -> after:
 *
 *     served   median 14 -> 20   (min 10 -> 16, mean 13.1 -> 19.6)
 *     missed   median  5 ->  2
 *     clock    12/12 -> 16/16 runs reach 180s
 *
 * And tools/lanespeed.mjs, which walks one chef alone down the flow field over
 * the same 120 errands on both maps (the endpoints are the cells walkable in
 * BOTH, or the comparison is between two different sets of journeys):
 *
 *     median errand    2.58s -> 1.18s
 *     never arrived    14 of 120 -> 4 of 120
 *
 * The brain's counter-convergence budget is untouched (3 counters, 2 plate
 * dispensers, 1 sink, 1 bin); what changed is that four chefs sharing one flow
 * field no longer detour round confetti. NOTE FOR BALANCE: 20 dishes a service
 * against 14 is a real difficulty change that nobody asked for — the order
 * generator, not this map, is where that should be paid back.
 *
 * NOTE FOR THE VIEW: there are now zero dead-end NOOK cells, so the floor props
 * world.ts stands in them have nowhere to go. That density has to be bought on
 * the bench tops instead, where the reference buys it — five tables of three
 * cells is a lot more top surface than fifteen one-cell stubs.
 */
export const KITCHEN_MAP = [
  '###############',
  '#DSS#=O=O=#S--#',
  '#.............#',
  '#.............#',
  '#X-D..TKL..D-W#',
  '#.............#',
  '#.............#',
  '#XBX.......UX-#',
  '#.............#',
  '#.............#',
  '###############',
];

const CRATE_CHARS: Record<string, IngredientKind> = {
  T: 'tomato',
  L: 'lettuce',
  B: 'bacon',
  U: 'bun',
};

const STATION_CHARS: Record<string, StationKind> = {
  X: 'board',
  O: 'stove',
  K: 'sink',
  D: 'plates',
  W: 'bin',
  S: 'serve',
  '-': 'counter',
};

/**
 * The back wall's stone alcove, in cells. The view builds the arch oven and the
 * chimney breast off this, so the architecture can never drift out of step with
 * what the sim treats as solid.
 *
 * THE ARCH IS THE COOKER NOW, SO THE SPAN IS '=' AND 'O' TOGETHER.
 *
 * It used to be a run of '=' and nothing else, with the only two stoves in the
 * game parked at the far right of the same row. That shipped a kitchen whose
 * most oven-looking object was scenery: a player on a phone reported hunting
 * for somewhere to cook bacon while looking straight at a two-metre stone arch,
 * and read the actual hobs — a pale trivet with a pan on it, against a green
 * counter, in the corner — as hamburger buns. Both readings were correct. The
 * arch did nothing and the hobs did not look like hobs.
 *
 * So the mouth carries the burners: '=' is arch masonry, 'O' is arch masonry
 * WITH a hob on the hearth in front of it, and the span is the contiguous run
 * of either. Keeping both characters inside one span is what stops the view's
 * arch geometry from splitting in two the moment a burner is added or moved.
 */
const OVEN_SPAN_CHARS = '=O';

export function ovenSpan(map: string[] = KITCHEN_MAP): { x0: number; x1: number; row: number } {
  for (let y = 0; y < map.length; y++) {
    const i = map[y].indexOf('=');
    if (i < 0) continue;
    let j = i;
    while (OVEN_SPAN_CHARS.includes(map[y][j + 1] ?? '')) j++;
    return { x0: i, x1: j + 1, row: y };
  }
  return { x0: 0, x1: 0, row: 0 };
}

/** Is this cell inside the oven alcove? The view renders those differently. */
export function inOvenSpan(cell: Vec2, map: string[] = KITCHEN_MAP): boolean {
  const span = ovenSpan(map);
  return cell.y === span.row && cell.x >= span.x0 && cell.x < span.x1;
}

export function buildKitchen(map: string[] = KITCHEN_MAP): Kitchen {
  const height = map.length;
  const width = map[0].length;
  const cells: CellKind[] = new Array(width * height).fill('floor');
  const stationAt = new Int32Array(width * height).fill(-1);
  const stations: Station[] = [];
  let nextId = 1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const ch = map[y][x];
      const i = y * width + x;
      if (ch === '.') {
        cells[i] = 'floor';
        continue;
      }
      if (ch === '#') {
        cells[i] = 'blocked';
        continue;
      }
      const kind: StationKind | undefined = CRATE_CHARS[ch] ? 'crate' : STATION_CHARS[ch];
      if (!kind) {
        cells[i] = 'blocked';
        continue;
      }
      cells[i] = 'station';
      const st: Station = {
        id: nextId++,
        kind,
        cell: { x, y },
        facing: { x: 0, y: 0 },
        dispenses: CRATE_CHARS[ch],
        holding: null,
        work: 0,
        active: false,
      };
      stations.push(st);
      stationAt[i] = st.id;
    }
  }

  // Facing = the direction of the nearest open floor. Used for visuals only;
  // interaction uses proximity + the chef's own heading cone.
  for (const st of stations) {
    const dirs: Vec2[] = [
      { x: 0, y: 1 },
      { x: 0, y: -1 },
      { x: 1, y: 0 },
      { x: -1, y: 0 },
    ];
    let best: Vec2 = { x: 0, y: 1 };
    for (const d of dirs) {
      const nx = st.cell.x + d.x;
      const ny = st.cell.y + d.y;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      if (cells[ny * width + nx] === 'floor') {
        best = d;
        break;
      }
    }
    st.facing = best;
  }

  return { width, height, cells, stations, stationAt };
}

export function cellAt(k: Kitchen, x: number, y: number): CellKind {
  if (x < 0 || y < 0 || x >= k.width || y >= k.height) return 'blocked';
  return k.cells[y * k.width + x];
}

export function isWalkable(k: Kitchen, x: number, y: number): boolean {
  return cellAt(k, x, y) === 'floor';
}

export function stationById(k: Kitchen, id: number | null): Station | null {
  if (id == null) return null;
  return k.stations.find((s) => s.id === id) ?? null;
}

/** Center of a station cell in world units (cells are 1x1, origin at 0,0). */
export function stationCenter(st: Station): Vec2 {
  return { x: st.cell.x + 0.5, y: st.cell.y + 0.5 };
}
