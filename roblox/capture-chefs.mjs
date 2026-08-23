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

  view.root.updateMatrixWorld(true);

  // Joint origins (bind pose, model space) — the animator rotates each group
  // around these. Limbs use their hip (shoulder for arms); hips/torso/head
  // use their own group origin; tail/ears use the first segment's origin.
  const joints = {};
  const jointOf = (obj, name) => {
    if (!obj || !obj.isObject3D || joints[name]) return;
    const p = new THREE.Vector3();
    obj.getWorldPosition(p);
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

  const prims = [];
  view.root.traverse((obj) => {
    if (!obj.isMesh) return;
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
    const M = new THREE.Matrix4().multiplyMatrices(mesh.matrixWorld, r.mat);
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scl = new THREE.Vector3();
    M.decompose(pos, quat, scl);
    prims.push({
      kind: r.kind,
      args: jsonSafe(r.args),
      pos: [pos.x, pos.y, pos.z],
      quat: [quat.x, quat.y, quat.z, quat.w],
      scale: [scl.x, scl.y, scl.z],
      group,
      color: mat.color ? mat.color.getHexString() : 'ffffff',
      frames: frames(r.stack).slice(0, 4),
    });
  });
  dump.skins[skin] = { prims, joints };
  console.error(`${skin}: ${prims.length} prims, ${Object.keys(joints).length} joints`);
}

fs.writeFileSync(new URL('./chefdump.json', import.meta.url).pathname, JSON.stringify(dump));
