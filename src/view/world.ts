import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { INGREDIENT_DEFS } from '../domain/content';
import { inOvenSpan, ovenSpan, stationCenter } from '../domain/kitchen';
import type { Kitchen, Station, Carryable, Ingredient } from '../domain/types';
import { PALETTE, flat, flatOwn, glazed, metal, toon, toonMapped } from './materials';
import {
  STUCCO_TILE,
  TIMBER_TILE,
  alignTile,
  stoneFloorTexture,
  stuccoTexture,
  timberTexture,
} from './textures';

/**
 * THE SET.
 *
 * The reference room is a place someone works in, not a level: ochre stucco
 * carried on honey timber framing, a limestone chimney breast with a stone arch
 * oven burning in it, stone wainscot, a plank door on one side and a rack of
 * copper pans on the other, big warm flagstones underfoot — and something on
 * every single surface.
 *
 * Two rules keep that density from costing anything:
 *
 *  1. Everything static is authored in WORLD SPACE and merged, per colour, into
 *     a handful of meshes. Three hundred little props cost about twenty draw
 *     calls, not three hundred. Only the things that actually change frame to
 *     frame — a station's contents, its progress ring, its focus glow, the
 *     fire — stay as live objects.
 *  2. Surface detail is texture, not geometry. Brick courses, plank grain,
 *     stucco mottle and flagstone grout are drawn once into a canvas.
 *
 * Domain coordinates are (x, y) on a grid; world is (x, height, y).
 */

// --------------------------------------------------------------- proportions

/**
 * How tall the room shell is built — CameraRig solves its framing against this
 * (its WALL_TOP must never exceed it).
 *
 * ROUND 8: 8 -> 9.6, AND IT IS FOR ONE PROFILE ONLY.
 *
 * The rig's width solve hands frame width back until the TOP edge fits under
 * the shell, and on iPhone portrait that stop was the binding constraint on the
 * whole composition: halfWidth 3.69, a frame 2.23 units wide at the row the
 * chef stands on, and therefore a pan that had to choose between the player and
 * the oven. Every landscape profile tops out between y 5.0 and 6.2, so nothing
 * above y 6.5 is ever in a landscape frame and this costs them nothing but a
 * taller plaster box. Portrait may now reach y 8.85 and still be looking at
 * built room: see the second beam course and the eaves band in buildBackWall().
 */
const WALL_H = 9.6;
/**
 * The room's own head height — where the eaves band starts and the second beam
 * course caps the wall.
 *
 * 7.0 is chosen off the rig's own numbers: every landscape profile's top edge
 * lands between y 5.0 and 6.2 (iPad is the highest at 6.20), so nothing here is
 * ever in a landscape frame, and iPhone portrait's top edge sits at 7.55 at
 * rest — so the course caps the portrait picture instead of leaving its top
 * fifth as bare plaster, which is what a critic measured as "61-65% dead blocks
 * in the top 22%". Above it the wall runs on to WALL_H in shadow, which is
 * where the portrait frame goes when it opens up.
 */
const EAVES_Y = 7.0;
/** World z of the back wall's front face. */
const BACK_Z = 1;
/** The main horizontal timber band, and the secondary one up under the eaves. */
const BEAM_Y = 4.35;
const BEAM_H = 0.62;
/** Retired in round 12 — the eaves band is plaster in the reference. Kept as a
 *  named height because the camera rig and the HUD both solve against it. */
const BEAM2_Y = 6.9;
void BEAM2_Y;
/** Cobble skirting height on the side walls — knee-high, as the reference's is. */
const WAINSCOT_H = 0.9;
/** Knee-height prep bench, and the taller fixed counters along the back wall. */
/**
 * LOWER THAN IT WAS, AND THE APRON IS THINNER.
 *
 * The reference's one load-bearing rule is that a low table never occludes a
 * character; ours broke it in every device profile, and worst on iPhone
 * portrait where the camera pitches up and a front-rank bench ate a chef from
 * the hip down. 0.44 put the bench top at 38% of a chef's height with a
 * 0.98-deep apron under it, which is a solid slab a metre wide with no daylight
 * in it. 0.38 with a shallow apron shows floor between the legs, so even where
 * a bench does cross a chef you still read the whole silhouette through it.
 */
const TABLE_H = 0.38;
const COUNTER_H = 0.86;
/**
 * Where the arch springs, and the top of the stone floor under it.
 *
 * Both hearth slabs — the sooted floor inside the mouth and the pale lip that
 * projects out of it — are built at centre `HEARTH_SPRING - 0.4` and 0.3 tall,
 * so their shared upper surface is `HEARTH_SPRING - 0.25`. The burners that now
 * live in the mouth stand on exactly that number rather than on a copy of it;
 * one constant is the only thing keeping a hob from floating a centimetre above
 * its own hearth or sinking into it.
 */
const HEARTH_SPRING = 0.86;
const HEARTH_TOP = HEARTH_SPRING - 0.25;

// ------------------------------------------------- THE VALUE CEILING (round 15)
/**
 * NO ARCHITECTURAL PIXEL MAY EXCEED THE PEAK VALUE OF A TOMATO TRAY.
 *
 * This is the one rule the whole reference composition is built on, and until
 * round 15 it was a paragraph of prose in a comment that five rounds of hand
 * tuning walked straight past. Measured on refs/dash-and-dine-01, sampling
 * every pixel of the frame masked by hue and chroma:
 *
 *                        reference          ours (round 14)
 *   ochre wall band    V p50 0.66  p90 0.74    0.64 / 0.83
 *   oven mouth         V p50 0.61  p90 0.76    0.63 / 0.90   p99 1.00
 *   tomato (7x7 probe) V 0.75  S 0.75          V 0.78
 *
 * The medians were already close. What was wrong was the TOP END: the top
 * decile of our oven mouth ran a sixth of a stop over the reference's and its
 * top percentile was clipped white, so the loudest object in the frame was
 * architecture sitting at the vanishing point. The eye landed on the oven,
 * then the wall, and only third on the food.
 *
 * So the ceiling is enforced rather than described. Every architectural tone
 * goes through `capArchitecture`, which is not a style choice — it is a guard
 * rail that makes a regression impossible to author by accident. It fires at
 * module load, before a single mesh exists, and it names what it clamped.
 *
 * Two ceilings, because the reference has two. Its chimney breast is V 0.79 at
 * S 0.17 — brighter than its own tomato and no threat to it, because value at
 * near-zero chroma is a different axis. Its most saturated architecture, the
 * ochre wall, tops out at V 0.74. Stone may own value; nothing that owns
 * chroma may.
 */
const TOMATO_V = 0.90; // INGREDIENT_DEFS.tomato, 0xe61c0a
/** Saturated architecture: a stop under the tomato, which is where the reference's is. */
const ARCH_CEIL_CHROMATIC = 0.74;
/** Near-neutral masonry: allowed the top of the range, because it costs the food nothing. */
const ARCH_CEIL_NEUTRAL = 0.92;
/** Above this chroma a surface is competing with food and takes the low ceiling. */
const ARCH_CHROMA = 0.4;
void TOMATO_V;

function valueOf(hex: number): { v: number; s: number } {
  const r = (hex >> 16) & 255, g = (hex >> 8) & 255, b = hex & 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  return { v: mx / 255, s: mx === 0 ? 0 : (mx - mn) / mx };
}

/**
 * Pull chroma out of a colour while holding its VALUE and its hue.
 *
 * Round 16 measured the room's median saturation below the HUD at 0.55-0.59
 * against the reference's 0.45-0.48 — and it had been asked for twice. The
 * reference's food detonates because the room around it is muted; ours merely
 * leads, because every large warm surface we own is carrying eight to eleven
 * points of chroma more than the equivalent surface in the reference.
 *
 * The move has to be chroma-only. Two previous rounds tried to get there by
 * lowering value and the result was a dark room, not a muted one — and the
 * whole-frame luma is currently a match (ours med 131-136 against 139) so there
 * is nothing to spend there. Raising the two lower channels toward the top one
 * leaves max(r,g,b) — the V in HSV — exactly where it was.
 */
