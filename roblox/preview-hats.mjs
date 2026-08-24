// Renders hats-dump.json as a contact sheet: each hat from a 3/4 angle,
// laid out in a grid. Reuses the sheet viewer geometry.
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import * as THREE from '../node_modules/three/build/three.module.js';
import { chromium } from '../node_modules/playwright/index.mjs';

const DIR = path.dirname(new URL(import.meta.url).pathname);
const hats = JSON.parse(fs.readFileSync(path.join(DIR, 'hats-dump.json'), 'utf8'));
const IDS = Object.keys(hats);

function rot(p, yaw, dx, dz) {
  const R = new THREE.Matrix4().makeRotationY(yaw);
  const M = new THREE.Matrix4().set(
    p.cf[3], p.cf[4], p.cf[5], p.cf[0],
    p.cf[6], p.cf[7], p.cf[8], p.cf[1],
    p.cf[9], p.cf[10], p.cf[11], p.cf[2],
    0, 0, 0, 1,
  );
  const M2 = R.clone().multiply(M);
  const e = M2.elements;
  return { ...p, cf: [e[12] + dx, e[13], e[14] + dz, e[0], e[4], e[8], e[1], e[5], e[9], e[2], e[6], e[10]] };
}

const all = [];
const cols = 6;
const GX = 3.0;
const GZ = 0;
IDS.forEach((id, i) => {
  const perRow = 6;
  const dx = (i % perRow) * GX - ((perRow - 1) * GX) / 2;
  const dz = Math.floor(i / perRow) * 5;
  // baseline-align: drop each hat so its lowest point sits at y=0
  let minY = Infinity;
  for (const p of hats[id]) minY = Math.min(minY, p.cf[1] - Math.max(...p.size) / 2);
  for (const p of hats[id]) {
    const q = { ...p, cf: [...p.cf] };
    q.cf[1] -= minY;
    all.push(rot(q, Math.PI * 0.18, dx, dz));
  }
});

execSync(`npx esbuild --bundle --format=iife --outfile=${DIR}/three.iife.js ${DIR}/three-entry.mjs`, { cwd: DIR, stdio: 'ignore' });
const viewer = `
const data = window.__PARTS__;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8fa6b8);
const sun = new THREE.DirectionalLight(0xfff2dd, 2.4); sun.position.set(20, 40, 30); scene.add(sun);
scene.add(new THREE.AmbientLight(0xb0a090, 1.5));
scene.add(new THREE.HemisphereLight(0xcfd8e6, 0x6b5a44, 0.7));
const box = new THREE.BoxGeometry(1,1,1);
const cyl = new THREE.CylinderGeometry(0.5,0.5,1,24); cyl.rotateZ(-Math.PI/2);
const ball = new THREE.SphereGeometry(0.5,20,14);
for (const p of data.parts) {
  const geo = p.shape==='Cylinder'?cyl:p.shape==='Block'?box:ball;
  const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({color:new THREE.Color(p.color[0]/255,p.color[1]/255,p.color[2]/255)}));
  const c=p.cf;
  const M=new THREE.Matrix4().set(c[3],c[4],c[5],c[0],c[6],c[7],c[8],c[1],c[9],c[10],c[11],c[2],0,0,0,1);
  M.multiply(new THREE.Matrix4().makeScale(p.size[0],p.size[1],p.size[2]));
  m.applyMatrix4(M); scene.add(m);
}
const renderer=new THREE.WebGLRenderer({antialias:true}); renderer.setSize(1280,720);
document.body.appendChild(renderer.domElement);
const cam=new THREE.PerspectiveCamera(34,1280/720,0.5,200); cam.position.set(0,11,15); cam.lookAt(0,0.5,2.5);
renderer.render(scene,cam);
window.__shot=renderer.domElement.toDataURL('image/png');
`;
const html = `<!doctype html><meta charset=utf-8><body style="margin:0">
<script>${fs.readFileSync(path.join(DIR, 'three.iife.js'), 'utf8')}</script>
<script>window.__PARTS__=${JSON.stringify({ parts: all })}</script>
<script>${viewer}</script></body>`;
fs.writeFileSync(path.join(DIR, 'hats-preview.html'), html);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto('file://' + path.join(DIR, 'hats-preview.html'));
await page.waitForFunction('typeof window.__shot === "string"', { timeout: 20000 });
fs.writeFileSync(path.join(DIR, 'hats-preview.png'), Buffer.from((await page.evaluate(() => window.__shot)).split(',')[1], 'base64'));
await browser.close();
fs.rmSync(path.join(DIR, 'hats-preview.html'));
console.error('wrote hats-preview.png');
