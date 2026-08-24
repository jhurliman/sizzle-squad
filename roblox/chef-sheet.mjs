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

// paper hat parts mirroring Hats.luau hat_paper + ChefVisuals attach math
function paperHatParts(parts) {
  const head = parts.filter((p) => p.group === 'Head');
  if (head.length === 0) return [];
  let skull = head[0];
  for (const p of head) {
    if (p.size[0] * p.size[1] * p.size[2] > skull.size[0] * skull.size[1] * skull.size[2]) skull = p;
  }
  const ax = skull.cf[0];
  const ay = skull.cf[1] + skull.size[1] * 0.42; // skull top, slightly sunk
  const az = skull.cf[2];
  const s = Math.max(skull.size[0], skull.size[2]) / 1.55;
  const RZ90 = [0, -1, 0, 1, 0, 0, 0, 0, 1];
  return [
    { group: 'PaperHat', shape: 'Cylinder', size: [0.45 * s, 1.35 * s, 1.35 * s], cf: [ax, ay + 0.2 * s, az, ...RZ90], color: [245, 240, 230] },
    { group: 'PaperHat', shape: 'Cylinder', size: [0.5 * s, 1.1 * s, 1.1 * s], cf: [ax, ay + 0.62 * s, az, ...RZ90], color: [232, 226, 212] },
  ];
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
      parts = parts.filter((p) => p.group !== 'BuiltinHat').concat(paperHatParts(parts));
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
