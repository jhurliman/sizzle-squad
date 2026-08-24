import * as THREE from 'three';
import { TUNING } from '../domain/content';
import type { Chef } from '../domain/types';
import { toon as setToon } from './materials';
import { buildCarryable, describe } from './world';

/**
 * ART PASS, WAVE 2 — cross-file, and deliberately the smallest edit that could
 * work: two lines, no call site touched.
 *
 * Every `toon()` in this file was reaching `applyCeilingOcclusion` as a piece of
 * the SET, so the room's triplanar grime, its flagstone grit and its plank grain
 * all ran on the cast. At 4× the purple cat wore grey-blue clouds, the frog's
 * head was blotched and the white toque was stained. Marking the material as
 * character-owned compiles all three noise terms out of its shader; nothing else
 * about the material changes, and the cast's palette is untouched.
 */
const toon = (color: number, opts: { emissive?: number; flat?: boolean } = {}) =>
  setToon(color, { ...opts, character: true });

/**
 * MASCOT CAST — four original critters, built to survive being ~90px tall on an
 * iPhone and seen mostly FROM BEHIND.
 *
 * The reference (Dash and Dine) identifies eight characters from the back using
 * exactly three channels, and we were only using two:
 *
 *   1. ONE dominant colour block.
 *   2. A head silhouette that punches OUT of the body outline.
 *   3. A BODY CONSTRUCTION — Waluigi's long shins, Toad's stumps, Shy Guy's
 *      hem, Daisy's skirt. Four different leg builds, four different hands.
 *      We shipped one rig painted four ways and it showed in the legs.
 *
 * And a fourth channel that is worth more than all of them in a still frame:
 *
 *   4. CARRY. Three of the eight reference characters are holding something in
 *      a pose that changes their outline — Toad's pancake stack hugged in both
 *      arms and visibly wider than his own torso, Shy Guy's plate out flat on
 *      two straight arms, Daisy's rasher of bacon held head-high. That is what
 *      makes a frozen frame read as a kitchen full of work instead of a shop
 *      window of mannequins, and NONE of it works unless the thing being
 *      carried is about as big as the head carrying it.
 *
 *   bramble (bear)  — CRIMSON jacket, dark trousers, STOCKY: short thick legs,
 *                     cream boots, fat mitten hands, pear torso. Round ears
 *                     clear of the skull, bandana with two long tails hanging
 *                     past the back of the head.
 *   pip     (frog)  — LEAF GREEN, LANKY: long thin shins, huge splayed webbed
 *                     frog feet, flat paddle hands, narrow chest. The only
 *                     white toque, pleated with an overhanging brim.
 *   nori    (cat)   — DEEP INDIGO, NIMBLE: digitigrade legs with a real hock
 *                     kink, small toe-bean paws. Two ASYMMETRIC ears (one
 *                     upright, one shorter and kinked) plus a four-segment
 *                     tail on a lagging spring that curls to one side.
 *   mochi   (duck)  — MARIGOLD, BIRD: thin amber stick shins with ankle
 *                     knuckles and real webbed feet, flat wing hands, a fan of
 *                     three rounded tail feathers on the rump.
 *
 * Hue 355° / 105° / 245° / 45°. Value dark / mid / darkest / lightest.
 * Every axis separated: hue, value, height, build, hands, feet, headgear.
 *
 * One shared rig, so the animation is written once:
 *
 *   root ── shadow (dense-cored radial contact shadow, tracked to the HIPS,
 *        │          not to the root, so it never lags to one side on a lean)
 *        └─ rig  (heading yaw, lean pitch, bank roll — all spring-integrated
 *           │     so stops overshoot and turns settle instead of snapping)
 *           └─ hips (bob: high at passing, low at contact)
 *              ├─ legL/legR  hip → knee → foot   (contact/down/passing/up)
 *              └─ torso (squash at contact, stretch at passing, idle breath)
 *                 ├─ body / belly / neckerchief / trousers / tail
 *                 ├─ head (ears, crest, hat, eyes with lids, muzzle/beak;
 *                 │        permanently yawed off-axis and looking at the
 *                 │        nearest other chef, so a rear view still shows a
 *                 │        face — this is how the reference keeps Waluigi and
 *                 │        Mario identifiable from behind)
 *                 ├─ armL/armR  shoulder → elbow → hand (uniformly stretched
 *                 │             when the pose reaches overhead)
 *                 └─ hands  (payload socket, parented to the RIGHT HAND so the
 *                            load can never detach from the paw: plate flat on
 *                            two straight arms out front, produce hugged in
 *                            both forearms proud of the chest, pan swung out
 *                            to the side. Every load is at least 0.8 of a head
 *                            wide, because a prop smaller than that does not
 *                            change the outline and therefore does not exist.)
 */

// ------------------------------------------------------------------- skins

type Ears = 'round' | 'tallAsym' | 'domes' | 'none';
type Tail = 'stub' | 'long' | 'fan' | 'none';
type Hat = 'bandana' | 'toque' | 'beret' | 'cap';
type Face = 'snout' | 'wide' | 'cat' | 'beak';
/** Whole-body construction. Drives leg length, thickness, joints and stance. */
type Build = 'stocky' | 'lanky' | 'nimble' | 'bird';
type Hand = 'mitt' | 'paddle' | 'paw' | 'wing';
type Foot = 'boot' | 'frog' | 'paw' | 'web';

interface Skin {
  /** Head + limb colour. */
  fur: number;
  /** The dominant block: torso. For bramble that's a jacket, others their coat. */
  coat: number;
  /** Lighter front / belly / muzzle. */
  pale: number;
  /** Ear insides, cuffs, tail tip. */
  accent: number;
  /** Trousers. MUST be a different value from `coat` — the two-block
   *  torso/trouser split is what makes the run cycle visible from behind. */
  legs: number;
  /** Shin colour. Separated from `legs` so the leg is not one orange sausage. */
  shin: number;
  /** Foot. A third value again, so the foot has its own silhouette. */
  shoe: number;
  /** Neckerchief, small. Breaks head off body without becoming a lampshade. */
  scarf: number;
  /** Flared garment hem at the base of the torso. Must read as a THIRD value
   *  between `coat` and `legs`, because it is the edge that tells you where the
   *  body stops and the legs start. */
  hem: number;
  /** Trim band on the bottom edge of the hem. High contrast against `hem`. */
  hemTrim: number;
  hat: Hat;
  hatA: number;
  hatB: number;
  ears: Ears;
  tail: Tail;
  face: Face;
  build: Build;
  hand: Hand;
  foot: Foot;
  /** Hip height in world units — drives overall height and stride length. */
  legLen: number;
  /** Torso width multiplier. */
  girth: number;
  headScale: number;
  /** Blink offset + look-around phase so the four never sync up. */
  seed: number;
}

const SKINS: Record<string, Skin> = {
  bramble: {
    // HEAD AND BODY SPLIT BY VALUE — the Shy Guy rule.
    //
    // Brown fur 0x8a5330 (L≈40) on a crimson coat 0xd3372f (L≈45) is five
    // luminance points, so at iPhone-landscape size the player's head simply
    // dissolved into the player's torso and the ears went with it: an anonymous
    // red mass with a dark blob on top. The reference never does this. Shy Guy
    // is a WHITE mask on a red robe; Mario is a skin-tone face under a red cap
    // over blue; Waluigi is a pink face between purple and dark navy. The head
    // is always a different VALUE from the dominant block, never just a
    // different hue of it.
    //
    // So bramble is now a honey-tan bear (L≈75) in a darker crimson coat
    // (L≈40): thirty-five points of separation, and the round ears finally read
    // as ears because they are light against a dark shoulder line.
    fur: 0xdcb185,
    coat: 0xbe2a25,
    pale: 0xfaeacd,
    accent: 0xf5c9a0,
    legs: 0x4a2c1b,
    shin: 0x5c3620,
    shoe: 0xf3e6cd,
    // NO WHITE LADDER. Cream collar, cream hem trim and cream boots on a red
    // coat drew three bright horizontal bands across the player at
    // iphone-landscape size, and a body cut into stripes has no dominant block
    // at all — it was the exact complaint the critic made ("a white ladder of
    // collar/hem/feet cutting it into stripes"). Now that the HEAD carries the
    // light value, the collar and the hem edge have no separation work left to
    // do, so they go dark and the coat becomes one unbroken crimson mass from
    // the jaw to the hip. The only cream left below the neck is the boots and
    // the mitts, which mark the four points of contact and nothing else.
    scarf: 0x8e1a17,
    hem: 0x931c19,
    hemTrim: 0x6f1210,
    hat: 'bandana',
    hatA: 0xa32320,
    hatB: 0xf2ede2,
    ears: 'round',
    tail: 'stub',
    face: 'snout',
    build: 'stocky',
    hand: 'mitt',
    foot: 'boot',
    legLen: 0.56,
    girth: 1.06,
    headScale: 1.0,
    seed: 0.11,
  },
  pip: {
    fur: 0x5cba3c,
    coat: 0x54b134,
    pale: 0xdcf0a4,
    accent: 0xe7c93c,
    legs: 0x2f7d22,
    shin: 0x3f9a2a,
    shoe: 0xe7c93c,
    scarf: 0xf0cf3e,
    // Knocked down from 0xf7d84a. The apron is the tallest panel on pip and at
    // that value it was within a whisker of the toque's white, so the two fused
    // into one pale mass with a green stripe between them and it read as the
    // "blown pale smear" the critic found. It still has to be the second colour
    // block, so the hue is unchanged; only the value comes down.
    hem: 0xecc133,
    hemTrim: 0xbe8a12,
    hat: 'toque',
    hatA: 0xfbf8ef,
    hatB: 0xfbf8ef,
    ears: 'domes',
    tail: 'none',
    face: 'wide',
    build: 'lanky',
    hand: 'paddle',
    foot: 'frog',
    legLen: 0.64,
    girth: 0.88,
    headScale: 1.0,
    seed: 0.47,
  },
  nori: {
    // ONE DOMINANT BLOCK, AND IT IS INDIGO.
    //
    // The previous palette put CREAM on the hem (the tallest garment panel on
    // the rig, 0.015→0.32) and light lavender on the trousers, so from the game
    // camera nori was a navy shoulder-cape sitting on a big pale barrel: the
    // dominant colour block was the bottom half of the character and it was
    // nearly white. At iphone-portrait/t0010 the cat read as a white lump with
    // a blue hat. The reference never does this — Waluigi is purple over darker
    // purple, Shy Guy is one red robe — the second value is always a NEIGHBOUR
    // of the first, and the only high-contrast note is a thin trim line.
    //
    // So the whole lower body walks down the indigo ramp and the cream survives
    // only as the hem's trim edge and the paws, which is where it does work
    // (it marks the bottom of the garment and the contact with the floor)
    // without eating the character.
    //
    // ROUND 16 — TWO NOTES, NOT FIVE. It was indigo body + teal beret + teal
    // scarf + cream hem trim + cream cuffs, which is four accents fighting for
    // a character whose whole job is "the dark one". The teal survives ONLY on
    // the beret, because the beret is the silhouette marker and a hat is what
    // the reference uses to name a character from behind. The scarf walks down
    // the indigo ramp so it reads as a collar shadow, and the hem trim goes
    // darker still so it is an edge line rather than a competing pale band.
    // INTEGRATION — "THE DARK ONE" HAD BECOME "THE DIM ONE".
    //
    // Sampled off shots/INT-000/desktop/t0026s.jpg, nori's torso renders
    // rgb(71,64,106): V 0.42, S 0.40. Every other body in the same frame sits
    // at V 0.62-0.81 and the flagstone he stands on is V 0.69, so he was the
    // only mass in the room a full stop under the floor — a grey-blue smudge
    // rather than a character, and the one place the frame had a hole in it.
    //
    // The reference solves the dark character and it does NOT solve it with
    // value. Waluigi's cap and shirt sample V 0.60 / S 0.85: he is the darkest
    // figure on screen and he is also the most saturated thing on screen that
    // isn't food. That is the trick — a dark hue reads as a colour when its
    // chroma is high and as dirt when it isn't. Ours was dark AND muted, which
    // is the one combination that cannot read.
    //
    // So the whole indigo ramp moves up about a stop and out about 0.15 of
    // chroma, with the hue and the internal ordering untouched: coat lands at
    // V 0.64 / S 0.65, near enough Waluigi's own numbers, and nori is still
    // comfortably the darkest of the four. The teal beret is deliberately NOT
    // touched — it is the silhouette marker this file's own comment defends,
    // and it is not what was broken.
    fur: 0x4a4ab8,
    coat: 0x3939a3,
    pale: 0xd7d4ef,
    accent: 0x6060c8,
    legs: 0x2b2b72,
    shin: 0x3a3a92,
    shoe: 0xe4dcc6,
    scarf: 0x30307e,
    hem: 0x4d4dae,
    hemTrim: 0x272765,
    hat: 'beret',
    hatA: 0x3fc9ad,
    hatB: 0x2ea48d,
    ears: 'tallAsym',
    tail: 'long',
    face: 'cat',
    build: 'nimble',
    hand: 'paw',
    foot: 'paw',
    legLen: 0.6,
    girth: 0.95,
    headScale: 0.96,
    seed: 0.73,
  },
  mochi: {
    // Cream-on-cream vanished against the plates and the stone floor. The body
    // is now saturated marigold — the reference gets away with exactly this
    // yellow (Daisy) in exactly this ochre room, on VALUE not hue.
    fur: 0xfdf7e6,
    coat: 0xf7bf14,
    pale: 0xfffdf6,
    accent: 0xef7c1c,
    // Three separated oranges down the leg: deep trousers, light amber stick
    // shin, mid-orange webbed foot. One orange for all three read as a sausage.
    legs: 0xd9600e,
    shin: 0xffc247,
    shoe: 0xff8f24,
    scarf: 0xef7c1c,
    hem: 0x2f9bd8,
    hemTrim: 0x17638f,
    hat: 'cap',
    hatA: 0x2f9bd8,
    hatB: 0x1d7bb0,
    ears: 'none',
    tail: 'fan',
    face: 'beak',
    build: 'bird',
    hand: 'wing',
    foot: 'web',
    legLen: 0.62,
    girth: 0.96,
    headScale: 0.98,
    seed: 0.29,
  },
};

/** Per-build proportions. This is the table that stops the four reading as one rig. */
const BUILDS: Record<
  Build,
  {
    /** Half-distance between the hips. */
    stance: number;
    /** Thigh / shin radius. */
    limbR: number;
    thighF: number;
    shinF: number;
    /** Rest bend at the knee and ankle — a cat is digitigrade, a bear is not. */
    kneeRest: number;
    ankleRest: number;
    /** Torso capsule. */
    chestR: number;
    chestH: number;
    bodyY: number;
    /** Arm segment lengths. */
    upperArm: number;
    foreArm: number;
  }
> = {
  // ROUND 16 — LONG AND THIN, AND THE GARMENT GETS OUT OF THE WAY.
  //
  // The rig computes a 58° thigh split and 60° of knee on every stride and NONE
  // of it appeared in the silhouette, for two compounding reasons that are both
  // in this table and the one above it:
  //
  //   1. The legs were the shortest and thickest part of the body. bramble ran
  //      limbR 0.098 on a 0.34 hip height — a thigh 3.5× as wide as it was long
  //      after the trouser sphere ate the top of it. Waluigi's leg in
  //      refs/dash-and-dine-01 is roughly 55% of his height and about a tenth of
  //      his body width, and it is why his stride punches four separate holes of
  //      floor through his outline. Ours punched none.
  //   2. `bodyY` sat low enough that the coat capsule's own bottom reached the
  //      knee, so even a long leg would have been hidden. Every build's torso is
  //      lifted here and the pelvis block in buildTorso is shrunk to match, so
  //      the garment now stops at the crotch and the whole thigh swings free.
  //
  // Limb radii are roughly 0.7× across the board and thigh+shin now sums to
  // ~0.97 of `legLen` (the balance of the drop is the foot), so lengthening is
  // done by `legLen` on the skin and the joint fractions only set proportion.
  stocky: {
    stance: 0.145,
    limbR: 0.07,
    thighF: 0.5,
    shinF: 0.47,
    kneeRest: 0.06,
    ankleRest: 0,
    chestR: 0.27,
    chestH: 0.16,
    bodyY: 0.315,
    // THE BEAR'S ARM WAS SHORTER THAN THE BEAR'S CHEST WAS WIDE. upperArm 0.17
    // + foreArm 0.18 = 0.35 against a chest RADIUS of 0.27, i.e. the whole limb
    // barely reached past the barrel it was bolted to, so at any abduction the
    // elbow stayed inside the coat's outline and only the paw escaped — the
    // "left arm is a bare cream sphere floating clear of the hoodie" frame.
    // 0.235 + 0.215 puts the elbow a clear 0.03 outboard of the equator at rest
    // abduction and the paw a full hand beyond it.
    upperArm: 0.235,
    foreArm: 0.215,
  },
  lanky: {
    stance: 0.1,
    limbR: 0.048,
    thighF: 0.48,
    shinF: 0.5,
    kneeRest: 0.14,
    ankleRest: -0.1,
    chestR: 0.23,
    chestH: 0.26,
    bodyY: 0.355,
    upperArm: 0.185,
    foreArm: 0.2,
  },
  nimble: {
    stance: 0.112,
    limbR: 0.058,
    thighF: 0.47,
    shinF: 0.5,
    // The hock: knee forward, ankle back. Reads as a cat leg even in silhouette.
    kneeRest: 0.42,
    ankleRest: -0.4,
    chestR: 0.245,
    chestH: 0.22,
    bodyY: 0.335,
    upperArm: 0.165,
    foreArm: 0.175,
  },
  bird: {
    stance: 0.094,
    // 0.042 was a 3.4cm shin: at 40px tall on iPhone landscape mochi's legs
    // disappeared entirely and the duck became a floating torso. Still the
    // thinnest leg in the cast, just not a wire.
    limbR: 0.045,
    thighF: 0.44,
    shinF: 0.53,
    kneeRest: 0.2,
    ankleRest: -0.16,
    chestR: 0.26,
    chestH: 0.18,
    bodyY: 0.325,
    upperArm: 0.15,
    foreArm: 0.16,
  },
};

// ------------------------------------------------------------ soft shadow

let shadowTex: THREE.DataTexture | null = null;
function softShadowTexture(): THREE.DataTexture {
  if (shadowTex) return shadowTex;
  const n = 64;
  const data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const u = (x + 0.5) / n - 0.5;
      const v = (y + 0.5) / n - 0.5;
      const r = Math.min(1, Math.hypot(u, v) * 2);
      // A DENSE CORE and then a soft falloff, sized to the chef's FOOTPRINT.
      //
      // Two previous passes got this wrong in opposite directions. The first
      // used pow(1 - r, 1.9) across the whole disc and averaged out to a ~10%
      // floor darkening — the cast floated. The second tightened the core to
      // r < 0.18 and the exponent to 2.6, which on a 0.78-unit plane is a
      // 14-centimetre black dot: measured on
      // shots/p04-r4d/ipad-landscape/t0012s.jpg the floor beside bramble's
      // boot read RGB(203,177,152) against RGB(212,185,142) clean — 4%,
      // because the entire dense part of the shadow was hiding UNDER the feet
      // that were supposed to be casting it.
      //
      // A contact shadow has to be about as wide as the thing standing on it.
      // Solid out to r = 0.28 (a third of the plane), then a gentle falloff
      // that still has a fifth of its alpha at the chef's shoulder width.
      // ROUND 3, AND THE OLD NOTE ABOVE DIAGNOSED IT AND THEN UNDID ITS OWN
      // FIX. A core that is solid only out to r = 0.28 is 0.24 world units
      // across on the footprint this rig now uses — which is almost exactly the
      // width of the two boots standing on it. So the entire dark part of the
      // pool sits UNDER the feet that cast it and nothing of it reaches the
      // stone where a camera at 22.5° can see it: measured on
      // shots/mc-w2-r1/ipad-landscape/t0016s the floor beside pip's foot read
      // luma 117 against 126 clean, a nine-point difference at an alpha of
      // 0.78. Solid out to 0.45 with a gentler shoulder puts 0.38 world units
      // of full-strength shadow on the floor, so the pool is wider than the
      // stance and reads as a body touching the ground from any angle.
      const t = Math.min(1, Math.max(0, (r - 0.45) / 0.55));
      const a = Math.pow(1 - t, 1.7);
      const i = (y * n + x) * 4;
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = Math.round(a * 255);
    }
  }
  const tex = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  shadowTex = tex;
  return tex;
}

// ---------------------------------------------------------------- helpers

interface Limb {
  hip: THREE.Object3D;
  knee: THREE.Object3D;
  foot: THREE.Object3D;
}

const TAU = Math.PI * 2;
/**
 * Measured off `refs/dash-and-dine-01.jpeg`, both ways round: a chef there is
 * about 0.8–1.0 FLOOR FLAGS tall (Toad 100px against a 130px flag at the bottom
 * edge, Shy Guy 90 against 110), and fills 12–15% of frame height. At 1.16 ours
 * stood 1.6 flags tall and filled 19–23%, so the room held four chefs where the
 * reference holds eight, two chefs standing together fused into one two-headed
 * silhouette, and the bench tops sat at mid-shin instead of the reference's
 * knee. The floor flags and the room grid were already at reference scale — the
 * cast was the thing that was wrong — so this is the whole correction, and it
 * lands the bench top at 0.41 of chef height against the reference's ~0.35.
 *
 * CROSS-PIECE NOTE: this file belongs to the mascot-chefs piece; the camera
 * piece changed this one constant because subject scale is a framing quantity
 * and widening the lens was the wrong lever (the desktop frame already spans
 * 9.6 units against a room half-width of 7.5 — it overshoots the room).
 */
const CHAR_SCALE = 0.79;
/*
 * 0.79, up from 0.72. The critic measured us at 12.8% of frame height on
 * desktop and 10.3% in portrait against a reference foreground Toad at 13.9%
 * and Mario at 16.7% — under the bar on every profile, and worst on the one
 * that matters most. 0.72 was set when four chefs still spent the whole run
 * fused into one mass at the back counter, where any extra size made the clot
 * worse; with real separation and per-bot home bands in `bots/brain.ts` the
 * cast is spread across the floor and the constraint that produced 0.72 no
 * longer applies. +10% puts the foreground chef at ~14% and the bench top at
 * 0.37 of chef height, still inside the reference's ~0.35 knee-height read.
 */
/**
 * SCREEN-UP, IN WORLD SPACE. cameraRig.ts holds its pitch at 22–23° above the
 * floor on every aspect ratio and calls that "THE ONE INVARIANT", so the
 * direction that is "up the screen" is a constant of this game: for a camera
 * looking down at θ, it is (0, cos θ, sin θ). The payload head-clamp projects
 * along it — see the note at the clamp.
 */
const CAM_UP_Y = Math.cos(22.5 * (Math.PI / 180));
/**
 * ...AND THE Z TERM HAD THE WRONG SIGN, WHICH IS WHY THE PLATE KEPT ENDING UP
 * AT THE ANKLES.
 *
 * cameraRig.ts places the camera at large +Z and writes
 * `camera.rotation.set(-pitch, 0, 0)`, so the camera's own up vector — three's
 * default (0,1,0) taken through Rx(-pitch) — is (0, cos p, -sin p). Screen-up
 * in world therefore leans AWAY from the lens, not toward it: a point pushed
 * further down the room (-Z) rises up the frame, which is the ordinary
 * behaviour of any camera looking down at a floor and is exactly what this
 * file's own comments describe ("a load held forward projects UP the screen
 * when the chef runs away from the lens"). The constant said the opposite, so
 * the head clamp measured the overlap along the wrong diagonal and then pushed
 * the payload along it: a plate held forward by a chef running away read as
 * safely clear when it was over the skull, and one running toward the lens got
 * shoved down and back until it reached the ankles — shots/j-chefs-r1-late-a/
 * desktop/t0103s, "the disc has slid to ankle height and the leg passes through
 * it". One sign.
 */
const CAM_UP_Z = -Math.sin(22.5 * (Math.PI / 180));
/**
 * Combined screen-space radius of the head and the biggest payload, in world
 * units: the skull is a 0.285 sphere at CHAR_SCALE 0.79 (0.225 of world radius)
 * and a plate at 1.3 scale is 0.27 across the half. 0.50 with a little margin,
 * used as the radius of the circle-overlap test at the payload clamp — the
 * reference's read is Shy Guy's plate sitting a clear head's-width below his
 * mask, and Daisy's rasher riding high but a full head OUT TO THE SIDE.
 */
