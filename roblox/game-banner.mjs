// THE EXPERIENCE DETAIL-PAGE THUMBNAIL (1920x1080).
//
// Not the square icon. This is the wide image Roblox uses as the page backdrop
// and in the scrollable listings that dominate iPad — it is seen larger and
// more often than the icon, and a raw gameplay screenshot wastes it.
//
// Two things this has that the icon cannot afford at 150px:
//
//   * THE KITCHEN. It is the most expensive thing in the project and it is
//     genuinely better than most of what it sits beside on Roblox. At 1920 wide
//     there is room to show it is a real, dressed, lit room rather than a
//     backdrop colour. Captured from the actual running game, not mocked.
//   * ALL FOUR CHEFS AT SIZE. The icon crops two of them to buy scale; here
//     they all fit, big, with the room behind them.
//
//   node roblox/game-banner.mjs
//
// Writes roblox/game-banner/{a,b,c}.png plus a contact sheet.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { chromium } from '../node_modules/playwright/index.mjs';
import sharp from '../node_modules/sharp/dist/index.cjs';
import { dressed, shoot } from './render-lib.mjs';

const DIR = path.dirname(new URL(import.meta.url).pathname);
const ROOT = path.resolve(DIR, '..');
const OUT = path.join(DIR, 'game-banner');
const W = 1920;
const H = 1080;
const SS = 2;

fs.mkdirSync(OUT, { recursive: true });
const three = fs.readFileSync(path.join(DIR, 'three.iife.js'), 'utf8');

// ------------------------------------------------------------ kitchen shot
// The real room, from the built web game. A marketing image of a kitchen game
// that does not show the kitchen is throwing away the one asset nobody else
// on the platform has.
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.ogg': 'audio/ogg', '.wasm': 'application/wasm' };

async function captureKitchen(browser) {
  const dist = path.join(ROOT, 'dist');
  if (!fs.existsSync(dist)) throw new Error('no dist/ — run `npm run build` first');
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]);
    let file = path.join(dist, rel === '/' ? 'index.html' : rel);
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(dist, 'index.html');
    res.setHeader('content-type', MIME[path.extname(file)] || 'application/octet-stream');
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;

  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForTimeout(3000);
  // START THE ROUND. The landing screen dims the whole scene behind a title
  // card and a button — capturing that gives you a screenshot of a menu.
  const start = await page.$('text=Start Cooking');
  if (start) await start.click();
  // Long enough for the board to fill and the bots to spread out and pick
  // things up. An empty kitchen at t=0 reads as a tech demo.
  await page.waitForTimeout(24000);
  // Strip the DOM overlay: the HUD is real UI and belongs in a SCREENSHOT, but
  // this image gets a title and four chefs composited over it, and two layers
  // of interface fighting each other is what makes a store page look cheap.
  await page.evaluate(() => {
    const app = document.getElementById('app');
    if (!app) return;
    for (const el of app.querySelectorAll('*')) {
      if (el.tagName !== 'CANVAS') el.style.display = 'none';
    }
  });
  await page.waitForTimeout(400);
  const buf = await page.screenshot({ type: 'png' });
  await page.close();
  server.close();
  return buf;
}

// ------------------------------------------------------------------- text
function titleSvg({ y, size, fill, stroke, text }) {
  const w = W * SS;
  const h = H * SS;
  const fs_ = size * SS;
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <text x="${w / 2}" y="${y * SS}" text-anchor="middle"
      font-family="Arial Black, Helvetica, Arial, sans-serif" font-weight="900"
      font-size="${fs_}" letter-spacing="${fs_ * 0.03}"
      stroke="${stroke}" stroke-width="${fs_ * 0.17}" stroke-linejoin="round"
      paint-order="stroke" fill="${fill}">${text}</text></svg>`);
}

// A readable floor under the chefs and the title: the kitchen is busy, and
// type over a busy image is type nobody reads.
function scrim(strength, bottom) {
  const w = W * SS;
  const h = H * SS;
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#0B2A16" stop-opacity="${strength * 0.55}"/>
        <stop offset="0.45" stop-color="#0B2A16" stop-opacity="${strength * 0.15}"/>
        <stop offset="1" stop-color="#07200F" stop-opacity="${bottom}"/>
      </linearGradient>
      <radialGradient id="v" cx="0.5" cy="0.45" r="0.78">
        <stop offset="0.55" stop-color="#000" stop-opacity="0"/>
        <stop offset="1" stop-color="#000" stop-opacity="0.42"/>
      </radialGradient>
    </defs>
    <rect width="${w}" height="${h}" fill="url(#g)"/>
    <rect width="${w}" height="${h}" fill="url(#v)"/></svg>`);
}

// ---------------------------------------------------------------- variants
const CREW = () => [
  ...dressed('bramble', { hat: 'hat_toque', yaw: 0.34, dx: -4.15, dz: 0.6 }),
  ...dressed('pip', { hat: 'hat_bandana_red', yaw: 0.13, dx: -1.4 }),
  ...dressed('mochi', { hat: 'hat_paper', yaw: -0.13, dx: 1.4 }),
  ...dressed('nori', { hat: 'hat_beret', yaw: -0.34, dx: 4.15, dz: 0.6 }),
];

