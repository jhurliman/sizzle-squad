/**
 * Pure domain types. NOTHING in src/domain may import three.js, touch the DOM,
 * or read wall-clock time. The sim is deterministic: same seed + same input
 * stream => same state. This is what makes the game testable and replayable.
 */

// ---------------------------------------------------------------- primitives

export interface Vec2 {
  x: number;
  y: number;
}

export const v2 = (x = 0, y = 0): Vec2 => ({ x, y });

// ---------------------------------------------------------------- ingredients

/** Every raw material that can exist in the kitchen. */
export type IngredientKind =
  | 'tomato'
  | 'lettuce'
  | 'bacon'
  | 'bun'
  | 'cheese'
  | 'potato'
  | 'onion'
  | 'egg'
  | 'rice'
  | 'fish';

/**
 * Processing state. An ingredient advances RAW -> PREPPED -> COOKED and can
 * overshoot to BURNT. Not every ingredient supports every state; see
 * INGREDIENT_DEFS.
 */
export type PrepState = 'raw' | 'prepped' | 'cooked' | 'burnt';

export interface IngredientDef {
  kind: IngredientKind;
  label: string;
  /** Seconds of chopping to go raw -> prepped. 0 = cannot be chopped. */
  chopSeconds: number;
  /** Seconds on heat to go prepped(or raw) -> cooked. 0 = cannot be cooked. */
  cookSeconds: number;
  /** Extra seconds after `cooked` before it burns. Infinity = never burns. */
  burnSeconds: number;
  /** Tint used by the view layer + HUD tickets. Kept in domain so both agree. */
  color: number;
}

export interface Ingredient {
  id: number;
  kind: IngredientKind;
  state: PrepState;
  /** Progress into the current transformation, 0..1. */
  progress: number;
  /** Seconds spent in `cooked` state on a heat source. Drives burning. */
  overcook: number;
  /**
   * Chopping progress, 0..1, carried by the FOOD rather than by the board.
   * A half-cut tomato lifted off a board and put back down is still half cut —
   * a mis-press costs the walk, never the work.
   */
  chop?: number;
}

// ---------------------------------------------------------------- containers

/**
 * A plate holds up to PLATE_CAPACITY ingredients. Orders are matched against
 * the multiset of (kind, state) pairs on the plate, order-independent.
 */
export interface Plate {
  id: number;
  contents: Ingredient[];
  dirty: boolean;
  /** True if a bot did any of the plating — the port pays bot-assembled
   * dishes at a reduced rate for leaderboard integrity (DirectorKnobs). */
  botMade?: boolean;
}

/** Anything a chef can be carrying in their single hand slot. */
export type Carryable =
  | { type: 'ingredient'; ingredient: Ingredient }
  | { type: 'plate'; plate: Plate }
  | { type: 'pan'; pan: Pan };

export interface Pan {
  id: number;
  contents: Ingredient[];
  /** True while sitting on a lit burner. */
  onHeat: boolean;
  /** 0..1, rises while burnt contents sit on heat. At 1 the pan catches fire. */
  fire: number;
}

// ---------------------------------------------------------------- stations

export type StationKind =
  | 'crate' // infinite source of one ingredient
  | 'counter' // free surface, can hold anything
  | 'board' // chopping board
  | 'stove' // burner, holds a pan
  | 'plates' // clean plate dispenser
  | 'serve' // order window
  | 'bin' // trash
  | 'sink'; // wash dirty plates