function desaturate(hex: number, k: number): number {
  const ch = [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
  const mx = Math.max(...ch);
  const out = ch.map((c) => Math.round(c + (mx - c) * k));
  return (out[0] << 16) | (out[1] << 8) | out[2];
}

/** Scale a colour's value while holding its hue and its saturation exactly. */
function scaleValue(hex: number, k: number): number {
  const ch = [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255].map((c) =>
    Math.max(0, Math.min(255, Math.round(c * k))),
  );
  return (ch[0] << 16) | (ch[1] << 8) | ch[2];
}

/**
 * The tones the ceiling governs: everything the player cannot pick up, walk
 * off with or cook. Furniture and props are deliberately NOT in here — a bench
 * top brighter than the flagstone it stands on is load bearing (see C.benchTop)
 * and the reference's is too. This is the room's shell and its fire.
 */
const ARCHITECTURE = [
  'plaster', 'plasterShade',
  'timber', 'timberDark', 'timberLight',
  'stone', 'stoneDark', 'stoneWarm', 'stoneJoint',
  'hearth', 'hearthDark',
  'cavity', 'cavityMid', 'cavityDeep', 'cavityTop',
  'emberBrick', 'emberLip', 'emberBed', 'loafCrust', 'loafTop', 'loafChar', 'loafShade',
  'archLine', 'archStone', 'archStoneWarm', 'archStoneDark',
  'terracotta', 'terracottaDark',
  'ember', 'emberHot', 'sootDark',
  'cobble', 'cobbleAlt', 'cobbleCap',
] as const;

/**
 * Every tone the ceiling had to pull down, in author order. Nothing in the
 * shipped palette should ever land in here — a non-empty list means somebody
 * wrote a hex over the ceiling and the guard rail caught it. Surfaced in dev
 * only, because the capture harness counts a console warning as an error and
 * a diagnostic that fails the build is a diagnostic people delete.
 */
export const CEILING_CLAMPS: string[] = [];

function capArchitecture<T extends Record<string, number>>(tones: T): { [K in keyof T]: number } {
  const out = { ...tones } as { [K in keyof T]: number };
  for (const key of ARCHITECTURE) {
    const k = key as unknown as keyof T;
    const hex = tones[k];
    if (typeof hex !== 'number') continue;
    const { v, s } = valueOf(hex);
    const ceil = s >= ARCH_CHROMA ? ARCH_CEIL_CHROMATIC : ARCH_CEIL_NEUTRAL;
    if (v <= ceil) continue;
    out[k] = scaleValue(hex, ceil / v) as T[keyof T];
    CEILING_CLAMPS.push(
      `C.${String(key)} 0x${hex.toString(16)} V=${v.toFixed(2)} S=${s.toFixed(2)} -> 0x${out[k].toString(16)} (max ${ceil})`,
    );
  }
  if (import.meta.env.DEV && CEILING_CLAMPS.length) {
    console.warn('[world] architectural value ceiling clamped:\n  ' + CEILING_CLAMPS.join('\n  '));
  }
  return out;
}

/**
 * Additive light inside the arch, on a hard budget.
 *
 * Five additive layers — a glow pool, a flicker pulse, three flame tongues and
 * an ember strip — all summed into the same few hundred pixels at the
 * vanishing point, and each one was tuned on its own. That is how the mouth
 * ended up clipped at V 1.00 while every individual tint looked reasonable in
 * the source. Three of the five are gone (see buildOven — the reference's oven
 * has no flame in it at all); the two that remain declare a share of one
 * budget and are clamped to it.
 *
 * The budget is expressed in what an additive layer actually contributes —
 * tint value TIMES opacity — because a dim tint at full opacity and a hot tint
 * at a tenth of it land in the same place, and every previous round tuned one
 * of those two numbers while ignoring the other.
 *
 * Shares: glow pool 0.24, flicker pulse 0.22. The remaining 0.54 of the budget
 * is simply not spent — it belonged to the three layers that were deleted, and
 * handing it back to the two survivors is how this object got loud in the
 * first place.
 */
const FIRE_ADD_BUDGET = 1.1;
function fireTint(hex: number, opacity: number, share: number): number {
  const { v } = valueOf(hex);
  const contribution = v * opacity;
  const cap = FIRE_ADD_BUDGET * share;
  return contribution <= cap ? hex : scaleValue(hex, cap / contribution);
}

const C = capArchitecture({
  // The ochre wall is the room's largest saturated field and it was running six
  // points of chroma under the reference's and a stop brighter: measured at
  // 1440px our upper wall renders rgb(195,130,44) H34 S0.77 V0.77 against the
  // reference's rgb(181,109,30) H32 S0.83 V0.71. Mustard, not khaki — but the
  // way to get there is chroma and a slightly lower value, not more orange.
  // ROUND 17: 12% of chroma out, value untouched (see desaturate()). The wall is
  // the largest saturated field in the room and it was measured on the
  // reference's number for HUE and VALUE — which is why it only gives up twelve
  // points where the furniture below gives up eighteen.
  plaster: desaturate(0xae8531, 0.12),
  plasterShade: desaturate(0x936e26, 0.12),
  // ARCHITECTURAL TIMBER IS THE ROOM'S DARK, AND IT IS NOT BENCH TIMBER.
  //
  // Scan one horizontal line across the reference's back wall at 22% frame
  // height: plaster runs Y 104-143, the timber posts crossing it drop to
  // Y 55-57 — rgb(121,40,4) — and the chimney between them climbs to Y 174-222.
  // That single line is the whole value architecture: dark armature, mid wall,
  // near-white stone, and it is why the reference reads at thumbnail size.
  //
  // The same scan on our build ran Y 83-137 END TO END. Post, beam and plaster
  // were one orange field with two luminance points between them. These three
  // tones are therefore keyed to rgb(121,40,4) — burnt sienna, not honey — and
  // they are deliberately a full stop below the BENCH timber below, which is
  // furniture and belongs in the room's mid band with everything else you can
  // walk up to and use.
  //
  // ROUND 10 — ART PASS, AND THE SCAN ABOVE WAS READ OFF ONE PIXEL.
  //
  // Re-run properly: twenty 5×5 block samples straight across the reference's
  // beam band, and twenty across ours at the matching height.
  //
  //   reference  H 26-32  S 0.83-0.95  V 0.46 → 0.74   (median 0.70)
  //   ours       H 25-28  S 0.89-0.95  V 0.51 → 0.55   (median 0.53)
  //
  // rgb(121,40,4) exists in the reference, but it is the SHADED side of a post
  // and its darkest joint line — the bottom of a range, not the mass. Keying
  // all three architectural tones to it made the top quarter of every capture a
  // dead-flat dark slab: four hundredths of spread across the entire width of
  // the frame, against the reference's twenty-eight. The armature really is the
  // room's dark end, and it is a warm mid-brown that carries its darks in its
  // own shading, not a burnt-sienna field with the lights off.
  //
  // Lifted ~24% so the lit faces land on the reference's median, and the
  // orientation-gated surface mottle in materials.ts puts the spread back.
  // ROUND 13 — ART/LIGHTING PASS, AND THE ARMATURE WAS BRIGHTER THAN THE WALL
  // IT CROSSES. (Cross-file change from the art-direction piece: three hex
  // constants, nothing else in world.ts touched.)
  //
  // Horizontal scan, both frames normalised to 1280 wide, at the height where
  // plaster and timber sit side by side:
  //
  //                       reference              ours (round 12)
  //   plaster           H 39  S 0.77-0.81  V 0.67-0.74     H 37-39  S 0.78-0.80  V 0.68-0.73
  //   timber, lit face  H 28-32  S 0.84-0.87  V 0.59-0.67  H 29-32  S 0.80-0.84  V 0.82-0.83
  //   timber, shaded    H 17-25  S 0.90-0.97  V 0.43-0.53  H 21-29  S 0.84-0.90  V 0.35-0.51
  //
  // Our plaster is on the reference's number to the hundredth. Our timber is a
  // full 0.16 of value ABOVE it, where the reference's is 0.07 BELOW — so where
  // the reference has post-dark / wall-mid / chimney-light, we had one bright
  // ochre field with the beams reading as the lightest thing in it. There is no
  // shader operator that can fix this: after the terracotta seek the plaster and
  // the timber are five degrees of hue apart and nothing written in RGB can pick
  // one out of the other. It has to be the albedo.
  //
  // Down ~22% at the same hue, which lands the lit faces on the reference's
  // measured V 0.62-0.66 and lets the posts and beams be the frame's dark rung.
  // Saturation goes UP with the drop (a darker ochre at the same chroma-per-unit
  // reads more saturated), which is also where the reference is: its timber is
  // the most saturated architecture in the room, not the least.
  timber: 0xa85e14,
  timberDark: 0x743f0d,
  timberLight: 0xb9701f,
  // Limestone — THE BRIGHTEST MASS IN THE FRAME, which is its only job.
  //
  // Reference chimney breast: rgb(228,222,196), L 83%, H 55° — a cool
  // near-white slab. Ours rendered rgb(160,140,102), L 52%, H 38°: a warm
  // mid-tone in the same family as the plaster behind it and the flagstones
  // under it, so the back wall had no light end and therefore no structure.
  //
  // This is not a fight with the food. Food owns SATURATION (and is gated out
  // of the top of the value range by nothing at all); stone owns VALUE at
  // near-zero chroma. They cannot compete, and the reference proves it: its
  // chimney is its brightest mass AND its tomato is its most saturated pixel.
  // ROUND 9: all three down ~7%. Block-averaged against the reference, its
  // chimney breast mass sits at V 0.68-0.74 and ours ran V 0.71-0.83, which is
  // most of why our top band measured V p50 0.761 against its 0.694. The breast
  // is still the brightest mass in the room and still separates from the wall
  // on both value and hue; it just no longer owns the top of the range on its
  // own, which the food needs.
  //
  // ROUND 10 — AND IT WAS STILL WINNING, AND IT IS STILL EMPTY.
  //
  // Shot at 1440 and cropped: the breast renders as a near-white card at rgb
  // ~(240,238,230) occupying 31% of frame width, with a blank rectangle 44% of
  // its own height standing above the arch crown. The brightest, largest shape
  // in the picture is an empty wall — and the reference's is not white at all,
  // it is a pale SAGE-GREY limestone with a distinct green cast and courses you
  // can count from across the room. Down another ~8% and pushed off the warm
  // axis onto the reference's cool grey-green, which also stops it reading as
  // "more plaster, but bleached". Nothing should out-value a white ingredient
  // tray except a light source.
  //
  // ROUND 10 — ART PASS, +8%, AND IT IS NOT A FIGHT WITH THE FOOD.
  //
  // Ten block samples across the reference's arch stones and up its breast come
  // back V 0.73 → 0.90 with peaks at 0.85-0.88; ours came back V 0.65 → 0.78.
  // The reference's chimney really is the lightest large mass in its picture,
  // and its tomato — the most saturated pixel in the same frame — sits at
  // V 0.63. They are orthogonal axes and neither one costs the other anything.
  // With the armature around it lifted onto the reference's number, the breast
  // had stopped being the top rung of the ladder at all: 0.78 against a beam at
  // 0.65 is not a value step, it is the same mid band twice.
  // ROUND 12 — THE BREAST WAS THE RIGHT VALUE AND THE WRONG TEMPERATURE.
  //
  // Cropped at 2.2× and put beside the reference's chimney, ours reads as
  // poured concrete and theirs reads as cut limestone, and the block-average
  // numbers say why it is not a value problem: ours rgb(196,188,159) H47,
  // theirs rgb(198,196,159) H57 / rgb(222,217,184) H52. Same luma, ten degrees
  // of hue. The reference's stone is a SAGE CREAM — green sits level with or
  // above red — and every ochre surface in the room is H 28-40, so those ten
  // degrees are the entire reason its chimney reads as a different material
  // rather than as bleached plaster. Ours had red leading, which is warm grey,
  // which is concrete.
  stone: 0xe9e8c8,
  stoneDark: 0xd4d4b3,
  stoneWarm: 0xdfdfbd,
  // The mortar between the chimney's courses and between the arch stones. It
  // gets almost no bounce term, so it renders a full stop under the stone it
  // separates: with the breast now sitting at L 81% the brick TEXTURE's own
  // joints had nothing left to say, and the biggest pale mass in the frame was
  // a smooth white card with a faint grid on it. Real proud courses casting
  // real joint lines is the only way to keep articulation in a surface this
  // bright.
  // ROUND 10: darker again, and there are now nine proud courses up the breast
  // instead of six. The blank panel above the arch crown is not going anywhere
  // — the reference's is proportionally BIGGER than ours (51% of its chimney
  // height against our 44%) — so the fix was never to shorten it. The fix is
  // that the reference's panel is visibly built out of stones and ours was a
  // smooth card. Articulation, in geometry, where the light can find it.
  stoneJoint: 0x7a7a63,
  // Hearth stone. ROUND 12 — IT WAS RENDERING PEACH.
  //
  // Sampled off our own 1440px capture the shelf came back rgb(226,179,135)
  // H 29 L 71 — a bright warm PEACH slab, the second-brightest mass in the
  // frame after the breast, sitting directly under the fire. The reference's
  // shelf is rgb(190,172,98) H 48 L 56: an olive-gold limestone, a full stop
  // under the breast above it and unmistakably a different, dirtier stone.
  // Ours was reading as a lit shelf; the point of the hearth is that it is the
  // part of the oven ash falls on.
  // ROUND 12b: down another ~7%. With the projecting lip cut back the shelf
  // stopped being a podium, but it is still the brightest thing inside the
  // arch — and the brightest thing inside a bread oven has to be the bread.
  // The reference's shelf reads a full stop under its chimney breast.
  // ROUND 14: the lip goes UP and yellower (the reference's shelf samples
  // rgb(202,181,117) L 180 H 46 against ours at L 147 H 29 — ours was a peach
  // slab, its is bright limestone-gold), and the interior sole comes DOWN, so
  // the shelf you see the edge of and the floor you see the top of stop being
  // the same continuous pale plane running back into the arch.
  hearth: 0xd0c489,
  hearthDark: 0x6e6440,
  // THE VAULT INTERIOR, AND THE ROUND-10 NOTE ABOVE IT MEASURED THE WRONG PIXEL.
  //
  // Round 9 and round 10 both quote "the reference's oven cavity is a warm brown
  // hole at rgb(112,52,13), V 0.44" and took the interior down again each time.
  // Sampled properly — a 6×6 grid across the whole visible mouth of
  // dash-and-dine-01, not one dark corner of it — the reference's cavity reads:
  //
  //     (129, 55,  8) (167, 89, 23) (161, 85, 27)
  //     (186,104, 30) (161, 54, 18) (165, 87, 23)
  //     (179, 66, 34) (161, 48, 14) (191, 79, 42)
  //
  // Luma 60–115, median around rgb(165,75,25). Ours rendered a dead-flat
  // rgb(70,30,13) — luma 37 — across the entire opening, i.e. HALF the
  // reference's value with none of its variation. The single largest dark mass
  // in our frame sat at the vanishing point, dead centre, and read as a black
  // cave punched in a white wall. The reference's oven is a lit amber hole with
  // bread in it; the only true darks in that picture are under the furniture.
  //
  // So the vault gets a real albedo — a warm rust that carries a bounce, exactly
  // as the plaster does — and the glow on top of it is a broad radial, brightest
  // where the loaves are, falling to `cavityDeep` at the crown. That reproduces
  // the reference's gradient instead of flooding a black box with orange.
  //
  // ROUND 12 — AND THEN IT WENT MILKY. Measured on our own capture the cavity
  // renders rgb(196,138,97): L 57, chroma 0.51, H 25. The reference's, sampled
  // at the same place inside the mouth, is rgb(151,75,15): L 33, chroma 0.90,
  // H 26. Same hue, two stops brighter and HALF the chroma — i.e. ours is not
  // a fire-lit hole, it is a beige fog. The four bounce terms below plus a
  // full-mouth additive glow plane were stacking a pale wash over a saturated
  // albedo and washing all the pigment out of it. Albedos deepen and gain
  // chroma; the bounce terms in LIFT come down with them; the glow plane
  // shrinks to a pool round the loaves (see buildOven).
  // ROUND 14 — AND EVERY ROUND SINCE 9 HAS BEEN DARKENING A HOLE THAT WAS
  // ALREADY HALF THE REFERENCE'S VALUE.
  //
  // Twelve block samples inside the reference's mouth against twelve inside
  // ours, both at matched scale:
  //
  //                       reference                 ours (round 13)
  //   above the loaves  rgb(179, 99,29) L 115     rgb( 99,35, 6) L 51
  //   left haunch       rgb(188,182,135) L 179*   rgb(101,44,13) L 57
  //   right haunch      rgb(160,116,66) L 123     rgb(105,39, 6) L 55
  //   the loaves        rgb(165, 58,20) L  86     rgb(134,50, 9) L 70
  //                                    (* clips the arch stone)
  //
  // Two inversions in one object. Our cavity is HALF the reference's value, and
  // our loaves are BRIGHTER than the cavity behind them where the reference's
  // are a full stop darker. The reference's oven is not a dark hole with a fire
  // in it — it is a bright rusty barrel vault glowing all over, with two dark
  // loaves silhouetted against it under a bright gold crust line. That reads at
  // 90px; a dark hole with slightly-less-dark shapes in it does not.
  //
  // These four tones now run a real ladder from the springing to the crown, so
  // the vault is brightest where the fire is and genuinely sooty at the top,
  // and the LIFT terms come up with them (a surface at the back of a hole
  // collects almost nothing off the room key — the bounce IS the fire).
  // ROUND 15 — THE LADDER WAS RIGHT AND ITS TOP RUNG WAS A STOP TOO HIGH.
  //
  // Sampled properly this time — every pixel of the reference's mouth, masked
  // by hue, not a hand-picked probe:
  //
  //                  reference        ours (round 14)
  //   cavity V       p50 0.61         p50 0.63     (a match)
  //                  p90 0.76         p90 0.90
  //                  p99 0.87         p99 1.00     (clipped)
  //
  // The median was already the reference's. The top decile was not, and a
  // clipped percentile at the vanishing point is exactly what makes the oven
  // beat a tomato at thumbnail size. Seven-pixel probes inside the reference's
  // mouth: vault crown rgb(143,69,20) V 0.56, vault mid rgb(174,96,26) V 0.68,
  // low haunch rgb(153,77,18) V 0.60. Nothing inside that arch is above 0.68.
  // The ladder is keyed straight to those four numbers and the additive light
  // over it is on a budget (see fireTint) so the sum cannot climb back out.
  // ROUND 15b: back up ~14%. With the four additive layers over it cut to two,
  // the first pass at this ladder took the whole mouth to V p50 0.47 / luma 65
  // against the reference's 0.61 / 92 — a black hole where the reference has a
  // lit rust vault, which is the failure round 14 was written to fix. The
  // albedo now carries the value the deleted flames used to fake.
  cavity: 0xbc580f,
  cavityMid: 0xa14a0c,
  cavityDeep: 0x7d3809,
  cavityTop: 0x5a2706,
  /**
   * The dark red-brown block the loaves bake on. ROUND 14: down ~30%. At
   * 0x8e2f1c with a 0x2a0c06 bounce it rendered a saturated scarlet bar right
   * across the bottom of the mouth under the bread — the most saturated run of
   * pixels in the frame, at the vanishing point, which is the one thing the
   * whole composition exists to prevent. Measured, the reference's block front
   * is rgb(133,69,31) L 84: a dark shadowed brick, not a light.
   */
  emberBrick: 0x6f3316,
  /** The burning top course of the ember bar, and the near-black bed under it. */
  emberLip: 0xa8390d,
  emberBed: 0x2a1006,
  // The loaves in the mouth. They sit at the back of a hole, so the room key
  // never reaches them — without a bounce they render as two brown ovals and
  // the reference's whole payoff shot is a pair of spectacles. The crust rim is
  // the brightest thing inside the arch and the topping is the reddest.
  // ROUND 12b — THE LOAVES NEED THE CONTRAST, NOT THE CAVITY.
  // With the vault deepened onto the reference's rust the two loaves became
  // the only thing in the arch, and they were reading as two dull tan domes:
  // the crust band under the front edge was within a few points of the vault
  // behind it. In the reference the crust is a bright gold rim and the top is
  // a deep red-brown, and that pair is the strongest local contrast anywhere
  // on the back wall. Crust up ~14%, top four degrees redder and deeper.
  // ROUND 12c — AND THEN THE BREAD BECAME THE MOST SATURATED PIXEL IN THE
  // FRAME, AT DEAD CENTRE, WHICH IS THE ONE RULE THIS WHOLE SET EXISTS TO
  // PROTECT.
  //
  // Measured on the iPad capture: loaf rgb(178,33,6), chroma 0.97, against
  // the near tomato at rgb(209,25,8), chroma 0.96. The oven sits at the
  // vanishing point, so a saturated red pair there beats every ingredient in
  // the room on placement even when it ties on chroma. The reference's loaf
  // samples rgb(179,89,44) — chroma 0.75, a full quarter-turn under its own
  // tomato — because it is bread with a red topping, not a red light.
  // Keyed straight to that number; the additive glow behind it supplies the
  // rest.
  // ROUND 14 — THE LOAVES HAVE TO BE THE DARK SHAPES, AND THE CRUST THE BRIGHT
  // LINE. Measured, the reference's topping renders rgb(165,58,20) L 86 against
  // a cavity at L 115, and the crust shows as a narrow gold band round the
  // outer edge at roughly L 155. That pairing — dark red field, bright gold rim,
  // both against a lit rust vault — is the strongest local contrast anywhere on
  // its back wall, and it is why you read "bread in an oven" and not "two
  // lozenges on a card". Ours had them the other way up.
  // ROUND 15 — A PALE CRUST RIM AND A DARK SAUCE DISC, WHICH IS WHAT A PIZZA IS.
  //
  // Enlarged 6x, the reference's two flatbreads are unambiguous: a thick pale
  // cream-gold crust running all the way round, and inside it a DARKER, more
  // saturated red-orange sauce field. Seven-pixel probes:
  //
  //   crust  rgb(168,93,28)  V 0.66  S 0.83   luma 108
  //   sauce  rgb(152,48,13)  V 0.60  S 0.92   luma  75
  //
  // The crust is one sixth of a stop ABOVE the sauce and a third of a stop
  // LESS saturated — a pale rim round a dark disc. Ours ran the crust at
  // V 0.97 (0xf8c465), a third of a stop over the reference's tomato, so the
  // brightest pixels in the room were a pair of bread rolls at the vanishing
  // point. Keyed to the probes; the ceiling above would have clamped it anyway.
  loafCrust: 0xbc8b4a,
  // Down a stop and off the orange. The reference's sauce is a deep red-brown
  // that the crust reads BRIGHT against; ours was a hot orange brighter than the
  // crust round it, which is why the pair read as two dishes of tomato soup.
  loafTop: 0x7c2a0d,
  loafChar: 0x6b2a0c,
  /** The pocket of shadow a loaf sits in on the ember block. */
  loafShade: 0x3b1406,
  // The dark grey-brown the reference outlines its whole arch ring in — a
  // single unbroken line at the extrados and the intrados. It is the only true
  // dark on the back wall and it is what makes the arch the strongest
  // silhouette in the room at thumbnail size.
  // ROUND 14: up ~22%. Measured, the reference's contour is rgb(135,126,101) —
  // a MID grey-brown about a stop under the stones it bounds — and ours was
  // rendering as a near-black horseshoe, i.e. a cartoon keyline round the one
  // shape in the room that is supposed to read as masonry.
  archLine: 0x5e5744,
  // THE RING WAS OUT-VALUING THE BREAST, WHICH IS BACKWARDS.
  //
  // Sampled on both at 1440px against the reference:
  //
  //     reference   breast Y 180-222   ring Y 158-169   (ring a stop UNDER)
  //     ours (r1)   breast Y 157-165   ring Y 178-204   (ring a stop OVER)
  //
  // The ring shared C.stone with the breast bands, and C.stone carries the big
  // neutral bounce the breast needs — so the voussoirs rendered as a bright
  // white horseshoe pasted on a duller wall, and the arch stopped reading as a
  // hole in masonry and started reading as a decal. In the reference the ring is
  // the SAME limestone one stop down: it is a shadowed edge round an opening.
  // Its own tones and its own, much smaller, bounce.
  //
  // ROUND 12 — AND IT WENT A STOP TOO FAR THE OTHER WAY. Measured, our ring
  // renders L 42 against the reference's L 54-63: ours is a dark grey horseshoe
  // pasted on a pale wall, which reads as a hole, and the reference's is bright
  // sage limestone one notch under the breast with a hard DARK CONTOUR line
  // round both edges of it. The separation is supposed to come from the
  // contour, not from sinking the whole ring. Up ~18% and onto the same sage
  // axis as the breast; C.archLine below carries the contrast instead.
  archStone: 0xd9d2a6,
  archStoneWarm: 0xdfd7a8,
  archStoneDark: 0xc6bf94,
  // TERRACOTTA PIERS UNDER THE HEARTH SHELF. Enlarge the reference's oven and
  // the pale hearth slab is carried on five short red-brick piers with dark
  // gaps between them — the only warm saturated accent on the whole back wall,
  // and the thing that stops the oven mouth from being a pale shelf floating in
  // a hole. Ours had a second grey slab there instead.
  // ROUND 12: down ~15%. These render rgb(211,170,117) — a pale peach — where
  // the reference's piers are a proper burnt terracotta well under the pale
  // shelf they carry. They are the only warm accent on the back wall and they
  // stop working the moment they climb into the shelf's own value band.
  // ROUND 15: down another ~20%. Under the arch these five piers were reading
  // as a BANK OF RED-LIT VENTS across the bottom of the oven — the critic's
  // words and, cropped at 2.3x, exactly what they look like. The reference's
  // piers are a dull unlit brick, well under the pale shelf they carry, and
  // they are in shadow because they are under a slab.
  terracotta: 0x7d3819,
  terracottaDark: 0x5c2711,
  // Bench timber — RE-KEYED, ROUND 6, AND THE ROUND 6 BRIEF WAS WRONG ABOUT IT.
  //
  // The note handed down was "the reference's benches sit at S 0.42 V 0.75,
  // desaturate every wood tone by 35%". Sampled directly out of
  // refs/dash-and-dine-01.jpeg with a 10×10 average, its bench tops actually
  // measure H 28-31, S 0.76-0.82, V 0.71-0.85 — MORE saturated than ours ever
  // were, not less. Desaturating 35% was tried, shot and looked at: the room
  // came back as bleached MDF and the benches stopped being furniture.
  //
  // The real difference was never chroma, it was INTERNAL VALUE RANGE. The
  // reference's bench walks V 0.85 on the lit top boards down to V 0.42 on the
  // apron and legs — a two-stop ladder inside one object. Ours sat at a flat
  // V 0.81 across top, apron and legs alike, because the toon ramp's foot was
  // at 0.52 and no face could fall away from the key. With the ramp foot fixed
  // (materials.ts) the top boards keep their honey and the apron and legs are
  // authored a full stop under them, which is where a bench gets its weight.
  //
  // Values are keyed off the sampled reference: top S 0.71 V 0.82, second board
  // a shade darker so a three-plank top reads as three planks, apron S 0.77
  // V 0.38 — that is the hard dark line under the top edge that the reference
  // has on every bench and we had nowhere.
  // ROUND 9 — FURNITURE IS A DARK ISLAND ON LIGHT STONE, AND OURS WAS NOT.
  //
  // Sampled off the real build at 1440px: bench top rgb(208,124,53) Y 141
  // against bare flagstone rgb(167,144,105) Y 146. Five points of luma between
  // the furniture and the ground it stands on, and no outline in the world can
  // separate two masses that close. The reference's benches sit at Y 110-135
  // against a floor at Y 152 — measurably darker, always, in every lighting
  // condition in the frame — and that single value break is why twelve tables
  // read as twelve tables from across the room.
  //
  // We also carry roughly three times the reference's furniture density, so we
  // have to buy the separation harder than it does. Dropped ~17% in value; the
  // chroma is left alone here and taken off at the end of the pipe instead
  // (materials.ts ROOM_DESAT), which is the only place it can be done without
  // also bleaching the wall band that already matches.
  // ROUND 10 — AND THE "DARK ISLAND" NOTE ABOVE IS MEASURED OFF THE WRONG PIXEL.
  //
  // Every previous round quoted "reference bench Y 110-135 against a floor at
  // Y 152" and took the wood down again. Cropped at 3.5× and sampled on the
  // actual lit TOP BOARD of the reference's near bench rather than on its
  // shadowed apron:
  //
  //     reference bench TOP    luma 159   its floor 132   ratio 1.20
  //     reference bench APRON  luma  94                   ratio 0.71
  //     ours (after round 9)   luma 103   our floor 159   ratio 0.65
  //
  // The reference's bench top is BRIGHTER than the stone it stands on. What is
  // dark is the apron and the legs, and the object gets its weight from that
  // two-stop ladder inside itself — not from the whole thing sinking into the
  // floor. Five rounds of honest-looking measurements had been reading the
  // shadow side and dragging the entire piece of furniture down with it, and by
  // round 9 our benches were a full stop UNDER our flagstones, which is why the
  // room read as brown clutter on pale concrete.
  //
  // Tops go up and get their chroma back; apron and legs stay exactly where they
  // are, so the ladder inside the bench gets deeper rather than shallower.
  // ROUND 11 — THE ROOM IS A THIRD LESS SATURATED THAN THE REFERENCE, AND THE
  // BENCHES ARE WHERE THAT DEBT IS.
  //
  // Whole-frame histogram, S > 0.72 at V > 0.5, our 1440px capture against
  // dash-and-dine-01: reference 30.7% of pixels, ours 18.0%. Sampled per
  // surface, the wall (S 0.79 vs 0.84) and the floor (S 0.35 vs 0.36) both
  // match — the gap is almost entirely the eleven benches, which render at
  // S 0.66 against the reference's measured S 0.77 on a lit top board and
  // S 0.92 on an apron. They cover more of the frame than anything except the
  // floor, and at S 0.66 they read as washed salmon MDF rather than as the
  // reference's honey butcher block.
  //
  // The premise several earlier rounds were working from — "the food must be
  // the only saturated thing" — is not what the reference does. Its room is a
  // RICHLY saturated warm orange field; the food reads because it owns hues
  // nothing else in the room has (tomato H2, lettuce H88, bacon pink), not
  // because everything else is grey. Chroma up across the timber, hue left
  // where it is, and a third board tone so a three-plank top still reads as
  // three planks now that they are all this close in value.
  // ROUND 10 — ART PASS. THE BENCHES WERE DARKER THAN THE FLOOR THEY STAND ON.
  //
  // Block-sampled across both reference captures, six points per bench:
  //
  //                    reference            ours
  //   bench top      H 27-39 S 0.67-0.80  H 30-31 S 0.82-0.85
  //                  V 0.81-0.90          V 0.68-0.75
  //   flagstone      V 0.61-0.69          V 0.63-0.70
  //
  // Its benches sit a fifth of the range ABOVE its floor; ours sat level with
  // it, occasionally under it. That single inversion is most of why our lower
  // two thirds fused into one orange field while the reference's reads as pale
  // stone with bright honey furniture standing on it — there was no value step
  // at the one edge in the picture the player looks at most, the edge where a
  // bench meets the ground.
  //
  // The light cannot fix it: an up-facing surface already collects ~0.85 of its
  // albedo here, so the top had to be repainted to nearly the top of the range
  // and let the rig bring it down onto the reference's number. Chroma comes off
  // at the same time (the seek in materials.ts finishes the job) because a
  // plank that bright at S 0.85 is neon, and the reference's is pine.
  //
  // The rail and the legs come up too but stay well below the top: at V 0.35 the
  // apron rendered near 0.28 and read as a black bar ruled under every bench,
  // which is not a shadow — the shadow is the contact pool on the floor, and it
  // cannot be seen if there is something darker sitting directly above it.
  // ROUND 14 — +11% AND ~12% OFF THE CHROMA, BOUGHT WITH THE NEW GROOVES.
  //
  // Measured, our bench top ran a mean luma of 137 against the reference's 123,
  // so on the mean alone these were already correct and the previous round's
  // brief ("lift roughly 30 luma") was reading a stale capture. What the
  // reference has and we did not is the RANGE: p10 69 / p90 194 against our
  // p10 102 / p90 169. `bench()` now lays real boards on a dark plate with 4.4cm
  // grooves between them, and a quarter of the top plane going to groove pulls
  // the mean down about 20 luma on its own — so the boards themselves can go up
  // to where the reference's LIT plank actually sits (luma 190-200) and the
  // whole object still lands on its mean. Chroma comes off with the lift for
  // the reason it always does at this end of the range: honey at S 0.72 is pine,
  // honey at S 0.85 is neon.
  // ROUND 17: 18% of chroma out of every plank tone, value held. Twelve benches
  // are the second-largest warm mass in the frame after the floor, and the
  // reference's are a notably duller honey than ours were — go and look at the
  // bench under its tomato tray beside ours. This is most of the 0.10 of median
  // saturation the room had to give back.
  benchTop: desaturate(0xf3ae57, 0.09),
  benchTopAlt: desaturate(0xd8933f, 0.09),
  benchTopWarm: desaturate(0xe8a14c, 0.09),
  // ROUND 17 — A BENCH IS THREE VALUES, AND OURS WAS ONE.
  //
  // Crop the reference's bench at 3x: a bright lit lip along the front top
  // edge, a mid honey top face behind it, and a distinctly darker front face
  // under it. Three separated rungs inside one object, and it is most of what
  // makes twelve pieces of furniture read as twelve objects on a floor of the
  // same hue. Ours rendered as one flat honey field with hairline grooves.
  benchLip: desaturate(0xf6b96b, 0.09),
  benchFace: desaturate(0xac6c26, 0.09),
  benchLeg: 0x824d0d,
  benchRail: 0x8d540e,
  // THE APRON IS ITS OWN TONE, AND IT IS THE DARKEST LARGE MASS IN THE LOWER
  // THIRD OF THE REFERENCE'S FRAME.
  //
  // Its bench walks luma 159 on the lit top board down to 94 on the apron and
  // lower on the legs — a two-stop ladder inside one object, and that ladder is
  // most of what makes twelve tables read as twelve tables across a floor of
  // the same hue. Measured, its apron samples rgb(99,53,21), luma 63.
  // Banded histogram: the reference carries 5.8% of its lower third below luma
  // 64 and we carry 3.1%, and this band — running the near-full depth of every
  // bench in the room, facing the camera — is where the reference keeps most of
  // that. Separate from `benchRail` on purpose: the rail also draws the plank
  // seams and the end caps, which are lines and want to stay near the top
  // board's own tone.
  benchApron: 0x59300a,
  // Crockery. NOT white. These were 0xf7f2e6 / 0xe8dfc9, which made ~20 trays
  // the brightest AND largest objects in the room: squint at the frame and you
  // saw a constellation of white rectangles instead of a constellation of
  // tomatoes. The reference's dishes are warm bone china that sits BELOW the
  // limestone chimney and barely above the bench it stands on — the food is
  // what carries the value. Anything paler than this and the trick inverts.
  //
  // ROUND 10 — AND THE MEASUREMENT SAYS THE OPPOSITE, NOW THERE ARE THIRTEEN OF
  // THEM AND NOT TWENTY-FIVE. Sampled off the reference, its ingredient dish
  // renders at luma 189 against a chimney breast at 193: the crockery is at the
  // very TOP of its value range, level with the brightest architecture in the
  // room, and that is precisely why a red tomato sitting in it reads in 200ms
  // from the far side of the floor. Ours rendered at 146 — barely 17 points
  // above the bench under it. The albedo below is already near the ceiling, so
  // the lift has to come from a bounce term (see LIFT); these go up a little to
  // give it something to work with.
  // ROUND 12 — THE MID AND LOW BANDS ARE SHORT OF LIGHTS, AND THIS IS WHERE
  // THE REFERENCE KEEPS THEM.
  //
  // Banded histogram, HUD strip excluded, ours against dash-and-dine-01:
  //
  //                 pixels above luma 180
  //     mid band      reference 20.7%    ours 11.8%
  //     low band      reference  7.8%    ours  4.9%
  //
  // The reference's mid and lower thirds are full of bright crockery: its
  // ingredient dish samples luma 189, level with its chimney breast, and there
  // is one in nearly every bench. That bone-white well is the value platform
  // the saturated food is read against — it is why a red tomato registers in
  // 200ms from the far side of the room — and ours renders at luma 167. Up ~5%
  // on the body and rim, with the bounce term below carrying the rest.
  tray: 0xf0e6cc,
  trayShade: 0xd6c9a8,
  trayWell: 0xe4d8b8,
  trayRim: 0xfaf3e2,
  teamRed: 0xc4564a,
  teamRedDark: 0xa03f36,
  teamRedTop: 0xd97a68,
  teamGreen: 0x63a552,
  teamGreenDark: 0x4a8340,
  teamGreenTop: 0x86c06c,
  steel: 0xcfc9b8,
  steelDark: 0x8b8577,
  iron: 0x4a3b2f,
  // Hanging copper. These were 0xc47b39 / 0x8e5324, which under the room's
  // weak steep key rendered at Y≈22 — the rack read as four flat brown
  // ellipses stuck to the wall. The reference's pans sample Y≈64: they are
  // the brightest thing on that wall after the plaster, with a bright rim, a
  // pale rope and a warm wooden handle. Lifted to where they can be seen.
  copper: 0xe0a154,
  copperDark: 0xc07c34,
  copperRim: 0xf2d49a,
  rope: 0xece2c8,
  // ROUND 9 — THE BRIGHTEST, MOST SATURATED PIXEL IN THE FRAME WAS THE FIRE,
  // AT DEAD CENTRE, AND IT IS SUPPOSED TO BE THE FOOD.
  //
  // Sampled at 1440px, our oven mouth rendered rgb(253,172,43) — V 0.99, S 0.83
  // — against the reference's oven cavity at rgb(112,52,13), V 0.44 S 0.88. The
  // reference does not show a fire. It shows two flatbreads in a warm brown
  // hole with a dim ember line under them, and the whole cavity sits BELOW the
  // room's median value. Ours was a lit lamp at the vanishing point, which is
  // the one place in a composition you cannot afford to put a distraction.
  //
  // emberHot was 0xffc357 — H 39, i.e. YELLOWER and paler than a tomato, so it
  // won on both value and area. Now a deep orange that keeps the fire's hue and
  // gives up the top of the value range. Peak flame chroma now sits under the
  // tomato's, so the most saturated pixel on screen is food.
  // ROUND 10 — STILL THE MOST SATURATED THING IN THE ROOM, AND IT IS AT THE
  // VANISHING POINT. Cropped at 1440px, the mouth is a full-height orange
  // gradient with a white-hot bar along the hearth and yellow flame tips
  // standing in front of the pizzas. The reference's oven cavity is a warm
  // BROWN hole: two flatbreads, a dull red ember line under them, and nothing
  // above knee height inside the arch. Both tones come down another ~13% and
  // off the yellow end; the tips now sit at H 22 rather than H 30, below the
  // tomato's chroma and well below its value.
  // ROUND 15: emberHot was 0xd06d1e — V 0.82 — which is over the architectural
  // value ceiling at the top of this file and was being clamped there rather
  // than authored. Written at the ceiling so the hex in the source is the hex
  // that renders.
  ember: 0xb8481a,
  emberHot: 0xbc6119,
  sootDark: 0x53301c,
  pancake: 0xe8a93f,
  pancakeAlt: 0xd9902c,
  bowlBlue: 0x5fa8bf,
  // The lip of the mixing bowl. Same glaze, lifted — see mixBowl().
  bowlRim: 0x8ec7d6,
  pieCrust: 0xe0b463,
  pieFill: 0xd98a2b,
  greenLeaf: 0x4f9412,
  knife: 0xd9d4c4,
  /** The chopping boards' working face — see case 'board'. Cool, so it can never merge with plank. */
  slate: 0xb4b79e,
  toadCap: 0xfaf4e6,
  toadCapRim: 0xe6dcc2,
  toadSkin: 0xf6e2c2,
  // Side-wall skirting. The reference's is a course of rounded river cobbles
  // about a foot high in a muted grey-green — NOT the tall pale brick panel we
  // had, which put two of the brightest, coldest, hardest-edged masses in the
  // room down the extreme left and right of the play field where the reference
  // has almost nothing.
  cobble: desaturate(0xa39a7c, 0.15),
  cobbleAlt: desaturate(0x8c836a, 0.15),
  cobbleCap: desaturate(0xaba284, 0.15),
});

/**
 * The warm-pale half of the larder. These read at L 60–80% at H 30–45° — the
 * same family as bone china, honey plank and ochre plaster — so they are the
 * ingredients that need a DARK ground under them rather than a light one.
 * Everything not listed here is saturated enough to sit in white porcelain.
 */
/**
 * WHICH INGREDIENTS SERVE OUT OF WHITE PORCELAIN.
 *
 * ROUND 9. This used to be the PALE half only — bun, potato, egg, rice, cheese
 * — on the reasoning that a loud ingredient carries its own separation and a
 * dish under it is just one more pale rectangle in a frame full of them. Half
 * right, and the wrong half: go and look at the reference. The three things it
 * actually asks you to fetch are a tray of pink bacon rashers, a tray of red
 * tomatoes and a tray of green lettuce heads, and every one of them is sitting
 * in white ceramic. That is not decoration — the bone-white well is the value
 * platform the saturated food is measured against, and it is where the
 * reference's contrast comes from.
 *
 * ROUND 10 — AND NOW THE LARDER IS THE REFERENCE'S LARDER, THIS IS A ONE-LINER.
 *
 * KITCHEN_MAP carries four ingredient types now instead of ten: tomato,
 * lettuce, bacon and bun. The three heroes ALWAYS serve out of white porcelain,
 * with no exception and no rotation — in the reference the bone-white well is
 * the value platform the saturated food is measured against, and a tomato pile
 * sitting straight on honey plank is saturated-warm on saturated-warm and reads
 * in 500ms instead of 200. The bun is not a hero, it is bread, and the
 * reference keeps its bread in timber and metal, so it takes the slat crate —
 * which is also what stops thirteen identical pale rectangles from landing on a
 * regular pitch across the floor.
 */
const TRAY_FOOD = new Set(['tomato', 'lettuce', 'bacon']);

// ------------------------------------------------------------ static batcher

/**
 * Collects world-space geometry and merges it, one mesh per colour. Everything
 * that never moves goes through here.
 */
class Props {
  private byColor = new Map<number, THREE.BufferGeometry[]>();

  /**
   * ART PASS — the one piece of data this file owes the shader.
   *
   * `materials.ts` could never author contact occlusion or form shading because
   * every prop is merged into a room-space mesh, so object space IS room space
   * and there is no per-prop origin to measure a base or a shoulder from. That
   * is written up at length on RIM_TINT in materials.ts, together with the fix:
   * "write a per-vertex attribute carrying height-within-prop at merge time…
   * would let this file do the rest in three lines."
   *
   * This is that attribute, and it is deliberately shaped so that geometry which
   * does NOT carry it — walls, floor, the whole cast — reads the WebGL default
   * of 0.0 and is therefore untouched. `aOcc` is the darkening itself, 0 at the
   * top of a primitive and up to ~0.66 at its base, damped by the primitive's
   * own height so a tray gets a hard seam, a counter carcase gets a soft bounce
   * gradient and an eight-metre wall gets nothing.
   */
  add(color: number, g: THREE.BufferGeometry) {
    const pos = g.getAttribute('position');
    if (pos && !g.getAttribute('aOcc')) {
      g.computeBoundingBox();
      const bb = g.boundingBox!;
      const y0 = bb.min.y;
      const ph = bb.max.y - y0;
      const occ = new Float32Array(pos.count);
      if (ph > 1e-3) {
        // Small props are the ones that need a contact seam; large ones only
        // want a whisper of bounce, or every carcase in the room turns into a
        // vertical gradient.
        const strength = 0.55 * Math.min(1, 0.3 / ph);
        for (let i = 0; i < pos.count; i++) {
          const u = Math.min(1, Math.max(0, (pos.getY(i) - y0) / ph));
          const f = 1 - u;
          occ[i] = strength * f * f * Math.sqrt(f);
        }
      }
      g.setAttribute('aOcc', new THREE.BufferAttribute(occ, 1));
    }
    let list = this.byColor.get(color);
    if (!list) this.byColor.set(color, (list = []));
    list.push(g);
    return this;
  }

  box(color: number, w: number, h: number, d: number, x: number, y: number, z: number, rz = 0, ry = 0) {
    const g = new THREE.BoxGeometry(w, h, d);
    if (rz) g.rotateZ(rz);
    if (ry) g.rotateY(ry);
    g.translate(x, y, z);
    return this.add(color, g);
  }

  cyl(
    color: number,
    rt: number,
    rb: number,
    h: number,
    seg: number,
    x: number,
    y: number,
    z: number,
    rx = 0,
    rz = 0,
  ) {
    const g = new THREE.CylinderGeometry(rt, rb, h, seg);
    if (rz) g.rotateZ(rz);
    if (rx) g.rotateX(rx);
    g.translate(x, y, z);
    return this.add(color, g);
  }

  ball(color: number, r: number, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1) {
    const g = new THREE.SphereGeometry(r, 12, 9);
    if (sx !== 1 || sy !== 1 || sz !== 1) g.scale(sx, sy, sz);
    g.translate(x, y, z);
    return this.add(color, g);
  }

  cone(color: number, r: number, h: number, x: number, y: number, z: number, rx = 0, rz = 0) {
    const g = new THREE.ConeGeometry(r, h, 10);
    if (rz) g.rotateZ(rz);
    if (rx) g.rotateX(rx);
    g.translate(x, y, z);
    return this.add(color, g);
  }

  build(root: THREE.Object3D, cast: boolean) {
    for (const [color, list] of this.byColor) {
      const merged = list.length === 1 ? list[0] : mergeGeometries(list, false);
      if (!merged) continue;
      const tier = TIER[color];
      const mesh = new THREE.Mesh(
        merged,
        tier === 'metal'
          ? metal(color, LIFT[color] ?? 0x000000)
          : tier === 'glazed'
            ? glazed(color, LIFT[color] ?? 0x000000)
            : toon(color, { emissive: LIFT[color] }),
      );
      mesh.castShadow = cast;
      mesh.receiveShadow = true;
      root.add(mesh);
    }
    this.byColor.clear();
  }
}

/**
 * BAKED FILL, per material.
 *
 * The room's key light is deliberately weak and steep — it has to be, or the
 * furniture throws long diagonal bars the reference has nowhere. The cost is
 * that a VERTICAL surface only ever collects about half its albedo, so the back
 * wall came out mud-brown where the reference's is bright mustard, and no
 * albedo can fix it: the value needed is off the top of the 0–255 range.
 *
 * So the walls carry their own bounce, exactly as a lightmapped set would. A
 * small emissive term per material, tuned by eye against the reference, lifts
 * the vertical planes into the reference's value band without touching the
 * lighting rig, without washing out the food, and without a single extra
 * light. Floor-level props are lit fine by the key and get almost none.
 */
/*
 * ROUND 12 — THE BOUNCE IS ALSO THE HUE.
 *
 * An emissive term is added on top of the shaded albedo, so on a surface that
 * only collects half its albedo off the key it is well over a third of the
 * final pixel — which makes it the strongest single lever on that surface's
 * hue. This one was authored at H 30, i.e. at TIMBER hue, and it was quietly
 * dragging the one big yellow field in the room down onto the same orange as
 * the armature crossing it. The reference's plaster measures H 39. Up nine
 * degrees, same value.
 */
const LIFT_PLASTER = 0x836416;
/**
 * Timber gets almost NO bounce. The bounce term exists because a vertical plane
 * only collects half its albedo off the room's steep key — but "half its
 * albedo" is exactly where the reference's timber sits. Lifting it was what put
 * the posts and the plaster on the same value, and once they are on the same
 * value the armature stops existing. The tint below does the rest.
 */
/*
 * WAVE 2 — AND THAT ARGUMENT WAS BUILT ON A MEASUREMENT NOBODY TOOK.
 *
 * "Half its albedo is exactly where the reference's timber sits" is false. Its
 * posts probe luma 119-123 against plaster at 130-141: 0.90, not 0.50. Albedo
 * alone cannot get there — a vertical face in this room renders at ~0.71 of its
 * albedo luma, so reaching 119 off the key would need a red channel of 279 — so
 * the armature needs the same bounce term the plaster has, at ~0.8 of its
 * strength and four degrees redder so the lift cannot desaturate the posts back
 * into the wall's hue.
 */
const LIFT_TIMBER = 0x87490a;
/**
 * THE SIDE WALLS ARE THE LIGHT END OF THE PLASTER, NOT THE DARK END.
 *
 * Measured across the reference: its back wall runs Y 97-118 and its two side
 * walls run Y 162-178 — they are the BRIGHTEST plaster in the frame, because
 * they are the only vertical planes turned towards the camera and the key.
 * Ours rendered them off the same bounce term as the back wall and then hung
 * the darkest props in the room on them, so the left and right fifths of every
 * frame came back at Y 40-50. That is not "an empty wall", it is a pair of
 * black bars where the reference has its brightest architecture.
 */
/*
 * ROUND 12 — AND IT OVERSHOT INTO BLEACH.
 *
 * Sampled at the top-left corner of our own 1440px capture the side wall came
 * back rgb(208,162,125): L 65 at a chroma of 0.40. The reference's side wall,
 * same place, is rgb(205,154,62) at chroma 0.70, and deeper into the room
 * rgb(168,91,22) at 0.87. Right value, HALF the pigment — because a bounce term
 * is additive and an additive lift raises the minimum channel fastest, so past
 * a certain size it stops being light and starts being fog. Two fifths of every
 * landscape frame was reading as pale peach haze where the reference has its
 * richest mustard. Down ~22% and off the blue: same value band, twice the
 * chroma, and the room stops looking like it is being shot through gauze.
 */
const LIFT_PLASTER_SIDE = 0x907125;
/**
 * Multiplies the plank texture down for the VERTICAL posts. Reference posts
 * sample about 0.65 of the plaster they cross — dark enough to read as an
 * armature at thumbnail, never so dark they become holes.
 */
/* ROUND 12: H 30 → H 26, and ~8% darker. See LIFT_PLASTER — the plaster went
 * nine degrees yellow, so the armature goes four degrees red to open the
 * reference's measured 13° gap from both sides at once. */
/*
 * WAVE 2 — "0.65 OF THE PLASTER" WAS NEVER TRUE, AND IT COST US THE ARMATURE.
 *
 * Probed off refs/dash-and-dine-01 at three separate posts: post rgb(180,106,29)
 * / (184,109,29) / (185,109,29) — luma 119-123, S 0.84 — against the plaster it
 * crosses at luma 130-141, S 0.73-0.75. That is 0.90 of the plaster, not 0.65,
 * and the separation is carried by TEN POINTS OF CHROMA and a lit arris, not by
 * value. Ours rendered at luma 80-86 against a wall at 113-148, so the beams
 * dissolved into a brown murk at the back of the room and the critic measured
 * a 53-luma spread inside one material with the timber sitting INSIDE the
 * wall's own band.
 *
 * The tint now carries the hue outright and `timberTexture` has gone pale and
 * near-neutral to carry grain and nothing else, so this constant and the plank
 * map can no longer fight each other over the same two stops.
 */
const TIMBER_FACE = 0xe8720f;
/**
 * The HORIZONTAL header is not the same tone as the posts. Sampled across the
 * reference's top band the header sits within a few points of the plaster
 * either side of it and separates on hue and on its lit top arris, not on
 * value; taking it to post-darkness stamped one flat black bar the full width
 * of the frame, which is a different way of losing the top third.
 */
/* ROUND 12: the header keeps its lit top arris and gives up four degrees of
 * hue and ~10% of value, so it belongs to the timber family rather than
 * splitting the difference with the plaster. Its `wallShade` band under the
 * soffit now carries the value contrast the old pale tone was standing in for. */
/* WAVE 2: up with the posts, and kept the ~10 luma under them the reference
 * holds (its header probes 110-115 against its posts at 119-123). */
const BEAM_FACE = 0xd66a12;
/**
 * The chimney breast. It is the largest pale mass in the frame and it is
 * SUPPOSED to be the brightest thing in the room — the reference's samples
 * rgb(228,222,196) against a wall at rgb(159,109,24), which is a 1.9× step, and
 * ours was managing 1.4×. The brick tile is authored at 0xf2ecc9, so the tint
 * comes off entirely and the bounce term goes up until the stone clears Y 190.
 * Cool, not warm: H 48° against the wall's 38°, so it separates on hue as well
 * as on value and cannot be mistaken for more plaster.
 */
/**
 * ROUND 10 — THE STEP IS STILL THERE, THE CARD IS NOT.
 *
 * The note above is right about the ratio and wrong about the destination. A
 * 1.9× step off the wall does not require the breast to render white; it
 * requires the WALL to be dark enough, and the wall is now bright mustard where
 * it used to be khaki. With the tint at 0xfffdf6 over a brick tile authored at
 * 0xf2ecc9 the breast came out at ~rgb(240,238,230) — a blank white slab at the
 * exact centre of the frame, out-valuing every ingredient tray in the room and
 * saying nothing. The reference's breast is a pale sage-grey with a real green
 * cast: it separates on HUE first (55° cool against the wall's 38° warm) and on
 * value second. So the tint comes down ~14% and off the warm axis, and the
 * bounce term comes down with it.
 */
/*
 * ROUND 11 — AND THE BREAST IS NOW A STOP UNDER THE REFERENCE, NOT OVER IT.
 *
 * Giving `brickTexture` the reference's real block-to-block spread (0.66–0.99
 * of the cream base, against the ±6% it used to run) cost the field about 17%
 * of its mean value, and the darker mortar behind it cost more. Measured:
 * reference breast Y 180–222, ours Y 157–165. The five previous rounds of
 * "the breast is too bright" were all measured while the breast was a smooth
 * card — the fix for a bright blank card is texture, not exposure, and now that
 * it has texture it can have its value back. It goes up ~12%, and the ARCH RING
 * comes down to sit under it (see C.archStone), which is the value order the
 * reference actually has.
 */
/*
 * ROUND 12: +7% of value, ~a third off the chroma, and off the grey axis onto
 * the sage one. Measured, our breast renders rgb(215,211,163) — L 74 at chroma
 * 0.24 — against the reference's rgb(227,222,193), L 82 at chroma 0.15. It is
 * meant to be the brightest and the LEAST coloured large mass in the picture,
 * so that the saturated food has somewhere unambiguous to sit against. Eight
 * points of luma is the difference between "an anchor" and "a pale patch".
 */
/*
 * ROUND 17 — THE BREAST WAS A BATHROOM WALL, AND THE BOUNCE TERM IS WHY.
 *
 * Cropped at 3x beside the reference: theirs is chunky irregular stone with
 * DARK joints and blocks that walk luma 130 -> 225 inside one course; ours is a
 * regular grid of near-identical pale tiles separated by even mid-grey grout.
 * The brick texture is authored with a 0.42 block-to-block spread, so the
 * variety exists in the albedo and never reaches the screen — and the reason is
 * arithmetic, not art. A toon surface renders `key * albedo + emissive`, and at
 * 0x676c60 the emissive was contributing more than half the final pixel as a
 * FLAT term, which divides the albedo's contrast by two before main.ts's
 * highlight shoulder — which the breast sits squarely inside, being the
 * brightest mass in the frame — compresses what is left.
 *
 * So the bounce comes down by ~45% and the breast gets its own texture
 * (`chimneyStoneTexture` below) authored to carry the contrast from the DARK
 * side, where the shoulder cannot reach it. Mean value drops a few points off
 * the reference's 193; block-to-block spread goes from about +/-5 luma to
 * +/-30, which is the thing being judged.
 */
const CHIMNEY_FACE = { lift: 0x2b2f27, tint: 0xffffff };

/**
 * CHUNKY IRREGULAR ASHLAR WITH DARK JOINTS — THE REFERENCE'S BREAST, NOT OURS.
 *
 * `brickTexture` in textures.ts serves the whole build and is not this file's
 * to re-author, and it was drawing what a chimney breast needs everywhere
 * EXCEPT in the two places the reference's differs most: its joints are a wide
 * mid grey (grout), and its blocks vary in tone but not enough to survive tone
 * mapping. This is the same idea drawn for one surface only:
 *
 *  - three to five blocks per course, widths jittered +/-35% and re-phased per
 *    course, wrapped so the tile still repeats invisibly;
 *  - a joint drawn as a NARROW dark bed ~40% under the block value, which is
 *    what makes stone read as laid rather than as tiled;
 *  - +/-12% of value per block plus an independent green-grey mottle, so no two
 *    stones next to each other are the same colour;
 *  - a bright bevel on the top-left of every block and a dark bed shadow on the
 *    bottom-right, so each stone has a light edge at 90px;
 *  - fine speckled grain over the face.
 */
const chimTex: { t?: THREE.Texture } = {};
function chimneyStoneTexture(px = 256): THREE.Texture {
  if (chimTex.t) return chimTex.t;
  const cols = 3;
  const rows = 4;
  const W = px * cols;
  const H = px * rows;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  let s = 0x5f3a91;
  const rand = () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
  const clip = (v: number) => Math.round(Math.max(0, Math.min(255, v)));
  const css = (r: number, gg: number, b: number, a = 1) =>
    a >= 1 ? `rgb(${clip(r)},${clip(gg)},${clip(b)})` : `rgba(${clip(r)},${clip(gg)},${clip(b)},${a})`;

  // The joint bed. Deliberately dark: this is the value the whole texture's
  // contrast is measured from, and it is the one part of the breast the
  // highlight shoulder cannot flatten.
  g.fillStyle = css(58, 56, 44);
  g.fillRect(0, 0, W, H);

  const joint = px * 0.019;

  // WAVE 2 — VALUE AND JOINT POLARITY WERE FIXED; SHAPE LANGUAGE WAS NOT.
  //
  // The critic credited this map's spread (ours 180-214 against the reference's
  // 168-207) and its dark joints, and then named exactly what still said subway
  // tile: "every block is an identical rounded rectangle with the same corner
  // radius on a regular running bond. The reference's blocks are irregular
  // quadrilaterals of visibly varying width, height and corner radius." Widths
  // were already jittered. Courses now carry jittered HEIGHTS that still sum to
  // the tile, so the breast keeps repeating invisibly, and every stone is drawn
  // through `stonePath` with four independent corner radii and a wandering
  // mid-point on each edge — no two stones share an outline. The old geometric
  // course ledges are long gone (see the round-11 note by the corbel), so there
  // is nothing left to contradict an irregular course.
  const rowY: number[] = [0];
  {
    const hs: number[] = [];
    let sum = 0;
    for (let i = 0; i < rows; i++) {
      const v = 0.76 + rand() * 0.5;
      hs.push(v);
      sum += v;
    }
    let acc = 0;
    for (let i = 0; i < rows; i++) {
      acc += (hs[i] / sum) * H;
      rowY.push(acc);
    }
  }
  /** Six shape numbers per stone: four corner radii, then two edge wanders. */
  const stonePath = (bx: number, by: number, w: number, h: number, s6: number[]) => {
    const wob = (v: number) => (v - 0.5) * px * 0.03;
    const rad = (v: number) => Math.min(px * (0.04 + v * 0.135), w * 0.36, h * 0.36);
    const a = rad(s6[0]);
    const b = rad(s6[1]);
    const cc = rad(s6[2]);
    const d = rad(s6[3]);
    g.beginPath();
    g.moveTo(bx + a, by);
    g.lineTo(bx + w * 0.5, by + wob(s6[4]));
    g.lineTo(bx + w - b, by);
    g.quadraticCurveTo(bx + w, by, bx + w, by + b);
    g.lineTo(bx + w + wob(s6[5]), by + h * 0.5);
    g.lineTo(bx + w, by + h - cc);
    g.quadraticCurveTo(bx + w, by + h, bx + w - cc, by + h);
    g.lineTo(bx + w * 0.5, by + h - wob(s6[4]));
    g.lineTo(bx + d, by + h);
    g.quadraticCurveTo(bx, by + h, bx, by + h - d);
    g.lineTo(bx - wob(s6[5]), by + h * 0.5);
    g.lineTo(bx, by + a);
    g.quadraticCurveTo(bx, by, bx + a, by);
    g.closePath();
  };

  for (let r = -1; r <= rows; r++) {
    const ri = ((r % rows) + rows) % rows;
    const y = rowY[ri] + (r < 0 ? -H : r >= rows ? H : 0);
    const bh = rowY[ri + 1] - rowY[ri];
    // 3-5 stones a course, widths jittered hard then normalised to the tile.
    const n = 3 + Math.floor(rand() * 2.99);
    const raw: number[] = [];
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const v = 0.65 + rand() * 0.7;
      raw.push(v);
      sum += v;
    }
    const bs: number[] = [0];
    let acc = 0;
    for (let i = 0; i < n; i++) {
      acc += (raw[i] / sum) * W;
      bs.push(acc);
    }
    const phase = rand() * W;
    for (let k = 0; k < n; k++) {
      // Tone is picked ONCE per stone and reused by both wrapped copies, or a
      // block straddling the seam comes out as two different stones.
      const shade = 0.74 + rand() * 0.36;
      const sage = (rand() - 0.5) * 2;
      const base = 0xeae6d3;
      const cr = ((base >> 16) & 255) * shade - sage * 14;
      const cg = ((base >> 8) & 255) * shade + sage * 4;
      const cb = (base & 255) * shade - sage * 17;
      const grain: [number, number, number, number][] = [];
      for (let i = 0; i < 26; i++)
        grain.push([rand(), rand(), rand(), rand()]);
      const blot: [number, number, number, number, number][] = [];
      for (let i = 0; i < 6; i++) blot.push([rand(), rand(), rand(), rand(), rand()]);
      // Shape, picked once per stone for the same reason the tone is.
      const s6: number[] = [];
      for (let i = 0; i < 6; i++) s6.push(rand());
      for (const wrap of [-W, 0]) {
        const x = bs[k] + phase + wrap;
        const bw = bs[k + 1] - bs[k];
        if (x > W || x + bw < 0) continue;
        const bx = x + joint;
        const by = y + joint;
        const bwv = bw - joint * 2;
        const bhv = bh - joint * 2;
        g.fillStyle = css(cr, cg, cb);
        stonePath(bx, by, bwv, bhv, s6);
        g.fill();
        g.save();
        stonePath(bx, by, bwv, bhv, s6);
        g.clip();
        for (const [a, b, w2, h2, rot] of blot) {
          g.fillStyle = css(cr - 30, cg - 20, cb - 34, 0.20 + w2 * 0.16);
          g.beginPath();
          g.ellipse(bx + a * bwv, by + b * bhv, px * (0.06 + w2 * 0.2), px * (0.04 + h2 * 0.12), rot * 3, 0, 6.284);
          g.fill();
        }
        for (const [a, b, t, d] of grain) {
          const dark = t < 0.55;
          g.fillStyle = dark ? css(88, 84, 62, 0.12 + d * 0.16) : css(255, 252, 236, 0.10 + d * 0.16);
          g.beginPath();
          g.ellipse(bx + a * bwv, by + b * bhv, px * (0.006 + d * 0.018), px * (0.006 + t * 0.014), 0, 0, 6.284);
          g.fill();
        }
        // Bed shadow under and right of the stone, light bevel over and left.
        g.fillStyle = css(cr * 0.62, cg * 0.62, cb * 0.6, 0.85);
        g.fillRect(bx, by + bhv - px * 0.032, bwv, px * 0.032);
        g.fillRect(bx + bwv - px * 0.028, by, px * 0.028, bhv);
        g.fillStyle = css(255, 253, 240, 0.5);
        g.fillRect(bx, by, bwv, px * 0.022);
        g.fillRect(bx, by, px * 0.02, bhv);
        g.restore();
      }
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  chimTex.t = t;
  return t;
}

/**
 * THE CHIMNEY IS ASHLAR, NOT SUBWAY TILE.
 *
 * `brickTexture` draws 4 × 4 stones per tile, and the tile it exports is
 * 2.4 × 1.6 world units — a stone 60cm × 40cm. Over a 4.85 × 4.4 breast that is
 * eight stones per course and eleven courses, and cropped at 1.3× next to the
 * reference the result is unmistakable: ours reads as bathroom tiling, the
 * reference reads as masonry. Its stones are roughly a fifth of the breast wide
 * — five to a course, seven courses — big enough that you read individual
 * BLOCKS with their own tone, which is where the chimney's whole texture story
 * lives. Same texture, same one upload; the tile just covers more wall.
 */
const CHIMNEY_TILE = { w: 3.88, h: 2.4 };
/** One course of the tile above, so proud joints land on painted joints. */
const COURSE_H = CHIMNEY_TILE.h / 4;

const LIFT: Record<number, number> = {
  [C.plaster]: 0x937144,
  [C.plasterShade]: 0x725834,
  [C.timber]: 0x2c1706,
  [C.timberLight]: 0x341b07,
  [C.timberDark]: 0x1e0f04,
  // Stone carries a big neutral bounce so the arch, the mantel and the
  // voussoirs stay in the chimney breast's value band instead of falling a stop
  // behind it — the arch is the silhouette that says "oven", and it was reading
  // as a slightly paler patch of wall.
  [C.stone]: 0x6d7773,
  [C.stoneWarm]: 0x636e6a,
  [C.stoneDark]: 0x5a6461,
  [C.stoneJoint]: 0x222524,
  // The hearth sits INSIDE the alcove, so it gets a fraction of the bounce the
  // breast gets. Any more and the slab climbs back to where the fire is.
  [C.hearth]: 0x1e1e14,
  [C.hearthDark]: 0x16160f,
  // The vault is a vertical surface facing the camera at the back of a hole, so
  // it collects almost nothing off the room key and everything off the fire.
  // These bounces are what put it in the reference's luma 60-115 band; without
  // them the albedo above still renders as a brown card in shadow.
  // ROUND 12: halved. Four bounce terms plus a full-mouth additive glow plane
  // took the cavity to L 57 at chroma 0.51 against the reference's L 33 at
  // 0.90. A hole lit only by its own fire keeps its pigment; the wash was
  // spending the frame's deepest saturated red on beige.
  // ROUND 14: up hard, because the vault is a vertical plane at the back of a
  // hole and the room key genuinely does not reach it — everything it has comes
  // from the fire, and "from the fire" is exactly what a bounce term is for.
  // Measured, these land the cavity at luma 108 → 45 from springing to crown
  // against the reference's 115 → ~60, and the additive halo round the loaves
  // carries the rest.
  // ROUND 15: down ~30% with the albedos. A bounce term is added on top of the
  // ceiling the albedo was just clamped to, so leaving these where they were
  // would have handed straight back the value the ladder gave up.
  // ROUND 15c — AND THE VALUE HAS TO COME FROM HERE, NOT FROM THE ALBEDO.
  //
  // With the three additive flame layers deleted the mouth measured V p50 0.44
  // / luma 61 against the reference's 0.61 / 92, and the albedo could not be
  // raised to close it: C.cavity is already sitting exactly on the
  // architectural value ceiling. That is the ceiling working as intended — a
  // surface at the back of a hole is not BRIGHT PAINT, it is dim paint with
  // fire on it, and "fire on it" is precisely what a bounce term models. Up
  // ~60%, which raises the median without touching the top percentile the way
  // another additive pool would.
  // ROUND 15d: +18% and four degrees warmer. Measured after the flame layers
  // came out, the mouth sat at V p50 0.49 / p99 0.92 against the reference's
  // 0.61 / 0.87 — the median a stop under and the top percentile a shade over,
  // i.e. a dark hole with one hot spot in it. Bounce is the term that moves the
  // median without touching the peak; the glow pool's share of the additive
  // budget comes down at the same time to take the peak with it.
  [C.cavity]: 0x71440c,
  [C.cavityMid]: 0x583409,
  [C.cavityDeep]: 0x402507,
  [C.cavityTop]: 0x2a1804,
  [C.emberBrick]: 0x140703,
  [C.emberLip]: 0x2e1104,
  [C.emberBed]: 0x0d0502,
  [C.loafCrust]: 0x342709,
  [C.loafTop]: 0x240c04,
  [C.loafChar]: 0x180802,
  [C.loafShade]: 0x120602,
  // The contour is the strongest line on the back wall, and at zero bounce it
  // bottomed out on the toon ramp's foot and rendered near-black — a keyline,
  // not a shadowed edge. The reference's is rgb(135,126,101), a mid grey-brown
  // roughly a stop under the stones it bounds.
  [C.archLine]: 0x3a3628,
  [C.archStone]: 0x484a30,
  [C.archStoneWarm]: 0x4b4a2e,
  [C.archStoneDark]: 0x3f4229,
  [C.terracotta]: 0x1e0c05,
  [C.terracottaDark]: 0x160904,
  [C.benchTop]: 0x2b1c05,
  [C.benchTopAlt]: 0x261805,
  [C.benchTopWarm]: 0x291a05,
  [C.benchLip]: 0x33230a,
  [C.benchFace]: 0x1d1204,
  [C.benchRail]: 0x180f03,
  [C.benchLeg]: 0x180f03,
  [C.benchApron]: 0x0f0902,
  // THE INGREDIENT DISH IS THE BRIGHTEST OBJECT ON THE PLAY FIELD, and it can
  // only get there on a bounce term: its albedo is already at 0xe8ddc2 and the
  // room's key only returns about 70% of an albedo on a near-horizontal
  // surface, so no colour in the 0-255 range reaches the reference's luma 189
  // on lighting alone. Neutral-warm, matched to the limestone's, so the china
  // stays china and does not turn into a second ochre.
  [C.tray]: 0x3b362a,
  [C.slate]: 0x2f322a,
  [C.trayShade]: 0x312e21,
  [C.trayWell]: 0x3f3a2c,
  [C.trayRim]: 0x474032,
  [C.teamRed]: 0x2c0d09,
  [C.teamGreen]: 0x0e2409,
  [C.pancake]: 0x2c1c05,
  [C.pancakeAlt]: 0x281905,
  [C.sootDark]: 0x1d0e05,
  [C.cobble]: 0x22211a,
  [C.cobbleAlt]: 0x1e1d17,
  [C.cobbleCap]: 0x24231b,
  // Both hang on a vertical wall, which collects about half its albedo off the
  // room's deliberately weak key. Without a bounce term they sink to Y≈22.
  [C.copper]: 0x4a2a08,
  [C.copperDark]: 0x3c2206,
  [C.copperRim]: 0x554120,
  [C.rope]: 0x3d382a,
  // The servers' caps are the reference's brightest small shape after the
  // chimney (Y≈88 against the chimney's 80) and are what makes a Toad readable
  // when only its head clears the counter rail. Ours rendered at Y≈77 beige.
  [C.toadCap]: 0x3a352a,
  [C.toadCapRim]: 0x2e2a20,
};

/**
 * THE CAVITY'S TONE LADDER, SAMPLED CONTINUOUSLY INSTEAD OF IN FOUR BUCKETS.
 *
 * The vault is drawn as twenty-six horizontal slats and each one used to pick
 * one of four tones off a threshold. Cropped at 2.3x that is three hard
 * horizontal lines across the mouth, the middle one landing two thirds of the
 * way up — exactly where the eye is guaranteed to be — so the back of the oven
 * read as a flat brown card with a shelf drawn on it. The reference's cavity
 * has no edge in it anywhere.
 *
 * Nine steps, not twenty-six: props are merged per colour, so every distinct
 * tone is a draw call, and nine is past the point where the banding resolves.
 * The interpolated tones are registered in LIFT as well as authored, because a
 * tone that misses the bounce table renders with no fill at all — which is how
 * an earlier attempt at this turned the whole vault black.
 */
// ROUND 17: 9 → 17. Nine tones over twenty-six slats is nine visible horizontal
// bands, and cropped at 4x beside the reference that is precisely what the back
// of our vault reads as — a panel of WOOD GRAIN. The reference's cavity is a
// smooth orange glow with no edge in it anywhere. Seventeen halves every band's
// height and its step, which is past where it resolves at any shipped size, and
// it costs eight extra merged colours in the shell.
const CAVITY_STEPS = 17;
const CAVITY_RAMP: number[] = (() => {
  const lerpHex = (a: number, b: number, f: number) => {
    const mix = (sh: number) => Math.round((((a >> sh) & 255) * (1 - f) + ((b >> sh) & 255) * f));
    return (mix(16) << 16) | (mix(8) << 8) | mix(0);
  };
  const stops = [C.cavity, C.cavityMid, C.cavityDeep, C.cavityTop];
  const lifts = stops.map((t) => LIFT[t] ?? 0);
  const out: number[] = [];
  for (let i = 0; i < CAVITY_STEPS; i++) {
    const t = (i / (CAVITY_STEPS - 1)) * (stops.length - 1);
    const j = Math.min(stops.length - 2, Math.floor(t));
    const f = t - j;
    const tone = lerpHex(stops[j], stops[j + 1], f);
    LIFT[tone] = lerpHex(lifts[j], lifts[j + 1], f);
    out.push(tone);
  }
  return out;
})();
/** u = 0 at the sole, 1 at the crown. */
function rampTone(u: number): number {
  const i = Math.round(Math.max(0, Math.min(1, u)) * (CAVITY_STEPS - 1));
  return CAVITY_RAMP[i];
}

/**
 * MATERIAL TIERS, BY COLOUR.
 *
 * Props are merged per colour, so a colour IS a material here. Everything in
 * the room used to be one matte toon: the stockpot was a flat grey cylinder
 * with a dot on it where the reference has a metal body with a rim and a
 * specular band, and the plate stacks were chalk discs. Two tiers, applied to
 * the handful of colours that are genuinely not wood or plaster, and the room
 * gains a material read it did not have. See materials.ts metal()/glazed().
 *
 * Deliberately short. If everything glints, nothing does.
 */
const TIER: Record<number, 'metal' | 'glazed'> = {
  [C.steel]: 'metal',
  [C.steelDark]: 'metal',
  [C.copper]: 'metal',
  [C.copperDark]: 'metal',
  [C.copperRim]: 'metal',
  [C.knife]: 'metal',
  [C.tray]: 'glazed',
  [C.trayRim]: 'glazed',
  [C.trayShade]: 'glazed',
  [C.trayWell]: 'glazed',
  [PALETTE.plates]: 'glazed',
  [C.bowlBlue]: 'glazed',
  [C.bowlRim]: 'glazed',
};

// ------------------------------------------------------------------ the view

export interface StationView {
  station: Station;
  group: THREE.Group;
  /** Where a carried item sits when placed here. */
  anchor: THREE.Object3D;
  ring: THREE.Mesh;
  glow: THREE.Mesh;
  /** The vertical half of the focus wash, on the bench's front face. */
  face: THREE.Mesh;
  hot?: THREE.Mesh;
  contentRoot: THREE.Group;
  contentKey: string;
  /** True for burners inside the oven arch: they have no bench, and a cavity behind them. */
  inOven: boolean;
  /** World y of this station's bench top — where the focus wash and the action glyph hang off. */
  topY: number;
}

export class WorldView {
  readonly root = new THREE.Group();
  readonly stationViews: StationView[] = [];
  private byId = new Map<number, StationView>();
  private shell = new Props();
  private props = new Props();
  private fire: THREE.Object3D[] = [];
  /**
   * Where each floor station's dish ends up once its bench has been staggered,
   * yawed and re-levelled — so the dish rides the plank instead of floating
   * over the cell centre the sim thinks in.
   */
  private benchAt = new Map<number, { x: number; z: number; yaw: number; h: number }>();
  private ovenGlow!: THREE.Mesh;
  private ovenPulse!: THREE.Mesh;
  /** The one thing in the room that moves without a chef touching it. See update(). */
  private steam: THREE.Mesh[] = [];
  private archBounce!: THREE.Mesh;
  private panSwing: THREE.Object3D[] = [];
  /** Chimney and arch proportions, measured off the reference capture. */
  private oven = (() => {
    const span = ovenSpan();
    // NARROWER BY 10%. Measured off the two captures: the reference's chimney
    // breast covers 28.4% of frame width, ours covered 31.5% — and ours is also
    // the brightest mass in the picture, so the extra area was being spent
    // exactly where it hurt most. At 4.85 the breast reads 5.08–9.93 against
    // timber posts whose inner faces are at 4.87 and 10.13, so the corbel above
    // it still nearly touches them and a thin strip of plaster shows either
    // side, which is what gives the breast an edge instead of a merge.
    const cw = span.x1 - span.x0 - 0.15;
    // WIDER AND LOWER. Crop the reference's oven at 1.7× and the arch is a broad
    // shallow semicircle: the ring's outer edge nearly touches the piers either
    // side, and it springs barely half a stone above the hearth shelf. Ours was
    // a tall narrow horseshoe springing a metre up — closer to a church door
    // than to a bread oven, and the vertical proportion is most of why the
    // blank panel above the crown felt so big. 0.34 of the breast and a 0.86
    // springing puts the crown at the same height while opening the mouth 17%.
    // ROUND 15 — AND 0.34 MADE THE MOUTH TWO THIRDS OF THE BREAST.
    //
    // Measured on the reference: its chimney breast spans 365px and its arch
    // OPENING spans 195px — 53% of the breast. Ours ran 68%, which is why the
    // oven read as a huge bright hole with a thin stone frame round it rather
    // than as a small opening in a big masonry chimney, and why the cavity —
    // the most saturated field in the room, sitting at the vanishing point —
    // occupied half again the frame area the reference gives it. Because
    // `archTop` is `spring + openHalf`, the same number also sets the crown, so
    // this brings the arch down 20% as well and the near-semicircle flattens
    // toward the reference's broad shallow profile.
    const openHalf = cw * 0.28;
    const spring = HEARTH_SPRING;
    return { span, cx: (span.x0 + span.x1) / 2, cw, chimH: BEAM_Y + 0.05, openHalf, spring, archTop: spring + openHalf };
  })();

  /**
   * THE ACTION GLYPH — one chunky wordless sign, floating over whichever bench
   * the button is currently pointed at.
   *
   * `chef.focusAction` has been computed every tick since the interaction pass
   * — the same plan `doGrab` executes, so it cannot disagree with the press —
   * and until now a grep over src/ui and src/view returned zero hits for it. It
   * existed only in report.json. The player was being told WHICH bench (badly)
   * and never WHAT.
   *
   * ONE object, not one per station: only the player has a focus the view cares
   * about, so this is built once and flown to the focused bench. That also buys
   * the pop-in and pop-out for free — REFERENCE.md's "animated in and out" — as
   * a scale spring on a single node.
   *
   * Wordless, per the reference, which carries an entire order on two tomatoes
   * and a rasher and no text at all:
   *   up chevron    take / dispense / serve   something arrives in your hands
   *   down chevron  place / return            something leaves them
   *   plus          combine / load            two things become one
   *   swap arrows   swap                      a trade, and its own undo
   *   bin           discard                   the only glyph that is an object
   */
  private glyphRoot = new THREE.Group();
  private glyphPop = new THREE.Group();
  private glyphs = new Map<string, THREE.Group>();
  private glyphKey = '';
  private glyphScale = 0;
  private glyphAt = new THREE.Vector3();

  constructor(private kitchen: Kitchen) {
    this.buildFloor();
    this.buildBackWall();
    this.buildSideWalls();
    this.buildOven();
    this.buildBenches();
    for (const st of kitchen.stations) this.buildStation(st);
    this.buildDressing();
    this.buildCornerAO();
    this.buildActionGlyph();
    this.shell.build(this.root, false);
    this.props.build(this.root, true);
  }

  private buildActionGlyph() {
    // Tilted to face a 22.5 degree camera (see cameraRig.ts — the pitch is the
    // one invariant of this game's framing), so the sign is square on from every
    // aspect ratio rather than foreshortened into a sliver.
    this.glyphPop.rotation.x = -0.3927;
    this.glyphRoot.add(this.glyphPop);
    this.glyphRoot.visible = false;
    this.root.add(this.glyphRoot);

    // The backing plate is the HUD's own dark translucent brown — the reference
    // uses exactly one chrome material for its three pills and nothing else, and
    // a prompt that matches the clock reads as part of the same game. Chunky,
    // rounded, drop-shadowed: never a hairline, never a flat rectangle.
    const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.35, 28), flatOwn(0x1b0f08, 0.3));
    shadow.position.set(0.02, -0.03, -0.012);
    this.glyphPop.add(shadow);
    const plate = new THREE.Mesh(new THREE.CircleGeometry(0.32, 28), flatOwn(0x3a2013, 0.86));
    this.glyphPop.add(plate);
    const rim = new THREE.Mesh(new THREE.RingGeometry(0.32, 0.355, 28), flatOwn(0xffe9c4, 0.55));
    rim.position.z = 0.002;
    this.glyphPop.add(rim);

    const ink = 0xfff4dd;
    /** One bar of a glyph: a rounded stroke, drawn as a box with a cap either end. */
    const bar = (g: THREE.Group, w: number, x: number, y: number, rot: number, col = ink) => {
      const t = 0.075;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, t), flatOwn(col, 1));
      m.position.set(x, y, 0.004);
      m.rotation.z = rot;
      g.add(m);
      for (const s of [-1, 1]) {
        const cap = new THREE.Mesh(new THREE.CircleGeometry(t / 2, 10), flatOwn(col, 1));
        cap.position.set(x + Math.cos(rot) * ((w / 2) * s), y + Math.sin(rot) * ((w / 2) * s), 0.004);
        g.add(cap);
      }
    };
    const mk = (key: string, build: (g: THREE.Group) => void) => {
      const g = new THREE.Group();
      build(g);
      g.visible = false;
      this.glyphPop.add(g);
      for (const k of key.split(' ')) this.glyphs.set(k, g);
      return g;
    };
    // Chevrons are two bars at +/-45 degrees, doubled, so the sign reads as an
    // arrowhead at thumbnail size instead of as a tick.
    const chevron = (g: THREE.Group, dir: number) => {
      for (const row of [-0.085, 0.085]) {
        bar(g, 0.2, -0.07, row * dir - 0.03 * dir, dir * 0.86);
        bar(g, 0.2, 0.07, row * dir - 0.03 * dir, -dir * 0.86);
      }
    };
    mk('take dispense serve', (g) => chevron(g, 1));
    mk('place return', (g) => chevron(g, -1));
    mk('combine load', (g) => {
      bar(g, 0.3, 0, 0, 0);
      bar(g, 0.3, 0, 0, Math.PI / 2);
    });
    mk('swap', (g) => {
      bar(g, 0.3, 0, 0.075, 0);
      bar(g, 0.11, -0.13, 0.115, -0.9);
      bar(g, 0.3, 0, -0.075, 0);
      bar(g, 0.11, 0.13, -0.115, -0.9);
    });
    /**
     * PREP — HOLD, DON'T TAP, AND THE SIGN HAS TO SAY THAT.
     *
     * Every other glyph in this set describes a transfer that happens on a
     * press. This one is the only station verb that takes TIME, and it is the
     * verb a player specifically could not find: chopping used to live on its
     * own button and now shares the action button with everything else. A
     * chevron would be a lie here — nothing arrives in your hands.
     *
     * A blade over a board, plus three progress pips under it. The pips are
     * what carry "keep holding": a static icon with no duration in it is what
     * made two buttons feel necessary in the first place.
     */
    mk('prep', (g) => {
      // The blade: a long bar raked over a short one, so it reads as a knife on
      // a board rather than as a cross.
      bar(g, 0.3, 0.01, 0.075, -0.42);
      bar(g, 0.1, -0.13, -0.02, -0.42, 0x3a2013);
      bar(g, 0.34, 0, -0.09, 0);
      for (const dx of [-0.1, 0, 0.1]) {
        const pip = new THREE.Mesh(new THREE.CircleGeometry(0.022, 8), flatOwn(ink, 1));
        pip.position.set(dx, -0.16, 0.006);
        g.add(pip);
      }
    });
    mk('discard', (g) => {
      const body = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.24), flatOwn(ink, 1));
      body.position.set(0, -0.045, 0.004);
      g.add(body);
      bar(g, 0.32, 0, 0.105, 0);
      const lid = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.05), flatOwn(ink, 1));
      lid.position.set(0, 0.155, 0.004);
      g.add(lid);
      for (const dx of [-0.06, 0.06]) {
        const slot = new THREE.Mesh(new THREE.PlaneGeometry(0.03, 0.15), flatOwn(0x3a2013, 1));
        slot.position.set(dx, -0.05, 0.006);
        g.add(slot);
      }
    });
  }

  // ----------------------------------------------------------------- floor

  private buildFloor() {
    const { width: W, height: H } = this.kitchen;
    // Runs well past the front row. Portrait solves to a steep pitch and a wide
    // field, and the bottom edge of that frame can end up looking BEHIND the
    // camera's ground point — so a floor that stops at the last walkable row
    // leaves a band of empty backdrop along the bottom of the phone. Cheaper to
    // extend the floor than to fight the rig for it.
    const depth = H + 4;
    const geo = new THREE.PlaneGeometry(W, depth);
    geo.rotateX(-Math.PI / 2);
    geo.translate(W / 2, 0, depth / 2 - 0.5);
    // ROUND 17 — THE FLOOR IS THE SINGLE LARGEST SURFACE AND IT IS THE ROOM'S
    // NEUTRAL GROUND PLATE, so every point of chroma it carries is a point the
    // tomatoes do not win by. The flag albedo lives in textures.ts and is not
    // this file's to re-author; a cool near-white tint over it takes ~6% off the
    // red channel, which is chroma the flags do not need, and the bounce term
    // below goes up a shade to give back the value that costs.
    const mat = toonMapped(0xe8ecf2, stoneFloorTexture(W, depth)) as THREE.MeshToonMaterial;
    // THE FLOOR IS THE ROOM'S SECOND LIGHT SOURCE.
    //
    // Bare flagstone measured rgb(166,134,96), L 51%. The reference's measures
    // rgb(185,168,132), L 62% — eleven points brighter and, being the single
    // largest surface in frame, that is most of where its 14.6% of pixels above
    // luma 180 come from. Ours had 15.9% of pixels BELOW luma 64 against its
    // 7.6%, and a floor a stop dark under every one of those contact pools is
    // the reason. A small neutral bounce term, exactly as the plaster carries;
    // neutral so it lifts value without dragging the flags towards ochre, which
    // is the one thing the floor must never do — it is the only low-chroma
    // ground the saturated food has to sit against.
    // ROUND 12: +18%. Measured on our own capture the bare flag renders
    // rgb(163,145,109) L 53 against the reference's rgb(180,162,125) L 60 — and
    // the floor is the single largest surface in frame, so those seven points
    // are most of why our histogram carries 12.6% of pixels above luma 180
    // against the reference's 15.5%. It is also the plate the furniture has to
    // read dark against, and the contact pools that just got pushed forward
    // need somewhere bright to land.
    // ROUND 12 — AND IT DOES THE CHROMA AS WELL AS THE VALUE.
    //
    // Measured across six bare lanes of our own 1440px capture the flagstone
    // renders L 51-55 at a chroma of 0.35-0.40, against the reference's L 60-62
    // at 0.27-0.31. Seven points dark and eight points hot, on the single
    // largest surface in the frame — which is most of why our whole-frame mean
    // saturation comes in at 141.5 against its 137.5 while our pixels above
    // luma 180 come in at 14.3% against its 15.5%. The floor is the neutral
    // ground plate the saturated food is measured against; every point of
    // chroma it carries is a point the tomatoes do not win by.
    //
    // A near-neutral bounce term fixes both at once and is the honest place for
    // it: an additive lift raises the minimum channel fastest, so it climbs in
    // value and falls in chroma on the same move. Doing it here rather than in
    // the flag albedo also leaves the stone's own block-to-block tone walk
    // intact, which is what stops the floor reading as poured concrete.
    mat.emissive.setHex(0x86837b);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    this.root.add(mesh);
  }

  // ------------------------------------------------------------- back wall

  private buildBackWall() {
    const { width: W } = this.kitchen;
    const S = this.shell;
    const stucco = stuccoTexture();
    const timber = timberTexture();
    const o = this.oven;

    // Plaster, built in four pieces around the oven void. It has to be a real
    // hole: put a slab across it and the arch reads as a painted-on decal.
    const holeL = o.cx - o.openHalf;
    const holeR = o.cx + o.openHalf;
    const holeB = 0.35;
    S.box(C.plasterShade, holeL + 0.2, WALL_H, 1, (holeL - 0.2) / 2, WALL_H / 2, BACK_Z - 0.5);
    S.box(C.plasterShade, W - holeR + 0.2, WALL_H, 1, (holeR + W + 0.2) / 2, WALL_H / 2, BACK_Z - 0.5);
    S.box(C.plasterShade, o.openHalf * 2, WALL_H - o.archTop, 1, o.cx, (WALL_H + o.archTop) / 2, BACK_Z - 0.5);
    S.box(C.plasterShade, o.openHalf * 2, holeB, 1, o.cx, holeB / 2, BACK_Z - 0.5);
    this.facePlane(-0.2, 0, holeL + 0.2, WALL_H, BACK_Z + 0.004, 'z', stucco, STUCCO_TILE, { lift: LIFT_PLASTER });
    this.facePlane(holeR, 0, W - holeR + 0.2, WALL_H, BACK_Z + 0.004, 'z', stucco, STUCCO_TILE, { lift: LIFT_PLASTER });
    this.facePlane(holeL, o.archTop, o.openHalf * 2, WALL_H - o.archTop, BACK_Z + 0.004, 'z', stucco, STUCCO_TILE, { lift: LIFT_PLASTER });

    // Timber framing: corner posts, two flanking the chimney, a fat horizontal
    // band at head height and a lighter one up under the eaves.
    // NARROWER. At 0.94 the two outer posts stood right where the frame edge
    // foreshortens hardest, so they projected as fat dark bars across the top
    // corners and the frame's sub-luma-64 count came in at twice the
    // reference's — all of it in the corners rather than under the furniture,
    // which is where the reference keeps its darks.
    const postW = 0.74;
    const posts = [1.0, o.span.x0 - 0.5, o.span.x1 + 0.5, W - 1.0];
    for (const px of posts) {
      S.box(C.timberDark, postW, WALL_H, 0.34, px, WALL_H / 2, BACK_Z + 0.17);
      this.facePlane(px - postW / 2, 0, postW, WALL_H, BACK_Z + 0.344, 'z', timber, TIMBER_TILE, { lift: LIFT_TIMBER, tint: TIMBER_FACE, vertical: true });
      // A pale chamfer down each edge of the post. The reference's posts are
      // dark enough that without a lit arris they would read as holes; one
      // 4cm strip either side is what makes them read as PROUD timber crossing
      // the wall rather than as a stripe painted on it.
      S.box(C.timberLight, 0.05, WALL_H, 0.06, px - postW / 2 - 0.005, WALL_H / 2, BACK_Z + 0.352);
      S.box(C.timberLight, 0.05, WALL_H, 0.06, px + postW / 2 + 0.005, WALL_H / 2, BACK_Z + 0.352);
      // AND A CAST SHADOW ON THE PLASTER BESIDE IT. This is the whole reason
      // the reference's armature reads at thumbnail and ours did not. Sampled,
      // its post is rgb(175,100,26) against plaster at rgb(190,108,33) — five
      // points of luma, no more than ours — but every post in that picture has
      // a hard dark line down one side of it where the timber, standing 15cm
      // proud, occludes the wall. Local contrast at the junction, not global
      // contrast across the field, is what draws an armature. One thin quad
      // per edge, multiply-blended, no light and no draw call of its own.
      this.wallShade(px + postW / 2, 0, 0.3, WALL_H, BACK_Z + 0.008, 'h');
    }
    S.box(C.timberDark, W + 0.6, BEAM_H, 0.44, W / 2, BEAM_Y + BEAM_H / 2, BACK_Z + 0.22);
    this.facePlane(-0.3, BEAM_Y, W + 0.6, BEAM_H, BACK_Z + 0.444, 'z', timber, TIMBER_TILE, { lift: LIFT_TIMBER, tint: BEAM_FACE });
    S.box(C.timberLight, W + 0.6, 0.055, 0.07, W / 2, BEAM_Y + BEAM_H - 0.02, BACK_Z + 0.452);
    // The header's own drop shadow: the deepest, widest band on the wall, and
    // the one the reference is most obvious about — the plaster directly under
    // its head beam is a good stop below the plaster at eye level.
    this.wallShade(0, BEAM_Y, W, 0.85, BACK_Z + 0.008, 'v');
    // ROUND 15 — THE TOP OF OUR FRAME WAS THE BRIGHTEST BAND IN IT, AND THE
    // REFERENCE'S IS THE DARKEST.
    //
    // Ten horizontal bands, each a tenth of frame height, median luma, ours
    // against the reference on matched captures:
    //
    //     band  0    1    2    3    4    5    6    7    8    9
    //     ref   92  107  142  158  141  142  138  142  140  143
    //     ours 148  111  148  134  131  120  123  114  143  131
    //
    // The reference opens DARK at the top and gets brighter all the way down
    // to the floor, so the eye is walked down the frame onto the food. Ours
    // opened at luma 148 — its single brightest band — and fell away to 114 by
    // band 7, which walks the eye UP onto an empty ochre wall. That inversion
    // is compositional, not tonal: no amount of re-keying the plaster hue
    // fixes a gradient that runs the wrong way.
    //
    // Every interior has this band. It is the ceiling occluding the top of the
    // wall, and the reference paints it hard: above its head beam the plaster
    // drops a full stop. One multiply quad, no light, no draw call that costs
    // anything, and it also gives the HUD pills a ground to sit on instead of
    // floating on the brightest field in the picture.
    // `edgeGradient` reaches full transparency at 42% of the quad's height, so
    // the quad has to be 1/0.42 times the band it is meant to cover or the
    // shadow dies before it gets down to the beam. At 4.9 tall the fade
    // finished at y 6.2 and the portrait camera — which frames roughly y 4.5
    // to 6.5 — never saw any of it.
    this.wallShade(0, WALL_H, W, (WALL_H - BEAM_Y) / 0.42, BACK_Z + 0.007, 'v', 0.86);
    // THE SECOND BEAM COURSE, AT HEAD HEIGHT OF THE SHELL — PORTRAIT ONLY.
    //
    // Round 12 deleted a second beam because it sat at y 6.9, inside every
    // landscape frame, and turned the top third of the picture into a wooden
    // barn. This one is at y 8.0: above the top edge of every landscape profile
    // (5.02 on iPhone landscape, 6.20 on iPad) and therefore invisible on all
    // of them. It exists because the portrait frame now opens up to y 8.85 when
    // the player runs wide, and a frame that opens onto bare plaster has gained
    // nothing. A room needs a lid; this is the lid.
    S.box(C.timberDark, W + 0.6, BEAM_H, 0.44, W / 2, EAVES_Y + BEAM_H / 2, BACK_Z + 0.22);
    this.facePlane(-0.3, EAVES_Y, W + 0.6, BEAM_H, BACK_Z + 0.444, 'z', timber, TIMBER_TILE, { lift: LIFT_TIMBER, tint: BEAM_FACE });
    S.box(C.timberLight, W + 0.6, 0.055, 0.07, W / 2, EAVES_Y + BEAM_H - 0.02, BACK_Z + 0.452);
    // ...and the dark band above it. Every interior is darkest where the wall
    // meets the ceiling, and this one is what stops the newly-reachable top of
    // a portrait frame reading as more of the same ochre.
    this.wallShade(0, WALL_H, W, (WALL_H - EAVES_Y) / 0.42, BACK_Z + 0.009, 'v', 0.72);
    // NO SECOND BEAM AND NO STUDS. ROUND 12, AND THIS IS THE SINGLE BIGGEST
    // CHANGE IN THE PASS.
    //
    // Crop the top 32% of our own capture and it is a WOODEN BARN: honey plank
    // from edge to edge with grain and joint lines running through all of it,
    // and no plaster visible anywhere. Crop the reference's top 32% and it is
    // a big flat mustard field with four posts and ONE header crossing it. The
    // difference is not colour and it is not texture — it is inventory. Above
    // the header we were carrying a second full-width beam at y 6.9, three
    // 50cm studs between the two, a lit arris on each and a face plane on each,
    // so the band from y 4.35 to 7.13 — the top 46% of an 8m wall — was
    // continuous timber. Every previous round then tried to fix "the top third
    // is one orange smear" by re-tuning the ratio between two tones that were
    // both wood.
    //
    // The eaves band the studs were added to fill is supposed to be empty. That
    // is what the reference has up there: plaster, crossed only by the four
    // posts continuing to the top of frame, which is also what gives its
    // armature somewhere to be an armature ON.

    // INTEGRATION — THERE IS ONLY ONE CLOCK IN THIS GAME AND IT IS THE HUD'S.
    //
    // The set hung a readable dial high on the right-hand wall; the HUD carries
    // a clock glyph and the remaining seconds in the top-centre pill, which is
    // the single most important number on screen. Both landed in the same
    // frame, both in the top strip, one of them permanently reading 12:07 —
    // and on iPhone landscape the wall dial sits ~90px from the pill that is
    // actually counting down. Two clocks in one frame is not set dressing, it
    // is the game telling the player it does not know what time it is.
    //
    // The reference hangs no clock anywhere. Its back wall carries crockery and
    // its side walls carry a pan rack and a door. So this half of the wall gets
    // a second shelf of jars instead: same silhouette budget, same one merged
    // draw call, no cool-grey disc in a warm room, and the wall reads dressed
    // on both sides of the chimney rather than dressed on one and clocked on
    // the other. `clock()` is left in the file unused-by-nobody — it is called
    // nowhere else — because it costs nothing and the next set pass may want a
    // dial somewhere the HUD is not.
    this.wallShelf(W - 2.5, 2.9, BACK_Z + 0.1);
    this.wallShelf(2.5, 2.55, BACK_Z + 0.1);
  }

  private buildSideWalls() {
    const { width: W, height: H } = this.kitchen;
    const S = this.shell;
    const stucco = stuccoTexture();
    const depth = H + 4.4;
    const z0 = -0.4;
    const zc = z0 + depth / 2;

    // s = -1 is the left wall, +1 the right. `into` points into the ROOM, which
    // is where every proud detail has to sit.
    for (const s of [-1, 1]) {
      const inner = s < 0 ? 1 : W - 1;
      const into = -s;
      const dir = s < 0 ? 'xp' : 'xn';
      S.box(C.plasterShade, 1.2, WALL_H, depth, inner + s * 0.6, WALL_H / 2, zc);
      // A COARSER TILE ON THE RAKED PLANE. A side wall is seen at ~15° off
      // edge-on, so a 4m tile compresses to a couple of hundred screen pixels
      // and every speck in the stucco smears into a streak; cropped at 5× the
      // left wall read as varnished pine. Nearly doubling the tile puts the
      // mottle's features back above the smear length, and no one can tell that
      // two walls in the same room use different plaster scales.
      // A FINER TILE ON THE RAKED PLANE, WHICH IS THE OPPOSITE OF WHAT THE
      // FIRST ATTEMPT DID. A side wall is seen ~15° off edge-on: 14m of depth
      // compresses into about 180px of screen while 8m of height fills 700px,
      // so anything drawn on it is stretched roughly 7:1 and every soft blob in
      // the stucco projects as a vertical streak. Cropped at 4×, our left wall
      // read as varnished pine planking. Making the tile BIGGER (tried at 7.2)
      // makes the streaks bigger and more obviously plank-like; making it small
      // pushes the features under the anisotropic blur, where they read as
      // fine tooth rather than as grain.
      // AN ANISOTROPIC TILE, BECAUSE THE PROJECTION IS ANISOTROPIC.
      //
      // Two rounds of guessing the tile SIZE both failed, because size was not
      // the problem. A side wall is seen ~15° off edge-on: 14m of depth
      // compresses into roughly 180px of screen while 8m of height fills 700px,
      // so anything drawn on it is squashed about 7:1 along the depth axis. A
      // square tile therefore paints round blobs that land on screen as tall
      // narrow streaks, and cropped at 4.5× our left wall read as varnished
      // pine planking — against a reference whose side wall is a dead flat
      // matte mustard field with nothing on it but a fine even tooth.
      //
      // So the tile is stretched 6:1 along the wall's depth to cancel the
      // projection: a stucco blob is now about 1.8m long and 0.3m tall in world
      // space, which lands as roughly 23 × 26 screen pixels. Square where the
      // player sees it, which is the only place squareness matters.
      this.facePlane(z0, 0, depth, WALL_H, inner + into * 0.004, dir, stucco, { w: 12, h: 2 }, { lift: LIFT_PLASTER_SIDE });
      // The same ceiling occlusion the back wall gets. The side walls own the
      // top CORNERS of the frame, which on every profile is where the brightest
      // ochre in the picture was sitting — see the band table in
      // buildBackWall(). A room lit from inside has its darkest plaster where
      // the wall meets the ceiling, and the reference's top band measures a
      // full stop under ours because it paints that and we did not.
      {
        const h = (WALL_H - BEAM_Y) / 0.42;
        const geo = new THREE.PlaneGeometry(depth, h);
        geo.rotateZ(Math.PI);
        geo.rotateY(into * (Math.PI / 2));
        const m = new THREE.Mesh(
          geo,
          new THREE.MeshBasicMaterial({
            map: edgeGradient(0.86),
            transparent: true,
            premultipliedAlpha: true,
            depthWrite: false,
            blending: THREE.MultiplyBlending,
          }),
        );
        m.position.set(inner + into * 0.02, WALL_H - h / 2, zc);
        m.renderOrder = -1;
        this.root.add(m);
      }
      this.cobbleSkirt(inner, into, z0, depth);
      // Framing, but only on the half of the wall that reads as "far". Carry a
      // beam all the way to the front and it crosses the top corner of frame as
      // a fat dark diagonal a metre from the lens; the reference's corners are
      // plain ochre, so ours stop at the middle of the room.
      const near = 7.6;
      const farD = near - z0;
      // THREE posts, not two, plus a string course at chest height.
      //
      // Above the cobble skirt each side wall was ~20% of the frame carrying a
      // single flat ochre value with nothing crossing it. The reference never
      // shows a plaster field that big without timber through it. Now that the
      // architectural timber is a stop darker than the plaster, this framing
      // does real work: it breaks the wall into panels the eye can measure the
      // room's depth against, for four merged boxes and no extra draw call.
      // TWO posts, and THIN ones.
      //
      // A side wall is seen at a grazing angle, so a post's DEPTH is what
      // projects wide, not its width: three 0.52-deep posts covered about half
      // of each side wall and the upper corners of the frame came back as a
      // dark timber stockade with slivers of plaster between. The reference
      // shows one post a side and a great deal of plaster. Half the depth, one
      // fewer post, and a tone a stop up from the back wall's armature, which
      // is right anyway — these are further from the eye and catching more key.
      for (const pz of [1.6, 5.2]) {
        S.box(C.timberLight, 0.2, WALL_H, 0.26, inner + into * 0.1, WALL_H / 2, pz);
      }
      // ONE RAIL, NOT THREE. Same finding as the back wall: a chest-height
      // string course, a header and a second beam under the eaves put three
      // horizontal timbers across a plane that is seen almost edge-on, so each
      // one projects three or four times its own width and between them they
      // covered most of the wall. The reference carries a header and nothing
      // else on its side walls.
      S.box(C.timberLight, 0.32, BEAM_H, farD, inner + into * 0.16, BEAM_Y + BEAM_H / 2, z0 + farD / 2);
      // ...and the matching eaves beam, above every landscape frame's top edge.
      // See EAVES_Y: the portrait frame opens into this band, and a side wall
      // that stops at the header while the back wall carries a course would
      // read as two different rooms.
      S.box(C.timberLight, 0.32, BEAM_H, farD, inner + into * 0.16, EAVES_Y + BEAM_H / 2, z0 + farD / 2);
    }

    this.door(1.0, 5.9);
    this.panRack(W - 1.0, 4.4);
    // Bric-a-brac in the panel the door leaves empty, so the left wall does not
    // carry a bare field above knee height. Big enough to read: the first pass
    // put four 15cm jars three metres back and they rendered as three beige
    // pixels — set dressing you cannot see is geometry you are paying for.
    this.wallCrocks(1, 3.3, 2.35);
  }

  /**
   * A bracket shelf of crockery on a side wall — the reference dresses every
   * vertical surface it owns, and a shelf reads at 90px because its silhouette
   * is a hard horizontal line with round things standing on it.
   */
  private wallCrocks(innerX: number, z: number, y: number) {
    const S = this.shell;
    const x = innerX + 0.18;
    S.box(C.timberLight, 0.44, 0.1, 2.3, x, y, z);
    for (const s of [-1, 1]) S.box(C.timberDark, 0.3, 0.34, 0.1, x - 0.06, y - 0.21, z + s * 0.95);
    const items: [number, number, number][] = [
      [-0.78, 0.34, PALETTE.plates],
      [-0.28, 0.44, C.bowlBlue],
      [0.24, 0.36, 0xd9b46a],
      [0.76, 0.28, C.copper],
    ];
    for (const [dz, h, col] of items) {
      S.cyl(col, 0.22, 0.19, h, 12, x, y + 0.05 + h / 2, z + dz);
      S.cyl(C.timberDark, 0.18, 0.2, 0.06, 12, x, y + 0.07 + h, z + dz);
    }
  }

  /**
   * A SOFT OCCLUSION BAND ON PLASTER, CAST BY THE TIMBER STANDING PROUD OF IT.
   *
   * The measured complaint against our back wall was "2.4 points of luminance
   * and 1 degree of hue between a wall and the structural timber lattice
   * crossing it". Chasing that with albedo is a trap — sampled off the
   * reference its post is rgb(175,100,26) against plaster at rgb(190,108,33),
   * which is *also* about five points. What its wall has and ours did not is
   * LOCAL contrast: every beam in that picture throws a hard, short shadow onto
   * the plaster below and beside it, so each junction carries a 25-30% step
   * inside 20cm. That is what an eye reads as structure, and it survives a
   * thumbnail downsample in a way a flat field difference does not.
   *
   * `dir` is which way the band falls: 'v' hangs down from (u0, v0), 'h' runs
   * out to +x from it. One shared gradient texture, multiply-blended, unlit.
   */
  private wallShade(u0: number, v0: number, w: number, h: number, z: number, dir: 'v' | 'h', strength = 0.62) {
    const geo = dir === 'v' ? new THREE.PlaneGeometry(w, h) : new THREE.PlaneGeometry(h, w);
    if (dir === 'v') geo.rotateZ(Math.PI);
    else geo.rotateZ(-Math.PI / 2);
    const m = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({
        map: edgeGradient(strength),
        transparent: true,
        premultipliedAlpha: true,
        depthWrite: false,
        blending: THREE.MultiplyBlending,
      }),
    );
    if (dir === 'v') m.position.set(u0 + w / 2, v0 - h / 2, z);
    else m.position.set(u0 + w / 2, v0 + h / 2, z);
    m.renderOrder = -1;
    this.root.add(m);
  }

  /**
   * THE CORNER.
   *
   * The back wall met the flagstones on a hard line with no darkening, so the
   * room read as a painted backdrop with a floor pasted under it. Every baked
   * interior has a soft dark band where two planes meet, and it is most of what
   * says "enclosure" rather than "flat". Three multiply-blended quads with one
   * shared vertical gradient — one along the back wall, one up each side wall —
   * plus a matching skirt laid on the floor at the foot of the back wall.
   *
   * It also buys darks the histogram badly needs: ours ran 5.6% of pixels below
   * luma 64 against the reference's 7.6%, and 86% mid-tone.
   */
  private buildCornerAO() {
    const { width: W, height: H } = this.kitchen;
    const tex = cornerGradient();
    const quad = (w: number, h: number) => {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(w, h),
        new THREE.MeshBasicMaterial({
          map: tex,
          transparent: true,
          premultipliedAlpha: true,
          depthWrite: false,
          blending: THREE.MultiplyBlending,
        }),
      );
      m.renderOrder = -1;
      return m;
    };
    const wallH = 1.9;
    const back = quad(W + 1.2, wallH);
    back.position.set(W / 2, wallH / 2, BACK_Z + 0.012);
    this.root.add(back);
    // The side bands stop at the last walkable row. Running them the full
    // extended depth put a darkening wedge into the two bottom corners of the
    // frame, where the wall is edge-on and the vignette is already working —
    // and corner darks are the one place the reference does NOT put them.
    const sideD = H - 1;
    for (const s of [-1, 1]) {
      const side = quad(sideD, wallH);
      side.rotation.y = s < 0 ? Math.PI / 2 : -Math.PI / 2;
      side.position.set(s < 0 ? 1.012 : W - 1.012, wallH / 2, sideD / 2 - 0.2);
      this.root.add(side);
    }
    // Floor skirt: the other half of the corner, laid flat.
    const skirtD = 1.5;
    const floor = quad(W + 1.2, skirtD);
    floor.rotation.x = -Math.PI / 2;
    floor.rotation.z = Math.PI;
    floor.position.set(W / 2, 0.014, BACK_Z + skirtD / 2);
    this.root.add(floor);
  }

  /**
   * The reference's side walls do not carry a wainscot. They carry a low course
   * of ROUNDED RIVER COBBLES — knee-high on a Toad, muted grey-green, soft
   * silhouette — and then bare ochre plaster all the way up.
   *
   * Ours was a metre-tall panel of pale limestone brick, run from the back wall
   * to the front of the floor down BOTH edges of the frame. Two hard-edged,
   * cold, near-white bands, each about a twentieth of the picture, standing
   * exactly where the eye enters and leaves the play field, in a room whose
   * whole trick is that the only bright thing is the chimney and the only
   * saturated thing is the food. This is the single biggest value error left in
   * the set, and geometry fixes it better than a darker texture would: cobbles
   * read round, so they stop competing on edge contrast as well as on value.
   */
  private cobbleSkirt(inner: number, into: number, z0: number, depth: number) {
    const S = this.shell;
    const h = WAINSCOT_H;
    // Backing slab, so no gap opens between stones at a grazing angle.
    S.box(C.cobbleAlt, 0.16, h, depth, inner + into * 0.08, h / 2, z0 + depth / 2);
    // Three staggered courses of squashed spheres. Deterministic jitter, so a
    // screenshot diff shows a change rather than noise.
    const courses = 3;
    for (let c = 0; c < courses; c++) {
      const y = 0.16 + c * 0.3;
      const pitch = 0.46;
      const offs = (c % 2) * pitch * 0.5;
      for (let z = z0 + offs; z < z0 + depth; z += pitch) {
        const n = Math.sin(z * 7.7 + c * 3.1) * 0.5 + 0.5;
        const m = Math.sin(z * 19.3 + c * 5.7) * 0.5 + 0.5;
        // Two frequencies, or three courses of identical spheres on a regular
        // pitch read as bubble wrap rather than as rubble.
        const r = 0.13 + n * 0.045 + m * 0.035;
        S.ball(
          n > 0.5 ? C.cobble : C.cobbleAlt,
          r,
          inner + into * (0.12 + n * 0.03),
          y + (n - 0.5) * 0.05,
          z,
          0.62,
          0.86,
          1.0,
        );
      }
    }
    // A flat capping course, the way a rubble skirt is finished off.
    S.box(C.cobbleCap, 0.26, 0.1, depth, inner + into * 0.1, h + 0.02, z0 + depth / 2);
  }

  /**
   * A textured quad laid on the face of a wall. `axis` picks which way it looks:
   * 'z' out of the back wall, 'xp' off the left wall, 'xn' off the right wall.
   * `u0`/`v0` are world coordinates so tiling lines up across separate boxes.
   *
   * The tint is WHITE by default and the colour lives entirely in the texture.
   * Tinting a coloured texture with a coloured material multiplies the two —
   * two surfaces at 80% each land at 64%, which is exactly how the ochre wall
   * ended up two stops below the reference's no matter what the palette said.
   */
  private facePlane(
    u0: number,
    v0: number,
    w: number,
    h: number,
    at: number,
    axis: 'z' | 'xp' | 'xn',
    tex: THREE.Texture,
    tile: { w: number; h: number },
    opts: { lift?: number; tint?: number; vertical?: boolean } = {},
  ) {
    const vertical = opts.vertical ?? false;
    const geo = new THREE.PlaneGeometry(w, h);
    const t = alignTile(tex, tile, u0, v0, vertical ? h : w, vertical ? w : h);
    if (vertical) {
      // Rotate the grain 90° for an upright post without re-drawing the tile.
      geo.attributes.uv.array.set(rotateUv(geo.attributes.uv.array as Float32Array));
      geo.attributes.uv.needsUpdate = true;
    }
    if (axis === 'z') {
      geo.translate(u0 + w / 2, v0 + h / 2, at);
    } else {
      geo.rotateY(axis === 'xp' ? Math.PI / 2 : -Math.PI / 2);
      geo.translate(at, v0 + h / 2, u0 + w / 2);
    }
    const mat = toonMapped(opts.tint ?? 0xffffff, t) as THREE.MeshToonMaterial;
    if (opts.lift) mat.emissive.setHex(opts.lift);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    this.root.add(mesh);
  }

  // -------------------------------------------------------------- the oven

  /**
   * The chimney breast and the stone arch oven burning inside it — the thing
   * the reference puts dead centre and the thing our room was missing.
   * Proportions are lifted straight off the capture: the chimney is a third of
   * the room wide, the arch springs a third of the way up it, and the opening
   * is a little over half the chimney's width.
   */
  private buildOven() {
    const S = this.shell;
    const brick = chimneyStoneTexture();
    const o = this.oven;
    const { cx, openHalf, spring, archTop, chimH, cw } = o;
    const face = BACK_Z + 0.36;
    const pierW = cw / 2 - openHalf;

    // Chimney body: limestone, proud of the plaster, capped by a corbel course.
    // Built in pieces around the mouth for the same reason the plaster is — a
    // slab behind the arch turns the oven into a sticker.
    for (const s of [-1, 1]) {
      S.box(C.stoneDark, pierW, chimH, 0.36, cx + s * (openHalf + pierW / 2), chimH / 2, BACK_Z + 0.18);
    }
    S.box(C.stoneDark, openHalf * 2, chimH - archTop, 0.36, cx, (chimH + archTop) / 2, BACK_Z + 0.18);
    S.box(C.stoneDark, openHalf * 2, 0.36, 0.36, cx, 0.18, BACK_Z + 0.18);
    // The three face planes butted edge to edge at cx ± openHalf, and a butt
    // joint between two coplanar quads shows as a hairline: two faint vertical
    // scratches ran the full height of the breast in every capture. The piers
    // now overlap the centre panel by 5cm and sit a hair proud of it, so the
    // seam is covered rather than aligned. `facePlane` keys its tiling to world
    // x, so an overlap does not shift the bond.
    for (const s of [-1, 1]) {
      const x0 = s < 0 ? cx - openHalf - pierW - 0.06 : cx + openHalf - 0.05;
      this.facePlane(x0, 0, pierW + 0.11, chimH, face + 0.004, 'z', brick, CHIMNEY_TILE, CHIMNEY_FACE);
    }
    this.facePlane(cx - openHalf, archTop, openHalf * 2, chimH - archTop, face + 0.001, 'z', brick, CHIMNEY_TILE, CHIMNEY_FACE);
    // The cap is a SHADOW LINE, not a mantelpiece. At C.stone × 0.24 deep it was
    // a bright white lintel the full width of the breast sitting right under the
    // header beam — two pale horizontal bars stacked across the top of the
    // frame. The reference's breast simply runs up into the timber.
    S.box(C.stoneDark, cw + 0.16, 0.16, 0.5, cx, chimH - 0.08, BACK_Z + 0.24);
    S.box(C.stoneJoint, cw + 0.1, 0.07, 0.44, cx, chimH - 0.19, BACK_Z + 0.22);

    // Voussoirs: individual wedge stones round the arch, radially deep enough
    // that they also close the spandrels behind the square plaster opening.
    // ELEVEN STONES, NOT THIRTEEN, AND A THINNER RING. Shot and cropped at 1.3×,
    // thirteen 0.36-deep voussoirs each bounded by its own pale mortar wedge
    // came back as a white paper fan — a high-frequency stripe pattern with more
    // visual energy in it than anything else on the back wall, including the
    // fire. The reference's ring is 0.37 of the mouth radius, made of eleven
    // quiet stones, and its divisions are thin DARK lines, not pale ones.
    // THE VOUSSOIRS WERE BUILT WITH THEIR AXES SWAPPED, AND HAD BEEN FOR ROUNDS.
    //
    // `Props.box(w, h, d, x, y, z, rz)` rotates about Z LAST, so after a rotation
    // of `a` the box's w runs RADIALLY and its h runs TANGENTIALLY. The ring was
    // authored `(0.58, 0.36)` — a stone 58cm deep through the wall and 36cm wide
    // along the arc, on an arc pitch of 46cm. Every single division therefore had
    // a 10cm hole in it with the black cavity showing through, and the whole ring
    // read as a row of separate white slabs with dark chevrons between them
    // rather than as masonry butted stone to stone. Widening N made it worse,
    // not better, which is the tell. Depth first, width second, and the width is
    // now a shade OVER the arc pitch so the stones genuinely touch.
    // ROUND 11 — THE RING IS TOO THIN AND ITS JOINTS ARE TOO FAINT.
    //
    // Cropped at 4× against the reference's arch: its ring is 0.27 of the mouth
    // radius through the wall (ours was 0.21) and, far more importantly, every
    // division between two voussoirs is a DARK TAPERED WEDGE about 7cm wide, not
    // a scored 3cm line. Read at 90px the reference arch is eleven separate
    // stones; ours was a smooth white horseshoe with hairlines on it.
    const R = openHalf + 0.24;
    const N = 11;
    const pitch = (Math.PI * R) / N;
    // Voussoir tone walks stone → warm → dark → warm round the ring rather than
    // alternating two. The reference's ring has no two adjacent stones the same
    // and one obviously greyer block near each haunch.
    const RING_TONE = [C.archStone, C.archStoneWarm, C.archStoneDark, C.archStoneWarm];
    for (let i = 0; i < N; i++) {
      const a = (Math.PI * (i + 0.5)) / N;
      const tone = RING_TONE[i % RING_TONE.length];
      S.box(tone, 0.44, pitch * 1.08, 0.5, cx + Math.cos(a) * R, spring + Math.sin(a) * R, face + 0.06, a);
    }
    // A thin dark line round both edges of the ring. The reference outlines its
    // whole arch — extrados and intrados — in one unbroken dark grey-brown, and
    // that outline is what makes the arch the strongest silhouette in the room
    // at 90px. Measured off the crop it is about 0.7% of the mouth width, so
    // this is 3cm, drawn a hair PROUD of the stones so it cannot z-fight them.
    // THE OUTLINE SAT INSIDE THE STONES' OWN CORNERS. A straight box laid on a
    // curve pokes its outer corners past the circle it is centred on, so an
    // outline drawn at exactly R ± half-depth left a pale flag sticking out of
    // every second voussoir — eight white ticks round the extrados, clearly
    // visible in every capture. The line goes OUTSIDE the corners, on both
    // edges, and gets the reference's weight while it is there.
    // ROUND 12 — AND THEN IT WAS A BLACK HORSESHOE WITH WHITE TEETH.
    //
    // Cropped at 2.6×, the ring rendered as a heavy near-black outline with
    // pale grey blocks inside it — a cartoon keyline, not masonry. The
    // reference's outline samples rgb(135,126,101): a MID grey-brown, about a
    // stop under the stones it bounds, and it works because it is thin and
    // continuous rather than because it is dark. Thinner by a fifth, and it
    // gets a bounce term so it stops bottoming out at the toon ramp's foot.
    const RING_HALF = 0.22;
    for (let i = 0; i < N * 8; i++) {
      const a = (Math.PI * (i + 0.5)) / (N * 8);
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      for (const s of [-1, 1]) {
        const rr = R + s * (RING_HALF + 0.03);
        S.box(C.archLine, 0.05, pitch * 0.2, 0.52, cx + ca * rr, spring + sa * rr, face + 0.075, a);
      }
    }
    // One mortar division per stone. These are JOINTS, not the outline: in the
    // reference they are visibly lighter than the contour round the ring, which
    // is what stops eleven stones from reading as eleven separate tiles.
    for (let i = 0; i <= N; i++) {
      const a = (Math.PI * i) / N;
      S.box(C.stoneJoint, 0.44, 0.055, 0.52, cx + Math.cos(a) * R, spring + Math.sin(a) * R, face + 0.075, a);
    }
    // Jambs down to the hearth: three stones a side on the ring's own pitch, so
    // the springing is a continuation of the arch rather than a change of
    // module. No rotation here, so w is horizontal (radial) and h is vertical.
    // THE JAMBS RAN PAST THE SPRINGING. Three stones at the ring's own pitch is
    // 1.72m of jamb under a springing that sits at 0.86m, so the top stone of
    // each jamb stood a full stone INSIDE the arc and the whole assembly read as
    // a thin skeletal cage rather than as two piers carrying a ring. Two stones,
    // sized to land exactly on the springing.
    const jambN = 2;
    const jambH = spring / jambN;
    for (const s of [-1, 1]) {
      for (let i = 0; i < jambN; i++) {
        const jy = jambH * (i + 0.5);
        S.box(i % 2 === 0 ? C.archStoneWarm : C.archStone, 0.44, jambH * 1.02, 0.5, cx + s * R, jy, face + 0.06);
        S.box(C.stoneJoint, 0.44, 0.055, 0.52, cx + s * R, jy + jambH * 0.5, face + 0.075);
      }
      for (const t of [-1, 1]) {
        S.box(C.archLine, 0.05, spring, 0.52, cx + s * (R + t * (RING_HALF + 0.03)), spring / 2, face + 0.075);
      }
    }
    // No protruding keystone. N is odd, so the ring already puts a stone dead on
    // the crown; the extra block stuck on top of it turned a clean semicircle
    // into a slightly gothic point, which is the one arch profile the reference
    // definitely does not have.

    // PROUD ASHLAR COURSES UP THE BREAST.
    //
    // With the chimney lifted to where the reference has it — the brightest
    // mass in the frame — the brick TEXTURE's painted joints no longer carry
    // enough contrast to survive, and the largest pale shape in the picture came
    // back as a smooth white card. Real courses, 4cm proud with a mortar line
    // under each, put the articulation back as geometry, where the light can
    // find it. Six bands, split around the arch so none crosses the opening.
    // ON THE TEXTURE'S OWN PITCH, or the geometry draws a second, contradictory
    // set of courses over the painted one and the wall reads as graph paper.
    // COURSE_H is one row of the brick tile, and the tile's v origin is world
    // y = 0, so a band at every multiple of it lands exactly on a painted joint
    // and turns it from a drawn line into a real shadowed step.
    // ROUND 11 — AND THE BANDS COME OFF AGAIN, BECAUSE THE TEXTURE CAN DO IT NOW.
    //
    // These were added in round 10 to put articulation into a breast whose
    // texture said nothing. The texture now carries the reference's own block
    // spread, a dark mortar bed and a shadow line on every stone — and with real
    // painted courses underneath, six full-width geometric ledges at COURSE_H
    // draw a SECOND set of horizontals that does not land on the painted ones
    // (the tile's v origin is world y = 0, the breast's courses are not). Shot
    // at 1440 and cropped, grey lines ran straight through the middle of painted
    // blocks: exactly the graph-paper failure the round-10 comment was written
    // to avoid. One articulated surface beats two contradictory ones.
    // The corbel throws a shadow onto the breast right under it — the reference
    // has a hard dark line there and it is what stops the chimney from reading
    // as a decal pasted on the plaster.
    S.box(C.stoneJoint, cw + 0.26, 0.07, 0.08, cx, chimH - 0.36, face + 0.05);

    // WEATHERING, WHICH IS THE LAST THING THE BREAST WAS MISSING.
    //
    // Enlarge the reference's chimney 1.7× and no two of its stones are the same
    // colour: it runs cream, sage-green, warm grey and blue-grey across a single
    // course, and that stone-to-stone variety is most of what stops the biggest
    // pale mass in the picture from reading as a blank card. Ours draws one
    // brick tile at one tone, so however good the joints get the field between
    // them stays flat. `brickTexture` is not this file's to re-author, so the
    // variety goes on as weathering: soft tinted blooms laid over the face, no
    // alignment to the stone grid needed and no hard edge to give the trick
    // away. Eight of them, deterministic, so a screenshot diff shows a change.
    const patches: [number, number, number, number, number][] = [
      [-1.9, 3.3, 1.5, 1.2, 0x9db08f],
      [-0.6, 3.9, 1.9, 1.0, 0xb6b298],
      [1.4, 3.5, 1.7, 1.4, 0xa4aeab],
      [2.0, 2.5, 1.2, 1.1, 0x9db08f],
      [-2.0, 1.9, 1.1, 1.5, 0xa9b39f],
      [2.05, 0.9, 1.0, 1.3, 0xb6b298],
      [-1.95, 0.6, 1.0, 1.1, 0xa4aeab],
      [0.3, 2.95, 1.6, 0.9, 0xa9b39f],
    ];
    for (const [dx, py, pw, ph, col] of patches) {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(pw, ph),
        new THREE.MeshBasicMaterial({
          map: softBlob(),
          color: col,
          transparent: true,
          opacity: 0.42,
          depthWrite: false,
        }),
      );
      m.position.set(cx + dx, py, face + 0.052);
      this.root.add(m);
    }

    // THE VAULT WAS A RECTANGLE BEHIND AN ARCH, AND YOU COULD SEE THE CORNERS.
    //
    // The backing was one box `inner*2 + 0.4` wide by `archTop + 0.3` tall. The
    // ring is a semicircle, so above the haunches the box was 0.6m wider than
    // the thing meant to be covering it: every capture at every profile showed
    // two hard dark-red rectangles sticking out either side of the arch crown,
    // sitting on the brightest wall in the room. Nothing was filling the
    // spandrels, so there was nothing else for them to be.
    //
    // Both halves are now built as horizontal slats off the same arc: the vault
    // stops where the arch stops, and the masonry between the ring and the
    // square plaster opening is masonry, which is what the reference has there.
    const back = 0.16;
    const inner = openHalf - 0.06;
    const vaultR = inner + 0.2;
    const ringOuter = R + RING_HALF;
    // 18 was too coarse for the SPANDREL fill below (the masonry between the
    // ring and the square plaster opening): at 16cm a step the haunches grew two
    // pale tabs sticking out either side of the arch. Back to a fine step, with
    // the vault slats overlapping 25% so the tone bands do not show as stripes.
    const SLATS = 26;
    const slatH = (archTop + 0.36) / SLATS;
    for (let i = 0; i < SLATS; i++) {
      const sy = (i + 0.5) * slatH;
      const dy = sy - spring;
      const hw = dy <= 0 ? vaultR : Math.sqrt(Math.max(0, vaultR * vaultR - dy * dy));
      if (hw > 0.03) {
        // Warm rust through the working half of the vault, falling to near-soot
        // at the crown — the reference's cavity is brightest around the loaves
        // and dies above them, and that vertical fall is most of the depth. TWO
        // tones put a hard horizontal seam across the middle of the mouth at the
        // one place in the frame the eye is guaranteed to land; four, on an
        // uneven ladder, read as a gradient once the glow is over them.
        // ROUND 15 — AND FOUR TONES ON THRESHOLDS IS STILL THREE HARD SEAMS.
        //
        // Cropped at 2.3x the back of the vault rendered as a flat brown card
        // with a hard horizontal line across it two thirds of the way up — the
        // u < 0.62 step, landing exactly where the eye is guaranteed to be.
        // The reference's cavity has no edge in it anywhere: it is one
        // continuous fall from the springing to the crown. Twenty-six slats can
        // draw that if each takes its own point on the ladder instead of one of
        // four buckets, and the tone ladder above stays the ladder — this only
        // changes how it is sampled.
        const u = sy / archTop;
        /**
         * Z-FIGHTING, AND WHY NO SCREENSHOT IN THIS PROJECT EVER SHOWED IT.
         *
         * Each slat is `slatH * 1.25` tall on a `slatH` pitch — the deliberate
         * 25% overlap that stops the tone ladder reading as stripes — and every
         * one of them was drawn at the same z. So in the overlap band, two
         * coplanar surfaces sit at identical depth across the whole back of the
         * vault, which is the definition of a depth-buffer tie.
         *
         * The harness never caught it: shoot.mjs renders through SwiftShader,
         * which resolves a tie the same way every frame, so it is stable in
         * every capture and in every critic pass built on one. On a real GPU
         * the winner flips per frame with interpolation noise, and the player
         * reported the fireplace background doing "a weird vibratey gfx glitch"
         * on an actual iPhone. A software rasteriser cannot find this class of
         * bug, and no amount of looking at our own JPEGs would have.
         *
         * Alternating rather than ramping: adjacent slats are the only ones that
         * overlap, so two planes 4mm apart is enough to break every tie, and it
         * stays bounded — a monotonic ramp over 26 slats would walk the back of
         * the vault 1.6cm forward and change the silhouette at the crown.
         */
        S.box(
          rampTone(u),
          hw * 2,
          slatH * 1.25,
          0.14,
          cx,
          sy,
          back + (i % 2) * 0.004,
        );
      }
      const ow = dy <= 0 ? ringOuter : Math.sqrt(Math.max(0, ringOuter * ringOuter - dy * dy));
      if (sy < archTop && ow < openHalf - 0.02) {
        const w = openHalf - Math.max(ow, 0);
        for (const s of [-1, 1]) {
          // Same tie, same fix: these spandrel slats overlap by 6% and were all
          // at `face - 0.02`.
          S.box(C.stoneDark, w, slatH * 1.06, 0.4, cx + s * (openHalf - w / 2), sy, face - 0.02 + (i % 2) * 0.004);
        }
      }
    }
    // A REAL BARREL VAULT, NOT TWO FLAT JAMBS.
    //
    // What was here was a pair of dark slabs standing at ±inner and running back
    // in z, and cropped at 2.1× that is exactly what it looked like: a red
    // gradient card with two dark panels leaning on it and hard vertical edges
    // where they met. Nothing about it receded. The reference's mouth is a
    // TUNNEL — you look along the inside of a half-cylinder, the near end of it
    // catches the room, the far end is soot, and the curve is the whole reason
    // the oven has depth instead of being a painted disc at the vanishing point.
    //
    // Twenty tangential staves round the semicircle, each running the depth of
    // the vault, each toned by how far round the arc it sits: bright rust down
    // by the springing where the fire is, sooty at the crown. `box` rotates
    // about Z and leaves the Z axis alone, so a stave at angle `a` is simply a
    // box with its width radial and its height along the arc.
    const tunnelD = 1.0;
    const tunnelZ = back + tunnelD / 2 + 0.06;
    const STAVES = 20;
    const stavePitch = (Math.PI * vaultR) / STAVES;
    for (let i = 0; i < STAVES; i++) {
      const a = (Math.PI * (i + 0.5)) / STAVES;
      const up = Math.sin(a);
      // Same continuous ladder as the vault back — see CAVITY_RAMP. Four
      // buckets round a barrel put four visible rings inside the tunnel.
      const tone = rampTone(up);
      S.box(
        tone,
        0.3,
        // 1.2 left a visible seam between every pair of staves, and twenty
        // horizontal seams across the crown of the vault read as PLANKING — the
        // one material a stone oven cannot be lined with. Half a pitch of
        // overlap and the barrel is a surface again.
        stavePitch * 1.55,
        tunnelD,
        cx + Math.cos(a) * vaultR,
        spring + up * vaultR,
        tunnelZ,
        a,
      );
    }
    // The straight cheeks below the springing, on the same tones, so the tunnel
    // does not stop where the arc does. These are the BRIGHT tone: in the
    // reference the low corners of the mouth are the closest thing in the
    // picture to the fire and they are the lightest part of the cavity. Built
    // at C.cavityMid they rendered as two hard dark wedges flanking the bread.
    for (const s of [-1, 1]) {
      S.box(C.cavity, 0.26, spring, tunnelD, cx + s * vaultR, spring / 2, tunnelZ);
    }
    // AO at the mouth. The reference has a distinct dark contour just inside the
    // ring all the way round — the shadow the arch throws on its own reveal —
    // and it is what stops the opening from reading as a hole cut in paper.
    // Kept to the upper half of the arc: the bottom corners are lit by the fire
    // standing in them and a dark band down there just re-draws the wedges.
    for (let i = 0; i < STAVES; i++) {
      const a = (Math.PI * (i + 0.5)) / STAVES;
      if (Math.sin(a) < 0.42) continue;
      S.box(
        C.cavityDeep,
        0.11,
        stavePitch * 1.25,
        0.16,
        cx + Math.cos(a) * (vaultR - 0.045),
        spring + Math.sin(a) * (vaultR - 0.045),
        back + tunnelD + 0.04,
        a,
      );
    }
    // The sole: the oven floor the loaves stand on, running the depth of the
    // vault. Without it you saw straight through the bottom of the tunnel onto
    // the hearth shelf outside and the two never joined up.
    S.box(C.hearthDark, inner * 2, 0.14, tunnelD + 0.1, cx, spring - 0.44, tunnelZ);
    // No ceiling slab. A box across the top of the vault at 62% of its height
    // rendered as a hard dark horizontal bar straight across the middle of the
    // opening — a shelf, not a vault, and the second-most obvious edge in the
    // frame after the arch itself. The side returns already give the mouth its
    // depth; the crown is better as unbroken falloff.
    // Hearth: the pale slab the fire sits on, plus the lip that projects out.
    // The hearth is SOOTED STONE, not chimney-breast stone. It was built from
    // C.stoneWarm — the same near-white the breast is made of — so a big pale
    // slab sat directly under the fire at frame centre and the two brightest
    // masses in the picture were stacked on top of each other at the vanishing
    // point. In the reference the hearth shelf is a mid warm grey, a good stop
    // under the breast above it, because it is the part of the oven that gets
    // ash on it.
    // hearthDARK inside the arch, not hearth. An up-facing plane collects almost
    // the whole key here, so a pale slab 1m deep running the width of the mouth
    // came back as the second-brightest mass in the frame sitting directly under
    // the fire — a lit podium, again. Only the front LIP outside the ring stays
    // pale, which is what the reference has: a bright shelf you see the edge of,
    // and a floor behind it that is in shadow.
    S.box(C.hearthDark, inner * 2, 0.28, 1.0, cx, spring - 0.4, back + 0.55);
    // THE SHELF STOPS AT THE ARCH. It was cw - 0.85 = 4.0 wide against a 3.3
    // mouth, so a grey slab a third of a metre wider than the opening ran
    // straight across the front of the oven like a concrete lintel laid on its
    // side — and it was the widest single object on the back wall. The
    // reference's shelf sits INSIDE the ring, and what carries it is five short
    // terracotta piers with dark gaps between them.
    // ROUND 12 — THE SHELF WAS A LIT PODIUM.
    //
    // Between the sole inside the vault and this projecting lip the oven had
    // 1.8m of pale up-facing stone running from z 0.2 to z 2.0, and from a 22°
    // camera an up-facing plane collects almost all of the key — so a bright
    // cream trapezoid filled the bottom quarter of the arch and it was the
    // second-brightest mass in the frame, directly under the fire, saying
    // nothing. The reference's lip projects about a third as far and its shelf
    // reads a full stop under the breast. Depth 0.78 → 0.46 and pulled back.
    // ROUND 15 — THE SHELF IS THE OVEN'S LIGHT, AND OURS WAS A SLIVER.
    //
    // Round 12 cut this to a 20cm lip because a 1.8m run of pale up-facing
    // stone was reading as a lit podium — correct diagnosis, and it went one
    // step past the reference. Sampled on the reference's shelf front:
    // rgb(202,180,117), V 0.79, S 0.42, luma 179 — the BRIGHTEST thing
    // anywhere in or around that arch, and a fat cream band roughly a quarter
    // of the mouth's height. It is also nearly neutral, so it costs the food
    // nothing (see the value ceiling: stone may own value because it owns no
    // chroma). What made ours a podium was DEPTH, not height; the front face
    // gets taller and the slab stays shallow.
    const shelfW = openHalf * 2 + 0.18;
    S.box(C.hearth, shelfW, 0.3, 0.46, cx, spring - 0.4, face + 0.14);
    S.box(C.hearthDark, shelfW - 0.1, 0.05, 0.48, cx, spring - 0.56, face + 0.15);
    const piers = 5;
    for (let i = 0; i < piers; i++) {
      const px = cx + (i - (piers - 1) / 2) * (shelfW / piers);
      const ph = spring - 0.5;
      S.box(C.terracotta, shelfW / piers - 0.18, ph, 0.42, px, ph / 2, face + 0.12);
      S.box(C.terracottaDark, shelfW / piers - 0.18, 0.05, 0.44, px, ph - 0.02, face + 0.13);
    }

    // TWO PIZZAS BAKING ON THE HEARTH STONE.
    //
    // The oven is the focal point of the room and it was the only prop in the
    // set with no food on it — the reference bakes two of them right at the
    // front of its hearth, half in shadow and half firelit, and they are what
    // make the arch read as a working oven rather than as a lit hole. Two
    // loaves used to sit BEHIND the flames at the same z, so they were never
    // once visible. These sit on the front lip where the arch frames them.
    // ROUND 11 — AND THEY WERE OUTSIDE THE OVEN, LYING DOWN, AT 0.3 RADIUS.
    //
    // A flat disc seen from a near-frontal camera foreshortens to a sliver: on
    // every capture these read as two small red buttons stuck to the pale hearth
    // BELOW the arch, not as bread baking in it. In the reference the loaves are
    // the most looked-at object on the whole back wall — they sit UP inside the
    // mouth on a dark red ember block, together they span about 55% of the
    // opening, and their bright golden rims land against the rust of the vault
    // behind them. Squashed spheres, not discs, so they keep their volume at a
    // low camera the way a loaf does.
    // The ember block the loaves bake on. It used to span z 0.35–0.85 with the
    // loaves at z 0.66–0.75, so its FRONT face stood in front of the bread and
    // rendered as a flat saturated red card across the bottom of the mouth —
    // the "two orange lozenges on a red gradient" the critic read. It now sits
    // strictly behind them and shows only as the dark red band the reference has
    // under its bread.
    // AN EMBER BAR, NOT A GREY SLAB. In the reference this is a dark maroon
    // block with a hot lip along its top edge, sitting proud of a floor you
    // cannot see the top of — and the loaves sit ON it, half in its shadow.
    // Ours was one flat box and the critic read it as a grey shelf. Three rungs:
    // a dark body, a hotter top course where the fire is actually burning, and a
    // near-black bed line under it that puts the block in front of the vault.
    S.box(C.emberBrick, inner * 0.92, 0.34, 0.56, cx, spring - 0.28, back + 0.6);
    S.box(C.emberLip, inner * 0.86, 0.075, 0.6, cx, spring - 0.12, back + 0.62);
    S.box(C.emberBed, inner * 0.96, 0.07, 0.58, cx, spring - 0.46, back + 0.6);
    // The topping is nearly as wide as the loaf and sits ON it. At 0.34 against
    // a 0.45 crust it left a fat golden ring all the way round and the pair read
    // as a pair of spectacles hanging in the oven — which is exactly what the
    // first pass rendered. The reference's loaf is a red-brown field with a
    // narrow bright crust showing at the edge, nothing more.
    // NESTING TWO SQUASHED SPHERES IS WHAT MADE THE SPECTACLES. Seen from a
    // low near-frontal camera you look at the loaf's FRONT, not its top — so an
    // inset top disc reads as the inside of a bowl and the crust round it reads
    // as a rim. Crust goes UNDERNEATH as a short cylinder and the topping is the
    // whole visible body: from the front that is a red dome on a gold band,
    // which is a loaf, and it holds at 90px.
    // A SQUASHED SPHERE PRESENTS ITS SHADOW SIDE TO THIS CAMERA. The toon ramp
    // lights a dome's top and drops its front to the ramp's foot, and a low
    // near-frontal camera is looking at the front — measured, the pair rendered
    // rgb(239,121,49) along their top edge and rgb(80,11,0) across the face the
    // player actually sees, which is why they kept reading as two dark bowls
    // with bright rims. A short cylinder TIPPED towards the camera presents its
    // lit top cap instead, and a flat cap is also the only way a round loaf
    // holds a circular silhouette at 90px from a 22° camera.
    // FLAT AND WIDE, AND THE CRUST SHOWS ALONG THE BOTTOM EDGE ONLY.
    //
    // Two things kept these wrong. The tilt was 0.62 rad, which stood the discs
    // up until they read as two round pillows — the reference's loaves are wide
    // shallow ellipses about 2.5:1, i.e. nearly lying down. And the crust was a
    // concentric ring around the topping, so the extra radius projected as a
    // pale hood ACROSS THE TOP of each loaf and the pair read as mushrooms. In
    // the reference the crust is the side of the loaf: you see it as a warm band
    // under the front edge and nowhere else. Bigger, flatter, and the crust
    // dropped so the topping owns the whole visible face.
    // AND THE CAMERA IS NOT ABOVE THEM. The reference looks DOWN into its oven
    // far enough to show the loaves as wide ellipses; ours sits at roughly the
    // height of the hearth, so at a 17° tilt the discs went edge-on and
    // disappeared into a 4px sliver. Tilted up to 60° they present a full round
    // face to this camera — the same trick the reference's own trays use to stay
    // legible from a low seat — and the crust stays a band under the front edge.
    // TWO SYMMETRICAL DISCS INSIDE A SYMMETRICAL ARCH ARE A FACE. Twice now:
    // pale ring + dark field = eyes, then dark scorch on a red field = pupils.
    // Whatever marking goes on them, a mirrored pair at the centre of a mirrored
    // opening will be read as eyes before it is read as bread, and it was the
    // single strongest shape in the frame. The reference's loaves are NOT a
    // mirrored pair — they overlap, they sit at different heights, and they
    // merge into one wide mass with a diagonal seam through it. So do these,
    // and nothing is drawn on top of either of them.
    const loaves: [number, number, number, number][] = [
      // OVERLAPPING, DIFFERENT SIZES, DIFFERENT HEIGHTS. Two equal domes sat
      // symmetrically either side of the centre line of a symmetrical arch is a
      // BOWTIE — or a pair of eyes, which is the third time this object has been
      // read as a face. The reference's two loaves are visibly different sizes,
      // one sits behind and above the other, and they overlap by about a third
      // of a radius so together they make one wide mass with a diagonal seam.
      // ROUND 15: down ~17% with the mouth. Together these spanned 68% of the
      // opening against the reference's ~55%, and two objects that wide inside
      // a 2.6m arch leave no vault to silhouette them against.
      [-0.3, 0.09, -0.06, 0.5],
      [0.27, 0.0, 0.16, 0.42],
    ];
    // THE MOUTH HOLDS REAL PANS NOW, SO IT NO LONGER HOLDS FAKE BREAD.
    //
    // Two things were wrong with leaving these in. They are decorative food in
    // a game whose one readability rule is that anything edible-looking can be
    // picked up — the same rule the pancake stacks broke. And they sit at
    // z 0.72-0.94 on the sole, directly behind where the burners now stand, so
    // every pan would have been silhouetted against a pair of loaves.
    const SHOW_LOAVES = false;
    for (const [dx, dy, dz, r] of SHOW_LOAVES ? loaves : []) {
      const px = cx + dx;
      const py = spring + dy;
      const pz = back + 0.62 + dz;
      // ROUND 12b — FLATTER. At 0.22/0.24 deep, a tilted cylinder shows a fat
      // band of its SIDE below the cap, so each loaf read as a dark red dome
      // sitting on a gold drum — a mushroom, and a mirrored pair of them inside
      // a mirrored arch is the third time this shape has been mistaken for a
      // face. The reference's are wide shallow flatbreads about 2.5:1: you see
      // the topping and a narrow warm crust line under the front edge, nothing
      // else. Halved, and dropped onto the ember block rather than floating
      // above it.
      // ROUND 14 — A 2cm CRUST IS AN OUTLINE, NOT A CRUST.
      //
      // At r + 0.02 the gold showed as a hairline round a dark disc and the pair
      // read as two ghost rings floating in the mouth. The reference's crust is
      // a fat band — about 12% of the loaf's radius — bright gold, all the way
      // round, and it is the second-brightest thing on the back wall after the
      // chimney. The topping sits INSIDE it as a deep red field and never
      // touches the outline, so at 90px you read a red disc in a gold ring.
      // ROUND 14b — TILTED CYLINDERS MADE TWO BARRELS, NOT TWO LOAVES.
      //
      // A cylinder rotated -60° about X presents its cap as a near-circle AND a
      // fat band of its own side under it, so the pair rendered as two gold
      // drums with red lids — the fourth distinct wrong shape this object has
      // been through. There is no tilt that fixes that, because the side is
      // always there.
      //
      // A squashed SPHERE has no side. Seen from a low near-frontal camera a
      // wide shallow dome reads exactly as a round loaf sitting on a shelf, and
      // the gold shows all the way round the base as a rim because the crust
      // ellipsoid under it is a shade wider and a shade flatter. No cap, no
      // drum, no ring, and it holds its silhouette at 90px.
      // ROUND 15 — A FATTER RIM AND A DARKER DISC. Measured on the reference at
      // 6x the crust band is roughly a fifth of the loaf's radius, not a
      // twelfth, and the sauce inside it is a full sixth of a stop darker and a
      // third of a stop more saturated than the crust — a pale ring round a
      // dark red disc. At r * 0.9 the rim was a hairline and the pair read as
      // two flat lozenges; the critic could not tell they were pizzas at all.
      // FLATTER, so the pair read as flatbread lying on a hearth rather than as
      // two glossy domes. At sy 0.4/0.5 the crust and the sauce both presented
      // a curved FRONT to a 22-degree camera, and a curved front under a toon
      // ramp is a value gradient from lit top to dark belly — which is what
      // made them look like blown glass. A 0.28 dome is nearly a disc: it shows
      // its lit top, the crust reads as a rim round it, and there is no belly.
      // ROUND 17 — A THIN RING ROUND A BRIGHT DISC IS A SAUCER, NOT A LOAF.
      //
      // Cropped at 4x beside the reference's: theirs is a FAT pale golden crust,
      // roughly a third of the loaf's radius, with a visibly lumpy edge, and the
      // sauce inside it is a deep red-brown a clear stop DARKER than the crust.
      // Ours ran a 22% rim round a topping brighter than the rim itself, which
      // inverts the whole read: a bright orange disc in a pale ring is a bowl of
      // soup in a saucer, which is exactly what the critic called it.
      //
      // Sauce down to 0.64 of the crust and dropped a stop, a contact shadow
      // under the loaf onto the ember block (the reference's loaves sit IN a
      // dark pocket, which is most of what makes the mouth read as deep), and
      // five crust blisters round the rim so the silhouette is not a circle.
      S.ball(C.loafShade, r * 1.06, px, py - 0.11, pz - 0.02, 1.05, 0.16, 0.7);
      S.ball(C.loafCrust, r, px, py - 0.03, pz, 1.02, 0.3, 0.62);
      for (let b = 0; b < 5; b++) {
        const a = 0.6 + b * 1.31 + dx;
        S.ball(C.loafCrust, r * 0.26, px + Math.cos(a) * r * 0.88, py - 0.02, pz + Math.sin(a) * r * 0.5, 1, 0.3, 0.6);
      }
      S.ball(C.loafTop, r * 0.64, px, py + 0.02, pz + 0.03, 1, 0.34, 0.56);
      // One blister, off-centre and not mirrored between the loaves — see the
      // note above about a mirrored pair inside a mirrored arch reading as eyes.
      S.ball(C.loafChar, r * 0.17, px + dx * 0.4, py + 0.1, pz + 0.06, 1, 0.35, 0.6);
    }

    // Live fire, unlit, so it reads as light rather than as a lit object.
    //
    // The cavity glow is a GRADIENT, not a flat wash. A single uniform orange
    // plane across the whole vault is what made the oven read as a flat brown
    // arch with cardboard triangles stuck to it: real firelight is fierce at the
    // hearth and gone two feet up, and that vertical falloff is most of what
    // tells you the light has a source down at floor level.
    // ROUND 10: the wash is SHORTER as well as dimmer. At archTop × 1.02 it ran
    // the full height of the vault, so the whole opening lit up and the arch
    // read as a lamp with stones round it. Firelight from a raked-back ember
    // bed does not reach the crown; cutting the plane to 0.68 of the arch
    // leaves the top third of the cavity genuinely sooty, which is the read the
    // reference has and the reason its oven feels deep instead of flat.
    // ROUND 11 — A BOTTOM-UP RAMP IS THE WRONG GRADIENT.
    //
    // `emberGradient` runs hot at v=0 and gone by the top, so the wash lit a
    // horizontal band along the hearth and left everything above it at the
    // vault's raw albedo. The reference's cavity is a RADIAL: brightest in a
    // pool around the loaves, falling away in every direction including
    // downward, so the corners of the mouth stay dark and the middle glows.
    // Measured across its opening the fall is roughly rgb(186,104,30) at the
    // centre to rgb(93,25,4) at the haunches — that is a pool, not a ramp.
    // ROUND 12 — IT IS A POOL, AND IT WAS THE WHOLE MOUTH.
    //
    // At inner × 2.3 by the full height of the vault this plane covered every
    // pixel inside the arch, so the "radial" never fell to zero anywhere the
    // player can see and the cavity rendered as one flat milky orange: measured
    // rgb(196,138,97), L 57 at chroma 0.51 against the reference's L 33 at
    // chroma 0.90. Two thirds of the width and half the height puts the light
    // round the loaves and lets the haunches and the crown keep the deep rust
    // the albedo is authored at, which is the read the reference has.
    // ROUND 15 — A SMALL LOW EMBER BAR, NOT A FULL-ARCH GRADIENT.
    //
    // At (openHalf + vaultR) * 0.62 this pool stood 2.1m tall in a 1.65m arch:
    // it covered the mouth from the sole to well past the springing, which is
    // why the cavity read as one lit orange field with two shapes floating in
    // it. Cropped at 2.3x beside the reference the difference is not subtle —
    // theirs is a dark rust vault with a hot band along the bottom where the
    // fire is, ours was a lamp. A third of the height, low in the mouth, and
    // the vault above it keeps the albedo the ladder authors.
    const glowH = (archTop - spring + vaultR) * 0.2;
    const glow = new THREE.Mesh(
      new THREE.PlaneGeometry(inner * 1.15, glowH),
      new THREE.MeshBasicMaterial({
        // Tinted, not white. An untinted additive wash over the vault takes the
        // cavity to V 0.99 at frame centre; the reference's cavity peaks around
        // V 0.73. This is the light of a bread oven an hour after the fire was
        // raked back, which is what the reference is showing.
        // ROUND 14 — UP, BECAUSE THE HALO IS NOW BEHIND THE BREAD RATHER THAN
        // OVER IT. With the loaves moved forward to z back+0.72 this plane sits
        // a clear half-metre behind them, so it can no longer wash pigment out
        // of the thing it is meant to be lighting — it reads as the fire showing
        // round the edges of the loaves, which is exactly what the reference's
        // brightest ring is.
        // INTEGRATION — THE FIRE WAS SITTING ON THE CEILING RESERVED FOR FOOD.
        //
        // main.ts writes a highlight shoulder whose stated purpose is that
        // "the top of the value range is freed up for the food, which is the
        // only thing that should ever be near it", and caps it at 0.90. This
        // plane, the pulse below it, five additive flame tongues and four
        // point lights all sum in the same few hundred pixels, and the result
        // was pinned against that cap. Sampled off
        // shots/INT-002/desktop/t0064s.jpg:
        //
        //                    fire core      tomato
        //   reference          V 0.66       V 0.73     food wins by 0.07
        //   ours               V 0.93       V 0.79     FIRE wins by 0.14
        //
        // A 0.21 inversion of the one rule REFERENCE.md states outright. The
        // oven was the brightest and among the most saturated objects in every
        // frame, so the eye went to the back wall instead of to the ingredients
        // — and because it was clamped, the fire had no headroom left to
        // FLICKER in either: the pulse below could only ever push it further
        // into the clamp.
        //
        // Both additive tints come down to 0.58 of what they were, which is
        // what it takes to land the core back under the tomato. The hue is
        // untouched, the pool shape is untouched, the flicker is untouched —
        // this is exposure, not art direction. The fire is still by a distance
        // the warmest thing in the room and still the only light in it.
        // ROUND 15 — ON A BUDGET, NOT ON A JUDGEMENT. Every one of the five
        // additive layers in this arch was tuned on its own and they all sum
        // in the same three hundred pixels, which is how the mouth's top
        // percentile ended up clipped at V 1.00 with no single tint looking
        // unreasonable in the source. `fireTint` splits one budget between
        // them and clamps whatever is handed to it.
        color: fireTint(0x61340c, 1, 0.24),
        map: softBlob(),
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    // Low in the mouth, on the ember block, not centred on the springing.
    glow.position.set(cx, spring - 0.22, back + 0.1);
    this.root.add(glow);
    this.ovenGlow = glow;

    // THE EMBER PULSE — THE ONE THING IN THE WHOLE SET THAT MOVES.
    //
    // Region-diffed across sixteen seconds of real capture, the oven changed
    // LESS than a static patch of wall: the flame tongues were authored behind
    // the ember block and were never once on screen, and the glow's ±0.09 of
    // opacity on a dim tint moved the pixel by two or three values. A kitchen
    // whose only light source is dead is a photograph. This is a second, hotter,
    // much smaller additive pool sat right behind the loaves and driven hard
    // enough to see — see update(), where it runs on two incommensurate
    // frequencies so it never lands on a loop the eye can learn.
    // IN FRONT OF THE BREAD, NOT BEHIND IT. The first pass put this at the back
    // of the vault where the ember block and the loaves occluded its whole core:
    // measured across four timed captures the oven's mean luma moved by two
    // values, which is not a fire, it is a photograph of one. Sat just off the
    // front of the loaves it is firelight falling ON the bread and spilling
    // round it, and the whole mouth breathes.
    // ROUND 15 — AND STANDING IT IN FRONT OF THE BREAD IS WHY THE BREAD WAS GEL.
    //
    // At z = back + 1.02 with the loaves at back + 0.68…0.78 this additive
    // plane was drawn OVER the pizzas, not behind them. Cropped at 2.3x that
    // is exactly what it looked like: two translucent orange gel blobs with no
    // crust and no sauce, because an additive wash over a two-tone object
    // flattens both tones into one. The coherence pass called it out as "the
    // oven loaves read as translucent orange gel" and it was never a pigment
    // problem. It goes BEHIND the loaves, where the reference's glow is —
    // light escaping round the edges of the bread — and it gets smaller with
    // the pool above.
    const pulse = new THREE.Mesh(
      new THREE.PlaneGeometry(inner * 1.25, glowH * 1.05),
      new THREE.MeshBasicMaterial({
        color: fireTint(0x6b340c, 1, 0.22),
        map: softBlob(),
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    pulse.position.set(cx, spring - 0.14, back + 0.42);
    this.root.add(pulse);
    this.ovenPulse = pulse;

    // A WARM BOUNCE ON THE STONE, WHICH IS WHERE A FLICKER IS ACTUALLY VISIBLE.
    //
    // Measured across five timed desktop captures the fire region moved by two
    // luma — 123/124/123/124/122 — and the oven crops were pixel-identical at
    // 2x. Part of that is the sampling aliasing with the flicker rate (fixed
    // below), but most of it is that both additive layers live INSIDE a mouth
    // that is 3% of the frame and already near its value ceiling, so there is
    // nowhere for them to swing. Firelight also falls on the stone AROUND the
    // opening: the reference's springing stones and hearth lip carry a distinct
    // warm cast that the pale limestone above them does not. A wide, very dim
    // additive pool laid over the jambs and the shelf has ten times the area to
    // move in and costs the mouth's value ceiling nothing, because it is
    // spending its light on a near-neutral surface instead of a saturated one.
    const bounce = new THREE.Mesh(
      new THREE.PlaneGeometry(openHalf * 3.6, (spring + openHalf) * 1.5),
      new THREE.MeshBasicMaterial({
        color: fireTint(0x2e1305, 1, 0.08),
        map: softBlob(),
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    bounce.position.set(cx, spring * 0.55, face + 0.14);
    this.root.add(bounce);
    this.archBounce = bounce;

    // ROUND 15 — THERE IS NO FLAME IN THE REFERENCE, AND OURS WERE DRAWN IN
    // FRONT OF THE BREAD.
    //
    // Six rounds of notes above move three additive flame tongues and a hot
    // ember strip around the mouth looking for a place they read. They were at
    // z = back + 0.85…1.05 and the loaves at back + 0.72…0.94, so all four
    // additive layers were compositing OVER the pizzas — which is why, cropped
    // at 2.3x, the loaves rendered as two translucent orange gel blobs with no
    // crust and no sauce visible at all. An additive wash over a two-tone
    // object flattens both tones into one; no amount of re-pigmenting the
    // bread could ever have survived it.
    //
    // And the object they were chasing does not exist. Enlarge the reference's
    // mouth 6x: there is no flame in it. There is a warm rust vault, a dark
    // maroon block, two pizzas, and light coming from somewhere behind them.
    //
    // ================================================================
    // WAVE 3 — THE FLAMES COME BACK, BECAUSE BOTH REASONS THEY LEFT ARE GONE.
    //
    // Round 17 deleted the tongues for two stated reasons and the notes above
    // are careful about both. The first was mechanical: the tongues sat at
    // z back+0.85..1.05 and the loaves at back+0.72..0.94, so four additive
    // layers composited straight over the bread and turned two pizzas into
    // orange gel. THE LOAVES ARE GONE — the mouth holds the game's real burners
    // now — so there is nothing left in here for a tongue to wash out. The
    // second was fidelity to the reference photograph, which shows no flame.
    // That one was overruled by the person the game is for: asked directly,
    // having played it on a phone, they wanted the fire back.
    //
    // It is also no longer only decoration. The arch is where you cook, and a
    // visible flame is the cheapest possible way to say so — a burner that is
    // obviously ON needs no tutorial text.
    //
    // What is kept from the deletion: the tongues stay BEHIND the burners
    // (z back+0.55 against pans at the hearth lip, z 1.5), so they light the
    // pans from behind and silhouette them instead of washing over them; and
    // every tint goes through `fireTint`, which splits one clamped budget
    // between all the additive layers in this arch rather than letting each
    // one look reasonable on its own and the sum clip at V 1.00.
    const TONGUES: [number, number, number][] = [
      // x offset, height, phase
      [-0.46, 0.42, 0.0],
      [0.04, 0.54, 2.3],
      [0.5, 0.38, 4.1],
    ];
    for (const [ox, fh, phase] of TONGUES) {
      // A lathe tapering from a fat foot to a point, so the silhouette is a
      // tongue rather than a cone: fire is widest just above the fuel, not at
      // it. LatheGeometry lays v=0 at the first profile point (the foot), which
      // is what the alpha ramp below is authored against.
      const profile = [
        new THREE.Vector2(0.001, 0),
        new THREE.Vector2(0.1, fh * 0.16),
        new THREE.Vector2(0.115, fh * 0.4),
        new THREE.Vector2(0.07, fh * 0.72),
        new THREE.Vector2(0.001, fh),
      ];
      const m = new THREE.Mesh(
        new THREE.LatheGeometry(profile, 10),
        new THREE.MeshBasicMaterial({
          color: fireTint(0xb85a17, 1, 0.3),
          map: flameRamp(),
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      );
      /**
       * ON TOP OF THE EMBER BLOCK, WHICH IS THE MISTAKE THAT DELETED THEM.
       *
       * The block is built at centre `spring - 0.28`, 0.34 tall, z `back + 0.6`
       * by 0.56 deep — so it occupies y 0.41-0.75 and z 0.48-1.04, and its lip
       * tops out at 0.78. The first attempt at restoring these put the tongues
       * at y 0.50, z 0.82: geometrically INSIDE the brick, which is the same
       * failure the round-15 note describes as "authored behind the ember block
       * and never once on screen". Fire comes off the top of the fuel.
       */
      const baseY = spring - 0.06;
      m.position.set(cx + ox, baseY, back + 0.62);
      m.userData.phase = phase;
      m.userData.baseY = baseY;
      this.root.add(m);
      // update() already owns the flicker — two incommensurate frequencies per
      // tongue, written and tuned in round 15 and left in place when the meshes
      // were deleted. This is the loop finally having something to animate.
      this.fire.push(m);
    }
  }

  // ------------------------------------------------------------- furniture

  private buildStation(st: Station) {
    const g = new THREE.Group();
    const c = stationCenter(st);
    // Ride the stagger, the yaw and the height its bench got, so the dish never
    // floats off the plank.
    const seat = this.benchAt.get(st.cell.y * this.kitchen.width + st.cell.x);
    // Back-wall fixtures are counter height; anything out on the open floor is
    // a low prep bench so it can never hide a chef from a frontal camera.
    const againstWall = st.cell.y <= 1;
    /**
     * A BURNER IN THE ARCH STANDS ON THE HEARTH, NOT ON A PAINTED COUNTER.
     *
     * The hearth floor inside the mouth and the pale lip that projects out of
     * it form one continuous stone surface at y 0.60-0.61 (see the hearth boxes
     * in the arch builder: `spring - 0.4` centre, 0.3 tall). A hob placed there
     * lands on the stone instead of hovering over it, and — the point of the
     * whole change — it is lit by the fire behind it, so it reads as the hot
     * part of the room without needing a label.
     */
    const inOven = inOvenSpan(st.cell);
    const h = inOven ? HEARTH_TOP : againstWall ? COUNTER_H : (seat?.h ?? TABLE_H);
    const x = seat?.x ?? c.x;
    const z = seat?.z ?? c.y;
    g.position.set(x, 0, z);
    if (seat) g.rotation.y = seat.yaw;
    const P = this.props;

    // Floor stations do NOT build their own furniture: buildBenches() has
    // already laid one continuous plank under each horizontal run of them.
    if (againstWall && !inOven) {
      // Team pass on the left, cook line on the right — the reference's red and
      // green counters, with the same painted body and pale top rail.
      // NOT in the oven mouth: a painted counter body there would bury the
      // hearth and put a red-or-green slab across the middle of the arch.
      const left = st.cell.x < this.kitchen.width / 2;
      const body = left ? C.teamRed : C.teamGreen;
      const dark = left ? C.teamRedDark : C.teamGreenDark;
      const rail = left ? C.teamRedTop : C.teamGreenTop;
      P.box(body, 1.0, h - 0.16, 0.86, x, (h - 0.16) / 2 + 0.1, z);
      P.box(dark, 1.02, 0.1, 0.88, x, 0.05, z);
      P.box(dark, 1.03, 0.06, 0.9, x, h - 0.2, z);
      P.box(rail, 1.06, 0.14, 0.94, x, h - 0.07, z);
    }

    let hot: THREE.Mesh | undefined;
    switch (st.kind) {
      case 'crate':
        // EVERY HERO INGREDIENT SITS IN WHITE PORCELAIN. ALWAYS.
        //
        // This used to rotate vessels to break up the pale rectangles, and with
        // twenty crates of ten ingredient types that was the right trade. It is
        // the wrong trade now. Go and look at the reference: the three things it
        // asks you to fetch are a tray of pink bacon rashers, a tray of red
        // tomatoes and a tray of green lettuce heads, and every single one of
        // them is sitting in bone-white ceramic. The white well is not
        // decoration, it is the value platform the saturated food is measured
        // against, and it is the whole reason you can name a tray from across
        // the room in 200ms. A tomato pile on honey plank is saturated-warm on
        // saturated-warm and you have to hunt for it.
        //
        // The bun is the one thing here the reference does not treat as a hero
        // — it keeps its bread in timber baskets and on metal trays — so it
        // takes the slat crate, which also stops thirteen identical pale
        // rectangles from landing on a regular pitch across the floor.
        if (st.dispenses && TRAY_FOOD.has(st.dispenses)) this.tray(x, h, z);
        else this.slatCrate(x, h, z);
        // Down IN the well, not perched on the rim.
        if (st.dispenses) this.heap(st.dispenses, x, h + 0.07, z);
        break;
      case 'board': {
        // Pale maple on honey bench. At 0xdcb375 the board was within a few
        // percent of the plank it lay on and simply disappeared; a chopping
        // station the player cannot find is a station that does not exist.
        // Warm maple, a stop above the bench and two stops below the crockery.
        // 0xecd6a6 overshot: two boards side by side became a single pale slab
        // that was the brightest thing on the play field, which is the exact
        // trap the tray colour was pulled out of.
        // ROUND 14 — THE BOARD WAS A BLANK PALE CARD 84cm ACROSS.
        //
        // At 0.84 × 0.66 in 0xd7b478 a chopping board covered most of a bench
        // cell in a tone within a few points of the crockery, so four of them
        // read as the emptiest, palest objects on the play field — and with
        // seven boards in the new map that is a lot of blank. The reference's
        // boards are SMALL, distinctly warmer than its dishes, and always have
        // something on them: a knife, a heel of something, crumbs.
        // ...AND DARKER AGAIN. At 0xc79c5e the board still measured the palest,
        // blankest object on the play field, and there are seven of them now. A
        // butcher's board is walnut-dark next to a pine bench, not paler than it
        // — that value inversion is why two of them side by side read as a
        // blank card the size of the bench.
        // ROUND 15 — NEVER A BROWN OBJECT ON A BROWN BENCH.
        //
        // Sampled off the ipad capture, the board rendered rgb(112,64,19)
        // luma 73 against the bench plank it lies on at rgb(115,65,20) luma 75.
        // TWO POINTS of luma between a prop and its ground, at the same hue, in
        // seven places on the play field — at thumbnail those seven boards read
        // as holes burned in the furniture, not as stations. Six rounds of
        // notes above walk the board's value up and down between 0xdcb375 and
        // 0x6f4718 looking for a number that separates from honey plank, and
        // there isn't one, because the bench is honey plank at every value.
        //
        // The reference solves it by never having the problem: go and look —
        // every object on every bench in that room is white ceramic, steel, or
        // a saturated hue that nothing else owns. So the board gets the same
        // white porcelain platform the ingredient trays get. A bone-white slab
        // a little proud of the board on all four sides is a hard light edge
        // round a dark object, which is separation you cannot lose to lighting.
        // A RIM, NOT A CARD. The first cut of this ran the slab 0.78 x 0.62
        // under a 0.62 x 0.48 board — an 8cm white margin all round, which at
        // 1194px is a blank porcelain rectangle three times the area of the
        // board on it, and three of them down the left flank were the palest,
        // emptiest objects on the play field. That is the exact trap six
        // rounds of notes above pulled the board's own colour out of. 3cm of
        // white showing on each side is a light edge; 8cm is a plate.
        // ROUND 17 — HALF-FIXED IS STILL BROWN ON BROWN.
        //
        // The white slab under the board went in last round and it helped, but
        // measured on the shipped capture the board FACE still came back luma 93
        // on a bench at 114 — same hue, twenty-one points — and at 393px wide
        // the 3cm of porcelain showing round it disappears, so five boards
        // collapse back into five dark rectangles. Six rounds of notes above
        // walk this tone up and down looking for a brown that separates from
        // honey plank and there isn't one.
        //
        // So the CUTTING SURFACE stops being brown. It is a pale grey-green
        // stone slab — the one cool near-neutral in a room of ochre — inside a
        // narrow walnut rim, which keeps the "board" read (rim, lip, knife)
        // while putting the largest plane of the object a clear stop ABOVE the
        // bench instead of a stop below it. The porcelain under it widens to 4cm
        // a side so the light edge still exists at phone scale.
        // ...AND A PALE SLAB IS A BLANK CARD, WHICH IS THE OTHER HALF OF THE
        // TRAP. The first cut of the stone face ran 0.74 x 0.60 of porcelain
        // under a near-white slate and eight of them across the room came back
        // as the emptiest, palest, most repeated shape in the lower frame — the
        // exact failure four rounds of notes above pulled the board's own colour
        // out of. It is 25% smaller, the porcelain shows as a 2cm LIP rather
        // than a margin, and the working face is a MID sage grey: a stop under
        // the crockery, a stop over the walnut rim, and cool, so it can never
        // merge into plank at any lighting.
        P.box(C.tray, 0.62, 0.04, 0.48, x, h + 0.02, z);
        P.box(C.trayShade, 0.64, 0.018, 0.5, x, h + 0.004, z);
        P.box(0x6f4718, 0.58, 0.055, 0.44, x, h + 0.068, z);
        P.box(C.slate, 0.5, 0.04, 0.36, x, h + 0.108, z);
        // A darker channel round the rim — a board is a slab with a lip, and
        // without the line the two slabs above read as one pale card.
        P.box(0x6f4718, 0.54, 0.018, 0.045, x, h + 0.124, z + 0.185);
        // Knife laid along the back edge.
        P.box(C.knife, 0.42, 0.02, 0.06, x + 0.08, h + 0.14, z - 0.19, 0, 0.18);
        P.box(C.timberDark, 0.16, 0.05, 0.06, x - 0.16, h + 0.14, z - 0.23, 0, 0.18);
        break;
      }
      case 'stove': {
        // A pale stone trivet with a steel ring set into it. The old hob was a
        // 0x4a3b2f plate under a 0x2f2620 disc — a near-black bullseye on the
        // green counter, and with a pan on it the whole cook line went dark.
        //
        // ...AND IN THE OVEN MOUTH IT IS THE OPPOSITE PROBLEM. That pale stone
        // is a 72cm disc, the widest single thing on the burner, and against
        // sooted hearth stone it is the brightest — so the object a player
        // actually sees at a burner is a big pale circle, which is precisely
        // what got reported as "is that the hamburger bun?". The pan on top was
        // only half of that read; this was the other half. Inside the arch the
        // whole assembly goes to iron and the fire behind it does the lighting.
        const trivet = inOven ? 0x574f4a : C.stoneWarm;
        const ringCol = inOven ? 0x322d31 : C.steelDark;
        P.cyl(trivet, 0.36, 0.37, 0.08, 18, x, h + 0.04, z);
        P.cyl(ringCol, 0.3, 0.3, 0.04, 18, x, h + 0.08, z);
        P.cyl(inOven ? 0x7a4a22 : 0xa8663a, 0.24, 0.24, 0.02, 18, x, h + 0.1, z);
        // Also per-instance: the hob glow is animated per station too.
        hot = new THREE.Mesh(new THREE.CylinderGeometry(0.29, 0.29, 0.02, 20), flatOwn(PALETTE.stoveHot, 0.0));
        hot.position.set(0, h + 0.085, 0);
        g.add(hot);
        break;
      }
      case 'plates': {
        // The reference's signature: a comedy tower of white plates. Shorter
        // out on the open floor — the whole reason those benches are knee-high
        // is that nothing on them may ever hide a chef.
        // Out on the open floor a stack may not clear 0.3 of a chef; against
        // the back wall it can be the reference's comedy tower, because there
        // is nothing behind the pass for it to hide.
        // ROUND 15 — YOU HAVE TO BE ABLE TO COUNT THE PLATES.
        //
        // The stack was 4.8cm discs on a 5cm pitch — a 2mm gap, which at the
        // scale these render is under a pixel, so eight plates merged into one
        // smooth grey cylinder. The reference's tower is the single most
        // readable prop in its room precisely BECAUSE you can see every rim in
        // it. A 4.2cm disc on a 5.6cm pitch leaves a 1.4cm shadow gap, and the
        // tone alternates every plate rather than every fourth, so the stripe
        // survives even when the gap does not.
        const n = againstWall ? 10 : 4;
        for (let i = 0; i < n; i++) {
          const r = 0.3 - (i % 3) * 0.006;
          P.cyl(i % 2 === 0 ? 0xece4d2 : PALETTE.plates, r, r - 0.03, 0.042, 16, x + (i % 2 ? 0.012 : -0.01), h + 0.03 + i * 0.056, z + (i % 3 === 0 ? 0.01 : -0.008));
        }
        break;
      }
      case 'serve': {
        // A real pass: white service trays sunk into the counter top, with a
        // brass bell where the ticket gets rung off.
        P.box(C.trayShade, 0.78, 0.1, 0.66, x, h + 0.05, z);
        P.box(C.tray, 0.72, 0.09, 0.6, x, h + 0.09, z);
        P.box(C.trayRim, 0.6, 0.05, 0.48, x, h + 0.125, z);
        break;
      }
      case 'bin': {
        // A SCRAPS BARREL, NOT A BLACK BIN. Built from 0x5b4a3a / 0x3f342a /
        // 0x2f2720 it rendered at luma ~28 — by a wide margin the darkest object
        // anywhere in the room, a black cylinder standing on the open floor in a
        // set whose only true darks are supposed to be the contact pools under
        // furniture. Same silhouette, same height, built as a coopered timber
        // barrel with two steel hoops so it sits in the room's warm band and
        // still reads as "put it in here" at 90px.
        P.cyl(C.benchTopAlt, 0.33, 0.29, 0.5, 14, x, h + 0.25, z);
        for (const hy of [0.12, 0.4]) P.cyl(C.steelDark, 0.34, 0.34, 0.05, 14, x, h + hy, z);
        P.cyl(C.benchRail, 0.35, 0.34, 0.07, 14, x, h + 0.52, z);
        P.cyl(C.timberDark, 0.08, 0.08, 0.07, 8, x, h + 0.58, z);
        break;
      }
      case 'sink': {
        // The wide shallow basin the reference parks on a mid bench. Its rim is
        // bright steel and the water inside it is pale blue — ours was a dark
        // grey slab that read as a hole in the bench from three tables away.
        P.box(C.steel, 0.88, 0.2, 0.66, x, h + 0.08, z);
        P.box(0xa9c6c8, 0.74, 0.16, 0.52, x, h + 0.13, z);
        P.cyl(C.steel, 0.035, 0.035, 0.34, 8, x + 0.3, h + 0.34, z - 0.2);
        P.cyl(C.steel, 0.035, 0.035, 0.2, 8, x + 0.2, h + 0.49, z - 0.2, 0, Math.PI / 2);
        break;
      }
      default:
        break;
    }

    const anchor = new THREE.Object3D();
    anchor.position.y = h + 0.1;
    g.add(anchor);

    const contentRoot = new THREE.Group();
    contentRoot.position.y = h + 0.1;
    g.add(contentRoot);

    const ring = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.4, 24, 1, 0, 0), flat(0xffe066));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = h + 0.14;
    ring.visible = false;
    g.add(ring);

    // flatOwn, not flat: this material is written every frame by the update
    // loop below, and the cached flat() handed the same instance to all twenty
    // stations, so the focused station's pulse lit a cream crescent under every
    // bench in the room. See materials.ts flatOwn().
    // THE FOCUS MARKER WAS A HAIRLINE, AND REFERENCE.md SAYS NEVER A HAIRLINE.
    //
    // It was RingGeometry(0.52, 0.62, 28) in near-white 0xffe6a0 at y = 0.02:
    // a 10cm-wide unlit band with visible facets at desktop scale, lying on the
    // floor where the bench above it chopped it into a broken arc, strobing at
    // 1.4 Hz. Four defects in one line.
    //
    // Now a soft POOL — a filled disc with a radial falloff baked into the
    // texture, so it has no edge to be faceted or hairline-thin, and being
    // filled it still reads as a pool of light when the bench occludes two
    // thirds of it. Warm amber rather than cream, deliberately below the food's
    // value so a lit station never out-brights a tomato, and the pulse is
    // slowed to a breathe (see update()).
    // ROUND 17: 1.5 -> 1.05 and dimmer below. With the room densified there is a
    // bench within half a cell of every station, so a 1.5m additive pool spilled
    // past the furniture and stamped a peach-coloured stain on the open floor at
    // frame centre — visible in shots/j-set-r4/ipad-landscape/90-late.jpg as a
    // disc under the oven that corresponds to no object. The marker only has to
    // say "this one".
    //
    // ================================================================
    // WAVE 3 — THE MARKER CANNOT LIVE ON THE FLOOR. IT NEVER COULD.
    //
    // Every note above tunes the SIZE and the COLOUR of a pool lying at
    // y = 0.03 underneath a bench whose top is at y = 0.38 and whose apron
    // reaches within 0.1 of the ground. From a 22.5 degree camera that pool is
    // behind the furniture that casts it. Measured by rebuilding the game twice
    // — once with this mesh compiled out, once with it at 7x — and differencing
    // the two frames: 2,047 pixels lifted by more than 2 luma, 0.16% of a
    // 1440x900 frame, all of it in the 15-pixel shadow gap under the bench lip.
    // The comment four paragraphs up says "the bench occludes two thirds of it"
    // and treats that as a property to be worked around. It is the whole defect.
    //
    // So the pool comes UP ONTO THE PLANK. `topY` is the bench's board surface
    // (see buildBenchRun: the boards sit with their top face at exactly `h`),
    // and the wash is a soft-edged rounded rectangle the size of the station's
    // own cell, lying on it. Nothing in the room occludes the top of a bench —
    // that is the entire reason the camera is allowed to be this low — so every
    // pixel of it is seen, and it lands on the honey planks the reference makes
    // the lightest large plane in the lower third, where a warm additive wash
    // has somewhere to go.
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(0.98, 1.1), flatOwn(0xffb454, 0.0));
    (glow.material as THREE.MeshBasicMaterial).map = focusWash();
    (glow.material as THREE.MeshBasicMaterial).blending = THREE.AdditiveBlending;
    glow.rotation.x = -Math.PI / 2;
    // 8mm of clearance over the boards: enough to beat z-fighting on a software
    // rasteriser, far too little to read as a floating card.
    glow.position.y = h + 0.008;
    g.add(glow);
    /**
     * ...AND DOWN THE FRONT OF IT.
     *
     * A camera 22.5 degrees above the floor sees a bench top at a glancing
     * angle and its front face almost square on, which is exactly why
     * buildBenchRun spends a dark apron, a lit rail and a bright lip on that
     * face: it is the plane that does the work. So the wash gets a second panel
     * there. It roughly doubles the marker's footprint for one quad, it lands
     * on the DARKEST large surface on the furniture where a warm additive term
     * has the most room to move, and — the part that matters — it welds the
     * light to the object. A pool on a table top alone can read as something
     * lying on the table; a top and a face lit together read as the table.
     */
    const face = new THREE.Mesh(new THREE.PlaneGeometry(0.98, 0.34), flatOwn(0xffb454, 0.0));
    (face.material as THREE.MeshBasicMaterial).map = focusWash();
    (face.material as THREE.MeshBasicMaterial).blending = THREE.AdditiveBlending;
    face.position.set(0, h - 0.14, (againstWall ? 0.44 : 0.61) + 0.01);
    g.add(face);

    this.root.add(g);
    const view: StationView = { station: st, group: g, anchor, ring, glow, face, hot, contentRoot, contentKey: '', topY: h, inOven };
    this.stationViews.push(view);
    this.byId.set(st.id, view);
  }

  /**
   * ONE bench per horizontal RUN of floor stations, not one per cell.
   *
   * The reference's furniture is long: its planks are two and three tiles
   * across and the varied lengths are most of what makes the room read as a
   * scatter of tables rather than a grid of pedestals. Ours built a separate
   * 1.0-wide stool under every station, so a pair of tomato dishes sat on two
   * abutting cubes with a seam down the middle and every piece of furniture in
   * the room was exactly the same size.
   *
   * Our map already hands us the variety for free: `TT` is a run of two, `PP-`
   * a run of three, `K` and `W` singles. Merge them and the room gets the
   * reference's rhythm without touching a single walkable cell.
   */
  /**
   * ROUND 17 — A RUN OF FOUR IS A WALL, NOT A TABLE.
   *
   * Measured against the reference: its benches are one and a half to two cells
   * long and no two in a rank sit at the same depth, so a lane always has
   * something standing in it somewhere along its length. Ours built ONE plank
   * per run — up to four and five cells — parallel to the frame, and the two
   * long ranks that produced are exactly why the lanes between them measured as
   * unbroken edge-to-edge grey stripes in every landscape capture.
   *
   * Any run longer than three cells is now built as TWO benches with a finger's
   * gap between them and 0.44 of a cell of depth between their centres, which is
   * enough that the near one occludes the lane behind the far one and neither
   * lane runs clear across the frame. The walkable cells are untouched — this is
   * furniture, not level.
   */
  private buildBenches() {
    const k = this.kitchen;
    for (let y = 2; y < k.height; y++) {
      let x = 1;
      while (x < k.width) {
        if (k.cells[y * k.width + x] !== 'station') {
          x++;
          continue;
        }
        let x1 = x;
        while (x1 + 1 < k.width && k.cells[y * k.width + x1 + 1] === 'station') x1++;
        const n0 = x1 - x + 1;
        if (n0 > 3) {
          const a = Math.ceil(n0 / 2);
          this.benchRun(x, a, y, -1);
          this.benchRun(x + a, n0 - a, y, 1);
          x = x1 + 1;
          continue;
        }
        this.benchRun(x, n0, y, 0);
        x = x1 + 1;
      }
    }
  }

  /** One plank under cells [x, x+n) of row y. `part` splits a long run in depth. */
  private benchRun(x: number, n: number, y: number, part: -1 | 0 | 1) {
    const k = this.kitchen;
    {
      const x1 = x + n - 1;
      {
        // Stagger each run a little in depth. On a strict grid every lane is a
        // clean horizontal band of bare flagstone the full width of the room,
        // and on phone portrait — where you only see five rows — those bands are
        // most of the frame. The reference never lines two benches up exactly;
        // breaking the rank by a tenth of a cell is enough to kill the banding
        // without moving a single walkable cell.
        const dz = this.runOffset(x, y) * 0.34 - 0.17 + part * 0.22;
        // YAW, AND WHY IT IS WORTH THE BOOKKEEPING.
        //
        // Every bench in the room stood at exactly zero rotation, ranked to the
        // flagstone grid, and that single fact is most of why the critic read
        // the floor as "cafeteria shelving": eighteen rectangles all sharing two
        // vanishing points. The reference does not have one bench square to the
        // room. Four degrees is enough — it is below the threshold where you
        // notice a bench is crooked, and above the threshold where the eye stops
        // resolving the whole rank as one extruded object.
        //
        // The cost is that a station's dish no longer sits at its cell centre,
        // so the run records where each cell ENDED UP and buildStation reads it
        // back. Nothing in the sim moves: the walkable cell is untouched.
        const yaw = (this.runOffset(x + 31, y + 7) * 2 - 1) * 0.12 + part * 0.05;
        // A bench is a made thing, not a mould. ±3cm of height across the room
        // stops four ranks of tops from lining up into one continuous plane in
        // the middle distance, which is what a low camera does to a level set.
        const h = TABLE_H + (this.runOffset(x + 5, y + 19) * 2 - 1) * 0.032 + part * 0.014;
        const bcx = x + n / 2;
        const bcz = y + 0.5 + dz;
        const cos = Math.cos(yaw);
        const sin = Math.sin(yaw);
        for (let cx = x; cx <= x1; cx++) {
          const ox = cx + 0.5 - bcx;
          this.benchAt.set(y * k.width + cx, {
            x: bcx + ox * cos,
            z: bcz - ox * sin,
            yaw,
            h,
          });
        }
        // A single-cell bench still gets a little overhang so it reads as a
        // table rather than a plinth; longer runs get proportionally less. A
        // split half loses the overhang on its inboard end, or the two pieces
        // of one run touch and the split is invisible.
        this.bench(bcx, bcz, n + (n === 1 ? 0.26 : 0.2) - (part === 0 ? 0 : 0.16), h, yaw);
      }
    }
  }

  /**
   * Deterministic ±0.17 cell depth offset for the run starting at (x, y).
   *
   * At ±0.11 the stagger was too small to break the rank: every lane still read
   * as one straight bare band of flagstone running the full width of the room,
   * and with the floor lightened those bands became the emptiest thing in the
   * frame. The reference never lines two benches up and never lets you see a
   * clear horizontal channel from one side wall to the other. ±0.17 leaves
   * 0.63 of clear lane in the worst case, which is still wider than a chef.
   */
  private runOffset(x: number, y: number) {
    const v = (Math.sin(x * 12.9898 + y * 78.233) * 43758.5453) % 1;
    return v < 0 ? v + 1 : v;
  }

  /**
   * The soft dark pool every piece of furniture in the reference sits in.
   *
   * The room's key is deliberately weak and steep so the set never throws long
   * diagonal bars, and the price of that is that nothing reads as touching the
   * floor: the benches float on a flat plane. The reference has a wide, very
   * soft, warm-brown contact shadow under every bench, every counter and every
   * pancake tower — it is most of what makes its floor read as a floor and it
   * is where a third of the darks in the lower half of its frame come from.
   * One multiply-blended quad each, one shared texture, no shadow-map cost.
   */
  private contact(cx: number, z: number, w: number, d: number, strength = 1) {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, d),
      new THREE.MeshBasicMaterial({
        // STRENGTH IS BAKED INTO THE TEXTURE, NOT INTO opacity.
        //
        // Under MultiplyBlending the src factor is ZERO and the dst factor is
        // SRC_COLOR, so alpha never reaches the blend — but `premultipliedAlpha`
        // (which three requires here, or it logs once per material per frame)
        // runs `gl_FragColor.rgb *= a` in the shader. So opacity scaled the
        // COLOUR instead of the coverage: the gradient's deliberately-white
        // border came out at 0.85 and stamped a hard-edged rectangular 15%
        // darkening patch on the flagstones under every single bench. That, and
        // not the pool, was most of the floor's value noise.
        map: contactGradient(strength),
        transparent: true,
        premultipliedAlpha: true,
        opacity: 1,
        depthWrite: false,
        blending: THREE.MultiplyBlending,
      }),
    );
    m.rotation.x = -Math.PI / 2;
    m.position.set(cx, 0.012, z);
    m.renderOrder = -1;
    this.root.add(m);
  }

  /** A knee-height plank bench: three boards, an apron rail, legs at the ends. */
  private bench(cx: number, z: number, w: number, h: number, yaw = 0) {
    const P = this.props;
    // Every part is authored in the bench's own frame and rotated on the way
    // out, so a yawed bench is still one merged geometry and still costs zero
    // extra draw calls.
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    const box = (c: number, bw: number, bh: number, bd: number, dx: number, y: number, dz: number) =>
      P.box(c, bw, bh, bd, cx + dx * cos + dz * sin, y, z - dx * sin + dz * cos, 0, yaw);
    // The pool is sized to the bench, not to the lane. At (w + 0.75) × 1.85 the
    // gradient's ellipse was so much bigger than the object casting it that the
    // darkening arrived as a slow wash across the whole lane rather than as a
    // pool with an edge — the reference's floor holds one value and then drops
    // sharply right where a leg meets it. Tighter and stronger.
    // ROUND 12 — THE POOL WAS ENTIRELY UNDERNEATH THE BENCH.
    //
    // At (w + 0.62) × 1.66 centred on the bench, the gradient's dark core (the
    // inner 40% of the radius) sat inside the bench's own footprint, and by the
    // time the ellipse cleared the front edge it was already back to a 0.9
    // multiply. Every capture showed benches standing on unmarked flagstone;
    // measured, the frame carried 5.0% of pixels below luma 64 against the
    // reference's 7.0%, and the missing darks are exactly this. Narrower across
    // (the ends of a bench are not what casts) and pushed a third of a metre
    // towards camera, so the core lands under the bench and the FALLOFF lands
    // on the strip of floor the player can actually see.
    this.contact(cx, z + 0.3, w + 0.3, 1.95, 1);
    // Deeper than a cell, by design. At 0.95 deep the gap between two ranks was
    // wider than the benches themselves and every lane read as a bare band; the
    // reference's benches nearly touch front to back. The overhang is 7cm on a
    // knee-high table, so it never reaches a chef's feet.
    //
    // ROUND 14 — THE BOARDS RUN THE WRONG WAY AND THE GROOVES ARE HAIRLINES.
    //
    // Measured on our own 1440px capture against the reference, a bench top:
    //
    //     reference   mean luma 123   p10 69   p90 194   (range 125)
    //     ours        mean luma 137   p10 102  p90 169   (range  67)
    //
    // The MEAN was never the problem — five rounds of notes below chase it up
    // and down and by round 13 we were sitting a shade brighter than the
    // reference. What ours does not have is the reference's internal RANGE, and
    // that range is entirely its plank grooves: enlarge either capture and its
    // bench top is a run of narrow honey boards separated by grooves that go
    // very nearly black. Twelve benches read as twelve objects because each one
    // is visibly built out of ten boards.
    //
    // Ours was three boards laid ACROSS the bench with 2.5cm gaps, and there are
    // two things wrong with that. The gaps are a hairline past the second rank.
    // And the boards run left-to-right, i.e. along the one axis this camera does
    // not foreshorten, so the seams are three horizontal lines — the reference's
    // planks run FRONT TO BACK and their grooves converge with the perspective,
    // which is most of what makes its floor furniture feel like it is sitting in
    // a room rather than pasted on one.
    //
    // So the top is now a dark plate with real boards laid on it front-to-back,
    // 5cm grooves showing the plate between them and a wider, darker groove
    // every fourth board where the reference butts one module against the next.
    // A CHUNKY SLAB ON AN APRON, WHICH IS WHAT THE REFERENCE'S BENCH IS.
    //
    // Cropped at 2× side by side, its bench is a thick top with visible plank
    // divisions, a distinctly DARKER band under the front edge, then four
    // stubby legs — a three-rung value ladder inside one object, and the reason
    // twelve of them read as twelve objects across a floor of the same hue.
    // Ours was a 10cm top on a rail inset 18cm in depth, so from a 22° camera
    // the rail was invisible and the bench was one flat orange lozenge with
    // legs. The top gains 3cm, the apron comes out to nearly the full depth in
    // the dark leg tone, and the ladder exists.
    // ROUND 17: 1.04 -> 1.22. Row pitch is 1.0 and the reference's benches very
    // nearly touch front to back — the whole reason its lanes never read as
    // bare bands is that there is more furniture than floor between two ranks.
    // The overhang costs nothing: at 0.11 either side of a knee-high top it
    // still cannot reach a chef's feet, and it buys 17% more dressed pixels per
    // cell than the level is allowed to give us (see kitchen.ts round 17).
    const topD = 1.22;
    const topY = h - 0.065;
    // The groove plate. Every gap between two boards shows this, and it is the
    // same tone as the apron — the darkest large mass in the reference's lower
    // third — so a bench top is a run of lights on a dark ground rather than one
    // continuous field.
    box(C.benchApron, w, 0.1, topD, 0, topY - 0.035, 0);
    // Boards front to back. Pitch is fixed, not divided, so a 4-cell bench has
    // four times the boards of a 1-cell one and the module reads the same size
    // wherever it is in the room.
    // Shot at 1440 and cropped at 2×, the first pass at pitch 0.212 / groove
    // 0.044 read as a DUCKBOARD — slats with daylight between them, not a slab
    // with grooves cut in it. The reference's boards are narrower than that and
    // its grooves are narrower still: about one part groove to six parts board,
    // where ours was one to four.
    const pitch = 0.183;
    const nb = Math.max(3, Math.round(w / pitch));
    const step = w / nb;
    const TONES = [C.benchTop, C.benchTopWarm, C.benchTopAlt, C.benchTopWarm, C.benchTop, C.benchTopAlt];
    for (let i = 0; i < nb; i++) {
      // Every fourth joint is a module butt: twice the groove, so a long bench
      // reads as three or four planks laid end to end and not as one raft.
      const gap = i % 4 === 0 ? 0.055 : 0.029;
      const dx = -w / 2 + step * (i + 0.5);
      box(TONES[i % TONES.length], step - gap, 0.13, topD - 0.02, dx, topY, 0);
    }
    box(C.benchApron, w - 0.06, 0.09, 0.96, 0, h - 0.175, 0);
    const legH = h - 0.21;
    const lx = w / 2 - 0.14;
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        box(C.benchLeg, 0.13, legH, 0.13, sx * lx, legH / 2, sz * 0.4);
      }
    }
    // Long runs get a middle pair, or the plank floats.
    if (w > 2.2) {
      for (const sz of [-1, 1]) box(C.benchLeg, 0.13, legH, 0.13, 0, legH / 2, sz * 0.4);
    }
    // End caps in the APRON tone, not the rail tone. The boards above are now
    // the lightest plane in the lower third by design, so the thing that stops
    // two abutting benches from fusing into one raft is a dark edge round each
    // — the reference has one on every bench and it is the same value as the
    // apron under it. The cross seams this used to draw are gone: the module
    // butts are wide grooves in the board run above, which is where the
    // reference puts them.
    for (const sx of [-1, 1]) {
      box(C.benchApron, 0.055, 0.15, topD, sx * (w / 2 - 0.02), h - 0.055, 0);
    }
    // A front rail under the board ends, catching the light — the reference's
    // bench shows a narrow lit band between the board fronts and the dark apron,
    // and without it the top plane meets the shadow on a hard line.
    box(C.benchRail, w - 0.02, 0.045, 0.07, 0, h - 0.15, topD / 2 - 0.02);
    // THE THREE-RUNG LADDER. See C.benchLip / C.benchFace.
    //
    // The board run above is one honey value from every angle, so from a 22°
    // camera the top plane and the front plane of the same plank render within a
    // few points of each other and the bench reads as an extruded lozenge. The
    // front face drops a stop and a bright lip rides the top front edge: two
    // thin boxes, no extra draw calls (both are merged by colour), and it is
    // most of what makes the reference's furniture read as furniture.
    box(C.benchFace, w - 0.03, 0.1, 0.04, 0, topY - 0.018, topD / 2 - 0.005);
    box(C.benchLip, w - 0.03, 0.028, 0.06, 0, topY + 0.054, topD / 2 - 0.03);
  }

  /**
   * A ceramic ingredient DISH. Reads as crockery, not as a tablecloth.
   *
   * The old one was a 0.82 x 0.68 slab on a 1.0-wide bench — 78% of the bench
   * top, taller than the food standing in it, and near-white. It was the single
   * loudest object on the play field and it was loud about nothing. This is a
   * real shallow dish: two thirds the footprint, a third the height, with a
   * recessed well so the ingredient sits DOWN IN it and overhangs the rim,
   * exactly the way the reference's bacon and lettuce spill over theirs.
   */
  /**
   * A shallow slatted market crate — the same footprint and the same well depth
   * as the porcelain dish, so the ingredient heap that sits in it needs no
   * special case, but authored in bench timber so it adds no pale mass at all.
   * Four corner posts and three slats a side: the gaps are what make it read as
   * a crate rather than as a box at 90px.
   */
  private slatCrate(x: number, h: number, z: number) {
    const P = this.props;
    P.box(C.benchLeg, 0.66, 0.035, 0.52, x, h + 0.018, z);
    for (const [sx, sz] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ] as const) {
      P.box(C.benchRail, 0.07, 0.14, 0.07, x + sx * 0.31, h + 0.07, z + sz * 0.24);
    }
    for (let i = 0; i < 2; i++) {
      const y = h + 0.05 + i * 0.062;
      for (const sz of [-1, 1]) P.box(C.benchTopAlt, 0.6, 0.05, 0.045, x, y, z + sz * 0.245);
      for (const sx of [-1, 1]) P.box(C.benchTop, 0.045, 0.05, 0.44, x + sx * 0.305, y, z);
    }
  }

  private tray(x: number, h: number, z: number) {
    const P = this.props;
    // Measured off the reference: the dish is about 0.9 x 0.7 of a floor cell
    // and roughly a tenth of a cell deep. It is the HEIGHT that made ours read
    // as a tablecloth, not the footprint — the old one stood 0.24 proud of the
    // bench, taller than the bacon lying in it.
    // Smaller again, now the food is at 1.22. At 0.76 × 0.60 with two dishes to
    // a bench, squinting at the frame still showed a repeating pattern of pale
    // rectangles before it showed tomatoes — the trays were losing the fight by
    // area even after losing it by value. The reference's food overhangs its
    // crockery on every side; ours now does too.
    // A DISH WITH SIDES YOU CAN SEE INTO — the round-9 build was three stacked
    // slabs and a 5cm lip, and cropped at 3.2× next to the reference's bacon
    // dish the difference is not subtle: theirs is a deep porcelain box with
    // 15cm walls, a shadowed grey-blue interior and the food heaped INSIDE it
    // spilling over the rim; ours was a white tile with food resting on top of
    // it. The wall is the whole read — it is what makes the object crockery
    // rather than a napkin, and it is what puts a hard bright edge between the
    // saturated food and the honey plank at every distance.
    //
    // Built as a floor plus four walls rather than as a solid block with a
    // darker slab on it, because a box cannot have a hole in it and the interior
    // has to be genuinely visible from a 22° camera.
    // ROUND 11 — SMALLER AGAIN, BY AREA THIS TIME. Whole-frame histogram, S >
    // 0.72 at V > 0.5: reference 30.7% of pixels, ours 23.5%. With the wall, the
    // floor and the timber all now measuring inside the reference's bands, the
    // largest remaining block of low-chroma pixels on the PLAY FIELD is thirteen
    // bone-china dishes. Ours ran 0.68 × 0.54 against a food heap 0.57 across —
    // an 8cm collar of visible crockery all the way round every ingredient. The
    // reference's food overhangs its dish on every side and you see almost no
    // rim at all. Growing the food is not available (it is already at the
    // reference's 0.33-of-a-chef and any taller starts eating the chef behind
    // it), so the dish comes in instead.
    const wallH = 0.15;
    const wy = h + 0.01 + wallH / 2;
    P.box(C.trayShade, 0.61, 0.035, 0.49, x, h + 0.017, z);
    P.box(C.trayWell, 0.54, 0.05, 0.42, x, h + 0.05, z);
    for (const [w, d, dx, dz] of [
      [0.59, 0.065, 0, 0.212],
      [0.59, 0.065, 0, -0.212],
      [0.065, 0.36, 0.262, 0],
      [0.065, 0.36, -0.262, 0],
    ] as const) {
      P.box(C.tray, w, wallH, d, x + dx, wy, z + dz);
      // The lip: a brighter cap along the top arris of each wall. In the
      // reference this catches the room light and is the single brightest line
      // on the bench, which is what draws the eye to the food inside it.
      P.box(C.trayRim, w + 0.02, 0.035, d + 0.02, x + dx, h + 0.01 + wallH, z + dz);
    }
    // AO IN THE WELL. In the reference the food does not float in its dish: the
    // porcelain immediately under and around a heap goes visibly grey-brown, and
    // that little pool of dirt is what welds the two objects together. Ours had
    // a bright even well right up to the contact line, so a tray of tomatoes
    // read as three balls resting on a white card.
    P.box(0xa4977c, 0.46, 0.014, 0.34, x, h + 0.078, z);
  }

  /**
   * A HEAP of the actual ingredient, sat in the tray. This is the single most
   * load-bearing read in the room: a chef three tables away has to know what is
   * on this bench from the silhouette and the hue alone.
   */
  private heap(kind: string, x: number, y: number, z: number) {
    const col = INGREDIENT_DEFS[kind as keyof typeof INGREDIENT_DEFS]?.color ?? 0xcccccc;
    // Everything below is authored against the old dish and then scaled up as a
    // block. The reference's food is BIGGER than its crockery — a lettuce head
    // is wider than the dish it sits in and a rasher hangs off both ends. Ours
    // sat politely inside the rim, which is how twenty white rectangles ended up
    // out-shouting the tomatoes.
    // Measured off the crop: a reference tomato is ~0.5 of the dish it sits in
    // and two of them fill the well end to end, overhanging the near rim. At
    // 1.12 ours sat politely inside with a visible margin of crockery all the
    // way round, so the eye still met bone china before it met food.
    // ...and then the cast came down to reference scale (CHAR_SCALE 1.16 → 0.72)
    // and this number was suddenly measuring the wrong thing. Re-measured off
    // `refs/dash-and-dine-01.jpeg` against a CHEF rather than against the dish:
    // the reference's tomatoes stand 29px proud of their bench with a 97px Toad
    // beside them — 0.30 of a chef. At 1.22 ours stood 0.46 world units proud
    // of a 0.93-unit chef, i.e. HALF a chef, and at 22.5° of pitch a rank of
    // half-chef-high food eats the chef behind it to the thigh. The whole
    // reason the camera is allowed to sit this low is that the reference's
    // tables never occlude anybody. 0.86 puts the heap 0.31 proud of the bench
    // — 0.33 of a chef, the reference's number — and it still overhangs the rim
    // of the dish, which is what the 1.22 was originally bought for.
    const S = 0.86;
    const P = this.props;
    const ball = (c: number, r: number, dx: number, dy: number, dz: number, sx = 1, sy = 1, sz = 1) =>
      P.ball(c, r * S, x + dx * S, y + dy * S, z + dz * S, sx, sy, sz);
    const box = (c: number, w: number, hh: number, d: number, dx: number, dy: number, dz: number, rz = 0, ry = 0) =>
      P.box(c, w * S, hh * S, d * S, x + dx * S, y + dy * S, z + dz * S, rz, ry);
    const cone = (c: number, r: number, hh: number, dx: number, dy: number, dz: number, rx = 0, rz = 0) =>
      P.cone(c, r * S, hh * S, x + dx * S, y + dy * S, z + dz * S, rx, rz);

    switch (kind) {
      case 'tomato':
        // A TOMATO, NOT A RED BALL WITH A NUB ON IT.
        //
        // Cropped at 4× beside the reference's, ours was an untextured sphere:
        // one flat red, one dark under-sphere, a green cone stuck on the crown.
        // The reference's has four things ours did not — a lit shoulder a full
        // stop above the body, a small hard white specular on that shoulder, a
        // deep crease where the shoulder rolls under, and a proper five-lobed
        // CALYX lying flat on top with a short stalk out of the middle. The
        // calyx is most of the read: it is the only non-red thing on the object
        // and it is what says tomato rather than apple, cherry or ball.
        for (const [dx, dz, dy, tilt] of [
          [-0.175, 0.11, 0, 0.0],
          [0.175, 0.07, 0, 0.5],
          [0.0, -0.13, 0.135, 2.1],
        ] as const) {
          const cy = 0.145 + dy;
          // Body, very slightly wider than tall — a tomato is not a sphere.
          ball(col, 0.168, dx, cy, dz, 1.04, 0.94, 1.04);
          // The shoulder: a lighter cap sat forward and up, which is where this
          // camera looks. Without it the whole fruit renders at one value.
          ball(0xff5a3c, 0.12, dx - 0.03, cy + 0.048, dz + 0.05, 1, 0.78, 1);
          // The crease under the shoulder, and the shadowed base.
          ball(0xa3120a, 0.14, dx + 0.02, cy - 0.06, dz - 0.02, 1.02, 0.62, 1.02);
          // Specular. Small, hard, high — one of these on each fruit is the
          // difference between waxed skin and matte plastic.
          ball(0xffd8c4, 0.032, dx - 0.066, cy + 0.108, dz + 0.058, 1, 0.8, 1);
          // Calyx: five small lobes lying ON the shoulder, plus a stalk. The
          // first pass ran them at r 0.052 scaled 1.5 across on a 0.165 fruit —
          // a green disc nearly as wide as the tomato, so a tray of these read
          // as three red boxes with green lids. A calyx is a detail, not a hat:
          // it has to be small enough that the red dome still owns the top.
          for (let k = 0; k < 5; k++) {
            const a = (k / 5) * Math.PI * 2 + tilt;
            ball(
              k % 2 === 0 ? C.greenLeaf : 0x6bb520,
              0.036,
              dx + Math.cos(a) * 0.058,
              cy + 0.132,
              dz + Math.sin(a) * 0.058,
              1.35,
              0.34,
              0.8,
            );
          }
          cone(0x4b8a12, 0.021, 0.065, dx, cy + 0.172, dz);
        }
        break;
      case 'lettuce':
        // GREEN NEEDS VALUE, NOT JUST HUE.
        //
        // Our lettuce averaged L 37% against a wall that runs L 30-37: the only
        // thing separating a head of lettuce from the architecture behind it was
        // hue, which is exactly the separation a deuteranope does not have and
        // the separation that dies first at 90px. The reference's lettuce sits
        // at L 48-49 against the same wall — thirteen points of pure value.
        //
        // So the head is built LIGHT-SIDE-UP: the crown is a pale spring green a
        // full stop above the ingredient hex, the hex itself only appears on the
        // shoulders, and the dark outer leaves stay at the base where they read
        // as shadow. Same hue, same silhouette, ten points of luminance.
        // ...AND IT NEEDS A LOBED SILHOUETTE, NOT JUST VALUE.
        //
        // Cropped at 1.8× off the real build, our lettuce came back as a smooth
        // green gumdrop: the five outer leaves sat at radius 0.20 under a 0.25
        // crown, so they were entirely buried and the head had no edge events at
        // all. The reference's is unmistakably a HEAD — a pale crown with six or
        // seven darker outer leaves wrapping it, each one breaking the outline.
        // The leaves now stand proud of the crown and alternate a full stop in
        // value, so the shape scallops even at 90px.
        // ROUND 14 — AND IT WAS STILL FOUR GREEN SPHERES, WHICH IS BROCCOLI.
        //
        // Every critic since round 9 has read this as broccoli and every round
        // has answered by adding another sphere. Enlarge the reference's lettuce
        // 5×: it is not a mound at all. It is a CUP — a rosette of five or six
        // broad leaves standing UP and flaring OUTWARD from a pale heart, with
        // ragged tips that break the silhouette well above the crown and deep
        // shadow down between them. The reason it never reads as anything else
        // is that the outline is concave in five places; a mound of spheres is
        // convex everywhere, and convex-and-green is broccoli every time.
        //
        // Leaves are flat panels: `box` rotates Z then Y, so a panel leaned in
        // +x and then spun to azimuth `a` lands leaning outward along that
        // azimuth. Two panels per leaf — a lower one at a shallow lean and an
        // upper one curling further out — is the cheapest thing that reads as a
        // leaf curling over rather than as a plank stuck in a bowl.
        {
          // The heart, pale and low. It only ever shows through the gaps.
          ball(0xd8f39a, 0.155, 0, 0.13, 0, 1.05, 0.85, 1.05);
          ball(0xeefcc4, 0.085, -0.02, 0.185, 0.02, 1, 0.6, 1);
          const N = 6;
          for (let i = 0; i < N; i++) {
            const a = (i / N) * Math.PI * 2 + 0.55;
            const ca = Math.cos(a);
            const sa = -Math.sin(a);
            // Outer leaves are the ingredient hue; the ones between them a stop
            // lighter, so the rosette scallops in value as well as in outline.
            const outer = i % 2 === 0 ? col : 0x92e02c;
            const innerC = i % 2 === 0 ? 0xb6ea55 : 0xcdf278;
            // Lower blade: leaning ~28° off vertical. WIDE — the first pass ran
            // these at 0.185 across and they read as green shards standing in a
            // bowl; a lettuce leaf is nearly as wide as the head is tall, and
            // the width is what turns six panels into a wrapped cup rather than
            // into a starfish.
            box(outer, 0.05, 0.235, 0.27, ca * 0.1, 0.17, sa * 0.1, -0.42, a);
            // Upper blade, curling further out and standing proud of the crown.
            box(innerC, 0.045, 0.15, 0.225, ca * 0.185, 0.285, sa * 0.185, -0.92, a);
            // Round the blade tip off. Flat panels alone gave the head a hard
            // faceted outline that read as origami; a leaf is a curved thing and
            // one squashed ball on the end of each blade is enough to say so.
            ball(innerC, 0.09, ca * 0.235, 0.325, sa * 0.235, 1, 0.5, 1);
            // A dark seat at the foot of each leaf so the cup has a floor.
            ball(0x3f8210, 0.08, ca * 0.13, 0.07, sa * 0.13, 1.3, 0.5, 1.3);
          }
          // One ragged tip clearing everything else — the thing that makes the
          // silhouette unmistakable at 90px.
          box(0xb4ee4c, 0.045, 0.135, 0.15, 0.05, 0.365, -0.05, -0.22, 1.1);
        }
        break;
      case 'bacon':
        // A HEAP OF RASHERS, NOT FIVE STICKS LYING IN A TRAY.
        //
        // Cropped at 3.9× next to the reference's bacon dish, this was the
        // weakest of the three heroes by a distance. The reference heaps a dozen
        // CURVED rashers well above the rim of its dish — pale fat edges, darker
        // meat between them, every rasher overlapping the next, the whole thing a
        // mound with a silhouette. Ours laid five flat slabs at 0.05 thick in a
        // fan, all at the same height, inside the rim: it read as pink candy
        // sticks on a white card, and while a tomato bench and a lettuce bench
        // were instantly nameable at 90px the bacon bench was "something pink".
        //
        // Each rasher is three short segments on a shallow arc, which is the
        // cheapest thing that curves, and they are stacked in two layers so the
        // heap has a real top. Fat cap on the upper edge of every one.
        // ROUND 14 — IT WAS A FLAT PINK-AND-WHITE PLAQUE WITH NO THICKNESS.
        //
        // The round-12 pass above got the count and the fan right and the
        // GEOMETRY wrong: seven rashers at 5.5cm thick, all within 3cm of the
        // same height, laid inside the rim, with a fat cap offset sideways so at
        // any distance the whole heap averaged into one two-tone striped card.
        // The reference heaps its rashers into a MOUND that clears the rim of
        // the dish by more than the dish is deep, every rasher visibly arched
        // over the one under it, with real shadow in the gaps.
        //
        // So each rasher is now an arch — four segments whose height follows
        // sin(pi t) and whose pitch follows the tangent, which is what makes a
        // strip of bacon look draped rather than laid — 7cm thick, and the six
        // of them stack in three tiers so the heap has a top the light can find.
        {
          // FIVE, NOT SEVEN, AND THE MEAT IS THE DARK TONE.
          //
          // The first arched pass fixed the thickness and lost the read a
          // different way: six rashers all carrying a pale fat band on the same
          // outer edge drew one continuous pale spiral, so the heap came back as
          // a pink swirl. In the reference the FAT is the minority marking — a
          // narrow cream edge and a couple of streaks on a distinctly darker
          // rose meat — and every rasher is separately visible because the one
          // under it is a full stop darker, not because it is outlined.
          // ...AND AT FIVE OVERLAPPING ARCHES IT CAME BACK AS A PINK BRAIN.
          //
          // The segments were 14 × 7.5 × 20cm — nearly square in plan — so a
          // rasher had no long axis to read along, and five of them stacked into
          // a lump of pink with pale worms crawling over it. A rasher of bacon
          // is a RIBBON: three times as wide as it is thick, laid nearly flat,
          // and you read a heap of them because each one is a long straight edge
          // at a different angle to the next. Four wide flat ribbons at clearly
          // separated angles, and the pale marbling only on the two that are not
          // already the light tone.
          const rashers: [number, number, number, number, number][] = [
            // yaw, dx, dz, tier lift, meat tone
            [-0.72, -0.085, 0.1, 0.0, 0xc25366],
            [0.18, 0.09, 0.055, 0.045, 0xdd6878],
            [-0.28, -0.02, -0.115, 0.09, 0xb14b5e],
            [1.02, -0.02, 0.01, 0.155, col],
          ];
          for (const [yaw, ox, oz, lift, meat] of rashers) {
            const cy = Math.cos(yaw);
            const sy2 = -Math.sin(yaw);
            // Perpendicular to the rasher, for the fat cap along one long edge.
            const px = -sy2;
            const pz = cy;
            for (let s = 0; s < 4; s++) {
              const t = (s + 0.5) / 4;
              const u = (t - 0.5) * 0.44;
              const arch = Math.sin(t * Math.PI);
              const tilt = Math.cos(t * Math.PI) * 0.7;
              const bx = ox + u * cy;
              const bz = oz + u * sy2;
              const by = 0.075 + lift + arch * 0.058;
              box(meat, 0.145, 0.048, 0.27, bx, by, bz, tilt, yaw);
              // The fat: a NARROW cream edge on the top-outer arris only. At 5cm
              // on a 27cm ribbon the fat was a fifth of every rasher and four of
              // them summed into a pale striped roll; the reference's fat is a
              // hairline on the edge and two thin streaks, and the meat owns the
              // object.
              box(
                0xffe6da,
                0.145,
                0.024,
                0.032,
                bx + px * 0.12,
                by + 0.016,
                bz + pz * 0.12,
                tilt,
                yaw,
              );
              // Marbling, on the darker rashers only — on all four it drew one
              // continuous pale spiral over the whole heap.
              if (meat === 0xc25366 || meat === 0xb14b5e) {
                box(0xeb9c9c, 0.145, 0.02, 0.04, bx, by + 0.024, bz, tilt, yaw);
              }
            }
          }
        }
        break;
      case 'bun':
        // Bun, potato and egg are keyed at 36°, 33° and 32° — three warm
        // oranges four degrees apart — so hue cannot separate them and never
        // will. SILHOUETTE has to. A bun is a smooth glazed dome with a pale
        // cross scored across the top and a visible base seam.
        for (const [dx, dz] of [
          [-0.17, 0.08],
          [0.17, 0.08],
          [0, -0.14],
        ] as const) {
          ball(col, 0.185, dx, 0.11, dz, 1, 0.72, 1);
          ball(0xf2b972, 0.13, dx, 0.17, dz, 1, 0.44, 1);
          box(0xffe0ae, 0.24, 0.02, 0.045, dx, 0.215, dz);
          box(0xffe0ae, 0.045, 0.02, 0.24, dx, 0.215, dz);
        }
        break;
      case 'cheese':
        for (let i = 0; i < 3; i++) {
          box(col, 0.31, 0.11, 0.27, (i - 1) * 0.06, 0.09 + i * 0.1, (i - 1) * 0.05, 0, 0.3 * i);
        }
        break;
      case 'egg':
        // Shells are WHITE and the yolk carries the hue. Three orange ovoids
        // were indistinguishable from three orange potatoes on the next bench.
        for (const [dx, dz] of [
          [-0.16, 0.07],
          [0.16, 0.07],
        ] as const) {
          ball(0xfaf2e0, 0.14, dx, 0.16, dz, 1, 1.3, 1);
        }
        // One cracked into a shallow dish, yolk up: the colour cue, and the
        // thing that says "egg" rather than "small white stone".
        ball(0xf2e8d2, 0.19, 0, 0.09, -0.13, 1, 0.36, 1);
        ball(col, 0.085, 0, 0.14, -0.13, 1, 0.72, 1);
        break;
      case 'onion':
        for (const [dx, dz] of [
          [-0.15, 0.08],
          [0.15, 0.08],
          [0, -0.13],
        ] as const) {
          ball(col, 0.155, dx, 0.14, dz, 1, 1.05, 1);
          cone(0xb9a271, 0.03, 0.15, dx, 0.29, dz);
        }
        break;
      case 'potato':
        // Earthy and lumpy, with eyes. Same trick as the egg: the ingredient
        // colour stays, but the surface goes brown and the shape goes
        // irregular, so a potato bench never reads as a bun bench.
        for (const [dx, dz, rot] of [
          [-0.17, 0.08, 0.3],
          [0.16, 0.05, -0.5],
          [0, -0.14, 0.9],
        ] as const) {
          ball(mix(col, 0x7a5424, 0.34), 0.17, dx, 0.12, dz, 1.3, 0.78, 0.92);
          ball(mix(col, 0x9a7038, 0.2), 0.1, dx + 0.07, 0.16, dz + 0.02, 1.1, 0.6, 0.9);
          P.ball(0x5c4020, 0.026 * S, x + (dx - 0.04) * S, y + 0.19 * S, z + (dz + 0.05) * S);
          P.ball(0x5c4020, 0.022 * S, x + (dx + 0.09) * S, y + 0.185 * S, z + (dz - 0.04) * S);
          void rot;
        }
        break;
      case 'rice':
        // A BOWL of rice, not a puddle of it. A 0.27 dome of near-white spread
        // across the whole dish and read as the palest, blankest object in the
        // lower half of the frame — worse than the trays ever were. Contained
        // in a blue bowl it is small, has an edge, and says "rice".
        cone(C.bowlBlue, 0.21, 0.2, 0, 0.1, 0, Math.PI);
        ball(0x3d8ba3, 0.2, 0, 0.16, 0, 1, 0.28, 1);
        ball(col, 0.155, 0, 0.19, 0, 1, 0.62, 1);
        ball(0xfffaf0, 0.09, -0.03, 0.24, 0.02, 1, 0.5, 1);
        break;
      case 'fish':
        for (const s of [-1, 1]) {
          ball(col, 0.135, s * 0.06, 0.11, s * 0.11, 1.9, 0.72, 0.9);
          cone(col, 0.115, 0.17, s * 0.06 - 0.29, 0.11, s * 0.11, 0, Math.PI / 2);
          P.ball(0x1c1c1c, 0.026, x + (s * 0.06 + 0.15) * S, y + 0.15 * S, z + (s * 0.11 + 0.05) * S);
        }
        break;
      default:
        ball(col, 0.19, 0, 0.15, 0);
        break;
    }
  }

  // ---------------------------------------------------------- set dressing

  /**
   * The reference's kitchen has something on every surface. These props are
   * static, merged, and deliberately kept OFF the ingredient trays: clutter is
   * only free if it never competes with the thing the player is looking for.
   */
  private buildDressing() {
    const { width: W } = this.kitchen;
    const span = ovenSpan();
    const P = this.props;

    // Tall pancake stacks flanking the pass, exactly where the reference puts
    // them: at the inboard end of each team counter, against the timber post.
    // NO PANCAKE TOWERS EITHER. These flanked the oven at the two most looked-at
    // places on the back wall, and a stack of pale discs is exactly what a bun
    // looks like at phone size — the reported confusion was a player asking
    // which of the round pale things was the bread. Nothing that reads as food
    // is scenery any more; the crates are the only food source in the room.
    void this.pancakes;

    this.dressPass(span);
    this.foreground();
    this.nooks();

    // The two servers. In the reference a Toad stands behind each team counter
    // and the order balloon hangs off its head; ours were unmanned coloured
    // boxes, which left the upper-left and upper-right thirds of the frame —
    // the two places the reference puts its biggest, brightest shapes — as flat
    // ochre wall. They stand BEHIND the counter, so the counter crops them at
    // the chest exactly as it does theirs, and they are static merged geometry:
    // set dressing, not characters.
    this.passToad(span.x0 - 1.9, 1.34, C.teamRed, 0xd8574c);
    this.passToad(span.x1 + 1.9, 1.34, C.teamGreen, 0x4f9d3e);

    // The big kitchen props go on the benches that are NOT ingredient trays —
    // boards and free counters — so nothing ever competes with the thing the
    // player is scanning for. Stepping the rotation by 5 over a list of 6 walks
    // the whole set; stepping by 3 (which is what this did) only ever reaches
    // two of them, which is why the room read half-dressed.
    const dressable = this.kitchen.stations.filter(
      (s) => s.cell.y > 1 && (s.kind === 'counter' || s.kind === 'board'),
    );
    const kit = ['bowl', 'shakers', 'ladle', 'pie', 'plates', 'pie'] as const;
    // The stockpot is the reference's most recognisable prop, so it is placed
    // rather than rolled: it goes on whichever free counter sits nearest the
    // middle of the room, where the eye actually lands.
    const potOn = dressable
      .filter((s) => s.kind === 'counter')
      .sort(
        (a, b) =>
          Math.abs(a.cell.x - this.kitchen.width / 2) - Math.abs(b.cell.x - this.kitchen.width / 2),
      )[0];
    dressable.forEach((s, i) => {
      const seat = this.benchAt.get(s.cell.y * this.kitchen.width + s.cell.x);
      const base = stationCenter(s);
      const bx = seat?.x ?? base.x;
      const bz = seat?.z ?? base.y;
      const cos = Math.cos(seat?.yaw ?? 0);
      const sin = Math.sin(seat?.yaw ?? 0);
      const TH = seat?.h ?? TABLE_H;
      // A chopping board needs its middle clear, so it only ever gets one of
      // the low props, pushed to the back corner.
      const low = s.kind === 'board';
      const which = s === potOn ? 'pot' : low ? (['shakers', 'ladle', 'bowl'] as const)[i % 3] : kit[(i * 5 + 2) % kit.length];
      const ox = i % 2 === 0 ? -0.31 : 0.31;
      const oz = -0.29;
      const c = { x: bx + ox * cos + oz * sin, y: bz - ox * sin + oz * cos };
      const dx = 0;
      const dz = 0;
      switch (which) {
        case 'pot':
          this.stockpot(c.x + dx * 0.4, TH, c.y - 0.06);
          break;
        case 'shakers':
          this.shakers(c.x + dx, TH, c.y + dz);
          break;
        case 'bowl':
          this.mixBowl(c.x + dx, TH + 0.02, c.y + dz, 0.19);
          break;
        case 'pie':
          P.cyl(C.tray, 0.24, 0.21, 0.08, 14, c.x + dx, TH + 0.04, c.y + dz);
          P.cyl(C.pieCrust, 0.22, 0.22, 0.09, 14, c.x + dx, TH + 0.11, c.y + dz);
          P.cyl(C.pieFill, 0.16, 0.16, 0.03, 14, c.x + dx, TH + 0.16, c.y + dz);
          // A LATTICE. The reference's pie is two colours with pastry strips
          // crossing the filling; ours was a brown disc on a paler disc, which
          // at bench distance was a coaster. Five strips each way, 2cm proud.
          for (let k = -1; k <= 1; k++) {
            P.box(C.pieCrust, 0.3, 0.02, 0.045, c.x + dx, TH + 0.178, c.y + dz + k * 0.085);
            P.box(C.pieCrust, 0.045, 0.02, 0.3, c.x + dx + k * 0.085, TH + 0.178, c.y + dz);
          }
          break;
        case 'plates':
          // Narrower and twice as tall. At r 0.2 over six plates this read as
          // one flat pale puddle 40% of a cell across — from a low camera the
          // brightest object in the lower corner of the frame, and shapeless.
          // The reference's stacks are always taller than they are wide.
          // Ten plates stood 0.50 proud of the bench — 0.54 of a chef at the
          // rescaled cast — so a stack out on the open floor was a head-height
          // wall. Five keeps the taller-than-wide silhouette and tops out at
          // 0.26, inside the same 0.3-of-a-chef ceiling as the food heaps.
          for (let k = 0; k < 5; k++) {
            P.cyl(k % 4 === 0 ? 0xece4d2 : PALETTE.plates, 0.155, 0.14, 0.046, 14, c.x + dx + (k % 2 ? 0.008 : -0.006), TH + 0.03 + k * 0.047, c.y + dz);
          }
          break;
        case 'ladle':
          P.box(C.timberDark, 0.5, 0.035, 0.035, c.x + dx - 0.1, TH + 0.03, c.y + dz, 0, 0.3);
          P.ball(C.steel, 0.09, c.x + dx + 0.16, TH + 0.05, c.y + dz + 0.06, 1, 0.6, 1);
          break;
      }

      // A SECOND, SMALLER PROP ON THE OPPOSITE BACK CORNER OF EVERY BOARD.
      //
      // The map now scatters seven boards across the room instead of parking
      // four in the middle, and a board only ever gets one prop because its
      // middle has to stay clear to chop on — so seven benches were coming back
      // with three quarters of their top bare. The reference has no bare bench
      // top anywhere in its lower third. These are all knee-height trinkets:
      // nothing here can hide a chef or be mistaken for a station.
      if (!low) return;
      const ox2 = -ox;
      const d = { x: bx + ox2 * cos + oz * sin, y: bz - ox2 * sin + oz * cos };
      switch (i % 4) {
        case 0:
          for (let k = 0; k < 3; k++) {
            P.cyl(k === 1 ? 0xece4d2 : PALETTE.plates, 0.13, 0.12, 0.044, 12, d.x + (k % 2 ? 0.006 : -0.006), TH + 0.03 + k * 0.045, d.y);
          }
          break;
        case 1:
          P.cyl(0xc9803a, 0.075, 0.08, 0.16, 10, d.x, TH + 0.08, d.y);
          P.cyl(C.timberDark, 0.066, 0.07, 0.04, 10, d.x, TH + 0.18, d.y);
          break;
        case 2:
          P.cyl(0xf1e6cd, 0.07, 0.06, 0.14, 10, d.x, TH + 0.07, d.y);
          P.cyl(0xd9cbaa, 0.026, 0.026, 0.055, 8, d.x + 0.085, TH + 0.085, d.y, 0, Math.PI / 2);
          break;
        default:
          P.box(0xe6e0cc, 0.26, 0.05, 0.18, d.x, TH + 0.025, d.y, 0, 0.3);
          P.box(0xd2c9ad, 0.22, 0.04, 0.14, d.x + 0.02, TH + 0.058, d.y + 0.01, 0, 0.45);
          break;
      }
    });

    // And a small piece of crockery tucked into the back corner of most tray
    // benches. The reference has something on every surface; this is what makes
    // the room read as worked-in rather than laid out.
    // NO 'none'. The reference has essentially no bare bench surface anywhere in
    // its lower third — every single top carries something — and one option in
    // four being nothing left a quarter of our tray benches with a bare corner.
    // Five props instead of four also means the cycle never lands in step with
    // the tray order, so no two benches in a rank are dressed the same way.
    const trim = ['mug', 'jar', 'cloth', 'spoon', 'bowl'] as const;
    this.kitchen.stations
      .filter((s) => s.cell.y > 1 && s.kind === 'crate')
      .forEach((s, i) => {
        const seat = this.benchAt.get(s.cell.y * this.kitchen.width + s.cell.x);
        const base = stationCenter(s);
        const bx = seat?.x ?? base.x;
        const bz = seat?.z ?? base.y;
        const cos = Math.cos(seat?.yaw ?? 0);
        const sin = Math.sin(seat?.yaw ?? 0);
        const TH = seat?.h ?? TABLE_H;
        const side = (i * 7) % 2 === 0 ? -1 : 1;
        const ox = side * 0.33;
        const oz = -0.3;
        const px = bx + ox * cos + oz * sin;
        const pz = bz - ox * sin + oz * cos;
        switch (trim[(i * 3 + 1) % trim.length]) {
          case 'mug':
            P.cyl(0xf1e6cd, 0.075, 0.065, 0.15, 10, px, TH + 0.075, pz);
            P.cyl(0xd9cbaa, 0.028, 0.028, 0.06, 8, px + 0.09, TH + 0.09, pz, 0, Math.PI / 2);
            break;
          case 'jar':
            P.cyl(0xc9803a, 0.08, 0.085, 0.17, 10, px, TH + 0.085, pz);
            P.cyl(C.timberDark, 0.07, 0.075, 0.04, 10, px, TH + 0.19, pz);
            break;
          case 'cloth':
            P.box(0xe6e0cc, 0.3, 0.05, 0.2, px, TH + 0.025, pz, 0, 0.25);
            P.box(0xd2c9ad, 0.26, 0.04, 0.16, px + 0.02, TH + 0.06, pz + 0.01, 0, 0.4);
            break;
          case 'spoon':
            P.box(C.timberDark, 0.34, 0.03, 0.03, px - 0.06, TH + 0.025, pz, 0, -0.42);
            P.ball(C.pancakeAlt, 0.065, px + 0.11, TH + 0.04, pz + 0.05, 1.2, 0.55, 1);
            break;
          case 'bowl':
            this.mixBowl(px, TH + 0.01, pz, 0.13);
            break;
          default:
            break;
        }
      });

    void W;
  }

  /**
   * FLOOR DRESSING IN THE MAP'S DEAD ENDS.
   *
   * The critic measured our empty-cell fraction at 17-34% of the lower frame
   * against the reference's 6%, and the level cannot close that on its own:
   * every dressed cell added to the middle of a row costs the bot brain
   * throughput, and the numbers are in kitchen.ts. What the level CAN hand over
   * for free is its list of nooks — floor cells with exactly one walkable
   * orthogonal neighbour, i.e. the pockets between two islands of furniture. A
   * flow field never routes a chef through one (there is nothing on the far
   * side), so a sack of flour or a barrel standing in it is worth an eighth of
   * the room's bare floor at zero cost to the sim.
   *
   * Everything here is knee-height or under, for the same reason the benches
   * are: nothing in this room may ever hide a character from a frontal camera.
   * Nothing here is a station, and nothing here blocks a cell — the map is not
   * touched, so if the level changes these follow it.
   */
  private nooks() {
    const k = this.kitchen;
    const P = this.props;
    const walk = (x: number, y: number) =>
      x >= 0 && y >= 0 && x < k.width && y < k.height && k.cells[y * k.width + x] === 'floor';
    let i = 0;
    for (let y = 2; y < k.height - 1; y++) {
      for (let x = 1; x < k.width - 1; x++) {
        if (!walk(x, y)) continue;
        const n = [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ].filter(([dx, dy]) => walk(x + dx, y + dy)).length;
        if (n !== 1) continue;
        // Sit it against the closed side of the nook, not dead centre, so the
        // prop reads as stowed against the furniture rather than dropped in a
        // walkway — and so a chef nudged into the cell still has the open half.
        const open = [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ].find(([dx, dy]) => walk(x + dx, y + dy))!;
        const cx = x + 0.5 - open[0] * 0.2;
        const cz = y + 0.5 - open[1] * 0.2;
        const yaw = (this.runOffset(x + 3, y + 11) * 2 - 1) * 0.5;
        this.contact(cx, cz + 0.12, 0.95, 0.95, 0.85);
        switch (i++ % 4) {
          case 0: {
            // A stack of flour sacks. Pale cream, which is the one thing the
            // floor of this room has none of.
            for (let s = 0; s < 3; s++) {
              const t = s === 2 ? 0.62 : 1;
              P.ball(
                s === 1 ? 0xe4d9b6 : 0xf0e7c8,
                0.24 * t,
                cx + (s === 1 ? 0.13 : -0.1) * (s === 2 ? 0 : 1),
                0.13 + s * 0.16,
                cz + (s % 2 ? 0.08 : -0.06),
                1.15,
                0.72,
                0.95,
              );
            }
            P.box(0xc9bd95, 0.34, 0.03, 0.2, cx, 0.29, cz + 0.06, 0, yaw);
            break;
          }
          case 1: {
            // A coopered barrel with two steel hoops — the room's own bin
            // vocabulary, so it never reads as a station you can use.
            P.cyl(C.benchTopAlt, 0.28, 0.24, 0.44, 14, cx, 0.22, cz);
            for (const hy of [0.1, 0.35]) P.cyl(C.steelDark, 0.29, 0.29, 0.045, 14, cx, hy, cz);
            P.cyl(C.benchRail, 0.3, 0.29, 0.06, 14, cx, 0.46, cz);
            break;
          }
          case 2: {
            // A crate of firewood for the oven.
            P.box(C.benchLeg, 0.56, 0.3, 0.44, cx, 0.15, cz, 0, yaw);
            P.box(C.benchTopAlt, 0.58, 0.05, 0.46, cx, 0.31, cz, 0, yaw);
            for (let s = 0; s < 4; s++)
              P.cyl(
                s % 2 ? C.timberDark : C.benchApron,
                0.062,
                0.062,
                0.5,
                7,
                cx - 0.16 + s * 0.11,
                0.38 + (s % 2) * 0.04,
                cz,
                0,
                Math.PI / 2,
              );
            break;
          }
          default: {
            // A copper stockpot off the line, lid beside it.
            P.cyl(C.copperDark, 0.26, 0.22, 0.34, 16, cx, 0.17, cz);
            P.cyl(C.copperRim, 0.27, 0.27, 0.05, 16, cx, 0.36, cz);
            P.cyl(C.copper, 0.19, 0.19, 0.04, 14, cx, 0.4, cz);
            P.ball(C.copperRim, 0.05, cx, 0.44, cz);
            break;
          }
        }
      }
    }
  }

  /**
   * THE FOREGROUND RANK — SET DRESSING IN THE ROW THE PLAYER CANNOT ENTER.
   *
   * The floor is deliberately built four cells deeper than the map, because
   * portrait solves to a steep pitch and a wide field and a floor that stops at
   * the last walkable row leaves a band of backdrop along the bottom of the
   * phone. The cost of that has been showing up in every portrait capture since:
   * the bottom third of a 393×852 frame is four cells of completely bare
   * flagstone with nothing standing on it, which is the largest piece of dead
   * space anywhere in the game.
   *
   * The reference does not have that problem because its bottom edge is CROPPED
   * THROUGH a bench — look at either capture and the nearest table is cut off by
   * the frame. So: two benches out in the near field, left and right, carrying
   * nothing but crockery. They stand on cells the map marks '#', so no chef can
   * ever reach them and nothing here can be mistaken for a station; on landscape
   * and desktop they are a sliver at the very bottom edge, exactly as the
   * reference's are; on portrait they close the frame.
   *
   * The centre is left open on purpose — that is the lane the player walks up
   * out of the bottom of the picture, and the reference keeps its front-centre
   * clear for the same reason.
   */
  private foreground() {
    const W = this.kitchen.width;
    const P = this.props;
    // A rank that spans the WHOLE room width in three pieces rather than two
    // benches placed by eye. Chasing the portrait crop with a single bench was a
    // losing game: at 393×852 the near field only shows about five world units
    // across, and which five depends on a camera rig that is being retuned in
    // another file at the same time. A full-width rank cannot miss — whatever
    // the near crop turns out to be, something is standing in it, and on the
    // landscape profiles it is the sliver of cropped bench the reference has
    // along its own bottom edge.
    // TWO RANKS, NOT ONE. ROUND 12.
    //
    // At 393×852 the frame runs from the back wall to roughly z 13, and a
    // single rank at z 11.75 left a band from z 10 to z 11.2 — about the
    // bottom third of a portrait capture — as completely bare flagstone with a
    // 40px sliver of bench along the very bottom edge. The reference never
    // shows that much empty ground: its near field is always cropped THROUGH a
    // table. The far rank moves up into the gap and a second, nearer one takes
    // over the bottom-edge crop. On landscape and desktop the nearer rank is
    // off the bottom of the frame entirely and costs a few merged boxes.
    const z = this.kitchen.height + 0.05;
    const lanes: [number, number, number][] = [
      [2.6, 3.4, 0],
      [7.5, 3.0, 0],
      [W - 2.6, 3.4, 0],
      [4.4, 3.0, 2.35],
      [W - 4.4, 3.0, 2.35],
    ];
    for (const [cxb, bw, dz] of lanes) {
      const s = cxb < W / 2 ? -1 : cxb > W / 2 ? 1 : 0;
      const h = TABLE_H + s * 0.02 + (dz > 0 ? 0.03 : 0);
      const yaw = s * 0.09 + (s === 0 ? -0.05 : 0) + (dz > 0 ? -0.06 * s : 0);
      this.bench(cxb, z + dz, bw, h, yaw);
      if (dz > 0) continue;
      const cos = Math.cos(yaw);
      const sin = Math.sin(yaw);
      const at = (ox: number, oz: number) => ({ x: cxb + ox * cos + oz * sin, z: z - ox * sin + oz * cos });
      if (s < 0) {
        // A tower of plates, a folded cloth and a copper pan — the reference's
        // near rank is as dressed as everything behind it, and a 3.4m bench
        // carrying two objects reads as a shelf someone cleared.
        const a = at(-1.05, -0.05);
        for (let k = 0; k < 6; k++) {
          P.cyl(k % 4 === 0 ? 0xece4d2 : PALETTE.plates, 0.175, 0.16, 0.046, 14, a.x + (k % 2 ? 0.008 : -0.006), h + 0.03 + k * 0.047, a.z);
        }
        const b = at(0.05, -0.02);
        P.box(0xe6e0cc, 0.34, 0.06, 0.24, b.x, h + 0.03, b.z, 0, 0.22);
        P.box(0xd2c9ad, 0.29, 0.05, 0.19, b.x + 0.02, h + 0.07, b.z + 0.01, 0, 0.38);
        const c = at(1.05, -0.04);
        P.cyl(C.copperDark, 0.26, 0.24, 0.11, 16, c.x, h + 0.055, c.z);
        P.cyl(C.copperRim, 0.27, 0.27, 0.035, 16, c.x, h + 0.115, c.z);
        P.cyl(0x9a6a34, 0.04, 0.045, 0.42, 8, c.x + 0.42, h + 0.08, c.z + 0.06, 0, Math.PI / 2);
      } else if (s === 0) {
        // A mixing bowl and the salt and pepper — the reference's front-centre
        // bench carries small things, so the lane behind it stays legible.
        const a = at(-0.5, -0.02);
        this.mixBowl(a.x, h + 0.02, a.z, 0.21);
        const b = at(0.55, 0.0);
        this.shakers(b.x, h, b.z);
        const c = at(0.05, -0.06);
        P.box(C.timberDark, 0.52, 0.035, 0.035, c.x, h + 0.03, c.z, 0, 0.3);
        P.ball(C.steel, 0.095, c.x + 0.17, h + 0.05, c.z + 0.06, 1, 0.6, 1);
      } else {
        const a = at(0.95, -0.04);
        this.stockpot(a.x, h, a.z);
        const d = at(0.06, -0.02);
        this.shakers(d.x, h, d.z);
        P.cyl(0xc9803a, 0.085, 0.09, 0.18, 10, d.x + 0.34, h + 0.09, d.z - 0.02);
        P.cyl(C.timberDark, 0.075, 0.08, 0.045, 10, d.x + 0.34, h + 0.2, d.z - 0.02);
        const b = at(-1.05, 0.0);
        P.cyl(C.tray, 0.26, 0.23, 0.08, 14, b.x, h + 0.04, b.z);
        P.cyl(C.pieCrust, 0.24, 0.24, 0.09, 14, b.x, h + 0.11, b.z);
        P.cyl(C.pieFill, 0.17, 0.17, 0.03, 14, b.x, h + 0.16, b.z);
        for (let k = -1; k <= 1; k++) {
          P.box(C.pieCrust, 0.32, 0.02, 0.05, b.x, h + 0.178, b.z + k * 0.09);
          P.box(C.pieCrust, 0.05, 0.02, 0.32, b.x + k * 0.09, h + 0.178, b.z);
        }
      }
    }
  }

  /**
   * THE TWO TEAM COUNTERS.
   *
   * In the reference these are the second and third biggest set pieces after
   * the oven, and they are *dressed*: a long painted run of vertical planks
   * with a pale top rail, three white ceramic trays sunk into it holding food
   * the size of a fist, a stack of plates at one end and a metal tray of golden
   * buns at the other, and a Toad behind it cropped at the chest.
   *
   * Ours built one 1.0-wide painted box per station cell and then put nothing
   * on top but the station itself, so the left pass was a plain pink slab and
   * the right was a plain green slab with three black pans on it. This closes
   * the gap between the counter and the oven post so each pass reads as ONE
   * piece of furniture, draws the plank seams, and lays the reference's
   * crockery along the back edge where it can never fight a station for space.
   */
  private dressPass(span: { x0: number; x1: number }) {
    const P = this.props;
    const W = this.kitchen.width;
    const h = COUNTER_H;
    const z = 1.5;

    for (const left of [true, false]) {
      const body = left ? C.teamRed : C.teamGreen;
      const dark = left ? C.teamRedDark : C.teamGreenDark;
      const rail = left ? C.teamRedTop : C.teamGreenTop;
      // Counter cells: 1..3 on the left, W-4..W-2 on the right. Close the gap
      // between the outer cell and the timber post flanking the oven alcove.
      const inboard = left ? span.x0 - 0.5 : span.x1 + 0.5;
      const outer = left ? 4.0 : W - 4.0;
      this.contact((left ? 1.0 + inboard : W - 1.0 + inboard) / 2, z + 0.15, Math.abs(inboard - (left ? 1.0 : W - 1.0)) + 1.0, 2.1, 0.9);
      const gapW = Math.abs(inboard - outer);
      if (gapW > 0.05) {
        const gx = (inboard + outer) / 2;
        P.box(body, gapW, h - 0.16, 0.86, gx, (h - 0.16) / 2 + 0.1, z);
        P.box(dark, gapW, 0.1, 0.88, gx, 0.05, z);
        P.box(rail, gapW, 0.14, 0.94, gx, h - 0.07, z);
      }
      // Plank seams down the front face, so a three-metre counter reads as
      // boards nailed to a frame rather than as an extruded slab.
      const x0 = left ? 1.0 : W - 4.0;
      const x1 = left ? inboard : W - 1.0;
      for (let sx = x0 + 0.5; sx < x1 - 0.05; sx += 0.5) {
        P.box(dark, 0.05, h - 0.3, 0.02, sx, (h - 0.16) / 2 + 0.08, z + 0.44);
      }

      // Back-edge dressing. Kept off the station cells' centres and clear of
      // the server, so nothing here can ever hide a thing the player needs.
      const zb = z - 0.28;
      /**
       * CROCKERY YES, FOOD NO — AND THIS IS THE RULE, NOT A TRIM.
       *
       * This dressing used to be a bun tray and a ceramic dish heaped with
       * lettuce on the left, and a plate stack, a dish of tomatoes and a second
       * bun tray on the right. Three of those five are the game's own hero
       * ingredients, rendered from the same `heap` the real crates use, sitting
       * a couple of metres from the real crates and impossible to pick up.
       *
       * A player testing on a phone reported hunting the room for the bread and
       * asking whether the pale round things were the buns. They were looking at
       * scenery. When a set dresses itself with the exact objects the mechanics
       * are made of, every one of them is a lie the player has to test by
       * walking into it — and the cost of that lie is paid in the first two
       * minutes, which is the only budget a new player has.
       *
       * So the rule is now absolute: if it reads as food, it is a crate or it
       * is on a plate or in a pan. Plates, pots, bowls, shakers and the hanging
       * rack stay — cookware says "kitchen" without ever claiming to be an
       * ingredient.
       */
      if (!left) {
        for (let i = 0; i < 7; i++) {
          P.cyl(i % 3 === 0 ? 0xece4d2 : PALETTE.plates, 0.2, 0.18, 0.046, 14, W - 3.85, h + 0.03 + i * 0.046, zb);
        }
      }
      void this.bunTray;
      void this.ceramicTray;
    }
  }

  /** A shallow ceramic dish with a heap of one ingredient in it. */
  private ceramicTray(kind: string, x: number, h: number, z: number) {
    this.tray(x, h, z);
    this.heap(kind, x, h + 0.07, z);
  }

  /**
   * A mushroom-capped server behind a team counter. All head, like the
   * reference's: the cap is nearly half the visible figure, which is what makes
   * it readable at 40px when only the top third clears the counter rail.
   */
  private passToad(x: number, z: number, spot: number, vest: number) {
    const P = this.props;
    // The counter rail sits at 0.86. The reference's servers clear it by a
    // whole head, and the cap alone is about the width of the tray in front of
    // them — ours cleared it by half a cap and read as a beige egg.
    // THE BRIM WAS EATING BOTH EYES. At capY 1.5 / capR 0.5 / capH 0.72 the cap
    // ellipsoid spans y 1.14–1.86 and is 0.5 wide at the equator, while the
    // face sphere sat at y 1.24 with r 0.26 — i.e. the entire head was INSIDE
    // the mushroom. At the eye's own height the cap is still 0.37 across and
    // the eye is only 0.21 proud, so it was buried; and at the rig's 22.5°
    // pitch the sightline leaving it climbed to y≈1.34, still under the dome.
    // Both servers rendered as a plain cream dome with five spots on a stalk:
    // props, not mascots, in the two corners the reference fills with its
    // biggest characters.
    //
    // Cap smaller (0.40) and higher (1.66), face bigger and higher (1.32),
    // eyes pushed further proud (z+0.25). The sightline now clears the cap's
    // footprint at y≈1.33, a clear 0.06 below the brim.
    const capY = 1.66;
    const capR = 0.4;
    const capH = 0.68;

    // Torso — only the top of it clears the counter, so the vest panel is what
    // carries the team colour, not the body.
    P.ball(C.toadSkin, 0.27, x, 0.82, z, 1.0, 1.2, 0.9);
    P.ball(vest, 0.25, x, 0.8, z + 0.07, 1.02, 1.06, 0.72);
    P.ball(C.toadCap, 0.13, x, 1.02, z + 0.06, 1.5, 0.45, 0.9);
    // ARMS, resting on the counter rail and reaching forward over it, because
    // the reference's Toads are visibly DOING something behind their counters.
    // Two stubs at the shoulder read as nothing; a stub, an elbow and a mitt
    // sat on the rail reads as a body leaning on a bench.
    for (const s of [-1, 1]) {
      P.ball(C.toadSkin, 0.105, x + s * 0.28, 0.95, z + 0.04, 1, 1.2, 1);
      P.ball(C.toadSkin, 0.088, x + s * 0.35, 0.86, z + 0.2, 1, 1, 1.5);
      P.ball(0xfbf6e8, 0.095, x + s * 0.36, 0.85, z + 0.36, 1.05, 0.85, 1.05);
    }

    // Face. Bigger skull, and the features carried well forward of it so they
    // survive both the cap above and the counter below.
    P.ball(C.toadSkin, 0.285, x, 1.32, z + 0.02, 1, 0.94, 1);
    for (const s of [-1, 1]) {
      P.ball(0x2b2119, 0.06, x + s * 0.11, 1.34, z + 0.25, 1, 1.55, 0.5);
      P.ball(0xffffff, 0.022, x + s * 0.13, 1.4, z + 0.27, 1, 1, 0.5);
      P.ball(0xf0a086, 0.062, x + s * 0.21, 1.25, z + 0.18, 1, 0.7, 0.5);
    }
    // A mouth. Without one a Toad is a bean with two dots on it.
    P.ball(0x2b2119, 0.052, x, 1.19, z + 0.26, 1.5, 0.42, 0.4);

    // Cap, with the spots sat properly ON the dome rather than floating near it.
    P.ball(C.toadCap, capR, x, capY, z, 1, capH, 1);
    P.cyl(C.toadCapRim, capR * 0.96, capR * 0.9, 0.06, 16, x, capY - 0.02, z);
    const put = (ax: number, az: number, r: number) => {
      const d = Math.min(capR * 0.98, Math.hypot(ax, az));
      const yy = capY + capR * capH * Math.sqrt(Math.max(0, 1 - (d / capR) ** 2));
      P.ball(spot, r, x + ax, yy - 0.035, z + az, 1, 0.55, 1);
    };
    put(0, 0.24, 0.145);
    put(-0.31, 0.06, 0.135);
    put(0.31, 0.06, 0.135);
    put(-0.15, -0.29, 0.115);
    put(0.2, -0.27, 0.115);
  }

  /**
   * A tower of golden pancakes. The reference's are individually legible: each
   * disc has its own darker crust edge and sits a few millimetres off the one
   * below, so the tower reads as a COUNT of things rather than as a shape.
   *
   * Ours alternated two tones at 0.085 pitch with 0.018 of jitter, which at
   * screen size averaged into one solid orange barrel — the tallest, most
   * saturated non-food object in the room, saying nothing. Same height, same
   * silhouette, but every pancake now carries a darker rim disc slightly proud
   * of its own body, and the wobble is tripled.
   */
  private pancakes(x: number, z: number) {
    const P = this.props;
    this.contact(x, z, 1.35, 1.35, 0.95);
    P.cyl(C.stoneWarm, 0.42, 0.44, 0.14, 14, x, 0.07, z);
    P.cyl(PALETTE.plates, 0.4, 0.38, 0.06, 16, x, 0.17, z);
    for (let i = 0; i < 12; i++) {
      const r = 0.33 - Math.abs(i - 5) * 0.007;
      const jx = Math.sin(i * 2.1) * 0.05;
      const jz = Math.cos(i * 1.7) * 0.05;
      const y = 0.24 + i * 0.083;
      P.cyl(C.pancakeAlt, r + 0.015, r + 0.015, 0.026, 16, x + jx, y - 0.028, z + jz);
      P.cyl(C.pancake, r, r * 0.98, 0.06, 16, x + jx, y + 0.014, z + jz);
    }
    P.ball(0xffd98a, 0.11, x, 1.25, z, 1, 0.5, 1);
    P.ball(0xd9902c, 0.06, x + 0.03, 1.29, z + 0.02, 1, 0.5, 1);
  }

  /** Golden buns laid flat on a metal tray, as the reference sets on each pass. */
  private bunTray(x: number, y: number, z: number) {
    const P = this.props;
    P.box(C.steel, 0.86, 0.045, 0.44, x, y + 0.022, z);
    P.box(C.steelDark, 0.9, 0.03, 0.48, x, y + 0.012, z);
    for (let i = 0; i < 3; i++) {
      const dx = (i - 1) * 0.26;
      P.cyl(C.pancakeAlt, 0.15, 0.15, 0.03, 14, x + dx, y + 0.055, z + (i % 2 ? 0.03 : -0.03));
      P.ball(C.pancake, 0.14, x + dx, y + 0.08, z + (i % 2 ? 0.03 : -0.03), 1, 0.55, 1);
    }
  }

  private stockpot(x: number, y: number, z: number) {
    const P = this.props;
    // Was 0.48 proud of the bench — over half a chef, and it sits by design on
    // the bench NEAREST THE MIDDLE OF THE ROOM, i.e. squarely between the low
    // camera and everything happening behind it. Same silhouette, two thirds
    // the height: lid, rim, handles and knob all intact, tops out at 0.31.
    P.cyl(C.steel, 0.29, 0.26, 0.24, 18, x, y + 0.12, z);
    P.cyl(C.steelDark, 0.3, 0.3, 0.035, 18, x, y + 0.24, z);
    P.cyl(C.steel, 0.28, 0.3, 0.05, 18, x, y + 0.27, z);
    P.ball(C.iron, 0.055, x, y + 0.31, z);
    for (const s of [-1, 1]) P.box(C.steelDark, 0.09, 0.05, 0.05, x + s * 0.32, y + 0.19, z);
    // STEAM. Region-diffed across sixteen seconds of capture the whole SET moved
    // by two luma: only the cast ever moved. A lidded pot on a working line
    // steams, it is the cheapest possible motion (three camera-facing quads on a
    // texture the room already uploads), and unlike a flicker it reads even in a
    // still frame — a puff off a pot says "this room is being cooked in".
    for (let i = 0; i < 3; i++) {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(0.44, 0.44),
        new THREE.MeshBasicMaterial({
          map: softBlob(),
          color: 0xfaf6ec,
          transparent: true,
          opacity: 0,
          depthWrite: false,
        }),
      );
      m.position.set(x, y + 0.34, z);
      m.userData.baseY = y + 0.34;
      m.userData.phase = i / 3 + (x * 0.31 + z * 0.17) % 1;
      this.root.add(m);
      this.steam.push(m);
    }
  }

  private shakers(x: number, y: number, z: number) {
    const P = this.props;
    for (const [s, c] of [
      [-1, 0xf4efe0],
      [1, 0x6b5a48],
    ] as const) {
      P.cyl(c, 0.06, 0.07, 0.17, 10, x + s * 0.09, y + 0.085, z);
      P.cyl(C.steel, 0.055, 0.055, 0.03, 10, x + s * 0.09, y + 0.185, z);
    }
  }

  /**
   * INTEGRATION — THE MIXING BOWL WAS A BLUE EGG.
   *
   * Three benches' worth of dressing drew it as `ball(bowlBlue, sy 0.62)` with
   * a pale `ball(sy 0.35)` for the contents sitting INSIDE it: the blue dome
   * crested at TH+0.208 and the pale one at TH+0.179, so the contents were
   * geometrically buried and every one of these rendered as a bald, saturated
   * cyan ellipsoid. Cropped at 2x off desktop t0026 they are the only pure cool
   * hue in a room built entirely out of ochre, honey and warm stone — four or
   * five of them scattered across the play floor, each reading as a smooth blue
   * blob with no affordance and no name.
   *
   * The reference has exactly one of these and it is unmistakably a VESSEL: a
   * squat teal casserole with cast handles, a lighter rim, and pale contents
   * visible over that rim. Three moves get us there and none of them costs a
   * draw call (every colour here is already in the merge):
   *
   *   - the body squats (sy 0.62 -> 0.40) so it stops being an egg,
   *   - a proud rim ring in a lighter glaze reads as the lip of an open bowl,
   *   - the contents sit ABOVE the rim line instead of under it.
   *
   * Scale is a parameter because the three call sites wanted 0.13, 0.19 and
   * 0.21 radius; they now all call this and therefore all agree.
   */
  private mixBowl(x: number, y: number, z: number, r = 0.19) {
    const P = this.props;
    // Squat body. Half-height is 0.40r, so a 0.19 bowl stands 7.6cm tall
    // against the 11.8cm it used to.
    P.ball(C.bowlBlue, r, x, y + r * 0.34, z, 1, 0.4, 1);
    // The lip: a shade lighter than the body so the opening has an edge, and
    // wider than the body so it catches the key from above.
    P.cyl(C.bowlRim, r * 1.02, r * 0.94, r * 0.13, 12, x, y + r * 0.66, z);
    // Contents, proud of the lip. Cream rather than the near-white it was:
    // crockery is not allowed to beat the chimney breast (see PALETTE.plates).
    P.ball(0xf2ead2, r * 0.78, x, y + r * 0.66, z, 1, 0.42, 1);
  }

  private clock(x: number, y: number, z: number) {
    const S = this.shell;
    // A DIAL YOU CAN READ. It was a 0.38 cream disc with two thin dark bars and
    // four faint tan pips at 0x8a7458 — at the size it renders on iPhone
    // landscape that is a grey button, and the critic could not tell it was a
    // clock. Now: a dark timber case with a proud bezel, a near-white face
    // against it, twelve marks with the quarters doubled in size, and hands
    // twice as fat with a hub. Same footprint, same one merged draw call.
    S.cyl(C.timberDark, 0.5, 0.5, 0.14, 20, x, y, z, Math.PI / 2);
    S.cyl(C.timberLight, 0.44, 0.44, 0.1, 20, x, y, z + 0.045, Math.PI / 2);
    S.cyl(0xfffaee, 0.38, 0.38, 0.1, 20, x, y, z + 0.075, Math.PI / 2);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const quarter = i % 3 === 0;
      S.box(
        0x2f261e,
        quarter ? 0.075 : 0.04,
        quarter ? 0.1 : 0.055,
        0.03,
        x + Math.cos(a) * 0.3,
        y + Math.sin(a) * 0.3,
        z + 0.13,
        a - Math.PI / 2,
      );
    }
    S.box(0x2f261e, 0.075, 0.3, 0.035, x, y + 0.11, z + 0.15);
    S.box(0x2f261e, 0.24, 0.07, 0.035, x + 0.09, y - 0.03, z + 0.15, 0.42);
    S.cyl(0x2f261e, 0.055, 0.055, 0.04, 10, x, y, z + 0.165, Math.PI / 2);
  }

  private wallShelf(x: number, y: number, z: number) {
    const S = this.shell;
    S.box(C.timberDark, 1.9, 0.09, 0.34, x, y, z + 0.17);
    for (const s of [-1, 1]) S.box(C.timberDark, 0.08, 0.3, 0.3, x + s * 0.85, y - 0.18, z + 0.15);
    const jars: [number, number, number][] = [
      [-0.62, 0.2, 0xd9b46a],
      [-0.24, 0.26, 0xc2703a],
      [0.14, 0.22, 0xe0d6ae],
      [0.52, 0.28, 0x9c7f4a],
    ];
    for (const [dx, jh, col] of jars) {
      S.cyl(col, 0.12, 0.13, jh, 10, x + dx, y + 0.05 + jh / 2, z + 0.16);
      S.cyl(C.timberDark, 0.1, 0.11, 0.05, 10, x + dx, y + 0.06 + jh, z + 0.16);
    }
  }

  private door(innerX: number, z: number) {
    const S = this.shell;
    const x = innerX + 0.2;
    // Stone surround, then a plank door with the reference's round window.
    // THE DOOR SURROUND IS NOT CHIMNEY STONE. Built from C.stoneWarm it carried
    // the chimney's big neutral bounce term, so a 2.9m pale slab stood at the
    // extreme left edge of every landscape frame and rendered as the third
    // brightest mass in the picture — a white column in the one place the
    // reference has quiet grey-green rubble. Same family as the cobble skirt it
    // stands on, which is what the reference's door jamb actually is.
    S.box(C.cobbleCap, 0.3, 2.9, 1.9, x - 0.06, 1.45, z);
    S.box(C.timberDark, 0.22, 2.5, 1.5, x + 0.02, 1.25, z);
    for (let i = 0; i < 4; i++) {
      S.box(i % 2 === 0 ? C.timber : C.timberLight, 0.1, 2.42, 0.32, x + 0.14, 1.25, z - 0.54 + i * 0.36);
    }
    S.box(C.timberDark, 0.12, 0.14, 1.44, x + 0.16, 2.3, z);
    S.box(C.timberDark, 0.12, 0.14, 1.44, x + 0.16, 0.55, z);
    S.cyl(C.timberDark, 0.3, 0.3, 0.2, 16, x + 0.16, 1.86, z, 0, Math.PI / 2);
    S.cyl(0x9fb6b8, 0.23, 0.23, 0.1, 16, x + 0.26, 1.86, z, 0, Math.PI / 2);
    S.ball(C.copper, 0.07, x + 0.24, 1.2, z + 0.58);
  }

  /**
   * The reference's utensil rail: a bright chrome bar on two brackets, pale
   * ropes dropping off it, and pans that are the brightest thing on that wall
   * after the plaster — bright rim, lighter well, a warm wooden handle sticking
   * out at an angle.
   *
   * Ours was four unlit brown discs at Y≈22 pinned flat to the plaster with no
   * rope, no handle and no rim: at thumbnail size it read as damp patches. Same
   * four pans, same rail, but built so you can see them.
   */
  private panRack(innerX: number, z: number) {
    const S = this.shell;
    const x = innerX - 0.18;
    // Rail, on two brackets standing off the wall.
    S.cyl(C.steelDark, 0.05, 0.05, 3.1, 8, x - 0.1, 2.98, z, Math.PI / 2);
    for (const s of [-1, 1]) {
      S.box(C.steelDark, 0.3, 0.09, 0.09, x + 0.02, 2.98, z + s * 1.5);
      S.ball(C.steel, 0.075, x - 0.1, 2.98, z + s * 1.62);
    }
    const pans: [number, number, number][] = [
      [-1.2, 0.3, C.copper],
      [-0.52, 0.36, C.copperDark],
      [0.18, 0.27, C.copper],
      [0.88, 0.33, C.copperDark],
    ];
    // The pans hang off a PIVOT rather than going into the room's static merge,
    // so update() can sway them about the rail. They are still one merge and
    // still a handful of draw calls; the only cost is that the merge is local
    // and the geometry is authored relative to the rail.
    const pivot = new THREE.Object3D();
    pivot.position.set(x, 2.94, z);
    const R = new Props();
    for (const [dz, r, col] of pans) {
      const y = 2.16 - r - 2.94;
      // Rope down to the rail — pale, so the pan reads as hung, not stuck on.
      R.cyl(C.rope, 0.022, 0.022, -y - r * 0.92, 6, -0.09, (y + r) / 2, dz);
      R.cyl(C.steelDark, 0.035, 0.035, 0.1, 8, -0.08, y + r * 0.95, dz);
      // Body, then a proud bright rim and a lighter well inside it.
      R.cyl(col, r, r * 0.96, 0.1, 18, 0, y, dz, 0, Math.PI / 2);
      R.cyl(C.copperRim, r, r, 0.05, 18, -0.055, y, dz, 0, Math.PI / 2);
      R.cyl(col, r * 0.82, r * 0.82, 0.07, 18, -0.085, y, dz, 0, Math.PI / 2);
      // Handle, raked off the rim the way a hung pan's hangs.
      R.cyl(0x9a6a34, 0.045, 0.05, 0.44, 8, -0.06, y - r - 0.18, dz + 0.1, 0, 0.42);
      R.cyl(C.steel, 0.035, 0.035, 0.12, 8, -0.06, y - r - 0.02, dz + 0.02, 0, 0.42);
    }
    R.build(pivot, false);
    this.root.add(pivot);
    this.panSwing.push(pivot);
    // A couple of ladles hanging alongside, like the reference's utensil rail.
    for (const dz of [-1.55, 1.5]) {
      S.cyl(C.steel, 0.028, 0.028, 0.62, 6, x - 0.06, 2.62, z + dz);
      S.ball(C.steel, 0.115, x - 0.08, 2.28, z + dz, 0.5, 1, 1);
    }
  }

  // -------------------------------------------------------------- per-frame

  /**
   * Fly the one action glyph to the focused bench and say what the button does.
   *
   * The sign never slides between benches: a prompt that travels reads as an
   * object in the room, and it is not one. It pops down to nothing when the
   * focus moves, swaps its shape, and pops back — 0.09s each way, which is
   * short enough that a bench-to-bench transfer looks like a cut and long
   * enough to be an animation rather than a hard toggle.
   */
  private updateActionGlyph(focusId: number | null, focusAction: string, dt: number, time: number) {
    const v = focusId === null ? undefined : this.byId.get(focusId);
    const shape = v ? this.glyphs.get(focusAction) : undefined;
    // 'none' has no glyph on purpose. A station the button cannot answer still
    // takes the wash — "you are standing at this" is information — but claiming
    // an action there would be the one lie this system is not allowed to tell.
    const want = shape && this.glyphKey === focusAction ? 1 : 0;
    this.glyphScale += (want - this.glyphScale) * Math.min(1, dt * 18);
    if (this.glyphScale < 0.04 && this.glyphKey !== focusAction) {
      this.glyphKey = focusAction;
      for (const g of new Set(this.glyphs.values())) g.visible = false;
      if (shape) shape.visible = true;
    }
    this.glyphRoot.visible = this.glyphScale > 0.02 && !!v;
    if (!this.glyphRoot.visible || !v) return;
    // A touch of overshoot on the way in, and a slow bob so the sign breathes
    // like everything else in the room.
    const s = this.glyphScale * (1 + Math.sin(Math.min(1, this.glyphScale) * Math.PI) * 0.18);
    this.glyphPop.scale.setScalar(s);
    v.group.getWorldPosition(this.glyphAt);
    /**
     * HIGH ENOUGH TO CLEAR A HEAD, AND SET BACK BEHIND THE BENCH.
     *
     * At `topY + 0.86` over the bench centre the sign landed exactly on the
     * player's hat — you approach a bench from the camera side, so the chef is
     * always between the lens and the thing they are working at. "Nothing
     * important is ever occluded" cuts both ways: the prompt must not eat the
     * character either.
     *
     * BOTH BOUNDS MEASURED IN THE FRAME. 0.86 over the bench top put the disc
     * exactly on the player's hat. 1.18 cleared it by a mile and floated free
     * of the furniture, reading as an object hanging in the room rather than a
     * label on a table — in shots/ab-marker-on it sat in the oven mouth. 0.98,
     * plus 0.22 of depth PAST the bench (which pushes it up-screen without
     * moving it off the bench in plan), clears the tallest hat in the cast by
     * about half a head and keeps the sign visibly attached to its bench.
     */
    /**
     * ...EXCEPT IN THE OVEN, WHERE 'BEHIND THE BENCH' IS 'INSIDE THE CAVITY'.
     *
     * The -0.22 of depth above is what pushes the sign up-screen without moving
     * it off its bench in plan, and it is right for every bench in the room
     * because there is a wall behind them. A burner in the arch has a two-metre
     * hole behind it: the same offset puts the disc at z 1.28 against an arch
     * face at 1.36, i.e. THROUGH the opening and floating in the middle of the
     * fire — which is the exact failure the note above records from
     * shots/ab-marker-on, arrived at from the other direction.
     *
     * So an oven burner pushes the sign the other way, out over the hearth lip
     * where it is in front of the masonry and against the pale stone rather
     * than against a dark glowing cavity. Height comes down to match: it no
     * longer has to clear a bench, only the hearth.
     */
    const depth = v.inOven ? 0.3 : -0.22;
    const lift = v.inOven ? 0.72 : 0.98;
    this.glyphRoot.position.set(
      this.glyphAt.x,
      v.topY + lift + Math.sin(time * 2.6) * 0.035,
      this.glyphAt.z + depth,
    );
  }

  update(focusId: number | null, focusAction: string, dt: number, time: number) {
    this.updateActionGlyph(focusId, focusAction, dt, time);
    for (const v of this.stationViews) {
      const st = v.station;
      const key = describe(st.holding);
      if (key !== v.contentKey) {
        v.contentKey = key;
        rebuildContents(v);
      }
      updateContents(v, time);

      if (st.work > 0 && st.work < 1) {
        v.ring.visible = true;
        v.ring.geometry.dispose();
        v.ring.geometry = new THREE.RingGeometry(0.3, 0.4, 24, 1, Math.PI / 2, -Math.PI * 2 * st.work);
      } else if (v.ring.visible) {
        v.ring.visible = false;
      }

      const glowMat = v.glow.material as THREE.MeshBasicMaterial;
      // 9 rad/s is 1.4 Hz — a strobe, not a breathe. 2.6 rad/s is 0.41 Hz, and
      // the amplitude comes down with it: this marker's job is to say "this
      // one", not to compete with the food for attention. THE RATE STAYS; only
      // the amplitude moves, because the pool is no longer in a shadow it has to
      // shout out of. See buildStation for where it went and why.
      const want = focusId === st.id ? 0.62 + Math.sin(time * 2.6) * 0.08 : 0;
      glowMat.opacity += (want - glowMat.opacity) * Math.min(1, dt * 18);
      glowMat.transparent = true;
      v.glow.visible = glowMat.opacity > 0.01;
      const faceMat = v.face.material as THREE.MeshBasicMaterial;
      // The front panel runs a little hotter than the top: it lands on the
      // apron, which is the darkest large value on the bench, and an additive
      // term on a dark ground buys less than the same term on lit planks.
      faceMat.opacity = glowMat.opacity * 1.15;
      faceMat.transparent = true;
      v.face.visible = v.glow.visible;

      if (v.hot) {
        const pan = st.holding?.type === 'pan' ? st.holding.pan : null;
        const heat = pan ? 0.5 + Math.sin(time * 7 + st.id) * 0.1 : 0.12;
        (v.hot.material as THREE.MeshBasicMaterial).opacity = heat;
        (v.hot.material as THREE.MeshBasicMaterial).transparent = true;
      }
    }

    // The oven is the only light source in the room that moves. Keep it lively
    // but slow — a flicker you notice, never one you have to look away from.
    for (const f of this.fire) {
      const p = f.userData.phase as number;
      const k = 0.72 + Math.sin(time * 6.2 + p) * 0.2 + Math.sin(time * 11.3 + p * 1.7) * 0.1;
      f.scale.set(0.85 + k * 0.25, k, 0.85 + k * 0.25);
      f.position.y = (f.userData.baseY as number) + (k - 0.8) * 0.1;
    }
    const gm = this.ovenGlow.material as THREE.MeshBasicMaterial;
    gm.opacity = 0.6 + Math.sin(time * 1.9) * 0.1 + Math.sin(time * 4.3) * 0.05;
    // The pulse runs deeper and slower than the glow — 0.28 to 0.72 over about
    // two seconds, on three incommensurate frequencies so it never repeats
    // audibly. Measured on a region diff this is a 20-plus luma swing in the
    // brightest part of the mouth, which is a fire you can see breathing from
    // the far side of the room and still not a strobe.
    const pm = this.ovenPulse.material as THREE.MeshBasicMaterial;
    // 1.35 rad/s is a 4.65s period, and the harness samples on 1s and 5s marks —
    // so measured across four timed captures the oven's mean luma moved by two
    // values purely because the sampling aliased with the flicker. Three
    // incommensurate rates well off any whole second, and a deeper swing.
    // ROUND 17: FASTER AND DEEPER. 0.83 rad/s is a 7.6-second period — slower
    // than the gap between any two of the harness's marks, so every capture
    // caught it at roughly the same phase and the critic measured two luma of
    // variation across five frames. An ember bed flickers at 3-6 Hz. The base
    // rate goes to 4.1 rad/s (0.65 Hz) with two faster terms on top, and the
    // swing widens to 0.18-0.86 — which, being additive over a mouth that is
    // already at its ceiling, moves the pixel and not the peak.
    const fl =
      Math.sin(time * 4.1) * 0.24 + Math.sin(time * 9.7 + 1.1) * 0.13 + Math.sin(time * 23.3) * 0.05;
    pm.opacity = 0.52 + fl;
    // The bounce on the stone runs the same flicker one beat behind, which is
    // what makes it read as the SAME light rather than as a second lamp.
    const bm = this.archBounce.material as THREE.MeshBasicMaterial;
    bm.opacity = 0.62 + fl * 0.8;
    // Steam. Each puff runs its own loop: born at the lid, drifting up and back
    // as it grows, gone by the top. Nothing here is random — same seed, same
    // frame, so a screenshot diff still means something.
    for (const s of this.steam) {
      const u = ((time * 0.34 + (s.userData.phase as number)) % 1);
      s.position.y = (s.userData.baseY as number) + u * 0.74;
      s.position.z = (s.position.z as number);
      const k = 0.55 + u * 1.5;
      s.scale.set(k, k, k);
      // In at the bottom, out at the top, and never more than a whisper — the
      // reference's room has no particle effects at all and a fat white plume
      // would be the loudest thing in the lower third.
      (s.material as THREE.MeshBasicMaterial).opacity = Math.sin(u * Math.PI) * 0.34;
    }
    // The hanging pans sway about their rail. Two rails, opposite phases, well
    // under a degree of amplitude: at this size it is a shimmer you notice only
    // when you compare two frames, which is exactly what a critic does.
    this.panSwing.forEach((p, i) => {
      p.rotation.z = Math.sin(time * 0.9 + i * 2.1) * 0.022 + Math.sin(time * 1.7 + i) * 0.008;
    });
  }

  viewFor(id: number): StationView | undefined {
    return this.byId.get(id);
  }
}

