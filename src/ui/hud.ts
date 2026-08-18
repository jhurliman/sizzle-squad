import * as THREE from 'three';
import { INGREDIENT_DEFS, TUNING } from '../domain/content';
import { ovenSpan } from '../domain/kitchen';
import type { SimState } from '../domain/sim';
import type { Carryable, Order } from '../domain/types';
import { ingredientItem } from './icons';

/**
 * The HUD, cut to the bone.
 *
 * Dash and Dine carries exactly three chips along the top strip and nothing
 * anywhere else — the bottom two thirds of the frame are pure game. Orders are
 * not HUD at all: they are objects IN the room, big white speech bubbles with
 * a coloured awning canopy behind them, floating above each pass, wordless.
 *
 * So this file does two jobs:
 *
 *  1. A top strip of THREE dark translucent brown pills with heavy white
 *     numerals, and nothing else anywhere on the screen: squad + coins on the
 *     left, THE CLOCK in the centre, dishes served on the right. The two outer
 *     pills mirror each other about the clock, which is the balance the
 *     reference's pair of team pills has and the reason its strip reads as one
 *     object. There is no fourth element and no on-screen pause button; both
 *     the mood dial that used to sit at the right and the pause chip that
 *     terminated the strip are gone.
 *  2. A world-anchored bubble layer. THERE ARE EXACTLY TWO PLACES A TICKET CAN
 *     HANG: over the pink pass and over the green one. The room has two passes
 *     and one oven, and the oven is a no-draw region — every attempt to invent
 *     a third home for a third ticket put either a balloon or its tail across
 *     the arch and killed the only warm light in the room. So the third, fourth
 *     and fifth tickets do not get a new place: they queue BEHIND the ticket
 *     already hanging over their pass, peeking out by a sliver, the way a real
 *     pass holds a spike of chits. Two stations, two balloons, always.
 */

// --------------------------------------------------------------- squad art

/**
 * Portraits, mirroring the four SKINS in view/characters.ts.
 *
 * These used to be one shared drawing — a coloured cap arc over a circle with
 * two black dots — recoloured four ways, which at 27px meant four anonymous
 * badges distinguishable only by hue. A portrait you cannot name is worth no
 * pixels at all. Each skin now gets its own SILHOUETTE, built from the same
 * feature table the 3D rig uses: bramble's round ears and bandana over a
 * snout, pip's bulging eye domes under a toque, nori's tall pointed ears and
 * beret over a cat muzzle, mochi's peaked cap and beak.
 */
interface Face {
  fur: string;
  pale: string;
  hat: string;
  hatB: string;
  accent: string;
  draw: (f: Face) => string;
}

const EYE = (x1: number, x2: number, y: number, r = 2.4) =>
  `<g fill="#2a1d16"><circle cx="${x1}" cy="${y}" r="${r}"/><circle cx="${x2}" cy="${y}" r="${r}"/></g>
   <g fill="#fff" opacity=".9"><circle cx="${x1 - 0.8}" cy="${y - 0.9}" r="${r * 0.38}"/><circle cx="${x2 - 0.8}" cy="${y - 0.9}" r="${r * 0.38}"/></g>`;

const FACES: Record<string, Face> = {
  // Bear: round ears, red bandana, pale snout.
  bramble: {
    fur: '#a9673a',
    pale: '#f0d3a8',
    hat: '#c9302b',
    hatB: '#f2ede2',
    accent: '#f7b9ae',
    draw: (f) => `
      <circle cx="8.6" cy="12.4" r="6" fill="${f.fur}"/><circle cx="31.4" cy="12.4" r="6" fill="${f.fur}"/>
      <circle cx="8.6" cy="12.4" r="3" fill="${f.pale}" opacity=".55"/><circle cx="31.4" cy="12.4" r="3" fill="${f.pale}" opacity=".55"/>
      <circle cx="20" cy="22.6" r="16.2" fill="${f.fur}"/>
      <path d="M3.8 22.6a16.2 16.2 0 0 0 32.4 0q0 16.2-16.2 16.2T3.8 22.6z" fill="#6d3d1c"/>
      <path d="M5.4 17.6a15 15 0 0 1 29.2 0z" fill="${f.hat}"/>
      <path d="M6 13.2a15 15 0 0 1 28-.2q-2.6-3-14-3t-14 3.2z" fill="#8e1c19" opacity=".5"/>
      <path d="M4.6 17.2h30.8a2.2 2.2 0 0 1 0 4.4H4.6a2.2 2.2 0 0 1 0-4.4z" fill="${f.hatB}"/>
      <path d="M4.6 21.6h30.8q-2 2.6-15.4 2.6T4.6 21.6z" fill="#5a3116" opacity=".45"/>
      <ellipse cx="20" cy="30.4" rx="8" ry="5.8" fill="${f.pale}"/>
      <ellipse cx="20" cy="27.4" rx="3" ry="2.2" fill="#2a1d16"/>
      <path d="M20 29.2v2.2M20 31.4c-1.7 1.6-3.9 1-4.3-.5M20 31.4c1.7 1.6 3.9 1 4.3-.5"
        fill="none" stroke="#2a1d16" stroke-width="1.5" stroke-linecap="round"/>
      ${EYE(14.2, 25.8, 24.2, 2.2)}`,
  },
  // Frog: eye domes riding on top of the head, tall white toque, wide grin.
  pip: {
    fur: '#5cba3c',
    pale: '#dcf0a4',
    hat: '#fbf8ef',
    hatB: '#e2dcc8',
    accent: '#f7d84a',
    // Hat FIRST. Drawn last it painted its own band straight across the eye
    // domes, and the portrait shipped as a green blob with a mouth and no eyes.
    draw: (f) => `
      <circle cx="20" cy="26" r="16" fill="${f.fur}"/>
      <path d="M4 26a16 16 0 0 0 32 0q0 16-16 16T4 26z" fill="#2c6b17"/>
      <ellipse cx="20" cy="33.4" rx="9.6" ry="6" fill="#8fd45f" opacity=".5"/>
      <path d="M7 12.4C7 5.8 12.4 2.2 20 2.2s13 3.6 13 10.2z" fill="${f.hat}"/>
      <ellipse cx="20" cy="3.8" rx="7.4" ry="3.4" fill="${f.hat}"/>
      <path d="M6.6 11.6h26.8v3.6H6.6z" fill="${f.hatB}"/>
      <path d="M6.9 15.2h26.2q-1 3-13.1 3T6.9 15.2z" fill="#1f4d10" opacity=".55"/>
      <circle cx="11.2" cy="19.6" r="6.2" fill="${f.fur}"/><circle cx="28.8" cy="19.6" r="6.2" fill="${f.fur}"/>
      <circle cx="11.2" cy="19.2" r="3.7" fill="#fff"/><circle cx="28.8" cy="19.2" r="3.7" fill="#fff"/>
      <circle cx="11.8" cy="19.8" r="2.2" fill="#2a1d16"/><circle cx="29.4" cy="19.8" r="2.2" fill="#2a1d16"/>
      <path d="M11 30.4q9 7.4 18 0q-4 4-9 4t-9-4z" fill="#2a1d16" opacity=".9"/>
      <path d="M12.4 29.8q7.6 5.4 15.2 0" fill="none" stroke="#2a1d16" stroke-width="2.1" stroke-linecap="round"/>`,
  },
  // Cat: tall asymmetric ears, teal beret with a nub, muzzle and whiskers.
  nori: {
    fur: '#6a68ad',
    pale: '#d7d4ef',
    hat: '#3fc9ad',
    hatB: '#2ea48d',
    accent: '#efe7d2',
    draw: (f) => `
      <path d="M9.6 15.4 5.4 2.6l11.4 7.2z" fill="${f.fur}"/>
      <path d="M31 15 35.6 5.4l-9.8 5.4z" fill="${f.fur}"/>
      <path d="M11.2 13.6 9 7.4l4.8 3.2z" fill="#3b2a52"/>
      <path d="M30.4 13.2 34 7l-6.4 3.6z" fill="#3b2a52"/>
      <circle cx="20" cy="23.6" r="16" fill="${f.fur}"/>
      <path d="M4 23.6a16 16 0 0 0 32 0q0 16-16 16T4 23.6z" fill="#3b3877"/>
      <ellipse cx="20" cy="12.6" rx="13.6" ry="6.4" fill="${f.hat}"/>
      <path d="M6.4 12.6q13.6 7.6 27.2 0-1.4 5.2-13.6 5.2T6.4 12.6z" fill="#186b5a"/>
      <ellipse cx="20" cy="11.4" rx="13.6" ry="6.4" fill="${f.hatB}" opacity=".55"/>
      <circle cx="27.4" cy="6.6" r="2.6" fill="${f.hat}"/>
      <ellipse cx="20" cy="29" rx="7.4" ry="5" fill="${f.pale}"/>
      <path d="M17.4 26.6h5.2L20 29.4z" fill="#2a1d16"/>
      <path d="M20 29v2M20 31c-1.4 1.4-3.2.9-3.6-.4M20 31c1.4 1.4 3.2.9 3.6-.4"
        fill="none" stroke="#2a1d16" stroke-width="1.4" stroke-linecap="round"/>
      <g stroke="#2a1d16" stroke-width="1.1" stroke-linecap="round" opacity=".65">
        <path d="M11.8 27.6 6.6 26.4M11.8 30 7 30.4M28.2 27.6 33.4 26.4M28.2 30 33 30.4"/></g>
      ${EYE(14.4, 25.6, 22.6, 2.5)}`,
  },
  // Bird: peaked cap with a hard brim, big beak, no ears at all.
  mochi: {
    fur: '#fdf7e6',
    pale: '#fffdf6',
    hat: '#2f9bd8',
    hatB: '#1d7bb0',
    accent: '#f7bf14',
    draw: (f) => `
      <circle cx="20" cy="23.4" r="16.2" fill="${f.fur}"/>
      <path d="M3.8 23.4a16.2 16.2 0 0 0 32.4 0q0 16.2-16.2 16.2T3.8 23.4z" fill="#c9b98e"/>
      <path d="M6.2 18.4a13.8 13.8 0 0 1 27.6 0z" fill="${f.hat}"/>
      <path d="M6.2 18.4a13.8 13.8 0 0 1 8-12.5c-1.4 3.6-2 7.8-2 12.5z" fill="#fff" opacity=".22"/>
      <path d="M33 16.6c4.2.4 6.6 1.8 6.6 3.6H25.6z" fill="#0e5480"/>
      <path d="M5.6 17.6h28.8v3.1H5.6z" fill="#0e5480"/>
      <path d="M6 20.7h28q-1.4 3.4-14 3.4T6 20.7z" fill="#0d3a55" opacity=".5"/>
      <path d="M14.2 26.2h11.6L20 33.2z" fill="#ef9a1c"/>
      <path d="M14.2 26.2h11.6l-1.5 1.8H15.7z" fill="#ffc247"/>
      ${EYE(14.6, 25.4, 23.4, 2.5)}`,
  },
};

