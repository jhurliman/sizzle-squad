// Captures the web game's item visuals (ingredients in every prep state,
// plates, pans) by placing each on a station and letting WorldView's own
// content builders construct the meshes, then recording them relative to the
// station's content root. Output: itemdump.json -> prepare-items.mjs.
import './stub-dom.mjs';
import * as THREE from 'three';
import fs from 'node:fs';

import { createSim } from '../src/domain/sim.ts';
import { WorldView } from '../src/view/world.ts';

const cap = globalThis.__cap;

const CASES = [
  ['ing_tomato_raw', { type: 'ingredient', ingredient: { id: 900, kind: 'tomato', state: 'raw', progress: 0, overcook: 0 } }],
  ['ing_tomato_prepped', { type: 'ingredient', ingredient: { id: 901, kind: 'tomato', state: 'prepped', progress: 0, overcook: 0 } }],
  ['ing_lettuce_raw', { type: 'ingredient', ingredient: { id: 902, kind: 'lettuce', state: 'raw', progress: 0, overcook: 0 } }],
  ['ing_lettuce_prepped', { type: 'ingredient', ingredient: { id: 903, kind: 'lettuce', state: 'prepped', progress: 0, overcook: 0 } }],
  ['ing_bacon_raw', { type: 'ingredient', ingredient: { id: 904, kind: 'bacon', state: 'raw', progress: 0, overcook: 0 } }],
  ['ing_bacon_prepped', { type: 'ingredient', ingredient: { id: 905, kind: 'bacon', state: 'prepped', progress: 0, overcook: 0 } }],
  ['ing_bacon_cooked', { type: 'ingredient', ingredient: { id: 906, kind: 'bacon', state: 'cooked', progress: 0, overcook: 0 } }],
  ['ing_bacon_burnt', { type: 'ingredient', ingredient: { id: 907, kind: 'bacon', state: 'burnt', progress: 0, overcook: 0 } }],
  ['ing_bun_raw', { type: 'ingredient', ingredient: { id: 908, kind: 'bun', state: 'raw', progress: 0, overcook: 0 } }],
  ['plate', { type: 'plate', plate: { id: 910, contents: [], dirty: false } }],
  ['plate_dirty', { type: 'plate', plate: { id: 911, contents: [], dirty: true } }],
  [
    'plate_full',
    {
      type: 'plate',
      plate: {
        id: 912,
        dirty: false,
        contents: [
          { id: 913, kind: 'bun', state: 'raw', progress: 0, overcook: 0 },
          { id: 914, kind: 'bacon', state: 'cooked', progress: 0, overcook: 0 },
          { id: 915, kind: 'lettuce', state: 'prepped', progress: 0, overcook: 0 },
        ],
      },
    },
  ],
  ['pan', { type: 'pan', pan: { id: 920, contents: [], onHeat: false, fire: 0 } }],
];

const sim = createSim({ seed: 1, botCount: 3 });
const view = new WorldView(sim.kitchen);
const camera = new THREE.PerspectiveCamera(40, 1.6, 1, 100);
camera.position.set(7.5, 10, 20);
camera.lookAt(7.5, 0, 5);

// a plain counter station to stage items on
const station = sim.kitchen.stations.find((s) => s.kind === 'counter') ?? sim.kitchen.stations[0];
const stationView = view.stationViews.find((v) => v.station.id === station.id);
if (!stationView) throw new Error('no station view');

function jsonSafe(v) {
  if (v == null || typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') return v;
  if (Array.isArray(v)) return v.map(jsonSafe);
  if (v.isVector2) return { x: v.x, y: v.y };
  return String(v);
}

const dump = {};
for (const [key, holding] of CASES) {
  station.holding = holding;
  view.update(null, 'none', 1 / 60, 1, camera);
  view.root.updateMatrixWorld(true);
  const rootInv = new THREE.Matrix4().copy(stationView.contentRoot.matrixWorld).invert();
  const prims = [];
  stationView.contentRoot.traverse((obj) => {
    if (!obj.isMesh) return;
    const mat = Array.isArray(obj.material) ? obj.material[0] : obj.material;
    if (!mat || mat.transparent === true || (mat.opacity ?? 1) < 1) return;
    const r = cap.geos.get(obj.geometry);
    if (!r) return;
    const M = new THREE.Matrix4().multiplyMatrices(rootInv, new THREE.Matrix4().multiplyMatrices(obj.matrixWorld, r.mat));
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
      color: mat.color ? mat.color.getHexString() : 'ffffff',
    });
  });
  dump[key] = prims;
  console.error(`${key}: ${prims.length} prims`);
}

fs.writeFileSync(new URL('./itemdump.json', import.meta.url).pathname, JSON.stringify(dump));