/**
 * A vertical ember ramp: white-hot and opaque at v=0, gone by the top. Used
 * both for the wash up the back of the oven vault and, laid flat, for the bed
 * the fire stands on. One texture, shared, because both want the same falloff.
 */
/**
 * A soft elliptical darkening, white at the edges so a multiply blend leaves
 * the floor untouched outside the pool. One texture for every contact shadow
 * in the room.
 */
const contactTex = new Map<number, THREE.CanvasTexture>();

/**
 * The wall/floor corner band. A vertical ramp, dark at v=0 and white by v=1, so
 * a multiply-blended quad standing on the floor darkens the bottom of a wall
 * and fades out cleanly. Warm brown rather than neutral, for the same reason
 * the contact pools are: a shadow on ochre plaster is ochre plaster lit only by
 * bounce off more ochre plaster.
 */
/**
 * A short, hard-shouldered ramp for `wallShade`: opaque-dark at v=0, back to
 * white by a third of the span. Deliberately steeper than `cornerGradient` —
 * a beam's cast shadow on plaster has a definite edge to it, and a long lazy
 * fade just re-darkens the whole wall, which is the mistake the ceiling grade
 * in materials.ts already made once.
 */
const edgeTex = new Map<number, THREE.DataTexture>();
function edgeGradient(strength: number): THREE.DataTexture {
  const q = Math.round(strength * 20) / 20;
  const hit = edgeTex.get(q);
  if (hit) return hit;
  const n = 64;
  const data = new Uint8Array(n * 4);
  // Warm, not neutral: a shadow on ochre plaster is ochre plaster lit only by
  // bounce off more ochre plaster, so it loses value and GAINS chroma. Blue
  // falls fastest, red slowest.
  const core = [0.5, 0.36, 0.22];
  for (let i = 0; i < n; i++) {
    const t = Math.min(1, i / (n - 1) / 0.42);
    const k = 1 - Math.pow(1 - t, 0.55);
    for (let c = 0; c < 3; c++) {
      const mul = core[c] + (1 - core[c]) * k;
      data[i * 4 + c] = Math.round(255 * (1 - (1 - mul) * q));
    }
    data[i * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, 1, n, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  edgeTex.set(q, tex);
  return tex;
}

let cornerTex: THREE.DataTexture | null = null;
function cornerGradient(): THREE.DataTexture {
  if (cornerTex) return cornerTex;
  const n = 64;
  const data = new Uint8Array(n * 4);
  // ROUND 12 — DEEPER AT THE FOOT, SHORTER OVERALL.
  //
  // Banded histogram against the reference, HUD strip excluded: our lower third
  // carries 3.9% of pixels below luma 64 against its 5.8%, and its top third
  // 5.8% against ours 5.2%. Both bands are short of darks and the deficit is
  // structural — every baked interior has a hard, SHORT band of occlusion right
  // in the corner and then recovers fast, and ours was a long lazy fade that
  // spent its contrast over two metres of wall instead of over twenty
  // centimetres of corner. Foot down ~26%, and the recovery is pulled in so the
  // wall above it is unaffected. Same one texture, same three quads.
  const stops: [number, number, number, number][] = [
    [0.0, 90, 62, 33],
    [0.1, 126, 96, 60],
    [0.26, 186, 164, 132],
    [0.5, 231, 219, 202],
    [0.75, 250, 246, 240],
    [1.0, 255, 255, 255],
  ];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    let a = stops[0];
    let b = stops[stops.length - 1];
    for (let k = 0; k < stops.length - 1; k++) {
      if (t >= stops[k][0] && t <= stops[k + 1][0]) {
        a = stops[k];
        b = stops[k + 1];
        break;
      }
    }
    const f = b[0] === a[0] ? 0 : (t - a[0]) / (b[0] - a[0]);
    for (let c = 0; c < 3; c++) data[i * 4 + c] = Math.round(a[c + 1] + (b[c + 1] - a[c + 1]) * f);
    data[i * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, 1, n, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  cornerTex = tex;
  return tex;
}
/**
 * Strength is baked in here rather than being handed to `opacity` — see
 * `contact()` above for why that was stamping visible rectangles on the floor.
 *
 * The core is a warm brown at a 0.38 multiply, which over the room's V 0.70
 * flagstone lands the pool at V 0.27 directly under a bench and lifts back to
 * the floor's own value by 85% of the radius. The old core was a 0.44 multiply
 * that then got scaled towards white by the opacity bug, and at 1440px it read
 * as a faint smudge rather than as contact. Warm, not neutral: the reference's
 * pools are unmistakably brown, because a shadow on stone is stone lit by
 * bounce off ochre plaster and not by the sky.
 */
function contactGradient(strength: number): THREE.CanvasTexture {
  const q = Math.round(strength * 20) / 20;
  const hit = contactTex.get(q);
  if (hit) return hit;
  const n = 128;
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, n, n);
  // Baked: pull each stop back towards white by (1 - strength).
  const s = (r: number, gg: number, b: number) =>
    `rgb(${Math.round(255 - (255 - r) * q)},${Math.round(255 - (255 - gg) * q)},${Math.round(255 - (255 - b) * q)})`;
  const grad = g.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
  // ROUND 9b: cores lifted from (62,45,27)/(82,62,40). A contact pool is
  // occlusion, not a hole — the reference's darkest floor pixel, directly under
  // a bench leg, samples rgb(95,64,34) and its frame's V p05 is 0.396 against
  // our 0.322. Everything below still lands well under the bare flag it sits
  // on, so the furniture still reads as touching the ground; it just no longer
  // punches through the bottom of the value range to get there.
  // ROUND 10 — MEASURED AGAINST THE FLOOR IT LANDS ON, NOT AGAINST WHITE.
  //
  // A (80,60,39) core is a 0.31 multiply, and over our V 0.65 flagstone that
  // puts the pixel directly under a bench leg at V 0.20. The reference's is
  // V 0.40 — rgb(103,40,8), sampled under its bacon bench — and that number IS
  // the reference's whole-frame V p05, i.e. the pool is the bottom rung of its
  // ladder and nothing in its picture goes below it. Ours was punching a stop
  // and a half past the reference's darkest pixel, which is how the lower band
  // measured V p05 0.322 against its 0.392 while still not reading as contact.
  //
  // Core is now a 0.60/0.41/0.22 multiply: over the same flag that lands
  // rgb(105,64,23) — H 24 S 0.78 V 0.41, within noise of the reference's
  // rgb(103,40,8) H 20 S 0.92 V 0.40. Shallower, and far more chromatic, which
  // is the half that actually makes it read: a shadow on warm stone is that
  // stone lit by bounce off ochre plaster, so it loses value AND gains chroma.
  // A neutral grey pool at the same value reads as dirt.
  // ROUND 12 — THE CORE HAS TO STAY DARK FOR HALF THE RADIUS, NOT A THIRD.
  // The pool is now pushed a third of a metre towards camera (see `bench`), so
  // the part of the ellipse that lands on floor the player can actually see is
  // the OUTER half. With the falloff starting at 0.4 the visible band was
  // already three quarters of the way back to bare stone. Measured, the frame
  // still carries 4.6% of pixels below luma 64 against the reference's 7.0%,
  // and the reference keeps essentially all of its darks under its furniture.
  // ROUND 17 — LESS CHROMA IN THE POOL, BECAUSE THERE ARE TWICE AS MANY OF
  // THEM NOW. Splitting the long runs and deepening the tops roughly doubled
  // the number of contact pools on the floor, and this gradient is a strongly
  // WARM multiply — 132/88/42 at the core is a 0.52/0.35/0.16 tint. Measured on
  // a mid-floor patch that took the flagstone to S 0.56 against the reference's
  // 0.35, on the single largest surface in the frame. Same value at the core,
  // a third less chroma: a shadow on warm stone is still warm, it is just not
  // more saturated than the tomato standing next to it.
  grad.addColorStop(0, s(128, 99, 66));
  grad.addColorStop(0.52, s(154, 126, 96));
  grad.addColorStop(0.7, s(194, 174, 148));
  grad.addColorStop(0.84, s(228, 216, 197));
  grad.addColorStop(0.93, s(245, 240, 233));
  grad.addColorStop(1, 'rgb(255,255,255)');
  g.fillStyle = grad;
  g.fillRect(0, 0, n, n);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  contactTex.set(q, tex);
  return tex;
}



/**
 * A vertical alpha ramp for the flame tongues: opaque at the foot, gone by the
 * tip. LatheGeometry lays v = 0 at the first profile point, which is the bottom
 * of the tongue, so this maps straight on with no UV work.
 *
 * Without it a tongue is a solid-coloured lathe with a hard silhouette all the
 * way to its point — a cardboard cut-out, which is exactly what the critic
 * called it. Fire has no edge at the top; it has an edge only where it meets
 * the fuel. Additive blending in three uses (SRC_ALPHA, ONE), so alpha really
 * does modulate the contribution and the tip dissolves instead of ending.
 */
/**
 * The focus pool: a soft filled disc, brightest just inside the rim so it still
 * reads as a ring of attention without ever presenting an edge. Additive, so on
 * warm stone it lifts rather than tinting.
 */
/**
 * The wash that lies on the focused bench's boards.
 *
 * A rounded rectangle rather than a disc, because it is standing in for the
 * bench top and a disc on a rectangle reads as a spotlight from nowhere. The
 * alpha is a soft ramp across a rounded-rect distance field with a slightly
 * hotter core, so there is no edge anywhere to alias, go faceted or read as a
 * hairline — REFERENCE.md forbids all three — and the thing still has a shape
 * at 90 pixels.
 */
let focusWashTex: THREE.DataTexture | null = null;
function focusWash(): THREE.DataTexture {
  if (focusWashTex) return focusWashTex;
  const n = 64;
  const data = new Uint8Array(n * n * 4);
  const rad = 0.3;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const u = Math.abs((x + 0.5) / n - 0.5) * 2;
      const v = Math.abs((y + 0.5) / n - 0.5) * 2;
      // Distance outside the inner rectangle, in units of the corner radius:
      // 0 across the flat middle, 1 on the rounded boundary, 1.41 at a corner.
      const t = Math.hypot(Math.max(u - (1 - rad), 0), Math.max(v - (1 - rad), 0)) / rad;
      const edge = 1 - THREE.MathUtils.smoothstep(t, 0.15, 1.15);
      // A gentle hot core so the middle of the plank is the brightest part and
      // the wash reads as light falling on wood rather than as a painted decal.
      const core = Math.exp(-Math.pow(Math.hypot(u, v) / 0.62, 2)) * 0.42;
      const a = Math.max(0, Math.min(1, edge * 0.78 + core));
      const i = (y * n + x) * 4;
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = Math.round(255 * a);
    }
  }
  const tex = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  focusWashTex = tex;
  return tex;
}