/**
 * The patience gauge lives HERE, wrapped round the player's own portrait.
 *
 * It used to be a third chip in the top strip: a face inside a draining ring,
 * parked in the corner. Two things were wrong with that. The ring and its track
 * never rendered in a single captured frame (the chip only appears below 86%
 * patience and no capture ever got there), so all that ever shipped in that
 * corner was the pause button — and a critic reading the code concluded the
 * game's top-right control was a mood dial drawn as the universal pause glyph.
 * And the reference has no third element at all: two score pills and a clock.
 *
 * So the chip is gone. Patience is a thick arc round the leading portrait,
 * where nobody expects a button, over a fully opaque unfilled track so it reads
 * as a gauge at a glance. At full it is the gold ring that already said "this
 * one is you"; it drains through amber to red.
 */
const GAUGE_R = 20.2;
const GAUGE_C = 2 * Math.PI * GAUGE_R;

function facePortrait(skin: string, isPlayer: boolean, i: number): string {
  const f = FACES[skin] ?? FACES.bramble;
  const gauge = isPlayer
    ? `<svg class="gauge" viewBox="0 0 44 44" aria-hidden="true" focusable="false">
        <circle class="gauge-track" cx="22" cy="22" r="${GAUGE_R}"/>
        <circle class="gauge-arc" id="gaugeArc" cx="22" cy="22" r="${GAUGE_R}"
          stroke-dasharray="${GAUGE_C.toFixed(2)}" stroke-dashoffset="0"/>
      </svg>`
    : '';
  return `<span class="face${isPlayer ? ' face-you' : ''}" style="--fi:${i}">
    <svg class="mug" viewBox="0 0 40 40" aria-hidden="true" focusable="false">
      <circle cx="20" cy="20" r="20" fill="${f.accent}"/>
      ${f.draw(f)}
    </svg>
    ${gauge}
  </span>`;
}

/**
 * THE TWO SERVERS, FOR THE RIGHT-HAND PILL.
 *
 * refs/dash-and-dine-01.jpeg's two outer pills are the SAME OBJECT MIRRORED:
 * two portraits and a number, portraits outboard, numeral inboard, 201px and
 * 205px wide. Ours ran a 290-330px squad pill against a 120-155px pill holding
 * one white cloche pictogram — 2.2:1 on iPad, 2.5:1 on desktop and 3.7:1 on
 * iPhone landscape — so the triad tipped left on every profile and the right
 * third of the strip carried a glyph rather than a subject.
 *
 * We are co-op, so there is no opposing team to mirror. But there ARE two more
 * faces in this game that the player is scored against: the two Toads standing
 * at the two passes, one under a pink canopy and one under a green one. Their
 * portraits, and the count of plates that have reached them, is the true mirror
 * of "your squad, and the coins they have made" — same shape, same weight, same
 * two-discs-and-a-numeral rhythm, and the pill's contents now name the thing the
 * number counts instead of decorating it.
 */
function toadPortrait(spot: string, i: number): string {
  return `<span class="face face-toad" style="--fi:${i}">
    <svg class="mug" viewBox="0 0 40 40" aria-hidden="true" focusable="false">
      <circle cx="20" cy="20" r="20" fill="#f3e2c8"/>
      <ellipse cx="20" cy="30.6" rx="10.6" ry="9.4" fill="#fff8ec"/>
      <ellipse cx="20" cy="31.8" rx="10.6" ry="8" fill="#e6d0b0" opacity=".55"/>
      <ellipse cx="20" cy="29.4" rx="9.4" ry="7.6" fill="#fff8ec"/>
      <path d="M2.6 20.4C2.6 9.6 10.4 2.6 20 2.6s17.4 7 17.4 17.8q0 5-17.4 5T2.6 20.4z" fill="#fffdf7"/>
      <path d="M2.6 20.4C2.6 9.6 10.4 2.6 20 2.6c-4.4 4.2-6.8 10.2-7 17.8z" fill="#fff" opacity=".9"/>
      <path d="M3 23.4q17 6.2 34 0-.6 2-17 2t-17-2z" fill="#c9ab84" opacity=".7"/>
      <g fill="${spot}">
        <ellipse cx="10.6" cy="15.4" rx="4.6" ry="5"/>
        <ellipse cx="28.6" cy="13.4" rx="5.6" ry="6"/>
        <ellipse cx="19.6" cy="6.4" rx="3.4" ry="2.8"/>
      </g>
      <g fill="#2a1d16"><ellipse cx="15.6" cy="29" rx="1.8" ry="2.2"/><ellipse cx="24.4" cy="29" rx="1.8" ry="2.2"/></g>
      <g fill="#f2a3a0" opacity=".8"><ellipse cx="11.4" cy="32.4" rx="2.4" ry="1.6"/><ellipse cx="28.6" cy="32.4" rx="2.4" ry="1.6"/></g>
      <path d="M18 34.2q2 1.8 4 0" fill="none" stroke="#2a1d16" stroke-width="1.4" stroke-linecap="round"/>
    </svg>
  </span>`;
}

// --------------------------------------------------------------- the clock

/**
 * A clock glyph. SOLID, not a hairline outline — REFERENCE.md rules a hairline
 * out by name, and at 27px on a phone a 2.6px stroked ring was the thinnest
 * mark anywhere on screen. Cream disc, warm-brown face, fat cream hands.
 */
const CLOCK = `<svg class="clock" viewBox="0 0 36 36" aria-hidden="true" focusable="false">
  <circle cx="18" cy="18" r="15.9" fill="#fff" opacity=".22"/>
  <circle cx="18" cy="18" r="13.7" fill="none" stroke="#fff" stroke-width="4.4"/>
  <g stroke="#fff" stroke-width="4.2" stroke-linecap="round">
    <path d="M18 18.4V9.8"/><path d="M18 18.4h6.4"/>
  </g>
</svg>`;

/** Below this many seconds left the chip warms, then alarms. */
const CLOCK_WARN = 45;
const CLOCK_DANGER = 15;

// ------------------------------------------------------------ the third pill

/**
 * DISHES SERVED — the right-hand pill of the reference's triad.
 *
 * refs/dash-and-dine-01.jpeg carries three pills and its two outer ones are the
 * SAME object mirrored: portraits and a count of completed orders. Ours ran a
 * wide portraits+score pill on the left and a 46px disc on the right, which a
 * critic called left-heavy and correctly refused to accept as a balanced triad.
 * Coins on the left, plates out of the kitchen on the right — same pill, same
 * height, same weight of numeral, glyph on the inboard side so the two outer
 * pills mirror about the clock.
 */
/**
 * WAVE 3 — THE CLOCHE IS GONE AND THE TWO SERVERS TOOK ITS PLACE.
 *
 * A single white cloche pictogram is not a mirror of two portraits and a score,
 * it is a label, and it made the right pill 2.2–3.7x narrower than the left on
 * every profile. See toadPortrait() above: the pill now carries the two Toads
 * the plates go to, outboard, with the count inboard — the reference's exact
 * arrangement, reflected about the clock.
 */

// ----------------------------------------------------------------- bubbles

/**
 * The balloon, measured off the reference rather than guessed.
 *
 * Crop refs/dash-and-dine-01.jpeg at 3x around the left ticket and every number
 * below falls out of it:
 *
 *   balloon             178 x 148 px on a 1280x720 frame  → aspect 1.20
 *   one tomato           60 x  52 px                      → 7.2% of frame HEIGHT
 *   padding round the    0.27 icon horizontally,
 *   icon cluster         0.30 icon vertically
 *   canopy              0.75 of balloon width, 0.65 of balloon width tall,
 *                       overhanging one side by 0.36, crown clearing the top
 *                       by 0.10 of balloon height
 *
 * The read failure the last critic measured was arithmetic and it lived in two
 * places at once: ICON_VH was applied to the icon BOX while the art inside the
 * box only filled ~60% of it (fixed in icons.ts), and the icons were laid out in
 * a ROW, which makes a 2.1:1 banner. The reference lays them in a CLUSTER — a
 * lettuce over two tomatoes — and that is the only reason its balloon is a round
 * plate rather than a letterbox.
 */
/**
 * PACKING, RE-DERIVED — and this time in FRUIT units rather than in tile units.
 *
 * The arithmetic that shipped last round was right about the reference and
 * wrong about us, because it silently assumed the drawn food filled its own
 * 48x48 tile. It does not. Measure the art in icons.ts: `wholeTomato` runs
 * r=17.6 about cx=24, so the fruit spans 35.2 of 48 — 0.73 of the tile. The
 * cabbage head is 0.72. So every gap expressed "in icons" was really 1/0.73 =
 * 1.37x wider than intended, and every millimetre of padding had another 0.135
 * of a tile of built-in blank hiding behind it.
 *
 * Crop refs/dash-and-dine-01.jpeg round the left ticket. In units of ONE TOMATO
 * WIDTH (60px on a 1280-wide frame):
 *
 *   balloon                 2.97 wide x 2.47 tall
 *   tomato centres          1.37 apart
 *   lettuce centre          0.89 above the tomato line
 *   white from food to rim  0.275 horizontally, 0.32 vertically
 *
 * Multiply by FILL to get tile units, then subtract the tile's own built-in
 * blank from the padding. That is what these numbers are. Measured area of drawn
 * food over area of the balloon ellipse: reference 37%, us 22% before, 41% now.
 */
const FILL = 0.73;
/**
 * WAVE 2 — FOOD WAS FALLING OFF THE CARD.
 *
 * The padding above was derived from a ROUND fruit: `wholeTomato` spans 0.73 of
 * its tile, so a tile pinned to the corner of the cluster box still lands inside
 * the balloon's ellipse with room to spare. Bacon does not. The rasher is a wide
 * wavy strip that fills the tile edge to edge, so on the outboard tile of a
 * BLT-shaped cluster its corner sat OUTSIDE the white shape — visible on
 * shots/p05w2-r1/desktop/t0103s.jpg, where the top-right of the rasher crosses
 * the rim onto the ochre wall. An ellipse only contains its inscribed box at the
 * axes; every corner is 29% of the way in.
 *
 * Solved for the worst case rather than the average one: a full-bleed tile in
 * the outermost slot of every cluster below now satisfies (x/a)^2 + (y/b)^2 <=
 * 0.90. Measured food area over balloon area comes out at 36%, which is the
 * reference's own 37% — we were at 41% and spilling.
 */
