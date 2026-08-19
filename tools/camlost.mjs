/**
 * DOES THE PLAYER EVER LEAVE THE PICTURE, AND WHAT WOULD IT COST TO KEEP HIM.
 *
 *   node tools/camlost.mjs [key=value ...]        (same keys as camprobe.mjs)
 *   node tools/camlost.mjs WIDEN=1                the frame the player is IN
 *
 * camprobe.mjs reports the worst |playerFrac| over every walkable cell as one
 * number, and one number cannot answer the question the composition clamps
 * exist for: WHICH cells lose him, HOW MANY, and what LOST_MAX would have to
 * be to contain them all. Same solve, same clamp arithmetic, three more
 * columns.
 *
 * IT ALSO FIXES A TRAP IN HOW camprobe's worst() IS READ. That sweep runs on
 * the REST solve (K.WIDEN = 0), and portrait's frame opens 25% exactly when the
 * player runs wide — which is the only time any of this is load-bearing. Read
 * at rest, portrait looks broken; read at the width it actually has, it is not:
 *
 *                        rest (WIDEN=0)        full widen (WIDEN=1)
 *   worst |playerFrac|   1.263                 0.880
 *   off-picture cells    14 of 375 (3.7%)      0 of 375
 *   LOST_MAX needed      1.166                 0.900
 *
 * LOST_MAX is 0.9, so the constant is set to three digits of exactly what the
 * room's worst corner asks for — and its own doc comment, which claims that
 * corner asks 0.79, is stale by a round. Landscape never consults it: iPhone
 * landscape needs 0.057, iPad 0.268, desktop 0.220.
 *
 * The cells that would be lost at rest are the four outermost columns
 * (x 1.5, 2, 13, 13.5) at the front rows (y 6-8.5), i.e. the flank crates. The
 * residual risk this sweep cannot see is the TRANSIENT: the widen eases in, so
 * a chef who dashes into a front corner faster than the frame opens is inside
 * the rest column above for as long as that takes. That wants a trace, not a
 * sweep.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const DEG = Math.PI / 180;
const WALL_Z = 1;
let WALL_TOP = 9.3;
const FLOOR_OVERRUN = 3.0;
const W = 15;
const H = 11;
const CHEF_H = 1.09; // CHAR_SCALE 0.79 * ~1.38 units of rig

const K = {
  HALF_SPAN: 6.25,
  HALF_SPAN_TALL: 8.0,
  HALF_WIDTH_MAX: 8.95,
  HALF_WIDTH_MIN: 4.6,
  WIDEN: 0,
  WIDEN_TALL: 1.25,
  FRONT_CROP: 2.5,
  FRONT_CROP_TALL: 2.0,
  DOLLY_MAX: 0.4,
  DOLLY_MAX_TALL: 0.0,
  APRON_MAX: 0.5,
  APRON_MAX_TALL: 0.0,
  JOIN: 0.525,
  JOIN_TALL_DROP: 0.0,
  TOP_EDGE_MIN: 4.55,
  HALF_FOV_H_MAX: 31.5,
  PITCH: 22.5,
  PITCH_TALL: 23,
  WALL_HEAD: 0.45,
  WALL_TOP: 9.3,
  HALF_WIDTH_MAX_WIDE: 10.6,
};
// The clamp constants live in CL, which is declared further down, so overrides
// are parsed here and applied there. camprobe.mjs only accepts K keys, which is
// why LOST_MAX could never be swept from the command line.
const OVERRIDES = Object.fromEntries(process.argv.slice(2).map((a) => a.split('=')).map(([k, v]) => [k, Number(v)]));
for (const k of Object.keys(OVERRIDES)) if (k in K) K[k] = OVERRIDES[k];
WALL_TOP = K.WALL_TOP;

const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smoothstep = (t) => t * t * (3 - 2 * t);
function bisect(lo, hi, f) {
  let a = lo,
    b = Math.max(lo, hi);
  for (let i = 0; i < 48; i++) {
    const m = (a + b) / 2;
    if (f(m) < 0) a = m;
    else b = m;
  }
  return (a + b) / 2;
}

function solveEdges(aspect, pitch, zFloor, halfWidth, join, fixedFov) {
  const A = zFloor - WALL_Z;
  const geo = (u) => {
    const b = pitch + Math.atan(2 * (join - 0.5) * Math.tan(u));
    const tb = Math.tan(b);
    const den = 1 - tb / Math.tan(Math.min(pitch + u, 86 * DEG));
    const d = A / Math.max(0.02, den);
    return { d, h: d * tb };
  };
  const u =
    fixedFov ??
    bisect(3 * DEG, 55 * DEG, (x) => {
      const { d, h } = geo(x);
      return (h * Math.sin(pitch) + d * Math.cos(pitch)) * aspect * Math.tan(x) - halfWidth;
    });
  const { d, h } = geo(u);
  return { halfFov: u, height: h, z: d + WALL_Z };
}

function solve(aspect) {
  const t = smoothstep(clamp((aspect - 0.55) / 0.75, 0, 1));
  const zFloor = H - lerp(K.FRONT_CROP_TALL, K.FRONT_CROP, t);
  const wide = smoothstep(clamp((aspect - 1.7) / 0.5, 0, 1));
  const halfWidthWant = clamp(
    aspect * lerp(K.HALF_SPAN_TALL, K.HALF_SPAN, t) * (1 + (1 - t) * K.WIDEN * (K.WIDEN_TALL - 1)),
    K.HALF_WIDTH_MIN,
    lerp(K.HALF_WIDTH_MAX, K.HALF_WIDTH_MAX_WIDE, wide),
  );
  const join = K.JOIN - (1 - t) * K.JOIN_TALL_DROP;
  const pitch = lerp(K.PITCH_TALL, K.PITCH, t) * DEG;
  const fovCap = Math.atan(Math.tan(K.HALF_FOV_H_MAX * DEG) / aspect);
  let { halfFov, height, z } = solveEdges(aspect, pitch, zFloor, halfWidthWant, join);
  if (halfFov > fovCap) {
    const c = solveEdges(aspect, pitch, zFloor, halfWidthWant, join, fovCap);
    halfFov = c.halfFov;
    height = c.height;
    z = c.z;
  }
  const dollyOf = (h, zz, u) => {
    const hit = zz - h / Math.tan(Math.min(pitch + u, 88 * DEG));
    return Math.min(
      lerp(K.DOLLY_MAX_TALL, K.DOLLY_MAX, t),
      Math.max(0, H - 1 + lerp(K.APRON_MAX_TALL, K.APRON_MAX, t) - hit),
      Math.max(0, H + FLOOR_OVERRUN - 0.5 - hit),
    );
  };
  const topOf = (h, zz, u) => h + (zz + dollyOf(h, zz, u) - WALL_Z) * Math.tan(u - pitch);
  let halfWidth = halfWidthWant;
  if (topOf(height, z, halfFov) > WALL_TOP - K.WALL_HEAD) {
    let lo = halfWidthWant * 0.4;
    let hi = halfWidthWant;
    for (let i = 0; i < 24; i++) {
      const m = (lo + hi) / 2;
      const s = solveEdges(aspect, pitch, zFloor, m, join);
      const u = Math.min(s.halfFov, fovCap);
      const r = u === s.halfFov ? s : solveEdges(aspect, pitch, zFloor, m, join, fovCap);
      if (topOf(r.height, r.z, u) > WALL_TOP - K.WALL_HEAD) hi = m;
      else lo = m;
    }
    const s = solveEdges(aspect, pitch, zFloor, lo, join);
    halfFov = Math.min(s.halfFov, fovCap);
    const r = halfFov === s.halfFov ? s : solveEdges(aspect, pitch, zFloor, lo, join, fovCap);
    height = r.height;
    z = r.z;
    halfWidth = lo;
  }
  const f = { pitch, halfFov, height };
  const floorHit = (zz) => zz - height / Math.tan(Math.min(pitch + halfFov, 88 * DEG));
  const rest = floorHit(z);
  const dolly = Math.min(
    lerp(K.DOLLY_MAX_TALL, K.DOLLY_MAX, t),
    Math.max(0, H - 1 + lerp(K.APRON_MAX_TALL, K.APRON_MAX, t) - rest),
    Math.max(0, H + FLOOR_OVERRUN - 0.5 - rest),
  );
  return { t, f, z, zMax: z + dolly, join, floorHit, aspect, halfWidthWant, halfWidth };
}

function report(label, aspect) {
  const s = solve(aspect);
  const { f, z } = s;
  const depthAt = (zz, row) => f.height * Math.sin(f.pitch) + (zz - row) * Math.cos(f.pitch);
  const hwAt = (zz, row) => Math.max(0.2, depthAt(zz, row)) * aspect * Math.tan(f.halfFov);
  const joinAt = (zz) => {
    const toBase = Math.atan(f.height / Math.max(0.01, zz - WALL_Z));
    return 0.5 - (0.5 * Math.tan(f.pitch - toBase)) / Math.tan(f.halfFov);
  };
  const topAt = (zz) => f.height + (zz - WALL_Z) * Math.tan(f.halfFov - f.pitch);
  const vdr = (zz) => depthAt(zz, WALL_Z) / Math.max(0.2, depthAt(zz, s.floorHit(zz)));
  // Chef screen height at a row: world height / (2 * depth * tan(halfFov)) in
  // the frame's own vertical world extent at that depth.
  const chefFrac = (zz, row) => CHEF_H / (2 * Math.max(0.2, depthAt(zz, row)) * Math.tan(f.halfFov));
  const bw = (zz) => Math.min(1, W * 0.5 / hwAt(zz, WALL_Z));
  const line = (tag, zz) =>
    `  ${tag.padEnd(5)} camZ ${zz.toFixed(2)}  join ${joinAt(zz).toFixed(3)}  bottom ${s
      .floorHit(zz)
      .toFixed(2)}  floorDepth ${(s.floorHit(zz) - WALL_Z).toFixed(2)}  backWall ${bw(zz).toFixed(
      3,
    )}  vdr ${vdr(zz).toFixed(2)}  top ${topAt(zz).toFixed(2)}  hw ${hwAt(zz, WALL_Z).toFixed(
      2,
    )}  hw@8 ${hwAt(zz, 8).toFixed(2)}  chef@wall ${(chefFrac(zz, WALL_Z) * 100).toFixed(
      1,
    )}%  chef@front ${(chefFrac(zz, s.floorHit(zz)) * 100).toFixed(1)}%  chef@mid ${(chefFrac(zz, 5) * 100).toFixed(1)}%`;
  console.log(
    `${label} aspect ${aspect.toFixed(3)}  t ${s.t.toFixed(2)}  fov ${(
      (f.halfFov * 2) /
      DEG
    ).toFixed(1)}°  hFov ${(Math.atan(aspect * Math.tan(f.halfFov)) / DEG).toFixed(
      1,
    )}°  eye ${f.height.toFixed(2)}  hwWant ${s.halfWidthWant.toFixed(2)}`,
  );
  console.log(line('rest', z));
  console.log(line('dolly', s.zMax));
}

report('portrait ', 393 / 852);
report('iph-land ', 852 / 393);
report('ipad     ', 1194 / 834);
report('desktop  ', 1440 / 900);

// ---- WORST CASE OVER EVERY PLACE A CHEF CAN STAND ------------------------
// The harness seeds each run from Math.random(), so a screenshot pass samples
// one level out of many and its maxima wander. This is the deterministic
// answer: mirror update()'s clamp and evaluate it at every walkable cell.
const CL = {
  CENTRE_FRAC: 0.0,
  CENTRE_MAX: 0.24,
  CENTRE_MAX_TALL: 0.33,
  RESCUE_MAX: 0.4,
  RESCUE_MAX_TALL: 0.68,
  LOST_MAX: 0.95,
  EDGE_SOFT: 0.6,
  EDGE_SOFT_WIDE: 0.66,
  EDGE_HARD: 0.92,
  HOLD_TALL: 0.88,
  HOLD_WIDE: 0.84,
  FOLLOW_TALL: 0.1,
};
for (const k of Object.keys(OVERRIDES)) {
  if (k in CL) CL[k] = OVERRIDES[k];
  else if (!(k in K)) throw new Error('unknown key ' + k);
}
function shoulder(a, soft, hold) {
  if (a <= soft) return a;
  const span = Math.max(1e-3, hold - soft);
  return soft + span * (1 - Math.exp(-(a - soft) / (span * 0.8)));
}
/**
 * WHERE A CHEF CAN ACTUALLY STAND — READ FROM THE MAP, NOT TYPED IN HERE.
 *
 * These bounds were hardcoded as `px 1.5..13.5, py 1.5..8.6`, and the map had
 * a walkable row below the last one they sampled. So the sweep measured the
 * band that was fine, reported "0 cells lost", and a chef could walk two
 * thirds of a cell past the bottom edge of the picture — which is precisely
 * what came back from play: "I can wander down into the bottom corners of the
 * map where I'm basically off screen".
 *
 * A containment sweep whose bounds do not come from the level is measuring a
 * room of its own invention. They come from KITCHEN_MAP now, and the chef
 * RADIUS is included, because the question is where a body can be, not where
 * a cell centre is.
 */