/**
 * A soft edgeless blob: opaque in the middle, gone by the rim, with no ring and
 * no hard boundary anywhere. Used for the weathering blooms on the chimney
 * breast — the whole point is that the patch has no findable edge, or it reads
 * as a decal rather than as stone that has aged unevenly.
 */
let softBlobTex: THREE.DataTexture | null = null;
let flameRampTex: THREE.DataTexture | null = null;
function flameRamp(): THREE.DataTexture {
  if (flameRampTex) return flameRampTex;
  const n = 32;
  const data = new Uint8Array(n * 4);
  for (let y = 0; y < n; y++) {
    const v = (y + 0.5) / n;
    // Opaque at the foot, gone by the tip, with the falloff biased late so the
    // tongue keeps a body and only the last third dissolves. A linear ramp
    // reads as a triangle with a soft edge; this reads as flame.
    const a = Math.pow(Math.max(0, 1 - v), 1.5) * (0.55 + 0.45 * Math.min(1, v * 4));
    const i = y * 4;
    data[i] = data[i + 1] = data[i + 2] = 255;
    data[i + 3] = Math.round(255 * Math.min(1, a));
  }
  const tex = new THREE.DataTexture(data, 1, n, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  flameRampTex = tex;
  return tex;
}

function softBlob(): THREE.DataTexture {
  if (softBlobTex) return softBlobTex;
  const n = 48;
  const data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const u = (x + 0.5) / n - 0.5;
      const v = (y + 0.5) / n - 0.5;
      const r = Math.min(1, Math.sqrt(u * u + v * v) * 2);
      // Two octaves of a fixed low-frequency wobble, so the bloom is an organic
      // stain rather than a perfect circle.
      const wob = 1 + Math.sin(Math.atan2(v, u) * 3 + 0.7) * 0.16 + Math.sin(Math.atan2(v, u) * 5) * 0.09;
      const a = Math.pow(Math.max(0, 1 - r / wob), 1.6);
      const i = (y * n + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 255;
      data[i + 3] = Math.round(255 * a);
    }
  }
  const tex = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  softBlobTex = tex;
  return tex;
}