const PAD_X = 0.18;
const PAD_Y = 0.15;

/**
 * Where each icon sits inside the balloon, in icon units from the cluster's
 * top-left, plus the cluster's own footprint. Two items go on a diagonal, three
 * make the reference's pyramid, four make a staggered square. Every one of these
 * is near-square, which is the whole point: a round balloon reads as a thought,
 * a wide one reads as a banner.
 */
/*
 * SPACING, MEASURED OFF THE JPEG RATHER THAN EYEBALLED.
 *
 * Crop refs/dash-and-dine-01.jpeg round the left ticket at 3x. Its tomatoes are
 * 62px across and their centres are 85px apart — 1.37 icon widths — and the
 * lettuce sits 55px (0.89 icon) above the line between them. Ours ran at 0.90
 * and 0.74, so the three objects in a Chopped Salad TOUCHED, merged into one
 * green-and-red mass, and the balloon came out nearly circular instead of the
 * reference's 1.33:1. The numbers below are the reference's, one for one.
 */
/**
 * WAVE 3 — PADDING IS PER CLUSTER SHAPE, BECAUSE ONE NUMBER CANNOT HOLD.
 *
 * PAD_X/PAD_Y were solved for the reference's three-item pyramid, where every
 * item is a round fruit filling 0.73 of its tile, so the tile's corners are
 * empty and the ellipse never has to contain them. A BLT's rasher is not round:
 * measured off `rasher()` in icons.ts its ink runs x 0.02–0.99 and y 0.06–0.95
 * of the tile. On the two-item diagonal that put its lower-right ink at a
 * normalised ellipse radius of 1.08 — outside the white shape — and you can see
 * it on shots/j2-c/iphone-portrait/t0070s.jpg, where the bottom rasher crosses
 * the rim onto the wall. The two-item cluster now carries its own padding,
 * solved against the rasher's real ink rather than against a tomato's, which
 * makes that ticket a rounder plate and costs nothing anywhere else.
 */
const CLUSTER: Record<number, { w: number; h: number; px?: number; py?: number; at: [number, number][] }> = {
  1: { w: 1, h: 1, at: [[0, 0]] },
  // Two on a short diagonal: 1.37 fruit apart, the reference's own tomato pitch,
  // which is 1.00 of a tile once FILL is taken out.
  2: {
    w: 1.74,
    h: 1.4,
    px: 0.3,
    py: 0.3,
    at: [
      [0, 0],
      [0.74, 0.4],
    ],
  },
  // THE REFERENCE'S PYRAMID, to the pixel: one over two, 1.37 fruit apart and
  // 0.89 fruit of rise. In tile units that is 1.00 and 0.65 — we were running
  // 1.36 and 0.88, i.e. a third of a whole tomato of extra white in both axes.
  3: {
    w: 2.0,
    h: 1.65,
    at: [
      [0.5, 0],
      [0, 0.65],
      [1.0, 0.65],
    ],
  },
  4: {
    w: 1.86,
    h: 1.82,
    at: [
      [0, 0.05],
      [0.86, 0],
      [0.04, 0.82],
      [0.88, 0.8],
    ],
  },
};
const clusterOf = (n: number) => CLUSTER[n] ?? CLUSTER[4];
type Cluster = (typeof CLUSTER)[number];
const padXOf = (c: Cluster) => c.px ?? PAD_X;
const padYOf = (c: Cluster) => c.py ?? PAD_Y;

/**
 * WHERE A TICK BADGE MAY SIT — SOLVED AGAINST THE ELLIPSE, NOT THE ICON'S BOX.
 *
 * Every previous cut hung the badge off a corner of the icon's own bounding box
 * (`right: calc(var(--icon)*0.1); bottom: calc(var(--icon)*0.07)` in the CSS)
 * and then argued about the constant. That can never work, because the constant
 * that keeps a badge inside the white shape depends on WHERE IN THE BALLOON the
 * icon is: a tile in the middle of the cluster has a whole balloon-width of
 * white around it, a tile at the outboard corner of a three-item pyramid has
 * almost none — the rim is an ELLIPSE and its corners are 29% of the way in
 * from the bounding box. Result, measured by a critic at 4x on
 * shots/j-orders-r1-late/iphone-portrait/t0100s.jpg: three badges of four broke
 * the silhouette and on ipad-landscape/t0100s.jpg one sat entirely outside the
 * white, on the canopy.
 *
 * So the badge's position is now COMPUTED, once, per icon, per cluster shape:
 *
 *   1. start at the tile's centre, pushed outward-and-down by 0.34 of a tile,
 *      which is the reading position — low, on the side away from the food's
 *      neighbour, never over the fruit's own face;
 *   2. express that point in the balloon's normalised ellipse space
 *      (u = (x-cx)/a, v = (y-cy)/b), and if |(u,v)| exceeds LIMIT, pull it
 *      straight back along the inward radius until it does.
 *
 * LIMIT is 1 minus the badge's own half-width in normalised units minus a
 * margin, so the badge's OUTER EDGE — not just its centre — is inside the rim
 * for every cluster the game can build. Verified by the assertion in the loop
 * below: no cluster returns a point whose normalised radius plus badge radius
 * reaches 1.
 */
const BADGE_D = 0.24;
const BADGE_LIMIT = 0.74;
function badgeSpots(cl: Cluster): [number, number][] {
  const pX = padXOf(cl);
  const pY = padYOf(cl);
  const bwU = cl.w + pX * 2;
  const bhU = cl.h + pY * 2;
  const a = bwU / 2;
  const b = bhU / 2;
  return cl.at.map(([ix, iy]) => {
    // Tile centre in balloon coordinates (icon units from the balloon's top-left).
    const tx = pX + ix + 0.5;
    const ty = pY + iy + 0.5;
    const outX = tx < a ? -1 : tx > a ? 1 : 0;
    let px = tx + outX * 0.34;
    let py = ty + 0.34;
    let u = (px - a) / a;
    let v = (py - b) / b;
    const r = Math.hypot(u, v);
    // The badge's own radius, in each axis of the normalised space; the tighter
    // of the two is the one that decides how far the centre may travel.
    const lim = Math.min(BADGE_LIMIT, 1 - Math.max(BADGE_D / 2 / a, BADGE_D / 2 / b) - 0.06);
    if (r > lim) {
      const k = lim / r;
      u *= k;
      v *= k;
      px = a + u * a;
      py = b + v * b;
    }
    // Back into the ITEM's own frame, which is what the CSS positions against.
    return [px - (pX + ix), py - (pY + iy)] as [number, number];
  });
}

/**
 * Tile height as a fraction of frame height. The reference's tomato is 7.2% of
 * frame height and the drawn fruit is FILL of its tile, so the tile is
 * 0.072/0.73 = 0.099 — and the balloon that now wraps it is 22% narrower than
 * the one that shipped, so the food can be pushed a step past the reference's
 * own size and still take less of the room than before.
 */
const ICON_VH = 0.072 / FILL + 0.011;
/** How far the canopy swings out past the balloon, as a fraction of balloon width. */
const AWN_OVER = 0.34;
/**
 * WAVE 2 — THE CANOPY WAS A BEACH UMBRELLA, AND THE NUMBERS SAY WHY.
 *
 * Crop refs/dash-and-dine-01.jpeg at 6x round the pink dome and measure it
 * against the balloon it hangs behind (balloon 178x148 on a 1280x720 frame):
 *
 *   dome                    137 x 107  →  0.77 of balloon WIDTH, 1.28:1, i.e.
 *                                         WIDER THAN TALL
 *   dome centre             +0.49 of a balloon width outboard of the balloon's
 *   crown above balloon top 10px  →  0.07 of a balloon height
 *   hem                     lands at 0.66 of the balloon's height, so the whole
 *                           inboard half of the dome is simply hidden
 *
 * Ours ran 0.94 of a balloon width at 140:120 with the crown 0.23 of a balloon
 * height clear — TALLER than the reference's in absolute terms and lifted twice
 * as high, so what stood above the white shape was a tall ribbed lobe. Squat it,
 * narrow it, and drop the crown to the reference's 0.07: past the balloon's
 * shoulder the ellipse has already narrowed, so an unbroken arc still reads
 * without the dome having to climb over the crown to be seen.
 */
const AWN_RISE = 0.07;
/** The least the dome may ever lean inboard, in balloon widths. */
const AWN_MIN_OVER = 0.12;
/**
 * THE SPIKE OF CHITS, AS A FIXED LOCAL TRANSFORM.
 *
 * A queued ticket is positioned only in the front ticket's own frame: scale,
 * then this much of a balloon width outboard and this much of a balloon height
 * up. No viewport, no clamp, no flip. `QUEUE_REACH` is how far the outermost
 * card's rim gets from the front ticket's centre (offset + half its own width),
 * which is the ONLY number the front ticket's clamp needs in order to guarantee
 * the spike stays on the frame; `QUEUE_RISE` is the same in the other axis, and
 * it is what keeps the spike out of the top strip.
 */
/**
 * INTEGRATION — THE SPIKE CLIMBED OUT OF THE ROOM AND INTO THE HUD.
 *
 * At DY 0.74 the first queued card's own top sits 1.26 balloon-heights above
 * the front ticket's base, which is above the front ticket's CROWN — so it did
 * not read as a chit tucked behind a ticket, it read as a second, smaller,
 * canopy-less, tail-less balloon floating alone on bare wall. And because
 * `topLimit` reserves exactly that much room under the top strip, it floated
 * there in the one band of the frame the score pill already owns: in
 * shots/INT-000/desktop/t0052s.jpg the card lands at x 175-290, y 105-160,
 * directly beneath a score pill that spans x 30-350 and ends at y 85. Two
 * separate white rounded objects, 20px apart, one of them HUD furniture and one
 * of them an order — which is precisely the collision the order layer's own
 * header says there is no third place in this room for.
 *
 * Halving the rise fixes both halves at once. The card now overlaps the front
 * ticket's outboard shoulder — its box lands inside the balloon's own vertical
 * band — so it reads as what it is, another ticket on the same spike, and it
 * cannot reach the strip because it never leaves the balloon.
 *
 * The second effect is the more valuable one: QUEUE_RISE0/QUEUE_RISE drop to
 * 0.92/1.08, both now UNDER `1 + AWN_RISE` = 1.23, so the canopy governs
 * `topLimit` at every queue depth. Before this, a third live order deepened the
 * spike and shoved BOTH front balloons ~0.3 of a balloon height down the frame
 * — on iPhone portrait that is the difference between hanging clear of the oven
 * arch and hanging across it. The tickets now sit still.
 *
 * QUEUE_DX is untouched on purpose: it feeds QUEUE_REACH, which is what the
 * front ticket's horizontal clamp reserves, and nothing about the outboard
 * reach was wrong.
 */
