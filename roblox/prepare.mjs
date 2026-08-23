// Turns primdump.json (raw three.js primitives) into parts.json — a flat list
// of Roblox parts with model paths, names, sizes, CFrames, colors, materials.
// All geometry/color logic lives here; the Lune converter just instantiates.
import fs from 'node:fs';
import * as THREE from '../node_modules/three/build/three.module.js';

const S = 5; // studs per world unit
const PLANE_T = 0.12; // thickness (world units) given to flat planes
const dump = JSON.parse(fs.readFileSync(new URL('./primdump.json', import.meta.url), 'utf8'));

// ---------- filtering -------------------------------------------------------

const DROP_BUILDERS = new Set(['wallShade', 'buildCornerAO', 'buildActionGlyph']);
const builderOf = (p) =>
  p.frames.find((f) => /^build[A-Z]|^bench|^facePlane/.test(f)) ?? p.frames[1] ?? 'misc';

const keep = dump.prims.filter(
  (p) =>
    !DROP_BUILDERS.has(builderOf(p)) &&
    p.mat.type !== 'MeshBasicMaterial' &&
    !p.mat.transparent &&
    p.mat.opacity >= 1 &&
    p.visible,
);

// ---------- naming ----------------------------------------------------------

const GENERIC_KEYS = new Set(['color', 'tint', 'lift', 'emissive', 'hex', 'w', 'h']);
const nameTable = []; // [name, r,g,b]
const seen = new Set();
for (const [name, hex] of dump.names) {
  if (GENERIC_KEYS.has(name)) continue;
  if (seen.has(name)) continue;
  seen.add(name);
  nameTable.push([name, (hex >> 16) & 255, (hex >> 8) & 255, hex & 255]);
}
for (const [name, hex] of Object.entries(dump.palette)) {
  if (!seen.has(name)) nameTable.push([name, (hex >> 16) & 255, (hex >> 8) & 255, hex & 255]);
}

function colorName([r, g, b]) {
  let best = 'Tone';
  let bestD = Infinity;
  for (const [name, nr, ng, nb] of nameTable) {
    const d = (r - nr) ** 2 + (g - ng) ** 2 + (b - nb) ** 2;
    if (d < bestD) {
      bestD = d;
      best = name;
    }
  }
  if (bestD > 110 ** 2) best = 'Tone' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
  return best[0].toUpperCase() + best.slice(1);
}

// ---------- materials -------------------------------------------------------

const METAL_NAMES = new Set(['steel', 'steelDark', 'copper', 'copperDark', 'copperRim', 'knife']);
const WOODY = /^(timber|counter|board|crate|bench|plank|door|beam|shelf|handle|rack)/i;
const STONY = /^(stone|cobble|arch|slate|hearth|flag|chimney|wainscot|soot)/i;

const TEX_BASE = {
  stoneFloorTexture: dump.palette.floorA,
  stuccoTexture: dump.palette.wall,
  timberTexture: dump.palette.timber,
  chimneyStoneTexture: dump.palette.stone,
  brickTexture: 0x8a4a32,
};
const TEX_MAT = {
  stoneFloorTexture: 'Slate',
  stuccoTexture: 'Concrete',
  timberTexture: 'WoodPlanks',
  chimneyStoneTexture: 'Slate',
  brickTexture: 'Brick',
};

function finalColor(p) {
  let r = parseInt(p.mat.color.slice(0, 2), 16);
  let g = parseInt(p.mat.color.slice(2, 4), 16);
  let b = parseInt(p.mat.color.slice(4, 6), 16);
  const texFn = p.mat.mapTag?.find((f) => TEX_BASE[f]);
  if (texFn) {
    const base = TEX_BASE[texFn];
    r = (r / 255) * ((base >> 16) & 255);
    g = (g / 255) * ((base >> 8) & 255);
    b = (b / 255) * (base & 255);
  }
  if (p.mat.emissive && p.mat.emissive !== '000000') {
    const k = 0.35;
    r += k * parseInt(p.mat.emissive.slice(0, 2), 16);
    g += k * parseInt(p.mat.emissive.slice(2, 4), 16);
    b += k * parseInt(p.mat.emissive.slice(4, 6), 16);
  }
  return [Math.min(255, Math.round(r)), Math.min(255, Math.round(g)), Math.min(255, Math.round(b))];
}

function materialOf(p, cname) {
  const texFn = p.mat.mapTag?.find((f) => TEX_MAT[f]);
  if (texFn) return TEX_MAT[texFn];
  const raw = cname[0].toLowerCase() + cname.slice(1);
  if (p.mat.type === 'MeshPhongMaterial') return METAL_NAMES.has(raw) ? 'Metal' : 'SmoothPlastic';
  if (WOODY.test(raw)) return 'WoodPlanks';
  if (STONY.test(raw)) return 'Slate';
  return 'SmoothPlastic';
}

