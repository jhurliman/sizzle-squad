// THE EXPERIENCE ICON, rendered from the real assets.
//
// Measured against the live top-12 icons on 2026-08-27 (see the storefront
// benchmark). What actually survives a 150px feed tile, which is the size the
// icon is really seen at:
//
//   * ONE subject, very large, filling the frame. Adopt Me is a single dog's
//     face; Murder Mystery 2 is a single knife on pure black. Both read
//     instantly. Pet Simulator 99 and Fisch put a whole scene in and turn to
//     mush at that size.
//   * A FACE with big eyes outperforms everything else. Two of the three most
//     legible icons in the sample are faces.
//   * Text is NOT avoided, contrary to most written guidance -- 7 of the top 12
//     carry it. But it survives only when it is one or two short words, huge,
//     with a heavy contrasting outline.
//   * Strong subject/ground separation: a rim light or an outline, and a
//     background that is a wash, never a scene.
//
// Three variants along the axis that actually differs between them: how much
// the icon leans on the character versus on the pitch.
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '../node_modules/playwright/index.mjs';
import sharp from '../node_modules/sharp/dist/index.cjs';
import { dressed, item, shoot } from './render-lib.mjs';

const DIR = path.dirname(new URL(import.meta.url).pathname);
const OUT = path.join(DIR, 'game-icon');
const SIZE = 512;
const SS = 3; // supersample, then downsample for clean edges

fs.mkdirSync(OUT, { recursive: true });
const three = fs.readFileSync(path.join(DIR, 'three.iife.js'), 'utf8');

// ---------------------------------------------------------------- ground
// A wash, not a scene. Warm because the game is warm, and because the feed
// grid around it skews blue/purple/black -- see the contact sheet.
function ground(a, b, glow) {
  const S = SIZE * SS;
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="0.35" y2="1">
        <stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/>
      </linearGradient>
      <radialGradient id="gl" cx="0.5" cy="0.44" r="0.52">
        <stop offset="0" stop-color="${glow}" stop-opacity="0.95"/>
        <stop offset="0.55" stop-color="${glow}" stop-opacity="0.35"/>
        <stop offset="1" stop-color="${glow}" stop-opacity="0"/>
      </radialGradient>
      <radialGradient id="vig" cx="0.5" cy="0.5" r="0.75">
        <stop offset="0.6" stop-color="#000" stop-opacity="0"/>
        <stop offset="1" stop-color="#000" stop-opacity="0.34"/>
      </radialGradient>
    </defs>
    <rect width="${S}" height="${S}" fill="url(#bg)"/>
    <circle cx="${S / 2}" cy="${S * 0.44}" r="${S * 0.5}" fill="url(#gl)"/>
    <rect width="${S}" height="${S}" fill="url(#vig)"/>
  </svg>`);
}

// Big, short, heavily outlined -- the only kind of text that survives 150px.
function wordmark(lines, y, sizePx, fill, stroke) {
  const S = SIZE * SS;
  const fs_ = sizePx * SS;
  const rows = (Array.isArray(lines) ? lines : [lines]).map((t, i) => `
    <text x="${S / 2}" y="${(y + i * sizePx * 0.94) * SS}" text-anchor="middle"
      font-family="Arial Black, Helvetica, Arial, sans-serif" font-weight="900"
      font-size="${fs_}" letter-spacing="${fs_ * 0.01}"
      stroke="${stroke}" stroke-width="${fs_ * 0.20}" stroke-linejoin="round"
      paint-order="stroke" fill="${fill}">${t}</text>`).join('');
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}">${rows}</svg>`);
}

// A soft contact shadow so the subject sits on the ground instead of floating.
async function withShadow(png) {
  // Sized to the SUBJECT, not the canvas: it is composited at an offset, and a
  // full-canvas shadow overflows the ground and sharp refuses the composite.
  const m = await sharp(png).metadata();
  const sh = await sharp(png).ensureAlpha().extractChannel('alpha')
    .blur((14 * SS) / 3).linear(0.55, 0).toBuffer();
  const black = await sharp({ create: { width: m.width, height: m.height, channels: 3, background: { r: 24, g: 12, b: 6 } } })
    .png().toBuffer();
  return sharp(black).joinChannel(sh).png().toBuffer();
}