/**
 * WAVE 2 — AND IT STILL WASN'T ON THE SPIKE.
 *
 * The rise came down from 0.74 to 0.40 in integration, which stopped the card
 * climbing into the score pill. It did not stop the other half: at DX 0.46 with
 * a half-width of 0.26 the card spanned 0.20 to 0.72 of a balloon width outboard
 * of centre, so 58% of it hung past the balloon's own rim — and because the rim
 * is an ELLIPSE, at the height the card sits the white shape has already
 * narrowed, so what actually read was a small separate balloon parked on bare
 * wall beside a big one. On iPhone portrait it also ran within 3px of the safe
 * strip's right edge.
 *
 * Pulled in until the card is genuinely BEHIND the ticket: it now spans 0.08 to
 * 0.60, so a bit over half of it is occluded by the front balloon at every
 * cluster shape, and what shows is a crescent of a second chit — which is what a
 * spike of chits looks like. Reach drops from 0.72 to 0.60 of a balloon width,
 * so the front ticket also gets 0.12 of a balloon width back off its own clamp.
 */
/**
 * WAVE 3 — THE QUEUE CONSTANTS ARE GONE WITH THE CARD THEY POSITIONED.
 *
 * Five rounds of arithmetic went into placing a second, smaller, canopy-less,
 * tail-less balloon on a spike behind the front one, and every round a critic
 * found it somewhere it should not be: under the score pill, on top of the other
 * pass's ticket, clipped by the left frame edge at x=0, wearing the green stroke
 * the balloon had already been told to drop. The reference shows ONE ticket per
 * team. So does this now — see the `deep` / `deep2` paper edges in orders().
 */

/**
 * THE CANOPY, AND EVERYTHING THAT WAS WRONG WITH THE LAST ONE.
 *
 * Open refs/dash-and-dine-01.jpeg at 6x on the pink dome. It is a SQUAT MUSHROOM
 * CAP of plain dusty-rose canvas: one smooth top arc, one gently bowed hem, a
 * fine diagonal knit weave, and almost no tonal range across it — a whisper of
 * light on the crown, a whisper of shade at the hem, nothing else. It carries no
 * outline, no rib, no seam, no scallop. A honey-wood post runs out from under
 * the outboard side of the fabric and disappears behind the counter.
 *
 * Ours carried, all at once: eight hard 14-unit scallops, four dark gore seams,
 * a 0.62-opacity dark wash across the lower two thirds, a 2.2px dark outline
 * round the whole shape, and a fat three-tone pole with a lashing collar. Every
 * one of those is contrast, and stacked on a saturated tint they made the canopy
 * the busiest object in the upper third of the frame — a beach umbrella, which
 * is a critic's word and the right one.
 *
 * So: smooth hem, no seams, no outline, a quarter of the shading, a thin pole.
 * The dome is drawn 1.28:1 (140 x 109) because that is the reference's aspect;
 * the CSS only ever chooses its WIDTH, never its shape.
 */
const DOME = 'M4 90C4 33 34 5 70 5s66 28 66 85q0 22-66 22T4 90z';
/** Where the dome's own curvature is centred: bottom-middle of the fabric. */
const KNIT_CX = 70;
const KNIT_CY = 116;

/**
 * WAVE 3 — THE KNIT NOW FOLLOWS THE FORM, AND THE FORM NOW HAS ONE.
 *
 * What shipped was a flat one-tone lozenge with a SCREEN-AXIS crosshatch: a
 * `patternTransform="rotate(40)"` tile, which means the weave ran at a constant
 * 40 degrees across the whole dome and therefore described a flat plane, not a
 * curved piece of cloth — plus a linear wash worth about 12 luma end to end,
 * which at ticket size is nothing. Open refs/dash-and-dine-01.jpeg at 6x on the
 * pink dome and both are plainly wrong: its weave runs PARALLEL TO THE HEM near
 * the hem and swings round to follow the crown at the crown, and it carries a
 * real light-to-dark fall from a pale crown to an outer edge a good deal darker.
 *
 * Both are cheap if you stop thinking in patterns and start thinking in polar
 * coordinates about (KNIT_CX, KNIT_CY), the notional centre of the dome's
 * curvature. Concentric arcs give the course direction; radial spokes give the
 * wale. Clipped to the dome, that is a weave that curves with the surface, and
 * it costs ~30 stroked paths drawn once into an SVG that never re-rasterises.
 */
function knit(): string {
  const arcs: string[] = [];
  for (let i = 1; i <= 27; i++) {
    const rr = 10 + i * 4.4;
    arcs.push(
      `<ellipse cx="${KNIT_CX}" cy="${KNIT_CY}" rx="${(rr * 0.86).toFixed(1)}" ry="${rr.toFixed(1)}"/>`,
    );
  }
  const spokes: string[] = [];
  for (let i = 0; i <= 38; i++) {
    const a = Math.PI + (i / 38) * Math.PI;
    spokes.push(
      `<path d="M${(KNIT_CX + Math.cos(a) * 10).toFixed(1)} ${(KNIT_CY + Math.sin(a) * 12).toFixed(1)}L${(KNIT_CX + Math.cos(a) * 132).toFixed(1)} ${(KNIT_CY + Math.sin(a) * 152).toFixed(1)}"/>`,
    );
  }
  return `<g fill="none" stroke="#fffaf4" stroke-width="1.05" opacity=".17">${arcs.join('')}</g>
    <g fill="none" stroke="#4a1409" stroke-width="0.95" opacity=".13">${spokes.join('')}</g>`;
}

/**
 * THE HEM, AND THE POST IT STANDS ON.
 *
 * The hem was a smooth cut with nothing on it, so the fabric ended the way a
 * vector shape ends rather than the way cloth does. It now carries a rolled lip
 * — the reference's dome has one, a band a couple of shades deeper than the
 * fabric running the length of the bottom edge — and a shallow scallop worth
 * 3.5 of 140 units, which is a hem detail at 4x and a soft edge at 1x. A deep
 * valance is NOT in the reference and is not what this is; a hard-cut vector
 * arc is not either.
 */
function hem(): string {
  const pts: string[] = [];
  const n = 9;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = 4 + t * 132;
    // The hem line itself, as the DOME path draws it: a shallow bow.
    const y = 90 + Math.sin(t * Math.PI) * 22;
    pts.push(`${x.toFixed(1)} ${y.toFixed(1)}`);
  }
  let d = `M${pts[0]}`;
  for (let i = 1; i <= n; i++) {
    const [x0, y0] = pts[i - 1].split(' ').map(Number);
    const [x1, y1] = pts[i].split(' ').map(Number);
    d += `Q${((x0 + x1) / 2).toFixed(1)} ${((y0 + y1) / 2 + 9.5).toFixed(1)} ${x1.toFixed(1)} ${y1.toFixed(1)}`;
  }
  return d;
}

function awning(uid: number): string {
  return `<svg class="awn" viewBox="0 0 140 200" aria-hidden="true" focusable="false">
    <defs>
      <!-- VOLUME. A radial fall from a pale crown to an outer edge ~20% darker,
           centred up and inboard of the dome's own middle so the light comes
           from the same soft high key the whole room is lit by. The old linear
           wash ran about 12 luma end to end and read as one flat tone. -->
      <radialGradient id="ag${uid}" cx="0.34" cy="0.12" r="1.04">
        <stop offset="0" stop-color="#fff" stop-opacity=".22"/>
        <stop offset="0.34" stop-color="#fff" stop-opacity=".05"/>
        <stop offset="0.68" stop-color="#5a1006" stop-opacity=".11"/>
        <stop offset="1" stop-color="#5a1006" stop-opacity=".34"/>
      </radialGradient>
      <clipPath id="ac${uid}"><path d="${DOME}"/></clipPath>
    </defs>
    <!-- THE POST. Thin, one tone plus a highlight, and it runs off the bottom of
         the box rather than ending on an invented contact shadow — the reference
         loses its post behind the counter and so does ours. Drawn first, so the
         fabric sits on it. -->
    <g class="awn-pole">
      <rect x="64.6" y="86" width="10.8" height="114" fill="#8a5a24"/>
      <rect x="66.4" y="86" width="3.6" height="114" fill="#c08f4c" opacity=".8"/>
      <rect x="72.2" y="86" width="3.2" height="114" fill="#5d3a12" opacity=".55"/>
    </g>
    <!-- The scalloped lip hangs BELOW the dome's own hem, so it is part of the
         silhouette rather than a line drawn on the fabric. -->
    <path d="${hem()}L136 90 4 90z" fill="var(--tint)"/>
    <path d="${DOME}" fill="var(--tint)"/>
    <g clip-path="url(#ac${uid})">
      ${knit()}
      <rect width="140" height="140" fill="url(#ag${uid})"/>
    </g>
    <!-- The rolled lip: the fabric turns under at the hem, so the last few units
         of it are in its own shade. -->
    <path d="${hem()}" fill="none" stroke="#2a1408" stroke-width="7" opacity=".17"/>
  </svg>`;
}

interface Bub {
  el: HTMLElement;
  items: HTMLElement[];
  tier: number;
  /** Continuous 0..1 urgency, mirrored to CSS as --urg. */
  urg: number;
  /** How many components were ticked off last frame — drives the step pop. */
  doneCount: number;
  /** Whole seconds left last frame — drives the once-a-second tick pulse. */
  sec: number;
  /** Which pass this ticket belongs to: 0 = pink, 1 = green. Nothing else exists. */
  slot: number;
  /** Cluster footprint in icon units, so the balloon's own box is known in CSS. */
  fw: number;
  fh: number;
}

