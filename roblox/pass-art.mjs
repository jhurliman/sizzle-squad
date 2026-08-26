// Game-pass icons, rendered from the REAL assets: the captured chef rigs, the
// hand-tuned FitLab hat fits, and the same hue-cluster palette remap the game
// runs at runtime. The art therefore shows exactly what the pass grants.
//
// Roblox game-pass icons are 512x512 PNG, displayed around 150px -- so these
// are composed to read as a silhouette at thumbnail size: one chef, one hat,
// one strong colour, no text (Roblox renders the pass name beside the icon).
//
// Rendered at 4x and downsampled for clean edges.
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import * as THREE from '../node_modules/three/build/three.module.js';
import { chromium } from '../node_modules/playwright/index.mjs';
import sharp from '../node_modules/sharp/dist/index.cjs';

const DIR = path.dirname(new URL(import.meta.url).pathname);
const OUT = path.join(DIR, 'pass-art');
const chefs = JSON.parse(fs.readFileSync(path.join(DIR, 'chef-parts.json'), 'utf8')).skins;
const hats = JSON.parse(fs.readFileSync(path.join(DIR, 'hats-dump.json'), 'utf8'));
const FITS = JSON.parse(fs.readFileSync(path.join(DIR, 'hat-fits.json'), 'utf8'));

const SIZE = 512;
const SS = 4; // supersample

// ---------------------------------------------------------------- palette
// Port of ChefVisuals:ensure + applyPalette. Coat detection clusters by HUE
// weighted by part volume: a shaded rig authors its coat as two tones, and
// matching one exact colour picks the wrong thing (pip's cream belly).
const HUE_TOL = 0.09;
const MIN_SAT = 0.18;
const MIN_VAL = 0.12;

function rgb2hsv([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d !== 0) {
    if (mx === r) h = ((g - b) / d) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
    if (h < 0) h += 1;
  }
  return [h, mx === 0 ? 0 : d / mx, mx];
}