const VARIANTS = [
  {
    id: 'a-kitchen-title',
    label: 'Kitchen behind the crew, title bottom',
    crewW: 0.60, crewY: 0.10, scrim: [1, 0.62],
    text: { text: 'SIZZLE SQUAD', y: 1000, size: 132, fill: '#FFFFFF', stroke: '#0F3D24' },
  },
  {
    id: 'b-kitchen-clean',
    label: 'Kitchen behind the crew, no text',
    // Roblox overlays its own name and buttons on the detail page, so a
    // wordless image is the one that never fights the chrome.
    crewW: 0.64, crewY: 0.045, scrim: [0.8, 0.42],
    text: null,
  },
  {
    id: 'c-wide-room',
    label: 'Room forward, crew smaller and lower',
    // The other two lead on the cast; this one leads on the place. Worth
    // testing because the kitchen is the differentiator, and in a scrollable
    // listing a legible ROOM may out-read four figures at thumbnail size.
    crewW: 0.44, crewY: 0.145, scrim: [0.55, 0.5],
    text: { text: 'SIZZLE SQUAD', y: 1012, size: 108, fill: '#FFE9A8', stroke: '#3A1A08' },
  },
];

// --------------------------------------------------------------------- run
const browser = await chromium.launch();
// The capture is ~30s of real browser time; keep it so iterating on the
// composition does not mean re-running the game every time. Delete
// _kitchen-raw.png (or pass --recapture) to take a fresh one.
const rawPath = path.join(OUT, '_kitchen-raw.png');
let kitchenRaw;
if (fs.existsSync(rawPath) && !process.argv.includes('--recapture')) {
  console.log('reusing _kitchen-raw.png (--recapture for a fresh one)');
  kitchenRaw = fs.readFileSync(rawPath);
} else {
  console.log('capturing the kitchen from the built game…');
  kitchenRaw = await captureKitchen(browser);
  fs.writeFileSync(rawPath, kitchenRaw);
}

const bigW = W * SS;
const bigH = H * SS;
const kitchen = await sharp(kitchenRaw).resize(bigW, bigH, { fit: 'cover', position: 'centre' }).toBuffer();

const sheet = [];
for (const v of VARIANTS) {
  // The crew, rendered square on transparent, then placed.
  // Render generously and TRIM, rather than guessing a framing that fits.
  // A row of four is a wide, short subject inside a square canvas: too tight a
  // span clips the ends (the first attempt sliced all four chefs off at the
  // shoulder and left the render's own frame edge visible down the picture),
  // and too loose leaves them tiny. Trimming the transparent margin afterwards
  // makes the framing exact instead of hand-tuned.
  const crewPng = await shoot(browser, three, {
    parts: CREW(), size: bigH, tag: `ban-${v.id}`,
    aim: 0.55, span: 0.86, spanX: 0.70, elev: 0.02, rim: 0xd8ffe4,
  });
  const tight = await sharp(crewPng).trim({ threshold: 1 }).png().toBuffer();
  const meta = await sharp(tight).metadata();
  const cw = Math.round(bigW * v.crewW);
  const chh = Math.round((meta.height / meta.width) * cw);
  const crew = await sharp(tight).resize(cw, chh).png().toBuffer();

  const layers = [
    { input: scrim(v.scrim[0], v.scrim[1]), top: 0, left: 0 },
    {
      input: crew,
      top: Math.max(0, Math.round(bigH - chh - bigH * v.crewY)),
      left: Math.round((bigW - cw) / 2),
    },
  ];
  if (v.text) layers.push({ input: titleSvg(v.text), top: 0, left: 0 });

  // Composite at supersample, THEN downsample — sharp applies resize before
  // composite within one pipeline, so this has to be two calls.
  const big = await sharp(kitchen).composite(layers).png().toBuffer();
  const file = path.join(OUT, `${v.id}.png`);
  await sharp(big).resize(W, H).png({ compressionLevel: 9 }).toFile(file);
  console.log(`  ${v.id.padEnd(20)} ${v.label}`);
  sheet.push(file);
}

// Contact sheet: three stacked at listing size, which is how they compete.
const TH = 360;
const tiles = await Promise.all(sheet.map((f) => sharp(f).resize(Math.round(TH * 16 / 9), TH).toBuffer()));
await sharp({ create: { width: Math.round(TH * 16 / 9), height: TH * tiles.length + 24 * (tiles.length - 1), channels: 4, background: { r: 20, g: 16, b: 12, alpha: 1 } } })
  .composite(tiles.map((t, i) => ({ input: t, top: i * (TH + 24), left: 0 })))
  .png().toFile(path.join(OUT, '_sheet.png'));

await browser.close();
console.log(`\nwrote ${OUT}`);