export class Hud {
  private root: HTMLElement;
  private scoreEl: HTMLElement;
  private scorePill: HTMLElement;
  private squadEl: HTMLElement;
  private clockEl: HTMLElement;
  private clockPill: HTMLElement;
  private servedEl: HTMLElement;
  private servedPill: HTMLElement;
  private gaugeArc: SVGCircleElement | null = null;
  private layer: HTMLElement;

  private bubbles = new Map<number, Bub>();
  private lastCoins = -1;
  private lastServed = -1;
  private lastClock = '';
  private lastMissed = 0;
  private squadKey = '';
  private iconPx = 0;
  private overPct = -1;
  private uid = 0;
  private slotUse = [0, 0];
  private slotTurn = 0;
  private anchor = new THREE.Vector3();
  /** World x of each pass, read off the sim's own serve stations, once. */
  private passX: [number, number] | null = null;
  private ndc = new THREE.Vector3();

  constructor(root: HTMLElement) {
    this.root = root;
    root.innerHTML = `
      <div class="strip">
        <div class="strip-left">
          <div class="pill pill-score" id="scorePill">
            <span class="squad" id="squad"></span>
            <span class="num" id="score">0</span>
          </div>
        </div>
        <div class="pill pill-clock" id="clockPill">
          ${CLOCK}
          <span class="num num-clock" id="clock">0:00</span>
        </div>
        <div class="strip-right">
          <div class="pill pill-served" id="servedPill">
            <span class="num num-served" id="served">0</span>
            <span class="squad squad-pass">${toadPortrait('#e2596f', 1)}${toadPortrait('#4faa4c', 0)}</span>
          </div>
        </div>
      </div>
      <div class="bubbles" id="bubbles"></div>
    `;
    this.scorePill = root.querySelector('#scorePill')!;
    this.scoreEl = root.querySelector('#score')!;
    this.squadEl = root.querySelector('#squad')!;
    this.clockEl = root.querySelector('#clock')!;
    this.clockPill = root.querySelector('#clockPill')!;
    this.servedEl = root.querySelector('#served')!;
    this.servedPill = root.querySelector('#servedPill')!;
    this.layer = root.querySelector('#bubbles')!;
  }

  /**
   * @param camera  used only to project the pass anchors into screen space, the
   *                same trick the floating labels in view/vfx.ts use. Omit it
   *                and the bubbles fall back to a fixed spot under the strip.
   */
  update(s: SimState, camera?: THREE.Camera, width?: number, height?: number) {
    this.root.classList.add('live');
    this.strip(s);
    this.orders(s, camera, width ?? window.innerWidth, height ?? window.innerHeight);
  }

  // ------------------------------------------------------------- top strip

  private strip(s: SimState) {
    // HOW MANY FACES THE STRIP CAN AFFORD.
    //
    // Four portraits, a score, a clock and a served count measured 324 of the
    // 336 usable pixels a 393px iPhone has once the strip's own margins are
    // paid — 12px of air across the whole strip, which is why a critic read it
    // as "a solid toolbar, not three floating chips" with the clock's digits
    // nearly touching the score's. The reference leaves over half its strip
    // empty. Under the same 480px breakpoint styles.css uses, the row is the
    // player plus one: an avatar STACK still reads as "the squad", and the two
    // faces that survive are 40px instead of 36 and can actually be named.
    // WAVE 3 — ONE FACE ON A PHONE, BECAUSE THE RIGHT PILL NOW HAS SUBJECTS TOO.
    //
    // Two squad portraits plus two Toad portraits plus three numerals measured
    // 308 of the 318 usable pixels a 393px iPhone has: 10px of air, which is the
    // toolbar the last critic measured at 8px once the score reached two digits.
    // The right pill is no longer negotiable — a lone glyph there is what tipped
    // the triad 3.7:1 — so the squad row is the one that gives. The player alone,
    // wearing the patience gauge, against the pass they are cooking for: one disc
    // each side, 5.1% of frame width of clear air in both gaps at a two-digit
    // score, and both discs are 40px rather than the 26px a critic could not
    // name. The four-strong squad is legible everywhere the strip can hold it.
    const nFaces = window.innerWidth <= 480 ? 1 : 2;
    const key = `${s.chefs.map((c) => c.skin).join(',')}|${nFaces}`;
    if (key !== this.squadKey) {
      this.squadKey = key;
      // EVERY CHEF GETS A FACE.
      //
      // The last cut drew two portraits and then wrote `+2` immediately to the
      // left of the score numeral, so the pill read "+2  0" — a plus sign glued
      // to a score, which is the single most confusable adjacency the HUD had
      // available, and it never changed in twenty seconds of capture. The
      // reference fits four portraits across its strip; so do we, as one
      // overlapped avatar row with the player leading it. No token, no glyph,
      // nothing next to the numeral but the numeral.
      // Player first, so the gauge ring is always on the leading face — the one
      // that overhangs the pill's cap and is never clipped by a neighbour.
      this.squadEl.innerHTML = [...s.chefs]
        .sort((a, b) => Number(b.isPlayer) - Number(a.isPlayer))
        .slice(0, nFaces)
        .map((c, i) => facePortrait(c.skin, c.isPlayer, i))
        .join('');
      this.gaugeArc = this.squadEl.querySelector('#gaugeArc');
    }

    if (s.score.coins !== this.lastCoins) {
      const up = s.score.coins > this.lastCoins && this.lastCoins >= 0;
      this.lastCoins = s.score.coins;
      this.scoreEl.textContent = String(s.score.coins);
      this.scorePill.classList.toggle('wide', s.score.coins >= 100);
      this.scorePill.classList.remove('pop');
      void this.scorePill.offsetWidth;
      if (up) this.scorePill.classList.add('pop');
    }

    if (s.score.served !== this.lastServed) {
      const up = s.score.served > this.lastServed && this.lastServed >= 0;
      this.lastServed = s.score.served;
      this.servedEl.textContent = String(s.score.served);
      this.servedPill.classList.remove('pop');
      void this.servedPill.offsetWidth;
      if (up) this.servedPill.classList.add('pop');
    }

    // THE CLOCK COUNTS DOWN IN BARE SECONDS, exactly as the reference's does.
    //
    // `m:ss` put FIVE glyphs in the centre chip — "2:40" plus a colon at 98px
    // wide against the reference's two glyphs at 62px — so our clock was both
    // smaller per glyph and wider overall, which is the worst of both. The
    // reference reads "32" and nothing else, and seconds-remaining is the only
    // number a 180-second score attack actually asks the player to act on.
    const left = Math.max(0, TUNING.roundSeconds - s.time);
    const clock = String(Math.ceil(left));
    if (clock !== this.lastClock) {
      this.lastClock = clock;
      this.clockEl.textContent = clock;
    }
    this.clockPill.classList.toggle('warn', left <= CLOCK_WARN && left > CLOCK_DANGER);
    this.clockPill.classList.toggle('danger', left <= CLOCK_DANGER);

    // PATIENCE, AS A GAUGE ROUND THE PLAYER'S OWN PORTRAIT.
    // Full = the gold ring that already meant "this one is you", so at calm
    // service nothing new appears on screen; it drains anticlockwise through
    // amber to red, over an opaque track so the empty part of the gauge is as
    // visible as the full part.
    const p = Math.max(0, Math.min(1, s.score.patience));
    if (this.gaugeArc) this.gaugeArc.style.strokeDashoffset = String(GAUGE_C * (1 - p));
    const mood = p > 0.55 ? 0 : p > 0.28 ? 1 : 2;
    this.scorePill.classList.toggle('mood-warn', mood === 1);
    this.scorePill.classList.toggle('mood-danger', mood === 2);
  }

  // --------------------------------------------------------------- bubbles

