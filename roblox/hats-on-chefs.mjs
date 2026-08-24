// Final verification: renders each hat on each species at its resolved fit
// (replicating ChefVisuals' attach math + hideEars), one sheet per species
// (12 hats in a 4x3 grid). Confirms the merged hat-fits.json in-context.
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import * as THREE from '../node_modules/three/build/three.module.js';
import { chromium } from '../node_modules/playwright/index.mjs';

const DIR = path.dirname(new URL(import.meta.url).pathname);
const chefs = JSON.parse(fs.readFileSync(path.join(DIR, 'chef-parts.json'), 'utf8')).skins;
const hats = JSON.parse(fs.readFileSync(path.join(DIR, 'hats-dump.json'), 'utf8'));
const FITS = JSON.parse(fs.readFileSync(path.join(DIR, 'hat-fits.json'), 'utf8'));
const HAT_IDS = ['hat_paper', 'hat_toque', 'hat_bandana_red', 'hat_bandana_green', 'hat_beret', 'hat_paperboat', 'hat_colander', 'hat_tophat', 'hat_crown', 'hat_pan', 'hat_mushroom', 'hat_halo'];

function resolveFit(skin, hatId) {
  const m = { scale: 1, offset: [0, 0, 0], tilt: [0, 0, 0], hideEars: false, ...FITS.defaults };
  const sp = FITS.species[skin];
  if (sp) Object.assign(m, sp.default ?? {}, sp[hatId] ?? {});
  return m;
}

// place a hat's parts (from hats-dump, hat-local space) onto a rig at the
// resolved fit; returns transformed parts in world space with dx/dz offset
function placeHat(skin, hatId, dx, dz) {
  const body = chefs[skin].parts;
  const head = body.filter((p) => p.group === 'Head');
  let skull = head[0];
  for (const p of head) if (p.size[0] * p.size[1] * p.size[2] > skull.size[0] * skull.size[1] * skull.size[2]) skull = p;
  const headTop = Math.max(...head.map((p) => p.cf[1] + p.size[1] / 2));
  const anchorY = Math.max(headTop - 0.25, skull.cf[1] + skull.size[1] * 0.3);
  const fit = resolveFit(skin, hatId);
  const hatScale = (Math.max(skull.size[0], skull.size[2]) / 1.55) * fit.scale;
  const [tx, tz, ty = 0] = fit.tilt;
  const attach = new THREE.Matrix4()
    .makeTranslation(skull.cf[0] + fit.offset[0] + dx, anchorY + fit.offset[1], skull.cf[2] + fit.offset[2] + dz)
    .multiply(new THREE.Matrix4().makeRotationX((tx * Math.PI) / 180))
    .multiply(new THREE.Matrix4().makeRotationY((ty * Math.PI) / 180))
    .multiply(new THREE.Matrix4().makeRotationZ((tz * Math.PI) / 180));

  const out = [];
  // body (hide BuiltinHat always; Ears if fit says so), shifted to slot
  for (const p of body) {
    if (p.group === 'BuiltinHat') continue;
    if (fit.hideEars && p.group === 'Ears') continue;
    const q = { ...p, cf: [...p.cf] };
    q.cf[0] += dx;
    q.cf[2] += dz;
    out.push(q);
  }
  // hat parts (hat-dump cf is [px,py,pz,R00..R22] in hat space, studs)
  for (const hp of hats[hatId]) {
    const local = new THREE.Matrix4().set(
      hp.cf[3], hp.cf[4], hp.cf[5], hp.cf[0] * hatScale,
      hp.cf[6], hp.cf[7], hp.cf[8], hp.cf[1] * hatScale,
      hp.cf[9], hp.cf[10], hp.cf[11], hp.cf[2] * hatScale,
      0, 0, 0, 1,
    );
    const M = attach.clone().multiply(local);
    const e = M.elements;
    out.push({
      shape: hp.shape,
      size: hp.size.map((v) => v * hatScale),
      cf: [e[12], e[13], e[14], e[0], e[4], e[8], e[1], e[5], e[9], e[2], e[6], e[10]],
      color: hp.color,
    });
  }
  return out;
}

const viewer = fs.readFileSync(path.join(DIR, 'sheet-viewer.js'), 'utf8')
  .replace('renderer.setSize(1280, 640)', 'renderer.setSize(1280, 960)')
  .replace('cam.position.set(0, 6, 32)', 'cam.position.set(0, 40, 40)')
  .replace('camera.position.set(0, 6, 32)', 'camera.position.set(0, 30, 46)').replace('PerspectiveCamera(30','PerspectiveCamera(42')
  .replace('camera.lookAt(0, 4.4, 0)', 'camera.lookAt(0, 2, 11)');

execSync(`npx esbuild --bundle --format=iife --outfile=${DIR}/three.iife.js ${DIR}/three-entry.mjs`, { cwd: DIR, stdio: 'ignore' });
const browser = await chromium.launch();
for (const skin of Object.keys(chefs)) {
  const all = [];
  HAT_IDS.forEach((hatId, i) => {
    const dx = (i % 4) * 11 - 16.5;
    const dz = Math.floor(i / 4) * 11;
    for (const p of placeHat(skin, hatId, dx, dz)) all.push(p);
  });
  const html = `<!doctype html><meta charset=utf-8><body style="margin:0">
<script>${fs.readFileSync(path.join(DIR, 'three.iife.js'), 'utf8')}</script>
<script>window.__PARTS__=${JSON.stringify({ parts: all })}</script>
<script>${viewer}</script></body>`;
  const file = path.join(DIR, `_h_${skin}.html`);
  fs.writeFileSync(file, html);
  const page = await browser.newPage({ viewport: { width: 1280, height: 960 } });
  await page.goto('file://' + file);
  await page.waitForFunction('typeof window.__shot === "string"', { timeout: 20000 });
  fs.writeFileSync(path.join(DIR, `hats-on-${skin}.png`), Buffer.from((await page.evaluate(() => window.__shot)).split(',')[1], 'base64'));
  await page.close();
  fs.rmSync(file);
  console.error(`wrote hats-on-${skin}.png`);
}
await browser.close();
