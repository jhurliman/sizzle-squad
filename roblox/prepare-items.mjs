// itemdump.json -> item-parts.json: Roblox part specs per species, grouped by
// skeleton part. Same shape conversions as prepare.mjs (boxes/cyls/balls 1:1,
// cones + lathes as stacked cylinder slices, planes as thin slabs).
import fs from 'node:fs';
import * as THREE from '../node_modules/three/build/three.module.js';

const S = 5; // studs per world unit — matches the environment
const PLANE_T = 0.03;
const dump = JSON.parse(fs.readFileSync(new URL('./itemdump.json', import.meta.url), 'utf8'));

const out = { scale: S, items: {} };

for (const [skin, prims] of Object.entries(dump)) {
  const parts = [];
  const emit = (group, shape, size, M, color) => {
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scl = new THREE.Vector3();
    M.decompose(pos, quat, scl);
    const R = new THREE.Matrix4().makeRotationFromQuaternion(quat).elements;
    parts.push({
      group,
      shape,
      size: size.map((v) => Math.max(0.02, v * S)),
      cf: [pos.x * S, pos.y * S, pos.z * S, R[0], R[4], R[8], R[1], R[5], R[9], R[2], R[6], R[10]],
      color,
    });
  };
  const ROT_Z90 = new THREE.Matrix4().makeRotationZ(Math.PI / 2);
  const ROT_Y90 = new THREE.Matrix4().makeRotationY(Math.PI / 2);

  for (const p of prims) {
    const M = new THREE.Matrix4().compose(
      new THREE.Vector3(...p.pos),
      new THREE.Quaternion(...p.quat),
      new THREE.Vector3(1, 1, 1),
    );
    const [sx, sy, sz] = p.scale;
    const color = [
      parseInt(p.color.slice(0, 2), 16),
      parseInt(p.color.slice(2, 4), 16),
      parseInt(p.color.slice(4, 6), 16),
    ];
    if (p.kind === 'box') {
      const [w = 1, h = 1, d = 1] = p.args;
      emit(p.group, 'Block', [w * sx, h * sy, d * sz], M, color);
    } else if (p.kind === 'cyl') {
      const [rt = 1, rb = rt, h = 1] = p.args;
      const r = (rt + rb) / 2;
      emit(p.group, 'Cylinder', [h * sy, 2 * r * sx, 2 * r * sz], M.clone().multiply(ROT_Z90), color);
    } else if (p.kind === 'ball') {
      const [r = 1] = p.args;
      const uniform = Math.abs(sx - sy) < 1e-6 && Math.abs(sy - sz) < 1e-6;
      emit(p.group, uniform ? 'Ball' : 'SphereMesh', [2 * r * sx, 2 * r * sy, 2 * r * sz], M, color);
    } else if (p.kind === 'cone') {
      const [r = 1, h = 1] = p.args;
      for (let i = 0; i < 3; i++) {
        const rMid = r * (1 - (i + 0.5) / 3);
        const yC = -h / 2 + ((i + 0.5) / 3) * h;
        emit(
          p.group,
          'Cylinder',
          [(h / 3) * sy, 2 * rMid * sx, 2 * rMid * sz],
          M.clone().multiply(new THREE.Matrix4().makeTranslation(0, yC * sy, 0)).multiply(ROT_Z90),
          color,
        );
      }
    } else if (p.kind === 'lathe') {
      const pts = p.args[0];
      for (let i = 0; i + 1 < pts.length; i++) {
        const h = pts[i + 1].y - pts[i].y;
        if (h < 1e-4) continue;
        const r = Math.max(0.008, (pts[i].x + pts[i + 1].x) / 2);
        const yC = (pts[i].y + pts[i + 1].y) / 2;
        emit(
          p.group,
          'Cylinder',
          [h * sy, 2 * r * sx, 2 * r * sz],
          M.clone().multiply(new THREE.Matrix4().makeTranslation(0, yC * sy, 0)).multiply(ROT_Z90),
          color,
        );
      }
    } else if (p.kind === 'plane' || p.kind === 'circle') {
      const isCircle = p.kind === 'circle';
      const M2 = M.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0, -PLANE_T / 2));
      if (isCircle) {
        const [r = 1] = p.args;
        emit(p.group, 'Cylinder', [PLANE_T, 2 * r * sx, 2 * r * sy], M2.multiply(ROT_Y90), color);
      } else {
        const [w = 1, h = 1] = p.args;
        emit(p.group, 'Block', [w * sx, h * sy, PLANE_T], M2, color);
      }
    } else if (p.kind === 'ring') {
      const [, ro = 1] = p.args;
      const M2 = M.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0, -PLANE_T / 2)).multiply(ROT_Y90);
      emit(p.group, 'Cylinder', [PLANE_T, 2 * ro * sx, 2 * ro * sy], M2, color);
    } else if (p.kind === 'torus') {
      const [r = 0.1, tube = 0.03] = p.args;
      emit(p.group, 'Cylinder', [tube * 2 * sy, 2 * (r + tube) * sx, 2 * (r + tube) * sz], M.clone().multiply(ROT_Z90), color);
    } else if (p.kind === 'capsule') {
      const [r = 0.1, len = 0.1] = p.args;
      emit(p.group, 'Block', [2 * r * sx, (len + 2 * r) * sy, 2 * r * sz], M, color);
    }
  }
  out.items[skin] = parts;
  console.error(`${skin}: ${parts.length} parts`);
}

// ---- richer cooked/burnt bacon: same pile as raw, browned/charred ----------
const browning = (c, target, f) => [
  Math.round(c[0] + (target[0] - c[0]) * f),
  Math.round(c[1] + (target[1] - c[1]) * f),
  Math.round(c[2] + (target[2] - c[2]) * f),
];
const recolorPile = (source, target, f) =>
  source.map((p) => ({ ...p, color: p.color[0] > 110 ? browning(p.color, target, f) : p.color }));
const COOKED = [125, 74, 36];
const BURNT = [40, 32, 26];
if (out.items.ing_bacon_raw) {
  out.items.ing_bacon_cooked = recolorPile(out.items.ing_bacon_raw, COOKED, 0.55);
  out.items.ing_bacon_burnt = recolorPile(out.items.ing_bacon_raw, BURNT, 0.85);
}
if (out.items.pan_bacon_raw) {
  out.items.pan_bacon_cooked = recolorPile(out.items.pan_bacon_raw, COOKED, 0.55);
  out.items.pan_bacon_burnt = recolorPile(out.items.pan_bacon_raw, BURNT, 0.85);
}

fs.writeFileSync(new URL('./item-parts.json', import.meta.url).pathname, JSON.stringify(out));