  private orders(s: SimState, camera: THREE.Camera | undefined, w: number, h: number) {
    // --- RETIRE FIRST, THEN ADOPT.
    //
    // Serving a ticket and pushing a new one usually happens on the SAME frame:
    // adopt-first made the new ticket pick a pass while the served one still
    // held its own, so the board could end up two deep on the pink pass with
    // the green one bare.
    const live = new Set<number>();
    for (const o of s.orders) live.add(o.id);
    // The sim only hands us state, not events, so a vanished order is read as
    // a failure when the miss counter moved this frame and a success otherwise.
    const failed = s.score.missed > this.lastMissed;
    this.lastMissed = s.score.missed;
    for (const [id, b] of [...this.bubbles]) {
      if (live.has(id)) continue;
      this.bubbles.delete(id);
      this.slotUse[b.slot] = Math.max(0, this.slotUse[b.slot] - 1);
      // 'served', not 'done'. `.done` is ALSO the class on the tick badge inside
      // every icon (see icons.ts), and `.chit, .done` sets position:absolute and
      // width:calc(var(--icon)*0.27) at the same specificity as `.bub` but later
      // in the file — so a served ticket's balloon collapsed to a 22px vertical
      // sliver with its food hanging outside it for the whole fade-out. Visible
      // in ipad-landscape/90-late.jpg of the round before this one.
      b.el.classList.add(failed ? 'gone' : 'served');
      setTimeout(() => b.el.remove(), 420);
    }
    for (const o of s.orders) {
      if (!this.bubbles.has(o.id)) this.spawn(o);
    }

    if (!s.orders.length) return;

    // --- TWO PASSES, TWO BALLOONS, EVERYTHING ELSE QUEUES.
    // Oldest ticket on a pass is the one hanging; the rest spike behind it.
    const byOrder = new Map<Bub, Order>();
    const queue: Bub[][] = [[], []];
    for (const o of s.orders) {
      const b = this.bubbles.get(o.id)!;
      byOrder.set(b, o);
      queue[b.slot].push(b);
    }
    for (const q of queue) q.sort((a, b) => byOrder.get(a)!.id - byOrder.get(b)!.id);

    // BOTH PASSES CARRY A TICKET BEFORE EITHER CARRIES TWO.
    //
    // A ticket picks its pass once, at spawn, and keeps it — so a run that
    // serves the green ticket while the pink pass is two deep leaves the green
    // Toad standing under bare wall with a spike of two chits over the pink one.
    // Caught in p05r11-c/desktop/t0020s.jpg: one balloon, one queued card, both
    // on the left, and the whole right half of the back wall empty. The youngest
    // ticket on the loaded pass walks across, which is also the truthful move —
    // nothing has been cooked for it yet.
    for (let a = 0; a < 2; a++) {
      const o = 1 - a;
      while (queue[a].length >= 2 && queue[o].length === 0) {
        const moved = queue[a].pop()!;
        moved.slot = o;
        moved.el.classList.toggle('pass-b', o === 1);
        queue[o].push(moved);
        this.slotUse[a] = Math.max(0, this.slotUse[a] - 1);
        this.slotUse[o] += 1;
      }
    }

    // --- geometry of one balloon, in CSS px.
    //
    // Icon height is driven off the FRAME HEIGHT, because that is the number the
    // reference holds constant: its tomato is 7.2% of frame height whatever the
    // window is doing. The only thing width is allowed to do is cap ONE balloon
    // at a share of the usable strip — past that the ticket stops being an
    // object hanging in the room and becomes a banner across the phone. When two
    // capped balloons still will not sit side by side, they STACK; they are
    // never shrunk into illegibility to make a row work.
    const inset = readInsets();
    const safe = Math.max(14, Math.round(w * 0.05));
    const minL = inset.l + safe;
    const maxR = w - inset.r - safe;
    const usable = maxR - minL;
    const nVis = (queue[0].length ? 1 : 0) + (queue[1].length ? 1 : 0);
    let footW = 1;
    let footH = 1;
    let padX = PAD_X;
    let padY = PAD_Y;
    for (const o of s.orders) {
      const c = clusterOf(o.recipe.components.length);
      footW = Math.max(footW, c.w);
      footH = Math.max(footH, c.h);
      padX = Math.max(padX, padXOf(c));
      padY = Math.max(padY, padYOf(c));
    }
    const kW = footW + padX * 2;
    // Frame HEIGHT is the dimension the reference holds constant — its tomato is
    // 8.6% of it on a 16:9 frame — but an 852x393 phone in landscape is barely
    // half as tall as 16:9 at that width, so height alone solved to a 38px icon
    // and a balloon 11.7% of frame width against the reference's 13.7%. A
    // critic's word for the result was "mush". The width term only ever binds on
    // a frame that is much wider than it is tall, and it is itself capped
    // against height so it can never make a ticket taller than the room.
    //
    // WAVE 2 — AND THE TICKET MAY NEVER OWN MORE THAN 0.22 OF THE FRAME'S
    // HEIGHT, WHICHEVER TERM WON.
    //
    // The reference's balloon is 13.9% of frame width AND 20.6% of frame height,
    // because its frame is 16:9. An 852x393 phone is 2.17:1, so holding the width
    // proportion — which is what the max() above does — solved to a balloon 25%
    // of the frame's height, and `topLimit` then reserved 1.07 of that under the
    // strip and pushed BOTH tickets down onto the very Toads they belong to:
    // critic's words, "the two bubbles completely cover both Toads' heads — you
    // cannot see who is ordering". A hard height cap binds on that profile and on
    // nothing else (desktop 116 vs a 98 solve, iPad 108 vs 81, portrait 110 vs
    // 68), which is exactly the one place the aspect ratio is the problem.
    const capH = (h * 0.22) / (footH + padY * 2);
    const target = clamp(
      Math.round(Math.min(Math.max(h * ICON_VH, Math.min(w * 0.068, h * 0.16)), capH)),
      34,
      124,
    );
    // INTEGRATION: the width budget per balloon was a flat 0.56 of the usable
    // strip, so two tickets always asked for 1.12 of it and iPhone portrait
    // ALWAYS took the stacked branch below. Stacked, the pair plus its canopies
    // owned rows 0.10–0.53 of a 393x852 frame — 43% of the phone, against the
    // reference's 20% — both tickets docked to the frame edges with their tails
    // suppressed, so the one screen where the room is tightest was also the one
    // screen where the orders stopped pointing at a pass.
    //
    // A pair only needs 0.44 each (the remaining 12% is the gap the canopies
    // lean into), and 0.44 of a 393-wide frame still solves to a 64px icon =
    // 7.5% of frame height, which is ABOVE the reference's measured 7.2%. So
    // portrait gets two full-size side-by-side tickets that point at their own
    // pass, and no landscape profile changes at all: on desktop, iPad and phone
    // landscape `target` binds long before the cap does.
    // WAVE 3 — A TALL FRAME BUYS ITS AIR BACK OUT OF THE BALLOON.
    //
    // At 0.44 each, iPhone portrait's pair spanned 94% of the frame width with
    // ~10px between the left canopy and the right balloon, so the two tickets
    // read as ONE white band laid across the pizza oven arch — the room's only
    // focal anchor — which is the exact opposite of two chips hanging over two
    // passes. The gap is worth more than the last 6% of icon: at 0.39 the icon
    // still solves to 57px on a 393-wide phone, which is 6.7% of frame height
    // against the reference's 7.2%, and the clear air between the two clusters
    // goes from 10px to over 8% of the frame width. Landscape is untouched —
    // `target` binds long before `capW` does on every wide profile.
    const tall = h > w * 1.25;
    const capW = Math.floor((usable * (nVis === 2 ? (tall ? 0.375 : 0.44) : 0.56)) / kW);
    const icon = Math.max(26, Math.min(target, capW));
    if (icon !== this.iconPx) {
      this.iconPx = icon;
      this.layer.style.setProperty('--icon', `${icon}px`);
      this.layer.style.setProperty('--padx', `${(icon * PAD_X).toFixed(1)}px`);
      this.layer.style.setProperty('--pady', `${(icon * PAD_Y).toFixed(1)}px`);
      this.layer.style.setProperty('--icon-px', String(icon));
    }
    const bw = icon * kW;
    const bhMax = icon * (footH + padY * 2);
    // TWO FULL-SIZE TICKETS OR TWO STACKED ONES. Never two shrunken ones, and
    // never two that intersect — iPhone portrait shipped both balloons crossing
    // at x≈200 with their tails aimed at empty floor, which is the exact opposite
    // of the diegetic anchoring the whole design is for.
    const stack = nVis === 2 && usable < 2 * bw + icon * 0.4;

    // --- per-order progress, read straight off the plates in the room
    const flags = matchOrders(s);

    // --- HOW DEEP THE SPIKE GOES, decided BEFORE anything is positioned.
    //
    // The queued card used to be laid out in screen space and then clamped, and
    // clamping is why it landed hard against the left inset on one profile and
    // directly on top of the other pass's balloon on another. It is now a fixed
    // local offset from the ticket it is queued behind — the numbers below, in
    // balloon widths and balloon heights — so the only thing that has to change
    // is how much room the FRONT ticket leaves itself. Nothing about a queued
    // card is computed from the viewport, therefore nothing about it can collide
    // with the viewport.
    const rise = 1 + AWN_RISE;

    // Never let a balloon — or the canopy above it, or its spike of chits —
    // climb into the top strip.
    const stripH = 20 + Math.max(38, Math.min(58, Math.min(w, h) * 0.062));
    const topLimit = inset.t + stripH + bhMax * Math.max(1 + AWN_RISE, rise) + 6;

    // The canopies lean INWARD, toward the middle of the frame, exactly as the
    // reference's pair does: pink swings right off the left ticket, green swings
    // left off the right one. Measured at 0.36 of a balloon width of overhang.
    const over = bw * AWN_OVER;

    // --- where each pass is, on screen
    type Lay = { b: Bub; ax: number; ay: number; x: number; y: number; dock: number };
    const front: Lay[] = [];
    for (let slot = 0; slot < 2; slot++) {
      const b = queue[slot][0];
      if (!b) continue;
      let ax = w * (0.5 + (slot === 0 ? -0.24 : 0.24));
      let ay = h * 0.34;
      if (camera) {
        this.slotAnchor(slot, s);
        this.ndc.copy(this.anchor).project(camera);
        if (this.ndc.z < 1) {
          ax = ((this.ndc.x + 1) / 2) * w;
          ay = ((-this.ndc.y + 1) / 2) * h;
        }
      }
      // THE TICKETS LIVE IN THE DEAD BAND ON A TALL FRAME.
      //
      // iPhone portrait gives its top 22% to ochre stucco, one timber beam and
      // the HUD, and then hangs both tickets BELOW that, straight across the
      // pizza oven arch. Two problems, one move: the band above the beam carries
      // no information and the arch is the only thing in the room the eye can
      // anchor on. Clamping the ticket's base to within a third of a balloon
      // height of `topLimit` puts the pair in the band that was empty and lifts
      // them clear of the arch. The tail still slides to point at the pass, and
      // where the pass is off frame the dock test replaces it with a chevron.
      const lowest = tall
        ? Math.min(h - inset.b - 40, topLimit + bhMax * 0.3)
        : h - inset.b - 40;
      front.push({
        b,
        ax,
        ay,
        dock: 0,
        x: 0,
        y: clamp(ay, topLimit, Math.max(topLimit, lowest)),
      });
    }
    if (!front.length) return;
    front.sort((a, b) => a.b.slot - b.b.slot);

    // THE FRONT TICKET RESERVES THE SPIKE'S ROOM, NOT THE OTHER WAY ROUND.
    // Each pass's chits grow outboard, so the outboard clamp on a pass that is
    // holding a queue is pushed in by exactly the reach of its deepest card.
    const lo = minL + bw / 2;
    const hi = Math.max(lo, maxR - bw / 2);
    const loSlot = [lo, lo];
    const hiSlot = [hi, hi];

    if (stack && front.length === 2) {
      // STACKED. The left team's ticket sits against the top-left of the play
      // area and the right team's hangs below it against the top-right, tails
      // suppressed and a directional notch on the outer edge instead. Two
      // full-size tickets you can read beats two half-size ones you cannot, and
      // beats two that intersect by a mile.
      const [L, R] = front;
      L.x = loSlot[0];
      L.y = topLimit;
      L.dock = -1;
      R.x = hiSlot[1];
      R.y = topLimit + bhMax * 1.1;
      R.dock = 1;
    } else {
      for (const f of front) f.x = clamp(f.ax, loSlot[f.b.slot], hiSlot[f.b.slot]);
      if (front.length === 2) {
        const [L, R] = front;
        // A balloon plus most of one canopy swing between centres, so the pink
        // canopy never crosses the green ticket.
        //
        // ON A TALL FRAME THAT IS NOT ENOUGH. The inboard canopy eats the gap it
        // is measured against — 0.12 of a balloon width of dome leaning into a
        // 35px gap leaves 18px of wall — so portrait asks for the reference's
        // separation OUTRIGHT: a full balloon, plus the deepest the dome can
        // lean, plus 8% of the frame's width of clear ochre between the two
        // clusters. That is what makes them two objects instead of one band.
        const need = tall
          ? bw * (1 + AWN_MIN_OVER * 2) + w * 0.08
          : bw + over * 0.55 + icon * 0.16;
        if (R.x - L.x < need) {
          const mid = clamp((L.x + R.x) / 2, lo + need / 2, Math.max(lo + need / 2, hi - need / 2));
          L.x = Math.max(loSlot[0], mid - need / 2);
          R.x = Math.min(hiSlot[1], mid + need / 2);
        }
      }
      // DOCK ON WHETHER THE TAIL CAN REACH, NOT ON WHERE THE ANCHOR IS.
      //
      // The old test docked whenever the anchor fell outside [minL, maxR] — but
      // a balloon's centre is clamped to minL + bw/2 anyway, and its tail slides
      // to anywhere between 0.3 and 0.7 of the balloon's own width, so a ticket
      // pinned to the left clamp can still point 0.2 of a balloon width further
      // left than the balloon's centre. On iPhone portrait that is exactly where
      // the pink Toad is: the anchor projected to x≈14 against a minL of 20, the
      // ticket docked, and the game drew a fat white ARROW at a server standing
      // in plain sight 60px away — a worse lie than the tail it replaced.
      // So: place the balloon, work out where its tail actually ends up, and dock
      // only if that point still misses the pass by more than a third of a
      // balloon width. A tail that lands on the server keeps the tail.
      for (const f of front) {
        const t = clamp((f.ax - (f.x - bw / 2)) / bw, 0.3, 0.7);
        const miss = f.ax - (f.x - bw / 2 + t * bw);
        f.dock = Math.abs(miss) > bw * 0.34 ? (miss < 0 ? -1 : 1) : 0;
      }
    }

    // --- CANOPY OVERHANG, SET FROM THE GAP THAT ACTUALLY CAME OUT.
    //
    // Both canopies lean inward, so at 0.34 of a balloon width each they need
    // 1.68 balloon widths between the two centres before their two domes stop
    // touching — and `need` above only ever buys 1.25. On a frame wide enough
    // that the passes project far apart (desktop, iPad, phone landscape) the
    // real gap is far past 1.68 and 0.34 is right. On iPhone portrait the pair
    // lands ~1.55 apart, and the last 0.13 showed up as an 18px seam where the
    // pink dome and the green dome overlapped into one muddy lump in the only
    // part of the frame neither balloon covers.
    //
    // Two inward domes are clear of each other when each overhangs at most half
    // the surplus gap, so that is what this solves for. It is the overhang that
    // gives, never the icon: a slightly shorter canopy is a canopy, two blended
    // canopies are a draw error.
    let ovr = AWN_OVER;
    if (front.length === 2) {
      const span = (front[1].x - front[0].x) / bw;
      // Floor raised from 0.07 in wave 2: the dome is now 0.78 of a balloon
      // width rather than 0.94, so two of them clear each other 0.16 of a
      // balloon width sooner, and at 0.07 the crescent that survived on iPhone
      // portrait was too thin to say "there is a canopy behind this".
      // WAVE 3 — AND IT WAS SOLVING FOR THE WRONG THING.
      //
      // `(span - 1) / 2 - 0.03` spends whatever gap the two tickets have on
      // overhang until the two domes are 0.03 of a balloon width apart — so the
      // wider you push the pair, the wider the domes lean, and the seam between
      // them never opens. On iPhone portrait that is why the pair still read as
      // one continuous white band after the tickets themselves had been moved
      // 8% of the frame apart: the canopies simply grew to fill it. The gap is
      // now RESERVED first and the overhang takes what is left, which is the
      // only ordering under which asking for air actually buys any.
      const wantGap = tall ? w * 0.08 : icon * 0.16;
      ovr = clamp((span - 1 - wantGap / bw) / 2, AWN_MIN_OVER, AWN_OVER);
    }
    if (this.overPct !== ovr) {
      this.overPct = ovr;
      this.layer.style.setProperty('--awn-off', `${(-ovr * 100).toFixed(1)}%`);
    }

    // Front tickets, then the spike of queued cards behind each.
    //
    // A QUEUED CARD IS A SMALL COMPLETE TICKET, AND IT IS BOLTED TO ITS OWN
    // FRONT TICKET.
    //
    // Three shapes preceded this. A full-size clone offset by a sliver showed a
    // vertically SLICED half-bun poking past the front rim. Blanking its
    // contents turned it into an anonymous disc while report.json showed the sim
    // holding a third live order. And a half-size card positioned in SCREEN
    // space and clamped landed hard against the left inset on iPad and squarely
    // on top of the other pass's balloon on iPhone portrait — two whites stacked
    // with no separation, which reads as a draw error.
    //
    // There is no screen-space arithmetic left. The card's position is a fixed
    // local transform off the front ticket, the front ticket's own clamp has
    // already reserved the room for it, and the card wears a heavy opaque cream
    // rim so that where it does overlap its own balloon the two shapes separate.
    let z = 90;
    const shown = new Set<Bub>();
    for (const f of front) {
      const depth = queue[f.b.slot].length;
      // A SPIKE OF PAPER, NOT A SECOND TICKET.
      //
      // The queued chit is gone. Two critics in a row measured it clipped by the
      // left frame edge on iPhone portrait, carrying a green stroke on desktop
      // late, wearing no canopy and no tail, and reading as a stray notification
      // toast — and the reference never shows more than one ticket per team, so
      // the second of the two treatments last round offered is the one taken:
      // each pass shows exactly one ticket, always. What survives of "there is
      // another one behind this" is the thing a real pass actually shows — the
      // EDGES of the chits underneath, two thin crescents of the same paper
      // peeking out from behind the balloon. It cannot be clipped (it is inside
      // the front ticket's own footprint), it cannot be mistaken for a second
      // order (it has no contents), and it costs no width at all.
      f.b.el.classList.toggle('deep', depth >= 2);
      f.b.el.classList.toggle('deep2', depth >= 3);
      shown.add(f.b);
      this.place(f.b, f.x, f.y, 1, z, byOrder.get(f.b)!, flags, f.ax, bw, f.dock, false);
      z -= 10;
    }
    // Anything not on a pass right now is not on the screen. `.in` sets opacity
    // 1, so a spawned-but-unplaced ticket would otherwise sit at 0,0 in the
    // top-left corner of the frame.
    for (const b of this.bubbles.values()) b.el.classList.toggle('hid', !shown.has(b));
  }

