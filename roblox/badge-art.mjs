// The eight badge icons, 512x512 PNG.
//
// Badges appear in lists at well under 100px, so each one is built around a
// single readable silhouette plus, where the achievement is a NUMBER, a large
// numeral -- "100 dishes" and "1000 dishes" are otherwise the same picture.
// Backgrounds are deliberately different hues so a row of them reads as eight
// things rather than one thing eight times.
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { chromium } from '../node_modules/playwright/index.mjs';
import sharp from '../node_modules/sharp/dist/index.cjs';
import { dressed, item, shoot } from './render-lib.mjs';

const DIR = path.dirname(new URL(import.meta.url).pathname);
const OUT = path.join(DIR, 'badge-art');
const SIZE = 512;
const SS = 4;

/** A leaning stack of plates, so the count reads as depth rather than a disc. */
function plateStack(n, scale) {
  const out = [];
  for (let i = 0; i < n; i++) {
    // Spacing has to exceed the plate's own thickness or the stack fuses
    // into one cylinder; the wobble keeps the rims from lining up perfectly.
    const wobble = (i % 2 === 0 ? 1 : -1) * 0.09 * scale;
    out.push(...item('plate', { scale, dy: i * 0.34 * scale, dx: wobble, yaw: i * 0.7 }));
  }
  return out;
}

const BADGES = [
  {
    file: 'first-dish',
    parts: () => item('plate_full', { scale: 2.6 }),
    aim: 0.55, span: 2.2, spanX: 1.1, elev: 0.8,
    bg: ['#8fd06a', '#3f7f36', '#1d3d1c'], glow: '#dfffc4',
  },
  {
    file: 'clean-service',
    parts: () => item('plate', { scale: 2.9 }),
    aim: 0.5, span: 3.4, spanX: 1.5, elev: 0.7,
    bg: ['#bfe9ff', '#3d86b5', '#16344c'], glow: '#ffffff',
    sparkle: true,
  },
  {
    file: 'three-stars',
    parts: () => dressed('mochi', { hat: 'hat_toque', yaw: -0.3 }),
    aim: 0.74, span: 0.58, elev: 0.14,
    bg: ['#ffd76a', '#c9832a', '#5d3410'], glow: '#fff2c0',
    stars: 3,
  },
  {
    file: 'full-house',
    parts: () => [
      ...dressed('bramble', { yaw: 0.25, dx: -10.5 }),
      ...dressed('pip', { yaw: 0.1, dx: -3.5 }),
      ...dressed('nori', { yaw: -0.1, dx: 3.5, hideEars: true }),
      ...dressed('mochi', { yaw: -0.25, dx: 10.5 }),
    ],
    aim: 0.62, span: 0.72, spanX: 0.78, elev: 0.08,
    bg: ['#c9a6ff', '#6a3fb5', '#2a1650'], glow: '#efe0ff',
    stars: 3,
  },
  {
    file: 'head-chef',
    parts: () => dressed('bramble', { hat: 'hat_toque', yaw: -0.35 }),
    aim: 0.76, span: 0.55, elev: 0.14,
    bg: ['#ffb95e', '#c05f1c', '#4d2408'], glow: '#ffe6b8',
    numeral: '10',
  },
  {
    file: 'century',
    parts: () => plateStack(5, 2.1),
    aim: 0.5, span: 1.5, spanX: 0.9, elev: 0.30,
    bg: ['#9fe6d6', '#2f8f7c', '#123b34'], glow: '#e0fff8',
    numeral: '100',
  },
  {
    file: 'thousand-plates',
    parts: () => plateStack(11, 1.9),
    aim: 0.5, span: 1.3, spanX: 0.9, elev: 0.22,
    bg: ['#9fbcff', '#33509c', '#131f42'], glow: '#dee8ff',
    numeral: '1000',
  },
  {
    file: 'founding-chef',
    parts: () => dressed('pip', { hat: 'hat_halo', yaw: 0.3 }),
    aim: 0.78, span: 0.56, elev: 0.14,
    bg: ['#ffe89a', '#b8862c', '#4a2f0c'], glow: '#fff6d0',
    laurel: true,
  },
];