const VARIANTS = [
  {
    id: 'a-chef',
    label: 'Character close-up',
    // The Adopt Me play: one face, cropped tight, nothing else competing.
    bg: ['#F5A524', '#C2410C', '#FFE08A'],
    parts: () => dressed('mochi', { hat: 'hat_toque', yaw: -0.34 }),
    // Cropped to head-and-hat. The first pass framed the whole chef and left
    // half the tile empty orange; at 150px the face was smaller than Adopt
    // Me's dog by a factor of about three, and the face is the whole point.
    shot: { aim: 0.790, span: 0.38, spanX: 0.33, elev: 0.02, rim: 0xfff0c0 },
    scale: 1.00, dy: 0.0,
    text: null,
  },
  {
    id: 'b-crew',
    label: 'Crew + wordmark',
    // Four-player co-op IS the pitch, so show four. Costs legibility per
    // character; buys the one thing the other two variants cannot say.
    bg: ['#3EA76A', '#166534', '#B6F0C6'],
    // THREE, NOT FOUR. Four made this the Pet Simulator 99 failure: at 150px
    // every face was too small to resolve and the tile read as coloured noise.
    // Three at a bigger scale still says "a crew" and each one survives.
    parts: () => [
      ...dressed('bramble', { hat: 'hat_toque', yaw: 0.30, dx: -1.95, dz: 0.55 }),
      ...dressed('pip', { hat: 'hat_bandana_red', yaw: 0.0, dx: 0.0, dz: -0.35 }),
      ...dressed('nori', { hat: 'hat_beret', yaw: -0.30, dx: 1.95, dz: 0.55 }),
    ],
    shot: { aim: 0.64, span: 0.74, spanX: 0.72, elev: 0.02, rim: 0xd8ffe4 },
    scale: 1.00, dy: -0.04,
    // Smaller and lower so it sits under the chefs rather than across them.
    text: { s: 'SIZZLE', y: 476, size: 84, fill: '#FFFFFF', stroke: '#0F3D24' },
  },
  {
    id: 'c-hook',
    label: 'Hook text + character',
    // THE THIRD STRATEGY, not a third character shot.
    //
    // Written guidance says keep text off the icon. The live top twelve say
    // otherwise: seven carry text, and Grow a Garden leads on a hook phrase
    // ("GROW OFFLINE") rather than its own name. This variant tests that play
    // -- the pitch does the work and the chef supports it.
    //
    // Two short stacked words, because that is the most that survives 150px.
    // An earlier attempt made this a plated-dish hero and then a pan hero;
    // both collapsed into "another character portrait" and duplicated variant
    // A, which is not a third option.
    bg: ['#F26D3D', '#7C1D0C', '#FFD08A'],
    parts: () => [
      ...dressed('bramble', { hat: 'hat_toque', yaw: 0.22, dx: -1.15, dz: 0.4 }),
      ...dressed('nori', { hat: 'hat_bandana_red', yaw: -0.22, dx: 1.15, dz: 0.4 }),
    ],
    shot: { aim: 0.70, span: 0.56, spanX: 0.60, elev: 0.02, rim: 0xffd9a0 },
    scale: 0.90, dy: -0.17,
    text: { s: ['COOK', 'TOGETHER'], y: 378, size: 72, fill: '#FFE9A8', stroke: '#5A1508' },
  },

  // ---- FOUR CHEFS, EDGE TO EDGE, ON B's GREEN -------------------------
  // Same brief three ways: all four species spanning the full tile with the
  // outer two allowed to break the frame, SIZZLE / SQUAD stacked, and the
  // green ground from the crew variant — it is the one colour here that no
  // neighbour in the live top-12 is using.
  //
  // Cropping the outer two is what buys the scale: a row of four that has to
  // fit inside the square renders every face too small to resolve at 150px,
  // which is exactly how the first crew attempt failed. Letting the ends run
  // off implies more crew than the tile can hold, which is also true.
  {
    id: 'd-row',
    label: 'Four across, text below',
    bg: ['#3EA76A', '#166534', '#B6F0C6'],
    parts: () => [
      ...dressed('bramble', { hat: 'hat_toque', yaw: 0.40, dx: -3.35, dz: 0.75 }),
      ...dressed('pip', { hat: 'hat_bandana_red', yaw: 0.16, dx: -1.12 }),
      ...dressed('mochi', { hat: 'hat_paper', yaw: -0.16, dx: 1.12 }),
      ...dressed('nori', { hat: 'hat_beret', yaw: -0.40, dx: 3.35, dz: 0.75 }),
    ],
    shot: { aim: 0.66, span: 0.56, spanX: 0.43, elev: 0.02, rim: 0xd8ffe4 },
    scale: 1.00, dy: -0.05,
    text: { s: ['SIZZLE', 'SQUAD'], y: 372, size: 84, fill: '#FFFFFF', stroke: '#0F3D24' },
  },
  {
    id: 'e-closeup',
    label: 'Four across, chest-up crop',
    // Same cast and the same text placement as D — this variant differs only
    // in how close the camera sits. Cropping at chest height nearly doubles
    // every face, which is what actually carries a 150px tile, at the cost of
    // the aprons and the full-body silhouette.
    bg: ['#3EA76A', '#166534', '#B6F0C6'],
    parts: () => [
      ...dressed('bramble', { hat: 'hat_toque', yaw: 0.40, dx: -3.20, dz: 0.70 }),
      ...dressed('pip', { hat: 'hat_bandana_red', yaw: 0.16, dx: -1.07 }),
      ...dressed('mochi', { hat: 'hat_paper', yaw: -0.16, dx: 1.07 }),
      ...dressed('nori', { hat: 'hat_beret', yaw: -0.40, dx: 3.20, dz: 0.70 }),
    ],
    shot: { aim: 0.795, span: 0.475, spanX: 0.435, elev: 0.02, rim: 0xd8ffe4 },
    scale: 1.00, dy: -0.155,
    text: { s: ['SIZZLE', 'SQUAD'], y: 372, size: 84, fill: '#FFFFFF', stroke: '#0F3D24' },
  },
  {
    id: 'f-huddle',
    label: 'Staggered huddle',
    // Depth instead of a line-up: two chefs forward at centre, two set back
    // and wide. The group reads as a crowd rather than a rank, and the
    // silhouette gets a peak instead of a flat top — which is what separates
    // this from D at a glance in the feed.
    bg: ['#3EA76A', '#166534', '#B6F0C6'],
    parts: () => [
      ...dressed('bramble', { hat: 'hat_toque', yaw: 0.42, dx: -2.95, dz: -1.35 }),
      ...dressed('nori', { hat: 'hat_beret', yaw: -0.42, dx: 2.95, dz: -1.35 }),
      ...dressed('pip', { hat: 'hat_bandana_red', yaw: 0.18, dx: -1.02, dz: 1.15 }),
      ...dressed('mochi', { hat: 'hat_paper', yaw: -0.18, dx: 1.02, dz: 1.15 }),
    ],
    shot: { aim: 0.68, span: 0.545, spanX: 0.43, elev: 0.03, rim: 0xd8ffe4 },
    scale: 1.00, dy: -0.075,
    text: { s: ['SIZZLE', 'SQUAD'], y: 372, size: 84, fill: '#FFFFFF', stroke: '#0F3D24' },
  },
];