export interface Station {
  id: number;
  kind: StationKind;
  /** Grid cell the station occupies. Chefs stand on an adjacent walkable cell. */
  cell: Vec2;
  /** Which way the station faces; chefs interact from this side. */
  facing: Vec2;
  /** For crates: what it dispenses. */
  dispenses?: IngredientKind;
  /** What is currently resting on the station. */
  holding: Carryable | null;
  /** Generic 0..1 work progress (chopping, washing). */
  work: number;
  /**
   * WHAT THE PAN IS DOING, PUBLISHED FOR THE PLAYER TO SEE.
   *
   * `cook` is 0..1 toward done for the least-finished thing in the pan; `burn`
   * is 0..1 from the moment it finishes toward catching fire. Both are mirrored
   * off the pan every tick because the ingredient's own counters
   * (`progress`, `overcook`) are per-item and in different units, and the view
   * needs one number per station it can draw an arc from.
   *
   * These exist because of a direct report: "chopping and cooking need progress
   * rings or bars or something, I have no idea when the food is about to burn
   * or how long I have left chopping." Chopping had a ring and it lay flat on
   * the bench where a 22.5-degree camera turns it into a sliver. Cooking had
   * nothing at all — the only tell that bacon was about to burn was the bacon
   * burning.
   */
  cook: number;
  burn: number;
  /** True while a chef is actively working this station this tick. */
  active: boolean;
}

// ---------------------------------------------------------------- orders

export interface RecipeComponent {
  kind: IngredientKind;
  state: PrepState;
}

export interface Recipe {
  id: string;
  name: string;
  components: RecipeComponent[];
  /** Base seconds allowed before the ticket expires. Scaled by difficulty. */
  baseSeconds: number;
  /** Base coin value. */
  baseValue: number;
}

export interface Order {
  id: number;
  recipe: Recipe;
  /** Seconds remaining. */
  remaining: number;
  /** Seconds the ticket started with, for the HUD gauge. */
  total: number;
  /** Monotonic tick the order was created, used for stable HUD ordering. */
  createdTick: number;
}

// ---------------------------------------------------------------- chefs

export type ChefIntentKind =
  | 'idle'
  | 'moving'
  | 'working' // holding the action button on a station
  | 'stunned';

export interface Chef {
  id: number;
  /** True for the human-controlled chef. */
  isPlayer: boolean;
  skin: string;
  pos: Vec2;
  vel: Vec2;
  /** Radians. Characters turn toward movement, not snap. */
  heading: number;
  carrying: Carryable | null;
  intent: ChefIntentKind;
  /** Station currently in interaction range and facing, or null. */
  focus: number | null;
  /**
   * THE STATION THIS CHEF HAS COMMITTED TO WORKING, OR NULL.
   *
   * Chopping used to be a HOLD: press and keep pressing, let go and it stops.
   * That is the genre convention and it is undiscoverable — reported from play
   * as "hold to chop is not discoverable", by someone who had already been told
   * the controls. A tap is the only gesture a player will find on their own.
   *
   * So a tap COMMITS: the chef stays on the job until it finishes, and the sim
   * has to remember which job that was, because the button is no longer held
   * down to tell it. Movement is ignored while this is set — that is the
   * "locks you into that action" half, and it is also what makes the commitment
   * legible without any UI: the chef visibly will not walk away.
   */
  working: number | null;
  /**
   * WHAT THE BUTTON WOULD DO IF IT WERE PRESSED THIS FRAME — 'take', 'place',
   * 'combine', 'serve', 'return', 'swap', 'discard', 'dispense', or 'none'.
   *
   * The focus glow tells the player WHICH bench; nothing told them WHAT. This
   * is the sim's answer, recomputed every tick alongside `focus` from the same
   * plan `doGrab` executes, so a prompt built on it can never disagree with the
   * press. Typed as a string so the view can read it without importing sim.ts.
   */
  focusAction: string;
  /**
   * SECONDS OF LIFE LEFT IN THE LAST GRAB PRESS.
   *
   * A press used to be consumed by the single tick it arrived on: measured with
   * tools/critic_station.mjs rig 1, a press that landed ONE 17ms tick before the
   * station became focusable produced nothing 100% of the time, and rig 5's
   * human-timing model (press on arrival rather than on confirmation) landed
   * 6.8% of presses 50ms early against 100% at 0ms. The window opened on a cliff
   * exactly one frame wide. This carries the press forward until it can be
   * answered. It does NOT decay while stunned — see `step`.
   */
  grabBuffer: number;
  /**
   * COYOTE TIME FOR THE FOCUS GATE — seconds the previous station may still be
   * returned after the gate stops accepting it.
   *
   * `focusStick`/`focusKeepReach` only ever helped an incumbent that still
   * passed the gate; nothing held a focus that had just fallen out of it, so a
   * chef standing at a bench blinked focus off and on 2.04 times a second
   * (critic_station rig 4) and every press inside a blink was destroyed.
   */
  focusHold: number;
  /** Seconds remaining of a stun (bumped, slipped). */
  stun: number;
  /** Cosmetic 0..1 that the view uses for squash/stretch and dust. */
  effort: number;
}

