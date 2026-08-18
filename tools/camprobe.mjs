/**
 * Offline mirror of the CURRENT CameraRig.solve() (round 7). Sweeps the four
 * shipping aspects and prints every number the critic reads off the pixels, so
 * a constant can be tuned in seconds instead of in screenshot runs.
 *
 *   node tools/camprobe.mjs [key=value ...]
 * e.g. node tools/camprobe.mjs HALF_WIDTH_MIN=5.2 FRONT_CROP=2.5
 */
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
  HALF_WIDTH_MIN: 3.55,
  WIDEN: 0,
  WIDEN_TALL: 1.25,
  FRONT_CROP: 2.5,
  FRONT_CROP_TALL: 1.0,
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
for (const a of process.argv.slice(2)) {
  const [k, v] = a.split('=');
  if (k in K) K[k] = Number(v);
  else throw new Error('unknown key ' + k);
}
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
  LOST_MAX: 0.9,
  EDGE_SOFT: 0.6,
  EDGE_SOFT_WIDE: 0.66,
  EDGE_HARD: 0.92,
  HOLD_TALL: 0.88,
  HOLD_WIDE: 0.84,
  FOLLOW_TALL: 0.1,
};
function shoulder(a, soft, hold) {
  if (a <= soft) return a;
  const span = Math.max(1e-3, hold - soft);
  return soft + span * (1 - Math.exp(-(a - soft) / (span * 0.8)));
}
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
  for (let px = 1.5; px <= 13.5; px += 0.5)
    for (let py = 1.5; py <= 8.6; py += 0.5) {
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
      if (off > mo) { mo = off; at = `(${px},${py})`; }
      if (pf > mp) mp = pf;
    }
  console.log(
    `${label} worst room-centre offset ${mo.toFixed(3)} at ${at} (clamp ${centreMax}, stop ${rescueMax.toFixed(2)}) | worst |playerFrac| ${mp.toFixed(3)}`,
  );
}
console.log('');
worst('portrait ', 393 / 852);
worst('iph-land ', 852 / 393);
worst('ipad     ', 1194 / 834);
worst('desktop  ', 1440 / 900);
