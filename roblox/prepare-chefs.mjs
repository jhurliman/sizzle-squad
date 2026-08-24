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
      // A REAL RING, not a filled disc: a disc read as a gaping mouth where
      // the web draws a thin lip arc (pip), and as a tiara where it draws a
      // headband (bramble). Segments lie in the torus's local XY plane,
      // tangent-oriented; the torus hole runs along local Z.
      // args[4] is the ARC: mouths are ~half-circle smiles, bands are full
      // rings — a full ring where the web draws a smile is a wreath.
      const [r = 0.1, tube = 0.03, , , arc = Math.PI * 2] = p.args;
      const N = Math.max(4, Math.round(10 * (arc / (Math.PI * 2))) + 2);
      for (let k = 0; k < N; k++) {
        const ang = ((k + 0.5) / N) * arc;
        const seg = M.clone()
          .multiply(new THREE.Matrix4().makeTranslation(r * Math.cos(ang) * sx, r * Math.sin(ang) * sy, 0))
          .multiply(new THREE.Matrix4().makeRotationZ(ang + Math.PI / 2));
        emit(p.group, 'Cylinder', [((arc * r) / N) * 1.2 * sx, tube * 2 * sz, tube * 2 * sz], seg, color);
      }
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

  // ---- art direction (playtest, owner) ------------------------------------
  // bramble: drop the rear bandana tails + drawstring cords ('can't tell
  // what it is'), tuck the tongue back to half its protrusion.
  // pip: drop the two chest strap rectangles ('noise').
  // mochi: drop the crest feathers (hat clearance), nudge the cap forward
  // so its back edge stops cutting through the skull.
  if (skin === 'bramble') {
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      if (p.group === 'Ears' && p.cf[2] < -1.0) parts.splice(i, 1);
    }
    // the (now correctly horizontal) band sat across his eyes like a
    // blindfold — raise band + knot to the forehead, and group them as the
    // built-in hat so cosmetic hats replace them (band segments sit below
    // the generic promotion height gate)
    for (const p of parts) {
      if (p.color[0] === 163 && p.color[1] === 35) {
        p.cf[1] += 0.45;
        p.group = 'BuiltinHat';
      }
    }
    for (const p of parts) {
      if (p.group === 'Head' && p.shape === 'Cylinder' && p.color[0] === 51 && p.cf[1] < 7 && p.cf[2] > 1.3) {
        p.cf[2] = 1.16 + (p.cf[2] - 1.16) * 0.5;
      }
    }
  } else if (skin === 'pip') {
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      if (
        p.group === 'Torso' &&
        p.shape === 'Block' &&
        p.color[0] === 236 &&
        p.size[1] > 1.2 &&
        p.size[0] < 0.5
      )
        parts.splice(i, 1);
    }
  } else if (skin === 'mochi') {
    for (let i = parts.length - 1; i >= 0; i--) {
      if (parts[i].group === 'Ears') parts.splice(i, 1);
    }
    // tilt the cap forward and seat it on the sphere of the head (owner)
    const cap = parts.filter((p) => p.group === 'BuiltinHat');
    if (cap.length > 0) {
      const c = [0, 0, 0];
      for (const p of cap) for (let a = 0; a < 3; a++) c[a] += p.cf[a] / cap.length;
      const R = new THREE.Matrix4().makeRotationX(0.24);
      for (const p of cap) {
        const M0 = new THREE.Matrix4().set(
          p.cf[3], p.cf[4], p.cf[5], p.cf[0] - c[0],
          p.cf[6], p.cf[7], p.cf[8], p.cf[1] - c[1],
          p.cf[9], p.cf[10], p.cf[11], p.cf[2] - c[2],
          0, 0, 0, 1,
        );
        const M2 = R.clone().multiply(M0);
        const e = M2.elements;
        p.cf = [e[12] + c[0] + 0.12, e[13] + c[1] - 0.18, e[14] + c[2] + 0.3, e[0], e[4], e[8], e[1], e[5], e[9], e[2], e[6], e[10]];
      }
    }
  } else if (skin === 'nori') {
    // the central ear lives inside any equipped hat — move it to BuiltinHat
    // so it hides with the beanie when a cosmetic hat goes on (owner)
    const ears = parts.filter((p) => p.group === 'Ears');
    if (ears.length > 0) {
      const meanX = ears.reduce((s, p) => s + p.cf[0], 0) / ears.length;
      const left = ears.filter((p) => p.cf[0] < meanX);
      const right = ears.filter((p) => p.cf[0] >= meanX);
      // the occluded ear is the UPRIGHT one — it stands tallest, straight
      // into hat-space (x-distance picked the wrong ear: the flared wedge's
      // base is nearer the skull center than the vertical spike's)
      const topOfCluster = (c) => Math.max(...c.map((p) => p.cf[1] + p.size[1] / 2));
      for (const p of topOfCluster(left) > topOfCluster(right) ? left : right) p.group = 'BuiltinHat';
    }
    // stray beanie segments below the promotion gate (teal hatA)
    for (const p of parts) {
      if (p.group === 'Head' && p.color[0] === 63 && p.color[1] === 201) p.group = 'BuiltinHat';
    }
  }

  const scaledJoints = {};
  for (const [g, p] of Object.entries(joints)) scaledJoints[g] = [p[0] * S, p[1] * S, p[2] * S];
  out.skins[skin] = { parts, joints: scaledJoints };
  console.error(`${skin}: ${parts.length} parts`);
}

fs.writeFileSync(new URL('./chef-parts.json', import.meta.url).pathname, JSON.stringify(out));