const browser = await chromium.launch();
const S = SIZE * SS;
for (const v of VARIANTS) {
  const png = await shoot(browser, three, {
    parts: v.parts(), size: S, tag: v.id, ...v.shot,
  });
  // Leave headroom for the shadow's offset: at scale 1 the subject already
  // fills the canvas and any offset copy of it overflows.
  const SHX = Math.round(S * 0.012);
  const SHY = Math.round(S * 0.022);
  const w = Math.min(Math.round(S * v.scale), S - SHY * 2);
  const subject = await sharp(png).resize(w, w, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  const clamp = (n) => Math.max(0, Math.min(S - w, n));
  const off = clamp(Math.round((S - w) / 2));
  const top = clamp(Math.round((S - w) / 2) + Math.round(S * v.dy));

  const layers = [
    { input: await withShadow(subject), left: clamp(off + SHX), top: clamp(top + SHY) },
    { input: subject, left: off, top },
  ];
  if (v.text) layers.push({ input: wordmark(v.text.s, v.text.y, v.text.size, v.text.fill, v.text.stroke), left: 0, top: 0 });

  const out = path.join(OUT, `${v.id}.png`);
  // TWO PASSES, DELIBERATELY. sharp runs resize BEFORE composite within one
  // pipeline, so chaining them shrinks the ground to 512 first and then
  // refuses the full-size layers. Composite at supersample, then downsample.
  const full = await sharp(ground(v.bg[0], v.bg[1], v.bg[2])).composite(layers).png().toBuffer();
  await sharp(full).resize(SIZE, SIZE, { kernel: 'lanczos3' }).png({ compressionLevel: 9 }).toFile(out);
  console.error(`wrote ${path.relative(process.cwd(), out)}  ${SIZE}x${SIZE}  — ${v.label}`);
}
await browser.close();