/** One frame of intent from a human, a bot, or a replay. */
export interface InputSnapshot {
  /** Movement axis, magnitude clamped to 1. */
  move: Vec2;
  /** Rising edge of the primary action (pick up / put down / throw). */
  grabPressed: boolean;
  /** Held state of the secondary action (chop / wash / plate). */
  useHeld: boolean;
}

export const NO_INPUT: InputSnapshot = {
  move: { x: 0, y: 0 },
  grabPressed: false,
  useHeld: false,
};

// ---------------------------------------------------------------- kitchen

export type CellKind = 'floor' | 'blocked' | 'station';

export interface Kitchen {
  width: number;
  height: number;
  /** row-major, length = width*height */
  cells: CellKind[];
  stations: Station[];
  /** Cell -> station id, -1 for none. */
  stationAt: number[];
}

// ---------------------------------------------------------------- events

/**
 * The sim emits events instead of calling into the view or audio directly.
 * This keeps the sim pure and lets VFX/SFX/haptics all subscribe to one
 * truthful stream.
 */
export type SimEvent =
  | { t: 'pickup'; chef: number; at: Vec2 }
  | { t: 'place'; chef: number; at: Vec2 }
  | { t: 'chopTick'; at: Vec2; progress: number }
  | { t: 'chopDone'; at: Vec2; kind: IngredientKind }
  | { t: 'cookDone'; at: Vec2; kind: IngredientKind }
  | { t: 'burn'; at: Vec2 }
  | { t: 'fireStart'; at: Vec2 }
  | { t: 'serve'; at: Vec2; value: number; combo: number; orderId: number }
  | { t: 'serveWrong'; at: Vec2 }
  /**
   * A grab press that expired without ever finding something to do — the player
   * pressed at a bench that could not answer, or at nothing at all. Emitted when
   * the input buffer runs out, not when the press arrives, so a press that is
   * merely EARLY still resolves as the pickup it was meant to be. Before this
   * existed a refused press emitted no events whatsoever, which made a mistimed
   * input and a dropped input the same thing to the player.
   */
  | { t: 'grabMiss'; chef: number; at: Vec2 }
  | { t: 'orderNew'; orderId: number }
  | { t: 'orderExpired'; orderId: number }
  | { t: 'trash'; at: Vec2 }
  | { t: 'washDone'; at: Vec2 }
  | { t: 'bump'; a: number; b: number; at: Vec2 }
  /**
   * A chef ran into geometry hard enough to lose real speed. `speed` is what
   * was travelling along the blocked axis at the moment it was zeroed, so
   * audio and vfx can scale the response instead of playing one fixed knock.
   */
  | { t: 'wallHit'; chef: number; at: Vec2; speed: number }
  | { t: 'footstep'; chef: number; at: Vec2 }
  | { t: 'gameOver'; score: number };

// ---------------------------------------------------------------- scoring

export interface ScoreState {
  coins: number;
  /** Consecutive on-time serves. Resets on expiry or wrong serve. */
  combo: number;
  bestCombo: number;
  served: number;
  missed: number;
  /** 0..1 patience meter; hits 0 => run over. */
  patience: number;
}
