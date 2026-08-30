// Builds the sizzle-squad WorldView headless and dumps every primitive that
// makes up the static environment: shape kind, constructor args, decomposed
// world transform, material/color, and the builder call stack it came from.
import './stub-dom.mjs';
import * as THREE from 'three';
import fs from 'node:fs';

import { buildKitchen, stationCenter, KITCHEN_MAP } from '../src/domain/kitchen.ts';
import { WorldView } from '../src/view/world.ts';
import { PALETTE } from '../src/view/materials.ts';

const cap = globalThis.__cap;

// ---- helpers ---------------------------------------------------------------

const FRAME_RE = /at ([\w$.<>\[\]]+) \(/;
function frames(stack, max = 12) {
  const out = [];
  for (const line of String(stack).split('\n')) {
    const m = FRAME_RE.exec(line);
    if (m) {
      // strip class prefixes like "WorldView2.buildOven" -> "buildOven"
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
  if (v.isVector3) return { x: v.x, y: v.y, z: v.z };
  return String(v);
}

function matInfo(mat) {
  if (!mat) return null;
  return {
    type: mat.type,
    color: mat.color ? mat.color.getHexString() : null,
    emissive: mat.emissive ? mat.emissive.getHexString() : null,
    transparent: !!mat.transparent,
    opacity: mat.opacity ?? 1,
    blending: mat.blending,
    mapTag: mat.map ? frames(mat.map.image?.__stack ?? '').slice(0, 6) : null,
    hasMap: !!mat.map,
  };
}

// ---- build -----------------------------------------------------------------

const kitchen = buildKitchen();
const view = new WorldView(kitchen);
view.root.updateMatrixWorld(true);

const prims = [];
let meshIdx = 0;
const unknownGeo = [];

view.root.traverse((obj) => {
  if (!obj.isMesh) return;
  const mesh = obj;
  const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
  let visible = true;
  for (let o = mesh; o; o = o.parent) if (!o.visible) visible = false;

  const mi = matInfo(mat);
  const sources = cap.merges.get(mesh.geometry) ?? (cap.geos.has(mesh.geometry) ? [mesh.geometry] : null);
  if (!sources) {
    unknownGeo.push({ geoType: mesh.geometry.type, mat: mi, mesh: meshIdx });
    meshIdx++;
    return;
  }
  for (const g of sources) {
    const r = cap.geos.get(g);
    if (!r) continue;
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
      frames: frames(r.stack),
      mesh: meshIdx,
      cast: mesh.castShadow,
      visible,
      mat: mi,
    });
  }
  meshIdx++;
});

// ---- kitchen / naming data -------------------------------------------------

const stations = kitchen.stations.map((st) => {
  let center = null;
  try {
    center = JSON.parse(JSON.stringify(stationCenter(st)));
  } catch {}
  return { ...JSON.parse(JSON.stringify(st)), center };
});

// Authored color-name pairs, scraped from source for reverse lookup (the
// runtime C table is value-capped, so the converter nearest-matches).
function scrapeNames(path) {
  const src = fs.readFileSync(path, 'utf8');
  const out = [];
  for (const m of src.matchAll(/^\s{2,}(\w+):\s*0x([0-9a-fA-F]{6})/gm)) {
    out.push([m[1], parseInt(m[2], 16)]);
  }
  return out;
}

const names = [
  ...scrapeNames('../src/view/world.ts'),
  ...scrapeNames('../src/view/materials.ts'),
  ...scrapeNames('../src/domain/content.ts'),
];

const dump = {
  map: KITCHEN_MAP,
  kitchen: { width: kitchen.width, height: kitchen.height },
  stations,
  palette: Object.fromEntries(Object.entries(PALETTE)),
  names,
  prims,
  unknownGeo,
};

fs.writeFileSync(new URL('./primdump.json', import.meta.url).pathname, JSON.stringify(dump));

// quick stats to stderr for the harness log
const byKind = {};
const byBuilder = {};
for (const p of prims) {
  byKind[p.kind] = (byKind[p.kind] ?? 0) + 1;
  const b = p.frames.find((f) => /^build|^bench|^facePlane|^wallShade/.test(f)) ?? p.frames[1] ?? '?';
  byBuilder[b] = (byBuilder[b] ?? 0) + 1;
}
console.error('prims:', prims.length, 'meshes:', meshIdx, 'unknown:', unknownGeo.length);
console.error('byKind:', JSON.stringify(byKind));
console.error('byBuilder:', JSON.stringify(byBuilder, null, 0));