const KITCHEN_MAP = fs
  .readFileSync(path.join(ROOT_DIR, 'src/domain/kitchen.ts'), 'utf8')
  .match(/export const KITCHEN_MAP = \[([\s\S]*?)\];/)[1]
  .split('\n')
  .map((l) => l.trim().replace(/^'|',?$/g, ''))
  .filter((l) => l.length > 0 && !l.startsWith('//'));
const STATION_OR_WALL = /[^.]/;
const CHEF_R = 0.36;
const WALKABLE = (() => {
  let x0 = 99, x1 = -1, y0 = 99, y1 = -1;
  KITCHEN_MAP.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      if (STATION_OR_WALL.test(ch)) return;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x);
      y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    });
  });
  return { x0: x0 + CHEF_R, x1: x1 + 1 - CHEF_R, y0: y0 + CHEF_R, y1: y1 + 1 - CHEF_R };
})();

function worst(label, aspect) {
  const s = solve(aspect);
  const { f, z } = s;
  const t = s.t;
  const centreX = W / 2;
  const depthAt = (zz, row) => f.height * Math.sin(f.pitch) + (zz - row) * Math.cos(f.pitch);
  const hwAt = (zz, row) => Math.max(0.2, depthAt(zz, row)) * aspect * Math.tan(f.halfFov);
  const live = hwAt(z, WALL_Z);
  const hold = lerp(CL.HOLD_TALL, CL.HOLD_WIDE, t);
  const edgeSoft = lerp(CL.EDGE_SOFT, CL.EDGE_SOFT_WIDE, t);
  const centreMax = lerp(CL.CENTRE_MAX_TALL, CL.CENTRE_MAX, t);
  const rescueMax = lerp(CL.RESCUE_MAX_TALL, CL.RESCUE_MAX, t);
  const follow = lerp(CL.FOLLOW_TALL, 0, t);
  const panX = Math.max(0.4, W * 0.5 - 0.6);
  let mo = 0, mp = 0, at = '';
  const lost = [];
  let needMax = 0;
  for (let px = WALKABLE.x0; px <= WALKABLE.x1 + 1e-9; px += 0.5)
    for (let py = WALKABLE.y0; py <= WALKABLE.y1 + 1e-9; py += 0.5) {
      const atChef = hwAt(z, py);
      const freeX = centreX + (px - centreX) * follow;
      const raw = (px - freeX) / atChef;
      const eased = shoulder(Math.abs(raw), edgeSoft, hold);
      const sign = raw < 0 ? -1 : 1;
      const holdX = px - sign * eased * atChef;
      const limit = clamp(
        Math.abs(holdX - centreX),
        Math.min(CL.CENTRE_FRAC * live, panX),
        Math.min(centreMax * live, panX),
      );
      const need = Math.abs(px - centreX) - 0.80 * atChef;
      const room = Math.min(panX, Math.max(limit, Math.min(need, (aspect < 1.2 ? CL.LOST_MAX : rescueMax) * live)));
      const camX = clamp(holdX, centreX - room, centreX + room);
      const off = Math.abs(camX - centreX) / live;
      const pf = Math.abs((px - camX) / atChef);
      needMax = Math.max(needMax, need / live);
      if (pf > 1.0) lost.push({ px, py, pf: +pf.toFixed(2), off: +off.toFixed(2) });
      if (off > mo) { mo = off; at = `(${px},${py})`; }
      if (pf > mp) mp = pf;
    }
  const cells = 25 * 15;
  console.log(
    `${label} worstOffset ${mo.toFixed(3)} at ${at} | worst|playerFrac| ${mp.toFixed(3)} | OFF-PICTURE cells ${lost.length}/${cells} (${(100*lost.length/cells).toFixed(1)}%) | LOST_MAX that would contain every cell: ${needMax.toFixed(3)}`,
  );
  if (lost.length) {
    const cols = [...new Set(lost.map((l) => l.px))].sort((a,b)=>a-b);
    const rows = [...new Set(lost.map((l) => l.py))].sort((a,b)=>a-b);
    console.log(`    lost x: ${cols.join(',')}`);
    console.log(`    lost y: ${rows.join(',')}`);
  }
}
console.log('');
worst('portrait ', 393 / 852);
worst('iph-land ', 852 / 393);
worst('ipad     ', 1194 / 834);
worst('desktop  ', 1440 / 900);