function hsv2rgb(h, s, v) {
  const i = Math.floor(h * 6), f = h * 6 - i;
  const p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
  const [r, g, b] = [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][i % 6];
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

function retint(parts, targetRgb) {
  if (!targetRgb) return parts;
  const hsv = parts.map((p) => rgb2hsv(p.color));
  const mass = parts.map((p) => p.size[0] * p.size[1] * p.size[2]);
  const bins = new Array(24).fill(0);
  hsv.forEach(([h, s, v], i) => {
    if (s >= MIN_SAT && v >= MIN_VAL) bins[Math.min(23, Math.floor(h * 24))] += mass[i];
  });
  let bestBin = 0;
  bins.forEach((m, i) => { if (m > bins[bestBin]) bestBin = i; });
  if (bins[bestBin] <= 0) return parts;
  const centre = (bestBin + 0.5) / 24;
  let sx = 0, sy = 0, ss = 0, sv = 0, wn = 0;
  hsv.forEach(([h, s, v], i) => {
    if (s < MIN_SAT || v < MIN_VAL) return;
    let d = Math.abs(h - centre); d = Math.min(d, 1 - d);
    if (d > HUE_TOL) return;
    sx += Math.cos(h * 2 * Math.PI) * mass[i];
    sy += Math.sin(h * 2 * Math.PI) * mass[i];
    ss += s * mass[i]; sv += v * mass[i]; wn += mass[i];
  });
  const meanH = ((Math.atan2(sy, sx) / (2 * Math.PI)) % 1 + 1) % 1;
  const refS = ss / wn, refV = sv / wn;
  const [th, ts, tv] = rgb2hsv(targetRgb);
  return parts.map((p, i) => {
    const [h, s, v] = hsv[i];
    let d = Math.abs(h - meanH); d = Math.min(d, 1 - d);
    if (s < MIN_SAT || v < MIN_VAL || d > HUE_TOL) return p;
    return { ...p, color: hsv2rgb(th, Math.min(1, ts * (s / refS)), Math.max(0.02, Math.min(1, tv * (v / refV)))) };
  });
}

// ------------------------------------------------------------------- hats
function resolveFit(skin, hatId) {
  const m = { scale: 1, offset: [0, 0, 0], tilt: [0, 0, 0], hideEars: false, ...FITS.defaults };
  const sp = FITS.species[skin];
  if (sp) Object.assign(m, sp.default ?? {}, sp[hatId] ?? {});
  return m;
}

function dressed(skin, hatId, paletteRgb, yaw, hideEars) {
  const body = chefs[skin].parts;
  const head = body.filter((p) => p.group === 'Head');
  let skull = head[0];
  for (const p of head) {
    if (p.size[0] * p.size[1] * p.size[2] > skull.size[0] * skull.size[1] * skull.size[2]) skull = p;
  }
  const headTop = Math.max(...head.map((p) => p.cf[1] + p.size[1] / 2));
  const anchorY = Math.max(headTop - 0.25, skull.cf[1] + skull.size[1] * 0.3);
  const fit = resolveFit(skin, hatId);
  // nori's ear reads as a jagged crest from three-quarters and looks like a
  // rendering fault at icon size, so a pass can force it away.
  if (hideEars) fit.hideEars = true;
  const hatScale = (Math.max(skull.size[0], skull.size[2]) / 1.55) * fit.scale;
  const [tx, tz, ty = 0] = fit.tilt;
  const attach = new THREE.Matrix4()
    .makeTranslation(skull.cf[0] + fit.offset[0], anchorY + fit.offset[1], skull.cf[2] + fit.offset[2])
    .multiply(new THREE.Matrix4().makeRotationX((tx * Math.PI) / 180))
    .multiply(new THREE.Matrix4().makeRotationY((ty * Math.PI) / 180))
    .multiply(new THREE.Matrix4().makeRotationZ((tz * Math.PI) / 180));

  let out = [];
  for (const p of body) {
    if (p.group === 'BuiltinHat') continue;
    if (fit.hideEars && p.group === 'Ears') continue;
    out.push({ ...p, cf: [...p.cf] });
  }
  out = retint(out, paletteRgb); // coat only; the hat keeps its own colours
  for (const hp of hats[hatId]) {
    const local = new THREE.Matrix4().set(
      hp.cf[3], hp.cf[4], hp.cf[5], hp.cf[0] * hatScale,
      hp.cf[6], hp.cf[7], hp.cf[8], hp.cf[1] * hatScale,
      hp.cf[9], hp.cf[10], hp.cf[11], hp.cf[2] * hatScale,
      0, 0, 0, 1,
    );
    const e = attach.clone().multiply(local).elements;
    out.push({
      shape: hp.shape,
      size: hp.size.map((v) => v * hatScale),
      cf: [e[12], e[13], e[14], e[0], e[4], e[8], e[1], e[5], e[9], e[2], e[6], e[10]],
      color: hp.color,
    });
  }
  // three-quarter turn: a dead-on front view reads flat at thumbnail size
  const R = new THREE.Matrix4().makeRotationY(yaw);
  out = out.map((p) => {
    const M = new THREE.Matrix4().set(
      p.cf[3], p.cf[4], p.cf[5], p.cf[0],
      p.cf[6], p.cf[7], p.cf[8], p.cf[1],
      p.cf[9], p.cf[10], p.cf[11], p.cf[2],
      0, 0, 0, 1,
    );
    const e = R.clone().multiply(M).elements;
    return { ...p, cf: [e[12], e[13], e[14], e[0], e[4], e[8], e[1], e[5], e[9], e[2], e[6], e[10]] };
  });
  // The yaw turns about the world origin, not about the rig, so the chef
  // drifts off-centre. Re-centre horizontally on its own bounding box.
  let mnX = 1e9, mxX = -1e9, mnZ = 1e9, mxZ = -1e9;
  for (const p of out) {
    const r = Math.max(...p.size) / 2;
    mnX = Math.min(mnX, p.cf[0] - r); mxX = Math.max(mxX, p.cf[0] + r);
    mnZ = Math.min(mnZ, p.cf[2] - r); mxZ = Math.max(mxZ, p.cf[2] + r);
  }
  const ox = (mnX + mxX) / 2, oz = (mnZ + mxZ) / 2;
  return out.map((p) => ({ ...p, cf: [p.cf[0] - ox, p.cf[1], p.cf[2] - oz, ...p.cf.slice(3)] }));
}

// ----------------------------------------------------------------- viewer
const VIEWER = `
const data = window.__PARTS__;
const scene = new THREE.Scene();
const key = new THREE.DirectionalLight(0xfff4e2, 2.5); key.position.set(26, 60, 44); scene.add(key);
const rim = new THREE.DirectionalLight(data.rim, 1.5); rim.position.set(-40, 24, -30); scene.add(rim);
scene.add(new THREE.AmbientLight(0xb6a894, 1.5));
scene.add(new THREE.HemisphereLight(0xe8dcc6, 0x59462f, 0.8));
const unitBox = new THREE.BoxGeometry(1, 1, 1);
const unitCyl = new THREE.CylinderGeometry(0.5, 0.5, 1, 28); unitCyl.rotateZ(-Math.PI / 2);
const unitBall = new THREE.SphereGeometry(0.5, 22, 16);
let minY = 1e9, maxY = -1e9, minX = 1e9, maxX = -1e9;
for (const p of data.parts) {
  const geo = p.shape === 'Cylinder' ? unitCyl : p.shape === 'Block' ? unitBox : unitBall;
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({
    color: new THREE.Color(p.color[0] / 255, p.color[1] / 255, p.color[2] / 255) }));
  const c = p.cf;
  const M = new THREE.Matrix4().set(c[3], c[4], c[5], c[0], c[6], c[7], c[8], c[1], c[9], c[10], c[11], c[2], 0, 0, 0, 1);
  M.multiply(new THREE.Matrix4().makeScale(p.size[0], p.size[1], p.size[2]));
  mesh.applyMatrix4(M);
  scene.add(mesh);
  const r = Math.max(p.size[0], p.size[1], p.size[2]) / 2;
  minY = Math.min(minY, c[1] - r); maxY = Math.max(maxY, c[1] + r);
  minX = Math.min(minX, c[0] - r); maxX = Math.max(maxX, c[0] + r);
}
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setClearColor(0x000000, 0);
renderer.setSize(data.size, data.size);
document.body.appendChild(renderer.domElement);
// Frame the hat, head and shoulders rather than the whole chef: these are
// displayed at ~150px, where a full body is a smudge and the thing the pass
// actually sells (the hat, the coat colour) is a few pixels tall.
const h = maxY - minY;
const cy = minY + h * 0.70;
const span = h * 0.62;
const fov = 26;
const dist = (span * 0.62) / Math.tan((fov * Math.PI) / 360) * 1.12;
const camera = new THREE.PerspectiveCamera(fov, 1, 1, 900);
camera.position.set(0, cy, dist);
camera.lookAt(0, cy, 0);
renderer.render(scene, camera);
window.__shot = renderer.domElement.toDataURL('image/png');
`;

// ------------------------------------------------------------------ passes
const PASSES = [
  {
    // Gold coat on deep indigo: the strongest contrast the palette allows,
    // and it reads as "premium" without needing a word of text.
    file: 'supporter-pass',
    skin: 'bramble',
    hat: 'hat_tophat',
    palette: [226, 184, 74], // pal_bramble_gold
    yaw: -0.38,
    rim: 0xffd98a,
    bg: ['#5a4aa8', '#2b2560', '#14112e'],
    glow: '#ffd98a',
  },
  {
    // The Midnight coat is nearly black, so it gets a warm light ground --
    // dark-on-dark disappears at thumbnail size.
    file: 'chefs-trunk',
    // nori over mochi: mochi's head is near-white and drops out of the
    // hue-cluster retint, so the Midnight coat only reached the torso and the
    // icon sold a cream bird. nori tints almost head to toe.
    skin: 'nori',
    hat: 'hat_mushroom',
    palette: [46, 48, 78], // pal_nori_midnight
    hideEars: true,
    yaw: 0.30,
    rim: 0xffd0a0,
    bg: ['#ffe9bd', '#e0a04e', '#8a4d1c'],
    glow: '#fff4dd',
  },
];

function background(bg, glow) {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}">
  <defs>
    <radialGradient id="g" cx="50%" cy="38%" r="78%">
      <stop offset="0%" stop-color="${bg[0]}"/>
      <stop offset="55%" stop-color="${bg[1]}"/>
      <stop offset="100%" stop-color="${bg[2]}"/>
    </radialGradient>
  </defs>
  <rect width="${SIZE}" height="${SIZE}" rx="96" fill="url(#g)"/>
  <circle cx="256" cy="228" r="168" fill="${glow}" opacity="0.16"/>
  <circle cx="256" cy="228" r="112" fill="${glow}" opacity="0.14"/>
  <rect x="10" y="10" width="${SIZE - 20}" height="${SIZE - 20}" rx="88"
        fill="none" stroke="#fff4dd" stroke-opacity="0.34" stroke-width="7"/>
</svg>`);
}

fs.mkdirSync(OUT, { recursive: true });
execSync(`npx esbuild --bundle --format=iife --outfile=${DIR}/three.iife.js ${DIR}/three-entry.mjs`, { cwd: DIR, stdio: 'ignore' });
const three = fs.readFileSync(path.join(DIR, 'three.iife.js'), 'utf8');
const browser = await chromium.launch();

for (const pass of PASSES) {
  const parts = dressed(pass.skin, pass.hat, pass.palette, pass.yaw, pass.hideEars);
  const payload = JSON.stringify({ parts, size: SIZE * SS, rim: pass.rim });
  const html = `<!doctype html><meta charset=utf-8><body style="margin:0">
<script>${three}</script><script>window.__PARTS__=${payload}</script><script>${VIEWER}</script></body>`;
  const file = path.join(DIR, `_p_${pass.file}.html`);
  fs.writeFileSync(file, html);
  const page = await browser.newPage({ viewport: { width: SIZE * SS, height: SIZE * SS } });
  await page.goto('file://' + file);
  await page.waitForFunction('typeof window.__shot === "string"', { timeout: 30000 });
  const chef = Buffer.from((await page.evaluate(() => window.__shot)).split(',')[1], 'base64');
  await page.close();
  fs.rmSync(file);

  const chefSmall = await sharp(chef).resize(SIZE, SIZE, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  const outFile = path.join(OUT, `${pass.file}.png`);
  await sharp(background(pass.bg, pass.glow))
    .composite([{ input: chefSmall, top: 0, left: 0 }])
    .png()
    .toFile(outFile);
  console.error(`wrote ${path.relative(process.cwd(), outFile)}  (${SIZE}x${SIZE})`);
}
await browser.close();