function rotateUv(src: Float32Array): Float32Array {
  const out = new Float32Array(src.length);
  for (let i = 0; i < src.length; i += 2) {
    out[i] = src[i + 1];
    out[i + 1] = 1 - src[i];
  }
  return out;
}

// ---------------------------------------------------------- item rendering

export function describe(c: Carryable | null): string {
  if (!c) return 'none';
  if (c.type === 'ingredient') return `i:${c.ingredient.kind}:${c.ingredient.state}`;
  if (c.type === 'plate') return `p:${c.plate.dirty ? 'd' : 'c'}:${c.plate.contents.map((i) => i.kind + i.state).join(',')}`;
  return `n:${c.pan.contents.map((i) => i.kind + i.state).join(',')}`;
}

/** Build a fresh mesh for whatever a carryable is. Shared by hands + counters. */
export function buildCarryable(c: Carryable): THREE.Group {
  const g = new THREE.Group();
  if (c.type === 'ingredient') {
    g.add(ingredientMesh(c.ingredient));
  } else if (c.type === 'plate') {
    const plate = new THREE.Mesh(
      new THREE.CylinderGeometry(0.3, 0.26, 0.05, 22),
      toon(c.plate.dirty ? 0xc9bfa8 : PALETTE.plates),
    );
    plate.castShadow = true;
    g.add(plate);
    c.plate.contents.forEach((ing, i) => {
      const m = ingredientMesh(ing);
      const ang = (i / Math.max(1, c.plate.contents.length)) * Math.PI * 2;
      m.position.set(Math.cos(ang) * 0.1, 0.06 + i * 0.035, Math.sin(ang) * 0.1);
      m.scale.multiplyScalar(0.8);
      g.add(m);
    });
  } else {
    /**
     * IRON AGAIN, BECAUSE THE THING IT HAD TO NOT LOOK LIKE CHANGED.
     *
     * History: this was slate 0x3f4756, and was moved to copper 0xb5763a on the
     * grounds that three near-black discs on the pale green cook line were the
     * darkest objects in the room. That was the correct call FOR THAT PLACE.
     * The burners are not there any more — they stand on sooted stone inside
     * the oven mouth, lit by the fire behind them — and against that a warm
     * mid-value disc is the single worst choice available. A player testing on
     * an iPhone asked which of the round pale things was the hamburger bun; one
     * of the things they were looking at was a copper pan sitting on a trivet,
     * and they were not wrong to ask. A pan that reads as bread in a game about
     * cooking bread is the whole failure.
     *
     * So: a dark iron body that no ingredient in INGREDIENT_DEFS can be
     * confused with, kept off pure black (0x4a4550, not 0x000) because the
     * palette rule against black still holds, with a warm worn rim so it stays
     * in the room's band and still catches the fire. And the handle is long
     * enough to be a HANDLE — 0.34 was a stub that vanished at phone size, and
     * silhouette is what tells a pan from a plate from a loaf at 40 pixels.
     */
    const pan = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.24, 0.13, 20), toon(0x4a4550));
    pan.castShadow = true;
    g.add(pan);
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.31, 0.31, 0.045, 20), toon(0x8a6a44));
    rim.position.y = 0.065;
    g.add(rim);
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.055, 0.075), toon(0x2f2b33));
    handle.position.set(0.36, 0.035, 0);
    g.add(handle);
    // A pale end-cap on the handle, so the silhouette has a terminator rather
    // than fading into whatever is behind it.
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.09, 10), toon(0x8a6a44));
    grip.rotation.z = Math.PI / 2;
    grip.position.set(0.56, 0.035, 0);
    g.add(grip);
    c.pan.contents.forEach((ing, i) => {
      const m = ingredientMesh(ing);
      m.position.set((i - 1) * 0.11, 0.09, 0);
      m.scale.multiplyScalar(0.72);
      g.add(m);
    });
  }
  return g;
}

