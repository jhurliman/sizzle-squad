// Animation review sheets from anim-dump.json (written by pose-dump.luau,
// which runs the shipping ChefVisuals against the real rig file).
//
// A turnaround shows proportion; only a STRIP shows a gait. Everything here is
// laid out in ONE row under an ORTHOGRAPHIC camera held nearly level, so frame
// 8 is the same size as frame 1, knee angles can be compared straight across
// the row, and the ground plane collapses to a line you can read a hovering
// foot against.
//
//   anim-walk-<skin>.png  one stride, eight frames, profile then front
//   anim-idle.png         the cast standing: the static hock/knee rest pose
//   anim-face-<skin>.png  eyes open / mid-blink / jaw open on effort
//   anim-bank.png         turning left, straight, turning right
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import * as THREE from '../node_modules/three/build/three.module.js';
import { chromium } from '../node_modules/playwright/index.mjs';

const DIR = path.dirname(new URL(import.meta.url).pathname);
const dump = JSON.parse(fs.readFileSync(path.join(DIR, 'anim-dump.json'), 'utf8'));
const SPECIES = ['bramble', 'pip', 'nori', 'mochi'];

function place(parts, yaw, dx) {
  const R = new THREE.Matrix4().makeRotationY(yaw);
  return parts.map((p) => {
    const c = p.cf;
    const M = new THREE.Matrix4().set(
      c[3], c[4], c[5], c[0],
      c[6], c[7], c[8], c[1],
      c[9], c[10], c[11], c[2],
      0, 0, 0, 1,
    );
    const e = R.clone().multiply(M).elements; // column-major
    return {
      ...p,
      cf: [e[12] + dx, e[13], e[14], e[0], e[4], e[8], e[1], e[5], e[9], e[2], e[6], e[10]],
    };
  });
}

const VIEWER = `
const d = window.__SCENE__;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9db4c4);
const sun = new THREE.DirectionalLight(0xfff2dd, 2.0);
sun.position.set(40, 80, 90);
scene.add(sun);
scene.add(new THREE.AmbientLight(0xb0a090, 1.7));
scene.add(new THREE.HemisphereLight(0xcfd8e6, 0x6b5a44, 0.7));
const unitBox = new THREE.BoxGeometry(1, 1, 1);
const unitCyl = new THREE.CylinderGeometry(0.5, 0.5, 1, 24);
unitCyl.rotateZ(-Math.PI / 2);
const unitBall = new THREE.SphereGeometry(0.5, 18, 12);
for (const p of d.parts) {
  const geo = p.shape === 'Cylinder' ? unitCyl : p.shape === 'Block' ? unitBox : unitBall;
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({
    color: new THREE.Color(p.color[0] / 255, p.color[1] / 255, p.color[2] / 255),
  }));
  const c = p.cf;
  const M = new THREE.Matrix4().set(c[3], c[4], c[5], c[0], c[6], c[7], c[8], c[1], c[9], c[10], c[11], c[2], 0, 0, 0, 1);
  M.multiply(new THREE.Matrix4().makeScale(p.size[0], p.size[1], p.size[2]));
  mesh.applyMatrix4(M);
  scene.add(mesh);
}
// The floor is the point of the exercise: a foot that hovers or sinks shows up
// against it instantly, and the stud grid is the ruler.
const ground = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), new THREE.MeshLambertMaterial({ color: 0x8a8378 }));
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.02;
scene.add(ground);
scene.add(new THREE.GridHelper(900, 900, 0x615d55, 0x615d55));
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(d.w, d.h);
document.body.appendChild(renderer.domElement);
const halfW = d.span / 2;
const halfH = halfW * d.h / d.w;
const camera = new THREE.OrthographicCamera(-halfW, halfW, halfH, -halfH, -600, 600);
// DEAD LEVEL, on purpose: an orthographic camera at eye height collapses the
// floor to a single horizontal line at y=0, and a foot that hovers or sinks is
// then a gap you can measure with your eye instead of a guess through a
// perspective ramp.
camera.position.set(0, d.cy, 190);
camera.lookAt(0, d.cy, 0);
renderer.render(scene, camera);
window.__shot = renderer.domElement.toDataURL('image/png');
`;

execSync(`npx esbuild --bundle --format=iife --outfile=${DIR}/three.iife.js ${DIR}/three-entry.mjs`, {
  cwd: DIR,
  stdio: 'ignore',
});
const three = fs.readFileSync(path.join(DIR, 'three.iife.js'), 'utf8');
const browser = await chromium.launch();

async function shoot(name, parts, { w, h, span, cy }) {
  const html = `<!doctype html><meta charset=utf-8><body style="margin:0">
<script>${three}</script>
<script>window.__SCENE__=${JSON.stringify({ parts, w, h, span, cy })}</script>
<script>${VIEWER}</script></body>`;
  const file = path.join(DIR, `_a_${name}.html`);
  fs.writeFileSync(file, html);
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  await page.goto('file://' + file);
  await page.waitForFunction('typeof window.__shot === "string"', { timeout: 20000 });
  fs.writeFileSync(path.join(DIR, `${name}.png`), Buffer.from((await page.evaluate(() => window.__shot)).split(',')[1], 'base64'));
  await page.close();
  fs.rmSync(file);
  console.error(`wrote ${name}.png`);
}

// The dump is already through `baseCF`, which yaws the rig by (-heading +
// pi/2): at heading 0 a chef faces world +X. So the profile is the UNROTATED
// dump and the face wants a quarter turn back toward the camera.
const SIDE = 0;
const FRONT = -Math.PI / 2;
const STEP = 6;

for (const skin of SPECIES) {
  const walk = dump[skin].walk;
  const n = walk.length;
  const mid = (n - 1) / 2;
  await shoot(
    `anim-walk-${skin}`,
    walk.flatMap((f, i) => place(f, SIDE, (i - mid) * STEP)),
    { w: 2400, h: 700, span: STEP * n, cy: 5.2 },
  );
  await shoot(
    `anim-walk-${skin}-front`,
    walk.flatMap((f, i) => place(f, FRONT, (i - mid) * STEP)),
    { w: 2400, h: 700, span: STEP * n, cy: 5.2 },
  );

  const keys = ['open', 'blink', 'mouth'].filter((k) => dump[skin][k]);
  await shoot(
    `anim-face-${skin}`,
    keys.flatMap((k, i) => place(dump[skin][k], FRONT, (i - (keys.length - 1) / 2) * 4.5)),
    { w: 1500, h: 700, span: 13.5, cy: 7.2 },
  );
}

await shoot(
  'anim-idle',
  SPECIES.flatMap((skin, i) => [
    ...place(dump[skin].idle, SIDE, (i - 1.5) * 6 - 13),
    ...place(dump[skin].idle, FRONT, (i - 1.5) * 6 + 13),
  ]),
  { w: 2400, h: 700, span: 50, cy: 5.2 },
);

await shoot(
  'anim-bank',
  SPECIES.flatMap((skin, i) => dump[skin].bank.flatMap((f, j) => place(f, FRONT, (i - 1.5) * 22 + (j - 1) * 6))),
  { w: 2400, h: 620, span: 90, cy: 5.2 },
);

await browser.close();
