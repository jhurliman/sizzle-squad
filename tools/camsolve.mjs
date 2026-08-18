/**
 * Offline mirror of CameraRig.solve(), for tuning the framing without paying
 * for a full screenshot run. Prints, per aspect, the numbers the critic reads
 * off the pixels: the wall/floor join, where the bottom edge lands, and what
 * fraction of the frame each interesting world row projects to.
 *
 *   node tools/camsolve.mjs [zAnchorPortrait] [anchorFracPortrait] [halfWidthPortrait]
 */
const DEG = Math.PI / 180;
const WALL_Z = 1;
const WALL_TOP = 8;
const W = 15;
const H = 11;

const P = {
  zAnchor: [Number(process.argv[2] ?? H - 1.0), H - 1.5],
  anchorFrac: [Number(process.argv[3] ?? 0.74), 1.0],
  height: [6.5, 6.2],
  halfWidth: [Number(process.argv[4] ?? 3.8), (W * 0.5) * 1.25],
  pitch: [23, 22.5],
};

const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smoothstep = (t) => t * t * (3 - 2 * t);

function bisect(lo, hi, f) {
  let a = lo, b = Math.max(lo, hi);
  for (let i = 0; i < 40; i++) {
    const m = (a + b) / 2;
    if (f(m) < 0) a = m; else b = m;
  }
  return (a + b) / 2;
}

function camZ(pitch, u, height, zAnchor, frac) {
  const k = (2 * frac - 1) * Math.tan(u);
  const theta = Math.min(pitch + Math.atan(k), 88 * DEG);
  return zAnchor + height / Math.tan(Math.max(theta, 3 * DEG));
}
const wallDepth = (pitch, h, z) => h * Math.sin(pitch) + (z - WALL_Z) * Math.cos(pitch);

function solve(aspect) {
  const t = smoothstep(clamp((aspect - 0.9) / 0.45, 0, 1));
  const zAnchor = lerp(P.zAnchor[0], P.zAnchor[1], t);
  const anchorFrac = lerp(P.anchorFrac[0], P.anchorFrac[1], t);
  const wide = smoothstep(clamp((aspect - 1.7) / 0.5, 0, 1));
  const height = lerp(P.height[0], P.height[1], t);
  const halfWidth = lerp(P.halfWidth[0], P.halfWidth[1], t) * (1 + wide * Number(process.argv[5] ?? 0));
  let pitch = lerp(P.pitch[0], P.pitch[1], t) * DEG;
  let u = 0, z = 0;
  for (let i = 0; i < 12; i++) {
    u = bisect(3 * DEG, Math.min(58 * DEG, 84 * DEG - pitch), (x) => {
      const cz = camZ(pitch, x, height, zAnchor, anchorFrac);
      return wallDepth(pitch, height, cz) * aspect * Math.tan(x) - halfWidth;
    });
    z = camZ(pitch, u, height, zAnchor, anchorFrac);
    const topHit = height + (z - WALL_Z) * Math.tan(u - pitch);
    if (topHit <= WALL_TOP - 0.4) break;
    pitch += 1.5 * DEG;
  }
  return { aspect, t, pitch, u, height, z, halfWidth };
}

/** Frame fraction (0 top, 1 bottom) of a point at world (y=el, z). */
function frac(f, z, el = 0) {
  const theta = Math.atan((f.height - el) / (f.z - z));
  return 0.5 + (0.5 * Math.tan(theta - f.pitch)) / Math.tan(f.u);
}

const NAMES = { 0.4613: 'portrait', 2.1679: 'phone-land', 1.4317: 'ipad', 1.6: 'desktop' };
for (const a of [393 / 852, 852 / 393, 1194 / 834, 1.6]) {
  const f = solve(a);
  const join = 0.5 - (0.5 * Math.tan(f.pitch - Math.atan(f.height / (f.z - WALL_Z)))) / Math.tan(f.u);
  const bottomZ = f.z - f.height / Math.tan(f.pitch + f.u);
  const d = (z) => f.height * Math.sin(f.pitch) + (f.z - z) * Math.cos(f.pitch);
  console.log(
    (NAMES[+a.toFixed(4)] ?? a.toFixed(2)).padEnd(11),
    'fov', ((f.u * 2) / DEG).toFixed(1).padStart(5),
    'pitch', (f.pitch / DEG).toFixed(1),
    'camZ', f.z.toFixed(2).padStart(6),
    'join', join.toFixed(3),
    'botZ', bottomZ.toFixed(2).padStart(6),
    '| chef@9.5 feet', frac(f, 9.5).toFixed(2), 'head', frac(f, 9.5, 1.75).toFixed(2),
    '| chef@5.5', frac(f, 5.5).toFixed(2), '/', frac(f, 5.5, 1.75).toFixed(2),
    '| depth', (d(3.5) / d(9.5)).toFixed(2),
    '| wallShare', (W / (2 * f.halfWidth)).toFixed(2),
    '| topHit', (f.height + (f.z - WALL_Z) * Math.tan(f.u - f.pitch)).toFixed(2),
    'beamFrac', frac({ ...f }, WALL_Z, 4.35).toFixed(3),
  );
}
