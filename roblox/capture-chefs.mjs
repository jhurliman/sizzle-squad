// Captures the four procedural chef species (ChefView) in bind pose, with
// every primitive attributed to its named skeleton group (Hips/Torso/Head/
// limbs/Hands/Tail/Ears) by walking the three.js parent chain. TypeScript
// `private` fields are runtime-accessible, so the groups are named here.
import './stub-dom.mjs';
import * as THREE from 'three';
import fs from 'node:fs';

import { ChefView } from '../src/view/characters.ts';
import { createSim } from '../src/domain/sim.ts';

const cap = globalThis.__cap;
const SKINS = ['bramble', 'pip', 'nori', 'mochi'];

const FRAME_RE = /at ([\w$.<>\[\]]+) \(/;
function frames(stack, max = 8) {
  const out = [];
  for (const line of String(stack).split('\n')) {
    const m = FRAME_RE.exec(line);
    if (m) {
      const name = m[1].split('.').pop();
      if (name && name !== 'Error') out.push(name);
    }
    if (out.length >= max) break;
  }
  return out;
}

function jsonSafe(v) {
  if (v == null || typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') return v;
  if (Array.isArray(v)) return v.map(jsonSafe);
  if (v.isVector2) return { x: v.x, y: v.y };
  return String(v);
}

const sim = createSim({ seed: 1, botCount: 3 });
const dump = { skins: {} };

for (let s = 0; s < SKINS.length; s++) {
  const skin = SKINS[s];
  const chef = sim.chefs[0];
  chef.skin = skin;
  chef.isPlayer = false;
  chef.pos.x = 0;
  chef.pos.y = 0;
  chef.heading = 0;

  const view = new ChefView(chef);
  const v = view; // runtime access to TS-private fields
  const names = new Map();
  const nameGroup = (obj, name) => {
    if (obj && obj.isObject3D) names.set(obj, name);
  };
  nameGroup(v.hips, 'Hips');
  nameGroup(v.torso, 'Torso');
  nameGroup(v.head, 'Head');
  nameGroup(v.hands, 'Hands');
  for (const [limb, base] of [
    [v.legL, 'LegL'],
    [v.legR, 'LegR'],
    [v.armL, 'ArmL'],
    [v.armR, 'ArmR'],
  ]) {
    if (limb) {
      nameGroup(limb.hip, base);
      nameGroup(limb.knee, base);
      nameGroup(limb.foot, base);
    }
  }
  for (const t of v.tail ?? []) nameGroup(t, 'Tail');
  for (const e of v.ears ?? []) nameGroup(e, 'Ears');
  // The built-in hat is one structural unit (characters.ts hatGroup). Naming
  // it makes the nearest-named-ancestor walk assign EVERY hat part —
  // including shaded pleats that no longer match hatA/hatB — to BuiltinHat.
  // This replaces the fragile colour-match promotion that left pip's toque
  // pleats visible in the Head group.
  nameGroup(v.hatGroup, 'BuiltinHat');

  // Settle the rig: rest rotations for ears/crests/bandana tails and the
  // tail-spring are applied during update(), not at construction — capturing
  // the raw constructed pose is exactly the "red candle growing out of the
  // bear's head" bug the web game once shipped.
  // 3 ticks: rests are assigned every frame (1 is enough) and the tail
  // spring starts at rest — while 30 ticks let the IDLE GESTURE animation
  // walk the limbs out of neutral (a raised cat leg, exposed ankle caps).
  for (let i = 0; i < 12; i++) view.update(1 / 60, i / 60);
  // Legs settle into a mid-stride split; the animator swings around the bind
  // pose, so a split bind skews the whole gait. Zero the leg pivots (ears/
  // tail rests stay — those are what the settle was for).
  for (const limb of [v.legL, v.legR]) {
    if (limb) {
      for (const node of [limb.hip, limb.knee, limb.foot]) {
        if (node && node.rotation) node.rotation.set(0, 0, 0);
      }
    }
  }
  view.root.updateMatrixWorld(true);

  // Capture RELATIVE to the rig node: update() bakes heading/idle root
  // motion into world matrices (the whole cast faced sideways), while the
  // rest rotations we settled for live INSIDE the rig and survive.
  const refNode = v.rig ?? view.root;
  const refInv = refNode.matrixWorld.clone().invert();

  // Joint origins (bind pose, model space) — the animator rotates each group
  // around these. Limbs use their hip (shoulder for arms); hips/torso/head
  // use their own group origin; tail/ears use the first segment's origin.
  const joints = {};
  const jointOf = (obj, name) => {
    if (!obj || !obj.isObject3D || joints[name]) return;
    const p = new THREE.Vector3();
    obj.getWorldPosition(p);
    p.applyMatrix4(refInv);
    joints[name] = [p.x, p.y, p.z];
  };
  jointOf(v.hips, 'Hips');
  jointOf(v.torso, 'Torso');
  jointOf(v.head, 'Head');
  jointOf(v.hands, 'Hands');
  jointOf(v.legL?.hip, 'LegL');
  jointOf(v.legR?.hip, 'LegR');
  jointOf(v.armL?.hip, 'ArmL');
  jointOf(v.armR?.hip, 'ArmR');
  jointOf((v.tail ?? [])[0], 'Tail');
  jointOf((v.ears ?? [])[0], 'Ears');

  // Interior helper geometry that must not be captured: the mouth CAVITY is
  // a dark mask sphere hidden inside the head whose scale is driven live by
  // update() — captured post-settle it becomes a 10-stud ball swallowing the
  // whole chef (every species except the beak-hinged bird).
  const skip = new Set();
  const markSkip = (obj) => obj && obj.isObject3D && obj.traverse((o) => skip.add(o));
  markSkip(v.mouthCav);

  // Eyes are structurally known (v.eyes) — never hat candidates, no matter
  // how white they are (pip's eye whites ARE his hat color).
  const eyeSet = new Set();
  for (const e of v.eyes ?? []) e.traverse && e.traverse((o) => eyeSet.add(o));

  const prims = [];
  view.root.traverse((obj) => {
    if (!obj.isMesh) return;
    if (skip.has(obj)) return;
    const mesh = obj;
    const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    if (!mat || mat.transparent === true || (mat.opacity ?? 1) < 1) return; // shadow blob etc.
    const r = cap.geos.get(mesh.geometry);
    if (!r) return;
    // nearest named ancestor
    let group = 'Body';
    for (let o = mesh; o; o = o.parent) {
      const n = names.get(o);
      if (n) {
        group = n;
        break;
      }
    }
    // Hat-COLORED head parts are only candidates — pip's hat is white, and so
    // are his eye whites. prepare-chefs.mjs promotes candidates to the
    // BuiltinHat group only if they sit near/above the skull top.
    const hatColor =
      group === 'Head' &&
      !eyeSet.has(mesh) &&
      mat.color &&
      (mat.color.getHex() === v.skin.hatA || mat.color.getHex() === v.skin.hatB);
    const M = new THREE.Matrix4().multiplyMatrices(refInv, new THREE.Matrix4().multiplyMatrices(mesh.matrixWorld, r.mat));
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scl = new THREE.Vector3();
    M.decompose(pos, quat, scl);
    // safety net: any animation-driven runaway scale is a capture bug, not art
    if (Math.max(scl.x, scl.y, scl.z) > 4) {
      console.error(`  SKIP runaway-scale prim in ${skin} (${scl.x.toFixed(1)})`);
      return;
    }
    prims.push({
      kind: r.kind,
      args: jsonSafe(r.args),
      pos: [pos.x, pos.y, pos.z],
      quat: [quat.x, quat.y, quat.z, quat.w],
      scale: [scl.x, scl.y, scl.z],
      group,
      hatColor: hatColor === true,
      color: mat.color ? mat.color.getHexString() : 'ffffff',
      frames: frames(r.stack).slice(0, 4),
    });
  });
  dump.skins[skin] = { prims, joints };
  console.error(`${skin}: ${prims.length} prims, ${Object.keys(joints).length} joints`);
}

fs.writeFileSync(new URL('./chefdump.json', import.meta.url).pathname, JSON.stringify(dump));