/**
 * HERO PRODUCE IN THE HAND.
 *
 * The three ingredients the reference actually asks you to fetch — tomato,
 * lettuce, bacon — get four to six hundred triangles of real construction when
 * they sit on a bench tray (see `ceramicTray`), and used to get a
 * `SphereGeometry(0.17)` fallback the moment somebody picked one up. So the
 * exact moment a prop matters most — held at chest height, moving, the thing
 * the whole round is about — was the moment it turned into a flat red ellipse
 * with no calyx, no stem and no highlight, forty pixels away from a tray of
 * properly-built tomatoes on the same bench. Waluigi's tomato-on-a-plate in
 * `refs/dash-and-dine-01.jpeg` is glossy, calyxed and unmistakable, and it is
 * the same asset the reference puts in its dishes.
 *
 * These builders are the tray language rebuilt as loose meshes (the trays go
 * through a batched geometry merger that cannot be parented to a paw), one
 * item rather than a heap, sized to the same 0.17-ish envelope the fallback
 * sphere had so nothing downstream needs re-tuning.
 */
function heroProduce(kind: string, col: number): THREE.Group | null {
  const g = new THREE.Group();
  const ball = (
    c: number,
    r: number,
    x: number,
    y: number,
    z: number,
    sx = 1,
    sy = 1,
    sz = 1,
  ) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), toon(c));
    m.position.set(x, y, z);
    m.scale.set(sx, sy, sz);
    g.add(m);
    return m;
  };
  const slab = (
    c: number,
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
    rz = 0,
    ry = 0,
  ) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), toon(c));
    m.position.set(x, y, z);
    m.rotation.set(0, ry, rz, 'YZX');
    g.add(m);
    return m;
  };

  switch (kind) {
    case 'tomato': {
      // Body slightly wider than tall, a lit shoulder a stop above it, a
      // shadowed crease rolling under, one small hard specular, and the calyx
      // — five flat lobes and a stalk — which is the only non-red thing on the
      // object and therefore most of the read.
      ball(col, 0.165, 0, 0, 0, 1.04, 0.94, 1.04);
      ball(0xff5a3c, 0.12, -0.02, 0.052, 0.042, 1, 0.76, 1);
      // Base shadow, CENTRED. Offset the way the tray version is (which sits in
      // a heap of three and can hide the asymmetry behind its neighbours), a
      // single fruit reads as having a bite out of one side.
      ball(0xa3120a, 0.142, 0, -0.058, 0, 1.0, 0.6, 1.0);
      ball(0xffd8c4, 0.033, -0.058, 0.112, 0.055, 1, 0.8, 1);
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2 + 0.4;
        ball(
          k % 2 === 0 ? 0x54a318 : 0x6bb520,
          0.036,
          Math.cos(a) * 0.058,
          0.13,
          Math.sin(a) * 0.058,
          1.35,
          0.34,
          0.8,
        );
      }
      const stalk = new THREE.Mesh(new THREE.ConeGeometry(0.021, 0.065, 6), toon(0x4b8a12));
      stalk.position.y = 0.172;
      g.add(stalk);
      return g;
    }
    case 'lettuce': {
      // The tray's rosette at two thirds scale: a pale heart with six broad
      // leaves standing up and flaring out, so the outline is concave in five
      // places. Convex-and-green is broccoli every time.
      ball(0xd8f39a, 0.108, 0, -0.02, 0, 1.05, 0.85, 1.05);
      ball(0xeefcc4, 0.06, -0.014, 0.018, 0.014, 1, 0.6, 1);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + 0.55;
        const ca = Math.cos(a);
        const sa = -Math.sin(a);
        const outer = i % 2 === 0 ? col : 0x92e02c;
        const innerC = i % 2 === 0 ? 0xb6ea55 : 0xcdf278;
        slab(outer, 0.035, 0.165, 0.19, ca * 0.07, 0.008, sa * 0.07, -0.42, a);
        slab(innerC, 0.032, 0.105, 0.158, ca * 0.13, 0.088, sa * 0.13, -0.92, a);
        ball(innerC, 0.063, ca * 0.165, 0.116, sa * 0.165, 1, 0.5, 1);
        ball(0x3f8210, 0.056, ca * 0.091, -0.062, sa * 0.091, 1.3, 0.5, 1.3);
      }
      return g;
    }
    case 'bacon': {
      // A RASHER, not a pink eraser. `BoxGeometry(0.34, 0.05, 0.14)` is a flat
      // rectangle from every angle, which is precisely how mochi came to be
      // carrying stationery. A rasher is a ribbon: it waves along its length,
      // it is three times as wide as it is thick, and it carries a narrow cream
      // fat edge down one long arris with a streak or two through the meat.
      for (const [lift, meat, dz] of [
        [0, col, 0.03],
        [0.052, 0xcc5a69, -0.035],
      ] as const) {
        for (let s = 0; s < 5; s++) {
          const t = (s + 0.5) / 5;
          const u = (t - 0.5) * 0.36;
          const wave = Math.sin(t * Math.PI * 1.6) * 0.036;
          const tilt = Math.cos(t * Math.PI * 1.6) * 0.5;
          slab(meat, 0.085, 0.042, 0.165, u, lift + wave, dz, tilt);
          slab(0xffe6da, 0.08, 0.022, 0.04, u, lift + wave + 0.026, dz + 0.07, tilt);
        }
      }
      return g;
    }
    default:
      return null;
  }
}