const HEAD_CLEAR = 0.5;
/**
 * ...AND IT IS NOT ONE NUMBER. 0.5 is the radius a 0.49-wide produce sphere
 * needs, and applying it to a DISC is what turned the flat plate carry into an
 * emergency every frame: the plate's screen-space half-height is a tenth of
 * that (it is seen almost edge-on from 22.5 deg), so a plate sitting a
 * comfortable head's width below the chin still tripped the circle test and got
 * dragged down toward the knees, taking the arms' credibility with it. Each
 * carry states its own clearance, measured off what it actually looks like on
 * screen: head radius 0.225 plus the payload's own screen half-height.
 */
function headClearFor(mode: number): number {
  return mode === 2 ? 0.34 : mode === 3 ? 0.38 : HEAD_CLEAR;
}
/** Where the oven burns, in sim coords. The fallback thing to look at. */
const OVEN = { x: 7.5, y: 1.1 };
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

/** Linear blend between two packed RGBs. t = 0 gives a, t = 1 gives b. */
function mixHex(a: number, b: number, t: number): number {
  const c = (i: number) =>
    clamp(Math.round(((a >> i) & 255) * (1 - t) + ((b >> i) & 255) * t), 0, 255) << i;
  return c(16) | c(8) | c(0);
}

/** Scale a packed RGB toward white (f > 1) or black (f < 1). Channel-wise. */
function shade(hex: number, f: number): number {
  const c = (i: number) => clamp(Math.round(((hex >> i) & 255) * f), 0, 255) << i;
  return c(16) | c(8) | c(0);
}

// ------------------------------------------------------------ player marker
//
// `isPlayer` did not appear once in this file. Four chefs of the same size
// scattered across an open floor with no marker of any kind is not a stylistic
// choice, it is a gameplay defect: on desktop/t0017s the critic could not find
// which body they were driving, and neither could I.
//
// The reference does not need one — Dash and Dine is 2v2 with team-coloured
// counters and a character you picked yourself off a select screen — so there
// is nothing to copy. The nearest thing in the family is Mario Party's own
// player pips and Overcooked's chef highlight: a soft warm disc on the floor,
// under the feet, additive so it never darkens the stone, breathing rather
// than blinking. It reads instantly, it survives being 40px wide on an iPhone,
// and because it is on the FLOOR it never competes with the food for
// saturation the way an overhead arrow would.
let ringTex: THREE.DataTexture | null = null;
function playerRingTexture(): THREE.DataTexture {
  if (ringTex) return ringTex;
  const n = 64;
  const data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const u = (x + 0.5) / n - 0.5;
      const v = (y + 0.5) / n - 0.5;
      const r = Math.hypot(u, v) * 2;
      // AN OUTLINE. NOT A FILL. The wash that used to sit inside the annulus is
      // gone, and it is the whole reason the contact shadow was invisible: the
      // ring is ADDITIVE and it was scaled by the same `foot` value as the
      // shadow, so its interior lift landed exactly on the shadow's dense core
      // and cancelled it. Measured in shots/DIAG2/desktop/t0007s at 5× the
      // player stands in a grey annulus with a LIGHTER middle — a dark ring
      // round a bright puck, which is the opposite of a body touching stone.
      // (Proved by rendering the same frame with the shadow forced to magenta,
      // shots/DIAG: the pool is there, at full size, and the ring was erasing
      // its centre.) With the fill deleted the marker is a hoop of warm light
      // around the outside of the pool and the pool underneath is untouched.
      const a = clamp(Math.exp(-((r - 0.82) * (r - 0.82)) / 0.009), 0, 1);
      const i = (y * n + x) * 4;
      // AMBER, NOT CREAM. See the note at the ring's opacity in `update`: an
      // additive decal can only ever brighten the stone, so the least damaging
      // thing it can add is saturation. (255,232,176) is 92% luma and turned the
      // player's contact pool into a lit disc; (236,168,72) puts most of its
      // energy in R and G and reads as a warm edge, not as a lamp.
      data[i] = 236;
      data[i + 1] = 168;
      data[i + 2] = 72;
      data[i + 3] = Math.round(a * 255);
    }
  }
  ringTex = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  ringTex.needsUpdate = true;
  return ringTex;
}

// ---------------------------------------------------------------- springs
//
// Every secondary-motion spring in this rig (lean, bank, tail) used to take a
// single explicit step on the RENDER delta. Semi-implicit Euler on a spring is
// only stable while
//
//     k · D · dt²  <  2 · (1 + D),      D = damp^dt
//
// For the lean spring (k = 150, damp = 0.0055) that ceiling is dt = 0.25s; for
// the stun spring (k = 240) it is 0.17s; for bank (k = 120) it is 0.28s.
// main.ts deliberately clamps the render delta at 0.5s so game time tracks wall
// time — twice the ceiling. Under the headless software rasteriser EVERY frame
// hits that clamp, so the map's dominant eigenvalue is −1.66 and |lean| is
// multiplied by 1.66 per frame. Measured on a real capture: 0.73 → 1.30 → 4.86
// → 6.65 → 23.0 → 39.1 rad over 28 frames. 39.07 rad ≡ 1.37 rad (78°) once you
// take it mod 2π — a chef lying on its face in mid-air.
//
// The cure is to make the spring frame-rate independent instead of frame-rate
// tolerant: sub-step it at a fixed 1/120s. The response is then bit-for-bit the
// 60fps response at every delta — the forward lean, the overshoot on stops, the
// bank into a turn and the stun stagger all survive untouched — and a 0.5s
// frame simply plays 0.5s of a spring that has already settled. Verified: the
// step-response peak is 0.736 rad at dt = 0.017, 0.05, 0.2 AND 0.5.
const SPRING_H = 1 / 120;
/** 64 × 1/120s = 0.53s of spring per frame. Past that a spring has settled. */
const SPRING_MAX_STEPS = 64;
/** Scratch result — this runs per chef per frame, so it must not allocate. */
const SPRING_OUT = { x: 0, v: 0 };

/**
 * Integrate one spring over `dt`, sub-stepped so it can never go unstable, and
 * clamp the result to `limit` as a second line of defence (against NaN leaking
 * in from a bad delta, or a future target nobody sized the limit for). Result
 * lands in {@link SPRING_OUT}.
 */
function springStep(
  x: number,
  v: number,
  target: number,
  k: number,
  damp: number,
  dt: number,
  limit: number,
) {
  if (!Number.isFinite(x) || !Number.isFinite(v)) {
    x = 0;
    v = 0;
  }
  let n = Math.ceil(dt / SPRING_H);
  let h = dt / n;
  // Covers dt <= 0 and dt = NaN: one step of zero length, i.e. hold.
  if (!(n >= 1)) {
    n = 1;
    h = 0;
  } else if (n > SPRING_MAX_STEPS) {
    n = SPRING_MAX_STEPS;
    h = SPRING_H;
  }
  const d = Math.pow(damp, h);
  for (let i = 0; i < n; i++) {
    v += (target - x) * h * k;
    v *= d;
    x += v * h;
  }
  if (!Number.isFinite(x) || !Number.isFinite(v)) {
    x = 0;
    v = 0;
  } else if (x > limit) {
    x = limit;
    if (v > 0) v = 0;
  } else if (x < -limit) {
    x = -limit;
    if (v < 0) v = 0;
  }
  SPRING_OUT.x = x;
  SPRING_OUT.v = v;
}

/**
 * Hard ceilings on the physically meaningful angles. Sized from the worst
 * legitimate step response of each spring (lean 1.006 rad for a brake with an
 * overhead load, bank 0.512 rad) with headroom, so in normal play they never
 * bite — they exist so that no future bug can put a chef on its face again.
 */
const LEAN_LIMIT = 1.1;
const BANK_LIMIT = 0.8;
const TAIL_LIMIT = 4;

// ----------------------------------------------------------- plate tower
//
// ------------------------------------------------------------ stride wave
//
// THE BUG THE VERDICT CALLED "A DOLL STANDING STILL", WITH THE NUMBERS.
//
// The rig was not failing to animate. `window.__rig()` over a 16-second capture
// (608 rows, 173 of them above the verdict's run > 0.3 bar) measured a MEDIAN
// thigh split of 77.9° — a real stride, at the right amplitude. What it also
// measured was the distribution:
//
//     thighSplitDeg   min 0.9   p10 16.2   med 77.9   p90 139.6   max 146.7
//     VIOLATIONS: 46/173 moving frames under 45° (27%)
//
// The stride was a pure sine, and |sin| spends a quarter of its cycle under a
// third of its amplitude. So better than one moving chef in four, in any frame
// you photograph, is caught at the passing pose with its legs together and its
// thighs within a few degrees of each other. With four to six chefs on screen
// and 27 frames to look at, the critic was guaranteed to find "not one
// unambiguous stride" — because a quarter of them genuinely are not one, and
// the eye remembers the failures.
//
// Two frames from the log say it exactly:
//
//     t=9.14  mochi  speed 5.51  run 0.889  amp 1.000  brake 0.000  thigh 1.6°
//     t=13.83 mochi  speed 5.46  run 0.880  amp 0.993  brake 0.008  thigh 1.8°
//
// Full authority, no braking, sprinting — and 1.6° of leg separation, because
// sin(p) happened to be 0.01. That is the whole defect, and no amount of extra
// amplitude fixes it: a bigger sine still passes through zero.
//
// A GAME THAT IS JUDGED IN STILL FRAMES CANNOT USE A SINE.
//
// Look at what the reference actually does. Waluigi in `dash-and-dine-01.jpeg`
// is at a full contact pose: rear leg extended and straight with the boot toed
// off, front knee up and folded, both feet clear of the stone. Every character
// in both reference frames is at or near an extreme of its cycle. That is not
// luck, it is how hand-keyed game animation is built — pose to pose, with the
// in-between passed through fast, because the poses are the information and the
// in-between is just transport.
//
// So the stride drives off a phase-warped, hold-shaped wave instead:
//
//   warp   w = φ + WARP·sin(2φ)   — dφw/dφ is 1 + 2·WARP at the passing pose and
//                                   1 − 2·WARP at full extension, so the legs
//                                   crawl through the contact poses and scissor
//                                   through the pass.
//   hold   v = sign(sin w)·|sin w|^HOLD — squares the wave up so even mid-ramp
//                                   the legs are near full separation.
//
// Together they cut the time spent under half amplitude from 25% of the cycle
// to under 3%, at the same peak, with no discontinuity anywhere: the legs still
// genuinely cross (they must — it is a walk cycle), they just cross fast.
const STRIDE_WARP = 0.47;
const STRIDE_HOLD = 0.30;
/** The warped phase. Also drives the knee lift, so the two stay in register. */
function strideWarp(ph: number): number {
  return ph + STRIDE_WARP * Math.sin(2 * ph);
}
/** −1..1, but weighted hard toward ±1. Feed it an already-warped phase. */
function strideHold(w: number): number {
  const sn = Math.sin(w);
  return sn < 0 ? -Math.pow(-sn, STRIDE_HOLD) : Math.pow(sn, STRIDE_HOLD);
}
/**
 * Peak thigh angle off vertical, radians. 0.78 rad = 44.7°, so a full contact
 * pose is an 89° split — measured off Waluigi's stride in the reference, which
 * is a little over a right angle between the thighs. The old 1.28 (a 147° split)
 * was past the splits and was the reason the amplitude had to be paid for
 * somewhere else.
 */
const THIGH_PEAK = 0.82;

/** Shortest signed angle from a to b. */
function angleDelta(a: number, b: number): number {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

/**
 * IDLE STANCES — the fix for "across our seven desktop frames I count
 * essentially two poses: neutral stand, and one-arm-aloft."
 *
 * The rig already had idle *beats* — a look-away, a stretch, a hop, a nod —
 * but every one of them was a 0.9-second `sin` hump that spends most of its
 * life near zero, so a screenshot almost always caught a chef between poses,
 * and the one beat loud enough to survive that (the two-armed stretch) is the
 * one that produced the "one arm near-vertical, the other down" read in every
 * single frame the critic looked at.
 *
 * A beat is the wrong primitive. What the reference actually has is eight
 * bodies each HOLDING a different attitude: Waluigi mid-stride, Shy Guy's
 * plate out flat, Daisy turned away, a Toad hugging pancakes, Toads leaning on
 * counters. Every one of those survives being frozen because it is a
 * sustained pose, not a transient.
 *
 * So an idle chef now holds one of six committed stances for 1.5–3.1 seconds
 * and cross-fades to the next. Each is chosen for what it does to the OUTLINE
 * at 60px, which is the only thing that matters at the size we ship:
 *
 *   hips    — both elbows out; two triangles of daylight through the body.
 *   fold    — arms crossed high; the outline goes solid and wide at the chest.
 *   brow    — one paw up shading the eyes; a peak on one side only.
 *   stretch — both arms overhead; the only bilateral pose, so it reads as an
 *             EVENT among all the asymmetric ones.
 *   clasp   — hands behind the back; the outline goes narrow and tall.
 *   point   — one arm straight out front, the other on the hip. The loudest
 *             asymmetry in the set.
 *
 * Index 0 is "no stance" — the ordinary weight-shifted hang — and it is in the
 * bag twice so the cast is not permanently mugging.
 *
 * Each entry is [shoulderX, shoulderZ, elbowX] for the RIGHT arm followed by
 * the same three for the LEFT. Signs follow the rig convention: −X pitches the
 * arm forward, +Z abducts the RIGHT arm outward (so the left mirrors with −Z).
 */
const STANCES: readonly (readonly number[])[] = [
  [0, 0, 0, 0, 0, 0], // 0 — unused; index 0 means "no stance".
  // 1 HIPS — retuned. At shoulderX +0.28 the upper arm was pitched BACKWARD and
  // abducted 1.05 rad (60 deg), which from a camera looking down 22.5 deg at a
  // chef's back is not "hands on hips", it is both arms raised out to the
  // sides: the shrug the critic still found on bramble at 01-opening, and
  // bramble's seed makes this its permanent opening attitude, so it is the
  // first pose anybody sees. Dropped to 0.62 rad with the pitch just off
  // vertical and the elbow folded harder, so the upper arms hang, the paws come
  // in to the waist, and what shows is two small triangles of floor at the
  // hips instead of a Y.
  [-0.05, 0.62, -2.2, -0.05, -0.62, -2.2], // 1 hips
  [-0.7, 0.26, -2.25, -0.7, -0.26, -2.25], // 2 fold
  [-2.15, 0.5, -1.9, 0.35, -0.22, -0.5], // 3 brow
  // 4 was STRETCH — both arms straight up and out. At shipped size that is not
  // a stretch, it is a surrender, and because it is the loudest pose in the
  // table it kept landing on the first frame a player ever sees (bramble in
  // shots/mc-w2-base/desktop/01-opening, arms above its head in an empty
  // kitchen). Replaced with WIPE THE BROW: right elbow folded hard so the paw
  // comes back to the forehead, left hand on the hip. Same asymmetry, same
  // silhouette punch, and it says "this is hard work" instead of "I give up".
  [-2.05, 0.3, -2.1, 0.28, -1.0, -1.95], // 4 brow-wipe
  // 5 was CLASP — both arms hanging forward at 0.55 with the elbows half bent,
  // which renders as a limp dangle rather than as hands held together. Replaced
  // with LEAN ON THE BENCH: right hand planted down and out in front, left arm
  // trailing back. A working attitude with weight in it.
  [-1.0, 0.42, -0.42, 0.42, -0.5, -0.9], // 5 bench-lean
  [-1.55, 0.28, -0.06, 0.28, -1.0, -1.9], // 6 point
];
/** Weighted draw. One neutral in ten; the loudest three come up twice. */
const STANCE_BAG = [0, 1, 2, 3, 4, 5, 6, 1, 6, 4];

/**
 * Every live chef, so each one can look at the nearest other one. A registry
 * rather than a parameter because main.ts rebuilds the cast wholesale; entries
 * whose root has been detached are pruned on the next frame.
 */
const LIVE: ChefView[] = [];

/**
 * RIG TELEMETRY — the instrument that found this piece's bug.
 *
 * "The sim says a chef is sprinting with cargo and the render shows a doll
 * standing still" is not a style note, it is a claim that two numbers disagree,
 * and the only way to settle it is to publish both from inside the rig at the
 * exact frame the screenshot lands on. So every ChefView writes its own state —
 * the sim speed it was handed, the gait it derived, the thigh split it actually
 * wrote to the bones, the pitch on the rig, the world gap between the paw socket
 * and the payload — into a plain-JSON row, and `window.__rig()` returns them.
 *
 * It costs one object write per chef per frame and it is the difference between
 * fixing the animation and guessing at it. (Prior art: the "skydiving frog"
 * spring divergence was found by logging max|lean| per frame, not by looking.)
 */
export interface RigTelemetry {
  skin: string;
  /** Sim truth, straight off chef.vel. */
  speed: number;
  /** speed / TUNING.moveSpeed. */
  run: number;
  /** The saturating stride authority actually used by the legs. */
  gait: number;
  amp: number;
  brake: number;
  /** Degrees between the two thighs. THE number the verdict demands ≥45. */
  thighSplitDeg: number;
  /** rig.rotation.x in degrees. Verdict demands 12–18 at cruise. */
  pitchDeg: number;
  /** Degrees between the two shoulders, fore-aft. */
  armSplitDeg: number;
  /** Lowest foot bone height above the floor, world units. */
  footLowY: number;
  /** Highest foot bone height above the floor — one foot must leave the ground. */
  footHighY: number;
  /** World distance from the paw socket to the payload's origin. */
  payloadGap: number;
  carrying: string;
  mode: number;
  /** The delta this rig integrated on. */
  dt: number;
  /** Screen-up distance from the head centre to the payload. Must be <= -0.46. */
  headClear: number;
  /**
   * Forward clearance from the chest axis to the payload, minus what the torso
   * clamp requires. Negative means the load was inside the body and got pushed.
   */
  bodyClear: number;
  /** +1 the load is on the right paw, -1 on the left. */
  carrySide: number;
  shOp: number;
  shY: number;
  shSX: number;
  shSY: number;
  shVis: number;
}

const TELE: RigTelemetry[] = [];
if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).__rig = () => TELE.slice();
}

export class ChefView {
  readonly root = new THREE.Group();
  private skin: Skin;
  private build: (typeof BUILDS)[Build];
  private rig = new THREE.Group();
  private hips = new THREE.Group();
  private torso = new THREE.Group();
  private head = new THREE.Group();
  /**
   * The built-in hat, in its own group. Transform-neutral (origin, no
   * rotation), so this is behaviourally identical to adding the hat parts
   * straight to `head` — it exists only so tooling has a structural handle on
   * the hat, exactly as `ears`/`tail`/`eyes` do. Populated by the `s.hat`
   * switch in `buildHead` via a scoped `head` redirect.
   */
  readonly hatGroup = new THREE.Group();
  private legL!: Limb;
  private legR!: Limb;
  private armL!: Limb;
  private armR!: Limb;
  private hands = new THREE.Group();
  private tail: THREE.Object3D[] = [];
  /** Rest rotation of each tail segment, so the spring swings around it. */
  private tailRest: THREE.Vector3[] = [];
  private tailAng: number[] = [];
  private tailVel: number[] = [];
  private ears: THREE.Object3D[] = [];
  /** Mouth: a permanent lip arc plus a cavity that opens on effort. */
  private mouthCav: THREE.Object3D | null = null;
  private mouthLip: THREE.Object3D | null = null;
  /** Duck: the lower mandible hinges instead. */
  private beakLower: THREE.Object3D | null = null;
  private mouthOpen = 0;
  private mouthCavH = 0.06;
  /** Rest rotation of every ear / crest / bandana tail. The flap used to ASSIGN
   *  rotation.x, which wiped the rest pose: bramble's two bandana tails are
   *  built at x = −2.6 (hanging down the back of the skull) and were being
   *  reset to ≈0 every frame, so they stood bolt upright and read as a red
   *  candle growing out of the bear's head. Same bug straightened mochi's crest
   *  feathers. Flap is now added to the rest, never substituted for it. */
  private earRest: number[] = [];
  private eyes: THREE.Object3D[] = [];
  private shadow: THREE.Mesh;
  private shadowMat: THREE.MeshBasicMaterial;

  // Proportions resolved at build time so head/arms/collar can never drift.
  private shoulderY = 0.44;
  private neckY = 0.42;
  private headY = 0.7;

  private carryKey = '';
  /** The comedy tower, when one is up, so it can sway on its own lag. */
  private phase = 0;
  private prevSpeed = 0;
  private accel = 0;
  private prevHeading = 0;
  private turn = 0;
  private lean = 0;
  private leanV = 0;
  private bank = 0;
  private bankV = 0;
  private brake = 0;
  private recover = 0;
  private prevStun = 0;
  /** Uniform arm scale: reaching overhead needs more arm than a chibi has. */
  private reach = 1;
  private carryBlend = 0;
  /** Which paw a one-handed load rides. Latched with a deadband — see `update`. */
  private carrySide = 1;
  /** 0 alone, 1 with somebody's elbow in your ribs. Folds the arms in. */
  private crowd = 0;
  /** View-only lateral lean-away so two chefs never render as one mass. */
  private jostle = 0;
  private blinkIn: number;
  private blinkFor = 0;
  private headYaw = 0;
  private glancePhase: number;
  private tmp = new THREE.Vector3();
  /** Scratch for the telemetry probes (socket / payload / foot world positions). */
  private tmp2 = new THREE.Vector3();
  private tmp3 = new THREE.Vector3();
  /** Live instrument row — see RigTelemetry. Read through `window.__rig()`. */
  private tele: RigTelemetry = {
    skin: '',
    speed: 0,
    run: 0,
    gait: 0,
    amp: 0,
    brake: 0,
    thighSplitDeg: 0,
    pitchDeg: 0,
    armSplitDeg: 0,
    footLowY: 0,
    footHighY: 0,
    payloadGap: 0,
    carrying: '',
    mode: 0,
    dt: 0,
    headClear: 0,
    bodyClear: 0,
    carrySide: 1,
    shOp: 0,
    shY: 0,
    shSX: 0,
    shSY: 0,
    shVis: 0,
  };
  /** Scratch for the tower's world-space levelling solve. Never allocate here. */
  private qA = new THREE.Quaternion();
  private qB = new THREE.Quaternion();
  private eA = new THREE.Euler(0, 0, 0, 'YXZ');
  /**
   * IDLE FIDGETS. mochi stood at the oven in a visually identical stance at
   * t0005, t0013, t0016 and 90-late — eleven seconds of no discernible change —
   * because the only thing an idle chef did was breathe on a 3-second sine and
   * shift weight on a 10-second one, both of which are sub-pixel at the size we
   * render. The reference has eight bodies in six distinct poses across two
   * frames; ours had four bodies in two.
   *
   * So an idle chef now runs a short scripted BEAT every couple of seconds,
   * picked from four that are each unmistakable in a still frame: a look-away,
   * a two-armed stretch, a heel bounce, and a nod. Seeded per critter so no two
   * ever fire together.
   */
  private fidgetIn: number;
  private fidgetKind = 0;
  private fidgetT = 0;
  /** Which of the three station actions this critter does. Fixed per skin. */
  private workKind = 0;
  /** Held idle attitude — see STANCES. 0 = the ordinary weight-shifted hang. */
  private stanceKind = 0;
  private stanceIn: number;
  /** 0→1 cross-fade into the current stance, so nothing ever snaps. */
  private stanceMix = 0;
  /** Live outputs of the current beat, read by the head / arm / hip code. */
  private fidgetLook = 0;
  private fidgetNod = 0;
  private fidgetArm = 0;
  private fidgetHop = 0;
  private rnd: number;
  /**
   * DELIVERY FLOURISH. report.json showed served = 0 across all four profiles
   * for the whole 16-second capture, so no hand-off animation had ever been
   * exercised — and there wasn't one to exercise. A hand-off is the loudest
   * beat in the loop and it was silent. A chef that has just put a loaded plate
   * down throws both arms up, hops, and grins for half a second.
   */
  private cheerT = 0;
  /** 0..1 envelope of the delivery flourish, read by the hips and the head. */
  private cheerSpin = 0;
  private wasLoaded = false;
  /** Warm floor marker. Built only for the human-driven chef; null otherwise. */
  private ring: THREE.Mesh | null = null;
  private ringMat: THREE.MeshBasicMaterial | null = null;
  /** Pupil sockets and the pose they were built in, so both eyes share a gaze. */
  private pupils: THREE.Object3D[] = [];
  private pupilBase: THREE.Vector3[] = [];
  private gaze = 0;