function backdrop(b) {
  const stars = b.stars
    ? `<g transform="translate(256,84)">${[-1, 0, 1]
        .map((i) => `<text x="${i * 76}" y="0" font-family="Helvetica,Arial,sans-serif" font-size="${i === 0 ? 92 : 74}" fill="#fff6cf" stroke="#5d3410" stroke-width="5" text-anchor="middle">★</text>`)
        .join('')}</g>`
    : '';
  const laurel = b.laurel
    ? `<circle cx="256" cy="256" r="196" fill="none" stroke="#ffe89a" stroke-opacity="0.55" stroke-width="10" stroke-dasharray="26 18"/>`
    : '';
  const sparkle = b.sparkle
    ? [[150, 150, 30], [372, 190, 22], [330, 372, 26], [140, 340, 18]]
        .map(([x, y, r]) => `<text x="${x}" y="${y}" font-family="Helvetica,Arial,sans-serif" font-size="${r * 2}" fill="#ffffff" fill-opacity="0.9" text-anchor="middle">✦</text>`)
        .join('')
    : '';
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}">
  <defs><radialGradient id="g" cx="50%" cy="38%" r="78%">
    <stop offset="0%" stop-color="${b.bg[0]}"/>
    <stop offset="55%" stop-color="${b.bg[1]}"/>
    <stop offset="100%" stop-color="${b.bg[2]}"/>
  </radialGradient></defs>
  <rect width="${SIZE}" height="${SIZE}" rx="96" fill="url(#g)"/>
  <circle cx="256" cy="238" r="170" fill="${b.glow}" opacity="0.15"/>
  ${laurel}${sparkle}
  <rect x="10" y="10" width="${SIZE - 20}" height="${SIZE - 20}" rx="88"
        fill="none" stroke="#fff4dd" stroke-opacity="0.34" stroke-width="7"/>
</svg>`);
}

function overlay(b) {
  const stars = b.stars
    ? `<g transform="translate(256,96)">${[-1, 0, 1]
        .map((i) => `<text x="${i * 78}" y="${i === 0 ? -6 : 0}" font-family="Helvetica,Arial,sans-serif" font-size="${i === 0 ? 96 : 78}" fill="#fff3c4" stroke="#4a2f0c" stroke-width="6" paint-order="stroke" text-anchor="middle">★</text>`)
        .join('')}</g>`
    : '';
  // A numeral, bottom-heavy, with a fat dark stroke so it survives being
  // shrunk to a list thumbnail.
  const numeral = b.numeral
    ? `<text x="256" y="474" font-family="Helvetica,Arial,sans-serif" font-size="${b.numeral.length > 3 ? 128 : 150}" font-weight="bold"
         fill="#fff6cf" stroke="#3a2013" stroke-width="14" paint-order="stroke" text-anchor="middle">${b.numeral}</text>`
    : '';
  if (!stars && !numeral) return null;
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}">${stars}${numeral}</svg>`);
}

fs.mkdirSync(OUT, { recursive: true });
execSync(`npx esbuild --bundle --format=iife --outfile=${DIR}/three.iife.js ${DIR}/three-entry.mjs`, { cwd: DIR, stdio: 'ignore' });
const three = fs.readFileSync(path.join(DIR, 'three.iife.js'), 'utf8');
const browser = await chromium.launch();

for (const b of BADGES) {
  const png = await shoot(browser, three, {
    parts: b.parts(),
    size: SIZE * SS,
    aim: b.aim,
    span: b.span,
    spanX: b.spanX ?? 0.62,
    elev: b.elev ?? 0,
    tag: b.file,
  });
  const subject = await sharp(png).resize(SIZE, SIZE, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  const layers = [{ input: subject, top: 0, left: 0 }];
  const ov = overlay(b);
  if (ov) layers.push({ input: ov, top: 0, left: 0 });
  const file = path.join(OUT, `${b.file}.png`);
  await sharp(backdrop(b)).composite(layers).png().toFile(file);
  console.error(`wrote ${path.relative(process.cwd(), file)}`);
}
await browser.close();