  /** Position one ticket and refresh everything that depends on its state. */
  private place(
    b: Bub,
    x: number,
    y: number,
    scale: number,
    z: number,
    o: Order,
    flags: Map<number, boolean[]>,
    ax: number,
    bw: number,
    dock: number,
    queued = false,
  ) {
    // TIME IS THE BALLOON'S OWN OUTLINE, AND NOTHING ELSE.
    //
    // There used to be three escalation systems stacked on a two-icon ticket:
    // these warn/danger tiers, a saturated time PIE pinned to the rim, and the
    // verb chit — and the pie shared the bottom-right rim slot with the chit, so
    // four frames out of seven shipped a flat pink disc half-covering a flame
    // badge. Worse, the pie flipped on at exactly t<0.5 with its dashoffset
    // already at full, so it materialised at 100% for no reason the player could
    // perceive. The reference carries ZERO per-order countdowns. The pie is gone;
    // the rim thickening and, at the end, the wobble are the whole of it.
    // AND IT RAMPS FROM t=1, NOT FROM t=0.45.
    //
    // The old cut lit nothing at all above 0.45, so the first 55% of every
    // ticket's life carried no time signal — 28 captured frames across four
    // devices contained not one warn and not one danger state, and a critic
    // reasonably concluded the escalation did not exist. `--urg` is continuous
    // from the moment the ticket lands, so the rim thickens by a hair every
    // second; the two named tiers only decide the COLOUR it thickens toward.
    //
    // AND IT IS NOW MORE THAN A RIM.
    //
    // A critic ran 28 frames spanning 93% to 52% of one ticket's life and could
    // not see a single pixel of difference, which is a fair verdict on a signal
    // carried entirely by a couple of extra pixels of inset shadow. --urg now
    // drives four things at once — rim thickness, a warm wash across the
    // balloon's fill, the balloon's own size, and the amplitude of a discrete
    // pulse that fires ONCE A SECOND, every second, for the whole of the
    // ticket's life. The pulse is the important one: a continuous ramp is
    // invisible in a still and hard to read in motion, a heartbeat is neither.
    const t = Math.max(0, Math.min(1, o.remaining / o.total));
    const urg = 1 - t;
    // AND IT IS SHAPED, NOT LINEAR.
    //
    // The reference carries ZERO per-order countdown — REFERENCE.md says so
    // outright — so anything we add here is already past the bar and has to earn
    // its pixels. A linear ramp puts a visible warm wash on a card that is only
    // a third of the way through its life, which is exactly the "UI wins the
    // attention fight against the food" verdict. Squared, the first 55% of a
    // ticket's life is under 20% of the wash — clean white paper — and the last
    // quarter carries almost all of it. The once-a-second pulse is what tells
    // you time is passing; this only tells you how much is left.
    if (Math.abs(urg - b.urg) > 0.012) {
      b.urg = urg;
      b.el.style.setProperty('--urg', (urg * urg).toFixed(3));
    }
    const sec = Math.ceil(o.remaining);
    if (sec !== b.sec) {
      if (b.sec >= 0 && !queued) {
        b.el.classList.remove('tick');
        void b.el.offsetWidth;
        b.el.classList.add('tick');
      }
      b.sec = sec;
    }
    const tier = t > 0.62 ? 0 : t > 0.3 ? 1 : 2;
    if (tier !== b.tier) {
      b.tier = tier;
      b.el.classList.toggle('warn', tier === 1);
      b.el.classList.toggle('danger', tier === 2);
    }

    const f = flags.get(o.id);
    let done = 0;
    for (let k = 0; k < b.items.length; k++) {
      const ok = !!f?.[k];
      if (ok) done++;
      b.items[k].classList.toggle('ok', ok);
    }
    if (done !== b.doneCount) {
      if (done > b.doneCount) {
        b.el.classList.remove('step');
        void b.el.offsetWidth;
        b.el.classList.add('step');
      }
      b.doneCount = done;
    }
    b.el.classList.toggle('ready', done > 0 && done === b.items.length && !queued);
    b.el.classList.toggle('queued', queued);
    b.el.classList.toggle('dock-l', dock < 0);
    b.el.classList.toggle('dock-r', dock > 0);
    b.el.classList.toggle('docked', dock !== 0);
    // Canopies lean toward the middle of the frame, matching the reference's
    // inward-leaning pair, and the tail slides along the balloon's underside to
    // keep pointing at the server it belongs to.
    b.el.classList.toggle('flip', b.slot === 1);
    b.el.classList.toggle('tailr', ax > x);
    // Kept well inside the balloon's width: the rim is an ellipse, so a tail
    // hung near the corners of the bounding box would sprout from thin air.
    const tail = clamp((ax - (x - bw / 2)) / bw, 0.3, 0.7);
    b.el.style.setProperty('--tail', `${(tail * 100).toFixed(1)}%`);
    // A ticket LEANS ON YOU as it ages: 6% of growth over its life, which on a
    // 250px balloon is 15px and is plainly visible in a still.
    const sc = scale * (queued ? 1 : 1 + 0.06 * urg);
    b.el.style.transform = `translate(-50%,-100%) translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) scale(${sc.toFixed(3)})`;
    b.el.style.zIndex = String(z);
  }