// ---------- grouping --------------------------------------------------------

const cap = (s) => s[0].toUpperCase() + s.slice(1);
const stations = dump.stations;
function nearestStation(p) {
  let best = null;
  let bestD = Infinity;
  for (const st of stations) {
    const d = (p.pos[0] - st.center.x) ** 2 + (p.pos[2] - st.center.y) ** 2;
    if (d < bestD) {
      bestD = d;
      best = st;
    }
  }
  return best;
}

function groupOf(p) {
  const b = builderOf(p);
  const inFrames = (fn) => p.frames.includes(fn);
  if (b === 'buildFloor') return ['Floor'];
  if (b === 'facePlane') {
    if (inFrames('buildBackWall')) return ['Walls', 'BackWall'];
    if (inFrames('buildSideWalls')) return ['Walls', 'SideWalls'];
    if (inFrames('buildOven')) return ['Oven'];
    if (inFrames('buildFloor')) return ['Floor'];
    return ['Walls'];
  }
  if (b === 'buildBackWall') return ['Walls', 'BackWall'];
  if (b === 'buildSideWalls') return ['Walls', 'SideWalls'];
  if (b === 'buildOven') return ['Oven'];
  if (b === 'bench' || b === 'benchRun' || b === 'buildBenches') {
    return ['Benches', benchCluster(p)];
  }
  if (b === 'buildStation') {
    const st = nearestStation(p);
    if (st) return ['Stations', `${cap(st.kind)}_${st.cell.x}_${st.cell.y}`];
    return ['Stations'];
  }
  if (b === 'buildDressing') return ['Dressing'];
  return ['Misc'];
}

// ---------- bench clustering (union-find on XZ proximity) -------------------

const benchPrims = keep.filter((p) => {
  const b = builderOf(p);
  return b === 'bench' || b === 'benchRun' || b === 'buildBenches';
});
const ufParent = benchPrims.map((_, i) => i);
const find = (i) => (ufParent[i] === i ? i : (ufParent[i] = find(ufParent[i])));
for (let i = 0; i < benchPrims.length; i++)
  for (let j = i + 1; j < benchPrims.length; j++) {
    const a = benchPrims[i];
    const b = benchPrims[j];
    const d2 = (a.pos[0] - b.pos[0]) ** 2 + (a.pos[2] - b.pos[2]) ** 2;
    if (d2 < 0.8 ** 2) ufParent[find(j)] = find(i);
  }
const clusterName = new Map(); // root index -> name
const primCluster = new Map(); // prim -> name
{
  const centroids = new Map();
  benchPrims.forEach((p, i) => {
    const r = find(i);
    const c = centroids.get(r) ?? { x: 0, z: 0, n: 0 };
    c.x += p.pos[0];
    c.z += p.pos[2];
    c.n++;
    centroids.set(r, c);
  });
  for (const [r, c] of centroids)
    clusterName.set(r, `Bench_${Math.floor(c.x / c.n)}_${Math.floor(c.z / c.n)}`);
  benchPrims.forEach((p, i) => primCluster.set(p, clusterName.get(find(i))));
}
function benchCluster(p) {
  return primCluster.get(p) ?? `Bench_${Math.floor(p.pos[0])}_${Math.floor(p.pos[2])}`;
}

// ---------- shape conversion ------------------------------------------------

const parts = [];
const counters = new Map();

function emit(group, baseName, shape, size, M, color, material, extra = {}) {
  const key = group.join('/') + '/' + baseName;
  const n = (counters.get(key) ?? 0) + 1;
  counters.set(key, n);
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scl = new THREE.Vector3();
  M.decompose(pos, quat, scl);
  const R = new THREE.Matrix4().makeRotationFromQuaternion(quat).elements; // column-major
  parts.push({
    group,
    name: `${baseName}_${String(n).padStart(2, '0')}`,
    shape,
    size: size.map((v) => Math.max(0.05, v * S)),
    cf: [
      pos.x * S,
      pos.y * S,
      pos.z * S,
      // row-major rotation matrix for CFrame.new(x,y,z, R00,R01,R02, R10,...)
      R[0], R[4], R[8],
      R[1], R[5], R[9],
      R[2], R[6], R[10],
    ],
    color,
    material,
    ...extra,
  });
}

const ROT_Z90 = new THREE.Matrix4().makeRotationZ(Math.PI / 2); // part X -> local Y
const ROT_Y90 = new THREE.Matrix4().makeRotationY(Math.PI / 2); // part X -> local Z

function primMatrix(p) {
  const M = new THREE.Matrix4().compose(
    new THREE.Vector3(...p.pos),
    new THREE.Quaternion(...p.quat),
    new THREE.Vector3(1, 1, 1),
  );
  return M;
}