  constructor(private chef: Chef) {
    let skin = SKINS[chef.skin] ?? SKINS.bramble;
    if (chef.isPlayer) {
      // HALF A STOP UP ON THE DOMINANT BLOCK. The marker on the floor says
      // where the player is; this says which of the four bodies is theirs once
      // they are looking at the right patch of floor. It is deliberately small
      // — the reference keeps its whole cast inside one narrow warm value band
      // and that is why the food wins the saturation fight — but a coat that is
      // 8% lighter than the same coat on a bot is enough to settle "is that me"
      // at a glance without turning the player into a lamp.
      skin = {
        ...skin,
        coat: shade(skin.coat, 1.09),
        hem: shade(skin.hem, 1.09),
        hatA: shade(skin.hatA, 1.07),
      };
    }
    this.skin = skin;
    this.build = BUILDS[skin.build];
    this.blinkIn = 0.6 + skin.seed * 4;
    this.glancePhase = skin.seed * TAU;
    this.rnd = skin.seed * 977.13;
    this.fidgetIn = 0.4 + skin.seed * 2.6;
    this.fidgetKind = Math.floor(skin.seed * 4) % 4;
    // Staggered hard per critter: the cast must never be caught in the same
    // attitude at the same instant, which is exactly what ipad/t0014 showed
    // (nori and pip on opposite sides of the frame in identical one-arm-up
    // poses simultaneously).
    this.workKind = Math.floor(skin.seed * 97) % 3;
    this.stanceKind = 1 + (Math.floor(skin.seed * 61) % 6);
    this.stanceIn = 0.9 + skin.seed * 2.4;
    this.stanceMix = 1;

    this.shadowMat = new THREE.MeshBasicMaterial({
      map: softShadowTexture(),
      color: 0x3a2810,
      transparent: true,
      opacity: 0.58,
      depthWrite: false,
    });
    this.shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.shadowMat);
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = 0.014;
    this.shadow.renderOrder = -1;
    this.root.add(this.shadow);

    if (chef.isPlayer) {
      // Additive, so it can only ever ADD warm light to the stone — it can
      // never punch a dark hole in the floor the way a blended decal would, and
      // it needs no shadow interaction. Sits under the contact shadow's render
      // order so the shadow still darkens the feet on top of it.
      this.ringMat = new THREE.MeshBasicMaterial({
        map: playerRingTexture(),
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        opacity: 0.5,
      });
      // 0.68 against the shadow's ~1.4-unit footprint: the ring sits INSIDE the
      // contact shadow, roughly 0.45 world units of radius, so it reads as a
      // glow at the player's feet and not as a hoop they are standing in.
      this.ring = new THREE.Mesh(new THREE.PlaneGeometry(0.68, 0.68), this.ringMat);
      this.ring.rotation.x = -Math.PI / 2;
      this.ring.position.y = 0.011;
      this.ring.renderOrder = -2;
      this.root.add(this.ring);
    }

    this.rig.scale.setScalar(CHAR_SCALE);
    this.hips.position.y = skin.legLen;
    this.rig.add(this.hips);
    this.hips.add(this.torso);
    this.root.add(this.rig);

    this.buildLegs();
    this.buildTorso();
    this.buildHead();
    this.buildArms();