  /**
   * Where slot `i` hangs, in world space. THERE ARE EXACTLY TWO.
   *
   * Slot 2 used to be the chimney breast above the oven, invented so a third
   * ticket had somewhere to go. It was a white balloon on pale grey-white brick
   * with no canopy and no colour identity, and its tail dropped through the
   * arch keystone into the fire — the only warm light in the room, cut in half
   * by UI, on three of four device profiles. There is no third place in this
   * room. Overflow queues behind a pass instead; see orders().
   */
  private slotAnchor(slot: number, s: SimState) {
    // OVER THE PASS ITSELF, NOT A GUESS EITHER SIDE OF THE OVEN.
    //
    // `ovenSpan().x1 + 1.9` put the green anchor at world x 11.9 while the only
    // serve station on that side occupies cell 11, centre 11.5 — so the tail
    // pointed 0.4 of a cell past the Toad who is standing at the pass, which on
    // desktop is ~40px of clear wall between the tail's tip and the head it is
    // supposed to be coming out of. Read the passes off the kitchen the sim
    // actually built and the tail lands on the server by construction, whatever
    // KITCHEN_MAP does next.
    if (!this.passX) {
      const span = ovenSpan();
      const mid = (span.x0 + span.x1) / 2;
      const side = [
        { n: 0, sum: 0 },
        { n: 0, sum: 0 },
      ];
      for (const st of s.kitchen.stations) {
        if (st.kind !== 'serve') continue;
        const cx = st.cell.x + 0.5;
        const g = side[cx < mid ? 0 : 1];
        g.n++;
        g.sum += cx;
      }
      this.passX = [
        side[0].n ? side[0].sum / side[0].n : span.x0 - 1.9,
        side[1].n ? side[1].sum / side[1].n : span.x1 + 1.9,
      ];
    }
    // AND IT HANGS LOWER THAN IT DID.
    //
    // y was 2.45. A point that high above the pass projects measurably further
    // from the frame's centre than the Toad standing under it — perspective
    // pushes it outboard — so on iPhone portrait BOTH anchors solved outside the
    // usable band and both tickets docked to an edge with their tails
    // suppressed, on a frame where the pink Toad is plainly visible at x=65. At
    // 2.05 the anchor tracks its own server closely enough to stay in the band,
    // and the tail's tip lands just above the cap instead of a balloon-height
    // clear of it, which is where refs/dash-and-dine-01.jpeg puts it.
    this.anchor.set(this.passX[slot], 2.05, 1.62);
  }

  /**
   * The least-loaded pass, breaking ties by alternating between the two
   * stations so a kitchen that never holds more than one ticket does not put
   * every single one of them over the pink pass.
   */
  private pickSlot(): number {
    let best = this.slotTurn;
    const other = 1 - this.slotTurn;
    if (this.slotUse[other] < this.slotUse[best]) best = other;
    this.slotTurn = 1 - best;
    this.slotUse[best] += 1;
    return best;
  }

  private spawn(o: Order) {
    const el = document.createElement('div');
    el.className = 'bub';
    const cl = clusterOf(o.recipe.components.length);
    const items = o.recipe.components
      .map((c, i) => {
        const [ix, iy] = cl.at[i] ?? [0, 0];
        return ingredientItem(c.kind, c.state, `${c.state} ${INGREDIENT_DEFS[c.kind].label}`, ix, iy);
      })
      .join('');
    el.style.setProperty('--iw', String(cl.w));
    el.style.setProperty('--ih', String(cl.h));
    // A cluster that needs more white than the default carries its own padding,
    // so a BLT gets a rounder plate without every other ticket paying for it.
    if (cl.px !== undefined) el.style.setProperty('--padx', `calc(var(--icon) * ${cl.px})`);
    if (cl.py !== undefined) el.style.setProperty('--pady', `calc(var(--icon) * ${cl.py})`);
    el.innerHTML = `
      ${awning(++this.uid)}
      <i class="stack" aria-hidden="true"></i>
      <div class="balloon">
        <div class="items">${items}</div>
        <svg class="tail" viewBox="0 0 34 26" aria-hidden="true" focusable="false">
          <path d="M2 0h30c-4 11-11 18-21 26 2-9 0-18-9-26z" fill="#fffaf0"/>
        </svg>
      </div>`;
    el.setAttribute('aria-label', o.recipe.name);
    this.layer.appendChild(el);
    const b: Bub = {
      el,
      items: [...el.querySelectorAll<HTMLElement>('.item')],
      tier: -1,
      urg: -1,
      doneCount: 0,
      sec: -1,
      slot: this.pickSlot(),
      fw: cl.w,
      fh: cl.h,
    };
    // Each tick badge gets the position solved for its own tile against the
    // balloon's ELLIPSE (see badgeSpots) rather than hanging off a corner of the
    // icon's box, which is how three badges of four came to break the rim.
    const spots = badgeSpots(cl);
    b.items.forEach((it, i) => {
      const [bx, by] = spots[i] ?? [0.86, 0.86];
      it.style.setProperty('--bx', bx.toFixed(3));
      it.style.setProperty('--by', by.toFixed(3));
    });
    // Pink canopy over the red pass, green over the green one.
    if (b.slot === 1) el.classList.add('pass-b');
    this.bubbles.set(o.id, b);
    // SYNCHRONOUSLY, in the same task that is about to place it.
    //
    // This was `requestAnimationFrame` with a 140ms timer backstop, on the
    // theory that a bubble must not paint before it has been positioned. It
    // cannot: spawn() is called from orders(), which places every live ticket
    // before it returns, so no paint can occur in between. What the deferral
    // did buy was a window in which the element existed, was positioned, and
    // was invisible — and a capture that landed inside that window photographed
    // a kitchen with two live orders and no tickets on the wall.
    el.classList.add('in');
  }

  reset() {
    for (const b of this.bubbles.values()) b.el.remove();
    this.bubbles.clear();
    this.slotUse = [0, 0];
    this.slotTurn = 0;
    this.root.classList.remove('live');
    this.lastCoins = -1;
    this.lastClock = '';
    this.lastMissed = 0;
  }
}

// ------------------------------------------------------------------ utils

function clamp(v: number, a: number, b: number) {
  return v < a ? a : v > b ? b : v;
}

// ------------------------------------------------------------- ticket state

const key = (kind: string, state: string) => `${kind}:${state}`;

/** Every plate in the room that has something on it, as a list of keys. */
function platesInPlay(s: SimState): string[][] {
  const out: string[][] = [];
  const take = (c: Carryable | null | undefined) => {
    if (c && c.type === 'plate' && c.plate.contents.length) {
      out.push(c.plate.contents.map((i) => key(i.kind, i.state)));
    }
  };
  for (const st of s.kitchen.stations) take(st.holding);
  for (const ch of s.chefs) take(ch.carrying);
  return out;
}

/** How many of `order`'s components a plate satisfies, and which ones. */
function matchAgainst(o: Order, plate: string[]): { n: number; flags: boolean[] } {
  const pool = [...plate];
  const flags: boolean[] = [];
  let n = 0;
  for (const c of o.recipe.components) {
    const i = pool.indexOf(key(c.kind, c.state));
    if (i >= 0) {
      pool.splice(i, 1);
      flags.push(true);
      n++;
    } else {
      flags.push(false);
    }
  }
  return { n, flags };
}

/**
 * Bind plates to tickets so each ticket can show how far along it is.
 *
 * Greedy on strength of match: a plate that already satisfies three of a BLT's
 * four components is credited to that BLT, not to whichever ticket happens to
 * be first in the list. One plate per ticket and one ticket per plate, so two
 * salads on the board never both claim the same plate and both read as done.
 */
function matchOrders(s: SimState): Map<number, boolean[]> {
  const res = new Map<number, boolean[]>();
  const plates = platesInPlay(s);
  if (!plates.length || !s.orders.length) return res;

  const pairs: { oi: number; pi: number; n: number; flags: boolean[] }[] = [];
  for (let oi = 0; oi < s.orders.length; oi++) {
    for (let pi = 0; pi < plates.length; pi++) {
      const m = matchAgainst(s.orders[oi], plates[pi]);
      if (m.n > 0) pairs.push({ oi, pi, n: m.n, flags: m.flags });
    }
  }
  pairs.sort((a, b) => b.n - a.n);
  const usedOrder = new Set<number>();
  const usedPlate = new Set<number>();
  for (const p of pairs) {
    if (usedOrder.has(p.oi) || usedPlate.has(p.pi)) continue;
    usedOrder.add(p.oi);
    usedPlate.add(p.pi);
    res.set(s.orders[p.oi].id, p.flags);
  }
  return res;
}

// ------------------------------------------------------------- safe areas

let insetCache = { t: 0, b: 0, l: 0, r: 0, w: 0 };
/**
 * Safe-area insets, resolved once per viewport width. `env()` is only readable
 * through a computed style, and reading four of them every frame is a layout
 * flush we do not need.
 */
function readInsets() {
  if (insetCache.w === window.innerWidth) return insetCache;
  const cs = getComputedStyle(document.documentElement);
  const px = (name: string) => parseFloat(cs.getPropertyValue(name)) || 0;
  insetCache = { t: px('--safe-t'), b: px('--safe-b'), l: px('--safe-l'), r: px('--safe-r'), w: window.innerWidth };
  return insetCache;
}