for (const p of keep) {
  const group = groupOf(p);
  const color = finalColor(p);
  const cname = colorName(color);
  const material = materialOf(p, cname);
  const M = primMatrix(p);
  const [sx, sy, sz] = p.scale;

  if (p.kind === 'box') {
    const [w = 1, h = 1, d = 1] = p.args;
    emit(group, cname, 'Block', [w * sx, h * sy, d * sz], M, color, material);
  } else if (p.kind === 'cyl') {
    const [rt = 1, rb = rt, h = 1] = p.args;
    const r = (rt + rb) / 2;
    const M2 = M.clone().multiply(ROT_Z90);
    emit(group, cname, 'Cylinder', [h * sy, 2 * r * sx, 2 * r * sz], M2, color, material);
  } else if (p.kind === 'ball') {
    const [r = 1] = p.args;
    const uniform = Math.abs(sx - sy) < 1e-6 && Math.abs(sy - sz) < 1e-6;
    if (uniform) {
      emit(group, cname, 'Ball', [2 * r * sx, 2 * r * sx, 2 * r * sx], M, color, material);
    } else {
      emit(group, cname, 'SphereMesh', [2 * r * sx, 2 * r * sy, 2 * r * sz], M, color, material);
    }
  } else if (p.kind === 'cone') {
    const [r = 1, h = 1] = p.args;
    const SLICES = 3;
    for (let i = 0; i < SLICES; i++) {
      const f0 = i / SLICES;
      const rMid = r * (1 - (i + 0.5) / SLICES);
      const hS = h / SLICES;
      const yC = -h / 2 + (f0 + 0.5 / SLICES) * h;
      const M2 = M.clone()
        .multiply(new THREE.Matrix4().makeTranslation(0, yC * sy, 0))
        .multiply(ROT_Z90);
      emit(group, cname, 'Cylinder', [hS * sy, 2 * rMid * sx, 2 * rMid * sz], M2, color, material);
    }
  } else if (p.kind === 'lathe') {
    const pts = p.args[0];
    for (let i = 0; i + 1 < pts.length; i++) {
      const h = pts[i + 1].y - pts[i].y;
      if (h < 1e-4) continue;
      const r = Math.max(0.012, (pts[i].x + pts[i + 1].x) / 2);
      const yC = (pts[i].y + pts[i + 1].y) / 2;
      const M2 = M.clone()
        .multiply(new THREE.Matrix4().makeTranslation(0, yC * sy, 0))
        .multiply(ROT_Z90);
      emit(group, cname, 'Cylinder', [h * sy, 2 * r * sx, 2 * r * sz], M2, color, material);
    }
  } else if (p.kind === 'plane') {
    const [w = 1, h = 1] = p.args;
    // sink the slab behind its visible face (plane normal = local +Z)
    const M2 = M.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0, -PLANE_T / 2));
    emit(group, cname, 'Block', [w * sx, h * sy, PLANE_T], M2, color, material);
  } else if (p.kind === 'circle') {
    const [r = 1] = p.args;
    const M2 = M.clone()
      .multiply(new THREE.Matrix4().makeTranslation(0, 0, -PLANE_T / 2))
      .multiply(ROT_Y90);
    emit(group, cname, 'Cylinder', [PLANE_T, 2 * r * sx, 2 * r * sy], M2, color, material);
  } else if (p.kind === 'ring') {
    const [, ro = 1] = p.args;
    const M2 = M.clone()
      .multiply(new THREE.Matrix4().makeTranslation(0, 0, -PLANE_T / 2))
      .multiply(ROT_Y90);
    emit(group, cname, 'Cylinder', [PLANE_T, 2 * ro * sx, 2 * ro * sy], M2, color, material);
  }
}

// ---------- spawns ----------------------------------------------------------

const spawns = [3, 6, 9, 12].map((cx, i) => ({
  name: `Spawn_${i + 1}`,
  cf: [(cx + 0.5) * S, 0.5, (8 + 0.5) * S, 1, 0, 0, 0, 1, 0, 0, 0, 1],
  size: [4, 1, 4],
}));

// floor bounds for the invisible perimeter colliders
const floor = keep.find((p) => builderOf(p) === 'buildFloor');
const fw = floor.args[0] * S;
const fd = floor.args[1] * S;
const fcx = floor.pos[0] * S;
const fcz = floor.pos[2] * S;

const out = {
  scale: S,
  parts,
  spawns,
  floorBounds: { cx: fcx, cz: fcz, w: fw, d: fd },
  stats: {
    parts: parts.length,
    groups: [...new Set(parts.map((p) => p.group.join('/')))].length,
  },
};
fs.writeFileSync(new URL('./parts.json', import.meta.url), JSON.stringify(out));
console.error('parts:', parts.length, 'groups:', out.stats.groups);
const byGroup = {};
for (const p of parts) byGroup[p.group[0]] = (byGroup[p.group[0]] ?? 0) + 1;
console.error('byTopGroup:', JSON.stringify(byGroup));