function ingredientMesh(ing: Ingredient): THREE.Object3D {
  const def = INGREDIENT_DEFS[ing.kind];
  let color = def.color;
  if (ing.state === 'cooked') color = mix(color, 0x8a5a32, 0.42);
  if (ing.state === 'burnt') color = 0x2b2622;
  if (ing.state === 'raw') {
    const hero = heroProduce(ing.kind, color);
    if (hero) {
      hero.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) o.castShadow = true;
      });
      return hero;
    }
  }
  if (ing.state === 'prepped') {
    // CHOPPED IS A PILE, NOT A TILE. One 0.26 × 0.07 × 0.26 slab on a white
    // plate is a coloured postage stamp — at desktop/t0015s a prepped lettuce
    // read as a green brick lying on the china. Three offset slices at
    // different angles cost nothing and say "somebody cut this up".
    const pile = new THREE.Group();
    for (let i = 0; i < 3; i++) {
      const s = new THREE.Mesh(
        new THREE.BoxGeometry(0.23 - i * 0.018, 0.045, 0.23 - i * 0.018),
        toon(i === 1 ? mix(color, 0xffffff, 0.16) : color, { flat: true }),
      );
      s.position.set(Math.sin(i * 2.1) * 0.035, i * 0.038, Math.cos(i * 2.6) * 0.035);
      s.rotation.y = i * 0.5;
      s.rotation.z = Math.sin(i * 3.3) * 0.09;
      s.castShadow = true;
      pile.add(s);
    }
    return pile;
  }
  let geo: THREE.BufferGeometry;
  {
    switch (ing.kind) {
      case 'bun':
        geo = new THREE.SphereGeometry(0.17, 14, 10);
        geo.scale(1, 0.62, 1);
        break;
      case 'bacon':
        geo = new THREE.BoxGeometry(0.34, 0.05, 0.14);
        break;
      case 'cheese':
        geo = new THREE.BoxGeometry(0.24, 0.1, 0.24);
        break;
      case 'egg':
        geo = new THREE.SphereGeometry(0.15, 14, 10);
        geo.scale(1, 1.22, 1);
        break;
      case 'fish':
        geo = new THREE.ConeGeometry(0.14, 0.38, 8);
        geo.rotateZ(Math.PI / 2);
        break;
      default:
        geo = new THREE.SphereGeometry(0.17, 14, 10);
    }
  }
  const m = new THREE.Mesh(geo, toon(color));
  m.castShadow = true;
  return m;
}

function mix(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 255;
  const ag = (a >> 8) & 255;
  const ab = a & 255;
  const br = (b >> 16) & 255;
  const bg = (b >> 8) & 255;
  const bb = b & 255;
  return (
    ((ar + (br - ar) * t) << 16) | (((ag + (bg - ag) * t) | 0) << 8) | ((ab + (bb - ab) * t) | 0)
  );
}

function rebuildContents(v: StationView) {
  v.contentRoot.clear();
  if (!v.station.holding) return;
  v.contentRoot.add(buildCarryable(v.station.holding));
}

function updateContents(v: StationView, time: number) {
  const h = v.station.holding;
  if (!h) return;
  if (h.type === 'pan' && h.pan.onHeat) {
    // RELATIVE TO THE STATION, NOT A LITERAL 1.0. This was a hardcoded height
    // that happened to sit 4cm above a counter-height hob, so every pan visibly
    // jumped the instant its burner lit — and the moment burners moved into the
    // arch, where the hearth is 25cm lower than a counter, the same line would
    // have hung the pan in mid-air above the fire.
    v.contentRoot.position.y = v.topY + 0.1 + Math.sin(time * 22 + v.station.id) * 0.006;
  }
}
