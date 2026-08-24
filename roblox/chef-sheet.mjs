// Avatar review turnarounds: per species, front/side/back, in two hat
// states — built-in species hat, and the paper cosmetic hat (mirroring
// Hats.luau's hat_paper build + ChefVisuals' skull attach math).
// Outputs sheet-<skin>-<builtin|paper>.png (8 images).
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import * as THREE from '../node_modules/three/build/three.module.js';
import { chromium } from '../node_modules/playwright/index.mjs';

const DIR = path.dirname(new URL(import.meta.url).pathname);
const data = JSON.parse(fs.readFileSync(path.join(DIR, 'chef-parts.json'), 'utf8'));
const SPECIES = Object.keys(data.skins);
const ANGLES = [0, Math.PI / 2, Math.PI]; // front, side, back (rigs face +Z)

function rotatePart(p, yaw, dx) {
  const R = new THREE.Matrix4().makeRotationY(yaw);
  const M = new THREE.Matrix4().set(
    p.cf[3], p.cf[4], p.cf[5], p.cf[0],
    p.cf[6], p.cf[7], p.cf[8], p.cf[1],
    p.cf[9], p.cf[10], p.cf[11], p.cf[2],
    0, 0, 0, 1,
  );
  const M2 = R.clone().multiply(M);
  const e = M2.elements; // column-major
  return {
    ...p,
    cf: [e[12] + dx, e[13], e[14], e[0], e[4], e[8], e[1], e[5], e[9], e[2], e[6], e[10]],
  };
}

// paper hat parts mirroring Hats.luau hat_paper (pleated) + ChefVisuals
// attach math, driven by the SAME hat-fits.json registry the game uses
const FITS = JSON.parse(fs.readFileSync(path.join(DIR, 'hat-fits.json'), 'utf8'));
function resolveFit(skin, hatId) {
  const merged = { scale: 1, offset: [0, 0, 0], tilt: [0, 0], hideEars: false, ...FITS.defaults };
  const species = FITS.species[skin];
  if (species) {
    Object.assign(merged, species.default ?? {}, species[hatId] ?? {});
  }
  return merged;
}
function paperHatParts(parts, skin) {
  const head = parts.filter((p) => p.group === 'Head');
  if (head.length === 0) return [];
  let skull = head[0];
  for (const p of head) {
    if (p.size[0] * p.size[1] * p.size[2] > skull.size[0] * skull.size[1] * skull.size[2]) skull = p;
  }
  const fit = resolveFit(skin, 'hat_paper');
  const s = (Math.max(skull.size[0], skull.size[2]) / 1.55) * fit.scale;
  const [tx, tz, ty = 0] = fit.tilt;
  // Anchor identical to ChefVisuals + FitLab: max(headTop-0.25, skull+0.3),
  // headTop over Head-group parts only (the built-in hat is BuiltinHat now,
  // so it no longer inflates this — the whole pip floating-hat bug).
  const headTop = Math.max(...head.map((p) => p.cf[1] + p.size[1] / 2));
  const anchorY = Math.max(headTop - 0.25, skull.cf[1] + skull.size[1] * 0.3);
  const attach = new THREE.Matrix4()
    .makeTranslation(skull.cf[0] + fit.offset[0], anchorY + fit.offset[1], skull.cf[2] + fit.offset[2])
    .multiply(new THREE.Matrix4().makeRotationX((tx * Math.PI) / 180))
    .multiply(new THREE.Matrix4().makeRotationY((ty * Math.PI) / 180))
    .multiply(new THREE.Matrix4().makeRotationZ((tz * Math.PI) / 180))
    .multiply(new THREE.Matrix4().makeRotationX((4 * Math.PI) / 180))
    .multiply(new THREE.Matrix4().makeRotationZ((6 * Math.PI) / 180));
  const out = [];
  const add = (shape, size, x, y, z, color, cylinder) => {
    const M = attach.clone().multiply(new THREE.Matrix4().makeTranslation(x * s, y * s, z * s));
    if (cylinder) M.multiply(new THREE.Matrix4().makeRotationZ(Math.PI / 2));
    const e = M.elements;
    out.push({
      group: 'PaperHat',
      shape,
      size: size.map((v) => v * s),
      cf: [e[12], e[13], e[14], e[0], e[4], e[8], e[1], e[5], e[9], e[2], e[6], e[10]],
      color,
    });
  };
  add('Cylinder', [0.4, 1.42, 1.42], 0, 0.18, 0, [245, 240, 230], true);
  add('Cylinder', [0.07, 1.46, 1.46], 0, 0.38, 0, [226, 219, 203], true);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    add(
      'Cylinder',
      [0.68, 0.3, 0.3],
      Math.cos(a) * 0.56,
      0.72,
      Math.sin(a) * 0.56,
      i % 2 === 0 ? [245, 240, 230] : [233, 227, 213],
      true,
    );
  }
  add('SphereMesh', [1.5, 0.78, 1.5], 0, 1.02, 0, [245, 240, 230], false);
  add('SphereMesh', [1.1, 0.55, 1.1], 0.1, 1.22, 0.05, [250, 246, 238], false);
  return out;
}

const viewer = fs.readFileSync(path.join(DIR, 'sheet-viewer.js'), 'utf8');
execSync(`npx esbuild --bundle --format=iife --outfile=${DIR}/three.iife.js ${DIR}/three-entry.mjs`, {
  cwd: DIR,
  stdio: 'ignore',
});

const browser = await chromium.launch();
for (const hatState of ['builtin', 'paper']) {
  for (const skin of SPECIES) {
    let parts = data.skins[skin].parts;
    if (hatState === 'paper') {
      const fit = resolveFit(skin, 'hat_paper');
      parts = parts
        .filter((p) => p.group !== 'BuiltinHat' && (!fit.hideEars || p.group !== 'Ears'))
        .concat(paperHatParts(parts, skin));
    }
    const all = [];
    ANGLES.forEach((yaw, ai) => {
      for (const p of parts) all.push(rotatePart(p, yaw, (ai - 1) * 9));
    });
    const name = `sheet-${skin}-${hatState}`;
    const html = `<!doctype html><meta charset="utf-8"><body style="margin:0">
<script>${fs.readFileSync(path.join(DIR, 'three.iife.js'), 'utf8')}</script>
<script>window.__PARTS__ = ${JSON.stringify({ parts: all })};</script>
<script>${viewer}</script></body>`;
    const file = path.join(DIR, `${name}.html`);
    fs.writeFileSync(file, html);
    const page = await browser.newPage({ viewport: { width: 1280, height: 640 } });
    await page.goto('file://' + file);
    await page.waitForFunction('typeof window.__shot === "string"', { timeout: 20000 });
    const dataUrl = await page.evaluate(() => window.__shot);
    fs.writeFileSync(path.join(DIR, `${name}.png`), Buffer.from(dataUrl.split(',')[1], 'base64'));
    await page.close();
    fs.rmSync(file);
    console.error(`wrote ${name}.png`);
  }
}
await browser.close();
