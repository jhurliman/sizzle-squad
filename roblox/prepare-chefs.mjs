// chefdump.json -> chef-parts.json: Roblox part specs per species, grouped by
// skeleton part. Same shape conversions as prepare.mjs (boxes/cyls/balls 1:1,
// cones + lathes as stacked cylinder slices, planes as thin slabs).
import fs from 'node:fs';
import * as THREE from '../node_modules/three/build/three.module.js';

const S = 5; // studs per world unit — matches the environment
const PLANE_T = 0.03;
const dump = JSON.parse(fs.readFileSync(new URL('./chefdump.json', import.meta.url), 'utf8'));

const out = { scale: S, skins: {} };

for (const [skin, entry] of Object.entries(dump.skins)) {
  const prims = entry.prims ?? entry;
  const joints = entry.joints ?? {};
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
    const markStart = parts.length;
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
      // fine slices with a merged tip: coarse steps read as antenna towers
      const [r = 1, h = 1] = p.args;
      const N = 8;
      for (let i = 0; i < N - 1; i++) {
        const rMid = r * (1 - (i + 0.5) / N);
        const yC = -h / 2 + ((i + 0.5) / N) * h;
        emit(
          p.group,
          'Cylinder',
          [(h / N) * sy, 2 * rMid * sx, 2 * rMid * sz],
          M.clone().multiply(new THREE.Matrix4().makeTranslation(0, yC * sy, 0)).multiply(ROT_Z90),
          color,
        );
      }
      // tip: a ball instead of a needle-thin cylinder
      emit(
        p.group,
        'Ball',
        [(2 * r / N) * sx * 1.4, (h / N) * sy * 1.6, (2 * r / N) * sz * 1.4],
        M.clone().multiply(new THREE.Matrix4().makeTranslation(0, (h / 2 - h / (N * 1.6)) * sy, 0)),
        color,
      );
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
    for (let k = markStart; k < parts.length; k++) parts[k].hatCand = p.hatColor === true;
  }
  // ---- fit-up passes ------------------------------------------------------
  // Rotation-aware vertical half-extent: cylinders store [length, dia, dia]
  // with length along the ROTATED local X — treating size[1]/2 as the
  // vertical extent made a tilted brim 'reach' a full radius downward and
  // defeated the hat clamp entirely.
  const halfY = (p) =>
    (Math.abs(p.cf[6]) * p.size[0] + Math.abs(p.cf[7]) * p.size[1] + Math.abs(p.cf[8]) * p.size[2]) / 2;
  // 0. Promote hat-COLORED head parts to the BuiltinHat group only when they
  // sit near/above the skull top — pip's hat shares its white with his eye
  // whites, and color alone once classified his EYES as a hat.
  {
    const head = parts.filter((p) => p.group === 'Head');
    let skull = head[0];
    for (const p of head) {
      if (p.size[0] * p.size[1] * p.size[2] > (skull ? skull.size[0] * skull.size[1] * skull.size[2] : 0)) skull = p;
    }
    if (skull) {
      const skullTop = skull.cf[1] + skull.size[1] / 2;
      for (const p of parts) {
        if (p.hatCand && p.cf[1] + halfY(p) >= skullTop - 0.25) p.group = 'BuiltinHat';
      }
    }
    for (const p of parts) delete p.hatCand;
  }
  // 1. Built-in hat sits ON the head: some species' hats capture with an air
  // gap (the frog's toque floated ~half a stud). Clamp the hat down so its
  // underside meets the head top, sinking slightly for contact.
  {
    // Reference is the SKULL top, not the head-group max: pip's frog eyes
    // protrude above his skull and made 'head top' higher than the hat.
    const head = parts.filter((p) => p.group === 'Head');
    let skull = head[0];
    for (const p of head) {
      if (p.size[0] * p.size[1] * p.size[2] > (skull ? skull.size[0] * skull.size[1] * skull.size[2] : 0)) skull = p;
    }
    const hatParts = parts.filter((p) => p.group === 'BuiltinHat');
    if (hatParts.length > 0 && skull) {
      const skullTop = skull.cf[1] + skull.size[1] / 2;
      const hatBottom = Math.min(...hatParts.map((p) => p.cf[1] - halfY(p)));
      const gap = hatBottom - (skullTop - 0.25);
      if (gap > 0.03) for (const p of hatParts) p.cf[1] -= gap;
    }
  }
  // 2. Grounding: nothing dangles below the soles (ankle caps protruded
  // under the cat's feet). Lift the whole rig so its lowest point is y=0.
  {
    const minY = Math.min(...parts.map((p) => p.cf[1] - halfY(p)));
    if (minY < -0.02) for (const p of parts) p.cf[1] -= minY;
  }

  const scaledJoints = {};
  for (const [g, p] of Object.entries(joints)) scaledJoints[g] = [p[0] * S, p[1] * S, p[2] * S];
  out.skins[skin] = { parts, joints: scaledJoints };
  console.error(`${skin}: ${parts.length} parts`);
}

fs.writeFileSync(new URL('./chef-parts.json', import.meta.url).pathname, JSON.stringify(out));