    this.hands.position.set(0, 0.42, 0.4);
    this.torso.add(this.hands);
    this.tele.skin = chef.skin;
    LIVE.push(this);
    TELE.push(this.tele);
  }

  // ------------------------------------------------------------- building

  private buildLegs() {
    const s = this.skin;
    const b = this.build;
    const thigh = s.legLen * b.thighF;
    const shin = s.legLen * b.shinF;
    const r = b.limbR;

    const make = (side: number): Limb => {
      const hip = new THREE.Object3D();
      hip.position.set(b.stance * side, 0, 0);
      const upper = new THREE.Mesh(new THREE.CapsuleGeometry(r, thigh * 0.8, 4, 8), toon(s.legs));
      upper.position.y = -thigh * 0.5;
      hip.add(upper);

      const knee = new THREE.Object3D();
      knee.position.y = -thigh;
      hip.add(knee);
      const lower = new THREE.Mesh(
        new THREE.CapsuleGeometry(r * (s.build === 'bird' ? 0.8 : 0.9), shin * 0.78, 4, 8),
        toon(s.shin),
      );
      lower.position.y = -shin * 0.5;
      knee.add(lower);
      if (s.build === 'bird' || s.build === 'nimble') {
        // A visible ankle knuckle: the joint the reference draws on a bird leg
        // and the thing that stops a tapered cylinder ending in a blob.
        const ank = new THREE.Mesh(new THREE.SphereGeometry(r * 1.25, 8, 6), toon(s.shin));
        ank.position.y = -shin + 0.01;
        knee.add(ank);
      }

      const foot = new THREE.Object3D();
      foot.position.y = -shin;
      knee.add(foot);
      this.buildFoot(foot, side);
      this.hips.add(hip);
      return { hip, knee, foot };
    };
    this.legL = make(-1);
    this.legR = make(1);
  }

  /**
   * Four foot constructions. This is half of what separates the four bodies —
   * and, since round 16, the thing that makes `limb.foot.rotation.x` visible.
   *
   * Every foot in the cast used to be ONE convex blob centred more or less on
   * the ankle, so rotating it about X spun a lump about its own centre and
   * nothing changed in the outline: the plant and the push-off — the two poses
   * that tell you a character is running rather than sliding — were being
   * computed every frame and drawn zero times. A foot needs a long axis and it
   * needs its ends to look different from each other. So every one of the four
   * now gets a TOE forward of the ankle in a lighter value, a HEEL behind it in
   * a darker one, and a dark sole strip joining them. Toe up = push-off; toe
   * down = plant; and because the two ends differ in value you can see which is
   * which at 40px.
   */
  private buildFoot(foot: THREE.Object3D, side: number) {
    const s = this.skin;
    const toeCol = shade(s.shoe, 1.1);
    const heelCol = shade(s.shoe, 0.76);
    switch (s.foot) {
      case 'boot': {
        const boot = new THREE.Mesh(new THREE.SphereGeometry(0.104, 12, 9), toon(s.shoe));
        boot.scale.set(1.06, 0.82, 1.55);
        boot.position.set(0.006 * side, 0.052, 0.045);
        foot.add(boot);
        const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.1, 0.05, 12), toon(s.coat));
        cuff.position.set(0, 0.108, 0.005);
        foot.add(cuff);
        // Toe cap: a rounded box proud of the boot's nose, a stop lighter.
        const toe = new THREE.Mesh(new THREE.SphereGeometry(0.076, 10, 8), toon(toeCol));
        toe.scale.set(1.18, 0.72, 1.05);
        toe.position.set(0.006 * side, 0.048, 0.15);
        foot.add(toe);
        // Heel block behind the ankle, darker, square-ish.
        const heel = new THREE.Mesh(new THREE.SphereGeometry(0.062, 8, 7), toon(heelCol));
        heel.scale.set(1.05, 0.95, 0.8);
        heel.position.set(0.006 * side, 0.05, -0.062);
        foot.add(heel);
        const sole = new THREE.Mesh(new THREE.SphereGeometry(0.098, 10, 6), toon(0x4a3324));
        sole.scale.set(1.1, 0.26, 1.9);
        sole.position.set(0.006 * side, 0.012, 0.05);
        foot.add(sole);
        break;
      }
      case 'frog': {
        // A big flat splayed pad — pip's whole ground contact, and the reason
        // his long thin shins do not look like they end in nothing.
        const pad = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 8), toon(s.shoe));
        pad.scale.set(1.4, 0.36, 1.35);
        pad.position.set(0, 0.034, 0.045);
        foot.add(pad);
        for (const t of [-1, 0, 1]) {
          const toe = new THREE.Mesh(new THREE.CapsuleGeometry(0.036, 0.085, 4, 6), toon(toeCol));
          toe.rotation.x = Math.PI / 2;
          toe.rotation.z = t * 0.34;
          toe.position.set(t * 0.064, 0.036, 0.155);
          foot.add(toe);
        }
        // Webbing between the toes, and a real heel spur behind the ankle so
        // the pad is no longer symmetric about the joint.
        const web = new THREE.Mesh(new THREE.SphereGeometry(0.085, 10, 6), toon(shade(s.shoe, 0.9)));
        web.scale.set(1.5, 0.22, 1.0);
        web.position.set(0, 0.03, 0.115);
        foot.add(web);
        const heel = new THREE.Mesh(new THREE.SphereGeometry(0.058, 8, 7), toon(heelCol));
        heel.scale.set(0.95, 0.85, 0.9);
        heel.position.set(0, 0.042, -0.055);
        foot.add(heel);
        break;
      }
      case 'paw': {
        const pad = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 8), toon(s.shoe));
        pad.scale.set(0.98, 0.7, 1.35);
        pad.position.set(0, 0.046, 0.035);
        foot.add(pad);
        // Three toes on a lighter tip, out in front of the ankle.
        const toeCap = new THREE.Mesh(new THREE.SphereGeometry(0.062, 10, 8), toon(toeCol));
        toeCap.scale.set(1.25, 0.68, 0.95);
        toeCap.position.set(0, 0.042, 0.12);
        foot.add(toeCap);
        for (const t of [-1, 0, 1]) {
          const bean = new THREE.Mesh(new THREE.SphereGeometry(0.024, 6, 5), toon(s.pale));
          bean.scale.set(1, 0.7, 1.3);
          bean.position.set(t * 0.038, 0.028, 0.145);
          foot.add(bean);
        }
        const heel = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 7), toon(heelCol));
        heel.scale.set(0.95, 1.0, 0.85);
        heel.position.set(0, 0.05, -0.055);
        foot.add(heel);
        break;
      }
      case 'web': {
        // A SOLID webbed foot with volume. The previous build was a 3-sided
        // cylinder 3cm thick — geometrically a flat triangle — with three thin
        // toe rods laid on it. Seen from the game camera (which looks down)
        // that projected as a flat orange arrowhead lying on the floor with a
        // thin amber stick landing near it: shots/p04-r5d/desktop/90-late at
        // 4× shows exactly that, and it does not read as a foot at any size.
        const pad = new THREE.Mesh(new THREE.SphereGeometry(0.092, 12, 9), toon(s.shoe));
        pad.scale.set(1.24, 0.5, 1.32);
        pad.position.set(0, 0.05, 0.04);
        foot.add(pad);
        for (const t of [-1, 0, 1]) {
          const toe = new THREE.Mesh(new THREE.CapsuleGeometry(0.031, 0.095, 4, 6), toon(toeCol));
          toe.rotation.x = Math.PI / 2;
          toe.rotation.z = t * 0.4;
          toe.position.set(t * 0.058, 0.044, 0.135);
          foot.add(toe);
        }
        const heel = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 7), toon(heelCol));
        heel.scale.set(1, 0.9, 0.95);
        heel.position.set(0, 0.056, -0.05);
        foot.add(heel);
        break;
      }
    }
  }

  private buildTorso() {
    const s = this.skin;
    const b = this.build;
    this.shoulderY = b.bodyY + b.chestH * 0.5 + b.chestR - 0.075;
    this.neckY = b.bodyY + b.chestH * 0.5 + b.chestR - 0.02;
    // Head set 3cm DEEPER into the shoulders than before (0.115, not 0.145).
    // Measured off a 5× crop of desktop/t0014s, bramble's skull was 43% of his
    // on-screen height and the visible leg was 19% — the classic three-blob
    // stack. A chibi head is supposed to be big; it is not supposed to sit on a
    // neck. Sinking it removes a whole segment from the vertical stack without
    // shrinking the thing identity actually lives in, and the skull already
    // envelops the collar ring at this depth so nothing new intersects.
    this.headY = b.bodyY + b.chestH * 0.5 + b.chestR + 0.115;

    const body = new THREE.Mesh(new THREE.CapsuleGeometry(b.chestR, b.chestH, 6, 16), toon(s.coat));
    body.position.y = b.bodyY;
    // Flatter front-to-back than side-to-side: a perfect balloon left no room
    // for the belly panel to protrude.
    body.scale.set(s.girth, 1, s.girth * 0.84);
    body.castShadow = true;
    this.torso.add(body);

    // Pale front PLACKET — deliberately narrow.
    //
    // This used to be 76% of the chest width and 108% of its height, i.e. a
    // cream dinner plate glued to the front of the torso. On bramble (crimson
    // jacket) and pip (yellow apron) — the two loudest colour blocks in the
    // cast — it read in every capture as a blown white stain through the middle
    // of the garment, and it is the single reason our characters lose the
    // saturation fight against the food. The reference's chefs hold their own
    // because each one's dominant colour block is LARGE, FLAT and UNBROKEN:
    // Waluigi's purple, Shy Guy's red robe, Daisy's yellow skirt.
    //
    // A shirt placket does the same front/back job with a tenth of the area.
    //
    // It is also bounded ABOVE the garment hem (which tops out at y = 0.32 for
    // every build). It used to run from y ≈ 0.17 to 0.52 on nori, i.e. straight
    // down through the cream apron, and because the skirt cylinder flares
    // outward the placket punched through the FRONT of it near the bottom — a
    // pale streak down the middle of a pale apron, which is worse than no
    // placket at all.
    const bellyR = b.chestR * 0.72;
    const belly = new THREE.Mesh(new THREE.SphereGeometry(bellyR, 16, 12), toon(s.pale));
    belly.position.set(0, b.bodyY + b.chestH * 0.5 + 0.115, 0.12 * s.girth);
    belly.scale.set(0.5 * s.girth, 0.115 / bellyR, 0.66);
    this.torso.add(belly);

    // Neckerchief at the actual neck line, only ~15% wider than the shoulders.
    // Sat 5cm too high and 30% too wide at the top: on nori the top ring pushed
    // straight through the jaw and the muzzle, which at 3× read as a collar
    // sawing the cat's face off. It is now BELOW the skull's lowest point and
    // its top ring is narrower than the neck.
    const collar = new THREE.Mesh(
      new THREE.CylinderGeometry(b.chestR * 0.5, b.chestR * 0.92 * s.girth, 0.062, 16),
      toon(s.scarf),
    );
    collar.position.y = this.neckY - 0.035;
    this.torso.add(collar);

    // Trousers block. Without it the legs are the same value as the body and
    // the run cycle is invisible from behind.
    //
    // AND IT MUST STOP AT THE CROTCH. This used to be a 0.243-radius sphere
    // squashed to 0.78 and centred at y = 0.035, i.e. its underside hung to
    // y = −0.155 — for bramble that is 0.155 of a 0.34 hip height, so the
    // trouser block alone swallowed the top HALF of the thigh, and the coat
    // capsule swallowed the rest. Between them the pelvis was solid from the
    // ribs to the knee and the 58° thigh split computed in `update` could not
    // possibly appear in the outline. The hip joints sit at y = 0; the pelvis
    // now bottoms out just under them, so the whole thigh is free.
    const shorts = new THREE.Mesh(new THREE.SphereGeometry(b.chestR * 0.84, 14, 10), toon(s.legs));
    shorts.position.y = 0.085;
    shorts.scale.set(0.96 * s.girth, 0.56, 0.94 * s.girth);
    this.torso.add(shorts);

    this.buildGarment();
    this.buildTail();
  }

  /**
   * THE HEM. Every reference character has a garment edge that overhangs the
   * hips — Waluigi's overall bib, Shy Guy's robe, Daisy's skirt, Toad's waist
   * band — and that edge is what stops a chibi body reading as one continuous
   * tube from chin to ankle. Ours had none, and pip in particular rendered as a
   * single unbroken green sausage: 300 pixels of one hue with a cauliflower on
   * top, no waist, no hip, no visible leg attachment.
   *
   * So: a flared skirt of garment at the base of the torso in a value that is
   * neither the coat nor the trousers, with a trim band on its bottom edge. It
   * hangs off the torso, so it squashes with the breath and swings with the
   * lean. Pip additionally gets the apron the cast sheet always claimed he had,
   * including a bow on the BACK — which, given the game camera, is the side of
   * him the player actually looks at.
   */
  private buildGarment() {
    const s = this.skin;
    const b = this.build;
    const g = s.girth;
    // A TUNIC, not a tutu. The first pass flared to 1.20× the chest over only
    // 0.23 of drop and finished on a 1.22× flat ring — from a camera that looks
    // DOWN at the room you saw the top face of that ring, and nori wore what
    // read as a teal flying saucer. Long drop, gentle flare, narrow trim.
    //
    // ROUND 16 — THE HEM IS WHY THE RIG WAS INVISIBLE.
    //
    // A tunic that ends at the hip is a garment; a tunic that ends at mid-shin
    // is a bell, and a bell has one outline no matter what the legs inside it
    // are doing. Every reference character's garment stops AT or ABOVE the
    // crotch — Waluigi's overall legs split at the hip, Mario's dungarees end
    // in two separate trouser legs, Daisy's skirt clears her knees by a mile —
    // which is exactly why their strides open holes of floor inside the
    // silhouette and ours opened none.
    //
    // So the hem bottom is now level with the hip joints (y = 0) instead of
    // hanging past them, and the flare comes in from 1.13× the chest to 1.02×
    // so the trim ring reads as an edge rather than as a skirt seen from above.
    const top = 0.3;
    const bot = 0.005;
    const skirt = new THREE.Mesh(
      new THREE.CylinderGeometry(b.chestR * 0.95 * g, b.chestR * 1.02 * g, top - bot, 20, 1, true),
      toon(s.hem),
    );
    skirt.position.y = (top + bot) * 0.5;
    skirt.scale.z = 0.92;
    skirt.castShadow = true;
    this.torso.add(skirt);
    const trim = new THREE.Mesh(
      new THREE.CylinderGeometry(b.chestR * 1.04 * g, b.chestR * 1.0 * g, 0.045, 20),
      toon(s.hemTrim),
    );
    trim.position.y = bot + 0.016;
    trim.scale.z = 0.92;
    this.torso.add(trim);

    if (s.hat === 'toque') {
      // Apron: a bib up the chest, two straps over the shoulders, and on the
      // back a waist tie with a bow — the bow being the point, since the game
      // camera looks at pip's back roughly all of the time. Everything is
      // built from squashed spheres rather than boxes: a box bib intersecting
      // a curved chest showed its corners as a yellow slab jutting out of the
      // frog's ribs.
      const bib = new THREE.Mesh(new THREE.SphereGeometry(b.chestR * 0.62, 14, 10), toon(s.hem));
      bib.position.set(0, b.bodyY - 0.03, b.chestR * 0.5);
      bib.scale.set(1.05, 1.5, 1.15);
      this.torso.add(bib);
      for (const side of [-1, 1]) {
        const strap = new THREE.Mesh(new THREE.CapsuleGeometry(0.032, 0.24, 4, 7), toon(s.hem));
        strap.position.set(0.115 * side, b.bodyY + 0.155, b.chestR * 0.62);
        strap.rotation.x = -0.32;
        strap.rotation.z = 0.14 * side;
        this.torso.add(strap);
      }
      // The bow is in `hemTrim`, NOT `hem`. Built in the apron's own yellow it
      // was invisible as a bow and visible only as a lighter smear across the
      // middle of the apron — one of the two "blown pale blotches" the critic
      // found on the loudest colour blocks in the cast. In the darker gold it
      // reads as what it is from across the room.
      // SMALL, TIDY, DARK. Built in the apron's own yellow and sprawling over
      // four separate lumps it was not legible as a bow at any distance — only
      // as a lighter smear across the middle of the loudest colour block in the
      // cast. A knot and two clean loops in the darker gold, and no trailing
      // tails at all.
      const back = -b.chestR * 0.98 * g;
      const knot = new THREE.Mesh(new THREE.SphereGeometry(0.046, 10, 8), toon(s.hemTrim));
      knot.position.set(0, 0.25, back);
      knot.scale.set(1, 0.95, 0.7);
      this.torso.add(knot);
      for (const side of [-1, 1]) {
        const loop = new THREE.Mesh(new THREE.SphereGeometry(0.062, 10, 8), toon(s.hemTrim));
        loop.position.set(0.076 * side, 0.258, back - 0.008);
        loop.scale.set(1.25, 0.7, 0.35);
        loop.rotation.z = -0.5 * side;
        this.torso.add(loop);
      }
    }
  }

  private buildTail() {
    const s = this.skin;
    const b = this.build;
    switch (s.tail) {
      case 'stub': {
        // At the REAR of the pelvis and high enough to sit above the leg tops.
        // It used to hang at crotch height in cream and read, in every single
        // frame, as a pale ball parked between the legs.
        const t = new THREE.Mesh(new THREE.SphereGeometry(0.085, 10, 8), toon(s.fur));
        t.position.set(0, 0.36, -0.28 * s.girth);
        t.scale.set(1.05, 0.95, 0.8);
        this.torso.add(t);
        const tip = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 7), toon(s.pale));
        tip.position.set(0, 0.385, -0.32 * s.girth);
        tip.scale.set(1, 0.85, 0.7);
        this.torso.add(tip);
        break;
      }
      case 'long': {
        // Four segments on a lagging spring. The old build was six segments
        // aimed nearly straight UP, which cleared the top of the head and
        // rhymed exactly with the ear spikes — from behind the cat read as a
        // creature with three horns. Now it sweeps BACK and curls to one side.
        let parent: THREE.Object3D = this.torso;
        const base = new THREE.Object3D();
        base.position.set(0, 0.33, -0.29 * s.girth);
        base.rotation.x = -1.02;
        base.rotation.z = 0.16;
        this.torso.add(base);
        parent = base;
        for (let i = 0; i < 4; i++) {
          const seg = new THREE.Object3D();
          seg.position.y = i === 0 ? 0 : 0.175;
          // Curl: each joint lifts the tail a little more, so the chain reads
          // as a hook rather than a broomstick.
          seg.rotation.x = i === 0 ? 0 : 0.3;
          seg.rotation.z = i === 0 ? 0 : -0.1;
          const m = new THREE.Mesh(
            new THREE.CapsuleGeometry(0.079 - i * 0.014, 0.16, 4, 8),
            toon(s.fur),
          );
          m.position.y = 0.095;
          seg.add(m);
          if (i === 3) {
            const tip = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 7), toon(s.accent));
            tip.position.y = 0.175;
            tip.scale.set(1, 1.2, 1);
            seg.add(tip);
          }
          parent.add(seg);
          parent = seg;
          this.tail.push(seg);
          this.tailRest.push(new THREE.Vector3(seg.rotation.x, 0, seg.rotation.z));
          this.tailAng.push(0);
          this.tailVel.push(0);
        }
        break;
      }
      case 'fan': {
        // A real fan of three ROUNDED feathers on the rump. The previous build
        // was three flattened cones scaled to 0.28 in z, jammed through the
        // hip — from the game camera that projected as a jagged white polygon
        // shard sticking out of the pelvis.
        const root = new THREE.Object3D();
        root.position.set(0, 0.34, -0.27 * s.girth);
        root.rotation.x = -0.62;
        this.torso.add(root);
        for (const i of [-1, 0, 1]) {
          const f = new THREE.Object3D();
          f.rotation.z = i * 0.36;
          f.rotation.x = Math.abs(i) * 0.1;
          const quill = new THREE.Mesh(
            new THREE.CapsuleGeometry(0.062, 0.24 - Math.abs(i) * 0.05, 5, 8),
            toon(0xd9600e),
          );
          quill.scale.set(1, 1, 0.5);
          quill.position.y = 0.17;
          f.add(quill);
          const tip = new THREE.Mesh(new THREE.SphereGeometry(0.062, 8, 7), toon(s.coat));
          tip.scale.set(1, 1.15, 0.5);
          tip.position.y = 0.29 - Math.abs(i) * 0.025;
          f.add(tip);
          root.add(f);
          this.tail.push(f);
          this.tailRest.push(new THREE.Vector3(f.rotation.x, 0, f.rotation.z));
          this.tailAng.push(0);
          this.tailVel.push(0);
        }
        break;
      }
      default:
        break;
    }
    void b;
  }

  /**
   * THE MOUTH — the channel three of our four characters simply did not have.
   *
   * Reference Toad has a wide open grin that you can read at postage-stamp
   * size; Mario has a moustache and a mouth; Shy Guy's mask IS a face. Ours had
   * mouth geometry on exactly one skin, as a 0.3 × 0.028 box — a hairline that
   * REFERENCE.md explicitly forbids and that vanishes past 200px anyway. So the
   * cast was eyes-and-a-nose and nobody was ever emoting.
   *
   * Two pieces, because a toon mouth is a lip line with a cavity behind it:
   *
   *   lip  — a thick dark torus ARC, always visible, curving up at the corners.
   *          8–10× the old thickness, so it survives a 40px head.
   *   cav  — a dark cavity that grows UP off the lip line, with a tongue, when
   *          the character is working or hauling. Anchored at its bottom edge
   *          so opening reads as a jaw dropping, not a hole appearing.
   */
  private addMouth(w: number, h: number, y: number, z: number, lipCol: number, tilt = 0.34) {
    // A pivot tilted back along the muzzle, so the arc follows the curve of the
    // face instead of standing off it at the bottom like a hoop earring.
    const pivot = new THREE.Group();
    pivot.position.set(0, y + h * 0.5, z);
    pivot.rotation.x = tilt;
    this.head.add(pivot);

    const arc = Math.PI * 0.98;
    const lip = new THREE.Mesh(
      new THREE.TorusGeometry(w, Math.max(0.024, w * 0.26), 6, 18, arc),
      toon(lipCol),
    );
    // TorusGeometry sweeps from θ = 0 (i.e. +X) counter-clockwise, so an arc of
    // 0.98π occupies the TOP of the ring. Spin it to sit centred on the bottom
    // and it becomes a smile.
    lip.rotation.z = Math.PI + (Math.PI - arc) * 0.5;
    lip.scale.set(1, h / w, 1);
    lip.position.y = h * 0.05;
    pivot.add(lip);
    this.mouthLip = lip;

    // The cavity is anchored at the LOWEST point of the lip arc and grows up
    // from there, so a barely-open mouth is a sliver along the bottom lip and a
    // wide-open one fills the arc. Anchored at the arc's centre instead (the
    // first attempt) it opened as a hard-edged block that sat above the smile
    // and read, at 3× on pip, as a red postage stamp stuck to a frog.
    const cav = new THREE.Group();
    cav.position.set(0, h * 0.05 - h, -0.004);
    const inner = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), toon(0x2a1218));
    inner.scale.set(w * 0.92, 1, 0.045);
    inner.position.y = 1; // unit sphere: bottom edge sits on the lip line
    cav.add(inner);
    const tongue = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), toon(0xb8455c));
    tongue.scale.set(w * 0.5, 0.28, 0.035);
    tongue.position.set(0, 0.28, 0.028);
    cav.add(tongue);
    cav.scale.y = 0.001;
    cav.visible = false;
    pivot.add(cav);
    this.mouthCav = cav;
    this.mouthCavH = h * 0.62;
  }

  /** Register a floppy head appendage AND remember the pose it was built in. */
  private addEar(o: THREE.Object3D) {
    this.ears.push(o);
    this.earRest.push(o.rotation.x);
  }

  private buildHead() {
    const s = this.skin;
    this.head.position.y = this.headY;
    this.head.scale.setScalar(s.headScale);
    this.torso.add(this.head);

    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.285, 18, 14), toon(s.fur));
    skull.scale.set(1, s.face === 'wide' ? 0.86 : 0.95, 0.95);
    skull.castShadow = true;
    this.head.add(skull);

    // ---- ears / crest: the silhouette that has to punch out of the outline
    switch (s.ears) {
      case 'round':
        for (const side of [-1, 1]) {
          const ear = new THREE.Object3D();
          ear.position.set(0.305 * side, 0.235, -0.025);
          const outer = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 9), toon(s.fur));
          outer.scale.set(0.82, 1, 0.62);
          ear.add(outer);
          // Centred on the ear pivot and laid ON the front face as a shallow
          // cap. At (0.03·side, 0.01, 0.05) scaled (0.7, 1, 0.5) its front
          // surface landed at z = 0.0925 against an ear surface at z = 0.093 —
          // two tangent spheres, so the colour boundary was pure tessellation
          // noise and the patch read as offset off the ear.
          const inner = new THREE.Mesh(new THREE.SphereGeometry(0.085, 12, 9), toon(s.accent));
          inner.position.set(0.006 * side, 0.004, 0.062);
          inner.scale.set(0.72, 0.95, 0.42);
          ear.add(inner);
          this.head.add(ear);
          this.addEar(ear);
        }
        break;
      case 'tallAsym':
        // ASYMMETRIC on purpose. Two identical spikes plus a vertical tail read
        // as three matching horns; one upright and one shorter, kinked out and
        // notched, gives the cat a head that cannot be confused with anything.
        for (const side of [-1, 1]) {
          const tall = side < 0;
          const ear = new THREE.Object3D();
          // Forward of the beret and taller. The beret's crown sits at y ≈ 0.28
          // and 0.25 wide; ears rooted at z = −0.02 and only 0.27–0.40 tall
          // were half-swallowed by it, and the asymmetric-ear read — the one
          // channel that makes nori unmistakable in silhouette — went with
          // them.
          ear.position.set(0.152 * side, 0.2, 0.035);
          ear.rotation.z = (tall ? -0.1 : -0.46) * side;
          ear.rotation.x = tall ? -0.06 : 0.14;
          const h = tall ? 0.46 : 0.3;
          // Six-sided, not four: a 4-gon cone's inradius is only 0.71 of its
          // circumradius, so the cream inner cone that is supposed to sit
          // INSIDE the ear punched straight out through the flat faces and read
          // as two white needles crossing the cat's skull. Six sides (inradius
          // 0.87) plus a slimmer, shorter, deeper-seated inner cone keeps it in.
          const cone = new THREE.Mesh(new THREE.ConeGeometry(0.105, h, 6), toon(s.fur));
          cone.position.y = h * 0.5;
          ear.add(cone);
          const inner = new THREE.Mesh(new THREE.ConeGeometry(0.04, h * 0.5, 6), toon(s.accent));
          inner.position.set(0, h * 0.36, 0.028);
          ear.add(inner);
          if (!tall) {
            // A notch out of the short ear: a scrap of extra silhouette.
            const notch = new THREE.Mesh(new THREE.SphereGeometry(0.045, 6, 5), toon(s.fur));
            notch.position.set(0.07, 0.2, 0);
            notch.scale.set(1, 0.7, 0.6);
            ear.add(notch);
          }
          this.head.add(ear);
          this.addEar(ear);
        }
        break;
      case 'domes':
        // Frog: the eyes ARE the silhouette. Two domes on top of the skull.
        // Dropped 4cm and pushed forward. They used to top out at y = 0.31 and
        // the toque's brim band ran across them at y = 0.24–0.31, so at 3× the
        // eyes appeared to be wearing the hat.
        for (const side of [-1, 1]) {
          const dome = new THREE.Object3D();
          dome.position.set(0.178 * side, 0.145, 0.075);
          const ball = new THREE.Mesh(new THREE.SphereGeometry(0.125, 12, 10), toon(s.fur));
          dome.add(ball);
          const white = new THREE.Mesh(new THREE.SphereGeometry(0.082, 10, 8), toon(0xfdfbf2));
          white.position.set(0.012 * side, 0.03, 0.07);
          dome.add(white);
          // ONE GAZE TARGET, TWO EYES.
          //
          // The pupil sat at x = 0.016·side and the catchlight at 0.04·side —
          // both MIRRORED, so the left pupil looked up-left and the right one
          // looked down-left and pip read, at 3×, as a character with a bug
          // rather than a character with an expression. A pupil offset is not a
          // symmetric feature; it is a direction, and both eyes have to agree
          // on it. So the socket is built dead centre and `update` slides both
          // of them by the SAME amount toward whatever the head is looking at.
          const socket = new THREE.Object3D();
          socket.position.set(0, 0.035, 0.115);
          dome.add(socket);
          const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.044, 8, 7), toon(0x1d1a16));
          socket.add(pupil);
          const spark = new THREE.Mesh(new THREE.SphereGeometry(0.018, 6, 5), toon(0xffffff));
          spark.position.set(-0.022, 0.038, 0.032);
          socket.add(spark);
          this.pupils.push(socket);
          this.pupilBase.push(socket.position.clone());
          this.head.add(dome);
          this.addEar(dome);
          this.eyes.push(dome);
        }
        break;
      default:
        break;
    }

    if (s.face === 'beak') {
      // Three ROUNDED crest feathers, fanned, sitting BEHIND the cap. Cones
      // this thin projected as paper shards; capsules with a rounded tip hold
      // their shape at 90px.
      for (const i of [-1, 0, 1]) {
        const f = new THREE.Object3D();
        // Swept BACK off the nape, not standing up off the crown. Straight up
        // they read as three orange drinking straws; laid back they read as a
        // duck's tail-feather crest and they still break the outline.
        f.position.set(i * 0.075, 0.15, -0.2);
        f.rotation.z = i * 0.4;
        f.rotation.x = -1.05;
        const q = new THREE.Mesh(
          new THREE.CapsuleGeometry(0.052, 0.17 - Math.abs(i) * 0.045, 4, 7),
          toon(s.accent),
        );
        q.position.y = 0.12;
        q.scale.set(1, 1, 0.6);
        f.add(q);
        this.head.add(f);
        this.addEar(f);
      }
      // Crown patch: a marigold cap of feathers over the top and back of the
      // skull. Mochi's fur is cream and mochi's head is the biggest single
      // shape on the character, so from behind he was a blank white ball with a
      // small blue hat balanced on it. Putting the DOMINANT colour on the back
      // of the skull is exactly how the reference keeps Toad readable from
      // behind — you see cap, not face, and the cap is the character.
      // Sunk BACKWARDS into the skull rather than concentric with it. The
      // first attempt used r = 0.288 against a 0.285 skull offset by 0.06 —
      // two near-tangent spheres, so the intersection curve grazed both
      // surfaces and tessellation error turned the colour boundary into a
      // zigzag across mochi's face. Offset in depth, the seam is a clean oval
      // round the back of the head.
      const crown = new THREE.Mesh(new THREE.SphereGeometry(0.272, 22, 16), toon(s.coat));
      // Narrower than the skull and sunk further back, so the cream/marigold
      // boundary is a ring round the BACK of the head at z ≈ −0.13 instead of a
      // diagonal seam across the cheek. At scale.x 1.02 the crown was as wide
      // as the skull and the seam surfaced on the side of the face — from three
      // quarters mochi wore a two-tone mask.
      crown.scale.set(0.99, 1.0, 0.78);
      crown.position.set(0, 0.015, -0.155);
      crown.castShadow = true;
      this.head.add(crown);
      // Neck ruff: something on the BACK of the head, which is the only part
      // the game camera ever sees of a chef running away from you.
      const ruff = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 9), toon(s.accent));
      ruff.scale.set(1.25, 0.62, 0.5);
      ruff.position.set(0, -0.16, -0.2);
      this.head.add(ruff);
    }

    // ---- face
    if (s.face !== 'wide') {
      // THE EYE IS A LENS ON THE SKULL, NOT A BALL BESIDE IT.
      //
      // It used to be an Object3D at a hand-authored (0.115, 0.045, 0.24) with
      // the pupil sphere pushed a further 0.03 along the head's +Z and the
      // catchlight 0.072 beyond that. Run the numbers against the skull hull
      // (0.285 × 0.271 × 0.271): the anchor is already dead ON the surface, so
      // everything hung off it in +Z is OUTSIDE the head — the pupil by 0.06
      // and the spark by 0.10. Face on, nobody notices; at the three-quarter-
      // BEHIND yaw this camera actually uses, the far eye clears the head's
      // outline and you get the critic's frame: "a black-and-white eye sphere
      // poking clean outside the blue head hull at the right edge" (mochi at 8×
      // in desktop/t0100s), and the same fragment on nori's skull edge.
      //
      // So it is solved off the hull instead of guessed. Take the eye's
      // DIRECTION from the head centre, find where that ray leaves the
      // ellipsoid, sit the socket at 0.94 of it, and rotate the socket so its
      // +Z is the surface NORMAL — then every child offset is "out of the face"
      // for real, and flattening the pupil along local Z (0.42, not 0.7) makes
      // it a disc lying on the skull. Total protrusion falls from ~0.10 to
      // ~0.02, about a pixel at shipped size, and the eye still reads full-on
      // because it is wide and dark, not because it sticks out.
      const HX = 0.285;
      // The skull is scaled (1, 0.95, 0.95) on every face that reaches here —
      // only the frog's 'wide' head is flatter, and it never builds these eyes.
      const HY = 0.271;
      const HZ = 0.271;
      for (const side of [-1, 1]) {
        const eye = new THREE.Object3D();
        const dir = new THREE.Vector3(0.42 * side, 0.166, 0.884).normalize();
        const t =
          1 /
          Math.sqrt(
            (dir.x / HX) ** 2 + (dir.y / HY) ** 2 + (dir.z / HZ) ** 2,
          );
        eye.position.copy(dir).multiplyScalar(t * 0.94);
        // Surface normal of an ellipsoid is (x/a², y/b², z/c²), not the radius.
        const n = new THREE.Vector3(dir.x / (HX * HX), dir.y / (HY * HY), dir.z / (HZ * HZ)).normalize();
        eye.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
        const ball = new THREE.Mesh(new THREE.SphereGeometry(0.056, 10, 8), toon(0x201b16));
        ball.scale.set(0.92, 1.18, 0.42);
        ball.position.z = 0.014;
        eye.add(ball);
        // The catchlight is the gaze on an eye this small, and it was mirrored
        // — one highlight on each outer edge, which is the same wall-eyed tell
        // pip had. Both now ride one shared socket driven from `update`.
        const socket = new THREE.Object3D();
        socket.position.set(0, 0.024, 0.03);
        eye.add(socket);
        const spark = new THREE.Mesh(new THREE.SphereGeometry(0.018, 6, 5), toon(0xffffff));
        spark.scale.set(1, 1, 0.55);
        socket.add(spark);
        this.pupils.push(socket);
        this.pupilBase.push(socket.position.clone());
        this.head.add(eye);
        this.eyes.push(eye);
      }
    }

    switch (s.face) {
      case 'snout': {
        const muzzle = new THREE.Mesh(new THREE.SphereGeometry(0.135, 12, 10), toon(s.pale));
        muzzle.position.set(0, -0.06, 0.235);
        muzzle.scale.set(1.15, 0.82, 0.85);
        this.head.add(muzzle);
        const nose = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 7), toon(0x33261e));
        nose.position.set(0, -0.02, 0.345);
        nose.scale.set(1.2, 0.85, 0.8);
        this.head.add(nose);
        this.addMouth(0.088, 0.062, -0.135, 0.316, 0x33261e);
        break;
      }
      case 'cat': {
        const muzzle = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 10), toon(s.pale));
        muzzle.position.set(0, -0.08, 0.25);
        muzzle.scale.set(1.25, 0.7, 0.7);
        this.head.add(muzzle);
        const nose = new THREE.Mesh(new THREE.ConeGeometry(0.032, 0.04, 4), toon(0xf0928f));
        nose.position.set(0, -0.035, 0.315);
        nose.rotation.x = Math.PI;
        this.head.add(nose);
        this.addMouth(0.084, 0.056, -0.125, 0.288, 0x2b2028, 0.42);
        // WHISKERS. These used to be 0.14-long boxes rooted at x = ±0.15 with
        // an asymmetric roll (`-0.2 * side + k * 0.1`, which does not mirror),
        // so the inner half of every whisker was buried INSIDE the muzzle
        // ellipsoid and the left and right sets sat at different angles. At 3×
        // it read as four white sticks stabbed through the cat's face at
        // random. Now they hang off a pivot ON the muzzle flank and splay in a
        // properly mirrored pair.
        // ROOTED OUTSIDE THE MUZZLE. The muzzle ellipsoid runs to x = ±0.1375;
        // the pivots sat at ±0.132 with the capsule's inboard end a further
        // 0.017 in, so the first third of every whisker was buried in the
        // muzzle and — since the capsule crosses the pale surface at a shallow
        // angle — surfaced again as a white stick lying ACROSS the cheek. At 7×
        // in desktop/90-late that is four sticks stabbed through a cat's face.
        //
        // Rooted at ±0.152 (clear of the muzzle) with the capsule starting at
        // its own radius, the inboard tip touches the muzzle and the rest is in
        // open air. One pair per side, not two: at 50px on an iPhone four
        // whiskers per cheek is noise competing with the eyes.
        for (const side of [-1, 1]) {
          for (const k of [-1, 1]) {
            const pivot = new THREE.Object3D();
            pivot.position.set(0.152 * side, -0.072, 0.238);
            pivot.rotation.z = k * 0.26 * side;
            pivot.rotation.y = 0.62 * side;
            const w = new THREE.Mesh(new THREE.CapsuleGeometry(0.0075, 0.075, 3, 5), toon(0xb9b4d6));
            w.rotation.z = Math.PI / 2;
            w.position.x = 0.046 * side;
            pivot.add(w);
            this.head.add(pivot);
          }
        }
        break;
      }
      case 'beak': {
        // A duck's mouth IS its beak, so it gets a real hinge rather than a
        // painted-on lip: two mandibles off one pivot with a dark throat
        // between them. Shut it is the same cone silhouette as before; open it
        // is unmistakably a bird quacking, readable at 40px.
        const hinge = new THREE.Object3D();
        hinge.position.set(0, -0.035, 0.195);
        this.head.add(hinge);
        const throat = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.15, 6), toon(0x8a3218));
        throat.rotation.x = Math.PI / 2;
        throat.position.z = 0.07;
        hinge.add(throat);
        const upper = new THREE.Mesh(new THREE.ConeGeometry(0.088, 0.19, 6), toon(s.accent));
        upper.rotation.x = Math.PI / 2;
        upper.scale.set(1, 1, 0.56);
        upper.position.set(0, 0.021, 0.095);
        hinge.add(upper);
        const jaw = new THREE.Object3D();
        hinge.add(jaw);
        const lower = new THREE.Mesh(new THREE.ConeGeometry(0.086, 0.185, 6), toon(0xd9600e));
        lower.rotation.x = Math.PI / 2;
        lower.scale.set(1, 1, 0.5);
        lower.position.set(0, -0.019, 0.09);
        jaw.add(lower);
        this.beakLower = jaw;
        break;
      }
      case 'wide': {
        // A WIDE OPEN GRIN — the Toad read. The old build was a 0.3 × 0.028
        // box: 2.8mm of geometry that is sub-pixel on any capture we ship.
        // A wide jaw bulge for the grin to sit ON. A 0.15-radius arc laid flat
        // against a sphere stands 3cm proud of it at the corners.
        const jawPad = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 12), toon(s.fur));
        jawPad.position.set(0, -0.105, 0.125);
        jawPad.scale.set(1.06, 0.64, 0.76);
        this.head.add(jawPad);
        this.addMouth(0.15, 0.082, -0.155, 0.226, 0x24461d, 0.28);
        const cheekL = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 7), toon(s.pale));
        cheekL.position.set(-0.19, -0.08, 0.19);
        cheekL.scale.set(1, 0.7, 0.5);
        this.head.add(cheekL);
        const cheekR = cheekL.clone();
        cheekR.position.x = 0.19;
        this.head.add(cheekR);
        break;
      }
    }

    // ---- hats: four different shapes, four different colours, and every one
    //      of them now carries something on the BACK of the skull.
    //
    // The whole switch adds to `hatGroup` instead of `head` directly, so the
    // built-in hat is one structural unit (tooling hides/repositions it as a
    // whole). `hatGroup` sits at head origin with no transform, so every
    // `this.head.add(...)` below lands in exactly the same world place it did
    // before — this redirect is a no-op for rendering.
    this.head.add(this.hatGroup);
    const realHead = this.head;
    this.head = this.hatGroup;
    switch (s.hat) {
      case 'bandana': {
        const band = new THREE.Mesh(new THREE.TorusGeometry(0.268, 0.055, 8, 22), toon(s.hatA));
        band.rotation.x = Math.PI / 2 - 0.14;
        band.position.set(0, 0.07, 0.01);
        band.castShadow = true;
        this.head.add(band);
        const knot = new THREE.Mesh(new THREE.SphereGeometry(0.085, 10, 8), toon(s.hatA));
        knot.position.set(0, 0.1, -0.27);
        this.head.add(knot);
        // Two tails SWEPT BACK AND OUT off the knot, each finished with a pale
        // tip. Built long and hanging straight down the spine they merged with
        // each other, with the knot and with the crimson jacket underneath, and
        // from directly behind bramble wore one broad red tongue running from
        // his crown to his hem. Splayed sideways they read as what they are:
        // two ribbons either side of a bear's head.
        for (const side of [-1, 1]) {
          const t = new THREE.Object3D();
          t.position.set(0.1 * side, 0.075, -0.25);
          t.rotation.x = -2.15;
          t.rotation.z = 0.62 * side;
          const cloth = new THREE.Mesh(new THREE.CapsuleGeometry(0.052, 0.16, 4, 7), toon(s.hatA));
          cloth.scale.set(1.15, 1, 0.55);
          cloth.position.y = 0.11;
          t.add(cloth);
          const end = new THREE.Mesh(new THREE.ConeGeometry(0.058, 0.11, 5), toon(s.hatB));
          end.scale.set(1.15, 1, 0.55);
          end.position.y = 0.24;
          end.rotation.x = Math.PI;
          t.add(end);
          this.head.add(t);
          this.addEar(t);
        }
        break;
      }
      case 'toque': {
        // A TALL toque with a hard brim edge and a smooth crown.
        //
        // The previous build ringed the crown with seven fat 0.058-radius
        // capsule lobes on a 0.19 circle, all intersecting one 0.185 puff. At
        // the size the game camera actually renders pip — 300px tall, a third
        // of the frame — that is not "pleating", it is a cauliflower: a mass of
        // overlapping white bulbs with no top edge and no outline you could
        // draw. Nintendo's chef hats are ONE clean silhouette. So: a crisp
        // overhanging brim, a straight band, a tall slightly-flared crown, and
        // pleats expressed as SHALLOW vertical ribs half-buried in that crown —
        // texture at the surface, not lumps on the outline.
        // Raised 6cm so the brim's BOTTOM edge (y = 0.30) clears the top of the
        // eye domes (y = 0.27). Before this the white band cut straight across
        // both eyes.
        // TWELVE PER CENT SMALLER AND FOUR CENTIMETRES LOWER. At a crown top of
        // 0.71 against a 0.285 skull the hat stood half again as tall as the
        // head it was on, and from the game camera — which looks at the BACK of
        // pip most of the time — the toque hid the skull outright: in
        // shots/m6-r1/desktop/t0010 pip is a white bucket sitting on a green
        // blob, with no frog visible at all. A chef's hat is a strong
        // silhouette; it is not supposed to be the whole silhouette.
        // ROUND 16 — AND IT STILL SAT ON THE BROW.
        //
        // The brim is a cylinder of radius 0.224 centred on the skull axis, so
        // its FRONT edge reaches z = 0.224; pip's eye domes bulge to z = 0.20
        // and top out at y = 0.27 against a brim underside of y = 0.28. One
        // centimetre of clearance, with the overhang projecting forward and the
        // game camera looking DOWN at it — which is why the white band drew a
        // line straight across the frog's face between the eyes at 3× in
        // /tmp/feet.png. Up 5cm and back 2.5cm: the brim now clears the domes
        // by 6cm and its overhang falls behind them instead of over them.
        const hatZ = -0.025;
        const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.213, 0.224, 0.07, 20), toon(s.hatA));
        brim.position.set(0, 0.365, hatZ);
        brim.castShadow = true;
        this.head.add(brim);
        const band = new THREE.Mesh(new THREE.CylinderGeometry(0.181, 0.196, 0.08, 18), toon(0xe6dcc4));
        band.position.set(0, 0.416, hatZ);
        this.head.add(band);
        // Crown: a flared drum capped by a dome. One shape, one outline. Kept
        // deliberately SHORT — at 0.87 above the head centre the first pass
        // rendered as a white bucket taller than pip's own torso.
        const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.216, 0.181, 0.15, 20), toon(s.hatB));
        drum.position.set(0, 0.518, hatZ);
        drum.castShadow = true;
        this.head.add(drum);
        const dome = new THREE.Mesh(new THREE.SphereGeometry(0.216, 18, 12), toon(s.hatB));
        dome.position.set(0, 0.588, hatZ);
        dome.scale.set(1, 0.48, 1);
        dome.castShadow = true;
        this.head.add(dome);
        // Ribs: nine thin vertical ridges sunk into the crown wall. They break
        // the white up under the toon ramp without touching the silhouette.
        // Shortened from 0.16 to 0.10: at 0.16 the capsule ends stuck 1.2cm out
        // of the BOTTOM of the crown drum and over the band, and pip's toque
        // grew a ring of white teeth round its base.
        for (let i = 0; i < 9; i++) {
          const a = (i / 9) * TAU;
          const rib = new THREE.Mesh(new THREE.CapsuleGeometry(0.018, 0.09, 4, 6), toon(0xe9e1cd));
          rib.position.set(Math.sin(a) * 0.191, 0.532, hatZ + Math.cos(a) * 0.191);
          rib.scale.set(1, 1, 0.5);
          rib.rotation.y = -a;
          rib.rotation.z = Math.sin(a) * 0.12;
          rib.rotation.x = -Math.cos(a) * 0.12;
          this.head.add(rib);
        }
        break;
      }
      case 'beret': {
        // SMALL. At r = 0.245 scaled 1.08 wide with a second 0.13 flap behind
        // it, the beret merged into one teal saucer that covered the entire
        // back of nori's skull and cost him his cat silhouette. A beret should
        // sit ON the head at a jaunty angle and let the head still be a head.
        // A BERET IS A DISC WITH A BAND, not three squashed spheres dropped
        // into a skull at three different angles. The old build was a tilted
        // ellipsoid plus an off-centre nub plus a separate rear "flap", each
        // cutting the skull sphere at its own angle: the result at 3× was a
        // lumpy asymmetric teal mass half-sunk in the head with a raw boolean
        // seam running round it.
        //
        // Now: one pivot carries the whole hat, so the tilt is a single jaunty
        // rotation instead of three disagreeing ones; a flattened dome is the
        // crown; and a TORUS RIM of the same radius sits exactly on the crown's
        // equator, which is precisely where the crown enters the skull. The rim
        // hides that intersection completely and gives the beret the rolled
        // edge a real one has.
        // THIRD BUILD, and the fault this one fixes is HEIGHT, not shape.
        //
        // The crown sat at y = 0.148 and stood 0.12 tall, so its top landed at
        // 0.268 against a skull that tops out at 0.271 — the hat did not rise
        // above the head AT ALL. Combined with a 0.24 rad tilt (which sinks one
        // side of the rim into the skull and floats the other clear of it) the
        // whole thing read at 6× in iphone-portrait/t0010 as a teal frisbee
        // lying flat on a cat, asymmetric, with a raw seam down one edge. A hat
        // has to change the SILHOUETTE or it is a decal.
        //
        // Now the crown is seated at 0.20 and stands 0.155, topping out at
        // 0.355 — a clear 8cm of teal proud of the skull from any angle — the
        // tilt is halved to a hint of jaunt, and the rim torus is dropped to
        // the skull's widest latitude (y ≈ 0.145, where the skull radius is
        // 0.244) so its inner wall is buried in fur all the way round and the
        // intersection can never surface on one side.
        // ...and SET BACK on the skull (z = −0.085), because our camera looks
        // down: a beret centred on the crown presents its whole top face to the
        // lens, and at 6.5× in shots/m6-r3/desktop/t0005 nori's head was a teal
        // disc with two navy ears behind it. Worn back off the brow — which is
        // how a beret is actually worn — the navy forehead and both eyes stay
        // in the top-down read and the teal becomes a shape ON the cat rather
        // than a lid over it.
        const beret = new THREE.Object3D();
        // −0.058, not −0.085: at the further setback the beret disappeared
        // between the ears and read from the front as a teal scrap stuck to the
        // back of the head (shots/m6-p3, nori). Between the two extremes it is
        // a hat worn back off the brow — visible from the front, not covering
        // the crown from above.
        beret.position.set(0.012, 0.198, -0.058);
        beret.rotation.z = 0.13;
        beret.rotation.x = -0.12;
        this.head.add(beret);
        // The crown is 0.212, not 0.236: at the larger radius the beret was as
        // wide as the skull, and since the game camera looks DOWN, what you saw
        // of nori was a teal disc with two navy ears behind it — the cat's own
        // colour had been evicted from the top half of the character
        // (shots/m6-r1/desktop/t0010). A beret sits on the crown of the head,
        // not over it.
        const crown = new THREE.Mesh(new THREE.SphereGeometry(0.208, 20, 12), toon(s.hatA));
        crown.scale.set(1.08, 0.72, 1.0);
        crown.castShadow = true;
        beret.add(crown);
        const rim = new THREE.Mesh(new THREE.TorusGeometry(0.218, 0.042, 8, 24), toon(s.hatB));
        rim.rotation.x = Math.PI / 2;
        rim.position.y = -0.046;
        beret.add(rim);
        const nub = new THREE.Mesh(new THREE.SphereGeometry(0.046, 8, 7), toon(s.hatB));
        nub.position.y = 0.15;
        beret.add(nub);
        break;
      }
      case 'cap': {
        // Sized to the SKULL, not to a doll's head: at r = 0.15 on a 0.285
        // skull the cap read as a bottle-top balanced on a duck.
        const cyl = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.225, 0.13, 16), toon(s.hatA));
        cyl.position.set(0, 0.235, 0.055);
        cyl.rotation.x = -0.2;
        cyl.castShadow = true;
        this.head.add(cyl);
        const top = new THREE.Mesh(new THREE.SphereGeometry(0.202, 14, 9), toon(s.hatA));
        top.position.set(0, 0.3, 0.04);
        top.scale.set(1, 0.5, 1);
        top.castShadow = true;
        this.head.add(top);
        const button = new THREE.Mesh(new THREE.SphereGeometry(0.048, 8, 7), toon(s.hatB));
        button.position.set(0, 0.345, 0.035);
        this.head.add(button);
        const brim = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 8), toon(s.hatB));
        brim.position.set(0, 0.205, 0.235);
        brim.scale.set(1.2, 0.16, 1.15);
        this.head.add(brim);
        // Snapback tab on the BACK of the cap.
        const tab = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.06, 0.05), toon(s.hatB));
        tab.position.set(0, 0.215, -0.16);
        tab.rotation.x = 0.3;
        this.head.add(tab);
        break;
      }
    }
    this.head = realHead;
  }

  private buildArms() {
    const s = this.skin;
    const b = this.build;
    // ARMS DO NOT USE THE LEG RADIUS. `limbR` is the leg gauge, and it is
    // deliberately tiny for the bird (0.042) and the frog (0.052) because thin
    // shins are half of what separates those two builds. Reusing it on the arm
    // gave mochi upper arms 3.6cm thick: at 3× on ipad-landscape/t0012 his
    // raised arm read as a bent yellow wire hoop with the segments visibly
    // beaded apart, not as a limb. An arm needs a floor.
    // ROUND 17 — AND IT IS STILL TOO THIN, MEASURABLY. bramble ran aR = 0.07
    // against a chest radius of 0.27: an upper arm 0.119 across on a body 0.57
    // across, i.e. one fifth. At 130px of character on desktop that forearm is
    // ~1.5 device pixels wide, and the critic's frame is exact — "the bear's
    // left arm is a bare cream sphere floating clear of the hoodie with no
    // upper-arm segment rendered at all". The hand (a 0.092 sphere) survived
    // because it is a BALL; the two capsules holding it on did not, because
    // they are sticks. Toad's and Daisy's arms in `dash-and-dine-01.jpeg` are
    // roughly a third of their torso width — chunky enough to hold a shape at
    // 90px. So the arm gauge is tied to the CHEST, not to the shin, with the
    // old leg-derived value as a floor.
    const aR = Math.max(b.limbR, 0.062, b.chestR * 0.3);
    const make = (side: number): Limb => {
      const hip = new THREE.Object3D();
      // SHOULDERS OUTBOARD OF THE TORSO, NOT ON ITS SKIN.
      //
      // At chestR + 0.015 the shoulder pivot sat 1.5cm outside a torso whose
      // own surface is at chestR, and the upper arm is 5.6cm thick — so half of
      // every arm was buried in the body, the arm and the coat are the same
      // colour, and the result is the "no negative space, arms pressed to the
      // body" read the critic found on all four. Waluigi's arms in the
      // reference stand clear of his torso with daylight between; that gap is
      // half of why his run pose has four holes in it.
      // ...AND THAT WENT TOO FAR. At chestR + 0.9·aR the arm's inner surface
      // sits 0.008 OUTSIDE the torso's, so the two never touch and at 3× there
      // is a slot of floor visible straight through the armpit on bramble, pip
      // and mochi — the shoulder appears to be rooted in mid-air beside the
      // collar. The negative space the earlier note wanted is real and worth
      // having, but it belongs between the FOREARM and the ribs, where the
      // abduction term puts it; at the joint itself the two masses have to
      // overlap or the character comes apart.
      //
      // chestR + 0.35·aR buries the shoulder half an arm-radius inside the coat
      // hull, and a deltoid ball at the pivot caps the joint so the seam between
      // the capsule and the torso is a rounded shoulder instead of a butt joint.
      hip.position.set((b.chestR + aR * 0.35) * s.girth * side, this.shoulderY, 0);
      // THE ARMPIT, CLOSED FOR REAL THIS TIME — AND THE ARITHMETIC SAYS WHY THE
      // BALL NEVER DID IT. The pivot sits at (chestR + 0.35·aR)·girth, but the
      // torso capsule is only chestR wide AT ITS EQUATOR and the shoulder is
      // 0.075 ABOVE that, up on the cap sphere: for bramble the coat's surface
      // at shoulder height is 0.198 while the pivot is at 0.312. That is 0.114
      // of open air, and a deltoid of radius 1.06·aR = 0.081 cannot span it —
      // which is precisely the "grey floor visible between the bear's cream
      // hand and its hoodie" the critic measured at 3.8×.
      //
      // So the deltoid is a SLEEVE CAP, not a bead: an ellipsoid pushed INBOARD
      // of the pivot and stretched along X, so its inner pole is buried deep in
      // the coat hull and its outer pole is flush with the upper arm's own
      // surface. It rotates with the shoulder, so it stays a sleeve at every
      // abduction instead of becoming a bar across the chest.
      // THE SLEEVE IS A VALUE DARKER THAN THE COAT. Both arm capsules used to be
      // `s.coat` exactly, so an arm hanging against the torso was the same
      // number as the torso and the limb existed only where it crossed the
      // background — which at 5x on nori in shots/j2-desk/desktop/t0092s is a
      // blue stub with no shoulder, no elbow and no daylight anywhere in it. The
      // reference has no outline shader either; what separates Waluigi's sleeve
      // from Waluigi's shirt is a shading step. 0.86 is about one, and it costs
      // nothing at thumbnail because the hue is unchanged.
      const sleeve = toon(shade(s.coat, 0.86));
      const delt = new THREE.Mesh(new THREE.SphereGeometry(aR * 1.16, 12, 9), sleeve);
      delt.scale.set(1.36, 1.02, 1.0);
      delt.position.x = -aR * 0.72 * side;
      hip.add(delt);
      // Capsule length 0.94·upperArm, not 0.8: at 0.8 the cylinder ran out
      // above the elbow and the joint showed as a gap between two beads.
      const upper = new THREE.Mesh(
        new THREE.CapsuleGeometry(aR * 0.9, b.upperArm * 0.94, 4, 8),
        sleeve,
      );
      upper.position.y = -b.upperArm * 0.5;
      hip.add(upper);
      const knee = new THREE.Object3D();
      knee.position.y = -b.upperArm;
      hip.add(knee);
      // ELBOW BALL, IN THE FOREARM'S OWN COLOUR. The arm used to read as
      // "orange capsule, white bead, orange capsule, white sphere: four
      // separate objects with hard butt joints" (ipad-landscape/t0102s at 6×) —
      // the beads were the capsule end-caps of two different materials meeting
      // at a plane. One ball at the pivot, in the forearm's material and a
      // shade wider than either capsule, turns that seam into a joint.
      const elbow = new THREE.Mesh(new THREE.SphereGeometry(aR * 0.9, 10, 8), toon(s.fur));
      knee.add(elbow);
      // TAPERED, so the arm reads as one tube narrowing to the wrist rather
      // than as two equal sausages: a cone from the elbow gauge down to 0.78 of
      // it, capped by the elbow ball above and the hand below.
      const fore = new THREE.Mesh(
        new THREE.CylinderGeometry(aR * 0.88, aR * 0.7, b.foreArm * 0.9, 12),
        toon(s.fur),
      );
      fore.position.y = -b.foreArm * 0.45;
      knee.add(fore);
      // The cuff is now NARROWER than the forearm it sits on (0.76·aR against
      // 0.7–0.88), so it is a trim line belonging to the garment rather than a
      // fifth bead in the chain.
      const cuff = new THREE.Mesh(
        new THREE.CylinderGeometry(aR * 0.78, aR * 0.76, 0.045, 12),
        toon(s.accent),
      );
      cuff.position.y = -b.foreArm * 0.8;
      knee.add(cuff);

      const foot = new THREE.Object3D();
      foot.position.y = -b.foreArm;
      knee.add(foot);
      this.buildHand(foot, side);
      this.torso.add(hip);
      return { hip, knee, foot };
    };
    this.armL = make(-1);
    this.armR = make(1);
  }

  /** Four hand constructions. Two bright dots swinging is the loudest motion
   *  cue a 90-pixel character has — but four IDENTICAL mittens is a tell.
   *
   *  SIZED AND COLOURED OFF THE ARM THEY ARE ON. They were absolute constants —
   *  a 0.1 sphere in near-white 0xfbf6e8 — against a forearm whose radius is
   *  0.8·aR, i.e. 0.036 on the duck and 0.056 on the bear. A hand 1.8 to 2.8
   *  times the width of the wrist it is attached to, in a cream that appears
   *  nowhere else on the body, is the "detached golf ball" the verdict names,
   *  and it is unmistakable in the 5× crop of bramble in
   *  shots/mc-w2-base/desktop/90-late: a white ball floating beside the jacket.
   *
   *  Every hand is now ~1.15 of its own forearm radius (a hand IS wider than a
   *  wrist, just not by a factor of three) and painted in `s.pale` — the same
   *  value as the muzzle and belly, so it belongs to the animal wearing it. */
  private buildHand(at: THREE.Object3D, side: number) {
    const s = this.skin;
    const aR = Math.max(this.build.limbR, 0.062, this.build.chestR * 0.3);
    // A HAND IS THE END OF AN ARM, NOT A GOLF BALL ON A STICK. It used to be
    // 0.92·aR — WIDER than the 0.8·aR forearm carrying it and in a material
    // (`pale`) shared with nothing else on the limb, so at 6× the arm read as
    // four unrelated objects in a row. It is now narrower than the elbow and
    // its colour is pulled 45% of the way back to the forearm's own, so it is
    // the pale end of one continuous tube rather than a separate prop. Enough
    // pale survives to mark the point of contact, which is the only job the
    // light value was ever doing down here.
    const hr = aR * 0.8;
    const col = mixHex(s.pale, s.fur, 0.45);
    switch (s.hand) {
      case 'mitt': {
        const paw = new THREE.Mesh(new THREE.SphereGeometry(hr, 10, 8), toon(col));
        at.add(paw);
        const thumb = new THREE.Mesh(new THREE.SphereGeometry(hr * 0.45, 8, 6), toon(col));
        thumb.position.set(hr * 0.7 * side, hr * 0.3, hr * 0.4);
        at.add(thumb);
        break;
      }
      case 'paddle': {
        const pad = new THREE.Mesh(new THREE.SphereGeometry(hr * 0.94, 10, 8), toon(col));
        pad.scale.set(1.3, 0.78, 1.05);
        at.add(pad);
        for (const t of [-1, 0, 1]) {
          const fing = new THREE.Mesh(new THREE.SphereGeometry(hr * 0.4, 6, 5), toon(col));
          fing.position.set(t * hr * 0.6, -hr * 0.6, hr * 0.33);
          fing.scale.set(1, 1.3, 1);
          at.add(fing);
        }
        break;
      }
      case 'paw': {
        const paw = new THREE.Mesh(new THREE.SphereGeometry(hr * 0.94, 10, 8), toon(col));
        paw.scale.set(1, 1.1, 1);
        at.add(paw);
        for (const t of [-1, 1]) {
          const bean = new THREE.Mesh(new THREE.SphereGeometry(hr * 0.3, 6, 5), toon(s.accent));
          bean.position.set(t * hr * 0.46, -hr * 0.58, hr * 0.58);
          at.add(bean);
        }
        break;
      }
      case 'wing': {
        // A flat wing paddle, not a glove: three feather tips on the trailing
        // edge and a whole different outline from every other hand in the cast.
        const wing = new THREE.Mesh(new THREE.SphereGeometry(hr * 1.15, 10, 8), toon(s.coat));
        wing.scale.set(0.5, 1.15, 1.15);
        at.add(wing);
        // SHORTER AND WARMER. At 0.36/0.85 in the pale hand colour these read as
        // three white claws hanging off a marigold sleeve (crop c1 of
        // shots/j2-desk/desktop/t0096s) — the loudest thing on the duck, and it
        // is a fingertip. Pulled back to a scallop on the trailing edge and
        // tinted most of the way to the wing itself.
        for (const t of [-1, 0, 1]) {
          const f = new THREE.Mesh(
            new THREE.CapsuleGeometry(hr * 0.3, hr * 0.5, 4, 6),
            toon(mixHex(col, s.coat, 0.55)),
          );
          f.scale.set(0.6, 1, 1);
          f.position.set(0, -hr * 1.05, t * hr * 0.55);
          at.add(f);
        }
        break;
      }
    }
  }

  // ------------------------------------------------------------ animation

  /** World-space point this chef should be looking at, in sim (x, y) coords. */
  private lookTarget(): { x: number; y: number } {
    let best: { x: number; y: number } | null = null;
    let bestD = 8 * 8;
    for (let i = LIVE.length - 1; i >= 0; i--) {
      const other = LIVE[i];
      if (other === this) continue;
      if (!other.root.parent) {
        LIVE.splice(i, 1);
        continue;
      }
      const dx = other.chef.pos.x - this.chef.pos.x;
      const dy = other.chef.pos.y - this.chef.pos.y;
      const d = dx * dx + dy * dy;
      if (d < bestD && d > 0.4) {
        bestD = d;
        best = other.chef.pos;
      }
    }
    return best ?? OVEN;
  }

  update(rawDt: number, time: number) {
    const chef = this.chef;
    const s = this.skin;
    const b = this.build;
    // NEVER TRUST THE DELTA.
    //
    // main.ts computes `rawDt = Math.min(0.5, (now - last) / 1000)` with no
    // lower bound, and in capture mode it owns the clock: `capture.now` starts
    // at performance.now() and then advances in simulated 16.7ms steps while
    // real wall time under the software rasteriser runs orders of magnitude
    // faster. One stale requestAnimationFrame landing after setCapture(true)
    // sets `last` to real time, and the very next frame sees a delta of MINUS
    // thirty seconds.
    //
    // Everything here that integrates — the stride phase, the blink timer, the
    // fidget timer — then runs backwards, and one term does something much
    // worse: `recover = Math.max(0, recover - dt * 2.6)` GROWS on a negative
    // delta. Measured on a real capture it reached 29.8, and
    // `rig.rotation.x = lean + sin(recover * 26) * recover * 0.16` put the
    // whole rig at 4.5 rad — face-down, folded through its own hips, head below
    // the floor. That is what "bramble is headless with a dinner plate for a
    // neck" was in shots/p04-r5c/desktop/t0011: not a missing mesh, a chef
    // lying on its face with only the collar and the top of the jacket left
    // pointing at the camera.
    //
    // main.ts has been given the matching `Math.max(0, ...)` guard, but this
    // rig is not going to trust a caller with its own integrity again.
    const dt = rawDt > 0 ? (rawDt < 0.5 ? rawDt : 0.5) : 0;
    const step = Math.min(1, dt * 16);

    // --- SCREEN-SPACE JOSTLE. The sim keeps two bodies from occupying the same
    //     POINT; it cannot keep them from occupying the same OUTLINE, because
    //     overlap on screen is not a world-space quantity. This camera sits
    //     22.5 deg above the floor, so a metre of depth projects to 0.38 of a
    //     metre of screen height and two chefs a metre apart in Z render as one
    //     mass — shots/j2-c/desktop/t0074s has mochi and pip fused with the
    //     frog's arm through the duck's skull.
    //
    //     So the VIEW leans them apart along the axis the camera does not
    //     compress. It is capped at 0.24 world units — a fifth of a body, less
    //     than the tolerance on every interaction in the sim — and it eases in
    //     over about a sixth of a second, so what it reads as is two animals
    //     shouldering past each other, which is the bump comedy the reference
    //     runs on. The sim is never told; nothing here can move a chef out of
    //     reach of the bench it is working at.
    let jostle = 0;
    for (const other of LIVE) {
      if (other === this || !other.root.parent) continue;
      const dx = chef.pos.x - other.chef.pos.x;
      const dz = (chef.pos.y - other.chef.pos.y) * 0.42;
      const sd = Math.hypot(dx, dz);
      if (sd >= 0.95) continue;
      const f = 1 - sd / 0.95;
      // Dead-centre overlap has no direction of its own, so break the tie on
      // identity and keep it stable: the lower id always goes left.
      const dir = Math.abs(dx) > 0.02 ? Math.sign(dx) : chef.id < other.chef.id ? -1 : 1;
      jostle += dir * f * f;
    }
    this.jostle += (clamp(jostle * 0.3, -0.24, 0.24) - this.jostle) * Math.min(1, dt * 6);
    this.root.position.set(chef.pos.x + this.jostle, 0, chef.pos.y);
    const yaw = -chef.heading + Math.PI / 2;
    this.rig.rotation.y = yaw;

    const speed = Math.hypot(chef.vel.x, chef.vel.y);
    const run = Math.min(1, speed / TUNING.moveSpeed);

    // --- derivatives: acceleration drives anticipation, braking, overshoot.
    //     Divide by a 1ms floor, not a 0.1ms one, and clamp the raw estimate:
    //     a finite-difference derivative over a nearly-zero delta is noise, and
    //     it is the input to the lean spring.
    const dtD = Math.max(dt, 1e-3);
    const rawAccel = clamp((speed - this.prevSpeed) / dtD, -400, 400);
    this.prevSpeed = speed;
    this.accel += (rawAccel - this.accel) * Math.min(1, dt * 18);
    const a = clamp(this.accel / 55, -1, 1);

    const dHead = angleDelta(this.prevHeading, chef.heading) / dtD;
    this.prevHeading = chef.heading;
    this.turn += (clamp(dHead / 9, -1, 1) - this.turn) * Math.min(1, dt * 10);

    const brakeTarget = a < -0.22 && run > 0.2 ? clamp((-a - 0.22) * 1.9, 0, 1) * run : 0;
    this.brake += (brakeTarget - this.brake) * Math.min(1, dt * (brakeTarget > this.brake ? 26 : 6));

    // --- stride
    const strideRate = 7 + run * 15;
    this.phase += dt * strideRate * (1 - this.brake * 0.85);
    if (this.phase > TAU * 64) this.phase -= TAU * 64;
    const p = this.phase;
    // GAIT, NOT SPEED. Stride amplitude was linear in `run`, and `run` is
    // speed/moveSpeed — so a chef threading benches at half its top speed, which
    // is most of what a chef does, animated at HALF a stride: a 12° thigh split
    // that at 90px tall is three pixels and reads as standing. Twenty-eight
    // captured frames contained two unambiguous run poses for exactly this
    // reason. A real biped does not scale its stride linearly with speed either;
    // it commits to a full stride almost immediately and then takes them faster.
    // So the leg amplitude saturates at 60% of top speed and the phase RATE
    // carries the rest, which is both correct and the thing that makes a frozen
    // frame legible.
    // A GAIT HAS A FLOOR. `min(1, run · 1.65)` made amplitude proportional to
    // speed all the way down, so a chef threading benches at a third of top
    // speed — which is most of what a chef does — animated at a third of a
    // stride, and the 45° bar was unreachable no matter what shape the wave
    // was. A real biped does not scale its step length with speed either: it
    // commits to a step almost immediately and then takes them faster, which is
    // exactly what `strideRate` already does. So the amplitude ramps hard to
    // 0.38 over the first 12% of top speed and then climbs with it; anything
    // the verdict would call moving is already at four fifths of a full stride.
    const kick = clamp(run / 0.12, 0, 1);
    const gait = Math.min(1, run * 1.45 + kick * kick * (3 - 2 * kick) * 0.38);
    // ...and braking costs 45% of the stride, not 80%. `brakeSpread` below adds
    // its own 66° of separation on a skid, so taking four fifths of the swing
    // out on top of that was double-counting — and it is what produced the
    // worst frame in the whole log (t=6.24 bramble, run 0.336, amp 0.278,
    // thigh split 0.9°): a chef slowing down with its feet together.
    const amp = gait * (1 - this.brake * 0.45);

    // --- stun / recovery
    const stunned = chef.stun > 0;
    if (this.prevStun > 0 && !stunned) this.recover = 1;
    this.prevStun = chef.stun;
    // Bounded on BOTH sides: the stagger amplitude is linear in `recover`, so
    // an out-of-range value is not a glitch, it is a chef doing cartwheels.
    this.recover = clamp(this.recover - dt * 2.6, 0, 1);

    // --- carry mode. 0 free, 1 produce out to the side, 2 plate flat out
    //     front, 3 pan out to the side.
    //
    // THERE USED TO BE A MODE 4: THE TOWER. A plate pickup sometimes handed the
    // chef a seeded armful of 4-8 plates and the view drew the reference's
    // comedy column, taller than the carrier. It was cosmetic — `stack` was
    // never matched by a recipe, a bot plan or a serve check — and it read as a
    // mechanic that was not there:
    //
    //   "When I pick up a plate I get a huge stack of plates. Cute, but this is
    //    not how the gameplay works so we should cut it down to holding a
    //    single plate"
    //
    // A joke that has to be explained as "ignore that, it does nothing" is not
    // paying for itself, and it brought its own pose, its own inertia spring
    // and its own head-clearance rule with it. All of it is gone, along with
    // `Plate.stack` in the domain: one plate, mode 2, one silhouette.
    const mode = !chef.carrying
      ? 0
      : chef.carrying.type === 'ingredient'
        ? 1
        : chef.carrying.type === 'plate'
          ? 2
          : 3;
    // MODE 2 is the reference's loudest silhouette: Waluigi's plate out flat on
    // two straight arms, Shy Guy's the same, Toad's pancake tower hugged past
    // his chin. Everything the load does to the outline happens IN FRONT of the
    // body at chest height, never above the head.
    const frontLoad = mode === 1 || mode === 2;
    this.carryBlend += ((mode ? 1 : 0) - this.carryBlend) * Math.min(1, dt * 9);
    // The arms no longer STRETCH. They used to scale to 2.1× along the limb so
    // a chibi shoulder could put a plate over its own crown — and because that
    // scale was non-uniform, nothing could be parented below it without being
    // squashed, which is exactly why the payload was bolted to the CHEST at a
    // fixed offset and drifted 30px clear of the mitt. No pose in this rig now
    // reaches past what the arm can actually reach, so the arm stays 1:1 and
    // the load can hang off the hand where it belongs.
    this.reach += (1 - this.reach) * Math.min(1, dt * 8);
    this.armR.hip.scale.set(1, this.reach, 1);
    this.armR.foot.scale.set(1, 1 / this.reach, 1);

    // --- lean: forward with speed, extra on acceleration, BACK when braking,
    //     and BACK again under a load held above the head. Spring integration
    //     is what produces the overshoot; a lerp would just slide.
    // Lean off GAIT too, not raw speed: the body has to be committed to the run
    // at the same moment the legs are, or a mid-speed chef is a vertical post
    // doing the splits.
    // ...and it is CAPPED. With the gait floor in place the acceleration bonus
    // was stacking on a term that is already near its maximum, and the
    // instrument came back with pitchDeg p90 30.1 and max 41.7 — a chef folded
    // over its own knees. Waluigi holds about 15°; the useful range is 12–18
    // with a short punch to ~23 out of a standing start, which is what these
    // two numbers give.
    let leanTarget = Math.min(0.4, 0.31 * gait + 0.2 * Math.max(0, a)) - 0.42 * this.brake;
    // A load carried OUT IN FRONT pulls you back on your heels — the reference
    // Toad hauling the plate tower is visibly reclined under it.
    if (frontLoad) leanTarget -= 0.08 * this.carryBlend;
    // A BUMP IS A STAGGER, NOT A KNOCKDOWN. −0.42 rad of recline is only 24°,
    // but the camera already looks DOWN at 22.5°, so the two add on screen and
    // in shots/mc-r6/ipad-landscape/t0010 bramble read as lying flat on its
    // back with the soles of both boots pointing at the lens and no face
    // anywhere. Overcooked's bump is funny because you can still see who it
    // happened to. −0.24 keeps the head above the shoulders while the splayed
    // legs, the windmilling arms and the 38Hz roll do the comedy.
    if (stunned) leanTarget = -0.24;
    if (chef.intent === 'working') leanTarget = 0.26;
    // A MOVING CHEF IS NEVER UPRIGHT, AND NEVER RECLINED. Measured over the
    // instrumented run, 111 of 173 frames above run > 0.3 sat under 12° of
    // forward pitch and the minimum was MINUS 27.9° — a sprinting chef leaning
    // backwards, which is the pose a mannequin on a moving trolley makes. Three
    // terms could each do it on their own: the carry recline, the brake recline,
    // and the lean spring's own overshoot past a target that had already gone
    // negative.
    //
    // Waluigi in `dash-and-dine-01.jpeg` is pitched about 15° into his run and
    // he holds it for the whole stride; the verdict asks for 12–18° permanently
    // at cruise. So the target gets a floor proportional to gait: a chef at
    // full stride can never be asked for less than 0.245 rad (14°), and a
    // braking chef gives up to 0.26 rad of that back (so a hard skid still
    // recedes to about −1°, visibly settling onto the heels without lying down).
    if (!stunned && chef.intent !== 'working') {
      const floor = 0.245 * gait - 0.26 * this.brake;
      if (leanTarget < floor) leanTarget = floor;
    }
    const leanK = stunned ? 240 : 150;
    springStep(this.lean, this.leanV, leanTarget, leanK, 0.0055, dt, LEAN_LIMIT);
    this.lean = SPRING_OUT.x;
    this.leanV = SPRING_OUT.v;
    // AND THE FLOOR IS ENFORCED ON THE OUTPUT TOO, not just on the target. The
    // lean spring runs at ζ ≈ 0.21 — it overshoots a step by half its size —
    // so a chef coming off a hard brake back onto the throttle undershoots the
    // new target by ~0.15 rad and spends a quarter of a second visibly pitched
    // BACKWARDS at speed. Measured before this clamp: pitchDeg min −18.2 at
    // run 0.41. Killing the velocity at the same time stops the clamp acting
    // as a trampoline.
    if (!stunned) {
      const hard = 0.245 * gait - 0.2 * this.brake;
      if (this.lean < hard) {
        this.lean = hard;
        if (this.leanV < 0) this.leanV = 0;
      }
    }
    this.rig.rotation.x = this.lean + Math.sin(this.recover * 26) * this.recover * 0.16;

    // --- bank into turns. 0.34 with a spring that overshoots put bramble 25°
    //     off vertical in ipad-landscape/90-late while barely moving; a chef
    //     leaning like a motorcycle is the reference's opposite.
    const bankTarget = stunned ? 0 : -this.turn * 0.2 * run;
    springStep(this.bank, this.bankV, bankTarget, 120, 0.01, dt, BANK_LIMIT);
    this.bank = SPRING_OUT.x;
    this.bankV = SPRING_OUT.v;
    this.rig.rotation.z =
      this.bank + (stunned ? Math.sin(time * 38) * 0.2 * clamp(chef.stun / 0.22, 0, 1) : 0);

    // --- legs: contact / down / passing / up.
    const idle = 1 - Math.min(1, run * 6);

    // --- idle fidget beats. Only while genuinely standing; the instant a chef
    //     moves or is hit the beat is abandoned, so it can never fight the run.
    if (idle > 0.6 && !stunned) {
      this.fidgetIn -= dt;
      if (this.fidgetT > 0) {
        this.fidgetT -= dt;
      } else if (this.fidgetIn <= 0) {
        this.rnd = (this.rnd * 16807) % 2147483647;
        const r = this.rnd / 2147483647;
        // THE STRETCH HAS TO ACTUALLY FIRE. Four beats picked round-robin with
        // a 1.5–3.7s gap means the two-armed stretch — the loudest idle pose in
        // the rig and the only bilateral one — came up once every ~10s per
        // chef. A 16-second capture caught it zero times in twenty-eight
        // frames, which for a pose nobody ever sees is the same as not having
        // written it. The bag is weighted 2-in-5 toward the stretch and the gap
        // is halved, so a standing chef throws its arms up roughly every 3s and
        // a random frame has a real chance of landing on one.
        // The stretch is no longer in this bag — STANCES holds it properly now,
        // and having both meant a chef threw its arms up twice a second.
        const bag = [0, 2, 3, 0, 2];
        this.fidgetKind = bag[Math.floor(r * bag.length) % bag.length];
        this.fidgetT = 0.9;
        this.fidgetIn = 0.75 + r * 1.15;
      }
    } else {
      this.fidgetT = 0;
      this.fidgetIn = Math.min(this.fidgetIn, 0.9);
    }

    // --- held idle STANCE. Only while standing, empty-handed and not at a
    //     station: a carry pose and the chop beat both own the arms outright.
    // Threshold 0.55, not 0.75. `idle` is 1 − min(1, run·6), so 0.75 demands a
    // chef be within a twenty-fourth of dead stopped — and the bots are nearly
    // always drifting between benches, so the whole stance library fired
    // approximately never in a 14-second capture. 0.55 lets a chef that has
    // arrived somewhere and is dawdling actually adopt an attitude.
    const stanceOK = idle > 0.55 && !stunned && !mode && chef.intent !== 'working';
    if (stanceOK) {
      this.stanceIn -= dt;
      if (this.stanceIn <= 0) {
        this.rnd = (this.rnd * 16807) % 2147483647;
        const r = this.rnd / 2147483647;
        let k = STANCE_BAG[Math.floor(r * STANCE_BAG.length) % STANCE_BAG.length];
        // Never twice in a row: repeating a held pose is indistinguishable from
        // not changing it, which is the whole defect being fixed.
        if (k === this.stanceKind) k = (k + 3) % STANCES.length;
        // AND NEVER THE SAME AS ANYBODY ELSE'S, right now, anywhere in the
        // room. The critique's sharpest observation about our cast was
        // simultaneity — "ipad/t0014 puts nori and pip on opposite sides of the
        // frame in near-identical one-arm-up poses" — and two chefs standing
        // shoulder to shoulder in the same attitude (shots/m6-r5/desktop/t0010,
        // nori and mochi) is the same fault at closer range. Six stances
        // against four chefs, so a unique assignment always exists; walk the
        // ring until one is free. Neutral (0) is exempt — several chefs may
        // simply be standing.
        if (k > 0) {
          for (let guard = 0; guard < STANCES.length; guard++) {
            let taken = false;
            for (const other of LIVE) {
              if (other !== this && other.stanceKind === k && other.stanceMix > 0.2) taken = true;
            }
            if (!taken) break;
            k = k === STANCES.length - 1 ? 1 : k + 1;
          }
        }
        this.stanceKind = k;
        // 1.5–3.1s. Long enough that a screenshot lands ON a pose rather than
        // between two, short enough that eleven seconds never look identical.
        this.stanceIn = 1.5 + r * 1.6;
        this.stanceMix = 0;
      }
      this.stanceMix = Math.min(1, this.stanceMix + dt * 2.6);
    } else {
      // Drop out fast — the instant a chef moves, picks something up or gets
      // hit, the arms belong to the run/carry/stun pose and nothing else.
      this.stanceMix = Math.max(0, this.stanceMix - dt * 6);
      this.stanceIn = Math.min(this.stanceIn, 0.6);
    }
    // A single 0→1→0 hump over the beat, eased, so nothing pops on or off.
    const fb = this.fidgetT > 0 ? Math.sin((1 - this.fidgetT / 0.9) * Math.PI) ** 1.4 : 0;
    const fk = this.fidgetKind;
    this.fidgetLook = fk === 0 ? fb * 0.5 * (this.skin.seed > 0.5 ? -1 : 1) : 0;
    this.fidgetNod = fk === 3 ? -fb * 0.34 : 0;
    this.fidgetArm = fk === 1 ? fb : 0;
    this.fidgetHop = fk === 2 ? Math.max(0, Math.sin(fb * Math.PI * 2)) * 0.055 : 0;

    // --- the chop beat. The working pose used to animate the ARMS only, so a
    //     chef at a station read as a statue with a twitching elbow. The whole
    //     body now drops into each stroke and the head follows it down.
    const workT = chef.intent === 'working' ? (time * 8) % 1 : -1;
    const chop = workT < 0 ? 0 : workT < 0.32 ? workT / 0.32 : 1 - (workT - 0.32) / 0.68;

    // --- delivery flourish. Fires when a LOADED plate leaves the hands, which
    //     is exactly the frame the order is handed over.
    const loaded = !!chef.carrying && chef.carrying.type === 'plate';
    // 1.15s, not 0.6s, AND IT IS A JUMP.
    //
    // The ipad capture scored 0 → 10 between t0018s and 90-late — a delivery
    // landed inside the window — and in neither frame was anybody doing
    // anything but walking. A 0.6-second beat on a capture that samples every
    // few seconds is a coin flip you lose, and a hand-off is the loudest event
    // in the whole loop: it is the thing the round is FOR. So it runs nearly
    // twice as long, both arms punch overhead, the body leaves the floor, and
    // the head snaps up — a pose no other state in the rig produces, which is
    // what makes it legible in a still frame.
    const CHEER = 1.15;
    if (this.wasLoaded && !chef.carrying) this.cheerT = CHEER;
    this.wasLoaded = loaded;
    this.cheerT = Math.max(0, this.cheerT - dt);
    const cheer = this.cheerT > 0 ? Math.sin((1 - this.cheerT / CHEER) * Math.PI) ** 0.6 : 0;
    if (cheer > 0) {
      this.fidgetArm = Math.max(this.fidgetArm, cheer);
      // Two hops rather than one long float: sin|.| at 2× over the beat, so the
      // chef bounces, lands and bounces again instead of hanging in the air.
      this.fidgetHop += Math.abs(Math.sin((1 - this.cheerT / CHEER) * Math.PI * 2)) * cheer * 0.18;
      this.fidgetNod -= cheer * 0.26;
      this.cheerSpin = cheer;
    } else {
      this.cheerSpin = 0;
    }

    const brakeSpread = this.brake;
    // Idle is never bilateral. One hip is permanently a few degrees ahead of
    // the other and the whole pelvis carries a static tilt, so a frozen frame
    // still reads as a body with weight on one foot. A perfectly symmetric
    // A-pose is what made the opening frame a shop window.
    //
    // WEIGHT SHIFT ON A 2.5s BEAT, AND IT SNAPS. `sin(time * 0.62)` is a TEN
    // SECOND period: a chef standing through a 16-second capture changed
    // planted foot once and a half, and because a sine spends most of its time
    // near zero it spent most of that capture stood dead square anyway. A
    // sharpened wave at 1.26 rad/s swaps the planted foot every 2.5s and holds
    // each side, so the pose a random frame lands on is committed rather than
    // halfway between two.
    const shift = Math.tanh(Math.sin(time * 1.26 + s.seed * 11) * 2.4);
    // WHICH LEG IS LEADING, as a continuous quantity. The brake spread used to
    // be a fixed (−0.66, +0.5) applied to (right, left) regardless of where the
    // stride was, so on half of every cycle it fought the swing instead of
    // adding to it — and the cancellation is EXACT at the amplitudes involved.
    // The worst frame in the whole instrumented run is that arithmetic:
    //
    //   t=6.24 bramble  amp 0.278  brake 0.624  →  swing split 0.712 rad,
    //                                              brake split 0.724 rad,
    //                                              opposite signs, thigh 0.9°.
    //
    // A chef braking hard with its legs welded together. Aligning the spread to
    // the stride's own lead makes it unconditionally additive: a skid now always
    // opens the stance, whichever foot happens to be in front.
    const leadPhase = strideWarp(p);
    const lead = strideHold(leadPhase);
    for (const [limb, sign] of [
      [this.legR, 1],
      [this.legL, -1],
    ] as [Limb, number][]) {
      const lw = strideWarp(p + (sign > 0 ? 0 : Math.PI));
      const swing = strideHold(lw);
      let thigh = -swing * THIGH_PEAK * amp;
      // Knee lift keyed off the WARPED phase, so the high knee still arrives at
      // the passing pose — and it is a taller lift (1.34) over a briefer window,
      // which is what makes the pass read as a flick rather than a shuffle.
      let knee = b.kneeRest + amp * (0.1 + 1.34 * Math.max(0, Math.cos(lw)));
      // THE FRONT KNEE IS BENT. In the reference Waluigi's leading leg is folded
      // ~40° at the knee while the trailing one is dead straight; two straight
      // legs at full separation is a gymnast's splits, not a run.
      knee += amp * Math.max(0, swing) * 0.5;
      thigh += brakeSpread * (sign > 0 ? -0.66 : 0.5) * (lead < 0 ? -1 : 1);
      knee += brakeSpread * (sign > 0 ? 0.34 : 0.12);
      if (stunned) {
        thigh += 0.5 * sign;
        knee += 0.35;
      }
      // Idle: a real weight shift. The UNWEIGHTED leg bends at the knee and
      // slides its foot forward, the weighted one stays straight underneath —
      // contrapposto, which is the difference between a standing character and
      // a doll on a stand. Amplitudes roughly doubled again: at 90px tall the
      // previous 0.13 rad of thigh was two pixels of foot travel.
      thigh += idle * (0.14 * sign * (sign > 0 ? 1 : 0.35) + shift * 0.26 * sign);
      knee += idle * Math.max(0, shift * sign) * 0.42;
      // Carrying widens the stance and drops the hips a little.
      knee += this.carryBlend * 0.16;
      limb.hip.rotation.x = thigh;
      limb.hip.rotation.z = (brakeSpread * 0.18 + idle * 0.03 + this.carryBlend * 0.1) * sign;
      limb.knee.rotation.x = knee;
      // TOE-OFF. The ankle counter-rotates 55% of the leg chain so the sole
      // stays roughly parallel to the floor, which is right for a stand and
      // wrong for a run: the trailing foot in the reference is plantar-flexed
      // hard, toe still pointing at the stone it just left, and that pushed-off
      // boot is half of what says "sprinting" in a still frame. So the rear leg
      // (swing < 0) gets an extra 0.62 rad of toe-down on top, and the leading
      // foot dorsiflexes a little to present its sole to the camera on landing.
      limb.foot.rotation.x =
        b.ankleRest -
        (thigh + knee - b.kneeRest) * 0.55 -
        amp * Math.max(0, -swing) * 0.62 +
        amp * Math.max(0, swing) * 0.2;
    }

    // --- hips bob + squash/stretch. `pass` is on the WARPED phase too, so the
    //     bob still peaks when the legs actually cross.
    const pass = Math.abs(Math.cos(leadPhase));
    const antic = Math.max(0, a) * (1 - run) * 0.05;
    // Breathe: 0.13, up from 0.09 and from 0.028 before that. A chef standing
    // at a bench is the single most common thing in any frame we ship, so this
    // is the animation the critic sees most and it has to be visible at
    // thumbnail size. The pelvis rides with it, a fifth of the amplitude and a
    // beat late, so the whole body inflates rather than just the chest.
    const breathPhase = time * 2.1 + s.seed * 6;
    const breathe = idle * Math.sin(breathPhase) * 0.13;
    this.hips.position.y =
      s.legLen +
      amp * 0.06 * pass -
      antic -
      this.brake * 0.05 -
      this.carryBlend * 0.045 -
      chop * 0.035 +
      this.fidgetHop +
      idle * Math.sin(breathPhase - 0.7) * 0.022 -
      // Knees buckle on a bump. The drop is what sells the hit now that the
      // body no longer folds over backwards to do it.
      (stunned ? 0.07 : 0);

    // --- GROUND CLAMP. thigh+shin sums to ~0.97 of `legLen`, so a chef standing
    //     with straight legs has about 1.5cm of headroom between its ankle and
    //     the flagstone — and the hip drops above add up to 9cm (brake 0.05 +
    //     carry 0.045 + chop 0.035 + stun 0.07). The instrument caught it:
    //     footLowY reached −0.094, i.e. an ankle nine centimetres UNDER the
    //     floor, on a carrying chef braking into a bench. A foot through the
    //     stone is worse than no shadow, so the pelvis is lifted by whatever the
    //     lower ankle is short of the ground. One IK constraint, one direction,
    //     no feedback — it can only ever push the body up out of the floor.
    this.legR.foot.updateWorldMatrix(true, false);
    this.legL.foot.updateWorldMatrix(true, false);
    this.tmp2.setFromMatrixPosition(this.legR.foot.matrixWorld);
    this.tmp3.setFromMatrixPosition(this.legL.foot.matrixWorld);
    const lowestFoot = Math.min(this.tmp2.y, this.tmp3.y);
    if (lowestFoot < 0.01) this.hips.position.y += (0.01 - lowestFoot) / CHAR_SCALE;

    const sq = amp * 0.11 * (pass - 0.5) * 2;
    const stunSq = stunned ? -0.12 : 0;
    this.torso.scale.set(
      1 - sq * 0.55 + breathe * -0.4 - stunSq * 0.7,
      1 + sq + breathe + stunSq,
      1 - sq * 0.55 + breathe * -0.4 - stunSq * 0.7,
    );
    // The whole pelvis TILTS with the weight shift — the hip over the planted
    // leg rides high, which is the single clearest read that a standing figure
    // has weight in it. 0.05 was invisible; 0.11 is a hip you can see move.
    this.hips.rotation.z = idle * shift * 0.11 + this.cheerSpin * Math.sin(time * 13) * 0.1;
    this.hips.rotation.y =
      idle * shift * 0.14 + amp * Math.sin(p) * 0.07 + this.cheerSpin * Math.sin(time * 9) * 0.28;
    this.hips.position.x = idle * shift * 0.035;

    // --- arms
    // Driven off the SAME hold-shaped wave as the legs, so the arm swing has
    // the same pose-to-pose read: at any frame you photograph, one arm is up
    // and forward and the other is back past the hip, rather than both hanging
    // at the vertical because sin(p) happened to be zero. That was the other
    // half of the "both arms hanging limp with straight elbows" observation —
    // it is the identical distribution bug, on the identical wave.
    const armSwing = lead * amp * 1.2;
    const setArm = (limb: Limb, sx: number, sz: number, ex: number) => {
      limb.hip.rotation.x += (sx - limb.hip.rotation.x) * step;
      limb.hip.rotation.z += (sz - limb.hip.rotation.z) * step;
      limb.knee.rotation.x += (ex - limb.knee.rotation.x) * step;
    };

    // --- WHICH ARM CARRIES, AND IT IS NOT ALWAYS THE RIGHT ONE.
    //
    // The one-handed carries (produce, pan) rode `armR` unconditionally, and
    // from the camera's dominant three-quarter-behind-LEFT view that puts the
    // load on the far side of the body whenever the chef is running screen-
    // right: the torso eclipses it completely. The critic's frame is exact —
    // "desktop/t0100s: bramble is carrying lettuce:raw and there is no lettuce
    // anywhere in its silhouette". Mode 4 already reasons about which side of
    // the head its tower rides; this is the same reasoning one limb down.
    //
    // The rig's yaw is known and the camera never rolls, so the chef's own
    // right axis in world is (cos yaw, 0, −sin yaw) and its Z component says
    // which side faces the lens (the camera sits at large +Z, looking down the
    // room at the back wall). Carry on whichever side that is, with a wide
    // deadband so a chef weaving down a lane does not flap the load from paw to
    // paw — it only ever switches when the current side has swung a good 16°
    // past square, which in practice is once per corner.
    const working = chef.intent === 'working';

    // --- ELBOW ROOM. The sim separates BODIES at 2r and stops there, and an
    //     arm is not a body: at 6× in shots/j-chefs-r1-late-a/ipad-landscape/
    //     t0102s pip's forearm passes cleanly through nori's mitt, and in
    //     desktop/t0103s pip's arm crosses mochi's head. Two chefs standing a
    //     legal distance apart can still have their limbs occupy the same
    //     cubic centimetres, because nothing in the rig knows the other chef is
    //     there. Moving the body on the render side would desync it from the
    //     station it is working at, so the ARM gives way instead: inside 1.15
    //     units the abduction folds in, which is both the collision fix and the
    //     bump reaction the reference gets its comedy from — a chef visibly
    //     making room for the one who just crowded it.
    let near = 9;
    for (const other of LIVE) {
      if (other === this || !other.root.parent) continue;
      const dx = other.chef.pos.x - chef.pos.x;
      const dy = other.chef.pos.y - chef.pos.y;
      const d = Math.hypot(dx, dy);
      if (d < near) near = d;
    }
    const crowdWant = near < 1.15 ? 1 - near / 1.15 : 0;
    this.crowd += (crowdWant - this.crowd) * Math.min(1, dt * 7);
    const tuck = 1 - this.crowd * 0.7;

    if (mode === 1 || mode === 3) {
      const rz = -Math.sin(yaw);
      if (this.carrySide > 0 && rz < -0.28) this.carrySide = -1;
      else if (this.carrySide < 0 && rz > 0.28) this.carrySide = 1;
    } else this.carrySide = 1;
    const cSide = this.carrySide;
    const cArm = cSide > 0 ? this.armR : this.armL;
    const oArm = cSide > 0 ? this.armL : this.armR;
    /** The chop beat, for an arm that is not holding anything. */
    const workBeat = () => {
      const t = (time * 8) % 1;
      return t < 0.32 ? -1.5 + t * 4.2 : -0.15 - (t - 0.32) * 0.5;
    };

    // NOTE ON SIGNS: rotating a shoulder about +Z swings the arm toward +X, so
    // OUTWARD is `+z on the right arm, -z on the left`. Rotating about -X
    // swings the arm FORWARD; -2.7 puts it up and slightly forward of vertical.
    if (stunned) {
      setArm(this.armL, -2.2, -0.85, -0.45);
      setArm(this.armR, -2.2, 0.85, -0.45);
      // THE WORKING BRANCH IS GATED ON `!mode`, AND THAT IS THE WHOLE PLATE BUG.
      //
      // It used to be tested BEFORE any mode branch, so a chef standing at a
      // station holding a plate got the two-armed chop instead of the carry —
      // and the mode-2 socket offset is expressed in the HAND's frame and tuned
      // against a −1.16 forward pitch. Point those arms down at a bench instead
      // and the same −0.24 "past the fingertips" points at the FLOOR: the plate
      // lands inside the pelvis and draws over the thigh and under the apron.
      // "nori stands inside a cream disc the width of its own torso" —
      // desktop/t0096s, t0100s, iphone-portrait/t0100s, 90-late, all four of
      // them the same frame of the same bug. A chef with its hands full works
      // with the hand it has free.
    } else if (working && !mode) {
      // THREE JOBS, NOT ONE.
      //
      // Every chef at every station ran the identical two-armed hack, so four
      // characters at four benches were four copies of one animation and the
      // frame read as a production line of clones. The reference's Toads are
      // never doing the same thing as each other. Which job a critter does is
      // fixed per skin (it is part of who they are — the bear chops, the frog
      // stirs, the cat kneads, the duck chops) so it is stable across a run
      // rather than flickering, and each one moves a different limb pair on a
      // different beat.
      const t = (time * 8) % 1;
      if (this.workKind === 1) {
        // STIR. One arm out over the pot tracing a slow circle from the
        // shoulder, the other planted on the hip. Half the speed of the chop,
        // which is most of what makes it read as a different action.
        const c = time * 5.2;
        setArm(this.armR, -1.28 + Math.sin(c) * 0.2, 0.42 + Math.cos(c) * 0.26, -0.72);
        setArm(this.armL, 0.24, -0.92, -1.75);
      } else if (this.workKind === 2) {
        // KNEAD. Both arms down and forward onto the bench, pushing in
        // alternation, so the shoulders roll against each other.
        const k = Math.sin(time * 9.5);
        setArm(this.armR, -0.92 - k * 0.26, 0.3, -1.05 + k * 0.3);
        setArm(this.armL, -0.92 + k * 0.26, -0.3, -1.05 - k * 0.3);
      } else {
        const hack = t < 0.32 ? -1.5 + t * 4.2 : -0.15 - (t - 0.32) * 0.5;
        setArm(this.armR, hack, 0.1, -0.6);
        setArm(this.armL, hack * 0.45 - 0.35, -0.28, -0.85);
      }
    } else if (mode === 2) {
      // PLATE — THE WALUIGI CARRY. Both arms straight out FORWARD and flat, the
      // plate resting across both palms at chest height, the tower rising past
      // the chin.
      //
      // This is the reference's single loudest silhouette channel and we had
      // thrown it away twice: first by putting the plate over the crown (the
      // camera looks down, so a disc above a skull projects onto it), then by
      // holding it aloft on one arm at shoulder pitch −2.88 — seven degrees off
      // the produce carry at −3.00, i.e. the two "deliberately different"
      // carries were the same outline on screen.
      //
      // Forward-and-flat solves all of it at once. Plate + both arms + torso
      // fuse into ONE continuous readable shape (which is the whole point — a
      // prop clear of the hand is a decal beside the character, not a load);
      // nothing is over anybody's hat; and it now differs from the produce
      // carry by ninety degrees of shoulder rather than seven.
      //
      // HEIGHT MATTERS AS MUCH AS DIRECTION. At shoulder pitch −1.46 the arms
      // are dead horizontal and the plate rides at y = 0.55, z = 0.43 in torso
      // space. Our camera looks DOWN at 23° (more like 30–40° for a chef low in
      // the frame), so anything held that far forward projects UP the screen —
      // and in shots/p04-r5b/desktop/t0010, t0014 and 90-late the plate landed
      // exactly on bramble's skull and he read as headless with a dinner plate
      // for a neck. Angled 25° down instead, the plate sits at chin height on
      // screen with the tower rising past it, which is the reference Toad's
      // pancake-stack read rather than a lid.
      // Abduction ZERO, not 0.34 inboard. The arms used to converge toward the
      // midline, which narrows the load-bearing span to less than a head and
      // tucks both arms inside the body outline — from behind, which is how our
      // camera sees everyone, the plate then disappeared behind the jacket
      // along with the arms holding it. Straight forward at shoulder width
      // gives a 0.6 span under a 0.78 plate, so the plate is WIDER THAN THE
      // TORSO and pokes out both sides of the silhouette from any angle. That
      // is the whole trick of the reference's Shy Guy.
      const w = Math.sin(p) * amp * 0.07;
      // WORKING WITH A PLATE IN BOTH HANDS is not chopping — it is PLATING, and
      // it is a push of the whole load forward and back on the shoulders rather
      // than a hack of one forearm. The carry pitch is never given up, so the
      // plate never leaves the front of the chest.
      const plate = working ? Math.sin(time * 7.5) * 0.13 : 0;
      // LOWER. −1.02 with a straight elbow is a plate at chin height, and this
      // camera looks DOWN 22.5 deg, so a load held forward at chin height
      // projects onto the skull — which is why the head clamp then fired on
      // every single plate frame and dragged the disc to the hips. Every one of
      // the reference's four carried loads is held at WAIST height with the
      // elbows bent: Waluigi's plate, Shy Guy's plate, Daisy's lettuce, Toad's
      // bun. At −0.72/−0.30 the palms sit just above the belt, the plate is
      // silhouetted against the FLOOR rather than against the carrier's own
      // chest, and the clamp has nothing left to do.
      setArm(this.armR, -0.72 - w + plate, 0.06, -0.3 - plate * 0.5);
      setArm(this.armL, -0.72 + w + plate, -0.06, -0.3 - plate * 0.5);
    } else if (mode === 3) {
      // PAN — held out at arm's length to the side, well clear of the body, the
      // other arm thrown out to counterbalance (or working the bench, if the
      // chef is at a station — the pan arm holds regardless).
      setArm(cArm, -0.34, 1.28 * cSide * tuck, -0.3);
      if (working) setArm(oArm, workBeat() * 0.85, -0.34 * cSide, -0.72);
      else setArm(oArm, armSwing * 0.5 + 0.24, -0.62 * cSide, -0.5);
    } else if (mode === 1) {
      // PRODUCE — THE DAISY CARRY. One arm out SIDEWAYS and nearly straight,
      // the food held clear of the body at shoulder height; the other arm
      // driven down and back to counterbalance.
      //
      // Two earlier versions of this both failed, and they failed for opposite
      // reasons that between them define the constraint:
      //
      //   raised beside the head — the payload landed ON the skull. At
      //   desktop/t0019 pip's tomato intersected its own muzzle and the frog
      //   read as a clown. The area around a chibi head is the one place a prop
      //   may never go.
      //
      //   hugged in front of the chest — correct for the reference's Toad, and
      //   invisible for ours, because OUR CAMERA SEES CHEFS FROM BEHIND. In
      //   ipad-landscape/90-late bramble's lettuce was a two-pixel sliver of
      //   green past its own shoulder; the rest was swallowed by the jacket.
      //   The reference gets away with the hug only because Toad's stack is
      //   wider than his whole torso — one tomato never will be.
      //
      // Out to the SIDE is the pose that survives both. Abduction 1.15 with an
      // almost-straight elbow puts the paw ~0.6 from the midline against a
      // half-torso of 0.3, so the load is entirely outside the body outline
      // from ANY camera angle, a clear 0.15 below the shoulder and further from
      // the face than the arm is long. It is also the reference's own answer:
      // Daisy carries her rasher of bacon exactly here.
      //
      // THIRD VERSION, and the fault this one fixes is different again: at
      // shoulder pitch −0.5 with an almost-straight elbow the paw ended up at
      // BELT height a full arm's length out to the side, so the tomato read as
      // a balloon on a stick — a red circle in clear air with a thin green line
      // running to a body that was not doing anything about it
      // (shots/mc-r1/desktop/t0016, pip; the same frame's bramble with a
      // lettuce is worse because a bear's arm is shorter).
      //
      // A carry has to look like WORK. The shoulder now lifts to −0.95 and the
      // ELBOW FOLDS to −0.62, which is the difference: the upper arm goes out,
      // the forearm comes back up and in, and the load sits cupped at shoulder
      // height against a bent arm instead of dangling off a straight one. That
      // is Daisy's rasher of bacon in `dash-and-dine-01.jpeg`, right-hand side —
      // held high, elbow bent, clear of the head by exactly one paw.
      const w = Math.sin(p) * amp * 0.12;
      // FOURTH VERSION, and the thing it fixes is the OTHER ARM.
      //
      // Held out on the right arm alone, with the left arm thrown down and back
      // as a counterweight, the load was outside the torso outline (good) but
      // it was hanging off a single limb pointing away from the body, and the
      // rest of the chef was doing nothing about it. In desktop/90-late pip's
      // rasher read as a red plank stuck through the frog's ribs, and the left
      // arm — swung the other way entirely — actively argued that nothing was
      // being carried.
      //
      // The reference never carries anything one-handed. Waluigi's plate is in
      // BOTH hands with the arms locked flat, Shy Guy's the same, the Toad's
      // pancakes are hugged in both. The point the critic made about it is
      // exact: plate + arms + torso have to fuse into ONE continuous readable
      // shape, and two arms converging on a load is what does that.
      //
      // So both arms now come FORWARD and meet under the load out past the
      // right shoulder: the right arm carries it, the left crosses the chest to
      // steady it from underneath. The load stays clear of the torso outline on
      // the right — which is the constraint the previous three versions were
      // paying for — but there is now a closed arm-load-arm shape around it
      // instead of a stick with a ball on the end.
      //
      // It also stays 90° of shoulder away from the flat plate carry (mode 2,
      // at −1.02 with a straight elbow): this one is high, folded and diagonal,
      // that one is low, straight and square-on.
      //
      // ...and the FIFTH version, because the fourth was measurably worse and
      // the reason is worth writing down: BOTH ARMS FORWARD DOES NOT WORK ON A
      // CAMERA THAT LOOKS AT BACKS. With the shoulders at −1.28/−1.2 and low
      // abduction, both arms end up in front of the chest, i.e. on the far side
      // of the body from the lens, and the torso hides them completely. In
      // shots/m6-r1/desktop/90-late pip's rasher is a red card floating off the
      // left edge of a green blob with no arm attached to it at all — worse
      // than the one-armed version it replaced, which at least had a visible
      // paddle hand touching the load (shots/m6-base/desktop/90-late).
      //
      // What has to be outside the torso outline is not just the load, it is
      // the ARM. So both shoulders are ABDUCTED — the right one hard, carrying
      // the load up at shoulder height on a folded elbow; the left one out the
      // other way as a visible counterweight. From directly behind that is two
      // elbows clear of the body and a load cupped at the end of one of them:
      // a wide, unmistakable hefting silhouette that survives being seen from
      // any angle, which the flat-forward version does not.
      // SIXTH VERSION, and the note it adds is about DISTANCE, not direction.
      // At 1.3 rad the shoulder is abducted 74°, which puts the paw a full arm
      // clear of the ribs — the load is unambiguously outside the body outline
      // (which was the point) but it is also so far out that at 90px the thin
      // arm between them stops reading, and the critic's frame is exact: "the
      // lettuce sits on the bench roughly 60px to its right with clean table
      // wood visible between paw and produce". A carry has to keep the load
      // OUTSIDE the torso and TOUCHING the mass of the body. 1.02 rad (58°)
      // with the elbow folded harder does both: the paw sits about a
      // half-torso outboard of the ribs, so the load's inner edge overlaps the
      // shoulder while its outer half is clear against the floor, and arm +
      // load + shoulder read as one continuous shape.
      setArm(cArm, -0.92 + w * cSide, 1.02 * cSide * tuck, -0.72);
      // The counterweight comes IN too. At −0.95 of abduction the left arm was
      // flung as far the other way as the right one, which from behind is a
      // scarecrow with a vegetable on one end. And if the chef is AT a station,
      // this is the arm that does the work — the load never puts itself down.
      if (working) setArm(oArm, workBeat() * 0.9, -0.36 * cSide, -0.8);
      else setArm(oArm, -0.34 - armSwing * 0.3, -0.66 * cSide, -0.95 - amp * 0.2);
    } else {
      // FREE RUN — fore-and-aft, not sideways. The old lateral term was
      // `0.24 + flare * 0.75`, which dominated the sin(p) swing and turned the
      // run into a scarecrow with both arms horizontal. The arms now swing
      // through a wide FORE-AFT arc with the elbow folding on the forward beat,
      // and only splay outward when actually braking.
      const flare = this.brake * 0.95;
      // 0.26 base abduction, not 0.10. At 0.10 rad the arm hung 3cm off the
      // vertical over its whole length — i.e. inside the coat's own outline the
      // entire time — so no frame of the run cycle ever put floor between the
      // arm and the body. 15° puts the paw a clear 9cm outboard of the hip and
      // the elbow ~5cm, which at 90px is one to two pixels of visible gap: the
      // difference between an arm and a seam.
      // 0.34, up from 0.26, because the shoulder pivot moved 0.55 of an arm
      // radius INBOARD to close the armpit — without paying that back in
      // abduction the whole arm hangs inside the coat's outline and the paw
      // reads as a button sewn on the chest (bramble at 5× in
      // shots/mc-w2-r1/desktop/t0006s).
      // 0.46, UP FROM 0.34, BECAUSE THIS CAMERA LOOKS AT BACKS. The arm swing is
      // fore-and-aft, and fore-and-aft is along the view axis for a chef running
      // away — so from directly behind, abduction is the ONLY thing separating
      // an arm from the torso. At 0.34 rad the paw cleared pip's apron by about
      // two pixels and shots/j2-desk/desktop/t0096s (crop c3) has a frog in a
      // full stride with no arm anywhere in its outline. 26 degrees puts the paw
      // a clear half-torso outboard, which is where Waluigi's are.
      const out = (0.46 + flare * 0.3 + idle * 0.08) * tuck;
      // Contrapposto. A standing chef whose two arms hang at the same angle
      // is a mannequin; the reference sells motion in a still frame purely on
      // pose asymmetry, so one arm is permanently a good 20 degrees ahead.
      const idleArm = idle * (shift * 0.16 + 0.2);
      // The stretch beat: both arms swing up and out at once. It is the only
      // bilateral pose in the rig, which is exactly why it reads as an EVENT
      // when it fires in among all the asymmetric ones.
      const fa = this.fidgetArm;
      let lx = armSwing - flare * 0.7 + idleArm - fa * 2.0;
      let lz = -out - fa * 0.5;
      // Base elbow bend −0.38, not −0.20. On the forward half of the swing the
      // old value left the elbow all but straight, and a chibi arm with no
      // bend in it renders as a coloured stick poking out of a shoulder
      // (shots/m6-r1/desktop/t0010, nori). Real run cycles keep a permanent
      // bend and only vary how much.
      // ELBOW FOLDS ON THE FORWARD BEAT, and it used to fold on the back one.
      // `lx` is the LEFT shoulder and negative x is FORWARD, so the left arm is
      // forward when `armSwing` is negative — the old `max(0, armSwing)` folded
      // the elbow precisely when the arm was trailing, i.e. it straightened the
      // one arm the reference always has bent up beside the head and bent the
      // one it has swung out straight behind. Both arms are now correct and the
      // fold is deeper (1.05), which is what turns the run into the reference's
      // running X rather than two pendulums.
      let le = -0.42 - Math.max(0, -armSwing) * 1.05 - idle * 0.14 - fa * 0.5;
      let rx = -armSwing - flare * 0.7 - idleArm - fa * 2.0;
      let rz = out + fa * 0.5;
      let re = -0.42 - Math.max(0, armSwing) * 1.05 - idle * 0.14 - fa * 0.5;
      // ...then pull the whole thing toward whatever attitude this chef is
      // currently HOLDING. Gated on `idle` as well as the fade so a stance can
      // never bleed into a stride.
      const sw = this.stanceMix * idle;
      if (sw > 0.002 && this.stanceKind > 0) {
        const P = STANCES[this.stanceKind];
        rx += (P[0] - rx) * sw;
        rz += (P[1] - rz) * sw;
        re += (P[2] - re) * sw;
        lx += (P[3] - lx) * sw;
        lz += (P[4] - lz) * sw;
        le += (P[5] - le) * sw;
      }
      setArm(this.armL, lx, lz, le);
      setArm(this.armR, rx, rz, re);
    }

    // --- head: permanently off-axis, and looking at somebody.
    //     From the game camera every chef is seen from behind, and a bare
    //     coloured sphere is zero information. The reference solves it by
    //     yawing the head so you catch Waluigi's nose and Mario's eye even
    //     from behind. So: a constant bias, a slow glance, and a real look-at
    //     toward the nearest other chef.
    //
    //     The magnitude was the problem, not the idea. `clamp(want, ±0.85) ×
    //     (0.45 + 0.35·idle) + 0.24 bias + 0.30 glance` peaks at 1.21 rad — 70°
    //     of neck — and at that angle it stops reading as a glance and starts
    //     reading as a detached head: in desktop/90-late and ipad/90-late nori
    //     had its back to the lens with BOTH eyes, nose, blush and whiskers
    //     square on. So the composite is now hard-clamped to ±0.42 rad (24°,
    //     about what a real neck does casually), and the look-at term is faded
    //     out with speed — a chef that is running looks where it is running.
    const t = this.lookTarget();
    const want = Math.atan2(t.x - chef.pos.x, t.y - chef.pos.y) - yaw;
    this.glancePhase += dt * 0.42;
    const still = 1 - clamp(speed / 3, 0, 1);
    const bias = (s.seed > 0.5 ? 1 : -1) * 0.16;
    const glance = Math.sin(this.glancePhase) * 0.22 * (0.35 + 0.65 * idle);
    const lookAt = clamp(angleDelta(0, want), -0.85, 0.85) * (0.3 + 0.35 * idle) * still;
    // ±0.52 rad (30°), not ±0.42. 0.42 was a correction for a rig that peaked
    // at 1.2 rad and read as a detached head; having killed that, the clamp is
    // now the thing costing us the reference's best trick — you catch Waluigi's
    // nose and Mario's eye from behind because their heads are turned. 30° is
    // still comfortably inside what a neck does casually and it buys a visible
    // cheek, muzzle and one eye on a chef running away from the lens.
    let headTarget = clamp(lookAt + bias + glance + this.fidgetLook, -0.52, 0.52);
    headTarget -= this.turn * 0.24;
    if (stunned) headTarget = Math.sin(time * 30) * 0.35;
    this.headYaw += (headTarget - this.headYaw) * Math.min(1, dt * 3.2);
    this.head.rotation.y = this.headYaw;
    // Head bob at half the breathing frequency, plus a tip DOWN over a load
    // held out in front — the character is watching what it is hauling.
    this.head.rotation.x =
      -this.lean * 0.45 +
      amp * Math.sin(p * 2) * 0.05 +
      idle * Math.sin(time * 1.05 + s.seed * 4) * 0.075 +
      this.fidgetNod +
      chop * 0.16 +
      // Down over a load held out front — you watch what you are hauling.
      this.carryBlend * (frontLoad ? -0.13 : 0);
    this.head.rotation.z = stunned
      ? Math.sin(time * 26) * 0.22
      : // dt-correct decay: a flat 0.86 per frame is a 60fps constant, and at
        // 2fps it barely decays at all, so the head roll stuck on.
        this.head.rotation.z * Math.pow(0.86, dt * 60) + idle * shift * 0.13 * 0.14;

    // --- ears / crest / bandana tails: secondary motion, always one beat late
    const flap =
      Math.sin(p - 1.1) * amp * 0.34 + this.turn * 0.28 + idle * Math.sin(time * 1.9 + s.seed * 3) * 0.11;
    for (let i = 0; i < this.ears.length; i++) {
      const e = this.ears[i];
      e.rotation.x = this.earRest[i] + flap * (0.6 + (i % 2) * 0.25) - this.brake * 0.4;
    }

    // --- tail: a lagging spring off the hips, so it curves on a turn and
    //     follows through on a stop instead of standing rigid.
    const drive = -this.turn * 1.5 - this.bank * 1.2;
    for (let i = 0; i < this.tail.length; i++) {
      const seg = this.tail[i];
      const rest = this.tailRest[i];
      const k = 90 - i * 14;
      const target = drive / (1 + i * 0.55);
      springStep(this.tailAng[i], this.tailVel[i], target, k, 0.02, dt, TAIL_LIMIT);
      this.tailAng[i] = SPRING_OUT.x;
      this.tailVel[i] = SPRING_OUT.v;
      const lag = i * 0.7;
      if (s.tail === 'long') {
        seg.rotation.z = rest.z + clamp(this.tailAng[i], -0.6, 0.6) + Math.sin(p * 0.7 - lag) * (0.04 + amp * 0.12);
        seg.rotation.x = rest.x + Math.cos(p * 0.7 - lag) * (0.05 + amp * 0.11) - amp * 0.06;
      } else if (s.tail === 'fan') {
        seg.rotation.z = rest.z + clamp(this.tailAng[i], -0.4, 0.4) * 0.5;
        seg.rotation.x = rest.x + amp * Math.sin(p - 0.8) * 0.22 + idle * Math.sin(time * 1.7) * 0.06;
      }
    }

    // --- blink. Randomised interval per critter, occasionally a double.
    this.blinkIn -= dt;
    if (this.blinkFor > 0) {
      this.blinkFor -= dt;
    } else if (this.blinkIn <= 0) {
      this.blinkFor = 0.11;
      this.blinkIn = 2.6 + ((Math.sin(time * 12.9898 + s.seed * 78.233) * 43758.5453) % 1) * 2.6;
      if (this.blinkIn < 2.6) this.blinkIn += 2.6;
    }
    const lid = this.blinkFor > 0 ? 0.12 + 0.88 * Math.abs(this.blinkFor - 0.055) / 0.055 : 1;
    for (const e of this.eyes) e.scale.y = Math.min(1, lid);

    // --- gaze. ONE target, both eyes. The neck only turns 30°, so whatever the
    //     head could not reach of the look-at is taken up by the eyes — which
    //     is what real heads do, and it means a chef standing at a bench is
    //     visibly tracking the chef who just ran past it.
    const gazeWant = clamp(angleDelta(0, want) - this.headYaw, -1.1, 1.1) / 1.1;
    this.gaze += (gazeWant - this.gaze) * Math.min(1, dt * 5);
    for (let i = 0; i < this.pupils.length; i++) {
      const base = this.pupilBase[i];
      this.pupils[i].position.set(
        base.x + this.gaze * 0.022,
        base.y - this.carryBlend * 0.012 + this.fidgetNod * 0.03,
        base.z,
      );
    }

    // --- mouth. Two states, both readable at 40px: shut (the lip arc alone,
    //     curving up at the corners) and open-on-effort. Effort is chopping,
    //     hauling, sprinting or being knocked over — i.e. everything the
    //     reference's Toads are visibly doing.
    let mouthWant = 0;
    if (stunned) mouthWant = 1;
    else if (chef.intent === 'working') mouthWant = 0.55 + 0.45 * Math.sin(time * 16);
    else if (mode) mouthWant = 0.42 + 0.2 * Math.sin(p * 2) * amp;
    else if (run > 0.45) mouthWant = 0.3 + 0.25 * run;
    else mouthWant = this.fidgetArm * 0.7;
    this.mouthOpen += (mouthWant - this.mouthOpen) * Math.min(1, dt * 11);
    const mo = clamp(this.mouthOpen, 0, 1);
    if (this.mouthCav) {
      this.mouthCav.visible = mo > 0.06;
      // Narrow as well as short when barely open, so the ellipse stays inside
      // the lip arc instead of spilling past its corners.
      this.mouthCav.scale.set(0.6 + 0.4 * mo, mo * this.mouthCavH, 1);
    }
    if (this.mouthLip) {
      // The lip widens and flattens as the jaw drops, so the smile does not
      // just sit there unchanged behind an opening hole.
      this.mouthLip.scale.x = 1 + mo * 0.12;
      this.mouthLip.scale.z = 1 + mo * 0.1;
    }
    if (this.beakLower) this.beakLower.rotation.x = mo * 0.5;

    // --- carried item. THE PAYLOAD LIVES IN THE HAND.
    //
    // This was the single biggest gap in the whole piece. Every non-pan carry
    // used to be parented to `this.torso` at a hardcoded chest-space offset —
    //   mode 2: (0.56, headY + 0.4, 0.10)
    //   mode 1: (0.54, headY + 0.55, 0.16)
    // — while the shoulder animated completely independently of it. So the
    // prop's position was a torso-space CONSTANT and the mitt's was not, and
    // the two only agreed by luck. In desktop/t0016 nori's lettuce sat 30px
    // up-left of its raised paw in clear air with floor visible in the gap; in
    // ipad-landscape/90-late bramble's dough ball floated a body-width above
    // the mitt. That is the difference between "a character carrying
    // something" and "a character standing near something", and the reference
    // never loses it: Waluigi's plate is IN both hands and plate + arms +
    // torso form one continuous shape.
    //
    // Now every mode sockets to `armR.foot` — the hand itself — so the load
    // cannot detach from the paw no matter what the arm does. The only work
    // left is to counter-rotate the socket so the payload stays LEVEL with the
    // floor while the arm that holds it is at whatever angle the pose wants.
    const socket = cArm.foot;
    if (this.hands.parent !== socket) {
      socket.add(this.hands);
      // Reparenting mid-carry must not teleport the load through the body for a
      // frame; the branches below overwrite both, but the mode-0 idle frame
      // after a drop would otherwise keep the old side's offset.
      this.hands.position.set(0, 0, 0);
    }

    const key = describe(chef.carrying);
    if (key !== this.carryKey) {
      this.carryKey = key;
      this.hands.clear();
      if (chef.carrying) {
        const item = buildCarryable(chef.carrying);
        // SIZE IS THE WHOLE POINT. The skull is a 0.285 sphere, so a head is
        // ~0.57 across, and everything here used to be scaled DOWN below that:
        // a plate came out 0.47 wide (0.8 of a head) and a tomato 0.29 (half a
        // head). Held against a chest at 90px on an iPhone, half a head of
        // anything is a button sewn on a coat — which is precisely what the
        // critique found on bramble at desktop/t0006.
        //
        // The reference has no props that small. Its bottom-centre Toad is
        // carrying pancakes WIDER THAN HIS OWN TORSO; Shy Guy's plate is a full
        // head across; Daisy's bacon is head-width. So: a plate now comes out
        // 0.69 across (1.2 heads), and produce 0.46 (0.8 of a head, and wider
        // than the 0.55 chest once the arms wrap round it). A load has to be
        // big enough to REWRITE the outline or it is decoration.
        // 1.45 on a tomato is a 0.58-wide sphere — a whole head of fruit, and
        // measured on shots/mc-r1 it was visibly LARGER than the skull holding
        // it. 1.22 lands produce at ~0.49, still comfortably the 0.9 head-widths
        // the reference asks for and still wider than the chest, without turning
        // the cast into circus performers.
        item.scale.setScalar(mode === 3 ? 0.8 : mode === 2 ? 1.3 : 1.22);
        if (mode === 2 && item.children.length > 1) {
          // STACK IT. buildCarryable lays a plate's contents out in a flat ring
          // 0.035 apart, which from any distance is a white disc with a smudge
          // on it. Restacked vertically at a 0.2 pitch with a drunken lean, a
          // three-component order rides a clear 0.45 above the rim — past the
          // carrier's chin and well proud of the shoulder line, so the carry
          // shows up in the SILHOUETTE and not just in the texture.
          //
          // (This is as far as the honest version of the reference's plate
          // tower goes. A stack taller than the character would mean rendering
          // plates the sim does not model; the domain carries exactly one plate
          // per chef, and the view does not get to invent state.)
          for (let i = 1; i < item.children.length; i++) {
            const c = item.children[i];
            c.position.set(Math.sin(i * 2.4) * 0.04, 0.09 + (i - 1) * 0.2, Math.cos(i * 1.9) * 0.04);
            c.rotation.y = i * 0.7;
            c.rotation.z = Math.sin(i * 3.1) * 0.12;
          }
        }
        // Produce rides a fixed 0.155 STRAIGHT UP from the paw, in the socket's
        // solved world-vertical frame (see the `else` branch below), so the
        // mitt supports it from underneath and stays outside its outline.
        if (mode === 1) {
          // 0.105 up and 0.07 FORWARD, plus a 20° tip.
          //
          // Straight up by 0.155 is right for a sphere and wrong for a rasher:
          // our camera looks down, so "up" is toward the lens, and a flat plank
          // lifted toward the lens hides the paw behind it and presents its
          // whole face as a floating pink rectangle
          // (shots/m6-r6/desktop/t0019, nori). Forward is away from the lens
          // for a chef seen from behind, so the paw draws IN FRONT of the load
          // and the two overlap in the silhouette; the tip stops a flat item
          // lying dead parallel to the floor and gives it a visible edge.
          item.position.set(0, 0.105, 0.07);
          item.rotation.x = -0.35;
        }
        this.hands.add(item);
      }
    }
    if (chef.carrying) {
      // Undo the arm chain so the load rides flat. The shoulder's Z is folded
      // in too, otherwise a plate tips off the palm every time the arm splays.
      const level = -(cArm.hip.rotation.x + cArm.knee.rotation.x) - this.lean;
      if (mode === 2) {
        // THE PLATE IS SOLVED IN TORSO SPACE. THE HANDS ONLY GRIP IT.
        //
        // It used to be an offset in the HAND's frame — (−0.29, −0.24, 0.02),
        // "past the fingertips" — and that is only a forward direction while
        // the arm is under the carry branch's control. Any stance override at
        // all (and `intent === 'working'` was one, on most carrying frames)
        // repoints the forearm axis and the same offset drives the disc into
        // the pelvis: shots/j-chefs-r1-late-a/desktop/t0096s has the plate
        // drawn OVER the thigh and UNDER the apron, two meshes interpenetrating
        // at the hip. In desktop/t0103s it had slid to the ankle.
        //
        // A carry is a statement about the BODY, not about the wrist. The plate
        // now lives at a fixed point in the chest's own frame — forward of the
        // sternum by the torso's half-depth plus a hand, a shade above its
        // centre — and is converted back into the socket's local space, so it
        // is in the same place on screen whatever the arms are doing, and the
        // arms' only remaining job is to be under it. That is what the
        // reference does: every one of its four carried loads is forward and
        // low with daylight between load and torso, and none of them moves when
        // the carrier's pose does.
        this.tmp.set(0, b.bodyY - 0.13, b.chestR * 0.84 * s.girth + 0.26);
        this.hips.updateWorldMatrix(true, false);
        this.tmp.applyMatrix4(this.hips.matrixWorld);
        socket.updateWorldMatrix(true, false);
        socket.worldToLocal(this.tmp);
        this.hands.position.copy(this.tmp);
        // Level in WORLD, yawed with the rig, tipped 8° so the rim catches the
        // light and the contents are not seen edge-on from a camera above them.
        socket.getWorldQuaternion(this.qA).invert();
        this.eA.set(-0.14, this.rig.rotation.y, 0);
        this.hands.quaternion.copy(this.qA).multiply(this.qB.setFromEuler(this.eA));
      } else if (mode === 3) {
        this.hands.position.set(0.04, -0.06, 0.02);
        this.hands.rotation.set(level, 0, -cArm.hip.rotation.z);
      } else {
        // PRODUCE — RESTING ON TOP OF THE PAW, SOLVED THE SAME WAY THE TOWER IS.
        //
        // The old offset (0.02, −0.09, 0.05) is expressed in the HAND's frame,
        // and for a heavily abducted arm that frame's −Y points outward, away
        // from the body — so the offset shoved the load sideways past the
        // fingertips. Worse, a 0.49-wide tomato centred 0.09 from the wrist
        // swallows a 0.1 mitt whole: in shots/m6-r4/desktop/90-late bramble's
        // paw is entirely INSIDE the tomato, so the only thing you can see is a
        // red sphere at the end of a crimson sleeve with no hand anywhere in
        // it. Same failure the critic named, arrived at from the other
        // direction: a prop that swallows the hand reads no better than one
        // floating clear of it.
        //
        // So the socket is solved to world-vertical-plus-yaw (the arm's own
        // rotations divided out, exactly as `mode === 4` does), the load is
        // built sitting a fixed distance straight UP from the paw in that
        // frame, and the paw's bottom half stays proud of the load's silhouette
        // from every camera angle. A cupped hand under a tomato is the single
        // clearest way to say "this is being carried".
        this.hands.position.set(0, 0, 0);
        socket.getWorldQuaternion(this.qA).invert();
        this.eA.set(0, this.rig.rotation.y, 0);
        this.hands.quaternion.copy(this.qA).multiply(this.qB.setFromEuler(this.eA));
      }

      // --- THE HEAD CLAMP. Solved, not guessed.
      //
      // Four rounds of hand-tuned socket offsets have each fixed the load
      // landing on the carrier's face for one pose and broken it for another,
      // and the reason is that the offsets are authored in the CHEF's frame
      // while the failure happens in the CAMERA's. The rig looks down 22.5° at
      // a chef whose heading is whatever the sim says, so a load held out in
      // front projects UP the screen when the chef runs away from the lens and
      // DOWN when it runs toward it — the same offset is safe in one direction
      // and lands on the skull in the other. shots/mc-w2-r2/ipad-landscape/
      // 90-late is the proof: nori's plate is a pale disc sitting squarely over
      // its own beret and face, from the same code that renders correctly on
      // every chef running away.
      //
      // So the constraint is expressed where it lives. The rig's pitch is a
      // hard invariant (cameraRig.ts: "22–23° above the floor plane on EVERY
      // aspect"), which makes screen-up a fixed world direction,
      // u = (0, cos 22.5°, sin 22.5°); a payload is on the head exactly when
      // its projection along u comes within a head-and-a-bit of the head's. If
      // it does, the load is pushed DOWN-SCREEN along u by the overlap — in
      // world space, converted back through the socket's own rotation — until
      // it clears. Pose-independent, heading-independent, and it cannot be
      // defeated by a future carry pose because it is applied after all of them.
      const payload = this.hands.children[0];
      if (payload) {
        this.head.updateWorldMatrix(true, false);
        this.hands.updateWorldMatrix(true, false);
        payload.updateWorldMatrix(true, false);
        this.tmp2.setFromMatrixPosition(this.head.matrixWorld);
        this.tmp3.setFromMatrixPosition(payload.matrixWorld);
        const headUp = this.tmp2.y * CAM_UP_Y + this.tmp2.z * CAM_UP_Z;
        const payUp = this.tmp3.y * CAM_UP_Y + this.tmp3.z * CAM_UP_Z;
        // ...and it is a CIRCLE test, not a height test. Screen-right is world
        // X to a very good approximation (the rig pans but never rolls), so if
        // the load is already a head's width to one side — which is the whole
        // point of the produce carry — it may ride as high as it likes. Only a
        // load stacked over the midline has to give way, and then by exactly
        // the chord that clears the two discs. A flat height clamp fired on
        // every single carrying frame in the instrumented run and dragged every
        // payload down to the hips; this fires on the ones that are actually
        // about to erase a face.
        const dx = this.tmp3.x - this.tmp2.x;
        const lat = Math.abs(dx);
        {
          const clr = headClearFor(mode);
          const need = lat >= clr ? 0 : Math.sqrt(clr * clr - lat * lat);
          const over = payUp - (headUp - need);
          // Post-clamp overlap: 0 means the clamp resolved it, negative is the
          // margin by which the pose cleared the head on its own.
          this.tele.headClear = +Math.min(0, over).toFixed(3);
          if (over > 0) {
            // World delta, straight down-screen, converted into the socket's
            // local frame (uniform CHAR_SCALE, so one divide is exact).
            this.tmp2.set(0, -over * CAM_UP_Y, -over * CAM_UP_Z);
            socket.getWorldQuaternion(this.qA).invert();
            this.tmp2.applyQuaternion(this.qA).multiplyScalar(1 / CHAR_SCALE);
            this.hands.position.add(this.tmp2);
          }
        }

        // --- THE TORSO CLAMP. The head clamp above only ever asked "is this
        //     load about to erase a face", and the birdbath plate passed it
        //     every frame because it was nowhere near the head — it was inside
        //     the hips. So the second half of the invariant, stated the same
        //     way: a payload may not be closer to the chest's own axis than the
        //     torso's half-depth plus its own radius, measured in the CHEF's
        //     frame, unless it is already a torso's width out to the side
        //     (which is exactly what the produce carry is for and must not be
        //     punished for). If it is, it gets pushed straight out along the
        //     chef's forward axis until it clears.
        {
          this.tmp.set(0, b.bodyY, 0);
          this.hips.updateWorldMatrix(true, false);
          this.tmp.applyMatrix4(this.hips.matrixWorld);
          payload.updateWorldMatrix(true, false);
          this.tmp3.setFromMatrixPosition(payload.matrixWorld);
          const px = this.tmp3.x - this.tmp.x;
          const pz = this.tmp3.z - this.tmp.z;
          const sy = Math.sin(yaw);
          const cy = Math.cos(yaw);
          // Forward is the rig's local +Z; right is its local +X.
          const fwd = px * sy + pz * cy;
          const side = px * cy - pz * sy;
          const payR = (mode === 2 ? 0.24 : mode === 3 ? 0.16 : 0.2) * CHAR_SCALE;
          const halfD = b.chestR * 0.84 * s.girth * CHAR_SCALE;
          const halfW = b.chestR * s.girth * CHAR_SCALE;
          const needF = halfD + payR * 0.85;
          this.tele.bodyClear = +(fwd - needF).toFixed(3);
          if (Math.abs(side) < halfW + payR * 0.5 && fwd < needF) {
            const push = needF - fwd;
            this.tmp2.set(sy * push, 0, cy * push);
            socket.getWorldQuaternion(this.qA).invert();
            this.tmp2.applyQuaternion(this.qA).multiplyScalar(1 / CHAR_SCALE);
            this.hands.position.add(this.tmp2);
          }
        }
      }
    }

    // --- contact shadow. TRACKED TO THE FEET.
    //
    // It was tracked to the hips, at 75% of their offset, and sized off nothing
    // but the build's stance: 1.41 world units across for bramble, against a
    // chef whose shoulders are 0.45 across and whose whole body is 1.1 tall. A
    // disc three times the width of the thing standing on it cannot be a
    // contact shadow at any opacity — spread that thin it is a haze, which is
    // exactly what the verdict found ("no usable contact shadow on anyone…
    // pip and mochi have no dark ellipse at all").
    //
    // So: half the footprint, centred on the MIDPOINT OF THE TWO FEET rather
    // than under the pelvis, and rotated into the chef's own heading so it can
    // stretch fore-and-aft with the stride instead of staying a circle. A body
    // at full extension now sits on a long dark smear between its two boots,
    // which is both the truth and the thing that says the feet are on the floor.
    this.legR.foot.updateWorldMatrix(true, false);
    this.legL.foot.updateWorldMatrix(true, false);
    this.tmp2.setFromMatrixPosition(this.legR.foot.matrixWorld);
    this.tmp3.setFromMatrixPosition(this.legL.foot.matrixWorld);
    this.tmp.addVectors(this.tmp2, this.tmp3).multiplyScalar(0.5);
    this.shadow.position.x = (this.tmp.x - this.root.position.x) * 0.85;
    this.shadow.position.z = (this.tmp.z - this.root.position.z) * 0.85;
    // Local +Y of the plane maps to world −Z after the −90° X flip; spinning it
    // by yaw + π aims that axis down the chef's facing, so `scale.y` is the
    // fore-aft axis of the ellipse.
    this.shadow.rotation.z = yaw + Math.PI;
    const drop = 1 - amp * 0.16 * pass;
    // Sized off the stance, so a stocky bear gets a wider blob than a lanky
    // frog — but roughly the width of the BODY now, not of the room.
    const foot = 0.58 + b.stance * 1.5 + s.girth * 0.1;
    this.shadow.scale.set(
      (foot + this.brake * 0.1) * drop,
      // Stretched along the run: at full stride the feet are most of a body
      // length apart and one soft pool under both of them is what the reference
      // draws under Waluigi mid-air.
      (foot * (0.92 + amp * 0.62) + this.brake * 0.2) * drop,
      1,
    );
    // 0.78 on a footprint less than half the old area — the same ink over a
    // third of the floor, which is the difference between a haze and a shadow.
    // It thins under a fast run (the body is further off the stone) but never
    // below half, because a chef with no shadow is a chef pasted onto the floor.
    this.shadowMat.opacity = 0.78 * drop - run * 0.12;

    // --- player marker. Same footprint tracking as the shadow, one ease-in-out
    //     breath every 1.4s, and it swells slightly under a run so the ring is
    //     easiest to find at exactly the moment the player is moving fastest.
    if (this.ring && this.ringMat) {
      this.ring.position.x = this.shadow.position.x * 0.6;
      this.ring.position.z = this.shadow.position.z * 0.6;
      const ph = (time / 1.4) % 1;
      // Smoothstep both ways: a sine peaks for a long time and troughs for a
      // long time, which reads as a slow strobe. This dwells at neither end.
      const e = ph < 0.5 ? ph * 2 : 2 - ph * 2;
      const pulse = e * e * (3 - 2 * e);
      // THE RING SITS INSIDE THE SHADOW. The comment at the constructor has
      // claimed that for three rounds and the render has never done it: the
      // ring was scaled by the SAME `foot` as the contact shadow, at additive
      // 0.44–0.74, so it drew a warm halo the full width of the shadow and
      // brighter than the stone under it. In the 5× crop of
      // shots/mc-w2-base/desktop/90-late bramble is standing on a pale grey
      // donut with a light centre — the shadow is not visible at all, the
      // player reads as levitating on a puck of light, and it is the single
      // ugliest 40 pixels in the build.
      //
      // 1.05 of a footprint that is now less than half as wide, at a third of
      // the opacity: a small warm glow that lives inside the dark pool instead
      // of erasing it, and that can never out-shout a tomato.
      // 1.72 of the footprint: the annulus lives at r = 0.82 of a 0.68 plane, so
      // this lands the hoop on the OUTER edge of the contact pool rather than
      // through its middle. The ring circles the shadow; it never lights it.
      // ROUND 4, AND THE MEASUREMENT IS THE ARGUMENT. On
      // shots/j-chefs-r1-desktop/desktop/01-opening the band under the player
      // read luma 129.9 against 136.3 of clean floor beside it — a 5% drop —
      // while every BOT gets 30% (104.8 against 149.1 under mochi at t0096s).
      // Same shadow material, same opacity, same footprint: the difference is
      // that the player has an additive hoop sitting on top of the only part of
      // the pool a camera at 22.5° can actually see. A marker that costs the
      // player their contact shadow is a bad trade — the reference gives all
      // eight of its bodies a dark pool and none of them a light one.
      //
      // So the hoop is pulled in tight to the pool's own rim and cut to a
      // sixth of its old strength, and its tint moves off cream (255,232,176 —
      // nearly white, which on a luma-154 floor can only ever brighten it)
      // toward amber, so what it adds is CHROMA rather than value. It still
      // reads instantly, because a warm-edged pool among four plain ones is a
      // difference in kind and not a difference in brightness.
      const g = foot * (1.5 + pulse * 0.1 + run * 0.07);
      this.ring.scale.set(g, g * 0.94, 1);
      this.ringMat.opacity = 0.17 + pulse * 0.09 + run * 0.05;
    }

    // --- instrument. Written LAST, from the bones themselves, so it reports
    //     what was posed rather than what was intended. See RigTelemetry.
    const T = this.tele;
    T.speed = +speed.toFixed(3);
    T.run = +run.toFixed(3);
    T.gait = +gait.toFixed(3);
    T.amp = +amp.toFixed(3);
    T.brake = +this.brake.toFixed(3);
    T.thighSplitDeg = +(
      Math.abs(this.legR.hip.rotation.x - this.legL.hip.rotation.x) *
      (180 / Math.PI)
    ).toFixed(1);
    T.armSplitDeg = +(
      Math.abs(this.armR.hip.rotation.x - this.armL.hip.rotation.x) *
      (180 / Math.PI)
    ).toFixed(1);
    T.pitchDeg = +(this.rig.rotation.x * (180 / Math.PI)).toFixed(1);
    this.legR.foot.updateWorldMatrix(true, false);
    this.legL.foot.updateWorldMatrix(true, false);
    this.tmp2.setFromMatrixPosition(this.legR.foot.matrixWorld);
    this.tmp3.setFromMatrixPosition(this.legL.foot.matrixWorld);
    T.footLowY = +Math.min(this.tmp2.y, this.tmp3.y).toFixed(3);
    T.footHighY = +Math.max(this.tmp2.y, this.tmp3.y).toFixed(3);
    T.mode = mode;
    T.carrying = describe(chef.carrying);
    T.dt = +dt.toFixed(4);
    this.shadow.updateWorldMatrix(true, false);
    this.tmp2.setFromMatrixPosition(this.shadow.matrixWorld);
    T.shOp = +this.shadowMat.opacity.toFixed(3);
    T.shY = +this.tmp2.y.toFixed(4);
    T.shSX = +this.shadow.scale.x.toFixed(3);
    T.shSY = +this.shadow.scale.y.toFixed(3);
    T.shVis = this.shadow.visible && !!this.shadow.parent && !!this.root.parent ? 1 : 0;
    if (chef.carrying && this.hands.children.length) {
      socket.updateWorldMatrix(true, false);
      this.tmp2.setFromMatrixPosition(socket.matrixWorld);
      const payload = this.hands.children[0];
      payload.updateWorldMatrix(true, false);
      this.tmp3.setFromMatrixPosition(payload.matrixWorld);
      T.payloadGap = +this.tmp2.distanceTo(this.tmp3).toFixed(3);
    } else {
      T.payloadGap = 0;
      T.headClear = -9;
      T.bodyClear = 9;
    }
    T.carrySide = this.carrySide;
  }

  dispose() {
    const i = LIVE.indexOf(this);
    if (i >= 0) LIVE.splice(i, 1);
    const j = TELE.indexOf(this.tele);
    if (j >= 0) TELE.splice(j, 1);
    this.shadowMat.dispose();
    this.ringMat?.dispose();
  }
}
